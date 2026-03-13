/**
 * paymentController – Handlers for deposit, withdrawal, and the lipana.dev
 * webhook.
 *
 * Design decisions:
 *
 * Deposit:  Balance is NOT updated here.  It is only updated when the
 *           lipana.dev webhook delivers a confirmed SUCCESS callback.
 *
 * Withdrawal: The user's balance is reserved (atomically deducted) before
 *             the external API call.  If the call fails synchronously, the
 *             balance is restored immediately.  If lipana sends a FAILED
 *             webhook later, the balance is restored then.
 *
 * Webhook:  Three security layers:
 *           1. HMAC-SHA256 signature verified against the raw request body.
 *           2. The raw body MUST be present (the express.json() `verify`
 *              callback in index.ts attaches it).  If it is missing the
 *              request is rejected — we never fall back to JSON.stringify.
 *           3. Idempotency: if the transaction is not in "pending" state,
 *              the webhook is acknowledged immediately without re-processing.
 */

import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import User from "../models/User";
import Transaction from "../models/Transaction";
import {
  initiateDeposit,
  initiateWithdrawal,
  verifyWebhookSignature,
  LipanaWebhookPayload,
} from "../services/lipana";
import { atomicDeductBalance, atomicRestoreBalance, atomicCreditBalance } from "./gameController";

// The base URL of *this server* (not the frontend) used for lipana callbacks.
const SERVER_BASE_URL =
  process.env.SERVER_BASE_URL ||
  process.env.FRONTEND_URL ||
  "http://localhost:5000";

// ── Deposit ────────────────────────────────────────────────────────────────────

