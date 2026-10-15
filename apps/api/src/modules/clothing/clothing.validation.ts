import { z } from 'zod';
import { clothingQuerySchema, createClothingSchema } from '@virtualfit/shared';

export { clothingQuerySchema };
export const createClothingBody = createClothingSchema;
export const idParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/, 'Invalid id') });
