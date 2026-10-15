import type { Doc } from '../../db/collection';

export interface FavoriteDoc extends Doc {
  ownerId: string;
  tryOnId: string;
  createdAt: Date;
}
