import type { TryOn } from '@virtualfit/shared';
import type { FavoritesService } from '../favorites/favorites.service';
import type { TryOnService } from '../try-on/try-on.service';

/** History is a view over a guest's try-ons; deleting an entry also deletes its image. */
export class HistoryService {
  constructor(
    private readonly tryOns: TryOnService,
    private readonly favorites: FavoritesService,
  ) {}

  list(guestId: string): Promise<TryOn[]> {
    return this.tryOns.list(guestId);
  }

  async remove(id: string, guestId: string): Promise<void> {
    await this.tryOns.remove(id, guestId);
    await this.favorites.removeByTryOn(id);
  }
}
