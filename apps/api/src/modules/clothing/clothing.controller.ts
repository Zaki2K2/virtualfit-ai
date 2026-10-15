import type { Request, Response } from 'express';
import { sendImage } from '../../utils/http';
import type { ClothingService } from './clothing.service';
import { clothingQuerySchema, createClothingBody, idParam } from './clothing.validation';

export class ClothingController {
  constructor(private readonly service: ClothingService) {}

  list = async (req: Request, res: Response) => {
    const filter = clothingQuerySchema.parse(req.query);
    res.json({ items: await this.service.list(req.guestId, filter) });
  };

  get = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json({ item: await this.service.get(id, req.guestId) });
  };

  image = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    sendImage(res, await this.service.getImage(id, req.guestId));
  };

  create = async (req: Request, res: Response) => {
    const input = createClothingBody.parse(req.body);
    const item = await this.service.create(req.guestId, input, req.file?.buffer);
    res.status(201).json({ item });
  };

  remove = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await this.service.remove(id, req.guestId);
    res.status(204).end();
  };
}
