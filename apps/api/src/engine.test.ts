import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CustomPythonProvider,
  isLoopbackUrl,
  mapEngineError,
} from './integrations/ai/providers/custom-python.provider';
import { browser, buildTestApp, makeImage, waitForTryOn } from './test/helpers';

/**
 * A real HTTP server that speaks the engine's contract. It is a TEST DOUBLE for the Python
 * service (the real FastAPI app is covered by ai-engine/tests): it lets us verify, over a real
 * socket, what Express sends and how Express reacts to every kind of engine answer.
 */
interface Captured {
  body: string;
  headers: http.IncomingHttpHeaders;
}
type Reply = { status: number; json?: unknown; png?: Buffer; headers?: Record<string, string> };

const servers: http.Server[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

async function startFakeEngine(opts: {
  models?: Record<string, { available: boolean; reason: string }>;
  reply: () => Promise<Reply> | Reply;
}) {
  const captured: Captured[] = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'ok',
          models: opts.models ?? {
            pretrained: { available: true, reason: 'ok' },
            custom: { available: false, reason: 'no adapter configured' },
          },
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    captured.push({ body: Buffer.concat(chunks).toString('latin1'), headers: req.headers });
    const reply = await opts.reply();
    res.statusCode = reply.status;
    for (const [k, v] of Object.entries(reply.headers ?? {})) res.setHeader(k, v);
    if (reply.png) {
      res.setHeader('content-type', 'image/png');
      res.end(reply.png);
    } else {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(reply.json ?? {}));
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, captured };
}

async function submit(
  agent: ReturnType<typeof browser>,
  model: string | undefined,
  extra: Record<string, string> = {},
) {
  let req = agent
    .post('/api/v1/try-on')
    .field('category', 'tops')
    .field('clothingId', 'tee-graphite')
    .attach('person', await makeImage('png', 300, 400), 'me.png');
  if (model) req = req.field('model', model);
  for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
  return req;
}

describe('model options', () => {
  it('reports which models can run, with reasons', async () => {
    const { app } = buildTestApp();
    const ai = (await browser(app).get('/api/v1/health')).body.ai;
    expect(ai.defaultOption).toBe('mock');
    const byId = Object.fromEntries(ai.options.map((o: { id: string }) => [o.id, o]));
    expect(byId.mock).toMatchObject({ available: true, simulated: true });
    expect(byId.hosted).toMatchObject({ available: false, simulated: false });
    expect(byId.pretrained.available).toBe(false);
    expect(byId.pretrained.reason).toMatch(/ENGINE_URL/);
    expect(byId.custom.available).toBe(false);
  });

  it('never substitutes the mock when a real model is unavailable', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    const res = await submit(agent, 'pretrained');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    expect((await agent.get('/api/v1/history')).body.items).toHaveLength(0);
  });

  it('lets the client pick the mock explicitly, and rejects unknown models', async () => {
    const { app } = buildTestApp();
    const agent = browser(app);
    const ok = await submit(agent, 'mock');
    expect(ok.status).toBe(202);
    expect(ok.body.tryOn).toMatchObject({ provider: 'mock', simulated: true });
    await waitForTryOn(agent, ok.body.tryOn.id);
    expect((await submit(agent, 'gpt-9000')).status).toBe(400);
  });
});

