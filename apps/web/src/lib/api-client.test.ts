import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, classifyResponse } from './api-client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected the request to fail');
}

describe('apiRequest', () => {
  it('calls the same-origin /api/v1 path (proxied by Next) with cookies and a timeout', async () => {
    const fetchMock = mockFetch(async () => json(200, { ok: true }));
    expect(await apiRequest('/health')).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/health');
    expect(init).toMatchObject({ credentials: 'same-origin' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns undefined for 204', async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    expect(await apiRequest('/clothing/x', { method: 'DELETE' })).toBeUndefined();
  });

  it('reports a dead API behind the Next proxy as API_UNREACHABLE, not as a generic 500', async () => {
    // This is exactly what the browser got: Next's rewrite answers a refused connection with a
    // bare text/plain 500 and no JSON error body.
    mockFetch(async () => new Response('Internal Server Error', { status: 500 }));
    const err = await failure(apiRequest('/clothing'));
    expect(err).toMatchObject({ status: 500, code: 'API_UNREACHABLE' });
  });

  it('keeps real API 500s distinct from proxy failures', async () => {
    mockFetch(async () =>
      json(500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } }),
    );
    expect(await failure(apiRequest('/profile'))).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it.each([
    [400, 'VALIDATION_ERROR'],
    [404, 'NOT_FOUND'],
    [415, 'UNSUPPORTED_IMAGE'],
    [429, 'RATE_LIMITED'],
    [503, 'DATABASE_UNAVAILABLE'],
    [503, 'AI_UNAVAILABLE'],
    [429, 'AI_QUOTA_EXHAUSTED'],
    [504, 'AI_TIMEOUT'],
  ] as const)('preserves the API error code for HTTP %i %s', async (status, code) => {
    mockFetch(async () => json(status, { error: { code, message: 'from api' } }));
    expect(await failure(apiRequest('/x'))).toMatchObject({ status, code, message: 'from api' });
  });

  it('maps connection failures and timeouts to NETWORK_ERROR / TIMEOUT', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await failure(apiRequest('/health'))).toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
    mockFetch(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    expect(await failure(apiRequest('/health'))).toMatchObject({ status: 0, code: 'TIMEOUT' });
  });

  it('handles non-JSON 4xx bodies without crashing', async () => {
    mockFetch(async () => new Response('<html>nope</html>', { status: 404 }));
    expect(await failure(apiRequest('/missing'))).toMatchObject({ status: 404 });
  });
});

describe('classifyResponse', () => {
  it('treats every JSON error body as an API error and bare 5xx as unreachable', () => {
    expect(classifyResponse(502, null).code).toBe('API_UNREACHABLE');
    expect(classifyResponse(500, 'text').code).toBe('API_UNREACHABLE');
    expect(classifyResponse(500, { error: { code: 'INTERNAL_ERROR', message: 'm' } }).code).toBe(
      'INTERNAL_ERROR',
    );
    expect(classifyResponse(400, {})).toMatchObject({ status: 400 });
  });
});
