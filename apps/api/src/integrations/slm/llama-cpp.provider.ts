import {
  stylingOutputSchema,
  nova,
  novaStylingSystem,
  novaIdentityGuidance,
  novaIdentityResponseValid,
  type StylingStatus,
  type StylingOutput,
  type ClothingCategory,
} from '@virtualfit/shared';
import type { Env } from '../../config/env';
import { AppError } from '../../utils/errors';
import type { StylingContext, StylingProvider } from './styling-provider';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Fixed schema, never supplied by the user. Dynamic enum prevents invented wardrobe IDs.
export function recommendationSchema(
  ids: string[],
  categories?: ClothingCategory[],
  requiredItems?: number,
) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      answer: { type: 'string', maxLength: 600 },
      itemIds: {
        type: 'array',
        minItems: requiredItems ?? 0,
        maxItems: requiredItems ?? (ids.length ? 4 : 0),
        items: ids.length ? { type: 'string', enum: ids } : { type: 'string' },
      },
      occasion: { type: 'string', maxLength: 80 },
      categories: {
        type: 'array',
        minItems: categories?.length ?? 0,
        maxItems: categories?.length ?? 4,
        items: categories?.length
          ? { type: 'string', enum: categories }
          : categories
            ? { type: 'string' }
            : { type: 'string', enum: ['tops', 'bottoms', 'dresses', 'outerwear'] },
      },
    },
    required: ['answer', 'itemIds', 'occasion', 'categories'],
  };
}

