/**
 * Socket.io event handlers.
 *
 * Bridges the GameEngine events and client socket calls to match the event
 * contract expected by the React frontend (context.tsx).
 *
 * Frontend → Server events:
 *   enterRoom   { token }
 *   playBet     { betAmount, target, type, auto }
 *   cashOut     { type, endTarget }
 *
 * Server → Frontend events:
 *   gameState        GameStatusType { currentNum, currentSecondNum, GameState, time }
 *   bettedUserInfo   BettedUserType[]
 *   myBetState       UserType (partial)
 *   myInfo           UserType (partial)
 *   history          number[]
 *   previousHand     UserType[]
 *   finishGame       UserType (partial)
 *   getBetLimits     { max, min }
 *   error            { index, message }
 *   success          string
 */

import { Server as IOServer, Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { gameEngine, EngineState } from "../engine/GameEngine";
import User from "../models/User";
import Bet from "../models/Bet";
import Round from "../models/Round";
import { verifyToken } from "../middleware/auth";

const MIN_BET = Number(process.env.MIN_BET) || 1;
const MAX_BET = Number(process.env.MAX_BET) || 1000;

// ── Round record helpers ──────────────────────────────────────────────────────

/**
 * Round history used to emit `history` events (last 30 crash points).
 * This is kept in memory and seeded from the DB on startup.
 */
const crashHistory: number[] = [];

/** Map<roundId, Round document _id> so we don't re-create the Round row */
const activeRoundId = { current: 0 };

// ── gameState broadcaster ─────────────────────────────────────────────────────

function buildGameState(
  phase: "BET" | "PLAYING" | "GAMEEND",
  crashPoint: number,
  roundId: number,
  elapsed: number
): {
  currentNum: string;
  currentSecondNum: number;
  GameState: string;
  time: number;
} {
  // During PLAYING, reveal the crash point for the plane animation scaling.
  // During BET / GAMEEND expose it as the final crash value.
  return {
    currentNum: crashPoint.toFixed(2),
    currentSecondNum: roundId,
    GameState: phase,
    time: elapsed,
  };
}

// ── Attach handlers ───────────────────────────────────────────────────────────

export function attachSocketHandlers(io: IOServer): void {
  // ── Engine events → broadcast to all clients ──────────────────────────────

  gameEngine.on("phaseChanged", async (state: EngineState & { elapsed?: number }) => {
    const elapsed = state.elapsed ?? 0;

    if (state.phase === "BET") {
      // New round started — persist Round to DB
      activeRoundId.current = state.roundId;
      await Round.create({
        roundId: state.roundId,
        serverSeed: state.serverSeed,
        clientSeed: state.clientSeed,
        crashPoint: state.crashPoint,
        startedAt: new Date(),
        status: "active",
      }).catch(() => {
        // Round might already exist (engine restart); ignore duplicate key error
      });

      const gs = buildGameState("BET", state.crashPoint, state.roundId, 0);
      io.emit("gameState", gs);
      io.emit("bettedUserInfo", []);
    }

    if (state.phase === "PLAYING") {
      const gs = buildGameState(
        "PLAYING",
        state.crashPoint,
        state.roundId,
        0
      );
      io.emit("gameState", gs);
    }

    if (state.phase === "GAMEEND") {
      // Mark round as completed
      await Round.findOneAndUpdate(
        { roundId: state.roundId },
        { status: "completed", endedAt: new Date() }
      );

      crashHistory.unshift(state.crashPoint);
      if (crashHistory.length > 30) crashHistory.length = 30;

      const gs = buildGameState(
        "GAMEEND",
        state.crashPoint,
        state.roundId,
        elapsed
      );
      io.emit("gameState", gs);
      io.emit("history", [...crashHistory]);
    }
  });

  gameEngine.on(
    "tick",
    ({ multiplier, elapsed }: { multiplier: number; elapsed: number }) => {
      const state = gameEngine.getState();
      const gs = buildGameState(
        "PLAYING",
        state.crashPoint,
        state.roundId,
        elapsed
      );
      io.emit("gameState", gs);

      // Broadcast current betted users with live multiplier
      const activeBets = gameEngine.getActiveBets();
      const bettedUsers = activeBets.map((b) => ({
        name: b.userId,
        betAmount: b.betAmount,
        cashOut: b.cashedOut ? b.cashAmount : multiplier * b.betAmount,
        cashouted: b.cashedOut,
        target: b.target,
        img: "",
      }));
      io.emit("bettedUserInfo", bettedUsers);
    }
  );

  gameEngine.on(
    "cashout",
    async (data: {
      userId: string;
      slot: "f" | "s";
      betAmount: number;
      cashAmount: number;
      multiplier: number;
    }) => {
      // Credit winnings to user balance
      await User.findOneAndUpdate(
        { userId: data.userId },
        { $inc: { balance: data.cashAmount } }
      );

      // Update the Bet document
      await Bet.findOneAndUpdate(
        {
          userId: data.userId,
          roundId: gameEngine.getState().roundId,
          slot: data.slot,
        },
        { cashedOut: true, cashoutAt: data.multiplier, cashAmount: data.cashAmount }
      );
    }
  );

  gameEngine.on(
    "betLost",
    async (bet: { userId: string; slot: "f" | "s"; betAmount: number }) => {
      await Bet.findOneAndUpdate(
        {
          userId: bet.userId,
          roundId: gameEngine.getState().roundId,
          slot: bet.slot,
        },
        {
          cashedOut: false,
          flyAway: gameEngine.getState().crashPoint,
        }
      );
    }
  );

  // ── Per-socket connection ──────────────────────────────────────────────────

  io.on("connection", (socket: Socket) => {
    let authenticatedUserId: string | null = null;
    let authenticatedUserName: string | null = null;

    // Send bet limits immediately on connect
    socket.emit("getBetLimits", { max: MAX_BET, min: MIN_BET });

    // Send current game state so the client can sync mid-round
    const engineState = gameEngine.getState();
    const elapsed = gameEngine.getElapsedMs();
    socket.emit(
      "gameState",
      buildGameState(
        engineState.phase,
        engineState.crashPoint,
        engineState.roundId,
        elapsed
      )
    );

    // Send history
    if (crashHistory.length > 0) {
      socket.emit("history", [...crashHistory]);
    }

    // ── enterRoom ────────────────────────────────────────────────────────────
    socket.on("enterRoom", async ({ token }: { token?: string }) => {
      if (!token) {
        socket.emit("error", { message: "Authentication token required" });
        return;
      }

      const payload = verifyToken(token);
      if (!payload) {
        socket.emit("error", { message: "Invalid or expired token" });
        return;
      }

      authenticatedUserId = payload.userId;
      authenticatedUserName = payload.userName;

      const user = await User.findOne({ userId: payload.userId }).lean();
      if (!user) {
        socket.emit("error", { message: "User not found" });
        return;
      }

      // Send current user info
      socket.emit("myInfo", {
        balance: user.balance,
        userType: user.userType,
        userName: user.userName,
        currency: user.currency,
        avatar: user.avatar,
        userId: user.userId,
        platform: user.platform,
        ipAddress: socket.handshake.address,
        token,
        Session_Token: token,
        isSoundEnable: user.isSoundEnable,
        isMusicEnable: user.isMusicEnable,
        msgVisible: user.msgVisible,
        f: {
          auto: false, autocashout: false, betid: "0",
          betted: false, cashouted: false, cashAmount: 0, betAmount: 20, target: 2,
        },
        s: {
          auto: false, autocashout: false, betid: "0",
          betted: false, cashouted: false, cashAmount: 0, betAmount: 20, target: 2,
        },
      });

      // Send current betted users snapshot
      const activeBets = gameEngine.getActiveBets();
      const bettedUsers = activeBets.map((b) => ({
        name: b.userId,
        betAmount: b.betAmount,
        cashOut: 0,
        cashouted: b.cashedOut,
        target: b.target,
        img: "",
      }));
      socket.emit("bettedUserInfo", bettedUsers);
    });

    // ── playBet ───────────────────────────────────────────────────────────────
    socket.on(
      "playBet",
      async (data: {
        betAmount?: number;
        target?: number;
        type?: "f" | "s";
        auto?: boolean;
      }) => {
        if (!authenticatedUserId) {
          socket.emit("error", {
            index: data.type || "f",
            message: "Not authenticated",
          });
          return;
        }

        const { betAmount = 0, target = 0, type = "f" } = data;

        // Validate input
        if (betAmount < MIN_BET || betAmount > MAX_BET) {
          socket.emit("error", {
            index: type,
            message: `Bet must be between ${MIN_BET} and ${MAX_BET}`,
          });
          return;
        }

        // Check user balance
        const user = await User.findOne({ userId: authenticatedUserId });
        if (!user) {
          socket.emit("error", { index: type, message: "User not found" });
          return;
        }
        if (user.balance < betAmount) {
          socket.emit("error", {
            index: type,
            message: "Insufficient balance",
          });
          return;
        }

        // Register bet in engine
        const placed = gameEngine.placeBet(
          authenticatedUserId,
          type,
          betAmount,
          target
        );
        if (!placed) {
          socket.emit("error", {
            index: type,
            message: "Cannot place bet now — game is not in BET phase or slot taken",
          });
          return;
        }

        // Deduct balance
        user.balance -= betAmount;
        await user.save();

        // Persist Bet to DB
        const roundId = gameEngine.getState().roundId;
        await Bet.create({
          betId: uuidv4(),
          userId: authenticatedUserId,
          userName: authenticatedUserName || authenticatedUserId,
          roundId,
          slot: type,
          betAmount,
          target,
          flyDetailID: roundId,
        });

        // Acknowledge
        socket.emit("myBetState", {
          balance: user.balance,
          f:
            type === "f"
              ? { betted: true, betAmount, target }
              : undefined,
          s:
            type === "s"
              ? { betted: true, betAmount, target }
              : undefined,
        });
        socket.emit("success", `Bet of ${betAmount} placed successfully`);

        // Broadcast updated betted users to everyone
        const activeBets = gameEngine.getActiveBets();
        const bettedUsers = activeBets.map((b) => ({
          name: b.userId,
          betAmount: b.betAmount,
          cashOut: 0,
          cashouted: b.cashedOut,
          target: b.target,
          img: "",
        }));
        io.emit("bettedUserInfo", bettedUsers);
      }
    );

    // ── cashOut ────────────────────────────────────────────────────────────────
    socket.on(
      "cashOut",
      async (data: { type?: "f" | "s"; endTarget?: number }) => {
        if (!authenticatedUserId) {
          socket.emit("error", {
            index: data.type || "f",
            message: "Not authenticated",
          });
          return;
        }

        const { type = "f", endTarget = 0 } = data;

        const result = gameEngine.cashOut(
          authenticatedUserId,
          type,
          endTarget
        );

        if (!result.success) {
          socket.emit("error", {
            index: type,
            message: result.reason || "Cashout failed",
          });
          return;
        }

        // Balance update is handled via the engine "cashout" event listener above.
        // Refetch fresh balance to emit to this client.
        const user = await User.findOne({ userId: authenticatedUserId }).lean();
        const newBalance = user ? user.balance : 0;

        socket.emit("finishGame", {
          balance: newBalance + (result.cashAmount || 0),
          f:
            type === "f"
              ? {
                  betted: false,
                  cashouted: true,
                  cashAmount: result.cashAmount,
                  betAmount: 0,
                  auto: false,
                }
              : { betted: false, cashouted: false, cashAmount: 0, betAmount: 0, auto: false },
          s:
            type === "s"
              ? {
                  betted: false,
                  cashouted: true,
                  cashAmount: result.cashAmount,
                  betAmount: 0,
                  auto: false,
                }
              : { betted: false, cashouted: false, cashAmount: 0, betAmount: 0, auto: false },
        });

        socket.emit(
          "success",
          `Cashed out at ${result.multiplier?.toFixed(2)}× — won ${result.cashAmount?.toFixed(2)}`
        );
      }
    );

    // ── disconnect ─────────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      // Nothing to clean up — bets persist in the engine until the round ends
    });
  });
}

/**
 * Seed in-memory history from the database on server startup.
 */
export async function seedHistory(): Promise<void> {
  const rounds = await Round.find({ status: "completed" })
    .sort({ roundId: -1 })
    .limit(30)
    .lean();
  crashHistory.length = 0;
  for (const r of rounds) {
    crashHistory.push(r.crashPoint);
  }
}
