/**
 * Mock Game Engine – Crash Game State Machine
 *
 * States:
 *   WAITING_FOR_BETS  – countdown before round starts
 *   TAKING_OFF        – short launch animation
 *   FLYING            – multiplier ticking upward
 *   CRASHED           – round ended, show final multiplier
 */

export type GamePhase =
  | "WAITING_FOR_BETS"
  | "TAKING_OFF"
  | "FLYING"
  | "CRASHED";

export interface GameState {
  phase: GamePhase;
  multiplier: number;
  crashPoint: number;
  /** ms remaining in the WAITING_FOR_BETS countdown */
  waitCountdown: number;
  /** elapsed ms since the round started flying */
  elapsedMs: number;
  history: number[];
}

export type GameStateListener = (state: GameState) => void;

// ─── Tunable constants ────────────────────────────────────────────────────────
const WAIT_DURATION_MS = 5_000;
const TAKEOFF_DURATION_MS = 1_000;
const TICK_INTERVAL_MS = 50; // ~20 fps

// ─── Crash-point generator ────────────────────────────────────────────────────
/**
 * Returns a random crash point >= 1.00.
 * Uses a house-edge formula similar to the Spribe Aviator model:
 *   crashPoint = HOUSE_EDGE_MULTIPLIER / (1 - r)   where r ~ Uniform(0, 1)
 * with a 1 % chance of instant crash at 1.00x.
 *
 * HOUSE_EDGE_MULTIPLIER = 0.99 represents a 1 % house edge.
 */
const HOUSE_EDGE_MULTIPLIER = 0.99;
export function generateCrashPoint(): number {
  if (Math.random() < 0.01) return 1.0;
  const r = Math.random();
  const raw = HOUSE_EDGE_MULTIPLIER / (1 - r);
  // Cap at a sane maximum and round to 2 dp
  return Math.min(Math.round(raw * 100) / 100, 200);
}

// ─── Multiplier formula ───────────────────────────────────────────────────────
/**
 * Mirrors the existing game formula from Crash/index.tsx so the curve feels
 * the same but is now driven by the mock engine.
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

// ─── Engine class ─────────────────────────────────────────────────────────────
export class MockGameEngine {
  private listeners: Set<GameStateListener> = new Set();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;

  private state: GameState = {
    phase: "WAITING_FOR_BETS",
    multiplier: 1,
    crashPoint: 2,
    waitCountdown: WAIT_DURATION_MS,
    elapsedMs: 0,
    history: [],
  };

  /** Register a listener that fires every tick with the latest state. */
  subscribe(listener: GameStateListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => this.listeners.delete(listener);
  }

  /** Start the engine loop (idempotent). */
  start(): void {
    if (this.tickTimer !== null) return;
    this.enterWaiting();
  }

  /** Stop all timers and reset. */
  stop(): void {
    this.clearTimers();
    this.state = {
      phase: "WAITING_FOR_BETS",
      multiplier: 1,
      crashPoint: 2,
      waitCountdown: WAIT_DURATION_MS,
      elapsedMs: 0,
      history: [],
    };
  }

  getState(): GameState {
    return { ...this.state };
  }

  // ── Phase transitions ────────────────────────────────────────────────────────

  private enterWaiting(): void {
    this.clearTimers();
    const crashPoint = generateCrashPoint();
    this.setState({
      phase: "WAITING_FOR_BETS",
      multiplier: 1,
      crashPoint,
      waitCountdown: WAIT_DURATION_MS,
      elapsedMs: 0,
    });

    const startedAt = Date.now();
    this.tickTimer = setInterval(() => {
      const remaining = WAIT_DURATION_MS - (Date.now() - startedAt);
      this.setState({ waitCountdown: Math.max(0, remaining) });
    }, TICK_INTERVAL_MS);

    this.phaseTimer = setTimeout(() => {
      this.enterTakeoff();
    }, WAIT_DURATION_MS);
  }

  private enterTakeoff(): void {
    this.clearTimers();
    this.setState({ phase: "TAKING_OFF", multiplier: 1, elapsedMs: 0 });

    this.phaseTimer = setTimeout(() => {
      this.enterFlying();
    }, TAKEOFF_DURATION_MS);
  }

  private enterFlying(): void {
    this.clearTimers();
    const flyStart = Date.now();

    this.setState({ phase: "FLYING", multiplier: 1, elapsedMs: 0 });

    this.tickTimer = setInterval(() => {
      const elapsed = Date.now() - flyStart;
      const m = multiplierAtTime(elapsed);

      if (m >= this.state.crashPoint) {
        this.enterCrashed(elapsed);
      } else {
        this.setState({ multiplier: m, elapsedMs: elapsed });
      }
    }, TICK_INTERVAL_MS);
  }

  private enterCrashed(elapsed: number): void {
    this.clearTimers();
    const finalMultiplier = this.state.crashPoint;
    const newHistory = [finalMultiplier, ...this.state.history].slice(0, 30);

    this.setState({
      phase: "CRASHED",
      multiplier: finalMultiplier,
      elapsedMs: elapsed,
      history: newHistory,
    });

    // Wait 3 s then start new round
    this.phaseTimer = setTimeout(() => {
      this.enterWaiting();
    }, 3_000);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private setState(partial: Partial<GameState>): void {
    this.state = { ...this.state, ...partial };
    const snapshot = { ...this.state };
    this.listeners.forEach((fn) => fn(snapshot));
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

export const sharedEngine = new MockGameEngine();
