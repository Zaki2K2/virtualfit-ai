import { z } from 'zod';
import { CLOTHING_CATEGORIES, GENDERS, MODEL_OPTION_IDS } from '../constants';

export const categorySchema = z.enum(CLOTHING_CATEGORIES);

export const clothingQuerySchema = z.object({
  category: categorySchema.optional(),
  q: z.string().trim().max(80).optional(),
});

export const createClothingSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  category: categorySchema,
  description: z.string().trim().max(300).optional().default(''),
});
export type CreateClothingInput = z.infer<typeof createClothingSchema>;

export const createTryOnSchema = z
  .object({
    category: categorySchema,
    clothingId: z.string().trim().min(1).max(64).optional(),
    /** Model to use; omitted = the server default. Unavailable models fail, they are never swapped for the mock. */
    model: z.enum(MODEL_OPTION_IDS).optional(),
    // multipart fields arrive as strings
    consent: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();
export type CreateTryOnInput = z.infer<typeof createTryOnSchema>;

export const createFavoriteSchema = z.object({
  tryOnId: z.string().trim().min(1).max(64),
});

const optionalCm = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().max(60).optional(),
    gender: z.enum(GENDERS).nullable().optional(),
    heightCm: optionalCm(50, 260),
    weightKg: optionalCm(20, 400),
    chestCm: optionalCm(30, 250),
    waistCm: optionalCm(30, 250),
    hipsCm: optionalCm(30, 250),
    preferredCategories: z.array(categorySchema).max(CLOTHING_CATEGORIES.length).optional(),
    privacy: z.object({ rememberAiConsent: z.boolean().optional() }).optional(),
  })
  .strict();
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
