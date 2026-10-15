import { describe, expect, it } from 'vitest';
import { attributes, ground, parsePreferences, validSelection } from './modules/styling/grounding';
import { browser, buildTestApp } from './test/helpers';
import { AppError } from './utils/errors';
import type { StylingProvider } from './integrations/slm/styling-provider';

describe('preference parsing and verified candidate ranking', () => {
  it('associates each color with its own garment slot', () => {
    expect(parsePreferences('blue shirt with charcoal trousers for office').slots).toEqual([
      { category: 'tops', garment: 'shirt', colors: ['blue'] },
      { category: 'bottoms', garment: undefined, colors: ['charcoal'] },
    ]);
  });
  it('handles coordinated exclusions without excluding a wanted category', () => {
    const parsed = parsePreferences('white top; exclude jackets and dresses');
    expect(parsed.excludedCategories.sort()).toEqual(['dresses', 'outerwear']);
    expect(parsed.slots[0]?.category).toBe('tops');
    const scoped = parsePreferences('white top; avoid blue shirts and no scarves');
    expect(scoped.intent).toBe('outfit');
    expect(scoped.excludedCategories).not.toContain('tops');
    expect(scoped.excludedSlots?.[0]).toMatchObject({ category: 'tops', colors: ['blue'] });
  });
  it('separates category questions, unsupported items and ambiguous requests', () => {
    expect(parsePreferences('classify a kurta without picking an outfit').intent).toBe('category');
    expect(parsePreferences('a red silk scarf only').intent).toBe('unsupported');
    expect(parsePreferences('something nice').intent).toBe('clarify');
  });
  it('retains the t-shirt subtype and matches traditional clothes from text metadata', () => {
    expect(parsePreferences('white t-shirt').slots[0]?.garment).toBe('tee');
    const item = {
      id: 'private-kurta',
      source: 'user' as const,
      name: 'White kurta',
      category: 'tops' as const,
      description: 'White casual summer kurta',
      imageUrl: '/private',
      createdAt: '',
    };
    expect(attributes(item).source).toBe('text');
    expect(ground([item], parsePreferences('a white kurta for summer')).plan[0]?.id).toBe(item.id);
    expect(ground([item], parsePreferences('a white kurta for winter')).complete).toBe(false);
  });
  it('does not accept repeated garments for multiple requested slots', () => {
    const item = {
      id: 'a',
      source: 'catalog' as const,
      name: 'a',
      category: 'tops' as const,
      description: '',
      imageUrl: '',
      createdAt: '',
    };
    expect(validSelection(['a', 'a'], [[item], [item]])).toBe(false);
  });
});

const status = {
  available: true,
  provider: 'llama-cpp' as const,
  model: 'test',
  reason: 'ok',
  local: true as const,
  customization: 'prompt-and-wardrobe-grounding' as const,
};
describe('disclosed fallback and model version boundaries', () => {
  it('rejects hallucinated IDs and returns a deterministic, labeled catalog fallback', async () => {
    const provider: StylingProvider = {
      status: async () => status,
      recommend: async () => ({
        answer: 'Made up',
        itemIds: ['invisible-personal-item'],
        categories: ['tops'],
        occasion: '',
      }),
    };
    const { app } = buildTestApp({}, { stylingProvider: provider });
    const res = await browser(app)
      .post('/api/v1/styling/recommend')
      .send({ message: 'a white tee' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: 'deterministic-fallback',
      fallbackReason: 'constraint-violation',
      itemIds: ['tee-classic-white'],
      modelUsed: true,
    });
    expect(res.body.diagnostics.rawSelectionValid).toBe(false);
  });
  it('fallbacks malformed output but never hides an unavailable provider', async () => {
    const provider: StylingProvider = {
      status: async () => status,
      recommend: async () => ({ answer: '' }) as never,
    };
    const { app } = buildTestApp({}, { stylingProvider: provider });
    const agent = browser(app);
    expect(
      (await agent.post('/api/v1/styling/recommend').send({ message: 'a white tee' })).body.source,
    ).toBe('deterministic-fallback');
    provider.recommend = async () => {
      throw new AppError(503, 'AI_UNAVAILABLE', 'offline');
    };
    expect(
      (await agent.post('/api/v1/styling/recommend').send({ message: 'a white tee' })).status,
    ).toBe(503);
  });
  it('does not select an outfit for a category question or unsupported request', async () => {
    let calls = 0;
    const provider: StylingProvider = {
      status: async () => status,
      recommend: async () => {
        calls++;
        throw new Error('must not generate');
      },
    };
    const { app } = buildTestApp({}, { stylingProvider: provider });
    const agent = browser(app);
    for (const message of [
      'classify a denim jacket without picking an outfit',
      'a silk scarf only',
      'something nice',
      'a purple dress',
    ]) {
      const res = await agent.post('/api/v1/styling/recommend').send({ message });
      expect(res.status).toBe(200);
      expect(res.body.itemIds).toEqual([]);
      expect(res.body.source).toBe('catalog-policy');
      expect(res.body.modelUsed).toBe(false);
    }
    expect(calls).toBe(0);
  });
  it('keeps an unregistered custom checkpoint unavailable and preserves original selection', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    const res = await agent.get('/api/v1/styling/status');
    expect(res.body.models.find((o: { id: string }) => o.id === 'custom').available).toBe(false);
    expect(
      (
        await agent
          .post('/api/v1/styling/recommend')
          .send({ message: 'a white tee', model: 'custom' })
      ).status,
    ).toBe(503);
  });
});
