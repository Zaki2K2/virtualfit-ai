import { isIP } from 'node:net';
import type { ClothingCategory } from '@virtualfit/shared';
import { AppError } from '../../../utils/errors';
import { readImageResponse } from '../../../utils/image-response';
import type {
  TryOnInput,
  TryOnOutput,
  VirtualTryOnProvider,
} from '../interfaces/virtual-try-on-provider';

export type EngineModelVersion = 'pretrained' | 'custom';

export interface CustomPythonConfig {
  /** Base URL of the FastAPI engine (ai-engine/). Unset = provider not configured. */
  url?: string;
  /** Shared secret sent as X-Engine-Key. Server side only. */
  apiKey?: string;
  modelVersion: EngineModelVersion;
}

export interface EngineProbe {
  available: boolean;
  reason: string;
}

const PROBE_TIMEOUT_MS = 2000;

export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
  } catch {
    return false;
  }
}

/** Maps the engine's stable error codes onto the API's error vocabulary. */
export function mapEngineError(
  status: number,
  code: string | undefined,
  message: string,
): AppError {
  switch (code) {
    case 'GPU_UNAVAILABLE':
    case 'MODEL_UNAVAILABLE':
    case 'MASKER_UNAVAILABLE':
    case 'UNAUTHORIZED':
      return new AppError(503, 'AI_UNAVAILABLE', `AI engine: ${message}`);
    case 'TIMEOUT':
      return new AppError(
        504,
        'AI_TIMEOUT',
        'The AI engine took too long to respond. Please try again.',
      );
    case 'BUSY':
      return new AppError(
        429,
        'RATE_LIMITED',
        'The AI engine is busy with another generation. Try again shortly.',
      );
    case 'UNSUPPORTED_CATEGORY':
    case 'BAD_MASK':
    case 'UNSUPPORTED_IMAGE':
    case 'VALIDATION_ERROR':
    case 'FILE_TOO_LARGE':
      return new AppError(502, 'AI_FAILED', `The AI engine rejected this input: ${message}`);
    default:
      return new AppError(502, 'AI_FAILED', `The AI engine failed (${status}). ${message}`.trim());
  }
}

/**
 * Talks to our own Python engine (ai-engine/). The engine decides whether it can really run
 * (CUDA GPU, checkpoints, masker); this class only forwards the request and reports its answer
 * honestly. It never falls back to another provider.
 */
export class CustomPythonProvider implements VirtualTryOnProvider {
  readonly id = 'custom-python' as const;
  readonly simulated = false;
  readonly allowedImageHosts = [] as const;
  private lastModelLabel: string | null = null;

  constructor(private readonly config: CustomPythonConfig) {}

  get model() {
    return this.lastModelLabel ?? `catvton (${this.config.modelVersion})`;
  }

  /** Photos leave this server only when the engine is not on this machine. */
  get externalProcessing() {
    return !this.config.url || !isLoopbackUrl(this.config.url);
  }

  isConfigured() {
    return Boolean(this.config.url);
  }

  private headers(): Record<string, string> {
    return this.config.apiKey ? { 'X-Engine-Key': this.config.apiKey } : {};
  }

  /** Asks the engine whether this model version can run right now. Never throws. */
  async probe(): Promise<EngineProbe> {
    if (!this.config.url)
      return { available: false, reason: 'ENGINE_URL is not set (Python engine not configured)' };
    try {
      const res = await fetch(new URL('/health', this.config.url), {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: this.headers(),
      });
      if (!res.ok)
        return { available: false, reason: `Python engine health check failed (${res.status})` };
      const body = (await res.json()) as {
        models?: Record<string, { available: boolean; reason: string }>;
      };
      const info = body.models?.[this.config.modelVersion];
      if (!info) return { available: false, reason: 'Python engine did not report this model' };
      return { available: info.available, reason: info.available ? 'ok' : info.reason };
    } catch {
      return { available: false, reason: 'Python engine is not reachable (is it running?)' };
    }
  }

  async generate({
    personImage,
    garmentImage,
    category,
    signal,
  }: TryOnInput): Promise<TryOnOutput> {
    if (!this.config.url) {
      throw new AppError(
        503,
        'AI_UNAVAILABLE',
        'The Python engine is not configured (set ENGINE_URL).',
      );
    }
    const form = new FormData();
    form.append(
      'person',
      new Blob([new Uint8Array(personImage)], { type: 'image/png' }),
      'person.png',
    );
    form.append(
      'garment',
      new Blob([new Uint8Array(garmentImage)], { type: 'image/png' }),
      'garment.png',
    );
    form.append('category', category satisfies ClothingCategory);
    form.append('model_version', this.config.modelVersion);

    let res: Response;
    try {
      res = await fetch(new URL('/v1/inference/try-on', this.config.url), {
        method: 'POST',
        body: form,
        headers: this.headers(),
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new AppError(
        503,
        'AI_UNAVAILABLE',
        'The Python engine is not reachable (is it running?).',
      );
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw mapEngineError(res.status, body?.error?.code, body?.error?.message ?? res.statusText);
    }
    if (!res.headers.get('content-type')?.startsWith('image/')) {
      throw new AppError(502, 'AI_FAILED', 'The Python engine returned a non-image response.');
    }
    const label = res.headers.get('x-model-version');
    this.lastModelLabel = label;
    return { imageBuffer: await readImageResponse(res), modelLabel: label ?? undefined };
  }
}
