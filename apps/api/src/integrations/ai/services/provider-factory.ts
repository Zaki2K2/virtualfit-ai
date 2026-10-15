import type { ModelOptionId } from '@virtualfit/shared';
import type { Env } from '../../../config/env';
import type { VirtualTryOnProvider } from '../interfaces/virtual-try-on-provider';
import { CustomPythonProvider, type EngineModelVersion } from '../providers/custom-python.provider';
import { GRADIO_PRESETS } from '../providers/gradio.presets';
import { GradioProvider, type GradioProviderConfig } from '../providers/gradio.provider';
import { MockProvider } from '../providers/mock.provider';
import { GenerationService } from './generation.service';
import { ModelRegistry, type ModelEntry } from './model-registry';

/** Preset values are defaults; any explicitly set GRADIO_* variable wins. */
export function resolveGradioConfig(env: Env): GradioProviderConfig {
  const preset = env.GRADIO_PRESET ? GRADIO_PRESETS[env.GRADIO_PRESET] : undefined;
  return {
    spaceId: env.GRADIO_SPACE_ID ?? preset?.spaceId,
    apiName: env.GRADIO_API_NAME ?? preset?.apiName,
    paramsTemplate: env.GRADIO_PARAMS_TEMPLATE ?? preset?.paramsTemplate,
    outputIndex: env.GRADIO_OUTPUT_INDEX ?? preset?.outputIndex ?? 0,
    token: env.HF_TOKEN,
  };
}

function createEngineProvider(env: Env, modelVersion: EngineModelVersion): CustomPythonProvider {
  return new CustomPythonProvider({
    url: env.ENGINE_URL,
    apiKey: env.ENGINE_API_KEY,
    modelVersion,
  });
}

/** Which model the studio uses when the client does not choose one. */
export function defaultOptionFor(env: Env): ModelOptionId {
  switch (env.AI_PROVIDER) {
    case 'gradio':
      return 'hosted';
    case 'custom-python':
      return env.ENGINE_DEFAULT_MODEL;
    default:
      return 'mock';
  }
}

/** Provider of the default option (used by scripts such as live-smoke). */
export function createProvider(env: Env): VirtualTryOnProvider {
  const option = defaultOptionFor(env);
  switch (option) {
    case 'hosted':
      return new GradioProvider(resolveGradioConfig(env));
    case 'pretrained':
    case 'custom':
      return createEngineProvider(env, option);
    default:
      return new MockProvider(env.NODE_ENV === 'test' ? 0 : 1500);
  }
}

const OPTION_OF_PROVIDER = {
  mock: 'mock',
  gradio: 'hosted',
  'custom-python': 'pretrained',
} as const;

/**
 * Builds every selectable model. `injected` (tests) replaces the entry that matches its provider
 * id; it is probed through `isConfigured()`.
 */
export function buildRegistry(env: Env, injected?: VirtualTryOnProvider): ModelRegistry {
  const timeout = env.AI_TIMEOUT_MS;
  const gradio = new GradioProvider(resolveGradioConfig(env));
  const engine = {
    pretrained: createEngineProvider(env, 'pretrained'),
    custom: createEngineProvider(env, 'custom'),
  };
  const simple = (p: VirtualTryOnProvider, reason: string) => async () => ({
    available: p.isConfigured(),
    reason: p.isConfigured() ? 'ok' : reason,
  });

  const entries: Record<ModelOptionId, ModelEntry> = {
    mock: {
      id: 'mock',
      label: 'Mock simulation',
      generation: new GenerationService(
        new MockProvider(env.NODE_ENV === 'test' ? 0 : 1500),
        timeout,
      ),
      probe: async () => ({ available: true, reason: 'ok' }),
    },
    hosted: {
      id: 'hosted',
      label: 'Hosted model (Hugging Face)',
      generation: new GenerationService(gradio, timeout),
      probe: simple(
        gradio,
        'not configured - set GRADIO_PRESET=idm-vton (see docs/ai-integration.md)',
      ),
    },
    pretrained: {
      id: 'pretrained',
      label: 'Original pretrained model (CatVTON)',
      generation: new GenerationService(engine.pretrained, timeout),
      probe: () => engine.pretrained.probe(),
    },
    custom: {
      id: 'custom',
      label: 'VirtualFit custom model',
      generation: new GenerationService(engine.custom, timeout),
      probe: () => engine.custom.probe(),
    },
  };

  if (injected) {
    const id: ModelOptionId = OPTION_OF_PROVIDER[injected.id];
    entries[id] = {
      ...entries[id],
      generation: new GenerationService(injected, timeout),
      probe: simple(injected, 'not configured'),
    };
  }
  const defaultOption = injected ? OPTION_OF_PROVIDER[injected.id] : defaultOptionFor(env);
  return new ModelRegistry(Object.values(entries), defaultOption);
}
