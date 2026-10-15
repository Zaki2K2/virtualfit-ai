import type { Request, Response } from 'express';
import type { FavoritesService } from './favorites.service';
import { createFavoriteBody, idParam } from './favorites.validation';

export class FavoritesController {
  constructor(private readonly service: FavoritesService) {}

  list = async (req: Request, res: Response) => {
    res.json({ items: await this.service.list(req.guestId) });
  };

  add = async (req: Request, res: Response) => {
    const { tryOnId } = createFavoriteBody.parse(req.body);
    res.status(201).json({ favorite: await this.service.add(req.guestId, tryOnId) });
  };

  remove = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await this.service.remove(id, req.guestId);
    res.status(204).end();
  };
}
