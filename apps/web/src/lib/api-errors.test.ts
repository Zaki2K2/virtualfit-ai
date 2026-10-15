import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { describeError, shouldRetry } from './api-errors';

const err = (
  status: number,
  code: ConstructorParameters<typeof ApiError>[1],
  message = 'server message',
) => new ApiError(status, code, message);

describe('describeError', () => {
  it('never claims the API is unreachable for an HTTP 500 that came from the API', () => {
    const info = describeError(err(500, 'INTERNAL_ERROR', 'Something went wrong.'));
    expect(info.kind).toBe('server');
    expect(info.message).not.toMatch(/reach/i);
  });

  it('says the API is unreachable only when it really did not answer', () => {
    for (const code of ['API_UNREACHABLE', 'NETWORK_ERROR'] as const) {
      const info = describeError(err(code === 'NETWORK_ERROR' ? 0 : 500, code));
      expect(info.kind).toBe('unreachable');
      expect(info.message).toMatch(/running|reach/i);
    }
  });

  it.each([
    [err(0, 'TIMEOUT'), 'timeout', true],
    [err(400, 'VALIDATION_ERROR', 'Name is required'), 'validation', false],
    [err(415, 'UNSUPPORTED_IMAGE', 'must be JPEG or PNG'), 'validation', false],
    [err(401, 'INTERNAL_ERROR'), 'unauthorized', false],
    [err(404, 'NOT_FOUND', 'Clothing item not found'), 'not_found', false],
    [err(429, 'RATE_LIMITED', 'Slow down'), 'rate_limited', true],
    [err(503, 'DATABASE_UNAVAILABLE', 'db down'), 'database', true],
    [err(503, 'AI_UNAVAILABLE', 'Model is not available'), 'ai_unavailable', true],
    [err(429, 'AI_QUOTA_EXHAUSTED', 'GPU quota used up'), 'ai_quota', true],
    [err(504, 'AI_TIMEOUT', 'too slow'), 'timeout', true],
    [err(502, 'AI_FAILED', 'could not process'), 'ai_failed', true],
  ] as const)('classifies %# correctly', (e, kind, retryable) => {
    const info = describeError(e);
    expect(info.kind).toBe(kind);
    expect(info.retryable).toBe(retryable);
  });

  it('shows the API-provided message for user-actionable errors', () => {
    expect(describeError(err(400, 'VALIDATION_ERROR', 'Name is required')).message).toBe(
      'Name is required',
    );
    expect(describeError(err(429, 'AI_QUOTA_EXHAUSTED', 'GPU quota used up')).message).toBe(
      'GPU quota used up',
    );
  });

  it('handles unknown thrown values', () => {
    expect(describeError(new Error('boom')).kind).toBe('unknown');
    expect(describeError('x').message).toMatch(/try again/i);
  });
});

describe('shouldRetry (React Query policy)', () => {
  it('does not hammer a dead API', () => {
    expect(shouldRetry(0, err(500, 'API_UNREACHABLE'))).toBe(false);
    expect(shouldRetry(0, err(0, 'NETWORK_ERROR'))).toBe(false);
  });
  it('never retries client errors', () => {
    for (const e of [
      err(400, 'VALIDATION_ERROR'),
      err(404, 'NOT_FOUND'),
      err(429, 'RATE_LIMITED'),
    ]) {
      expect(shouldRetry(0, e)).toBe(false);
    }
  });
  it('retries transient server problems exactly once', () => {
    for (const e of [
      err(500, 'INTERNAL_ERROR'),
      err(0, 'TIMEOUT'),
      err(503, 'DATABASE_UNAVAILABLE'),
    ]) {
      expect(shouldRetry(0, e)).toBe(true);
      expect(shouldRetry(1, e)).toBe(false);
    }
  });
});
