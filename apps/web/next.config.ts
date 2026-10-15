import path from 'node:path';
import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:5000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  turbopack: { root: path.resolve(__dirname, '../..') },
  // The browser only talks to the Next.js origin; /api is proxied to the Express API.
  // This keeps the guest cookie first-party and means no CORS configuration is needed.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
