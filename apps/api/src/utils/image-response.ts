import { AppError } from './errors';

export const MAX_RESULT_BYTES = 20 * 1024 * 1024;

/** Enforce the limit while reading, before an untrusted service can exhaust memory. */
export async function readImageResponse(res: Response): Promise<Buffer> {
  if (!res.body) throw new AppError(502, 'AI_FAILED', 'The AI service returned no image.');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESULT_BYTES)
        throw new AppError(502, 'AI_FAILED', 'Generated image too large.');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
