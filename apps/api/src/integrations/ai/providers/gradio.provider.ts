import { CATEGORY_TO_CLOTH_TYPE } from '@virtualfit/shared';
import { AppError } from '../../../utils/errors';
import { logger } from '../../../utils/logger';
import { readImageResponse } from '../../../utils/image-response';
import type {
  TryOnInput,
  TryOnOutput,
  VirtualTryOnProvider,
} from '../interfaces/virtual-try-on-provider';

export interface GradioProviderConfig {
  spaceId?: string;
  apiName?: string;
  token?: string;
  /** JSON string: object (named params) or array (positional) with {{placeholders}}. */
  paramsTemplate?: string;
  outputIndex: number;
}

const PLACEHOLDER = /^\{\{(person|garment|clothType|category)\}\}$/;

type Values = {
  person: unknown;
  garment: unknown;
  clothType: string;
  category: string;
};

/** Recursively replaces "{{placeholder}}" strings in the template with real values. */
export function fillTemplate(node: unknown, values: Values): unknown {
  if (typeof node === 'string') {
    const m = PLACEHOLDER.exec(node);
    return m ? values[m[1] as keyof Values] : node;
  }
  if (Array.isArray(node)) return node.map((n) => fillTemplate(n, values));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillTemplate(v, values)]));
  }
  return node;
}

/** Finds the first Gradio file reference ({url} or {path}) inside an output value. */
export function findFileRef(value: unknown): { url?: string; path?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.url === 'string') return { url: obj.url };
  if (typeof obj.path === 'string') return { path: obj.path };
  for (const child of Object.values(obj)) {
    const found = findFileRef(child);
    if (found) return found;
  }
  return null;
}

export function classifyGradioError(message: string): AppError {
  const m = message.toLowerCase();
  if (/quota|zerogpu|gpu.*(limit|exceed)|exceeded.*gpu|too many requests|rate.?limit|429/.test(m)) {
    return new AppError(
      429,
      'AI_QUOTA_EXHAUSTED',
      'The AI service has run out of free GPU quota. Please wait a few minutes (or sign in with a Hugging Face token on the server) and try again.',
    );
  }
  if (
    /sleeping|starting|building|paused|runtime_error|not found|could not get space|could not be accessed|401|404|503/.test(
      m,
    )
  ) {
    return new AppError(
      503,
      'AI_UNAVAILABLE',
      'The AI Space is currently unavailable (it may be asleep, restarting or removed). Try again later.',
    );
  }
  return new AppError(
    502,
    'AI_FAILED',
    'The AI service could not process these images. Try different photos.',
  );
}

/**
 * Adapter for Hugging Face Spaces served through Gradio.
 *
 * It deliberately knows NOTHING about a particular Space: the endpoint name and parameter layout
 * come from configuration that must be copied from `npm run ai:inspect -- <space>`. If any of it is
 * missing the provider reports itself as not configured instead of guessing.
 */
export class GradioProvider implements VirtualTryOnProvider {
  readonly id = 'gradio' as const;

  get model() {
    return this.config.spaceId ?? 'unconfigured';
  }
  readonly simulated = false;
  readonly externalProcessing = true;
  readonly allowedImageHosts = ['hf.space', 'huggingface.co', 'hf.co'] as const;

  constructor(private readonly config: GradioProviderConfig) {}

  isConfigured() {
    return Boolean(this.config.spaceId && this.config.apiName && this.parseTemplate());
  }

  private parseTemplate(): unknown | null {
    if (!this.config.paramsTemplate) return null;
    try {
      const parsed: unknown = JSON.parse(this.config.paramsTemplate);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async generate({
    personImage,
    garmentImage,
    category,
    signal,
  }: TryOnInput): Promise<TryOnOutput> {
    const template = this.parseTemplate();
    if (!this.isConfigured() || !template) {
      throw new AppError(
        503,
        'AI_UNAVAILABLE',
        'Real AI generation is not configured on this server. Set GRADIO_SPACE_ID, GRADIO_API_NAME and GRADIO_PARAMS_TEMPLATE (see docs/ai-integration.md).',
      );
    }

    const { Client, handle_file } = await import('@gradio/client');
    let closeClient: (() => void) | undefined;
    let cancelJob: (() => void) | undefined;
    try {
      signal?.throwIfAborted();
      const client = await Client.connect(this.config.spaceId as string, {
        ...(this.config.token ? { token: this.config.token as `hf_${string}` } : {}),
      });
      closeClient = () => {
        client.heartbeat_event?.close();
        client.close();
      };
      signal?.throwIfAborted();
      const payload = fillTemplate(template, {
        person: handle_file(new Blob([new Uint8Array(personImage)], { type: 'image/png' })),
        garment: handle_file(new Blob([new Uint8Array(garmentImage)], { type: 'image/png' })),
        clothType: CATEGORY_TO_CLOTH_TYPE[category],
        category,
      });

      // all_events=true so failures arrive as status events (the client otherwise ends the stream silently)
      const job = client.submit(
        this.config.apiName as string,
        payload as Record<string, unknown>,
        undefined,
        null,
        true,
      );
      cancelJob = () => {
        void job.cancel().catch(() => undefined);
        closeClient?.();
      };
      signal?.addEventListener('abort', cancelJob, { once: true });
      if (signal?.aborted) {
        cancelJob();
        signal.throwIfAborted();
      }

      let data: unknown[] | null = null;
      let failure: string | null = null;
      for await (const msg of job) {
        if (msg.type === 'data') data = msg.data as unknown[];
        if (msg.type === 'status' && msg.stage === 'error') {
          failure = String((msg as { message?: string }).message ?? 'error');
        }
      }
      if (signal?.aborted) throw signal.reason;
      if (!data) throw new Error(failure ?? 'Space returned no data');

      const ref = findFileRef(data[this.config.outputIndex]);
      if (!ref?.url) throw new Error('Space output did not contain an image URL');
      return { imageBuffer: await this.download(ref.url, signal) };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (signal?.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Gradio call failed', {
        space: this.config.spaceId,
        message: message.slice(0, 300),
      });
      throw classifyGradioError(message);
    } finally {
      if (cancelJob) signal?.removeEventListener('abort', cancelJob);
      closeClient?.();
    }
  }

  private async download(url: string, signal?: AbortSignal): Promise<Buffer> {
    const parsed = new URL(url);
    const hostOk = this.allowedImageHosts.some(
      (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
    );
    if (parsed.protocol !== 'https:' || !hostOk) {
      throw new AppError(
        502,
        'AI_FAILED',
        'The AI service returned an image from an untrusted host.',
      );
    }
    const res = await fetch(parsed, {
      signal,
      redirect: 'error',
      headers: this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {},
    });
    if (!res.ok) throw new Error(`Result download failed (${res.status})`);
    return readImageResponse(res);
  }
}
