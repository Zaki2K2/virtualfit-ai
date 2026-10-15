import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { TryOnController } from './try-on.controller';

export function tryOnRoutes(
  c: TryOnController,
  upload: RequestHandler,
  limiter: RequestHandler,
): Router {
  const r = Router();
  r.post('/', limiter, upload, c.create);
  r.get('/:id', c.get);
  r.get('/:id/image', c.image);
  return r;
}
