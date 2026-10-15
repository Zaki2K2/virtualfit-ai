import type { Request, Response } from 'express';
import type { UsersService } from './users.service';
import { profileUpdateBody } from './users.validation';

export interface DataEraser {
  eraseAll(guestId: string): Promise<void>;
}

export class UsersController {
  constructor(
    private readonly service: UsersService,
    private readonly eraser: DataEraser,
  ) {}

  get = async (req: Request, res: Response) => {
    res.json({ profile: await this.service.get(req.guestId) });
  };

  update = async (req: Request, res: Response) => {
    const input = profileUpdateBody.parse(req.body);
    res.json({ profile: await this.service.update(req.guestId, input) });
  };

  /** Right to erasure: deletes profile, history, favorites, uploaded garments and images. */
  eraseAll = async (req: Request, res: Response) => {
    await this.eraser.eraseAll(req.guestId);
    res.status(204).end();
  };
}