describe('custom-python provider over real HTTP', () => {
  it('sends the right request and stores the engine-reported model version', async () => {
    const png = await makeImage('png', 384, 512);
    const engine = await startFakeEngine({
      reply: () => ({ status: 200, png, headers: { 'x-model-version': 'catvton-vitonhd' } }),
    });
    const { app } = buildTestApp({ ENGINE_URL: engine.url, ENGINE_API_KEY: 'k3y' });
    const agent = browser(app);

    const ai = (await agent.get('/api/v1/health')).body.ai;
    const byId = Object.fromEntries(ai.options.map((o: { id: string }) => [o.id, o]));
    expect(byId.pretrained).toMatchObject({ available: true, externalProcessing: false });
    expect(byId.custom).toMatchObject({ available: false, reason: 'no adapter configured' });

    const res = await submit(agent, 'pretrained');
    expect(res.status).toBe(202);
    expect(res.body.tryOn).toMatchObject({ provider: 'custom-python', simulated: false });
    const done = await waitForTryOn(agent, res.body.tryOn.id);
    expect(done).toMatchObject({ status: 'completed', model: 'catvton-vitonhd', simulated: false });
    expect((await agent.get(done.resultUrl)).headers['content-type']).toContain('image/png');

    const sent = engine.captured[0]!;
    expect(sent.headers['x-engine-key']).toBe('k3y');
    expect(sent.headers['content-type']).toMatch(/^multipart\/form-data/);
    for (const field of ['person', 'garment', 'category', 'model_version']) {
      expect(sent.body).toContain(`name="${field}"`);
    }
    expect(sent.body).toMatch(/name="model_version"\r\n\r\npretrained/);
    expect(sent.body).toMatch(/name="category"\r\n\r\ntops/);
  });

  it('refuses the custom model while the engine reports no adapter (no fallback to pretrained)', async () => {
    const engine = await startFakeEngine({ reply: () => ({ status: 200, png: Buffer.alloc(0) }) });
    const { app } = buildTestApp({ ENGINE_URL: engine.url });
    const res = await submit(browser(app), 'custom');
    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/no adapter configured/);
    expect(engine.captured).toHaveLength(0);
  });

  const failure = async (reply: Reply) => {
    const engine = await startFakeEngine({ reply: () => reply });
    const { app } = buildTestApp({ ENGINE_URL: engine.url });
    const agent = browser(app);
    const res = await submit(agent, 'pretrained');
    expect(res.status).toBe(202);
    return waitForTryOn(agent, res.body.tryOn.id);
  };

  it('reports GPU-unavailable engines as a failed job, not a fake success', async () => {
    const done = await failure({
      status: 503,
      json: { error: { code: 'GPU_UNAVAILABLE', message: 'no CUDA GPU available' } },
    });
    expect(done.status).toBe('failed');
    expect(done.resultUrl).toBeNull();
    expect(done.error).toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(done.error.message).toMatch(/no CUDA GPU available/);
  });

  it('maps engine timeouts, rejected inputs and non-image answers', async () => {
    expect(
      (await failure({ status: 504, json: { error: { code: 'TIMEOUT', message: 'slow' } } })).error
        .code,
    ).toBe('AI_TIMEOUT');
    const bad = await failure({
      status: 422,
      json: { error: { code: 'BAD_MASK', message: 'mask covers 0%' } },
    });
    expect(bad.error).toMatchObject({ code: 'AI_FAILED' });
    expect(bad.error.message).toMatch(/mask covers 0%/);
    const html = await failure({ status: 200, json: { oops: true } });
    expect(html.error.code).toBe('AI_FAILED');
  });

  it('treats an engine that returns garbage bytes as failure', async () => {
    const done = await failure({ status: 200, png: Buffer.from('not a png') });
    expect(done.status).toBe('failed');
    expect(done.error.code).toBe('AI_FAILED');
  });

  it('reports an unreachable engine as unavailable', async () => {
    const { app } = buildTestApp({ ENGINE_URL: 'http://127.0.0.1:9' });
    const agent = browser(app);
    const byId = Object.fromEntries(
      (await agent.get('/api/v1/health')).body.ai.options.map((o: { id: string }) => [o.id, o]),
    );
    expect(byId.pretrained.available).toBe(false);
    expect(byId.pretrained.reason).toMatch(/not reachable/);
    expect((await submit(agent, 'pretrained')).status).toBe(503);
  });
});

describe('provider helpers', () => {
  it('detects loopback engine URLs (photos only leave the machine for remote engines)', () => {
    expect(isLoopbackUrl('http://localhost:8000')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:8000')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:8000')).toBe(true);
    expect(isLoopbackUrl('https://gpu.example.edu')).toBe(false);
    expect(
      new CustomPythonProvider({ url: 'https://gpu.example.edu', modelVersion: 'custom' })
        .externalProcessing,
    ).toBe(true);
    expect(
      new CustomPythonProvider({ url: 'http://localhost:8000', modelVersion: 'custom' })
        .externalProcessing,
    ).toBe(false);
  });

  it('maps engine error codes to API error codes', () => {
    expect(mapEngineError(503, 'GPU_UNAVAILABLE', 'x').code).toBe('AI_UNAVAILABLE');
    expect(mapEngineError(503, 'MASKER_UNAVAILABLE', 'x').code).toBe('AI_UNAVAILABLE');
    expect(mapEngineError(504, 'TIMEOUT', 'x').code).toBe('AI_TIMEOUT');
    expect(mapEngineError(429, 'BUSY', 'x').code).toBe('RATE_LIMITED');
    expect(mapEngineError(500, 'INFERENCE_FAILED', 'oom').code).toBe('AI_FAILED');
    expect(mapEngineError(500, undefined, 'x').code).toBe('AI_FAILED');
  });
});
