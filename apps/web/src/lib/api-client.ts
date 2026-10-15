import type { ApiErrorBody, ErrorCode } from '@virtualfit/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api/v1';

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the server. Check that the API is running.',
    );
  }
  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? `Request failed (${res.status}).`,
    );
  }
  return body as T;
}

export const jsonBody = (data: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
