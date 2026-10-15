import { z } from 'zod';
import { categorySchema } from './index';
import type { ClothingItem } from '../types';

export const stylingRequestSchema = z
  .object({
    message: z.string().trim().min(3).max(600),
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
  intent: 'outfit' | 'category' | 'clarify' | 'unsupported';
  modelUsed: boolean;
  diagnostics: {
    rawSchemaValid: boolean | null;
    rawSelectionValid: boolean | null;
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
  models?: Array<{ id: 'base' | 'custom'; model: string; available: boolean; reason: string }>;
}
