/**
 * MockContext – provides game state from the local MockGameEngine to all
 * components, replacing the socket.io-based Context for the frontend-only build.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  sharedEngine,
  GameState,
  GamePhase,
} from "./engine/mockGameEngine";

// ─── Bet slot ─────────────────────────────────────────────────────────────────
export interface BetSlot {
  betAmount: number;
  /** 0 means "no auto cash-out" */
  autoCashoutAt: number;
  betted: boolean;
  cashedOut: boolean;
  cashoutMultiplier: number;
}

// ─── Mock player for the Live Feed ───────────────────────────────────────────
export interface MockPlayer {
  id: string;
  name: string;
  avatar: string;
  betAmount: number;
  /** null while still flying */
  cashoutAt: number | null;
  cashedOut: boolean;
}

// ─── Context shape ────────────────────────────────────────────────────────────
export interface MockContextType {
  // engine state
  phase: GamePhase;
  multiplier: number;
  crashPoint: number;
  waitCountdown: number;
  elapsedMs: number;
  history: number[];

  // player wallet
  balance: number;

  // betting – two slots (primary "f" and secondary "s")
  betSlotF: BetSlot;
  betSlotS: BetSlot;
  placeBet(slot: "f" | "s"): void;
  cancelBet(slot: "f" | "s"): void;
  cashOut(slot: "f" | "s"): void;
  updateBetSlot(slot: "f" | "s", patch: Partial<BetSlot>): void;

  // live feed
  mockPlayers: MockPlayer[];
}

// ─── Defaults ─────────────────────────────────────────────────────────────────
const defaultSlot: BetSlot = {
  betAmount: 20,
  autoCashoutAt: 0,
  betted: false,
  cashedOut: false,
  cashoutMultiplier: 0,
};

const MockCtx = createContext<MockContextType>(null!);

export const useMockContext = () => useContext(MockCtx);

// ─── Mock player generator ────────────────────────────────────────────────────
const PLAYER_NAMES = [
  "AceFlyer", "StarBet", "Neon_X", "CrashPro", "LuckyWing",
  "SkyKing", "NightOwl", "BlazeR", "VortexK", "SolarBet",
  "IronFly", "CryptoAce", "ZeroCool", "ThunderG", "PilotX",
  "DarkWave", "FlyHigh", "SpeedBet", "NovaStar", "RocketMan",
];

let playerIdCounter = 0;

function makeMockPlayer(betAmount: number): MockPlayer {
  const idx = Math.floor(Math.random() * PLAYER_NAMES.length);
  const avatarNum = Math.floor(Math.random() * 20) + 1;
  return {
    id: `mock_${++playerIdCounter}`,
    name: PLAYER_NAMES[idx],
    avatar: `/avatars/av-${avatarNum}.png`,
    betAmount,
    cashoutAt: null,
    cashedOut: false,
  };
}

/** Probability per 50 ms tick that a mock player cashes out while the round is flying */
const MOCK_PLAYER_CASHOUT_PROBABILITY = 0.03;

