import { createHash } from 'node:crypto';
import { z } from 'zod';
import { novaStylingSystem, stylingOutputSchema } from '@virtualfit/shared';
import type { TrainingExample } from './models';
import { cleanMemory } from './service';

const wardrobe = z
  .array(
    z
      .object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(80),
        category: z.enum(['tops', 'bottoms', 'dresses', 'outerwear']),
        description: z.string().max(120),
      })
      .strict(),
  )
  .max(12);
/** Explicit manual review remains necessary; this gate checks contracts, not factual quality. */
export function reviewedTrainingRecord(row: TrainingExample) {
  if (!row.consent || row.reviewStatus !== 'approved')
    throw new Error('Training requires both consent and operator approval.');
  cleanMemory(row.input);
  cleanMemory(row.expectedOutput);
  let input: { message: string; wardrobe: z.infer<typeof wardrobe> };
  if (row.input.trim().startsWith('{')) {
    input = z
      .object({ message: z.string().trim().min(3).max(600), wardrobe })
      .strict()
      .parse(JSON.parse(row.input));
  } else input = { message: z.string().trim().min(3).max(600).parse(row.input), wardrobe: [] };
  const output = row.expectedOutput.trim().startsWith('{')
    ? stylingOutputSchema.parse(JSON.parse(row.expectedOutput))
    : stylingOutputSchema.parse({
        answer: row.expectedOutput,
        itemIds: [],
        occasion: '',
        categories: [],
      });
  if (
    new Set(output.itemIds).size !== output.itemIds.length ||
    output.itemIds.some((id) => !input.wardrobe.some((item) => item.id === id))
  )
    throw new Error('Training target contains unverified wardrobe IDs.');
  const key = createHash('sha256')
    .update(input.message.trim().toLowerCase().replace(/\s+/g, ' '))
    .digest('hex');
  return {
    id: `nova-reviewed-${key.slice(0, 20)}`,
    source: 'explicitly-consented-operator-reviewed',
    scenario: key,
    messages: [
      { role: 'system', content: novaStylingSystem },
      {
        role: 'user',
        content: JSON.stringify({
          ...input,
          preferredCategories: [],
          selectionPlan: output.itemIds,
        }),
      },
      { role: 'assistant', content: JSON.stringify(output) },
    ],
  };
}
