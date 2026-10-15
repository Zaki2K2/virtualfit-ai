import { Router } from 'express';
import type { HealthStatus } from '@virtualfit/shared';

export function healthRoutes(getStatus: () => HealthStatus): Router {
  const r = Router();
  r.get('/', (_req, res) => {
    res.json(getStatus());
  });
  return r;
}
