import { describe, expect, it } from 'vitest';
import { DEFAULT_API_URL, apiRewrites, resolveApiUrl } from './api-url';

describe('resolveApiUrl', () => {
  it('defaults to the Express dev server on port 5000', () => {
    expect(DEFAULT_API_URL).toBe('http://localhost:5000');
    expect(resolveApiUrl(undefined)).toBe('http://localhost:5000');
    expect(resolveApiUrl('   ')).toBe('http://localhost:5000');
  });

  it('normalises trailing slashes and paths', () => {
    expect(resolveApiUrl('http://localhost:5000/')).toBe('http://localhost:5000');
    expect(resolveApiUrl('https://api.example.edu/api/v1')).toBe('https://api.example.edu');
  });

  it('rejects values that would otherwise cause a 500 on every request', () => {
    expect(() => resolveApiUrl('localhost:5000')).toThrow(/http/);
    expect(() => resolveApiUrl('not a url')).toThrow(/not a valid URL/);
    expect(() => resolveApiUrl('ftp://host')).toThrow(/http/);
  });
});

describe('apiRewrites', () => {
  it('proxies /api/* to the API origin keeping the path', () => {
    expect(apiRewrites('http://localhost:5000')).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:5000/api/:path*' },
    ]);
  });
});
