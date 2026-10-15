import type { ClothingCategory, StylingOutput, StylingStatus } from '@virtualfit/shared';

export interface StylingContext {
  message: string;
  preferredCategories: ClothingCategory[];
  wardrobe: Array<{ id: string; name: string; category: ClothingCategory; description: string }>;
  selectionPlan?: string[];
  preferences?: unknown;
}

/** Language-only port. Never invokes or substitutes the vision providers. */
export interface StylingProvider {
  status(): Promise<StylingStatus>;
  recommend(context: StylingContext): Promise<StylingOutput>;
}
