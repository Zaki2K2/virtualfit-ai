import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import { apiRewrites, resolveApiUrl, resolveProxyTimeout } from './src/lib/api-url';

/** Next only loads .env files from apps/web; the documented API_URL lives in the repo-root .env.
 *  Read just that one variable from there (never the API's secrets). */
function apiUrlFromRootEnv(): string | undefined {
  try {
    const text = readFileSync(path.resolve(__dirname, '../../.env'), 'utf8');
    const match = /^\s*API_URL\s*=\s*(.+?)\s*$/m.exec(text);
    return match?.[1]?.replace(/^["']|["']$/g, '');
  } catch {
    return undefined;
  }
}

const API_URL = resolveApiUrl(process.env.API_URL ?? apiUrlFromRootEnv());

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1'],
  agentRules: false,
  turbopack: { root: path.resolve(__dirname, '../..') },
  // Next's rewrite proxy defaults to 30s, which resets the socket on slow CPU inference.
  // Express owns the bounded inference deadlines (max 600s), so the proxy outlives them.
  experimental: { proxyTimeout: resolveProxyTimeout(process.env.WEB_PROXY_TIMEOUT_MS) },
  // The browser only talks to the Next.js origin; /api is proxied to the Express API.
  // This keeps the guest cookie first-party and means no CORS configuration is needed.
  async rewrites() {
    return apiRewrites(API_URL);
  },
};

export default nextConfig;
