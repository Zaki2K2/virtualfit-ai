import path from 'node:path';
import type { HealthStatus } from '@virtualfit/shared';
import type { Env } from './config/env';
import { memoryCollectionFactory, type CollectionFactory } from './db/collection';
import type { VirtualTryOnProvider } from './integrations/ai/interfaces/virtual-try-on-provider';
import { buildRegistry } from './integrations/ai/services/provider-factory';
import { FavoritesService } from './modules/favorites/favorites.service';
import { favoriteSchema } from './modules/favorites/favorites.model';
import type { FavoriteDoc } from './modules/favorites/favorites.types';
import { clothingSchema } from './modules/clothing/clothing.model';
import { ClothingService } from './modules/clothing/clothing.service';
import type { ClothingDoc } from './modules/clothing/clothing.types';
import { HistoryService } from './modules/history/history.service';
import { tryOnSchema } from './modules/try-on/try-on.model';
import { TryOnService } from './modules/try-on/try-on.service';
import type { TryOnDoc } from './modules/try-on/try-on.types';
import { userSchema } from './modules/users/users.model';
import { UsersService } from './modules/users/users.service';
import type { UserDoc } from './modules/users/users.types';
import { FileStore } from './storage/file-store';
import { logger } from './utils/logger';
import { LlamaCppStylingProvider } from './integrations/slm/llama-cpp.provider';
import type { StylingProvider } from './integrations/slm/styling-provider';
import { StylingService } from './modules/styling/styling.service';
import { RegisteredCustomProvider } from './integrations/slm/registered-custom.provider';
import { NovaStore } from './modules/nova/models';
import { NovaService } from './modules/nova/service';
import {
  LocalNovaLanguage,
  CompatibleVision,
  CompatibleImages,
  type NovaLanguageProvider,
  type NovaVisionProvider,
  type NovaImageProvider,
} from './modules/nova/providers';

export interface ContainerOptions {
  novaLanguage?: NovaLanguageProvider;
  novaVision?: NovaVisionProvider;
  novaImages?: NovaImageProvider;
  collections?: CollectionFactory;
  database?: HealthStatus['database'];
  /** Live database connection check (MongoDB). Defaults to always up (in-memory store). */
  databaseUp?: () => boolean;
  provider?: VirtualTryOnProvider;
  catalogDir?: string;
  stylingProvider?: StylingProvider;
  customStylingProvider?: StylingProvider;
  /** Test harness only; production always uses unpredictable generated IDs. */
  clothingIdFactory?: () => string;
}

/** Composition root: wires modules together once, so tests can swap storage and AI provider. */
export function createContainer(env: Env, options: ContainerOptions = {}) {
  const collections = options.collections ?? memoryCollectionFactory;
  const database = options.database ?? 'memory';
  const files = new FileStore(env.uploadDir);
  const models = buildRegistry(env, options.provider);

  const clothing = new ClothingService(
    collections<ClothingDoc>('Clothing', clothingSchema),
    files,
    options.catalogDir ?? path.resolve(__dirname, '..', 'assets', 'catalog'),
    '/api/v1',
    options.clothingIdFactory,
  );
  const tryOns = new TryOnService(
    collections<TryOnDoc>('TryOn', tryOnSchema),
    files,
    clothing,
    models,
    env.AI_TIMEOUT_MS,
  );
  const favorites = new FavoritesService(
    collections<FavoriteDoc>('Favorite', favoriteSchema),
    tryOns,
  );
  const history = new HistoryService(tryOns, favorites);
  const users = new UsersService(collections<UserDoc>('User', userSchema));
  const styling = new StylingService(
    options.stylingProvider ?? new LlamaCppStylingProvider(env),
    clothing,
    users,
    options.customStylingProvider ??
      new RegisteredCustomProvider(
        new LlamaCppStylingProvider({
          ...env,
          SLM_URL: env.SLM_CUSTOM_URL,
          SLM_MODEL: 'virtualfit-fashion-custom',
        }),
      ),
  );

  const nova = new NovaService(
    new NovaStore(collections),
    env,
    files,
    styling,
    options.novaLanguage ?? new LocalNovaLanguage(env),
    options.novaVision ?? new CompatibleVision(env),
    options.novaImages ?? new CompatibleImages(env),
    database,
  );
  const eraser = {
    async eraseAll(guestId: string) {
      await nova.erase(guestId);
      await favorites.removeAllFor(guestId);
      await tryOns.removeAllFor(guestId);
      await clothing.removeAllFor(guestId);
      await users.remove(guestId);
    },
  };

  const health = async (): Promise<HealthStatus> => {
    const modelOptions = await models.options();
    const def = modelOptions.find((o) => o.id === models.defaultOption)!;
    const databaseUp = options.databaseUp ? options.databaseUp() : true;
    return {
      status: databaseUp ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      database,
      databaseUp,
      ai: {
        provider: models.entry(def.id).generation.info.id,
        simulated: def.simulated,
        externalProcessing: def.externalProcessing,
        configured: def.available,
        defaultOption: def.id,
        options: modelOptions,
      },
      limits: { maxUploadMb: env.MAX_UPLOAD_MB, resultRetentionHours: env.RESULT_RETENTION_HOURS },
    };
  };

  /** Deletes expired results (favorites are kept). */
  const purge = async () => {
    await nova.purge();
    const removed = await tryOns.purgeExpired(env.RESULT_RETENTION_HOURS * 3_600_000, (id) =>
      favorites.isFavorited(id),
    );
    if (removed.length) logger.info('Purged expired results', { count: removed.length });
  };

  /** Call once at startup, before accepting requests. */
  const recoverInterruptedJobs = async () => {
    await nova.recover();
    const n = await tryOns.failInterrupted();
    if (n) logger.warn('Marked interrupted try-ons as failed', { count: n });
  };

  return {
    env,
    files,
    clothing,
    tryOns,
    favorites,
    history,
    users,
    styling,
    nova,
    eraser,
    health,
    purge,
    recoverInterruptedJobs,
  };
}

export type Container = ReturnType<typeof createContainer>;
