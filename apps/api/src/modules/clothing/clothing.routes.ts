import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { ClothingController } from './clothing.controller';

export function clothingRoutes(c: ClothingController, upload: RequestHandler): Router {
  const r = Router();
  r.get('/', c.list);
  r.post('/', upload, c.create);
  r.get('/:id', c.get);
  r.get('/:id/image', c.image);
  r.delete('/:id', c.remove);
  return r;
}
