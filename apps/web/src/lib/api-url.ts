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
