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
