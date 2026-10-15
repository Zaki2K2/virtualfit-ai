import type { Response } from 'express';
import type { ImagePayload } from '../modules/clothing/clothing.types';

/** Sends image bytes with safe headers. Result/garment URLs are API URLs, never file paths. */
export function sendImage(res: Response, image: ImagePayload, download?: string) {
  res.setHeader('Content-Type', image.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', image.cacheable ? 'public, max-age=86400' : 'private, no-store');
  if (download) res.setHeader('Content-Disposition', `attachment; filename="${download}"`);
  res.send(image.buffer);
}
