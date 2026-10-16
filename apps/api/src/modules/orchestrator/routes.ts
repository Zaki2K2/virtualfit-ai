import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { capabilities } from './registry';
import type { Orchestrator } from './index';

const taskSchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    hasImage: z.boolean().optional(),
    mode: z.enum(['chat', 'image', 'wardrobe']).optional(),
    modelId: z.string().max(80).optional(),
  })
  .strict();
const documentSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    content: z.string().min(1).max(250_000),
    mimeType: z.string().max(60).default('text/plain'),
    consent: z.boolean(),
  })
  .strict();
const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();
const toolCall = z
  .object({ input: z.unknown().default({}), approvalId: z.string().uuid().optional() })
  .strict();

/** Mounted inside novaRoutes so it inherits the guest session, origin check and rate limit. */
export function orchestratorRoutes(o: Orchestrator) {
  const router = Router();
  /** Client disconnects cancel in-flight work. */
  const control = (_req: Request, res: Response) => {
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    return abort.signal;
  };

  router.get('/capabilities', (_req, res) => {
    res.json({ capabilities });
  });
  router.get('/models', (_req, res) => {
    res.json(o.registry.list());
  });
  router.post('/models/:id/health', async (req, res) => {
    const id = z.string().max(80).parse(req.params.id);
    if (!o.registry.get(id))
      return void res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Model not found' } });
    res.json(await o.registry.check(id, true, control(req, res)));
  });
  router.post('/route', async (req, res) => {
    const { modelId, ...task } = taskSchema.parse(req.body);
    res.json(await o.route(task, { modelId }));
  });
  router.get('/resources', async (_req, res) => {
    res.json(await o.monitor.sample());
  });

  router.get('/tools', (_req, res) => {
    res.json(o.tools.list());
  });
  router.get('/tools/audit', (req, res) => {
    res.json(o.tools.auditLog(req.guestId));
  });
  router.post('/tools/:name/approvals', (req, res) => {
    res
      .status(201)
      .json(
        o.tools.requestApproval(
          req.guestId,
          z.string().max(80).parse(req.params.name),
          req.body?.input ?? {},
        ),
      );
  });
  router.post('/tools/approvals/:id/confirm', (req, res) => {
    o.tools.confirm(req.guestId, z.string().uuid().parse(req.params.id));
    res.sendStatus(204);
  });
  router.post('/tools/:name/invoke', async (req, res) => {
    const body = toolCall.parse(req.body);
    const result = await o.tools.invoke(z.string().max(80).parse(req.params.name), body.input, {
      ownerId: req.guestId,
      approvalId: body.approvalId,
      signal: control(req, res),
    });
    res.json({ result });
  });

  router.get('/knowledge', async (req, res) => {
    res.json({
      embedder: o.knowledge.embedderInfo,
      documents: await o.knowledge.list(req.guestId),
    });
  });
  router.post('/knowledge', async (req, res) => {
    const body = documentSchema.parse(req.body);
    const { ownerId: _ownerId, ...doc } = await o.knowledge.ingest(
      req.guestId,
      body,
      control(req, res),
    );
    res.status(201).json(doc);
  });
  router.post('/knowledge/search', async (req, res) => {
    const { query, limit } = searchSchema.parse(req.body);
    res.json({
      embedder: o.knowledge.embedderInfo,
      hits: await o.knowledge.search(req.guestId, query, control(req, res), limit),
    });
  });
  router.delete('/knowledge/:id', async (req, res) => {
    await o.knowledge.remove(req.guestId, z.string().uuid().parse(req.params.id));
    res.sendStatus(204);
  });
  return router;
}
