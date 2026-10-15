import type { GradioProviderConfig } from './gradio.provider';

/**
 * Ready-made configurations whose endpoint and parameters were read from the Space's own API
 * description (`npm run ai:inspect`) and verified with a real generation. Community Spaces can
 * change or disappear: re-verify before relying on one, and override any field through env vars.
 */
export const GRADIO_PRESETS = {
  'idm-vton': {
    // yisol/IDM-VTON, Gradio 4.24, ZeroGPU, license CC BY-NC-SA 4.0 (noncommercial).
    // Verified 2026-10-15: anonymous call returned a real try-on in ~18 s.
    spaceId: 'yisol/IDM-VTON',
    apiName: '/tryon',
    paramsTemplate: JSON.stringify({
      dict: { background: '{{person}}', layers: [], composite: null },
      garm_img: '{{garment}}',
      garment_des: '{{category}} garment',
      is_checked: true, // auto-masking: the model finds the area to replace
      is_checked_crop: false,
      denoise_steps: 30,
      seed: 42,
    }),
    outputIndex: 0,
  },
} as const satisfies Record<string, Omit<GradioProviderConfig, 'token'>>;

export type GradioPresetId = keyof typeof GRADIO_PRESETS;
export const GRADIO_PRESET_IDS = Object.keys(GRADIO_PRESETS) as GradioPresetId[];
