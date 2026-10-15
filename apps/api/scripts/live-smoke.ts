/**
 * Manual smoke test for the real Gradio provider using the .env configuration.
 * Usage: npx tsx --env-file=../../.env scripts/live-smoke.ts [person.jpg] [garment.png] [out.png]
 * Without a person image a synthetic placeholder is used (real models will reject it).
 */
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { loadEnv } from '../src/config/env';
import { GenerationService } from '../src/integrations/ai/services/generation.service';
import { createProvider } from '../src/integrations/ai/services/provider-factory';

async function main() {
  const env = loadEnv();
  const provider = createProvider(env);
  console.log(`provider=${provider.id} configured=${provider.isConfigured()}`);
  const personPath = process.argv[2];
  const person = personPath
    ? await readFile(personPath)
    : await sharp({ create: { width: 512, height: 768, channels: 3, background: '#9aa5b1' } })
        .png()
        .toBuffer();
  const garment = await readFile(process.argv[3] ?? 'assets/catalog/tee-classic-white.png');
  const started = Date.now();
  try {
    const out = await new GenerationService(provider, env.AI_TIMEOUT_MS).generate({
      personImage: person,
      garmentImage: garment,
      category: 'tops',
    });
    if (process.argv[4]) await writeFile(process.argv[4], out.buffer);
    console.log(
      `OK ${out.width}x${out.height} ${out.mime} in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  } catch (err) {
    const e = err as { code?: string; message: string };
    console.log(
      `FAILED after ${Math.round((Date.now() - started) / 1000)}s: [${e.code}] ${e.message}`,
    );
  }
}

void main();
