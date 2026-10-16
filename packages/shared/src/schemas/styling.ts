import { z } from 'zod';
import { categorySchema } from './index';
import type { ClothingItem } from '../types';

// Language-only input: photos and body measurements belong in the separate studio.
const languageMessage = z
  .string()
  .trim()
  .min(3)
  .max(600)
  .refine(
    (text) =>
      !/(?:data:image|https?:\/\/\S+\.(?:png|jpe?g|webp)|\b\d{1,3}(?:\.\d+)?\s*(?:cm|kg|lbs?|inches|inch|ft|feet)\b|\b(?:height|weight|waist|chest|hips?)\s*(?:is|:|=)?\s*\d)/i.test(
        text,
      ),
    'Keep photographs and body measurements in the try-on studio. Describe clothing, colors and occasions here.',
  );

export const stylingRequestSchema = z
  .object({
    message: languageMessage,
    history: z.array(languageMessage).max(2).optional(),
    model: z.enum(['base', 'custom']).optional(),
  })
  .strict();

export const stylingOutputSchema = z
  .object({
    answer: z.string().trim().min(1).max(600),
    itemIds: z.array(z.string().min(1).max(64)).max(4),
    occasion: z.string().max(80),
    categories: z.array(categorySchema).max(4),
  })
  .strict();

export type StylingOutput = z.infer<typeof stylingOutputSchema>;
export interface StylingRecommendation extends StylingOutput {
  items: ClothingItem[];
  model: string;
  simulated: false;
  source: 'model' | 'deterministic-fallback' | 'catalog-policy';
  fallbackReason: string | null;
  intent: 'outfit' | 'category' | 'clarify' | 'unsupported' | 'advice';
  modelUsed: boolean;
  diagnostics: {
    rawSchemaValid: boolean | null;
    rawSelectionValid: boolean | null;
    rawExplanationValid?: boolean | null;
    candidateIds: string[];
    pipelineVersion: string;
  };
}
export interface StylingStatus {
  available: boolean;
  provider: 'llama-cpp';
  model: string;
  reason: string;
  local: true;
  customization: 'prompt-and-wardrobe-grounding';
  inferenceVerified?: boolean;
  checkedAt?: string;
  displayName?: string;
  models?: Array<{
    id: 'base' | 'custom';
    model: string;
    available: boolean;
    reason: string;
    displayName?: string;
    inferenceVerified?: boolean;
    checkedAt?: string;
  }>;
}
