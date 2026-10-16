import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { browser, buildTestApp } from './test/helpers';
import { loadEnv } from './config/env';
import { memoryCollectionFactory } from './db/collection';
import {
  ModelRegistry,
  defaultDescriptors,
  type HealthProbe,
  type ModelDescriptor,
} from './modules/orchestrator/registry';
import { ResourceMonitor, type ResourceSample } from './modules/orchestrator/resources';
import { classifyTask, routeTask } from './modules/orchestrator/router';
import { ToolRegistry } from './modules/orchestrator/tools';
import {
  KnowledgeService,
  LexicalHashEmbedder,
  chunkText,
  type EmbeddingProvider,
} from './modules/orchestrator/knowledge';

const env = loadEnv({ NODE_ENV: 'test' });
const sample = (freeGb: number): ResourceSample => ({
  totalRamBytes: 8 * 1024 ** 3,
  freeRamBytes: freeGb * 1024 ** 3,
  freeDiskBytes: 100 * 1024 ** 3,
  loadAverage: [0, 0, 0],
  cpuCount: 4,
  sampledAt: new Date().toISOString(),
});
const healthy: HealthProbe = async () => ({ healthy: true, reason: 'ok' });
const signal = () => new AbortController().signal;

describe('task classification and routing', () => {
  it('classifies deterministically', () => {
    expect(classifyTask({ message: 'hello there' }).capability).toBe('text');
    expect(classifyTask({ message: 'what is this', hasImage: true }).capability).toBe('vision');
    expect(classifyTask({ message: 'remove the background', hasImage: true }).capability).toBe(
      'image-editing',
    );
    expect(classifyTask({ message: 'x', mode: 'image' }).capability).toBe('image-generation');
    expect(classifyTask({ message: 'draw a picture of a red coat' }).capability).toBe(
      'image-generation',
    );
    expect(classifyTask({ message: 'fix this TypeScript function' }).capability).toBe('code');
    expect(classifyTask({ message: 'can I try on this jacket' }).capability).toBe('virtual-try-on');
  });

  it('routes text to the default Qwen model and never invents unavailable capabilities', async () => {
    const registry = new ModelRegistry(defaultDescriptors(env), {
      'nova-text-qwen': async () => ({ healthy: true, reason: 'ready' }),
    });
    const text = await routeTask(registry, { message: 'hello' });
    expect(text).toMatchObject({ status: 'routed', model: { id: 'nova-text-qwen' } });
    const vision = await routeTask(registry, { message: 'describe', hasImage: true });
    expect(vision).toMatchObject({ status: 'unavailable', capability: 'vision' });
    const speech = await routeTask(registry, { message: 'please transcribe this' });
    expect(speech).toMatchObject({ status: 'unavailable', planned: true });
  });

  it('degrades code to text only with an explicit label, and not when a model is pinned', async () => {
    const registry = new ModelRegistry(defaultDescriptors(env), { 'nova-text-qwen': healthy });
    const routed = await routeTask(registry, { message: 'refactor this python function' });
    expect(routed).toMatchObject({ status: 'fallback', degraded: true });
    const pinned = await routeTask(
      registry,
      { message: 'refactor this python function' },
      { modelId: 'planned-code' },
    );
    expect(pinned.status).toBe('unavailable');
  });
});

