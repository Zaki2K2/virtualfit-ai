import type { Request, Response } from 'express';
import { sendImage } from '../../utils/http';
import type { TryOnService } from './try-on.service';
import { createTryOnBody, idParam } from './try-on.validation';

export class TryOnController {
  constructor(private readonly service: TryOnService) {}

  create = async (req: Request, res: Response) => {
    const input = createTryOnBody.parse(req.body);
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const tryOn = await this.service.create(req.guestId, input, {
      person: files.person?.[0]?.buffer,
      garment: files.garment?.[0]?.buffer,
    });
    res.status(202).json({ tryOn });
  };

  get = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    res.json({ tryOn: await this.service.get(id, req.guestId) });
  };

  image = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    const image = await this.service.getResultImage(id, req.guestId);
    sendImage(
      res,
      image,
      req.query.download === '1'
        ? `virtualfit-${id}.${image.mime === 'image/png' ? 'png' : 'jpg'}`
        : undefined,
    );
  };
}
