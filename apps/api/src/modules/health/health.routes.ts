import { Router } from 'express';
import type { HealthStatus } from '@virtualfit/shared';

export function healthRoutes(getStatus: () => Promise<HealthStatus>): Router {
  const r = Router();
  r.get('/', async (_req, res) => {
    res.json(await getStatus());
  });
  return r;
}
