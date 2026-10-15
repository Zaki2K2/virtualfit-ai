import type { Env } from '../../../config/env';
import type { VirtualTryOnProvider } from '../interfaces/virtual-try-on-provider';
import { GRADIO_PRESETS } from '../providers/gradio.presets';
import { GradioProvider, type GradioProviderConfig } from '../providers/gradio.provider';
import { MockProvider } from '../providers/mock.provider';

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

export function createProvider(env: Env): VirtualTryOnProvider {
  switch (env.AI_PROVIDER) {
    case 'gradio':
      return new GradioProvider(resolveGradioConfig(env));
    case 'mock':
    default:
      return new MockProvider(env.NODE_ENV === 'test' ? 0 : 1500);
  }
}
