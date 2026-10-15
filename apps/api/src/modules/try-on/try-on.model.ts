import { Schema } from 'mongoose';
import { AI_PROVIDER_IDS, CLOTHING_CATEGORIES, TRY_ON_STATUSES } from '@virtualfit/shared';

/**
 * Only a reference to the generated result is stored. The person's photo and the garment image
 * are processed in memory and are never persisted.
 */
export const tryOnSchema = new Schema(
  {
    _id: { type: String, required: true },
    ownerId: { type: String, required: true, index: true },
    clothingId: { type: String, default: null },
    clothingName: { type: String, required: true },
    category: { type: String, enum: CLOTHING_CATEGORIES, required: true },
    provider: { type: String, enum: AI_PROVIDER_IDS, required: true },
    model: { type: String, default: 'unknown' },
    durationMs: { type: Number, default: null },
    simulated: { type: Boolean, required: true },
    status: { type: String, enum: TRY_ON_STATUSES, required: true, index: true },
    resultExt: { type: String, enum: ['png', 'jpg', null], default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
);
