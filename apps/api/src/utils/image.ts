import sharp from 'sharp';
import type { AllowedImageType } from '@virtualfit/shared';
import { AppError } from './errors';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Detects the real type from magic bytes - the client-supplied mimetype is never trusted. */
export function sniffImageType(buf: Buffer): AllowedImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  return null;
}

export const MIN_DIMENSION = 128;
export const MAX_DIMENSION = 8000;

export interface SanitizedImage {
  buffer: Buffer;
  mime: AllowedImageType;
  width: number;
  height: number;
}

/**
 * Verifies the buffer is a genuine, decodable JPEG/PNG of sane dimensions and re-encodes it,
 * which also strips EXIF metadata (GPS location, device info) from personal photos.
 */
export async function sanitizeImage(buf: Buffer, label = 'Image'): Promise<SanitizedImage> {
  const mime = sniffImageType(buf);
  if (!mime) {
    throw new AppError(415, 'UNSUPPORTED_IMAGE', `${label} must be a JPEG or PNG image.`);
  }
  try {
    const pipeline = sharp(buf, {
      failOn: 'error',
      limitInputPixels: MAX_DIMENSION * MAX_DIMENSION,
    }).rotate(); // apply EXIF orientation, then metadata is dropped on output
    const meta = await pipeline.metadata();
    const { width = 0, height = 0 } = meta;
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      throw new AppError(
        422,
        'UNSUPPORTED_IMAGE',
        `${label} is too small (minimum ${MIN_DIMENSION}x${MIN_DIMENSION}px).`,
      );
    }
    const out = await (
      mime === 'image/png' ? pipeline.png() : pipeline.jpeg({ quality: 92 })
    ).toBuffer({
      resolveWithObject: true,
    });
    return { buffer: out.data, mime, width: out.info.width, height: out.info.height };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      415,
      'UNSUPPORTED_IMAGE',
      `${label} is corrupt or is not a valid JPEG/PNG file.`,
    );
  }
}
