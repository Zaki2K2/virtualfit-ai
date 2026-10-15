import type { Request, Response } from 'express';
import { idParam } from '../clothing/clothing.validation';
import type { HistoryService } from './history.service';

export class HistoryController {
  constructor(private readonly service: HistoryService) {}

  list = async (req: Request, res: Response) => {
    res.json({ items: await this.service.list(req.guestId) });
  };

  remove = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await this.service.remove(id, req.guestId);
    res.status(204).end();
  };
}
