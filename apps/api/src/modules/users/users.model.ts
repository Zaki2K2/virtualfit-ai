import { Schema } from 'mongoose';
import { CLOTHING_CATEGORIES, GENDERS } from '@virtualfit/shared';

export const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    displayName: { type: String, default: '', maxlength: 60 },
    gender: { type: String, enum: [...GENDERS, null], default: null },
    heightCm: { type: Number, default: null },
    weightKg: { type: Number, default: null },
    chestCm: { type: Number, default: null },
    waistCm: { type: Number, default: null },
    hipsCm: { type: Number, default: null },
    preferredCategories: { type: [String], enum: CLOTHING_CATEGORIES, default: [] },
    rememberAiConsent: { type: Boolean, default: false },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
);
