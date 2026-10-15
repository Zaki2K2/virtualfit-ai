import type { AiProviderId, ClothingCategory, ErrorCode, TryOnStatus } from '@virtualfit/shared';
import type { Doc } from '../../db/collection';

export interface TryOnDoc extends Doc {
  ownerId: string;
  clothingId: string | null;
  clothingName: string;
  category: ClothingCategory;
  provider: AiProviderId;
  model: string;
  durationMs: number | null;
  simulated: boolean;
  status: TryOnStatus;
  resultExt: 'png' | 'jpg' | null;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}
