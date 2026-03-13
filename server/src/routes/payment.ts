import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middleware/auth";
import {
  depositHandler,
  withdrawHandler,
  webhookHandler,
  transactionHistoryHandler,
} from "../controllers/paymentController";

const router = Router();

/** Tighter rate limit for payment-mutating endpoints (10 requests / minute). */
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payment requests. Please wait before retrying." },
});

// ── POST /api/payment/deposit ─────────────────────────────────────────────────
router.post("/deposit", paymentLimiter, authMiddleware, depositHandler);

// ── POST /api/payment/withdraw ────────────────────────────────────────────────
router.post("/withdraw", paymentLimiter, authMiddleware, withdrawHandler);

// ── POST /api/payment/webhook ─────────────────────────────────────────────────
// No auth middleware — lipana.dev calls this endpoint directly.
// Security is provided by HMAC-SHA256 signature verification inside the handler.
router.post("/webhook", webhookHandler);

// ── GET /api/payment/transactions ────────────────────────────────────────────
router.get("/transactions", authMiddleware, transactionHistoryHandler);

export default router;