describe('provider failures and switching', () => {
  it('reports an unhealthy provider instead of routing to it', async () => {
    const registry = new ModelRegistry(defaultDescriptors(env), {
      'nova-text-qwen': async () => ({ healthy: false, reason: 'runtime stopped' }),
    });
    const decision = await routeTask(registry, { message: 'hello' });
    expect(decision).toMatchObject({ status: 'unavailable' });
    expect(decision.reason).toContain('runtime stopped');
  });

  it('treats a throwing or hanging probe as unhealthy', async () => {
    const registry = new ModelRegistry(defaultDescriptors(env), {
      'nova-text-qwen': async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect((await registry.check('nova-text-qwen', true)).status).toBe('unhealthy');
    // A probe that never answers (busy CPU model) must neither block routing nor condemn the model.
    const hanging = new ModelRegistry(defaultDescriptors(env), {
      'nova-text-qwen': () => new Promise(() => undefined),
    });
    const started = Date.now();
    expect((await hanging.check('nova-text-qwen', true)).status).toBe('unknown');
    expect(Date.now() - started).toBeLessThan(6000);
    expect(await hanging.resolve('text')).toMatchObject({ ok: true });
  });

  it('switches to a newly registered provider and honors configuration', async () => {
    const configured = loadEnv({
      NODE_ENV: 'test',
      NOVA_VISION_URL: 'https://gpu.example.org',
      NOVA_IMAGE_URL: 'http://127.0.0.1:8090',
      NOVA_IMAGE_EXTERNAL: 'false',
    });
    const descriptors = defaultDescriptors(configured);
    expect(descriptors.find((d) => d.id === 'nova-vision-smolvlm')).toMatchObject({
      state: 'enabled',
      execution: 'remote',
    });
    expect(descriptors.find((d) => d.id === 'nova-image-ssd1b')?.execution).toBe('local');
    const registry = new ModelRegistry(descriptors, { 'nova-vision-smolvlm': healthy });
    const alt: ModelDescriptor = {
      ...descriptors.find((d) => d.id === 'nova-vision-smolvlm')!,
      id: 'alt-vision',
      name: 'Alternative vision',
      isDefault: false,
    };
    registry.register(alt, healthy);
    expect(
      (await registry.resolve('vision')).ok && (await registry.resolve('vision')),
    ).toMatchObject({
      model: { id: 'nova-vision-smolvlm' },
    });
    expect(await registry.resolve('vision', { modelId: 'alt-vision' })).toMatchObject({
      ok: true,
      model: { id: 'alt-vision' },
    });
    expect(() => registry.register(alt)).toThrow(/Duplicate/);
  });

  it('refuses lazily-loaded models when free RAM is insufficient', async () => {
    const base = defaultDescriptors(env).find((d) => d.id === 'nova-vision-smolvlm')!;
    const lazy: ModelDescriptor = { ...base, state: 'enabled', loadsOnDemand: true };
    const low = new ModelRegistry(
      [lazy],
      { [lazy.id]: healthy },
      new ResourceMonitor(async () => sample(1)),
    );
    const refused = await low.resolve('vision');
    expect(refused).toMatchObject({ ok: false });
    expect(refused.ok ? '' : refused.reason).toMatch(/Insufficient free RAM/);
    const roomy = new ModelRegistry(
      [lazy],
      { [lazy.id]: healthy },
      new ResourceMonitor(async () => sample(16)),
    );
    expect((await roomy.resolve('vision')).ok).toBe(true);
  });

  it('never marks the planned or unconfigured models as available', () => {
    const states = new Map(defaultDescriptors(env).map((d) => [d.id, d.state]));
    expect(states.get('planned-stt')).toBe('planned');
    expect(states.get('nova-vision-smolvlm')).toBe('unconfigured');
    expect(states.get('nova-image-ssd1b')).toBe('unconfigured');
    expect(defaultDescriptors(env).find((d) => d.id === 'virtualfit-try-on')?.simulated).toBe(true);
  });
});

describe('tool permissions', () => {
  const tools = (enabled: string[]) => {
    const registry = new ToolRegistry(new Set(enabled));
    let writes = 0;
    registry.register({
      name: 'notes.write',
      description: 'test write',
      risk: 'write',
      schema: z.object({ text: z.string() }),
      timeoutMs: 1000,
      run: async () => ++writes,
    });
    registry.register({
      name: 'files.read',
      description: 'test read',
      risk: 'read',
      schema: z.object({}),
      timeoutMs: 1000,
      run: async () => 'ok',
    });
    registry.register({
      name: 'slow.read',
      description: 'test slow',
      risk: 'read',
      schema: z.object({}),
      timeoutMs: 50,
      run: (_i, ctx) =>
        new Promise((_, reject) =>
          ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason)),
        ),
    });
    return { registry, writes: () => writes };
  };

  it('denies everything by default', async () => {
    const { registry } = tools([]);
    await expect(
      registry.invoke('files.read', {}, { ownerId: 'a', signal: signal() }),
    ).rejects.toMatchObject({ status: 403 });
    expect(registry.auditLog('a')[0]).toMatchObject({ outcome: 'denied' });
  });

  it('runs enabled read-only tools without approval', async () => {
    const { registry } = tools(['files.read']);
    await expect(
      registry.invoke('files.read', {}, { ownerId: 'a', signal: signal() }),
    ).resolves.toBe('ok');
  });

  it('blocks writes without a confirmed, matching, single-use approval', async () => {
    const { registry, writes } = tools(['notes.write']);
    const ctx = { ownerId: 'a', signal: signal() };
    await expect(registry.invoke('notes.write', { text: 'x' }, ctx)).rejects.toMatchObject({
      status: 403,
    });
    const { approvalId } = registry.requestApproval('a', 'notes.write', { text: 'x' });
    // Requested but not confirmed by the user yet.
    await expect(
      registry.invoke('notes.write', { text: 'x' }, { ...ctx, approvalId }),
    ).rejects.toMatchObject({ status: 403 });
    // Another user cannot confirm it.
    expect(() => registry.confirm('b', approvalId)).toThrow();
    registry.confirm('a', approvalId);
    // Different input than the one approved.
    await expect(
      registry.invoke('notes.write', { text: 'changed' }, { ...ctx, approvalId }),
    ).rejects.toMatchObject({ status: 403 });
    // Another user cannot use it.
    await expect(
      registry.invoke('notes.write', { text: 'x' }, { ownerId: 'b', signal: signal(), approvalId }),
    ).rejects.toMatchObject({ status: 403 });
    expect(writes()).toBe(0);
    await expect(
      registry.invoke('notes.write', { text: 'x' }, { ...ctx, approvalId }),
    ).resolves.toBe(1);
    // Single use.
    await expect(
      registry.invoke('notes.write', { text: 'x' }, { ...ctx, approvalId }),
    ).rejects.toMatchObject({ status: 403 });
    expect(writes()).toBe(1);
  });

  it('enforces timeouts and propagates cancellation', async () => {
    const { registry } = tools(['slow.read']);
    await expect(
      registry.invoke('slow.read', {}, { ownerId: 'a', signal: signal() }),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    const control = new AbortController();
    const pending = registry.invoke('slow.read', {}, { ownerId: 'a', signal: control.signal });
    control.abort(new Error('user stopped'));
    await expect(pending).rejects.toThrow('user stopped');
    expect(registry.auditLog('a').map((e) => e.outcome)).toEqual(['timeout', 'cancelled']);
  });

  it('validates tool input before running', async () => {
    const { registry } = tools(['notes.write']);
    expect(() => registry.requestApproval('a', 'notes.write', { text: 5 })).toThrow();
  });
});

describe('knowledge and memory isolation', () => {
  const service = (embedder?: EmbeddingProvider) =>
    new KnowledgeService(memoryCollectionFactory, embedder);
  const doc = (title: string, content: string, consent = true) => ({
    title,
    content,
    mimeType: 'text/plain',
    consent,
  });

  it('chunks long text with overlap and keeps short text whole', () => {
    expect(chunkText('short note')).toEqual(['short note']);
    const long = Array.from(
      { length: 60 },
      (_, i) => `Sentence number ${i} about linen shirts.`,
    ).join(' ');
    const chunks = chunkText(long, 300, 50);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
  });

  it('requires consent and refuses unsupported formats', async () => {
    const k = service();
    await expect(k.ingest('a', doc('t', 'text', false), signal())).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      k.ingest('a', { ...doc('t', 'text'), mimeType: 'application/pdf' }, signal()),
    ).rejects.toThrow(/not implemented/);
    expect(await k.list('a')).toEqual([]);
  });

  it('retrieves attributed sources, isolates owners and deletes completely', async () => {
    const k = service();
    const mine = await k.ingest(
      'a',
      doc(
        'Care guide',
        'Wash linen shirts cold and hang them to dry.\n\nIron wool coats on low heat.',
      ),
      signal(),
    );
    await k.ingest('b', doc('Secret', 'Linen shirts password hunter2 belongs to user b'), signal());
    const hits = await k.search('a', 'how to wash linen shirts', signal());
    expect(hits[0]).toMatchObject({ docId: mine.id, title: 'Care guide' });
    expect(hits.every((h) => h.title !== 'Secret')).toBe(true);
    expect(JSON.stringify(hits)).not.toContain('hunter2');
    await expect(k.remove('b', mine.id)).rejects.toMatchObject({ status: 404 });
    await k.remove('a', mine.id);
    expect(await k.search('a', 'wash linen shirts', signal())).toEqual([]);
    expect((await k.search('b', 'linen shirts', signal())).length).toBe(1);
    await k.erase('b');
    expect(await k.search('b', 'linen shirts', signal())).toEqual([]);
  });

  it('never mixes vector spaces when the embedder is switched', async () => {
    const k = service();
    await k.ingest('a', doc('Old', 'alpha beta gamma delta'), signal());
    const other: EmbeddingProvider = {
      id: 'test-embedder-2',
      dimensions: 2,
      semantic: true,
      embed: async (texts) => texts.map(() => [1, 0]),
    };
    k.useEmbedder(other);
    expect(await k.search('a', 'alpha beta', signal())).toEqual([]);
    expect((await k.list('a'))[0]).toMatchObject({ stale: true });
    await k.ingest('a', doc('New', 'anything'), signal());
    expect((await k.search('a', 'q', signal()))[0]).toMatchObject({ title: 'New' });
  });

  it('honors cancellation during embedding and labels the built-in embedder as non-semantic', async () => {
    const control = new AbortController();
    control.abort();
    await expect(new LexicalHashEmbedder().embed(['x'], control.signal)).rejects.toBeDefined();
    expect(new LexicalHashEmbedder().semantic).toBe(false);
  });
});

