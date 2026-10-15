import { AppError } from '../../../utils/errors';
import { sanitizeImage, type SanitizedImage } from '../../../utils/image';
import type { TryOnInput, VirtualTryOnProvider } from '../interfaces/virtual-try-on-provider';

import { MAX_RESULT_BYTES, readImageResponse } from '../../../utils/image-response';

export type GeneratedImage = SanitizedImage & { modelLabel?: string };

/**
 * Runs a provider with a hard timeout, normalises every failure into an AppError and validates
 * that what comes back is a real image (providers are not trusted either).
 */
export class GenerationService {
  constructor(
    private readonly provider: VirtualTryOnProvider,
    private readonly timeoutMs: number,
  ) {}

  get info() {
    return this.provider;
  }

  async generate(input: Omit<TryOnInput, 'signal'>): Promise<GeneratedImage> {
    if (!this.provider.isConfigured()) {
      throw new AppError(
        503,
        'AI_UNAVAILABLE',
        'The configured AI provider is not set up. See docs/ai-integration.md.',
      );
    }

    const controller = new AbortController();
    const timeoutError = new AppError(
      504,
      'AI_TIMEOUT',
      'The AI model took too long to respond. Please try again.',
    );
    const timer = setTimeout(() => controller.abort(timeoutError), this.timeoutMs);

    try {
      return await Promise.race([
        (async () => {
          const output = await this.provider.generate({ ...input, signal: controller.signal });
          const buffer =
            output.imageBuffer ?? (await this.fetchUrl(output.imageUrl, controller.signal));
          if (buffer.length > MAX_RESULT_BYTES)
            throw new AppError(502, 'AI_FAILED', 'Generated image too large.');
          return { ...(await sanitizeImage(buffer, 'AI result')), modelLabel: output.modelLabel };
        })(),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason)),
        ),
      ]);
    } catch (err) {
      if (err instanceof AppError) {
        // A provider returning garbage is a provider failure, not the user's bad upload.
        if (err.code === 'UNSUPPORTED_IMAGE') {
          throw new AppError(502, 'AI_FAILED', 'The AI service returned an invalid image.');
        }
        throw err;
      }
      throw new AppError(502, 'AI_FAILED', 'The AI service failed to generate a result.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchUrl(url: string | undefined, signal: AbortSignal): Promise<Buffer> {
    if (!url) throw new AppError(502, 'AI_FAILED', 'The AI service returned no image.');
    const parsed = new URL(url);
    const hostOk = this.provider.allowedImageHosts.some(
      (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
    );
    if (parsed.protocol !== 'https:' || !hostOk) {
      throw new AppError(
        502,
        'AI_FAILED',
        'The AI service returned an image from an untrusted host.',
      );
    }
    const res = await fetch(parsed, { signal, redirect: 'error' });
    if (!res.ok) throw new AppError(502, 'AI_FAILED', 'Could not download the generated image.');
    return readImageResponse(res);
  }
}
