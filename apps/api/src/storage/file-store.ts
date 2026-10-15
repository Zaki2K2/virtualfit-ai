import { mkdir, readFile, rm, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isSafeId } from '../utils/ids';
import { AppError } from '../utils/errors';

export type StoreBucket = 'results' | 'clothing';

/**
 * Stores files under generated names only. Callers pass an id (never a path); the id is
 * validated so a request can never escape the bucket directory (path traversal).
 */
export class FileStore {
  constructor(private readonly root: string) {}

  private resolve(bucket: StoreBucket, id: string, ext: string) {
    if (!isSafeId(id) || !/^[a-z]{3,4}$/.test(ext)) throw AppError.notFound('File');
    const dir = path.join(this.root, bucket);
    const full = path.join(dir, `${id}.${ext}`);
    if (path.dirname(full) !== dir) throw AppError.notFound('File');
    return { dir, full };
  }

  async save(bucket: StoreBucket, id: string, ext: string, data: Buffer): Promise<void> {
    const { dir, full } = this.resolve(bucket, id, ext);
    await mkdir(dir, { recursive: true });
    await writeFile(full, data, { mode: 0o600 });
  }

  async read(bucket: StoreBucket, id: string, ext: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(bucket, id, ext).full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(bucket: StoreBucket, id: string, ext: string): Promise<void> {
    await rm(this.resolve(bucket, id, ext).full, { force: true });
  }

  /**
   * Deletes files older than maxAgeMs in a bucket, except those `keep(id)` says are still
   * referenced. Returns the removed file ids.
   */
  async purgeOlderThan(
    bucket: StoreBucket,
    maxAgeMs: number,
    keep: (id: string) => Promise<boolean> = async () => false,
  ): Promise<string[]> {
    const dir = path.join(this.root, bucket);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const removed: string[] = [];
    for (const name of names) {
      const full = path.join(dir, name);
      const info = await stat(full);
      const id = path.parse(name).name;
      if (Date.now() - info.mtimeMs > maxAgeMs && !(await keep(id))) {
        await rm(full, { force: true });
        removed.push(id);
      }
    }
    return removed;
  }
}
