/**
 * gameController – Authoritative, atomic database operations for game
 * transactions.
 *
 * Every balance mutation uses MongoDB's `findOneAndUpdate` with an inline
 * filter condition so the read-check and the write happen in a single
 * atomic database operation.  This eliminates the classic TOCTOU (time-of-
 * check / time-of-use) race condition that appears when you do:
 *
 *   const user = await User.findOne(...);   // read
 *   if (user.balance >= amount) { ... }    // check  ← window of vulnerability
 *   user.balance -= amount;                // use
 *   await user.save();                     // write
 *
 * Because `findOneAndUpdate` with a `{ balance: { $gte: amount } }` filter
 * is a single atomic write, two concurrent requests will never both pass the
 * balance check: only the first one that reaches MongoDB will match the
 * document and the second will find no matching document (balance already
 * decremented).
 *
 * Cashout idempotency works the same way: the Bet document is updated with
 * `{ cashedOut: false }` as a filter condition.  The balance is only credited
 * when the Bet update acknowledges a matched document, preventing double
 * credit even if the same cashout event fires twice.
 */

import { v4 as uuidv4 } from "uuid";
import User, { IUser } from "../models/User";
import Bet from "../models/Bet";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BetParams {
  userId: string;
  userName: string;
  roundId: number;
  slot: "f" | "s";
  betAmount: number;
  target: number;
}

export interface CashoutParams {
  userId: string;
  roundId: number;
  slot: "f" | "s";
  multiplier: number;
  cashAmount: number;
}

export interface DeductResult {
  success: boolean;
  /** Updated user after deduction — only set when success is true */
  user?: IUser;
  reason?: "user_not_found" | "insufficient_balance";
}

// ─── Balance operations ───────────────────────────────────────────────────────

/**
 * Atomically deduct `amount` from the user's balance.
 *
 * The deduction only succeeds if `user.balance >= amount` at write time.
 * Returns `{ success: false, reason: "insufficient_balance" }` when the
 * document was found but the balance was too low, and
 * `{ success: false, reason: "user_not_found" }` when the userId does not
 * exist.
 */
export async function atomicDeductBalance(
  userId: string,
  amount: number
): Promise<DeductResult> {
  const updated = await User.findOneAndUpdate(
    {
      userId,
      balance: { $gte: amount }, // ← atomic guard: only matches if balance is sufficient
    },
    { $inc: { balance: -amount } },
    { new: true }
  );

  if (updated) {
    return { success: true, user: updated };
  }

  // Distinguish "user not found" from "insufficient balance"
  const exists = await User.exists({ userId });
  return {
    success: false,
    reason: exists ? "insufficient_balance" : "user_not_found",
  };
}

/**
 * Atomically restore `amount` to the user's balance.
 * Used to roll back a deduction when a subsequent step fails.
 */
export async function atomicRestoreBalance(
  userId: string,
  amount: number
): Promise<void> {
  await User.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount } }
  );
}

/**
 * Atomically credit `amount` to the user's balance.
 * Used when a cashout is confirmed.
 */
export async function atomicCreditBalance(
  userId: string,
  amount: number
): Promise<void> {
  await User.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount } }
  );
}

// ─── Bet persistence ──────────────────────────────────────────────────────────

/**
 * Persists a new bet record to the database.
 * Must be called after `atomicDeductBalance` succeeds.
 */
export async function persistBet(params: BetParams): Promise<void> {
  await Bet.create({
    betId: uuidv4(),
    userId: params.userId,
    userName: params.userName,
    roundId: params.roundId,
    slot: params.slot,
    betAmount: params.betAmount,
    target: params.target,
    flyDetailID: params.roundId,
    cashedOut: false,
    cashAmount: 0,
    cashoutAt: 0,
    flyAway: 0,
  });
}

// ─── Cashout persistence ──────────────────────────────────────────────────────

/**
 * Atomically marks a bet as cashed out in the database and credits the
 * user's balance.
 *
 * The Bet document is updated with a `{ cashedOut: false }` filter so that
 * only the first call to this function for a given bet ever succeeds.
 * Subsequent calls (e.g. duplicate events) will find no matching document
 * and will NOT credit the balance a second time.
 *
 * Returns `true` if the cashout was recorded, `false` if the bet was already
 * cashed out or not found (idempotency guard fired).
 */
export async function atomicCashoutBet(
  params: CashoutParams
): Promise<boolean> {
  const updated = await Bet.findOneAndUpdate(
    {
      userId: params.userId,
      roundId: params.roundId,
      slot: params.slot,
      cashedOut: false, // ← atomic guard: prevents double-cashout
    },
    {
      cashedOut: true,
      cashoutAt: params.multiplier,
      cashAmount: params.cashAmount,
    }
  );

  if (!updated) {
    // Bet was already cashed out or not found — do NOT credit balance
    return false;
  }

  // Safe to credit — we own the exclusive update that flipped cashedOut to true
  await atomicCreditBalance(params.userId, params.cashAmount);
  return true;
}

/**
 * Marks a lost bet with the final crash point (flyAway).
 * Uses a `cashedOut: false` filter so already-cashed bets are not touched.
 */
export async function settleLostBet(
  userId: string,
  roundId: number,
  slot: "f" | "s",
  flyAway: number
): Promise<void> {
  await Bet.findOneAndUpdate(
    {
      userId,
      roundId,
      slot,
      cashedOut: false,
    },
    { flyAway }
  );
}
