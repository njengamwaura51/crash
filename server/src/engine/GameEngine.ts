/**
 * GameEngine – Authoritative server-side crash game engine.
 *
 * Manages the game loop:
 *   BET (waiting for bets) → PLAYING (multiplier ticking) → GAMEEND (crashed)
 *
 * Provably fair: crash point is derived from a pre-committed server seed hashed
 * with the round ID via HMAC-SHA256. The server seed is revealed on GAMEEND so
 * players can independently verify the crash point.
 *
 * Concurrency: cashout requests are protected by a per-bet lock set that
 * prevents duplicate processing within the same Node.js event loop.
 */

import crypto from "crypto";
import { EventEmitter } from "events";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GamePhase = "BET" | "PLAYING" | "GAMEEND";

export interface ActiveBet {
  userId: string;
  /** Socket slot: "f" (first) or "s" (second) */
  slot: "f" | "s";
  betAmount: number;
  /** Auto cash-out target (0 = manual only) */
  target: number;
  cashedOut: boolean;
  cashAmount: number;
  cashoutAt: number;
}

export interface EngineState {
  phase: GamePhase;
  roundId: number;
  /** Crash point multiplier, generated before PLAYING starts */
  crashPoint: number;
  /** Pre-committed HMAC key – revealed on GAMEEND for provably-fair verification */
  serverSeed: string;
  /** Public input to the HMAC (round ID as string) */
  clientSeed: string;
  /** Unix ms timestamp when the current phase started */
  phaseStartTime: number;
}

export interface CashoutResult {
  success: boolean;
  cashAmount?: number;
  multiplier?: number;
  reason?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WAIT_DURATION_MS = Number(process.env.BET_WAIT_DURATION_MS) || 5_000;
const GAMEEND_DISPLAY_MS = Number(process.env.GAMEEND_DISPLAY_MS) || 3_000;
const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS) || 100;

// ─── Provably-fair crash point ────────────────────────────────────────────────

/**
 * Derives a crash point from a server seed and round ID using HMAC-SHA256.
 *
 * House edge: 4 % (1 in 25 rounds is an instant crash at 1.00×).
 *
 * Formula: crashPoint = max(1, floor(99 × 2^32 / (2^32 − h)) / 100)
 *   where h = first 32 bits of HMAC(serverSeed, clientSeed).
 *
 * Players can verify by re-running this function with the revealed serverSeed
 * and the public clientSeed after the round ends.
 */
export function generateCrashPoint(
  serverSeed: string,
  clientSeed: string
): number {
  const hmac = crypto.createHmac("sha256", serverSeed);
  hmac.update(clientSeed);
  const hash = hmac.digest("hex");

  const h = parseInt(hash.slice(0, 8), 16); // first 32 bits

  // 4% instant-crash check
  if (h % 25 === 0) return 1.0;

  // Standard house-edge formula (same family as Spribe/BC.Game)
  const MAX_UINT32 = 0x100000000;
  const crashPoint = Math.floor((99 * MAX_UINT32) / (MAX_UINT32 - h)) / 100;
  return Math.min(Math.max(1.0, crashPoint), 200);
}

// ─── Multiplier formula ───────────────────────────────────────────────────────

/**
 * Returns the current multiplier at `elapsedMs` milliseconds into the PLAYING
 * phase.  This mirrors the formula already used in the frontend so both curves
 * are identical.
 */
export function multiplierAtTime(elapsedMs: number): number {
  const t = elapsedMs / 1000;
  const v =
    1 +
    0.06 * t +
    Math.pow(0.06 * t, 2) -
    Math.pow(0.04 * t, 3) +
    Math.pow(0.04 * t, 4);
  return Math.max(1, v);
}

// ─── Game Engine ─────────────────────────────────────────────────────────────

export class GameEngine extends EventEmitter {
  private state!: EngineState;

  /** Active bets for the current round. Key = `${userId}:${slot}` */
  private activeBets = new Map<string, ActiveBet>();

  /** Lock set – prevents duplicate cashout processing. Key = `${userId}:${slot}` */
  private cashoutLocks = new Set<string>();

