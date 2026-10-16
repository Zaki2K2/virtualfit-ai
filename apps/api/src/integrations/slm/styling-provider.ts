import type { ClothingCategory, StylingOutput, StylingStatus } from '@virtualfit/shared';

export interface StylingContext {
  message: string;
  instructions?: string;
  history?: string[];
  responseMode?: 'outfit' | 'category' | 'clarify' | 'unavailable' | 'advice';
  preferredCategories: ClothingCategory[];
  wardrobe: Array<{ id: string; name: string; category: ClothingCategory; description: string }>;
  selectionCategories?: ClothingCategory[];
  selectionPlan?: string[];
  preferences?: unknown;
}

/** Language-only port. Never invokes or substitutes the vision providers. */
export interface StylingProvider {
  status(): Promise<StylingStatus>;
  recommend(context: StylingContext): Promise<StylingOutput>;
}
