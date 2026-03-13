import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import Bet from "../models/Bet";
import Round from "../models/Round";
import User from "../models/User";

const router = Router();

// ── POST /api/my-info ─────────────────────────────────────────────────────────
/**
 * Returns the authenticated user's bet history.
 * Called by the frontend after each new BET phase begins.
 */
router.post("/my-info", authMiddleware, async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };

  const bets = await Bet.find({ userId: req.user!.userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const history = bets.map((b) => ({
    _id: b._id,
    name: name || req.user!.userName,
    betAmount: b.betAmount,
    cashoutAt: b.cashoutAt,
    cashouted: b.cashedOut,
    createdAt: b.createdAt,
    flyAway: b.flyAway,
    flyDetailID: b.flyDetailID,
  }));

  res.json({ status: true, data: history });
});

// ── GET /api/game/seed/:id ────────────────────────────────────────────────────
/**
 * Returns the server seed and client seeds for a completed round so players
 * can verify the crash point was generated fairly.
 */
router.get(
  "/game/seed/:id",
  authMiddleware,
  async (req: Request, res: Response) => {
    const roundId = Number(req.params.id);
    if (isNaN(roundId)) {
      res.status(400).json({ error: "Invalid round ID" });
      return;
    }

    const round = await Round.findOne({ roundId }).lean();
    if (!round || round.status !== "completed") {
      res.status(404).json({ error: "Round not found or still active" });
      return;
    }

    // Collect the participating user IDs/seeds for this round
    const bets = await Bet.find({ roundId }).lean();
    const seedsOfUsers = bets.map((b) => ({
      seed: b.userId, // public identifier used as client seed contribution
      userId: b.userId,
    }));

    res.json({
      flyDetailID: roundId,
      serverSeed: round.serverSeed,
      clientSeed: round.clientSeed,
      crashPoint: round.crashPoint,
      createdAt: round.startedAt,
      seedOfUsers: seedsOfUsers,
    });
  }
);

// ── GET /api/game/history ─────────────────────────────────────────────────────
router.get("/game/history", async (_req: Request, res: Response) => {
  const rounds = await Round.find({ status: "completed" })
    .sort({ roundId: -1 })
    .limit(30)
    .lean();

  res.json({ status: true, data: rounds.map((r) => r.crashPoint) });
});

// ── GET /api/balance ──────────────────────────────────────────────────────────
router.get("/balance", authMiddleware, async (req: Request, res: Response) => {
  const user = await User.findOne({ userId: req.user!.userId }).lean();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ status: true, balance: user.balance });
});

export default router;
