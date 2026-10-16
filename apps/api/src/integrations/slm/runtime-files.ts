import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Works in src, compiled dist/src and CLI entrypoints without relying on cwd. */
export function runtimeKey(): string {
  let root = __dirname;
  for (;;) {
    const key = path.join(root, 'slm-engine/runtime/api-key.txt');
    if (existsSync(key)) return readFileSync(key, 'utf8').trim();
    const parent = path.dirname(root);
    if (parent === root) throw new Error('Local inference key is unavailable');
    root = parent;
  }
}
