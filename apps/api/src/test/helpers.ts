import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../app';
import { loadEnv } from '../config/env';
import { createContainer, type ContainerOptions } from '../container';

export async function makeImage(
  format: 'png' | 'jpeg' = 'png',
  width = 300,
  height = 400,
  color = '#8899aa',
): Promise<Buffer> {
  const img = sharp({ create: { width, height, channels: 3, background: color } });
  return format === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer();
}

export function buildTestApp(
  envOverrides: Record<string, string> = {},
  options: ContainerOptions = {},
) {
  const uploadDir = mkdtempSync(path.join(os.tmpdir(), 'vf-test-'));
  const env = loadEnv({ NODE_ENV: 'test', UPLOAD_DIR: uploadDir, ...envOverrides });
  const container = createContainer(env, options);
  // loadEnv resolves relative to cwd; an absolute tmp path stays as-is.
  return { app: createApp(container), container, uploadDir };
}

/** supertest agent that keeps the guest cookie, i.e. behaves like one browser. */
export const browser = (app: Parameters<typeof request.agent>[0]) => request.agent(app);

export async function waitForTryOn(
  agent: ReturnType<typeof request.agent>,
  id: string,
  timeoutMs = 5000,
) {
  const start = Date.now();
  for (;;) {
    const res = await agent.get(`/api/v1/try-on/${id}`);
    if (res.body.tryOn.status !== 'processing') return res.body.tryOn;
    if (Date.now() - start > timeoutMs) throw new Error('try-on did not finish in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}
