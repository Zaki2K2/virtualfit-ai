import { Router } from 'express';
import type { FavoritesController } from './favorites.controller';

export function favoritesRoutes(c: FavoritesController): Router {
  const r = Router();
  r.get('/', c.list);
  r.post('/', c.add);
  r.delete('/:id', c.remove);
  return r;
}