describe('orchestrator HTTP API', () => {
  it('lists models, routes honestly and keeps tools disabled by default', async () => {
    const { app } = buildTestApp();
    const a = browser(app);
    const models = await a.get('/api/v1/nova/models');
    expect(models.status).toBe(200);
    const ids = models.body.map((m: { id: string; state: string }) => `${m.id}:${m.state}`);
    expect(ids).toContain('nova-text-qwen:enabled');
    expect(ids).toContain('nova-vision-smolvlm:unconfigured');
    const route = await a
      .post('/api/v1/nova/route')
      .send({ message: 'describe this', hasImage: true });
    expect(route.body).toMatchObject({ status: 'unavailable', capability: 'vision' });
    const tool = await a.post('/api/v1/nova/tools/system.resources/invoke').send({ input: {} });
    expect(tool.status).toBe(403);
    expect((await a.get('/api/v1/nova/resources')).body.totalRamBytes).toBeGreaterThan(0);
    expect((await a.post('/api/v1/nova/route').send({ message: '' })).status).toBe(400);
  });

  it('runs an operator-enabled read-only tool', async () => {
    const { app } = buildTestApp({ NOVA_TOOLS_ENABLED: 'system.resources' });
    const res = await browser(app)
      .post('/api/v1/nova/tools/system.resources/invoke')
      .send({ input: {} });
    expect(res.status).toBe(200);
    expect(res.body.result.cpuCount).toBeGreaterThan(0);
  });

  it('isolates, searches and deletes knowledge per browser session', async () => {
    const { app } = buildTestApp();
    const a = browser(app);
    const b = browser(app);
    const refused = await a
      .post('/api/v1/nova/knowledge')
      .send({ title: 'x', content: 'text', consent: false });
    expect(refused.status).toBe(400);
    const created = await a
      .post('/api/v1/nova/knowledge')
      .send({ title: 'Notes', content: 'Black formal suits need tailoring.', consent: true });
    expect(created.status).toBe(201);
    expect(created.body.ownerId).toBeUndefined();
    const found = await a
      .post('/api/v1/nova/knowledge/search')
      .send({ query: 'formal suits tailoring' });
    expect(found.body.hits[0]).toMatchObject({ title: 'Notes' });
    expect(found.body.embedder.semantic).toBe(false);
    expect(
      (await b.post('/api/v1/nova/knowledge/search').send({ query: 'formal suits' })).body.hits,
    ).toEqual([]);
    expect((await b.delete(`/api/v1/nova/knowledge/${created.body.id}`)).status).toBe(404);
    expect((await a.delete(`/api/v1/nova/knowledge/${created.body.id}`)).status).toBe(204);
    expect((await a.get('/api/v1/nova/knowledge')).body.documents).toEqual([]);
  });

  it("erases knowledge with the rest of a user's data", async () => {
    const { app } = buildTestApp();
    const a = browser(app);
    await a
      .post('/api/v1/nova/knowledge')
      .send({ title: 'Notes', content: 'remember linen', consent: true });
    const before = await a.get('/api/v1/nova/knowledge');
    expect(before.body.documents).toHaveLength(1);
    await a.delete('/api/v1/profile');
    const after = await browser(app).get('/api/v1/nova/knowledge');
    expect(after.body.documents).toEqual([]);
  });
});
