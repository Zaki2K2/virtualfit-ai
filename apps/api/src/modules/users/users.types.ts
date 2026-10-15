import type { ClothingCategory, Gender } from '@virtualfit/shared';
import type { Doc } from '../../db/collection';

/** Guest profile. The id is the server-issued guest id; email/auth fields arrive with real accounts. */
export interface UserDoc extends Doc {
  displayName: string;
  gender: Gender | null;
  heightCm: number | null;
  weightKg: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  preferredCategories: ClothingCategory[];
  rememberAiConsent: boolean;
  createdAt: Date;
  updatedAt: Date;
}
