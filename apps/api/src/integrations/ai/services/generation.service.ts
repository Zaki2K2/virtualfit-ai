import { AppError } from '../../../utils/errors';
import { sanitizeImage, type SanitizedImage } from '../../../utils/image';
import type { TryOnInput, VirtualTryOnProvider } from '../interfaces/virtual-try-on-provider';

const MAX_RESULT_BYTES = 20 * 1024 * 1024;

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

  async generate(input: Omit<TryOnInput, 'signal'>): Promise<SanitizedImage> {
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
      const output = await Promise.race([
        this.provider.generate({ ...input, signal: controller.signal }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason)),
        ),
      ]);
      const buffer = output.imageBuffer ?? (await this.fetchUrl(output.imageUrl));
      return await sanitizeImage(buffer, 'AI result');
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

  private async fetchUrl(url?: string): Promise<Buffer> {
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
    const res = await fetch(parsed);
    if (!res.ok) throw new AppError(502, 'AI_FAILED', 'Could not download the generated image.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_RESULT_BYTES)
      throw new AppError(502, 'AI_FAILED', 'Generated image too large.');
    return buf;
  }
}
