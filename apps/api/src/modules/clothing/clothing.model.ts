import { Schema } from 'mongoose';
import { CLOTHING_CATEGORIES } from '@virtualfit/shared';

export const clothingSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true, maxlength: 80 },
    category: { type: String, enum: CLOTHING_CATEGORIES, required: true, index: true },
    description: { type: String, default: '', maxlength: 300 },
    imageExt: { type: String, enum: ['png', 'jpg'], required: true },
    uploadedBy: { type: String, required: true, index: true },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
);
