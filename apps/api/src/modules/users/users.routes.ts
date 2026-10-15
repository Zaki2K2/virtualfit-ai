import { Router } from 'express';
import type { UsersController } from './users.controller';

export function usersRoutes(c: UsersController): Router {
  const r = Router();
  r.get('/', c.get);
  r.patch('/', c.update);
  r.delete('/', c.eraseAll);
  return r;
}
