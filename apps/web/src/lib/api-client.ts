import type { ApiErrorBody, ErrorCode } from '@virtualfit/shared';

/**
 * Codes produced by the browser side, in addition to the API's own codes:
 *  NETWORK_ERROR   the browser could not reach the web server at all
 *  TIMEOUT         no answer within the time limit
 *  API_UNREACHABLE the web server answered but could not reach the API behind it
 *                  (Next's proxy returns a bare 500/502/503/504 without a JSON error body)
 */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT' | 'API_UNREACHABLE';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api/v1';
export const DEFAULT_TIMEOUT_MS = 30_000;

function isErrorBody(body: unknown): body is ApiErrorBody {
  const e = (body as ApiErrorBody | null)?.error;
  return !!e && typeof e.code === 'string' && typeof e.message === 'string';
}

/** Turns a failed HTTP response into an ApiError, telling apart API errors from proxy failures. */
export function classifyResponse(status: number, body: unknown): ApiError {
  if (isErrorBody(body)) return new ApiError(status, body.error.code, body.error.message);
  if (status >= 500) {
    // JSON bodies always come from our API. Anything else on a 5xx is the web server's proxy
    // reporting that the API did not answer (connection refused, reset, ...).
    return new ApiError(status, 'API_UNREACHABLE', 'The API server did not answer.');
  }
  return new ApiError(status, 'INTERNAL_ERROR', `Request failed (${status}).`);
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(timeoutMs),
      ...init,
    });
  } catch (err) {
    if ((err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', 'The request took too long.');
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the app server.');
  }
  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw classifyResponse(res.status, body);
  return body as T;
}

export const jsonBody = (data: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
