import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { AppError } from './utils/errors';
import type { VirtualTryOnProvider } from './integrations/ai/interfaces/virtual-try-on-provider';
import { MockProvider } from './integrations/ai/providers/mock.provider';
import { browser, buildTestApp, makeImage, waitForTryOn } from './test/helpers';

const stubProvider = (
  over: Partial<VirtualTryOnProvider> & Pick<VirtualTryOnProvider, 'generate'>,
): VirtualTryOnProvider => ({
  id: 'gradio',
  model: 'test/stub-space',
  simulated: false,
  externalProcessing: true,
  allowedImageHosts: [],
  isConfigured: () => true,
  ...over,
});

describe('health', () => {
  it('reports status, database mode and AI mode', async () => {
    const { app } = buildTestApp();
    const res = await browser(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'memory',
      ai: { provider: 'mock', simulated: true, externalProcessing: false, configured: true },
    });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const { app } = buildTestApp();
    const res = await browser(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('clothing', () => {
  it('lists the catalog and filters by category and search', async () => {
    const { app } = buildTestApp();
    const all = await browser(app).get('/api/v1/clothing');
    expect(all.body.items.length).toBe(10);
    const dresses = await browser(app).get('/api/v1/clothing?category=dresses');
    expect(dresses.body.items.every((i: { category: string }) => i.category === 'dresses')).toBe(
      true,
    );
    const denim = await browser(app).get('/api/v1/clothing?q=denim');
    expect(denim.body.items).toHaveLength(1);
    const bad = await browser(app).get('/api/v1/clothing?category=hats');
    expect(bad.status).toBe(400);
  });

  it('serves catalog images as PNG and 404s unknown ids', async () => {
    const { app } = buildTestApp();
    const ok = await browser(app).get('/api/v1/clothing/jacket-denim/image');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('image/png');
    expect((await browser(app).get('/api/v1/clothing/does-not-exist')).status).toBe(404);
  });

  it('rejects path traversal style ids', async () => {
    const { app } = buildTestApp();
    const res = await browser(app).get('/api/v1/clothing/..%2f..%2fpackage.json/image');
    expect([400, 404]).toContain(res.status);
  });

  it('accepts a user garment, keeps it private to that guest, and can delete it', async () => {
    const { app } = buildTestApp();
    const alice = browser(app);
    const png = await makeImage('png');
    const created = await alice
      .post('/api/v1/clothing')
      .field('name', 'My hoodie')
      .field('category', 'tops')
      .attach('image', png, { filename: 'hoodie.png', contentType: 'image/png' });
    expect(created.status).toBe(201);
    expect(created.body.item.source).toBe('user');
    const id = created.body.item.id as string;

    expect((await alice.get(`/api/v1/clothing/${id}/image`)).status).toBe(200);
    const bob = browser(app);
    expect((await bob.get(`/api/v1/clothing/${id}`)).status).toBe(404);
    expect((await bob.get('/api/v1/clothing')).body.items).toHaveLength(10);
    expect((await bob.delete(`/api/v1/clothing/${id}`)).status).toBe(404);

    expect((await alice.delete(`/api/v1/clothing/${id}`)).status).toBe(204);
    expect((await alice.get(`/api/v1/clothing/${id}`)).status).toBe(404);
  });

  it('validates uploaded garment content, type and size', async () => {
    const { app } = buildTestApp({ MAX_UPLOAD_MB: '1' });
    const agent = browser(app);
    const fake = await agent
      .post('/api/v1/clothing')
      .field('name', 'Fake')
      .field('category', 'tops')
      .attach('image', Buffer.from('<?php echo 1; ?>'), {
        filename: 'x.png',
        contentType: 'image/png',
      });
    expect(fake.status).toBe(415);
    expect(fake.body.error.code).toBe('UNSUPPORTED_IMAGE');

    const gif = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#fff' },
    })
      .gif()
      .toBuffer();
    const notAllowed = await agent
      .post('/api/v1/clothing')
      .field('name', 'Gif')
      .field('category', 'tops')
      .attach('image', gif, { filename: 'x.png', contentType: 'image/png' });
    expect(notAllowed.status).toBe(415);

    const big = Buffer.concat([await makeImage('png'), Buffer.alloc(1.2 * 1024 * 1024)]);
    const tooBig = await agent
      .post('/api/v1/clothing')
      .field('name', 'Big')
      .field('category', 'tops')
      .attach('image', big, { filename: 'x.png', contentType: 'image/png' });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe('FILE_TOO_LARGE');

    const noName = await agent
      .post('/api/v1/clothing')
      .field('category', 'tops')
      .attach('image', await makeImage(), { filename: 'x.png', contentType: 'image/png' });
    expect(noName.status).toBe(400);
  });
});

describe('try-on (mock provider)', () => {
  it('runs the full flow and clearly labels the result as a simulation', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    const person = await makeImage('jpeg', 400, 600, '#cc8866');

    const created = await agent
      .post('/api/v1/try-on')
      .field('category', 'outerwear')
      .field('clothingId', 'jacket-denim')
      .attach('person', person, { filename: 'me.jpg', contentType: 'image/jpeg' });
    expect(created.status).toBe(202);
    expect(created.body.tryOn).toMatchObject({
      status: 'processing',
      simulated: true,
      provider: 'mock',
      clothingName: 'Denim Jacket',
      resultUrl: null,
    });

    const done = await waitForTryOn(agent, created.body.tryOn.id);
    expect(done.status).toBe('completed');
    expect(done.simulated).toBe(true);

    const image = await agent.get(done.resultUrl);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.headers['cache-control']).toContain('no-store');
    const meta = await sharp(image.body).metadata();
    expect(meta.width).toBe(768);
  });

  it('accepts a one-off uploaded garment instead of a catalog id', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    const res = await agent
      .post('/api/v1/try-on')
      .field('category', 'tops')
      .attach('person', await makeImage(), { filename: 'me.png', contentType: 'image/png' })
      .attach('garment', await makeImage('png', 256, 256, '#112233'), {
        filename: 'g.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(202);
    expect((await waitForTryOn(agent, res.body.tryOn.id)).status).toBe('completed');
  });

  it('validates the request', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    const png = await makeImage();
    const send = () => agent.post('/api/v1/try-on').field('category', 'tops');

    expect((await send().field('clothingId', 'jacket-denim')).status).toBe(400); // no person
    expect((await send().attach('person', png, 'me.png')).status).toBe(400); // no garment
    const both = await send()
      .field('clothingId', 'jacket-denim')
      .attach('person', png, 'me.png')
      .attach('garment', png, 'g.png');
    expect(both.status).toBe(400);
    const fake = await send()
      .field('clothingId', 'jacket-denim')
      .attach('person', Buffer.from('not an image at all'), {
        filename: 'me.png',
        contentType: 'image/png',
      });
    expect(fake.status).toBe(415);
    const tiny = await send()
      .field('clothingId', 'jacket-denim')
      .attach('person', await makeImage('png', 20, 20), 'me.png');
    expect(tiny.status).toBe(422);
    const unknownGarment = await send()
      .field('clothingId', 'ghost-item')
      .attach('person', png, 'me.png');
    expect(unknownGarment.status).toBe(404);
    const injected = await send()
      .field('clothingId', 'jacket-denim')
      .field('userId', 'someone-else')
      .attach('person', png, 'me.png');
    expect(injected.status).toBe(400); // client-supplied user ids are rejected, not trusted
  });

  it('does not let another guest read a try-on or its image', async () => {
    const { app } = buildTestApp();
    const alice = browser(app);
    const created = await alice
      .post('/api/v1/try-on')
      .field('category', 'outerwear')
      .field('clothingId', 'jacket-denim')
      .attach('person', await makeImage(), 'me.png');
    const id = created.body.tryOn.id as string;
    await waitForTryOn(alice, id);

    const mallory = browser(app);
    expect((await mallory.get(`/api/v1/try-on/${id}`)).status).toBe(404);
    expect((await mallory.get(`/api/v1/try-on/${id}/image`)).status).toBe(404);
    expect((await mallory.get('/api/v1/history')).body.items).toHaveLength(0);
  });

  it('limits a guest to one concurrent generation', async () => {
    const slow = new MockProvider(300);
    const { app } = buildTestApp({}, { provider: slow });
    const agent = browser(app);
    const png = await makeImage();
    const start = () =>
      agent
        .post('/api/v1/try-on')
        .field('category', 'tops')
        .field('clothingId', 'tee-graphite')
        .attach('person', png, 'me.png');
    const first = await start();
    expect(first.status).toBe(202);
    const second = await start();
    expect(second.status).toBe(429);
    await waitForTryOn(agent, first.body.tryOn.id);
  });
});

