import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { StylingContext, StylingProvider } from './styling-provider';
import { AppError } from '../../utils/errors';

export class RegisteredCustomProvider implements StylingProvider {
  constructor(private readonly delegate: StylingProvider) {}
  private registered() {
    try {
      const manifest = JSON.parse(
        readFileSync(
          path.resolve(__dirname, '../../../../../slm-engine/configs/custom-model.json'),
          'utf8',
        ),
      );
      return (
        manifest.approved === true &&
        manifest.optimizer_steps_completed > 0 &&
        manifest.model === 'virtualfit-fashion-custom' &&
        typeof manifest.gguf_sha256 === 'string'
      );
    } catch {
      return false;
    }
  }
  async status() {
    if (!this.registered())
      return {
        available: false,
        provider: 'llama-cpp' as const,
        model: 'virtualfit-fashion-custom',
        reason: 'No trained, evaluated and registered custom checkpoint exists.',
        local: true as const,
        customization: 'prompt-and-wardrobe-grounding' as const,
      };
    return this.delegate.status();
  }
  recommend(context: StylingContext, signal?: AbortSignal) {
    if (!this.registered())
      throw new AppError(
        503,
        'AI_UNAVAILABLE',
        'Custom checkpoint has not passed registration. The original model remains available.',
      );
    return this.delegate.recommend(context, signal);
  }
}
