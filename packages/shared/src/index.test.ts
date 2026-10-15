import { describe, expect, it } from 'vitest';
import { createTryOnSchema, profileUpdateSchema, createClothingSchema } from './index';

describe('shared schemas', () => {
  it('parses multipart consent flag', () => {
    const r = createTryOnSchema.parse({ category: 'tops', consent: 'true' });
    expect(r.consent).toBe(true);
    expect(createTryOnSchema.parse({ category: 'tops' }).consent).toBe(false);
  });
  it('rejects unknown category and extra fields', () => {
    expect(createTryOnSchema.safeParse({ category: 'hats' }).success).toBe(false);
    expect(createTryOnSchema.safeParse({ category: 'tops', userId: 'x' }).success).toBe(false);
  });
  it('rejects implausible measurements', () => {
    expect(profileUpdateSchema.safeParse({ heightCm: 5 }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ heightCm: 175, weightKg: null }).success).toBe(true);
  });
  it('requires a clothing name', () => {
    expect(createClothingSchema.safeParse({ name: ' ', category: 'tops' }).success).toBe(false);
  });
});
