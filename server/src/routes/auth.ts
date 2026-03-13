import { Router, Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import User from "../models/User";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// ── POST /api/auth/register ────────────────────────────────────────────────────
router.post("/register", async (req: Request, res: Response) => {
  const { userName, password, currency } = req.body as {
    userName?: string;
    password?: string;
    currency?: string;
  };

  if (!userName || !password) {
    res.status(400).json({ error: "userName and password are required" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  const existing = await User.findOne({ userName });
  if (existing) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = await User.create({
    userId: uuidv4(),
    userName,
    password: hashed,
    balance: 0,
    currency: currency || "KES",
  });

  const token = jwt.sign(
    { userId: user.userId, userName: user.userName },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );

  res.status(201).json({
    status: true,
    token,
    user: {
      userId: user.userId,
      userName: user.userName,
      balance: user.balance,
      currency: user.currency,
    },
  });
});

// ── POST /api/auth/login ───────────────────────────────────────────────────────
router.post("/login", async (req: Request, res: Response) => {
  const { userName, password } = req.body as {
    userName?: string;
    password?: string;
  };

  if (!userName || !password) {
    res.status(400).json({ error: "userName and password are required" });
    return;
  }

  const user = await User.findOne({ userName }).select("+password");
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = jwt.sign(
    { userId: user.userId, userName: user.userName },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );

  res.json({
    status: true,
    token,
    user: {
      userId: user.userId,
      userName: user.userName,
      balance: user.balance,
      currency: user.currency,
      avatar: user.avatar,
      userType: user.userType,
    },
  });
});

export default router;
