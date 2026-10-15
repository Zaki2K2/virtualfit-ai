import type { ErrorCode } from '@virtualfit/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'VALIDATION_ERROR', message, details);
  }
  static notFound(what = 'Resource') {
    return new AppError(404, 'NOT_FOUND', `${what} not found`);
  }
}

const DATABASE_ERROR_NAMES = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoNotConnectedError',
  'MongoTopologyClosedError',
  'MongoPoolClearedError',
  'MongoPoolClosedError',
  'MongooseServerSelectionError',
]);

/** True for failures that mean "the database is unreachable" (as opposed to a bug or bad input). */
export function isDatabaseUnavailable(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  if (!e) return false;
  if (e.name && DATABASE_ERROR_NAMES.has(e.name)) return true;
  // Mongoose rejects buffered operations with a plain MongooseError carrying this message.
  return e.name === 'MongooseError' && /buffering timed out|not connected/i.test(e.message ?? '');
}
