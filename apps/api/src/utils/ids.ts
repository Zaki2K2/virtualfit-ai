import { randomUUID } from 'node:crypto';

const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export const newId = () => randomUUID().replace(/-/g, '');
export const isSafeId = (id: unknown): id is string =>
  typeof id === 'string' && ID_PATTERN.test(id);
