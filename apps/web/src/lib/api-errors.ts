import { ApiError } from './api-client';

export type ErrorKind =
  | 'unreachable'
  | 'timeout'
  | 'validation'
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'server'
  | 'database'
  | 'ai_unavailable'
  | 'ai_quota'
  | 'ai_failed'
  | 'unknown';

export interface ErrorInfo {
  kind: ErrorKind;
  /** Short user-facing explanation. Never contains stack traces or internals. */
  message: string;
  /** Whether trying again can reasonably help. */
  retryable: boolean;
}

/** User-facing description of any error thrown by the API client. */
export function describeError(error: unknown): ErrorInfo {
  if (!(error instanceof ApiError)) {
    return { kind: 'unknown', message: 'Something went wrong. Please try again.', retryable: true };
  }
  switch (error.code) {
    case 'API_UNREACHABLE':
      return {
        kind: 'unreachable',
        message:
          'The app could not reach the API server. Make sure it is running (npm run dev) and try again.',
        retryable: true,
      };
    case 'NETWORK_ERROR':
      return {
        kind: 'unreachable',
        message: 'Cannot reach the app server. Check that it is running and your connection works.',
        retryable: true,
      };
    case 'TIMEOUT':
      return {
        kind: 'timeout',
        message: 'The request took too long. Please try again.',
        retryable: true,
      };
    case 'DATABASE_UNAVAILABLE':
      return { kind: 'database', message: error.message, retryable: true };
    case 'RATE_LIMITED':
      return {
        kind: 'rate_limited',
        message: error.message || 'Too many requests. Please wait a moment and try again.',
        retryable: true,
      };
    case 'AI_QUOTA_EXHAUSTED':
      return { kind: 'ai_quota', message: error.message, retryable: true };
    case 'AI_UNAVAILABLE':
      return { kind: 'ai_unavailable', message: error.message, retryable: true };
    case 'AI_TIMEOUT':
      return { kind: 'timeout', message: error.message, retryable: true };
    case 'AI_FAILED':
      return { kind: 'ai_failed', message: error.message, retryable: true };
    case 'NOT_FOUND':
      return { kind: 'not_found', message: error.message || 'Not found.', retryable: false };
    case 'VALIDATION_ERROR':
    case 'UNSUPPORTED_IMAGE':
    case 'FILE_TOO_LARGE':
    case 'CONSENT_REQUIRED':
      return { kind: 'validation', message: error.message, retryable: false };
    default:
      break;
  }
  if (error.status === 401 || error.status === 403) {
    return {
      kind: 'unauthorized',
      message: 'Your session is not valid. Reload the page and try again.',
      retryable: false,
    };
  }
  if (error.status === 404) return { kind: 'not_found', message: 'Not found.', retryable: false };
  if (error.status === 429) {
    return {
      kind: 'rate_limited',
      message: 'Too many requests. Please wait a moment.',
      retryable: true,
    };
  }
  if (error.status >= 500) {
    return {
      kind: 'server',
      message:
        'The server hit an unexpected error. Please try again; if it keeps happening, check the API log.',
      retryable: true,
    };
  }
  return { kind: 'validation', message: error.message, retryable: false };
}

/**
 * React Query retry policy: retry transient failures once, never retry client errors, and do not
 * hammer a server that is clearly down (unreachable APIs are not retried at all).
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const { kind } = describeError(error);
  if (kind === 'unreachable') return false;
  if (kind === 'timeout' || kind === 'server' || kind === 'database') return failureCount < 1;
  return false;
}
