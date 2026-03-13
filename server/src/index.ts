/**
 * Crash Game – Authoritative Backend Server
 *
 * Starts:
 *   • Express HTTP server (REST API)
 *   • Socket.io WebSocket server (real-time game)
 *   • MongoDB connection
 *   • GameEngine loop
 */

import "express-async-errors";
import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";

import authRoutes from "./routes/auth";
import paymentRoutes from "./routes/payment";
import gameRoutes from "./routes/game";
import { attachSocketHandlers, seedHistory } from "./socket/handlers";
import { gameEngine } from "./engine/GameEngine";

// ── Environment ───────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 5000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/crash_game";

const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim());

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

// Security headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// Rate limiter (general)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Parse JSON and capture raw body for webhook signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: string }).rawBody = buf.toString("utf8");
    },
  })
);

// ── Routes ────────────────────────────────────────────────────────────────────

app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api", gameRoutes);

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Global error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  const message =
    err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

// ── HTTP + Socket.io server ───────────────────────────────────────────────────

const server = http.createServer(app);

const io = new IOServer(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

attachSocketHandlers(io);

// ── Startup sequence ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Connect to MongoDB
  await mongoose.connect(MONGODB_URI);
  console.log("✅ MongoDB connected:", MONGODB_URI);

  // 2. Seed crash-point history from DB
  await seedHistory();
  console.log("✅ History seeded");

  // 3. Start the authoritative game loop
  gameEngine.start();
  console.log("✅ Game engine started");

  // 4. Start listening
  server.listen(PORT, () => {
    console.log(`✅ Server listening on http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
    console.log(`   Allowed origins: ${allowedOrigins.join(", ")}`);
  });
}

main().catch((err) => {
  console.error("❌ Fatal startup error:", err);
  process.exit(1);
});