// ─── Provider ─────────────────────────────────────────────────────────────────
export const MockProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [gameState, setGameState] = useState<GameState>(
    sharedEngine.getState()
  );
  const [balance, setBalance] = useState(10_000);
  const [betSlotF, setBetSlotF] = useState<BetSlot>({ ...defaultSlot });
  const [betSlotS, setBetSlotS] = useState<BetSlot>({ ...defaultSlot });
  const [mockPlayers, setMockPlayers] = useState<MockPlayer[]>([]);

  // Keep refs for access inside event callbacks without stale closures
  const betFRef = useRef(betSlotF);
  betFRef.current = betSlotF;
  const betSRef = useRef(betSlotS);
  betSRef.current = betSlotS;
  const balanceRef = useRef(balance);
  balanceRef.current = balance;

  // ── Subscribe to engine ────────────────────────────────────────────────────
  useEffect(() => {
    sharedEngine.start();
    const unsub = sharedEngine.subscribe((snap) => {
      setGameState(snap);
    });
    return () => {
      unsub();
    };
  }, []);

  // ── React to phase transitions ─────────────────────────────────────────────
  const prevPhaseRef = useRef<GamePhase | null>(null);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const cur = gameState.phase;

    if (prev === cur) return;
    prevPhaseRef.current = cur;

    // New round starts – spawn mock players during WAITING
    if (cur === "WAITING_FOR_BETS") {
      const count = Math.floor(Math.random() * 8) + 4;
      const players: MockPlayer[] = Array.from({ length: count }, () =>
        makeMockPlayer(Math.floor(Math.random() * 490) + 10)
      );
      setMockPlayers(players);

      // Reset player bet slots
      setBetSlotF((prev) =>
        prev.betted ? { ...prev, betted: false, cashedOut: false, cashoutMultiplier: 0 } : prev
      );
      setBetSlotS((prev) =>
        prev.betted ? { ...prev, betted: false, cashedOut: false, cashoutMultiplier: 0 } : prev
      );
    }

    // Round flying – auto cash-out checks happen per-tick via separate effect
    if (cur === "CRASHED") {
      // Any still-betted slot loses
      setBetSlotF((prev) => {
        if (prev.betted && !prev.cashedOut) {
          return { ...prev, betted: false, cashedOut: false, cashoutMultiplier: 0 };
        }
        return prev;
      });
      setBetSlotS((prev) => {
        if (prev.betted && !prev.cashedOut) {
          return { ...prev, betted: false, cashedOut: false, cashoutMultiplier: 0 };
        }
        return prev;
      });

      // Randomly cash out some mock players that haven't yet
      setMockPlayers((prev) =>
        prev.map((p) =>
          !p.cashedOut
            ? {
                ...p,
                cashedOut: true,
                cashoutAt: null, // crashed, no payout
              }
            : p
        )
      );
    }
  }, [gameState.phase]);

  // ── Per-tick: auto cash-out + mock players cashing out ────────────────────
  useEffect(() => {
    if (gameState.phase !== "FLYING") return;
    const m = gameState.multiplier;

    // Player auto cash-out
    const fSlot = betFRef.current;
    if (
      fSlot.betted &&
      !fSlot.cashedOut &&
      fSlot.autoCashoutAt > 1 &&
      m >= fSlot.autoCashoutAt
    ) {
      executeCashout("f", m);
    }
    const sSlot = betSRef.current;
    if (
      sSlot.betted &&
      !sSlot.cashedOut &&
      sSlot.autoCashoutAt > 1 &&
      m >= sSlot.autoCashoutAt
    ) {
      executeCashout("s", m);
    }

    // Mock players randomly cash out
    setMockPlayers((prev) =>
      prev.map((p) => {
        if (p.cashedOut) return p;
        // Each player has a ~3 % chance per tick of cashing out
        if (Math.random() < MOCK_PLAYER_CASHOUT_PROBABILITY) {
          return { ...p, cashedOut: true, cashoutAt: m };
        }
        return p;
      })
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.multiplier, gameState.phase]);

  // ── Cash-out helper ───────────────────────────────────────────────────────
  const executeCashout = (slot: "f" | "s", atMultiplier: number) => {
    const slotData = slot === "f" ? betFRef.current : betSRef.current;
    if (!slotData.betted || slotData.cashedOut) return;
    const winnings = slotData.betAmount * atMultiplier;
    setBalance((prev) => prev + winnings);
    const setter = slot === "f" ? setBetSlotF : setBetSlotS;
    setter((prev) => ({
      ...prev,
      cashedOut: true,
      cashoutMultiplier: atMultiplier,
    }));
  };

  // ── Public API ─────────────────────────────────────────────────────────────
  const placeBet = (slot: "f" | "s") => {
    if (gameState.phase !== "WAITING_FOR_BETS") return;
    const slotData = slot === "f" ? betFRef.current : betSRef.current;
    if (slotData.betted) return;
    if (balanceRef.current < slotData.betAmount) return;

    setBalance((prev) => prev - slotData.betAmount);
    const setter = slot === "f" ? setBetSlotF : setBetSlotS;
    setter((prev) => ({ ...prev, betted: true, cashedOut: false, cashoutMultiplier: 0 }));
  };

  const cancelBet = (slot: "f" | "s") => {
    if (gameState.phase !== "WAITING_FOR_BETS") return;
    const slotData = slot === "f" ? betFRef.current : betSRef.current;
    if (!slotData.betted) return;

    setBalance((prev) => prev + slotData.betAmount);
    const setter = slot === "f" ? setBetSlotF : setBetSlotS;
    setter((prev) => ({ ...prev, betted: false }));
  };

  const cashOut = (slot: "f" | "s") => {
    if (gameState.phase !== "FLYING") return;
    executeCashout(slot, gameState.multiplier);
  };

  const updateBetSlot = (slot: "f" | "s", patch: Partial<BetSlot>) => {
    const setter = slot === "f" ? setBetSlotF : setBetSlotS;
    setter((prev) => ({ ...prev, ...patch }));
  };

  return (
    <MockCtx.Provider
      value={{
        ...gameState,
        balance,
        betSlotF,
        betSlotS,
        placeBet,
        cancelBet,
        cashOut,
        updateBetSlot,
        mockPlayers,
      }}
    >
      {children}
    </MockCtx.Provider>
  );
};

export default MockCtx;
