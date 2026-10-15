import type {
  AiProviderId,
  ClothingCategory,
  ErrorCode,
  Gender,
  ModelOptionId,
  TryOnStatus,
} from '../constants';

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

export interface ModelOption {
  id: ModelOptionId;
  label: string;
  /** true only if the model can run right now (service reachable, checkpoint present, ...). */
  available: boolean;
  /** Why it is unavailable (shown to the user); "ok" when available. */
  reason: string;
  simulated: boolean;
  externalProcessing: boolean;
}

export interface HealthStatus {
  /** 'degraded' = the API runs but its database connection is down. */
  status: 'ok' | 'degraded';
  time: string;
  database: 'mongodb' | 'memory';
  /** Live connection state (always true for the in-memory store). */
  databaseUp: boolean;
  ai: {
    provider: AiProviderId;
    simulated: boolean;
    /** true when uploaded photos leave this server for a third-party AI service */
    externalProcessing: boolean;
    configured: boolean;
    /** Option used when the client does not choose one. */
    defaultOption: ModelOptionId;
    options: ModelOption[];
  };
  limits: { maxUploadMb: number; resultRetentionHours: number };
}
