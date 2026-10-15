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
