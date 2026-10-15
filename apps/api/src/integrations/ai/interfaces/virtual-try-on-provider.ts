import type { AiProviderId, ClothingCategory } from '@virtualfit/shared';

export interface TryOnInput {
  personImage: Buffer;
  garmentImage: Buffer;
  category: ClothingCategory;
  /** Aborted when the generation timeout elapses; providers should stop work promptly. */
  signal?: AbortSignal;
}

export interface TryOnOutput {
  imageBuffer?: Buffer;
  /** Must point at a host listed in the provider's allowedImageHosts. */
  imageUrl?: string;
  /** Exact model/version that produced the image, when the provider knows it (stored per try-on). */
  modelLabel?: string;
}

/**
 * Contract every AI backend (mock, Hugging Face Gradio, a future FastAPI service...) implements.
 * This is visual try-on only: it renders how a garment could look, it does NOT predict physical fit.
 */
export interface VirtualTryOnProvider {
  readonly id: AiProviderId;
  /** Human-readable model identifier stored with every generation. */
  readonly model: string;
  /** true = output is a local simulation and must be labelled as such everywhere. */
  readonly simulated: boolean;
  /** true = photos leave this server for a third-party service (requires user consent). */
  readonly externalProcessing: boolean;
  readonly allowedImageHosts: readonly string[];
  /** false when required configuration is missing; generate() then fails with AI_UNAVAILABLE. */
  isConfigured(): boolean;
  generate(input: TryOnInput): Promise<TryOnOutput>;
}
