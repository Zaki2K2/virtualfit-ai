import type { Favorite } from '@virtualfit/shared';
import type { Collection } from '../../db/collection';
import { AppError } from '../../utils/errors';
import { newId } from '../../utils/ids';
import type { TryOnService } from '../try-on/try-on.service';
import type { FavoriteDoc } from './favorites.types';

export class FavoritesService {
  constructor(
    private readonly docs: Collection<FavoriteDoc>,
    private readonly tryOns: TryOnService,
  ) {}

  private async toDto(doc: FavoriteDoc): Promise<Favorite | null> {
    try {
      return {
        id: doc.id,
        tryOnId: doc.tryOnId,
        tryOn: await this.tryOns.get(doc.tryOnId, doc.ownerId),
        createdAt: doc.createdAt.toISOString(),
      };
    } catch (err) {
      if (!(err instanceof AppError) || err.status !== 404) throw err;
      return null; // the underlying try-on no longer exists
    }
  }

  async list(guestId: string): Promise<Favorite[]> {
    const docs = (await this.docs.find({ ownerId: guestId })).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const dtos = await Promise.all(docs.map((d) => this.toDto(d)));
    return dtos.filter((d): d is Favorite => d !== null);
  }

  /** Idempotent: favoriting the same try-on twice returns the existing favorite. */
  async add(guestId: string, tryOnId: string): Promise<Favorite> {
    const tryOn = await this.tryOns.getOwned(tryOnId, guestId);
    if (tryOn.status !== 'completed') {
      throw AppError.badRequest('Only completed try-ons can be saved to favorites.');
    }
    const existing = (await this.docs.find({ ownerId: guestId, tryOnId }))[0];
    const doc =
      existing ??
      (await this.docs.insert({ id: newId(), ownerId: guestId, tryOnId, createdAt: new Date() }));
    return (await this.toDto(doc)) as Favorite;
  }

  async remove(id: string, guestId: string): Promise<void> {
    const doc = await this.docs.get(id);
    if (!doc || doc.ownerId !== guestId) throw AppError.notFound('Favorite');
    await this.docs.remove(id);
  }

  async isFavorited(tryOnId: string): Promise<boolean> {
    return (await this.docs.find({ tryOnId })).length > 0;
  }

  async removeByTryOn(tryOnId: string): Promise<void> {
    for (const d of await this.docs.find({ tryOnId })) await this.docs.remove(d.id);
  }

  async removeAllFor(guestId: string): Promise<void> {
    for (const d of await this.docs.find({ ownerId: guestId })) await this.docs.remove(d.id);
  }
}
