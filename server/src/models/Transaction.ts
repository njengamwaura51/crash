import mongoose, { Document, Schema } from "mongoose";

/** Tracks deposit and withdrawal transactions tied to lipana.dev */
export interface ITransaction extends Document {
  transactionId: string;
  userId: string;
  type: "deposit" | "withdrawal";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed";
  lipanaReference: string;
  phoneNumber: string;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ["deposit", "withdrawal"], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "KES" },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
    },
    lipanaReference: { type: String, default: "" },
    phoneNumber: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model<ITransaction>("Transaction", TransactionSchema);
