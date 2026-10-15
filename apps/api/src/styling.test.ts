import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from './config/env';
import { browser, buildTestApp, makeImage } from './test/helpers';
import { LlamaCppStylingProvider, stylingMessages } from './integrations/slm/llama-cpp.provider';
import type { StylingContext, StylingProvider } from './integrations/slm/styling-provider';
import { excludedCategories } from './modules/styling/styling.service';

const output = {
  answer: 'Pair the white tee with khaki chinos.',
  itemIds: ['tee-classic-white'],
  occasion: 'casual',
  categories: ['tops'] as const,
};
const status = {
  available: true,
  provider: 'llama-cpp',
  model: 'test-model',
  reason: 'ok',
  local: true,
  customization: 'prompt-and-wardrobe-grounding',
} as const;
const context: StylingContext = {
  message: 'A white shirt please',
  preferredCategories: [],
  wardrobe: [
    { id: 'tee-classic-white', name: 'White tee', category: 'tops', description: 'White' },
  ],
};
afterEach(() => vi.unstubAllGlobals());

function testProvider(): StylingProvider {
  return {
    status: async () => status,
    recommend: async () => ({ ...output, categories: ['tops'] }),
  };
}

describe('local SLM configuration and protocol', () => {
  it('decodes a valid grounded completion and rejects a different served model', async () => {
    for (const model of ['virtualfit-style-base', 'unexpected-model']) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({
                model,
                choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
              }),
            ),
          ),
      );
      const result = new LlamaCppStylingProvider(loadEnv({})).recommend(context);
      if (model === 'virtualfit-style-base') await expect(result).resolves.toMatchObject(output);
      else await expect(result).rejects.toMatchObject({ code: 'AI_FAILED' });
    }
  });
  it('rejects remote endpoints and URL credentials', () => {
    for (const value of [
      'https://api.example.com',
      'http://127.evil.example',
      'http://user:secret@localhost:8081',
    ])
      expect(() => loadEnv({ SLM_URL: value })).toThrow(/loopback/);
    expect(loadEnv({}).SLM_URL).toBe('http://127.0.0.1:8081');
  });

  it('keeps training and serving system prompts identical', () => {
    const prompt = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../../slm-engine/configs/prompt.json'), 'utf8'),
    );
    expect(stylingMessages(context)[0]?.content).toBe(prompt.system);
  });

  it('probes the exact loaded model, not mere configuration', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'different-model' }] }))),
    );
    expect((await new LlamaCppStylingProvider(loadEnv({})).status()).available).toBe(false);
  });

  it('fails honestly when the runtime is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connect refused')));
    const provider = new LlamaCppStylingProvider(loadEnv({}));
    expect((await provider.status()).available).toBe(false);
    await expect(provider.recommend(context)).rejects.toMatchObject({
      status: 503,
      code: 'AI_UNAVAILABLE',
    });
  });

  it('validates model output and forbids invented IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({ ...output, itemIds: ['someone-elses-garment'] }),
                },
              },
            ],
          }),
        ),
      ),
    );
    await expect(new LlamaCppStylingProvider(loadEnv({})).recommend(context)).rejects.toMatchObject(
      { status: 502, code: 'AI_FAILED' },
    );
  });

  it('rejects truncated completions and malformed JSON', async () => {
    for (const choice of [
      { finish_reason: 'length', message: { content: JSON.stringify(output) } },
      { finish_reason: 'stop', message: { content: 'not-json' } },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [choice] }))),
      );
      await expect(
        new LlamaCppStylingProvider(loadEnv({})).recommend(context),
      ).rejects.toMatchObject({ code: 'AI_FAILED' });
    }
  });

  it('propagates the hard deadline to inference', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
      ),
    );
    await expect(
      new LlamaCppStylingProvider({ ...loadEnv({}), SLM_TIMEOUT_MS: 25 }).recommend(context),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
});

describe('styling API grounding and isolation', () => {
  it("never sends another guest's uploaded garment to the model", async () => {
    const provider = testProvider();
    const recommend = vi.spyOn(provider, 'recommend');
    const { app } = buildTestApp({}, { stylingProvider: provider });
    const owner = browser(app);
    const upload = await owner
      .post('/api/v1/clothing')
      .field('name', 'Private audit top')
      .field('category', 'tops')
      .attach('image', await makeImage(), 'shirt.png');
    expect(upload.status).toBe(201);
    await browser(app).post('/api/v1/styling/recommend').send({ message: 'Suggest a top' });
    expect(
      recommend.mock.calls[0]?.[0].wardrobe.some((item) => item.id === upload.body.item.id),
    ).toBe(false);
    await owner.post('/api/v1/styling/recommend').send({ message: 'Private audit top' });
    expect(
      recommend.mock.calls[1]?.[0].wardrobe.some((item) => item.id === upload.body.item.id),
    ).toBe(true);
  });
  it('returns actual available clothing, validates input and preserves existing health', async () => {
    const { app } = buildTestApp({}, { stylingProvider: testProvider() });
    const agent = browser(app);
    expect((await agent.get('/api/v1/styling/status')).body.available).toBe(true);
    const res = await agent
      .post('/api/v1/styling/recommend')
      .send({ message: 'A white top please' });
    expect(res.status).toBe(200);
    expect(res.body.items[0].id).toBe('tee-classic-white');
    expect(res.body.simulated).toBe(false);
    for (const body of [
      {},
      { message: 'a' },
      { message: 'x'.repeat(601) },
      { message: 'valid', ownerId: 'fake' },
    ])
      expect((await agent.post('/api/v1/styling/recommend').send(body)).status).toBe(400);
    expect((await agent.get('/api/v1/health')).status).toBe(200);
  });

  it('excludes prohibited categories before they reach the language model', async () => {
    const provider = testProvider();
    const recommend = vi.spyOn(provider, 'recommend');
    const { app } = buildTestApp({}, { stylingProvider: provider });
    await browser(app)
      .post('/api/v1/styling/recommend')
      .send({ message: 'Casual tops, no dresses' });
    const sent = recommend.mock.calls[0]?.[0];
    expect(sent?.wardrobe.length).toBeGreaterThan(0);
    expect(sent?.wardrobe.some((i) => i.category === 'dresses')).toBe(false);
    expect(sent).not.toHaveProperty('heightCm');
    expect([...excludedCategories('avoid jackets and no dresses')]).toEqual([
      'outerwear',
      'dresses',
    ]);
  });

  it('enforces one concurrent generation and releases the slot after failure', async () => {
    const provider = testProvider();
    let finish: (() => void) | undefined;
    provider.recommend = () =>
      new Promise((_resolve, reject) => {
        finish = () => reject(new Error('provider failed'));
      });
    const { container } = buildTestApp({}, { stylingProvider: provider });
    const pending = container.styling.recommend('guest123', 'white top');
    const observed = expect(pending).rejects.toThrow('provider failed');
    await vi.waitFor(() => expect(finish).toBeDefined());
    await expect(container.styling.recommend('guest456', 'blue shirt')).rejects.toMatchObject({
      status: 429,
    });
    finish!();
    await observed;
    provider.recommend = testProvider().recommend;
    expect((await container.styling.recommend('guest456', 'white top')).items.length).toBe(1);
  });
});

