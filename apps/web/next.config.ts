import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';
import { apiRewrites, resolveApiUrl } from './src/lib/api-url';

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
  agentRules: false,
  turbopack: { root: path.resolve(__dirname, '../..') },
  // The browser only talks to the Next.js origin; /api is proxied to the Express API.
  // This keeps the guest cookie first-party and means no CORS configuration is needed.
  async rewrites() {
    return apiRewrites(API_URL);
  },
};

export default nextConfig;
