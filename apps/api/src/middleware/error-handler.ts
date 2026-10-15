import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@virtualfit/shared';
import { AppError, isDatabaseUnavailable } from '../utils/errors';
import { logger } from '../utils/logger';

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  };
  res.status(404).json(body);
};

export function createErrorHandler(maxUploadMb: number): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    let status = 500;
    let body: ApiErrorBody = {
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' },
    };

    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, details: err.details } };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      };
    } else if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        status = 413;
        body = {
          error: { code: 'FILE_TOO_LARGE', message: `Image is too large (max ${maxUploadMb} MB).` },
        };
      } else {
        status = 400;
        body = { error: { code: 'VALIDATION_ERROR', message: `Upload rejected: ${err.message}` } };
      }
    } else if (isDatabaseUnavailable(err)) {
      status = 503;
      body = {
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The database is not reachable right now. Please try again in a moment.',
        },
      };
    } else if ((err as { type?: string })?.type === 'entity.too.large') {
      status = 413;
      body = { error: { code: 'VALIDATION_ERROR', message: 'Request body is too large.' } };
    } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
      status = 400;
      body = { error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body.' } };
    }

    if (status >= 500) {
      // Technical detail goes to the server log only (never into the response body).
      logger.error('Request failed', {
        route: `${req.method} ${req.path}`,
        status,
        name: (err as Error)?.name,
        message: (err as Error)?.message,
        ...(process.env.NODE_ENV === 'production' ? {} : { stack: (err as Error)?.stack }),
      });
    }
    res.status(status).json(body);
  };
}