export function stylingMessages(context: StylingContext) {
  // Express has resolved follow-up constraints against a fresh permitted inventory.
  // Raw earlier requests can contradict the latest occasion/color and need not be
  // forwarded to the model; only current intent and verified preferences are used.
  const { history: _history, ...current } = context;
  return [
    {
      role: 'system',
      content: novaStylingSystem + (novaIdentityGuidance(context.message)
        ? ` For this identity question, use these verified facts: ${novaIdentityGuidance(context.message)}`
        : ''),
    },
    { role: 'user', content: JSON.stringify(current) },
  ];
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty runtime response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32_768) throw new Error('Runtime response too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class LlamaCppStylingProvider implements StylingProvider {
  private lastInferenceAt = 0;
  private probe?: Promise<boolean>;
  private generating = false;
  constructor(private readonly env: Env) {}

  private async verifyInference(): Promise<boolean> {
    if (this.lastInferenceAt && (this.generating || Date.now() - this.lastInferenceAt < 30_000))
      return true;
    if (!this.probe) {
      this.probe = (async () => {
        try {
          const res = await fetch(new URL('/v1/chat/completions', this.env.SLM_URL), {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(this.env.SLM_TIMEOUT_MS),
            headers: this.headers(),
            body: JSON.stringify({
              model: this.env.SLM_MODEL,
              messages: [{ role: 'user', content: 'Reply READY.' }],
              max_tokens: 4,
              temperature: 0,
              stream: false,
            }),
          });
          if (!res.ok) return false;
          const body = (await boundedJson(res)) as {
            model?: string;
            choices?: Array<{ message?: { content?: unknown } }>;
            usage?: { completion_tokens?: number };
          };
          const text = body.choices?.[0]?.message?.content;
          const verified =
            body.model === this.env.SLM_MODEL &&
            typeof text === 'string' &&
            text.trim().length > 0 &&
            (body.usage?.completion_tokens ?? 0) > 0;
          if (verified) this.lastInferenceAt = Date.now();
          return verified;
        } catch {
          return false;
        }
      })().finally(() => {
        this.probe = undefined;
      });
    }
    return this.probe;
  }

  private headers(): Record<string, string> {
    try {
      const key = readFileSync(
        path.resolve(__dirname, '../../../../../slm-engine/runtime/api-key.txt'),
        'utf8',
      ).trim();
      return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
    } catch {
      return { 'Content-Type': 'application/json' };
    }
  }

  async status(): Promise<StylingStatus> {
    const base: StylingStatus = {
      available: false,
      provider: 'llama-cpp',
      model: this.env.SLM_MODEL,
      reason: 'Local Qwen is unavailable. Start npm run dev:ai or npm run slm:serve.',
      local: true,
      displayName:
        this.env.SLM_MODEL === 'virtualfit-style-base'
          ? `${nova.label} / ${nova.tagline} / Qwen2.5-0.5B Q4 / local CPU`
          : 'VirtualFit custom checkpoint / local CPU',
      inferenceVerified: false,
      customization: 'prompt-and-wardrobe-grounding',
    };
    try {
      const res = await fetch(new URL('/v1/models', this.env.SLM_URL), {
        signal: AbortSignal.timeout(2000),
        redirect: 'error',
        headers: this.headers(),
      });
      if (!res.ok) return { ...base, reason: 'Local language model is loading or unavailable.' };
      const body = (await boundedJson(res)) as { data?: Array<{ id?: string }> };
      const loaded = Array.isArray(body.data) && body.data.some((m) => m.id === this.env.SLM_MODEL);
      const available = loaded && (await this.verifyInference());
      if (!loaded) this.lastInferenceAt = 0;
      return {
        ...base,
        available,
        inferenceVerified: available,
        checkedAt: available ? new Date(this.lastInferenceAt).toISOString() : undefined,
        reason: available
          ? 'Local Qwen is ready; an inference request succeeded.'
          : loaded
            ? 'Model is loaded, but inference is not ready. Check the local runtime terminal.'
            : 'Configured model alias is not loaded.',
      };
    } catch {
      this.lastInferenceAt = 0;
      return base;
    }
  }

  async recommend(context: StylingContext): Promise<StylingOutput> {
    const signal = AbortSignal.timeout(this.env.SLM_TIMEOUT_MS);
    let schemaValid = false;
    this.generating = true;
    try {
      const res = await fetch(new URL('/v1/chat/completions', this.env.SLM_URL), {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: this.headers(),
        body: JSON.stringify({
          model: this.env.SLM_MODEL,
          messages: stylingMessages(context),
          temperature: 0.2,
          seed: 42,
          max_tokens: 260,
          stream: false,
          response_format: {
            type: 'json_object',
            schema: recommendationSchema(
              context.responseMode && context.responseMode !== 'outfit'
                ? []
                : context.wardrobe.map((i) => i.id),
              context.selectionCategories,
              context.selectionPlan?.length,
            ),
          },
        }),
      }).catch((err: unknown) => {
        if (signal.aborted) throw err;
        throw new AppError(
          503,
          'AI_UNAVAILABLE',
          'Cannot reach local Qwen. Start npm run dev:ai or npm run slm:serve, then check again.',
        );
      });
      if (!res.ok)
        throw new AppError(
          res.status === 503 ? 503 : 502,
          res.status === 503 ? 'AI_UNAVAILABLE' : 'AI_FAILED',
          'The local styling model could not complete this request.',
        );
      const body = (await boundedJson(res)) as {
        model?: string;
        choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
      };
      if (body.model && body.model !== this.env.SLM_MODEL)
        throw new Error('Unexpected loaded model');
      const choice = body.choices?.[0];
      if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string')
        throw new Error('Truncated or malformed completion');
      const result = stylingOutputSchema.parse(JSON.parse(choice.message.content));
      schemaValid = true;
      if (!novaIdentityResponseValid(context.message, result.answer))
        throw new Error('Identity answer contradicts or omits configured product provenance');
      const sentences =
        result.answer
          .toLowerCase()
          .match(/[^.!?]+[.!?]*/g)
          ?.map((part) => part.trim()) ?? [];
      if (
        result.answer.split(/\s+/).length > 80 ||
        /<\/?think>|\b(?:body measurements|your height|your weight|your size|fits your body|available in.{0,30}sizes)\b/i.test(
          result.answer,
        ) ||
        (sentences.length > 1 && new Set(sentences).size !== sentences.length)
      )
        throw new Error('Repetitive, overlong or unsupported physical claim');
      if (
        context.responseMode === 'unavailable' &&
        !/\b(no|not|unavailable|missing|cannot|add)\b|can't|don't/i.test(result.answer)
      )
        throw new Error('Unavailable inventory requires an honest no-match explanation');
      const allowed = new Set(context.wardrobe.map((i) => i.id));
      if (
        new Set(result.itemIds).size !== result.itemIds.length ||
        result.itemIds.some((id) => !allowed.has(id))
      )
        throw new Error('Ungrounded recommendation');
      this.lastInferenceAt = Date.now();
      return result;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (signal.aborted) {
        this.lastInferenceAt = 0;
        throw new AppError(
          504,
          'AI_TIMEOUT',
          'Local Qwen took too long. Wait for the current request to finish, then try again.',
        );
      }
      throw new AppError(
        502,
        'AI_FAILED',
        'The styling model returned an invalid recommendation. Please retry.',
        { invalidOutput: true, schemaValid },
      );
    } finally {
      this.generating = false;
    }
  }
}
