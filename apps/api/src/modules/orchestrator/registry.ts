import type { Env } from '../../config/env';
import type { ResourceMonitor } from './resources';

export const capabilities = [
  'text',
  'code',
  'vision',
  'image-generation',
  'image-editing',
  'speech-to-text',
  'text-to-speech',
  'embedding',
  'document-extraction',
  'virtual-try-on',
] as const;
export type Capability = (typeof capabilities)[number];

export interface ModelDescriptor {
  id: string;
  name: string;
  type: Capability;
  provider: string;
  execution: 'local' | 'remote';
  /** `planned` entries document intent only and can never resolve. */
  state: 'enabled' | 'unconfigured' | 'planned';
  /** True when the runtime is loaded on demand and must pass the resource gate first. */
  loadsOnDemand: boolean;
  isDefault: boolean;
  contextTokens?: number;
  hardware: {
    gpu: 'none' | 'recommended' | 'required';
    minFreeRamGb?: number;
    minVramGb?: number;
    /** Estimates from model cards; not measured on this project's hardware. */
    estimated: boolean;
  };
  license: { name: string; source: string };
  version: string;
  simulated?: boolean;
  note?: string;
}

export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';
export interface HealthReport {
  status: HealthStatus;
  reason: string;
  checkedAt: string | null;
}
export type HealthProbe = (signal: AbortSignal) => Promise<{ healthy: boolean; reason: string }>;

export type Resolution =
  { ok: true; model: ModelDescriptor } | { ok: false; reason: string; planned: boolean };

class ProbeTimeout extends Error {}

const HEALTH_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 3_000;

export class ModelRegistry {
  private readonly health = new Map<string, HealthReport>();
  constructor(
    private descriptors: ModelDescriptor[],
    private readonly probes: Record<string, HealthProbe> = {},
    private readonly monitor?: ResourceMonitor,
  ) {
    const ids = new Set<string>();
    for (const d of descriptors) {
      if (ids.has(d.id)) throw new Error(`Duplicate model id: ${d.id}`);
      ids.add(d.id);
    }
  }
  /** Registration is the provider-switching seam; nothing is probed or loaded here. */
  register(descriptor: ModelDescriptor, probe?: HealthProbe) {
    if (this.descriptors.some((d) => d.id === descriptor.id))
      throw new Error(`Duplicate model id: ${descriptor.id}`);
    this.descriptors = [...this.descriptors, descriptor];
    if (probe) this.probes[descriptor.id] = probe;
  }
  list() {
    return this.descriptors.map((d) => ({
      ...d,
      health: this.health.get(d.id) ?? {
        status: 'unknown' as const,
        reason: 'Not probed yet.',
        checkedAt: null,
      },
    }));
  }
  get(id: string) {
    return this.descriptors.find((d) => d.id === id);
  }
  async check(id: string, force = false, signal?: AbortSignal): Promise<HealthReport> {
    const model = this.get(id);
    if (!model) throw new Error(`Unknown model: ${id}`);
    const cached = this.health.get(id);
    if (!force && cached?.checkedAt && Date.now() - Date.parse(cached.checkedAt) < HEALTH_TTL_MS)
      return cached;
    const report = (status: HealthStatus, reason: string): HealthReport => {
      const value = { status, reason, checkedAt: new Date().toISOString() };
      this.health.set(id, value);
      return value;
    };
    if (model.state === 'planned') return report('unhealthy', 'Planned; no provider is wired.');
    if (model.state === 'unconfigured') return report('unhealthy', 'Not configured.');
    const probe = this.probes[id];
    if (!probe) return report('unknown', 'No health probe registered.');
    const deadline = AbortSignal.any([
      AbortSignal.timeout(PROBE_TIMEOUT_MS),
      ...(signal ? [signal] : []),
    ]);
    try {
      const result = await Promise.race([
        probe(deadline),
        new Promise<never>((_, reject) =>
          deadline.addEventListener('abort', () => reject(new ProbeTimeout()), { once: true }),
        ),
      ]);
      return report(result.healthy ? 'healthy' : 'unhealthy', result.reason);
    } catch (error) {
      // A slow answer is not evidence of failure (a busy CPU model); only a definite error is.
      if (error instanceof ProbeTimeout || deadline.aborted)
        return report('unknown', 'Health probe did not answer in time; the provider may be busy.');
      return report('unhealthy', `Probe failed: ${(error as Error).message}`);
    }
  }
  /** Picks the default (else first) usable model of a type; reports honestly why none is usable. */
  async resolve(type: Capability, options: { modelId?: string } = {}): Promise<Resolution> {
    const candidates = this.descriptors
      .filter((d) => d.type === type && (!options.modelId || d.id === options.modelId))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    if (!candidates.length)
      return { ok: false, planned: false, reason: `No ${type} model is registered.` };
    const reasons: string[] = [];
    for (const model of candidates) {
      if (model.state === 'planned') {
        reasons.push(`${model.name}: planned, not implemented.`);
        continue;
      }
      if (model.state === 'unconfigured') {
        reasons.push(`${model.name}: not configured.`);
        continue;
      }
      const health = await this.check(model.id);
      if (health.status === 'unhealthy') {
        reasons.push(`${model.name}: unhealthy (${health.reason})`);
        continue;
      }
      if (model.loadsOnDemand && this.monitor) {
        const admission = await this.monitor.admit({ minFreeRamGb: model.hardware.minFreeRamGb });
        if (!admission.ok) {
          reasons.push(`${model.name}: ${admission.reason}`);
          continue;
        }
      }
      return { ok: true, model };
    }
    return {
      ok: false,
      planned: candidates.every((c) => c.state === 'planned'),
      reason: reasons.join(' '),
    };
  }
}

