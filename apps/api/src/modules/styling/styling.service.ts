import { stylingOutputSchema, type StylingOutput } from '@virtualfit/shared';
import { ZodError } from 'zod';
import { parsePreferences, ground, validSelection } from './grounding';
import type { StylingProvider } from '../../integrations/slm/styling-provider';
import { AppError } from '../../utils/errors';
import type { ClothingService } from '../clothing/clothing.service';
import type { UsersService } from '../users/users.service';

export function excludedCategories(message: string): Set<string> {
  return new Set(parsePreferences(message).excludedCategories);
}

export class StylingService {
  private busy = false;
  constructor(
    private readonly provider: StylingProvider,
    private readonly clothing: ClothingService,
    private readonly users: UsersService,
    private readonly customProvider?: StylingProvider,
  ) {}

  async status() {
    const base = await this.provider.status();
    const custom = await this.customProvider?.status();
    return {
      ...base,
      models: [
        { id: 'base' as const, model: base.model, available: base.available, reason: base.reason },
        {
          id: 'custom' as const,
          model: custom?.model ?? 'virtualfit-fashion-custom',
          available: custom?.available ?? false,
          reason: custom?.reason ?? 'Custom model is not configured.',
        },
      ],
    };
  }

  async recommend(guestId: string, message: string, model: 'base' | 'custom' = 'base') {
    const provider = model === 'custom' ? this.customProvider : this.provider;
    if (!provider || (model === 'custom' && !(await provider.status()).available))
      throw new AppError(
        503,
        'AI_UNAVAILABLE',
        'The custom language model is unavailable. Select the original model.',
      );
    if (this.busy)
      throw new AppError(
        429,
        'RATE_LIMITED',
        'The local styling assistant is busy. Please retry shortly.',
      );
    this.busy = true;
    try {
      // The existing ownership-aware service is the only catalog source. No model database access.
      const [items, profile] = await Promise.all([
        this.clothing.list(guestId),
        this.users.get(guestId),
      ]);
      const preferences = parsePreferences(message);
      const grounded = ground(items, preferences, profile.preferredCategories);
      const status = await provider.status();
      const common = { model: status.model, simulated: false as const, intent: preferences.intent };
      const diagnostics = {
        rawSchemaValid: null as boolean | null,
        rawSelectionValid: null as boolean | null,
        candidateIds: grounded.candidates.map((i) => i.id),
        pipelineVersion: 'grounding-v2',
      };
      const finish = (
        result: StylingOutput,
        source: 'model' | 'deterministic-fallback' | 'catalog-policy',
        fallbackReason: string | null,
        modelUsed: boolean,
      ) => ({
        ...result,
        ...common,
        source,
        fallbackReason,
        modelUsed,
        diagnostics,
        items: result.itemIds.map((id) => items.find((i) => i.id === id)!),
      });
      const canonical: StylingOutput = {
        answer: grounded.complete
          ? `Consider ${grounded.plan.map((i) => i.name).join(' with ')}. These items match the catalog attributes in your request; check the preview before deciding.`
          : 'No complete combination matches the available catalog attributes. Try different preferences or add a matching garment.',
        itemIds: grounded.complete ? grounded.plan.map((i) => i.id) : [],
        occasion: preferences.occasion,
        categories: grounded.complete ? [...new Set(grounded.plan.map((i) => i.category))] : [],
      };
      if (preferences.intent === 'category') {
        canonical.itemIds = [];
        canonical.categories = [
          ...new Set(preferences.slots.flatMap((s) => (s.category ? [s.category] : []))),
        ];
        canonical.answer = canonical.categories.length
          ? `This clothing belongs to: ${canonical.categories.join(', ')}. No outfit has been selected.`
          : 'That garment is outside the supported catalog categories.';
        return finish(canonical, 'catalog-policy', null, false);
      }
      if (preferences.intent === 'clarify') {
        canonical.itemIds = [];
        canonical.categories = [];
        canonical.answer =
          'Which garment categories, colors, occasion or season should I use? Please add a little detail.';
        return finish(canonical, 'catalog-policy', null, false);
      }
      if (preferences.intent === 'unsupported' || !grounded.complete) {
        canonical.itemIds = [];
        canonical.categories = [];
        return finish(canonical, 'catalog-policy', null, false);
      }
      let result: StylingOutput;
      try {
        result = stylingOutputSchema.parse(
          await provider.recommend({
            message,
            preferredCategories: profile.preferredCategories,
            wardrobe: grounded.candidates.map(({ id, name, category, description }) => ({
              id,
              name,
              category,
              description: description.slice(0, 120),
            })),
            selectionPlan: canonical.itemIds,
            preferences,
          }),
        );
        diagnostics.rawSchemaValid = true;
      } catch (err) {
        // Only invalid output gets a disclosed fallback. Outages, timeouts and real bugs still fail.
        const invalid =
          err instanceof AppError
            ? (err.details as { invalidOutput?: boolean; schemaValid?: boolean } | undefined)
            : undefined;
        if (!(err instanceof ZodError) && !invalid?.invalidOutput) throw err;
        diagnostics.rawSchemaValid = invalid?.schemaValid ?? false;
        diagnostics.rawSelectionValid = invalid?.schemaValid ? false : null;
        return finish(canonical, 'deterministic-fallback', 'invalid-model-output', true);
      }
      const byId = new Map(grounded.candidates.map((i) => [i.id, i]));
      const selectedCategories = [
        ...new Set(result.itemIds.flatMap((id) => byId.get(id)?.category ?? [])),
      ];
      const valid =
        result.itemIds.every((id) => byId.has(id)) &&
        validSelection(result.itemIds, grounded.groups) &&
        [...result.categories].sort().join(',') === [...selectedCategories].sort().join(',');
      diagnostics.rawSelectionValid = valid;
      if (!valid) return finish(canonical, 'deterministic-fallback', 'constraint-violation', true);
      return finish(
        { ...result, occasion: preferences.occasion, categories: selectedCategories },
        'model',
        null,
        true,
      );
    } finally {
      this.busy = false;
    }
  }
}