describe('try-on (external provider behaviour)', () => {
  const run = async (provider: VirtualTryOnProvider, extra: Record<string, string> = {}) => {
    const { app } = buildTestApp(extra, { provider });
    const agent = browser(app);
    const req = agent
      .post('/api/v1/try-on')
      .field('category', 'tops')
      .field('clothingId', 'tee-graphite')
      .attach('person', await makeImage(), 'me.png');
    return { agent, req };
  };

  it('requires explicit consent before photos leave the server', async () => {
    const { req } = await run(stubProvider({ generate: async () => ({}) }));
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('records quota exhaustion as a failed try-on with a clear code', async () => {
    const { agent, req } = await run(
      stubProvider({
        generate: async () => {
          throw new AppError(429, 'AI_QUOTA_EXHAUSTED', 'quota');
        },
      }),
    );
    const res = await req.field('consent', 'true');
    expect(res.status).toBe(202);
    const done = await waitForTryOn(agent, res.body.tryOn.id);
    expect(done).toMatchObject({
      status: 'failed',
      resultUrl: null,
      error: { code: 'AI_QUOTA_EXHAUSTED' },
    });
  });

  it('times out slow models', async () => {
    const { agent, req } = await run(
      stubProvider({ generate: () => new Promise(() => undefined) }),
      { AI_TIMEOUT_MS: '1000' },
    );
    const res = await req.field('consent', 'true');
    const done = await waitForTryOn(agent, res.body.tryOn.id, 4000);
    expect(done.error.code).toBe('AI_TIMEOUT');
  });

  it('rejects provider output that is not a real image', async () => {
    const { agent, req } = await run(
      stubProvider({ generate: async () => ({ imageBuffer: Buffer.from('garbage') }) }),
    );
    const res = await req.field('consent', 'true');
    const done = await waitForTryOn(agent, res.body.tryOn.id);
    expect(done.status).toBe('failed');
    expect(done.error.code).toBe('AI_FAILED');
  });

  it('fails cleanly when the provider is not configured', async () => {
    const { agent, req } = await run(
      stubProvider({ isConfigured: () => false, generate: async () => ({}) }),
    );
    const res = await req.field('consent', 'true');
    const done = await waitForTryOn(agent, res.body.tryOn.id);
    expect(done.error.code).toBe('AI_UNAVAILABLE');
  });
});

describe('history, favorites and profile', () => {
  async function completedTryOn(agent: ReturnType<typeof browser>) {
    const created = await agent
      .post('/api/v1/try-on')
      .field('category', 'tops')
      .field('clothingId', 'tee-graphite')
      .attach('person', await makeImage(), 'me.png');
    return waitForTryOn(agent, created.body.tryOn.id);
  }

  it('lists history newest first and deletes entries including the image', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    const t = await completedTryOn(agent);
    const list = await agent.get('/api/v1/history');
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([t.id]);
    expect((await agent.delete(`/api/v1/history/${t.id}`)).status).toBe(204);
    expect((await agent.get(`/api/v1/try-on/${t.id}/image`)).status).toBe(404);
    expect((await agent.delete(`/api/v1/history/${t.id}`)).status).toBe(404);
  });

  it('adds, lists and removes favorites idempotently and privately', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    const t = await completedTryOn(agent);
    const a = await agent.post('/api/v1/favorites').send({ tryOnId: t.id });
    const b = await agent.post('/api/v1/favorites').send({ tryOnId: t.id });
    expect(a.status).toBe(201);
    expect(b.body.favorite.id).toBe(a.body.favorite.id);
    expect((await agent.get('/api/v1/favorites')).body.items).toHaveLength(1);

    const other = browser(app);
    expect((await other.post('/api/v1/favorites').send({ tryOnId: t.id })).status).toBe(404);
    expect((await other.delete(`/api/v1/favorites/${a.body.favorite.id}`)).status).toBe(404);

    expect((await agent.delete(`/api/v1/favorites/${a.body.favorite.id}`)).status).toBe(204);
    expect((await agent.get('/api/v1/favorites')).body.items).toHaveLength(0);
  });

  it('stores profile data per guest, validates it, and erases everything on request', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    expect((await agent.get('/api/v1/profile')).body.profile.heightCm).toBeNull();
    const bad = await agent.patch('/api/v1/profile').send({ heightCm: 3 });
    expect(bad.status).toBe(400);
    const ok = await agent
      .patch('/api/v1/profile')
      .send({ heightCm: 178, preferredCategories: ['tops'], privacy: { rememberAiConsent: true } });
    expect(ok.body.profile).toMatchObject({ heightCm: 178, privacy: { rememberAiConsent: true } });
    expect((await browser(app).get('/api/v1/profile')).body.profile.heightCm).toBeNull();

    const t = await completedTryOn(agent);
    await agent.post('/api/v1/favorites').send({ tryOnId: t.id });
    expect((await agent.delete('/api/v1/profile')).status).toBe(204);
    expect((await agent.get('/api/v1/profile')).body.profile.heightCm).toBeNull();
    expect((await agent.get('/api/v1/history')).body.items).toHaveLength(0);
    expect((await agent.get('/api/v1/favorites')).body.items).toHaveLength(0);
  });

  it('purges expired results but keeps favorited ones', async () => {
    const { app, container } = buildTestApp();
    const agent = browser(app);
    const keep = await completedTryOn(agent);
    await agent.post('/api/v1/favorites').send({ tryOnId: keep.id });
    const drop = await completedTryOn(agent);
    await new Promise((r) => setTimeout(r, 20));
    const removed = await container.tryOns.purgeExpired(5, (id) =>
      container.favorites.isFavorited(id),
    );
    expect(removed).toEqual([drop.id]);
    expect((await agent.get(`/api/v1/try-on/${keep.id}/image`)).status).toBe(200);
    expect((await agent.get(`/api/v1/try-on/${drop.id}`)).status).toBe(404);
  });
});
