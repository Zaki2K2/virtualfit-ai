import type { ModelOption, ModelOptionId } from '@virtualfit/shared';
import { AppError } from '../../../utils/errors';
import type { EngineProbe } from '../providers/custom-python.provider';
import type { GenerationService } from './generation.service';

export interface ModelEntry {
  id: ModelOptionId;
  label: string;
  generation: GenerationService;
  /** Cheap availability check (cached by the registry). Must not throw. */
  probe: () => Promise<EngineProbe>;
}

const CACHE_MS = 15_000;

/**
 * The selectable models. A request for a model that is not available FAILS with AI_UNAVAILABLE;
 * it is never silently served by a different (e.g. mock) model.
 */
export class ModelRegistry {
  private readonly cache = new Map<ModelOptionId, { at: number; value: EngineProbe }>();

  constructor(
    private readonly entries: ModelEntry[],
    readonly defaultOption: ModelOptionId,
  ) {
    if (!entries.some((e) => e.id === defaultOption))
      throw new Error(`unknown default model ${defaultOption}`);
  }

  entry(id: ModelOptionId): ModelEntry {
    const found = this.entries.find((e) => e.id === id);
    if (!found) throw AppError.badRequest(`Unknown model "${id}".`);
    return found;
  }

  private async availability(entry: ModelEntry): Promise<EngineProbe> {
    const hit = this.cache.get(entry.id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await entry.probe();
    this.cache.set(entry.id, { at: Date.now(), value });
    return value;
  }

  async options(): Promise<ModelOption[]> {
    return Promise.all(
      this.entries.map(async (e) => {
        const a = await this.availability(e);
        return {
          id: e.id,
          label: e.label,
          available: a.available,
          reason: a.available ? 'ok' : a.reason,
          simulated: e.generation.info.simulated,
          externalProcessing: e.generation.info.externalProcessing,
        };
      }),
    );
  }

  /** Picks the requested (or default) model and verifies it can run now. */
  async resolve(id?: ModelOptionId): Promise<ModelEntry> {
    const entry = this.entry(id ?? this.defaultOption);
    const a = await this.availability(entry);
    if (!a.available) {
      throw new AppError(503, 'AI_UNAVAILABLE', `${entry.label} is not available: ${a.reason}`);
    }
    return entry;
  }

  invalidate() {
    this.cache.clear();
  }
}
