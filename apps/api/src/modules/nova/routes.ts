import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  novaChatSchema,
  novaMemorySchema,
  novaSettingsSchema,
  novaImageSchema,
} from '@virtualfit/shared';
import { createUpload } from '../../middleware/upload';
import { AppError } from '../../utils/errors';
import type { Env } from '../../config/env';
import { publicDoc } from './models';
import type { NovaService } from './service';

export function novaRoutes(service: NovaService, env: Env) {
  const router = Router();
  const id = (req: Request) => z.string().uuid().parse(req.params.id);
  if (env.NODE_ENV !== 'test')
    router.use(
      rateLimit({
        windowMs: 60_000,
        limit: env.NOVA_REQUESTS_PER_MINUTE,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: {
          error: { code: 'RATE_LIMITED', message: 'Nova request rate exceeded. Retry shortly.' },
        },
      }),
    );
  router.use((req, _res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      ![env.WEB_ORIGIN, 'http://127.0.0.1:3000'].includes(req.headers.origin)
    )
      return next(
        new AppError(403, 'VALIDATION_ERROR', 'Cross-origin Nova changes are not allowed.'),
      );
    next();
  });
  router.get('/status', async (req, res) => {
    res.json(await service.status(req.guestId));
  });
  router.get('/settings', async (req, res) => {
    const settings = await service.settings(req.guestId);
    res.json({ memoryEnabled: settings.memoryEnabled, retentionDays: settings.retentionDays });
  });
  router.patch('/settings', async (req, res) => {
    res.json(await service.setSettings(req.guestId, novaSettingsSchema.parse(req.body)));
  });
  router.get('/conversations', async (req, res) => {
    res.json(
      await service.conversations(
        req.guestId,
        z.string().trim().max(100).optional().parse(req.query.q),
      ),
    );
  });
  router.post('/conversations', async (req, res) => {
    const { title } = z
      .object({ title: z.string().trim().min(1).max(80).default('New conversation') })
      .strict()
      .parse(req.body);
    res.status(201).json(await service.createConversation(req.guestId, title));
  });
  router.delete('/conversations', async (req, res) => {
    await service.clearHistory(req.guestId);
    res.sendStatus(204);
  });
  router.get('/conversations/:id', async (req, res) => {
    res.json(await service.detail(req.guestId, id(req)));
  });
  router.patch('/conversations/:id', async (req, res) => {
    const { title } = z
      .object({ title: z.string().trim().min(1).max(80) })
      .strict()
      .parse(req.body);
    res.json(await service.rename(req.guestId, id(req), title));
  });
  router.delete('/conversations/:id', async (req, res) => {
    await service.deleteConversation(req.guestId, id(req));
    res.sendStatus(204);
  });
  router.post('/conversations/:id/stop', async (req, res) => {
    await service.stop(req.guestId, id(req));
    res.sendStatus(202);
  });
  router.post('/chat', async (req, res) => {
    const control = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) control.abort();
    });
    res.json(
      publicDoc(
        await service.chat(
          req.guestId,
          novaChatSchema.parse(req.body),
          control.signal,
          () => undefined,
        ),
      ),
    );
  });
  router.post('/chat/stream', async (req, res, next) => {
    const input = novaChatSchema.parse(req.body);
    const control = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) control.abort();
    });
    const emit = (event: string, value: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) {
        res.set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();
      }
      res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (res.headersSent && !res.destroyed) res.write(': heartbeat\n\n');
    }, 15_000);
    try {
      await service.chat(req.guestId, input, control.signal, emit);
      res.end();
    } catch (error) {
      if (!res.headersSent) return next(error);
      emit('error', {
        error: {
          code: error instanceof AppError ? error.code : 'AI_FAILED',
          message:
            error instanceof AppError
              ? error.message
              : 'Nova inference failed. Check the local runtime and retry.',
        },
      });
      res.end();
    } finally {
      clearInterval(heartbeat);
    }
  });
  router.post(
    '/attachments',
    createUpload(env.maxUploadBytes).single('image'),
    async (req, res) => {
      if (!req.file) throw AppError.badRequest('Attach an image.');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype))
        throw AppError.badRequest('JPEG, PNG and WebP are supported.');
      res.status(201).json(publicDoc(await service.saveImage(req.guestId, req.file.buffer)));
    },
  );
  router.get('/attachments/:id', async (req, res) => {
    const key = id(req);
    const image = await service.attachment(req.guestId, key);
    res.set({
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.query.download === '1')
      res.setHeader('Content-Disposition', `attachment; filename="nova-${key}.webp"`);
    res.send(image);
  });
  router.delete('/attachments/:id', async (req, res) => {
    const key = id(req);
    if (
      (await service.store.messages.find({ ownerId: req.guestId })).some((m) =>
        m.attachmentIds.includes(key),
      )
    )
      throw AppError.badRequest('Delete the referencing conversation first.');
    if (
      (await service.store.generations.find({ ownerId: req.guestId })).some(
        (g) => g.imageId === key,
      )
    )
      throw AppError.badRequest('Delete the referencing generation first.');
    await service.deleteAttachment(req.guestId, key);
    res.sendStatus(204);
  });
  router.get('/memory', async (req, res) => {
    res.json(await service.memories(req.guestId));
  });
  router.post('/memory', async (req, res) => {
    const { content } = novaMemorySchema.parse(req.body);
    res.status(201).json(await service.saveMemory(req.guestId, content));
  });
  router.patch('/memory/:id', async (req, res) => {
    const { content } = novaMemorySchema.parse(req.body);
    res.json(await service.saveMemory(req.guestId, content, id(req)));
  });
  router.delete('/memory/:id', async (req, res) => {
    await service.deleteMemory(req.guestId, id(req));
    res.sendStatus(204);
  });
  router.get('/generations', async (req, res) => {
    res.json(
      (await service.store.generations.find({ ownerId: req.guestId }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(publicDoc),
    );
  });
  router.post('/images/generate', async (req, res) => {
    const data = novaImageSchema.parse(req.body);
    res.status(202).json(await service.generate(req.guestId, data.prompt, data.externalConsent));
  });
  router.get('/generations/:id', async (req, res) => {
    res.json(publicDoc(await service.owned(service.store.generations, req.guestId, id(req))));
  });
  router.post('/generations/:id/cancel', async (req, res) => {
    await service.cancelGeneration(req.guestId, id(req));
    res.sendStatus(202);
  });
  router.post('/generations/:id/retry', async (req, res) => {
    const job = await service.owned(service.store.generations, req.guestId, id(req));
    if (!['failed', 'cancelled'].includes(job.status))
      throw AppError.badRequest('Only failed or cancelled jobs can be retried.');
    const { externalConsent } = z
      .object({ externalConsent: z.boolean().default(false) })
      .strict()
      .parse(req.body);
    res.status(202).json(await service.generate(req.guestId, job.prompt, externalConsent));
  });
  router.delete('/generations/:id', async (req, res) => {
    await service.deleteGeneration(req.guestId, id(req));
    res.sendStatus(204);
  });
  router.post('/training/examples', async (req, res) => {
    const data = z
      .object({
        conversationId: z.string().uuid(),
        input: z.string().min(3).max(4000),
        expectedOutput: z.string().min(3).max(2000),
        consent: z.literal(true),
      })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await service.collectExample(
          req.guestId,
          data.conversationId,
          data.input,
          data.expectedOutput,
        ),
      );
  });
  router.get('/training/examples', async (req, res) => {
    res.json((await service.store.training.find({ ownerId: req.guestId })).map(publicDoc));
  });
  router.delete('/training/examples/:id', async (req, res) => {
    await service.owned(service.store.training, req.guestId, id(req));
    await service.store.training.remove(id(req));
    res.sendStatus(204);
  });
  router.delete('/data', async (req: Request, res: Response) => {
    await service.erase(req.guestId);
    res.sendStatus(204);
  });
  return router;
}
