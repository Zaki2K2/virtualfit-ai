import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { memoryCollectionFactory, type CollectionFactory } from './db/collection';
import { isDatabaseUnavailable } from './utils/errors';
import { isPortInUse } from './utils/port';
import { browser, buildTestApp, makeImage, waitForTryOn } from './test/helpers';

/** Regression tests for "API down / HTTP 500" failure modes. */

describe('core endpoints (the ones that returned 500 in the browser)', () => {
  it('health, clothing and profile answer 200 with the documented JSON shapes', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);

    const health = await agent.get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.headers['content-type']).toMatch(/json/);
    expect(health.body).toMatchObject({ status: 'ok', database: 'memory', databaseUp: true });
    expect(health.body.ai.options.length).toBe(4);

    const clothing = await agent.get('/api/v1/clothing');
    expect(clothing.status).toBe(200);
    expect(clothing.body.items.length).toBeGreaterThan(0);
    expect(clothing.body.items[0]).toMatchObject({
      id: expect.any(String),
      imageUrl: expect.stringContaining('/image'),
    });

    const profile = await agent.get('/api/v1/profile');
    expect(profile.status).toBe(200);
    expect(profile.body.profile).toMatchObject({ heightCm: null, preferredCategories: [] });
  });

  it('issues a guest session cookie once and reuses it (profile is per guest)', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    const first = await agent.get('/api/v1/profile');
    expect(first.headers['set-cookie']?.[0]).toMatch(/vf_guest=[A-Za-z0-9]{32}.*HttpOnly/);
    await agent.patch('/api/v1/profile').send({ heightCm: 180 });
    const second = await agent.get('/api/v1/profile');
    expect(second.headers['set-cookie']).toBeUndefined(); // cookie reused, not re-issued
    expect(second.body.profile.heightCm).toBe(180);
    expect((await browser(app).get('/api/v1/profile')).body.profile.heightCm).toBeNull();
  });
});

describe('database failures', () => {
  const failingFactory = ((name, schema) => {
    const real = memoryCollectionFactory(name, schema);
    const down = () => {
      const e = new Error('connect ECONNREFUSED 127.0.0.1:27017');
      e.name = 'MongoServerSelectionError';
      throw e;
    };
    return { ...real, get: down, find: down, insert: down, update: down, remove: down };
  }) as CollectionFactory;

  it('recognises database-unreachable errors and nothing else', () => {
    const named = (name: string, message = 'x') => Object.assign(new Error(message), { name });
    expect(isDatabaseUnavailable(named('MongoServerSelectionError'))).toBe(true);
    expect(isDatabaseUnavailable(named('MongoNetworkError'))).toBe(true);
    expect(
      isDatabaseUnavailable(
        named('MongooseError', 'Operation `users.findOne()` buffering timed out after 5000ms'),
      ),
    ).toBe(true);
    expect(isDatabaseUnavailable(named('MongooseError', 'something unrelated'))).toBe(false);
    expect(isDatabaseUnavailable(new TypeError('x is not a function'))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
  });

  it('turns a dead database into a clear 503 instead of an opaque 500, and keeps health alive', async () => {
    const { app } = buildTestApp(
      {},
      { collections: failingFactory, database: 'mongodb', databaseUp: () => false },
    );
    const agent = browser(app);
    for (const path of [
      '/api/v1/profile',
      '/api/v1/history',
      '/api/v1/favorites',
      '/api/v1/clothing', // also lists the guest's own uploads, so it needs the database too
    ]) {
      const res = await agent.get(path);
      expect(res.status, path).toBe(503);
      expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
      expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|stack|27017/); // no internals leaked
    }
    // sample-catalog images are files, so they still load
    expect((await agent.get('/api/v1/clothing/jacket-denim/image')).status).toBe(200);
    const health = await agent.get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: 'degraded', databaseUp: false });
  });

  it('keeps genuine bugs as 500 INTERNAL_ERROR without leaking details', async () => {
    const buggy: CollectionFactory = (name, schema) => ({
      ...memoryCollectionFactory(name, schema),
      get: async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'secret')");
      },
    });
    const { app } = buildTestApp({}, { collections: buggy });
    const res = await browser(app).get('/api/v1/profile');
    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
  });
});

describe('port guard', () => {
  it('detects a process that already owns the port (Windows lets a second one bind silently)', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as net.AddressInfo;
    expect(await isPortInUse(port)).toBe(true);
    await new Promise<void>((r) => server.close(() => r()));
    expect(await isPortInUse(port)).toBe(false);
  });
});

describe('restart and cleanup behaviour', () => {
  const hanging = {
    id: 'gradio' as const,
    model: 'test/hang',
    simulated: false,
    externalProcessing: false,
    allowedImageHosts: [],
    isConfigured: () => true,
    generate: () => new Promise<never>(() => undefined), // a job that dies with its process
  };

  async function submit(agent: ReturnType<typeof browser>) {
    return agent
      .post('/api/v1/try-on')
      .field('category', 'tops')
      .field('clothingId', 'tee-graphite')
      .attach('person', await makeImage(), 'me.png');
  }

  it('marks jobs left "processing" by a previous process as failed at startup', async () => {
    const { app, container } = buildTestApp({}, { provider: hanging });
    const agent = browser(app);
    const created = await submit(agent);
    expect(created.status).toBe(202);
    expect((await agent.get(`/api/v1/try-on/${created.body.tryOn.id}`)).body.tryOn.status).toBe(
      'processing',
    );
    expect((await submit(agent)).status).toBe(429); // blocked by the stuck job

    expect(await container.tryOns.failInterrupted()).toBe(1); // what a restart does

    const after = (await agent.get(`/api/v1/try-on/${created.body.tryOn.id}`)).body.tryOn;
    expect(after).toMatchObject({ status: 'failed', resultUrl: null });
    expect(after.error.message).toMatch(/restarted/);
    expect((await submit(agent)).status).toBe(202); // the guest can try again immediately
  });

  it('deletes result images whose record is gone, keeps those still referenced', async () => {
    const { app, container } = buildTestApp();
    const agent = browser(app);
    const created = await agent
      .post('/api/v1/try-on')
      .field('category', 'tops')
      .field('clothingId', 'tee-graphite')
      .attach('person', await makeImage(), 'me.png');
    const kept = await waitForTryOn(agent, created.body.tryOn.id);
    const orphanId = 'orphan0123456789abcdef';
    await container.files.save('results', orphanId, 'png', Buffer.from('personal image'));

    await new Promise((r) => setTimeout(r, 20));
    await container.tryOns.purgeExpired(5, async () => true); // everything protected from doc purge

    expect(await container.files.read('results', orphanId, 'png')).toBeNull();
    expect((await agent.get(kept.resultUrl)).status).toBe(200);
  });
});
