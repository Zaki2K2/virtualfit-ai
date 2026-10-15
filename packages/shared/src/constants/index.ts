export const CLOTHING_CATEGORIES = ['tops', 'outerwear', 'bottoms', 'dresses'] as const;
export type ClothingCategory = (typeof CLOTHING_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ClothingCategory, string> = {
  tops: 'Shirts & T-shirts',
  outerwear: 'Jackets',
  bottoms: 'Trousers',
  dresses: 'Dresses',
};

/** Garment region a try-on model should replace. Mirrors the cloth types used by CatVTON-style models. */
export const CATEGORY_TO_CLOTH_TYPE: Record<ClothingCategory, 'upper' | 'lower' | 'overall'> = {
  tops: 'upper',
  outerwear: 'upper',
  bottoms: 'lower',
  dresses: 'overall',
};

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
};

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const DEFAULT_MAX_UPLOAD_MB = 8;

export const TRY_ON_STATUSES = ['processing', 'completed', 'failed'] as const;
export type TryOnStatus = (typeof TRY_ON_STATUSES)[number];

export const AI_PROVIDER_IDS = ['mock', 'gradio'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Stable machine-readable error codes returned by the API. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNSUPPORTED_IMAGE',
  'FILE_TOO_LARGE',
  'NOT_FOUND',
  'CONSENT_REQUIRED',
  'AI_UNAVAILABLE',
  'AI_QUOTA_EXHAUSTED',
  'AI_TIMEOUT',
  'AI_FAILED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
