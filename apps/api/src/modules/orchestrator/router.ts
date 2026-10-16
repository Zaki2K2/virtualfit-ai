import type { Capability, ModelDescriptor, ModelRegistry } from './registry';

export interface TaskInput {
  message: string;
  hasImage?: boolean;
  mode?: 'chat' | 'image' | 'wardrobe';
}
export interface Classification {
  capability: Capability;
  reason: string;
}

const rules: Array<[Capability, RegExp, string]> = [
  [
    'speech-to-text',
    /\b(transcribe|transcription|speech[- ]to[- ]text)\b/i,
    'asks for transcription',
  ],
  [
    'text-to-speech',
    /\b(read (it |this )?(aloud|out loud)|text[- ]to[- ]speech|speak (this|it))\b/i,
    'asks for speech output',
  ],
  [
    'virtual-try-on',
    /\b(try[- ]?on|try (this|it) on|virtual(ly)? (try|fitting))\b/i,
    'asks for virtual try-on',
  ],
  [
    'image-generation',
    /\b(generate|create|draw|make|render|paint)\b.{0,40}\b(image|picture|photo|illustration|artwork)\b/i,
    'asks to create an image',
  ],
  [
    'document-extraction',
    /\b(pdf|summari[sz]e (this|the|my) (document|file)|extract text|uploaded document)\b/i,
    'refers to a document',
  ],
  [
    'code',
    /```|\b(typescript|javascript|python|function|stack ?trace|compile error|unit test|regex|sql query|refactor|debug)\b/i,
    'contains coding cues',
  ],
];

/** Deterministic and inspectable on purpose: no model decides which model runs. */
export function classifyTask(input: TaskInput): Classification {
  if (input.mode === 'image')
    return { capability: 'image-generation', reason: 'Image mode selected by the user.' };
  if (input.hasImage) {
    return /\b(edit|change|remove|replace|recolou?r|retouch|inpaint)\b/i.test(input.message)
      ? { capability: 'image-editing', reason: 'Image attached with an edit request.' }
      : { capability: 'vision', reason: 'Image attached.' };
  }
  for (const [capability, pattern, reason] of rules)
    if (pattern.test(input.message)) return { capability, reason: `Message ${reason}.` };
  return { capability: 'text', reason: 'General conversation.' };
}

export type RouteDecision =
  | {
      status: 'routed';
      capability: Capability;
      reason: string;
      model: Pick<ModelDescriptor, 'id' | 'name' | 'execution' | 'simulated'>;
      degraded: false;
    }
  | {
      status: 'fallback';
      capability: Capability;
      reason: string;
      model: Pick<ModelDescriptor, 'id' | 'name' | 'execution' | 'simulated'>;
      degraded: true;
      fallbackReason: string;
    }
  | { status: 'unavailable'; capability: Capability; reason: string; planned: boolean };

/** Only coding may degrade to the general text model; every other gap is reported, never faked. */
const fallbacks: Partial<Record<Capability, Capability>> = { code: 'text' };

const brief = (m: ModelDescriptor) => ({
  id: m.id,
  name: m.name,
  execution: m.execution,
  simulated: m.simulated,
});

export async function routeTask(
  registry: ModelRegistry,
  input: TaskInput,
  options: { modelId?: string } = {},
): Promise<RouteDecision> {
  const { capability, reason } = classifyTask(input);
  const primary = await registry.resolve(capability, options);
  if (primary.ok)
    return { status: 'routed', capability, reason, model: brief(primary.model), degraded: false };
  const fallback = fallbacks[capability];
  if (fallback && !options.modelId) {
    const alt = await registry.resolve(fallback);
    if (alt.ok)
      return {
        status: 'fallback',
        capability,
        reason,
        model: brief(alt.model),
        degraded: true,
        fallbackReason: `No ${capability} model is usable (${primary.reason}) so the general ${fallback} model was chosen; quality may be lower.`,
      };
  }
  return { status: 'unavailable', capability, reason: primary.reason, planned: primary.planned };
}