  /** In-memory round counter – replaced by the DB round ID in production. */
  private roundCounter = 0;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.setMaxListeners(0); // allow many socket listeners
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.tickTimer !== null || this.phaseTimer !== null) return;
    this.enterBet();
  }

  getState(): Readonly<EngineState> {
    return { ...this.state };
  }

  getActiveBets(): ActiveBet[] {
    return Array.from(this.activeBets.values());
  }

  getCurrentMultiplier(): number {
    if (this.state.phase !== "PLAYING") return 1;
    return multiplierAtTime(Date.now() - this.state.phaseStartTime);
  }

  getElapsedMs(): number {
    return Date.now() - this.state.phaseStartTime;
  }

  /**
   * Register a bet for the current BET phase.
   * Returns false if the phase is wrong or the slot is already taken.
   */
  placeBet(
    userId: string,
    slot: "f" | "s",
    betAmount: number,
    target: number
  ): boolean {
    if (this.state.phase !== "BET") return false;
    const key = `${userId}:${slot}`;
    if (this.activeBets.has(key)) return false;

    this.activeBets.set(key, {
      userId,
      slot,
      betAmount,
      target,
      cashedOut: false,
      cashAmount: 0,
      cashoutAt: 0,
    });
    return true;
  }

  /**
   * Cancel a bet during the BET phase.
   */
  cancelBet(userId: string, slot: "f" | "s"): boolean {
    if (this.state.phase !== "BET") return false;
    const key = `${userId}:${slot}`;
    if (!this.activeBets.has(key)) return false;
    this.activeBets.delete(key);
    return true;
  }

  /**
   * Cash out a bet.  The server verifies the current multiplier server-side;
   * the `requestedMultiplier` from the client is ignored (only used for logging).
   *
   * Race-condition guard: a per-key lock prevents the same bet being cashed out
   * twice even if two events arrive before the first resolves.
   */
  cashOut(
    userId: string,
    slot: "f" | "s",
    _requestedMultiplier?: number
  ): CashoutResult {
    if (this.state.phase !== "PLAYING") {
      return { success: false, reason: "Game is not in PLAYING phase" };
    }

    const key = `${userId}:${slot}`;

    // Lock guard
    if (this.cashoutLocks.has(key)) {
      return { success: false, reason: "Cashout already in progress" };
    }
    this.cashoutLocks.add(key);

    const bet = this.activeBets.get(key);
    if (!bet || bet.cashedOut) {
      this.cashoutLocks.delete(key);
      return { success: false, reason: "No active bet for this slot" };
    }

    // Use authoritative server-side multiplier at the moment of the request
    const elapsed = Date.now() - this.state.phaseStartTime;
    const multiplier = multiplierAtTime(elapsed);

    if (multiplier >= this.state.crashPoint) {
      this.cashoutLocks.delete(key);
      return { success: false, reason: "Game already crashed" };
    }

    return this.processCashout(userId, slot, multiplier);
  }

  // ── Phase transitions ──────────────────────────────────────────────────────

  private enterBet(): void {
    this.clearTimers();
    this.activeBets.clear();
    this.cashoutLocks.clear();

    this.roundCounter += 1;
    const serverSeed = crypto.randomBytes(32).toString("hex");
    const clientSeed = String(this.roundCounter);
    const crashPoint = generateCrashPoint(serverSeed, clientSeed);

    this.state = {
      phase: "BET",
      roundId: this.roundCounter,
      crashPoint,
      serverSeed,
      clientSeed,
      phaseStartTime: Date.now(),
    };

    this.emit("phaseChanged", { ...this.state });

    this.phaseTimer = setTimeout(() => this.enterPlaying(), WAIT_DURATION_MS);
  }

  private enterPlaying(): void {
    this.clearTimers();

    this.state = {
      ...this.state,
      phase: "PLAYING",
      phaseStartTime: Date.now(),
    };

    this.emit("phaseChanged", { ...this.state });

    this.tickTimer = setInterval(() => {
      const elapsed = Date.now() - this.state.phaseStartTime;
      const multiplier = multiplierAtTime(elapsed);

      // Auto cash-out any bets whose target has been reached
      this.activeBets.forEach((bet) => {
        if (
          !bet.cashedOut &&
          bet.target > 1.01 &&
          multiplier >= bet.target &&
          multiplier < this.state.crashPoint
        ) {
          this.processCashout(bet.userId, bet.slot, multiplier);
        }
      });

      if (multiplier >= this.state.crashPoint) {
        this.enterGameEnd();
      } else {
        this.emit("tick", { multiplier, elapsed });
      }
    }, TICK_INTERVAL_MS);
  }

  private enterGameEnd(): void {
    this.clearTimers();

    const elapsed = Date.now() - this.state.phaseStartTime;

    this.state = {
      ...this.state,
      phase: "GAMEEND",
      phaseStartTime: Date.now(),
    };

    this.emit("phaseChanged", { ...this.state, elapsed });

    // Mark all remaining un-cashed bets as lost
    this.activeBets.forEach((bet) => {
      if (!bet.cashedOut) {
        this.emit("betLost", { ...bet });
      }
    });

    this.phaseTimer = setTimeout(
      () => this.enterBet(),
      GAMEEND_DISPLAY_MS
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private processCashout(
    userId: string,
    slot: "f" | "s",
    multiplier: number
  ): CashoutResult {
    const key = `${userId}:${slot}`;
    const bet = this.activeBets.get(key);
    if (!bet || bet.cashedOut) {
      this.cashoutLocks.delete(key);
      return { success: false, reason: "Bet already processed" };
    }

    const cashAmount = Math.round(bet.betAmount * multiplier * 100) / 100;
    bet.cashedOut = true;
    bet.cashAmount = cashAmount;
    bet.cashoutAt = multiplier;

    this.emit("cashout", {
      userId,
      slot,
      betAmount: bet.betAmount,
      cashAmount,
      multiplier,
    });

    this.cashoutLocks.delete(key);
    return { success: true, cashAmount, multiplier };
  }

  private clearTimers(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.phaseTimer !== null) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }
}

/** Singleton game engine shared across the process */
export const gameEngine = new GameEngine();
