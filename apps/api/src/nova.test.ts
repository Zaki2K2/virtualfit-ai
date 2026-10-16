import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { browser, buildTestApp, makeImage } from './test/helpers';
import type {
  ChatTurn,
  NovaLanguageProvider,
  NovaVisionProvider,
  NovaImageProvider,
} from './modules/nova/providers';
import type { StylingProvider } from './integrations/slm/styling-provider';
import { InferenceQueue } from './modules/nova/queue';
import { CompatibleVision, CompatibleImages } from './modules/nova/providers';
import { loadEnv } from './config/env';
import { reviewedTrainingRecord } from './modules/nova/training';
import type { TrainingExample } from './modules/nova/models';

afterEach(() => vi.unstubAllGlobals());

const ready: StylingProvider = {
  status: async () => ({
    available: true,
    provider: 'llama-cpp',
    model: 'virtualfit-style-base',
    reason: 'Test adapter',
    local: true,
    customization: 'prompt-and-wardrobe-grounding',
  }),
  recommend: async () => ({
    answer: 'Blue shirt.',
    itemIds: ['shirt-oxford-blue'],
    occasion: 'formal',
    categories: ['tops'],
  }),
};
const language: NovaLanguageProvider = {
  async *stream() {
    yield 'Hello ';
    yield 'from Nova.';
  },
};
const setup = (options = {}) =>
  buildTestApp({}, { stylingProvider: ready, novaLanguage: language, ...options });
async function conversation(agent: ReturnType<typeof browser>) {
  const res = await agent.post('/api/v1/nova/conversations').send({});
  expect(res.status).toBe(201);
  return res.body.id as string;
}
async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Test job did not finish');
}

