import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { authMiddleware } from "../middleware/auth";
import User from "../models/User";
import Transaction from "../models/Transaction";
import {
  initiateDeposit,
  initiateWithdrawal,
  verifyWebhookSignature,
  LipanaWebhookPayload,
} from "../services/lipana";

const router = Router();

const FRONTEND_URL =
  process.env.FRONTEND_URL || "http://localhost:3000";

// ── POST /api/payment/deposit ─────────────────────────────────────────────────
/**
 * Initiate a deposit via lipana.dev STK Push.
 * The balance is NOT updated here — it is updated only when the webhook confirms.
 */
router.post(
  "/deposit",
  authMiddleware,
  async (req: Request, res: Response) => {
    const { amount, phoneNumber } = req.body as {
      amount?: number;
      phoneNumber?: string;
    };

    if (!amount || amount <= 0) {
      res.status(400).json({ error: "Invalid amount" });
      return;
    }
    if (!phoneNumber) {
      res.status(400).json({ error: "phoneNumber is required" });
      return;
    }

    const user = await User.findOne({ userId: req.user!.userId });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const transactionId = uuidv4();
    const callbackUrl = `${FRONTEND_URL}/api/payment/webhook`;

    const transaction = await Transaction.create({
      transactionId,
      userId: user.userId,
      type: "deposit",
      amount,
      currency: user.currency,
      status: "pending",
      phoneNumber,
    });

    const lipanaRes = await initiateDeposit({
      transactionId,
      phoneNumber,
      amount,
      currency: user.currency,
      userId: user.userId,
      callbackUrl,
    });

    if (!lipanaRes.success) {
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: "failed",
      });
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
);

// ── POST /api/payment/withdraw ────────────────────────────────────────────────
/**
 * Initiate a withdrawal via lipana.dev B2C.
 * The balance is deducted immediately (reserved); it is restored if the webhook
 * reports failure.
 */
router.post(
  "/withdraw",
  authMiddleware,
  async (req: Request, res: Response) => {
    const { amount, phoneNumber } = req.body as {
      amount?: number;
      phoneNumber?: string;
    };

    if (!amount || amount <= 0) {
      res.status(400).json({ error: "Invalid amount" });
      return;
    }
    if (!phoneNumber) {
      res.status(400).json({ error: "phoneNumber is required" });
      return;
    }

    const user = await User.findOne({ userId: req.user!.userId });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.balance < amount) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    // Reserve the funds before the external call
    user.balance -= amount;
    await user.save();

    const transactionId = uuidv4();
    const callbackUrl = `${FRONTEND_URL}/api/payment/webhook`;

    const transaction = await Transaction.create({
      transactionId,
      userId: user.userId,
      type: "withdrawal",
      amount,
      currency: user.currency,
      status: "pending",
      phoneNumber,
    });

    const lipanaRes = await initiateWithdrawal({
      transactionId,
      phoneNumber,
      amount,
      currency: user.currency,
      userId: user.userId,
      callbackUrl,
    });

    if (!lipanaRes.success) {
      // Restore balance on failure
      user.balance += amount;
      await user.save();
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: "failed",
      });
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
);

// ── POST /api/payment/webhook ─────────────────────────────────────────────────
/**
 * Lipana.dev webhook listener.
 *
 * Security:
 *   1. Signature verified with HMAC-SHA256 using LIPANA_WEBHOOK_SECRET.
 *   2. Idempotent: duplicate webhooks for the same transactionId are ignored.
 *   3. Balance is only updated for verified SUCCESS callbacks.
 */
router.post("/webhook", async (req: Request, res: Response) => {
  const signature = req.headers["x-lipana-signature"] as string | undefined;

  if (!signature) {
    res.status(400).json({ error: "Missing signature header" });
    return;
  }

  // req.body is the parsed JSON — we need the raw body for HMAC verification.
  // The raw body is attached by the express.json() rawBody option in index.ts.
  const rawBody: string = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

  if (!verifyWebhookSignature(rawBody, signature)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const payload = req.body as LipanaWebhookPayload;

  const transaction = await Transaction.findOne({
    transactionId: payload.transactionId,
  });

  if (!transaction) {
    // Unknown transaction — acknowledge to stop retries
    res.json({ received: true });
    return;
  }

  // Idempotency: already processed
  if (transaction.status !== "pending") {
    res.json({ received: true });
    return;
  }

  if (payload.status === "SUCCESS") {
    transaction.status = "completed";
    transaction.lipanaReference = payload.reference;
    await transaction.save();

    if (transaction.type === "deposit") {
      await User.findOneAndUpdate(
        { userId: transaction.userId },
        { $inc: { balance: transaction.amount } }
      );
    }
    // Withdrawal: balance was already deducted on initiation; nothing more to do.
  } else if (payload.status === "FAILED") {
    transaction.status = "failed";
    await transaction.save();

    if (transaction.type === "withdrawal") {
      // Restore the reserved balance
      await User.findOneAndUpdate(
        { userId: transaction.userId },
        { $inc: { balance: transaction.amount } }
      );
    }
  }

  res.json({ received: true });
});

export default router;
