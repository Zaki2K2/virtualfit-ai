import { stylingOutputSchema, novaIdentityGuidance, novaIdentityQuestion, type StylingOutput } from '@virtualfit/shared';
import { ZodError } from 'zod';
import { parsePreferences, conversationPreferences, ground, validSelection } from './grounding';
import type { StylingProvider } from '../../integrations/slm/styling-provider';
import { AppError } from '../../utils/errors';
import type { ClothingService } from '../clothing/clothing.service';
import { languageMetadata } from '../../integrations/slm/privacy';
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
        {
          id: 'base' as const,
          model: base.model,
          available: base.available,
          reason: base.reason,
          displayName: base.displayName,
          inferenceVerified: base.inferenceVerified,
          checkedAt: base.checkedAt,
        },
        {
          id: 'custom' as const,
          model: custom?.model ?? 'virtualfit-fashion-custom',
          available: custom?.available ?? false,
          reason: custom?.reason ?? 'Custom model is not configured.',
          displayName: custom?.displayName,
          inferenceVerified: custom?.inferenceVerified,
          checkedAt: custom?.checkedAt,
        },
      ],
    };
  }

  async recommend(
    guestId: string,
    message: string,
    model: 'base' | 'custom' = 'base',
    history: string[] = [],
    signal?: AbortSignal,
  ) {
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
      const preferences = conversationPreferences(message, history);
      const identityQuestion = novaIdentityQuestion(message);
      if (identityQuestion) {
        preferences.intent = 'advice';
        preferences.slots = [];
        preferences.occasion = '';
      }
      const grounded = ground(items, preferences, profile.preferredCategories);
      const status = await provider.status();
      const common = { model: status.model, simulated: false as const, intent: preferences.intent };
      const diagnostics = {
        rawSchemaValid: null as boolean | null,
        rawSelectionValid: null as boolean | null,
        rawExplanationValid: null as boolean | null,
        candidateIds: grounded.candidates.map((i) => i.id),
        pipelineVersion: 'grounding-v3-local',
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
      }
      if (preferences.intent === 'advice') {
        canonical.itemIds = [];
        canonical.categories = [];
        canonical.answer =
          'Try a neutral base with one accent color. Tell me which garment and occasion you have in mind.';
        if (identityQuestion)
          canonical.answer = novaIdentityGuidance(message)!;
      }
      if (preferences.intent === 'clarify') {
        canonical.itemIds = [];
        canonical.categories = [];
        canonical.answer =
          'Which garment categories, colors, occasion or season should I use? Please add a little detail.';
      }
      if (
        preferences.intent === 'unsupported' ||
        (preferences.intent === 'outfit' && !grounded.complete)
      ) {
        canonical.itemIds = [];
        canonical.categories = [];
      }
      let result: StylingOutput;
      try {
        result = stylingOutputSchema.parse(
          await provider.recommend({
            message,
            history,
            instructions: identityQuestion
              ? 'Answer the identity or capability question directly using your configured Nova identity. This is not a missing-garment request. Return empty itemIds and categories. Do not claim a fine-tuned checkpoint exists.'
              : preferences.intent === 'advice'
                ? 'Give general color or styling advice. Do not assert that unspecified garments exist in this wardrobe. Return empty itemIds and categories.'
                : undefined,
            responseMode:
              preferences.intent === 'advice'
                ? 'advice'
                : preferences.intent === 'category'
                  ? 'category'
                  : preferences.intent === 'clarify'
                    ? 'clarify'
                    : !grounded.complete || preferences.intent === 'unsupported'
                      ? 'unavailable'
                      : 'outfit',
            preferredCategories: profile.preferredCategories,
            wardrobe: grounded.candidates.map(({ id, name, category, description }) => ({
              id,
              name: languageMetadata(name).slice(0, 80),
              category,
              description: languageMetadata(description).slice(0, 120),
            })),
            selectionPlan: canonical.itemIds,
            selectionCategories: canonical.categories,
            preferences,
          }, signal),
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
      const selecting = preferences.intent === 'outfit' && grounded.complete;
      const expectedCategories = selecting ? selectedCategories : canonical.categories;
      const valid =
        result.itemIds.every((id) => byId.has(id)) &&
        (selecting
          ? validSelection(result.itemIds, grounded.groups)
          : result.itemIds.length === 0) &&
        [...result.categories].sort().join(',') === [...expectedCategories].sort().join(',');
      diagnostics.rawSelectionValid = valid;
      const explanation = parsePreferences(result.answer);
      const selectedItems = result.itemIds.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item] : [];
      });
      const explanationValid =
        !selecting ||
        (!explanation.unsupported.length &&
          explanation.slots.every(
            (slot) =>
              ground(selectedItems, {
                ...explanation,
                slots: [slot],
                occasion: '',
                season: '',
                excludedCategories: [],
                excludedColors: [],
                excludedSlots: [],
              }).complete,
          ));
      diagnostics.rawExplanationValid = explanationValid;
      if (!explanationValid)
        return finish(canonical, 'deterministic-fallback', 'ungrounded-explanation', true);
      if (!valid) return finish(canonical, 'deterministic-fallback', 'constraint-violation', true);
      return finish(
        { ...result, occasion: preferences.occasion, categories: expectedCategories },
        'model',
        null,
        true,
      );
    } finally {
      this.busy = false;
    }
  }
}