describe('Nova conversations and local chat', () => {
  it('searches message content within the current guest only', async () => {
    const { app } = setup();
    const a = browser(app);
    const other = browser(app);
    const id = await conversation(a);
    await a
      .post('/api/v1/nova/chat')
      .send({ conversationId: id, message: 'Remember the violet notebook topic.' });
    await a.patch(`/api/v1/nova/conversations/${id}`).send({ title: 'An unrelated title' });
    expect(
      (await a.get('/api/v1/nova/conversations?q=violet')).body.map((c: { id: string }) => c.id),
    ).toEqual([id]);
    expect((await other.get('/api/v1/nova/conversations?q=violet')).body).toEqual([]);
  });
  it('streams deltas, persists completed messages and recovers the same history', async () => {
    const { app } = setup();
    const owner = browser(app);
    const id = await conversation(owner);
    const reply = await owner
      .post('/api/v1/nova/chat/stream')
      .send({ conversationId: id, message: 'Hello Nova' });
    expect(reply.headers['content-type']).toContain('text/event-stream');
    expect(reply.text).toContain('event: delta');
    expect(reply.text).toContain('Hello ');
    expect(reply.text).toContain('event: done');
    const restored = await owner.get(`/api/v1/nova/conversations/${id}`);
    expect(restored.body.messages).toHaveLength(2);
    expect(restored.body.messages[1]).toMatchObject({
      content: 'Hello from Nova.',
      status: 'completed',
      model: 'virtualfit-style-base',
    });
    expect(JSON.stringify(restored.body)).not.toContain('ownerId');
    expect((await owner.get('/api/v1/nova/conversations')).body[0].title).toBe('Hello Nova');
  });
  it('isolates read, rename, stop and deletion across guest sessions', async () => {
    const { app } = setup();
    const owner = browser(app);
    const other = browser(app);
    const id = await conversation(owner);
    expect((await other.get(`/api/v1/nova/conversations/${id}`)).status).toBe(404);
    expect(
      (await other.patch(`/api/v1/nova/conversations/${id}`).send({ title: 'stolen' })).status,
    ).toBe(404);
    expect((await other.post(`/api/v1/nova/conversations/${id}/stop`)).status).toBe(404);
    expect((await other.delete(`/api/v1/nova/conversations/${id}`)).status).toBe(404);
    expect(
      (await owner.patch(`/api/v1/nova/conversations/${id}`).send({ title: 'My style' })).body
        .title,
    ).toBe('My style');
    expect((await owner.delete(`/api/v1/nova/conversations/${id}`)).status).toBe(204);
    expect((await owner.get(`/api/v1/nova/conversations/${id}`)).status).toBe(404);
  });
  it('regenerates without duplicating the user turn and keeps superseded audit output', async () => {
    const { app } = setup();
    const agent = browser(app);
    const id = await conversation(agent);
    const input = { conversationId: id, message: 'Hello Nova' };
    await agent.post('/api/v1/nova/chat').send(input);
    expect(
      (await agent.post('/api/v1/nova/chat').send({ ...input, regenerate: true })).status,
    ).toBe(200);
    const { messages } = (await agent.get(`/api/v1/nova/conversations/${id}`)).body;
    expect(messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(1);
    expect(messages[1].metadata.superseded).toBe(true);
    expect(messages[2].status).toBe('completed');
  });
  it('keeps wardrobe requests on the validated existing provider', async () => {
    const { app } = setup();
    const a = browser(app);
    const id = await conversation(a);
    const result = await a
      .post('/api/v1/nova/chat')
      .send({ conversationId: id, message: 'Find a blue office shirt, no pants or dresses.' });
    expect(result.status).toBe(200);
    expect(result.body.metadata.itemIds).toEqual(['shirt-oxford-blue']);
  });
  it('reports failed inference without inventing assistant output', async () => {
    const { app } = setup({
      novaLanguage: {
        async *stream() {
          throw new Error('test runtime failure');
          yield '';
        },
      },
    });
    const a = browser(app);
    const id = await conversation(a);
    expect(
      (await a.post('/api/v1/nova/chat/stream').send({ conversationId: id, message: 'Hello Nova' }))
        .text,
    ).toContain('event: error');
    const rows = (await a.get(`/api/v1/nova/conversations/${id}`)).body.messages;
    expect(rows[1]).toMatchObject({ status: 'failed', content: '' });
  });
  it('stops real asynchronous work and saves partial text', async () => {
    const slow: NovaLanguageProvider = {
      async *stream(_turns, signal) {
        yield 'Partial answer';
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    };
    const { app, container } = setup({ novaLanguage: slow });
    const a = browser(app);
    const id = await conversation(a);
    const running = a
      .post('/api/v1/nova/chat')
      .send({ conversationId: id, message: 'Hello Nova' })
      .then((res) => res);
    await waitFor(async () => container.nova.queue.active === 1);
    expect((await a.post(`/api/v1/nova/conversations/${id}/stop`)).status).toBe(202);
    await running;
    const rows = (await a.get(`/api/v1/nova/conversations/${id}`)).body.messages;
    expect(rows[1]).toMatchObject({ status: 'cancelled', content: 'Partial answer' });
  });
  it('rejects cross-origin writes, spoofed ownership and body measurements', async () => {
    const { app } = setup();
    const a = browser(app);
    const id = await conversation(a);
    expect(
      (
        await a
          .post('/api/v1/nova/chat')
          .set('Origin', 'https://untrusted.invalid')
          .send({ conversationId: id, message: 'Hello' })
      ).status,
    ).toBe(403);
    expect(
      (
        await a
          .post('/api/v1/nova/chat')
          .send({ conversationId: id, message: 'Hello', ownerId: 'attacker' })
      ).status,
    ).toBe(400);
    expect(
      (
        await a
          .post('/api/v1/nova/chat')
          .send({ conversationId: id, message: 'My height is 180 cm' })
      ).status,
    ).toBe(400);
  });
});

describe('Approved Nova memory', () => {
  it('requires opt-in, retrieves only approved context, and removes deleted preferences', async () => {
    const captured: ChatTurn[][] = [];
    const { app } = setup({
      novaLanguage: {
        async *stream(turns: ChatTurn[]) {
          captured.push(turns);
          yield 'Hello Nova.';
        },
      },
    });
    const a = browser(app);
    const other = browser(app);
    const id = await conversation(a);
    expect(
      (
        await a
          .post('/api/v1/nova/memory')
          .send({ content: 'I prefer black formal outfits.', consent: true })
      ).status,
    ).toBe(400);
    expect((await a.patch('/api/v1/nova/settings').send({ memoryEnabled: true })).body).toEqual({
      memoryEnabled: true,
      retentionDays: 30,
    });
    expect(
      (await a.post('/api/v1/nova/memory').send({ content: 'I prefer black formal outfits.' }))
        .status,
    ).toBe(400);
    const memory = (
      await a
        .post('/api/v1/nova/memory')
        .send({ content: 'I prefer black formal outfits.', consent: true })
    ).body;
    await a.post('/api/v1/nova/chat').send({ conversationId: id, message: 'Hello Nova' });
    expect(captured[0]?.[0]?.content).toContain('I prefer black formal outfits.');
    expect((await other.get('/api/v1/nova/memory')).body).toEqual([]);
    expect((await other.delete(`/api/v1/nova/memory/${memory.id}`)).status).toBe(404);
    await a.delete(`/api/v1/nova/memory/${memory.id}`);
    await a.post('/api/v1/nova/chat').send({ conversationId: id, message: 'Hello again' });
    expect(captured.at(-1)?.[0]?.content).not.toContain('I prefer black formal outfits.');
    expect(
      (
        await a
          .post('/api/v1/nova/memory')
          .send({ content: 'email me at private@example.com', consent: true })
      ).status,
    ).toBe(400);
  });
  it('disable memory excludes retained preferences without deleting them', async () => {
    let system = '';
    const { app } = setup({
      novaLanguage: {
        async *stream(turns: ChatTurn[]) {
          system = turns[0]!.content;
          yield 'Hello.';
        },
      },
    });
    const a = browser(app);
    const id = await conversation(a);
    await a.patch('/api/v1/nova/settings').send({ memoryEnabled: true });
    await a
      .post('/api/v1/nova/memory')
      .send({ content: 'My preferred color is rose.', consent: true });
    await a.patch('/api/v1/nova/settings').send({ memoryEnabled: false });
    await a.post('/api/v1/nova/chat').send({ conversationId: id, message: 'Hello again' });
    expect(system).not.toContain('preferred color is rose');
    expect((await a.get('/api/v1/nova/memory')).body).toHaveLength(1);
  });
});

describe('Nova media providers and storage', () => {
  it('uses authenticated media protocol calls with version metadata, not the text runtime', async () => {
    const pixels = await makeImage();
    const calls: Array<{ url: string; body: string; headers: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), body: String(init.body), headers: init.headers });
        return new Response(
          JSON.stringify(
            String(url).includes('/images/')
              ? { model_version: 'image-revision', data: [{ b64_json: pixels.toString('base64') }] }
              : {
                  model_version: 'vision-revision',
                  choices: [{ message: { content: 'Protocol test description.' } }],
                },
          ),
        );
      }),
    );
    const env = loadEnv({
      NOVA_VISION_URL: 'http://127.0.0.1:8090',
      NOVA_VISION_KEY: 'private-test-token',
      NOVA_IMAGE_URL: 'http://127.0.0.1:8090',
    });
    const signal = new AbortController().signal;
    const vision = new CompatibleVision(env);
    expect(vision.external).toBe(true); // A localhost URL can be a remote tunnel; consent defaults on.
    expect((await vision.describe(pixels, 'Describe the garment.', signal)).modelVersion).toBe(
      'vision-revision',
    );
    expect((await new CompatibleImages(env).generate('A suit.', signal)).image.equals(pixels)).toBe(
      true,
    );
    expect(calls[0]?.url).toBe('http://127.0.0.1:8090/v1/chat/completions');
    expect(calls[0]?.headers).toMatchObject({ Authorization: 'Bearer private-test-token' });
    expect(calls[0]?.body).toContain('image_url');
    expect(calls.every((c) => !c.url.includes(':8081'))).toBe(true);
  });
  it('validates pixels, strips metadata, and serves images only to their owner', async () => {
    const { app } = setup();
    const a = browser(app);
    const other = browser(app);
    expect(
      (
        await a.post('/api/v1/nova/attachments').attach('image', Buffer.from('<svg/>'), {
          filename: 'fake.png',
          contentType: 'image/png',
        })
      ).status,
    ).toBe(400);
    const image = await makeImage();
    const upload = await a.post('/api/v1/nova/attachments').attach('image', image, 'outfit.png');
    expect(upload.status).toBe(201);
    expect(upload.body.bytes).toBeGreaterThan(0);
    expect((await other.get(upload.body.url)).status).toBe(404);
    const read = await a.get(upload.body.url);
    expect(read.headers['content-type']).toContain('image/webp');
    expect((await sharp(read.body).metadata()).exif).toBeUndefined();
    expect((await a.get(upload.body.url + '?download=1')).headers['content-disposition']).toContain(
      'attachment',
    );
  });
  it('refuses unsupported vision and never sends pixels to the text model', async () => {
    const { app } = setup();
    const a = browser(app);
    const id = await conversation(a);
    const image = await a
      .post('/api/v1/nova/attachments')
      .attach('image', await makeImage(), 'outfit.png');
    const result = await a
      .post('/api/v1/nova/chat')
      .send({ conversationId: id, message: 'Describe this image', attachmentIds: [image.body.id] });
    expect(result.status).toBe(503);
    expect(result.body.error.message).toContain('cannot describe image pixels');
    expect((await a.get(`/api/v1/nova/conversations/${id}`)).body.messages).toHaveLength(0);
  });
  it('requires external consent and calls only the separate vision adapter', async () => {
    let calls = 0;
    const vision: NovaVisionProvider = {
      configured: true,
      external: true,
      model: 'test-vision',
      async describe(image) {
        expect(image.length).toBeGreaterThan(0);
        calls++;
        return { text: 'Test adapter description.', modelVersion: 'test-vision-v1' };
      },
    };
    const { app } = setup({ novaVision: vision });
    const a = browser(app);
    const id = await conversation(a);
    const image = await a
      .post('/api/v1/nova/attachments')
      .attach('image', await makeImage(), 'outfit.png');
    const body = {
      conversationId: id,
      message: 'Describe this image',
      attachmentIds: [image.body.id],
    };
    expect((await a.post('/api/v1/nova/chat').send(body)).status).toBe(400);
    expect(calls).toBe(0);
    const result = await a.post('/api/v1/nova/chat').send({ ...body, externalConsent: true });
    expect(result.body.model).toBe('test-vision');
    expect(result.body.metadata.source).toBe('vision-model');
    expect(calls).toBe(1);
  });
  it('persists image jobs, genuinely validates adapter bytes, isolates and deletes outputs', async () => {
    const image = await makeImage();
    const images: NovaImageProvider = {
      configured: true,
      external: false,
      model: 'test-image-fixture',
      cancellation: 'test',
      async generate() {
        return { image, modelVersion: 'test-image-v1' };
      },
    };
    const { app } = setup({ novaImages: images });
    const a = browser(app);
    const other = browser(app);
    const result = await a
      .post('/api/v1/nova/images/generate')
      .send({ prompt: 'A black formal suit' });
    expect(result.status).toBe(202);
    await waitFor(
      async () =>
        (await a.get(`/api/v1/nova/generations/${result.body.id}`)).body.status === 'completed',
    );
    const job = (await a.get(`/api/v1/nova/generations/${result.body.id}`)).body;
    expect(job.model).toBe('test-image-fixture');
    expect((await other.get(`/api/v1/nova/generations/${job.id}`)).status).toBe(404);
    expect((await a.get(`/api/v1/nova/attachments/${job.imageId}`)).status).toBe(200);
    await a.delete(`/api/v1/nova/generations/${job.id}`);
    expect((await a.get(`/api/v1/nova/attachments/${job.imageId}`)).status).toBe(404);
  });
  it('fails image jobs on invalid bytes and supports cancellation and retry', async () => {
    const invalid: NovaImageProvider = {
      configured: true,
      external: false,
      model: 'invalid-test',
      cancellation: 'abort',
      async generate() {
        return { image: Buffer.from('not an image'), modelVersion: 'invalid' };
      },
    };
    const { app } = setup({ novaImages: invalid });
    const a = browser(app);
    const job = (await a.post('/api/v1/nova/images/generate').send({ prompt: 'A blue jacket' }))
      .body;
    await waitFor(
      async () => (await a.get(`/api/v1/nova/generations/${job.id}`)).body.status === 'failed',
    );
    expect((await a.get(`/api/v1/nova/generations/${job.id}`)).body.imageId).toBeUndefined();
    expect((await a.post(`/api/v1/nova/generations/${job.id}/retry`).send({})).status).toBe(202);
    const slow: NovaImageProvider = {
      ...invalid,
      async generate(_prompt, signal) {
        await new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
        return { image: Buffer.alloc(0), modelVersion: 'slow' };
      },
    };
    const second = setup({ novaImages: slow });
    const owner = browser(second.app);
    const pending = (
      await owner.post('/api/v1/nova/images/generate').send({ prompt: 'A blue jacket' })
    ).body;
    await owner.post(`/api/v1/nova/generations/${pending.id}/cancel`);
    await waitFor(
      async () =>
        (await owner.get(`/api/v1/nova/generations/${pending.id}`)).body.status === 'cancelled',
    );
  });
  it('blocks unconfigured image generation and insecure external endpoints', async () => {
    const { app } = setup();
    expect(
      (await browser(app).post('/api/v1/nova/images/generate').send({ prompt: 'A black suit' }))
        .status,
    ).toBe(503);
    expect(
      () => new CompatibleVision(loadEnv({ NOVA_VISION_URL: 'http://external.invalid' })),
    ).toThrow(/HTTPS/);
    expect(
      () => new CompatibleImages(loadEnv({ NOVA_IMAGE_URL: 'https://example.com?key=private' })),
    ).toThrow(/credentials/);
  });
});

