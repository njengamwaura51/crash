import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  userId: string;
  userName: string;
  password: string;
  balance: number;
  currency: string;
  avatar: string;
  ipAddress: string;
  platform: string;
  userType: boolean;
  isSoundEnable: boolean;
  isMusicEnable: boolean;
  msgVisible: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    userName: { type: String, required: true, unique: true, index: true, trim: true },
    password: { type: String, required: true, select: false },
    balance: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, default: "KES" },
    avatar: { type: String, default: "" },
    ipAddress: { type: String, default: "" },
    platform: { type: String, default: "desktop" },
    userType: { type: Boolean, default: false }, // false = player, true = admin
    isSoundEnable: { type: Boolean, default: false },
    isMusicEnable: { type: Boolean, default: false },
    msgVisible: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", UserSchema);
