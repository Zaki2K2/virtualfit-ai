export const DEFAULT_API_URL = 'http://localhost:5000';

/**
 * Where the Next.js server proxies `/api/*`. Read from `API_URL`, normalised (no trailing slash,
 * must be an http(s) URL) so a typo fails at startup instead of producing 500s per request.
 */
export function resolveApiUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim() || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`API_URL is not a valid URL: "${value}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`API_URL must start with http:// or https:// (got "${value}")`);
  }
  return url.origin;
}

export function apiRewrites(apiUrl: string) {
  return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
}

/** Express caps every inference deadline at 600s; the proxy must outlive it by a margin so the
 *  API (not the proxy) is always the one that times out and reports a structured error. */
export const DEFAULT_PROXY_TIMEOUT_MS = 610_000;

export function resolveProxyTimeout(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_PROXY_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1000 || value > 3_600_000)
    throw new Error(`WEB_PROXY_TIMEOUT_MS must be an integer from 1000 to 3600000 (got "${raw}")`);
  return value;
}
