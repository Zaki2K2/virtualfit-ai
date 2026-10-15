import path from 'node:path';
import type { HealthStatus } from '@virtualfit/shared';
import type { Env } from './config/env';
import { memoryCollectionFactory, type CollectionFactory } from './db/collection';
import type { VirtualTryOnProvider } from './integrations/ai/interfaces/virtual-try-on-provider';
import { GenerationService } from './integrations/ai/services/generation.service';
import { createProvider } from './integrations/ai/services/provider-factory';
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

export interface ContainerOptions {
  collections?: CollectionFactory;
  database?: HealthStatus['database'];
  provider?: VirtualTryOnProvider;
  catalogDir?: string;
}

/** Composition root: wires modules together once, so tests can swap storage and AI provider. */
export function createContainer(env: Env, options: ContainerOptions = {}) {
  const collections = options.collections ?? memoryCollectionFactory;
  const database = options.database ?? 'memory';
  const files = new FileStore(env.uploadDir);
  const provider = options.provider ?? createProvider(env);
  const generation = new GenerationService(provider, env.AI_TIMEOUT_MS);

  const clothing = new ClothingService(
    collections<ClothingDoc>('Clothing', clothingSchema),
    files,
    options.catalogDir ?? path.resolve(__dirname, '..', 'assets', 'catalog'),
  );
  const tryOns = new TryOnService(
    collections<TryOnDoc>('TryOn', tryOnSchema),
    files,
    clothing,
    generation,
    env.AI_TIMEOUT_MS,
  );
  const favorites = new FavoritesService(
    collections<FavoriteDoc>('Favorite', favoriteSchema),
    tryOns,
  );
  const history = new HistoryService(tryOns, favorites);
  const users = new UsersService(collections<UserDoc>('User', userSchema));

  const eraser = {
    async eraseAll(guestId: string) {
      await favorites.removeAllFor(guestId);
      await tryOns.removeAllFor(guestId);
      await clothing.removeAllFor(guestId);
      await users.remove(guestId);
    },
  };

  const health = (): HealthStatus => ({
    status: 'ok',
    time: new Date().toISOString(),
    database,
    ai: {
      provider: provider.id,
      simulated: provider.simulated,
      externalProcessing: provider.externalProcessing,
      configured: provider.isConfigured(),
    },
    limits: { maxUploadMb: env.MAX_UPLOAD_MB, resultRetentionHours: env.RESULT_RETENTION_HOURS },
  });

  /** Deletes expired results (favorites are kept). */
  const purge = async () => {
    const removed = await tryOns.purgeExpired(env.RESULT_RETENTION_HOURS * 3_600_000, (id) =>
      favorites.isFavorited(id),
    );
    if (removed.length) logger.info('Purged expired results', { count: removed.length });
  };

  return { env, files, clothing, tryOns, favorites, history, users, eraser, health, purge };
}

export type Container = ReturnType<typeof createContainer>;
