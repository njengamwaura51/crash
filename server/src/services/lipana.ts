/**
 * Lipana.dev Payment Gateway Service
 *
 * Handles STK Push (M-Pesa style) deposits and B2C withdrawals via lipana.dev.
 * All API keys and secrets are loaded from environment variables — never hardcoded.
 *
 * Webhook signature verification uses HMAC-SHA256 with LIPANA_WEBHOOK_SECRET.
 */

import axios from "axios";
import crypto from "crypto";

const BASE_URL = process.env.LIPANA_API_BASE_URL || "https://api.lipana.dev";
const API_KEY = process.env.LIPANA_API_KEY;
const WEBHOOK_SECRET = process.env.LIPANA_WEBHOOK_SECRET;

if (!API_KEY) {
  console.warn(
    "⚠️  LIPANA_API_KEY is not set. Payment features will not work."
  );
}

const lipanaClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  timeout: 30_000,
});

export interface DepositRequest {
  transactionId: string;
  phoneNumber: string;
  amount: number;
  currency: string;
  userId: string;
  callbackUrl: string;
}

export interface WithdrawalRequest {
  transactionId: string;
  phoneNumber: string;
  amount: number;
  currency: string;
  userId: string;
  callbackUrl: string;
}

export interface LipanaResponse {
  success: boolean;
  reference?: string;
  message?: string;
}

export interface LipanaWebhookPayload {
  transactionId: string;
  reference: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  amount: number;
  phoneNumber: string;
  type: "deposit" | "withdrawal";
}

/**
 * Initiates a deposit (STK Push) via lipana.dev.
 */
export async function initiateDeposit(
  req: DepositRequest
): Promise<LipanaResponse> {
  const response = await lipanaClient.post<LipanaResponse>("/payments/deposit", {
    transaction_id: req.transactionId,
    phone_number: req.phoneNumber,
    amount: req.amount,
    currency: req.currency,
    user_id: req.userId,
    callback_url: req.callbackUrl,
  });
  return response.data;
}

/**
 * Initiates a withdrawal (B2C) via lipana.dev.
 */
export async function initiateWithdrawal(
  req: WithdrawalRequest
): Promise<LipanaResponse> {
  const response = await lipanaClient.post<LipanaResponse>(
    "/payments/withdrawal",
    {
      transaction_id: req.transactionId,
      phone_number: req.phoneNumber,
      amount: req.amount,
      currency: req.currency,
      user_id: req.userId,
      callback_url: req.callbackUrl,
    }
  );
  return response.data;
}

/**
 * Verifies the HMAC-SHA256 signature on an incoming lipana.dev webhook.
 *
 * Lipana sends the signature as the `X-Lipana-Signature` header.
 * The signed payload is the raw request body.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string
): boolean {
  if (!WEBHOOK_SECRET) {
    console.error("LIPANA_WEBHOOK_SECRET is not configured");
    return false;
  }
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signatureHeader, "hex")
  );
}
