import mongoose, { Document, Schema } from "mongoose";

export interface IRound extends Document {
  roundId: number;
  serverSeed: string;
  clientSeed: string;
  crashPoint: number;
  startedAt: Date;
  endedAt: Date | null;
  status: "active" | "completed";
}

const RoundSchema = new Schema<IRound>(
  {
    roundId: { type: Number, required: true, unique: true, index: true },
    serverSeed: { type: String, required: true },
    clientSeed: { type: String, required: true },
    crashPoint: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    status: { type: String, enum: ["active", "completed"], default: "active" },
  },
  { timestamps: true }
);

export default mongoose.model<IRound>("Round", RoundSchema);
