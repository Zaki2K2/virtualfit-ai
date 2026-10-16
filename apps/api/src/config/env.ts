import path from 'node:path';
import { z } from 'zod';
import { AI_PROVIDER_IDS, DEFAULT_MAX_UPLOAD_MB } from '@virtualfit/shared';
import { GRADIO_PRESET_IDS } from '../integrations/ai/providers/gradio.presets';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  MONGODB_URI: z.preprocess(emptyToUndefined, z.string().optional()),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(25).default(DEFAULT_MAX_UPLOAD_MB),
  RESULT_RETENTION_HOURS: z.coerce
    .number()
    .min(0.01)
    .max(24 * 30)
    .default(24),
  AI_PROVIDER: z.enum(AI_PROVIDER_IDS).default('mock'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(180_000),
  NOVA_VISION_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  NOVA_VISION_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  NOVA_VISION_MODEL: z.string().default('HuggingFaceTB/SmolVLM-256M-Instruct'),
  NOVA_VISION_EXTERNAL: z.enum(['true', 'false']).optional(),
  NOVA_IMAGE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  NOVA_IMAGE_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  NOVA_IMAGE_MODEL: z.string().default('segmind/SSD-1B'),
  NOVA_IMAGE_EXTERNAL: z.enum(['true', 'false']).optional(),
  NOVA_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  NOVA_QUEUE_SIZE: z.coerce.number().int().min(1).max(100).default(8),
  NOVA_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(120_000),
  NOVA_STORAGE_MB: z.coerce.number().min(10).max(100000).default(512),
  NOVA_MIN_FREE_DISK_MB: z.coerce.number().min(0).default(256),
  NOVA_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).default(180),
  SLM_URL: z
    .string()
    .url()
    .default('http://127.0.0.1:8081')
    .refine((value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return (
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
      );
    }, 'SLM_URL must be an HTTP loopback origin; styling is local-only'),
  SLM_MODEL: z.string().min(1).max(100).default('virtualfit-style-base'),
  SLM_CUSTOM_URL: z
    .string()
    .url()
    .default('http://127.0.0.1:8082')
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
          !url.username &&
          !url.password &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, 'SLM_CUSTOM_URL must be an HTTP loopback origin'),
  SLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(60_000),
  ENGINE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  ENGINE_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  ENGINE_DEFAULT_MODEL: z.enum(['pretrained', 'custom']).default('pretrained'),
  GRADIO_PRESET: z.preprocess(emptyToUndefined, z.enum(GRADIO_PRESET_IDS).optional()),
  GRADIO_SPACE_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  GRADIO_API_NAME: z.preprocess(emptyToUndefined, z.string().optional()),
  HF_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  GRADIO_PARAMS_TEMPLATE: z.preprocess(emptyToUndefined, z.string().optional()),
  GRADIO_OUTPUT_INDEX: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(20).optional(),
  ),
});

export type Env = z.infer<typeof envSchema> & { uploadDir: string; maxUploadBytes: number };

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  return {
    ...env,
    uploadDir: path.resolve(process.cwd(), env.UPLOAD_DIR),
    maxUploadBytes: Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024),
  };
}