export async function depositHandler(req: Request, res: Response): Promise<void> {
  const { amount, phoneNumber } = req.body as {
    amount?: number;
    phoneNumber?: string;
  };

  if (!amount || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  if (!phoneNumber) {
    res.status(400).json({ error: "phoneNumber is required" });
    return;
  }

  const user = await User.findOne({ userId: req.user!.userId }).lean();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const transactionId = uuidv4();
  const callbackUrl = `${SERVER_BASE_URL}/api/payment/webhook`;

  // Create a pending transaction record before calling the external API
  const transaction = await Transaction.create({
    transactionId,
    userId: user.userId,
    type: "deposit",
    amount,
    currency: user.currency,
    status: "pending",
    phoneNumber,
  });

  let lipanaRes;
  try {
    lipanaRes = await initiateDeposit({
      transactionId,
      phoneNumber,
      amount,
      currency: user.currency,
      userId: user.userId,
      callbackUrl,
    });
  } catch (err) {
    await Transaction.findByIdAndUpdate(transaction._id, { status: "failed" });
    res.status(502).json({ error: "Payment gateway unreachable" });
    return;
  }

  if (!lipanaRes.success) {
    await Transaction.findByIdAndUpdate(transaction._id, { status: "failed" });
    res.status(502).json({ error: lipanaRes.message || "Payment initiation failed" });
    return;
  }

  await Transaction.findByIdAndUpdate(transaction._id, {
    lipanaReference: lipanaRes.reference || "",
  });

  res.json({
    status: true,
    message: "Deposit initiated. Complete the payment prompt on your phone.",
    transactionId,
    reference: lipanaRes.reference,
  });
}

// ── Withdrawal ─────────────────────────────────────────────────────────────────

export async function withdrawHandler(req: Request, res: Response): Promise<void> {
  const { amount, phoneNumber } = req.body as {
    amount?: number;
    phoneNumber?: string;
  };

  if (!amount || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }
  if (!phoneNumber) {
    res.status(400).json({ error: "phoneNumber is required" });
    return;
  }

  // Atomically reserve the funds — fails if balance is insufficient
  const deduct = await atomicDeductBalance(req.user!.userId, amount);
  if (!deduct.success) {
    if (deduct.reason === "user_not_found") {
      res.status(404).json({ error: "User not found" });
    } else {
      res.status(400).json({ error: "Insufficient balance" });
    }
    return;
  }

  const user = deduct.user!;
  const transactionId = uuidv4();
  const callbackUrl = `${SERVER_BASE_URL}/api/payment/webhook`;

  const transaction = await Transaction.create({
    transactionId,
    userId: user.userId,
    type: "withdrawal",
    amount,
    currency: user.currency,
    status: "pending",
    phoneNumber,
  });

  let lipanaRes;
  try {
    lipanaRes = await initiateWithdrawal({
      transactionId,
      phoneNumber,
      amount,
      currency: user.currency,
      userId: user.userId,
      callbackUrl,
    });
  } catch {
    // Restore balance and mark failed on gateway error
    await atomicRestoreBalance(user.userId, amount);
    await Transaction.findByIdAndUpdate(transaction._id, { status: "failed" });
    res.status(502).json({ error: "Payment gateway unreachable" });
    return;
  }

  if (!lipanaRes.success) {
    await atomicRestoreBalance(user.userId, amount);
    await Transaction.findByIdAndUpdate(transaction._id, { status: "failed" });
    res.status(502).json({ error: lipanaRes.message || "Withdrawal initiation failed" });
    return;
  }

  await Transaction.findByIdAndUpdate(transaction._id, {
    lipanaReference: lipanaRes.reference || "",
  });

  res.json({
    status: true,
    message: "Withdrawal initiated.",
    transactionId,
    reference: lipanaRes.reference,
    newBalance: user.balance,
  });
}

// ── Webhook ────────────────────────────────────────────────────────────────────

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers["x-lipana-signature"] as string | undefined;

  if (!signature) {
    res.status(400).json({ error: "Missing x-lipana-signature header" });
    return;
  }

  // Require the raw body captured by the express.json() verify callback.
  // We NEVER fall back to JSON.stringify — that would bypass signature security.
  const rawBody: string | undefined = (
    req as unknown as { rawBody?: string }
  ).rawBody;

  if (!rawBody) {
    res.status(400).json({ error: "Raw body unavailable; cannot verify signature" });
    return;
  }

  let signatureValid: boolean;
  try {
    signatureValid = verifyWebhookSignature(rawBody, signature);
  } catch {
    // e.g. signature was not valid hex
    signatureValid = false;
  }

  if (!signatureValid) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const payload = req.body as LipanaWebhookPayload;

  // Basic payload validation
  if (!payload.transactionId || !payload.status) {
    res.status(400).json({ error: "Malformed webhook payload" });
    return;
  }

  const transaction = await Transaction.findOne({
    transactionId: payload.transactionId,
  });

  if (!transaction) {
    // Unknown transaction — acknowledge to stop lipana retries
    res.json({ received: true });
    return;
  }

  // Idempotency guard — already processed
  if (transaction.status !== "pending") {
    res.json({ received: true });
    return;
  }

  if (payload.status === "SUCCESS") {
    transaction.status = "completed";
    transaction.lipanaReference = payload.reference;
    await transaction.save();

    if (transaction.type === "deposit") {
      // Only credit balance for confirmed deposits
      await atomicCreditBalance(transaction.userId, transaction.amount);
    }
    // Withdrawal: balance was already deducted when the withdrawal was initiated.
    // Nothing further to do on SUCCESS.
  } else if (payload.status === "FAILED") {
    transaction.status = "failed";
    await transaction.save();

    if (transaction.type === "withdrawal") {
      // Restore the reserved balance for a failed withdrawal
      await atomicRestoreBalance(transaction.userId, transaction.amount);
    }
  }
  // PENDING status: no state change — lipana may send another callback later.

  res.json({ received: true });
}

// ── Transaction history ─────────────────────────────────────────────────────

export async function transactionHistoryHandler(
  req: Request,
  res: Response
): Promise<void> {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    Transaction.find({ userId: req.user!.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments({ userId: req.user!.userId }),
  ]);

  res.json({
    status: true,
    data: transactions,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
