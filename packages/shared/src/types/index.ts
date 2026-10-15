import type { AiProviderId, ClothingCategory, ErrorCode, Gender, TryOnStatus } from '../constants';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface ClothingItem {
  id: string;
  name: string;
  category: ClothingCategory;
  description: string;
  imageUrl: string;
  /** "catalog" = bundled sample illustration, "user" = uploaded by the current guest. */
  source: 'catalog' | 'user';
  createdAt: string;
}

export interface TryOn {
  id: string;
  clothingId: string | null;
  clothingName: string;
  category: ClothingCategory;
  provider: AiProviderId;
  /** Model/Space that produced the result (e.g. "yisol/IDM-VTON") or "mock-simulation". */
  model: string;
  /** Wall-clock generation time, set once the job finished. */
  durationMs: number | null;
  /** true when the result is a local simulation and NOT real AI output. */
  simulated: boolean;
  status: TryOnStatus;
  resultUrl: string | null;
  error: { code: ErrorCode; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Favorite {
  id: string;
  tryOnId: string;
  tryOn: TryOn;
  createdAt: string;
}

export interface Profile {
  displayName: string;
  gender: Gender | null;
  heightCm: number | null;
  weightKg: number | null;
  chestCm: number | null;
  waistCm: number | null;
  hipsCm: number | null;
  preferredCategories: ClothingCategory[];
  privacy: { rememberAiConsent: boolean };
  updatedAt: string | null;
}

export interface HealthStatus {
  status: 'ok';
  time: string;
  database: 'mongodb' | 'memory';
  ai: {
    provider: AiProviderId;
    simulated: boolean;
    /** true when uploaded photos leave this server for a third-party AI service */
    externalProcessing: boolean;
    configured: boolean;
  };
  limits: { maxUploadMb: number; resultRetentionHours: number };
}
