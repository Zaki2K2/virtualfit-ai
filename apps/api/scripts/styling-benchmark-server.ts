/** Private evaluation harness: isolated memory persistence, real CPU provider, no live DB writes. */
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app';
import { createContainer } from '../src/container';
import { loadEnv } from '../src/config/env';
import express from 'express';
import { LlamaCppStylingProvider } from '../src/integrations/slm/llama-cpp.provider';

const env = loadEnv({
  NODE_ENV: 'test',
  UPLOAD_DIR: mkdtempSync(path.join(os.tmpdir(), 'vf-slm-bench-')),
  SLM_URL: process.env.SLM_URL,
  SLM_MODEL: process.env.SLM_MODEL,
});
const app = express();
let used = false;
let fixtureId = 0;
app.get('/benchmark-manifest', (_req, res) => {
  if (used)
    return res
      .status(409)
      .json({ error: 'Restart the isolated harness before each run for identical fixture IDs.' });
  used = true;
  res.json({ isolated: true, database: 'memory', version: 'fashion-eval-v2' });
});
app.use(
  createApp(
    createContainer(env, {
      clothingIdFactory: () => `eval-fixture-${String(fixtureId++).padStart(4, '0')}`,
      customStylingProvider: new LlamaCppStylingProvider({
        ...env,
        SLM_URL: env.SLM_CUSTOM_URL,
        SLM_MODEL: 'virtualfit-fashion-custom',
      }),
    }),
  ),
);
const server = app.listen(5100, '127.0.0.1', () =>
  console.log('Isolated SLM benchmark: http://127.0.0.1:5100'),
);
process.on('SIGINT', () => server.close());
