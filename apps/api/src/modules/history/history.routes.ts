import { Router } from 'express';
import type { HistoryController } from './history.controller';

export function historyRoutes(c: HistoryController): Router {
  const r = Router();
  r.get('/', c.list);
  r.delete('/:id', c.remove);
  return r;
}
