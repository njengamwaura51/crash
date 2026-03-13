import mongoose, { Document, Schema } from "mongoose";

export interface IBet extends Document {
  betId: string;
  userId: string;
  userName: string;
  roundId: number;
  slot: "f" | "s";
  betAmount: number;
  cashoutAt: number;
  cashedOut: boolean;
  cashAmount: number;
  target: number;
  flyDetailID: number;
  flyAway: number;
  createdAt: Date;
}

const BetSchema = new Schema<IBet>(
  {
    betId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    roundId: { type: Number, required: true, index: true },
    slot: { type: String, enum: ["f", "s"], required: true },
    betAmount: { type: Number, required: true, min: 0 },
    cashoutAt: { type: Number, default: 0 },
    cashedOut: { type: Boolean, default: false },
    cashAmount: { type: Number, default: 0 },
    target: { type: Number, default: 0 },
    flyDetailID: { type: Number, required: true },
    flyAway: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IBet>("Bet", BetSchema);
