import multer from 'multer';

/** Memory storage: photos are validated before anything is written to disk. */
export function createUpload(maxBytes: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 2, fields: 10, fieldSize: 1024 },
  });
}
