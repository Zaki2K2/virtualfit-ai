import { ALLOWED_IMAGE_TYPES } from '@virtualfit/shared';

export interface ImageCheck {
  ok: boolean;
  error?: string;
}

const SIGNATURES: Array<{ type: string; bytes: number[] }> = [
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
];

/**
 * Early feedback only. The server re-validates everything and is the source of truth.
 * Checks size, declared type and the file's magic bytes (not just its extension).
 */
export async function checkImageFile(file: File, maxMb: number): Promise<ImageCheck> {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: 'Please choose a JPEG or PNG image.' };
  }
  if (file.size > maxMb * 1024 * 1024) {
    return {
      ok: false,
      error: `This image is larger than ${maxMb} MB. Please choose a smaller one.`,
    };
  }
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const real = SIGNATURES.find((s) => s.bytes.every((b, i) => head[i] === b));
  if (!real) return { ok: false, error: 'This file is not a valid JPEG or PNG image.' };
  return { ok: true };
}
