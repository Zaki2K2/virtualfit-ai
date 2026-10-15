import { Schema } from 'mongoose';

export const favoriteSchema = new Schema(
  {
    _id: { type: String, required: true },
    ownerId: { type: String, required: true, index: true },
    tryOnId: { type: String, required: true, index: true },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
);