describe('Nova controlled training and retention', () => {
  it('exports only approved consented text with grounded IDs and no private fields', () => {
    const row: TrainingExample = {
      id: 'submission',
      ownerId: 'private-owner',
      conversationId: 'private-conversation',
      input: 'What is your name?',
      expectedOutput: "I'm Nova from NovaCTO.",
      source: 'explicit-user-submission',
      qualityStatus: 'unvalidated',
      reviewStatus: 'pending',
      consent: true,
      datasetVersion: '',
      createdAt: new Date().toISOString(),
    };
    expect(() => reviewedTrainingRecord(row)).toThrow(/approval/);
    const exported = reviewedTrainingRecord({ ...row, reviewStatus: 'approved' });
    expect(JSON.stringify(exported)).not.toContain('private-owner');
    expect(() =>
      reviewedTrainingRecord({
        ...row,
        reviewStatus: 'approved',
        input: 'Use private@example.com',
      }),
    ).toThrow(/contact/);
    expect(() =>
      reviewedTrainingRecord({
        ...row,
        reviewStatus: 'approved',
        expectedOutput: JSON.stringify({
          answer: 'Use this.',
          itemIds: ['invented'],
          occasion: '',
          categories: [],
        }),
      }),
    ).toThrow(/unverified/);
  });
  it('requires per-example consent, denies review injection, and revokes with conversation deletion', async () => {
    const { app } = setup();
    const a = browser(app);
    const id = await conversation(a);
    const data = {
      conversationId: id,
      input: 'A blue shirt',
      expectedOutput: 'Use the blue shirt.',
    };
    expect((await a.post('/api/v1/nova/training/examples').send(data)).status).toBe(400);
    expect(
      (
        await a
          .post('/api/v1/nova/training/examples')
          .send({ ...data, consent: true, reviewStatus: 'approved' })
      ).status,
    ).toBe(400);
    const row = await a.post('/api/v1/nova/training/examples').send({ ...data, consent: true });
    expect(row.body.reviewStatus).toBe('pending');
    expect((await browser(app).get('/api/v1/nova/training/examples')).body).toEqual([]);
    await a.delete(`/api/v1/nova/conversations/${id}`);
    expect((await a.get('/api/v1/nova/training/examples')).body).toEqual([]);
  });
  it('recovers interrupted work and purges only expired Nova records', async () => {
    const { app, container } = setup();
    const a = browser(app);
    const id = await conversation(a);
    const row = (await container.nova.store.conversations.get(id))!;
    await container.nova.store.messages.insert({
      id: crypto.randomUUID(),
      ownerId: row.ownerId,
      conversationId: id,
      role: 'assistant',
      content: 'partial',
      attachmentIds: [],
      model: 'base',
      status: 'pending',
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    await container.nova.recover();
    expect((await container.nova.store.messages.find())[0]?.status).toBe('failed');
    await container.nova.store.conversations.update(id, { expiresAt: new Date(0).toISOString() });
    await container.nova.purge();
    expect((await a.get('/api/v1/nova/conversations')).body).toEqual([]);
    expect(await container.nova.store.messages.find()).toEqual([]);
  });
  it('bounds concurrent and queued work and releases capacity after failure', async () => {
    const q = new InferenceQueue(1, 1);
    let release!: () => void;
    const a = q.run(
      new AbortController().signal,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const b = q.run(new AbortController().signal, async () => 42);
    await expect(q.run(new AbortController().signal, async () => 0)).rejects.toMatchObject({
      status: 429,
    });
    release();
    await a;
    expect(await b).toBe(42);
    expect(q.active).toBe(0);
  });
});