const planned = (
  id: string,
  name: string,
  type: Capability,
  note: string,
  gpu: 'none' | 'recommended' | 'required' = 'recommended',
): ModelDescriptor => ({
  id,
  name,
  type,
  provider: 'none',
  execution: 'remote',
  state: 'planned',
  loadsOnDemand: true,
  isDefault: false,
  hardware: { gpu, estimated: true },
  license: { name: 'undecided', source: 'Select and review before enabling.' },
  version: 'n/a',
  note,
});

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/;

/** Descriptors derived from configuration only: no network calls, no model loading. */
export function defaultDescriptors(env: Env): ModelDescriptor[] {
  const execution = (url: string | undefined, external: string | undefined) =>
    url && (external !== 'false' || !LOOPBACK.test(url)) ? ('remote' as const) : ('local' as const);
  return [
    {
      id: 'nova-text-qwen',
      name: 'Qwen2.5-0.5B-Instruct (llama.cpp)',
      type: 'text',
      provider: 'llama.cpp',
      execution: 'local',
      state: 'enabled',
      loadsOnDemand: false,
      isDefault: true,
      contextTokens: 2048,
      hardware: { gpu: 'none', minFreeRamGb: 1, estimated: true },
      license: { name: 'Apache-2.0', source: 'Qwen2.5-0.5B-Instruct model card' },
      version: env.SLM_MODEL,
      note: 'Runs as its own always-on process; the API only calls it.',
    },
    {
      id: 'nova-vision-smolvlm',
      name: 'SmolVLM-256M-Instruct',
      type: 'vision',
      provider: 'nova-engine',
      execution: execution(env.NOVA_VISION_URL, env.NOVA_VISION_EXTERNAL),
      state: env.NOVA_VISION_URL ? 'enabled' : 'unconfigured',
      loadsOnDemand: false,
      isDefault: true,
      hardware: { gpu: 'recommended', minFreeRamGb: 2, estimated: true },
      license: { name: 'Apache-2.0', source: 'nova-engine/models.json' },
      version: env.NOVA_VISION_MODEL,
      note: 'Needs a configured worker; a configured URL is not proof that inference works.',
    },
    {
      id: 'nova-image-ssd1b',
      name: 'SSD-1B',
      type: 'image-generation',
      provider: 'nova-engine',
      execution: execution(env.NOVA_IMAGE_URL, env.NOVA_IMAGE_EXTERNAL),
      state: env.NOVA_IMAGE_URL ? 'enabled' : 'unconfigured',
      loadsOnDemand: false,
      isDefault: true,
      hardware: { gpu: 'required', minVramGb: 8, estimated: true },
      license: { name: 'Apache-2.0', source: 'nova-engine/models.json' },
      version: env.NOVA_IMAGE_MODEL,
    },
    {
      id: 'virtualfit-try-on',
      name: `VirtualFit try-on (${env.AI_PROVIDER})`,
      type: 'virtual-try-on',
      provider: env.AI_PROVIDER,
      execution: env.AI_PROVIDER === 'custom-python' ? 'local' : 'remote',
      state: 'enabled',
      loadsOnDemand: false,
      isDefault: true,
      hardware: { gpu: 'none', estimated: true },
      license: { name: 'per provider', source: 'docs/ai-providers' },
      version: env.AI_PROVIDER,
      simulated: env.AI_PROVIDER === 'mock',
      note: 'Existing VirtualFit pipeline, reused unchanged.',
    },
    {
      id: 'nova-embed-lexical-hash',
      name: 'Lexical hashing embedder',
      type: 'embedding',
      provider: 'builtin',
      execution: 'local',
      state: 'enabled',
      loadsOnDemand: false,
      isDefault: true,
      hardware: { gpu: 'none', estimated: false },
      license: { name: 'project code', source: 'this repository' },
      version: 'lexical-hash-v1',
      note: 'Keyword-overlap similarity. It is NOT a semantic neural embedding model.',
    },
    {
      id: 'nova-extract-plain-text',
      name: 'Plain-text / Markdown extractor',
      type: 'document-extraction',
      provider: 'builtin',
      execution: 'local',
      state: 'enabled',
      loadsOnDemand: false,
      isDefault: true,
      hardware: { gpu: 'none', estimated: false },
      license: { name: 'project code', source: 'this repository' },
      version: 'text-v1',
      note: 'Text and Markdown only. PDF and scanned documents are planned.',
    },
    planned(
      'planned-code',
      'Dedicated coding model',
      'code',
      'Until one is enabled, code questions may fall back to the general text model, labelled as degraded.',
    ),
    planned(
      'planned-image-edit',
      'Image editing model',
      'image-editing',
      'Needs a GPU worker.',
      'required',
    ),
    planned(
      'planned-stt',
      'Speech-to-text (Whisper-class)',
      'speech-to-text',
      'Small models can run on CPU.',
    ),
    planned('planned-tts', 'Text-to-speech', 'text-to-speech', 'Small models can run on CPU.'),
  ];
}
