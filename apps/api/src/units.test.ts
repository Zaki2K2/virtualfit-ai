import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProvider, resolveGradioConfig } from './integrations/ai/services/provider-factory';
import { loadEnv } from './config/env';
import {
  classifyGradioError,
  fillTemplate,
  findFileRef,
  GradioProvider,
} from './integrations/ai/providers/gradio.provider';
import { FileStore } from './storage/file-store';
import { AppError } from './utils/errors';
import { sanitizeImage, sniffImageType } from './utils/image';
import { makeImage } from './test/helpers';

describe('image validation', () => {
  it('sniffs real types from magic bytes', async () => {
    expect(sniffImageType(await makeImage('png'))).toBe('image/png');
    expect(sniffImageType(await makeImage('jpeg'))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });

  it('rejects truncated images that have a valid header', async () => {
    const png = await makeImage('png');
    await expect(sanitizeImage(png.subarray(0, 40))).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE',
    });
  });

  it('strips EXIF metadata on re-encode', async () => {
    const sharp = (await import('sharp')).default;
    const withExif = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#fff' },
    })
      .withExif({ IFD0: { Copyright: 'secret-owner' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const clean = await sanitizeImage(withExif);
    expect((await sharp(clean.buffer).metadata()).exif).toBeUndefined();
  });
});

describe('FileStore', () => {
  it('only writes generated-id files inside its bucket and blocks traversal', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'vf-fs-'));
    const store = new FileStore(dir);
    await store.save('results', 'abc123def456', 'png', Buffer.from('x'));
    expect(readdirSync(path.join(dir, 'results'))).toEqual(['abc123def456.png']);
    expect((await store.read('results', 'abc123def456', 'png'))?.toString()).toBe('x');
    expect(await store.read('results', 'missing12345', 'png')).toBeNull();
    for (const bad of ['../evil123', '..\\evil123', 'a/b/c/d/e/f', '%2e%2e%2fx']) {
      await expect(store.save('results', bad, 'png', Buffer.from('x'))).rejects.toBeInstanceOf(
        AppError,
      );
    }
    await store.delete('results', 'abc123def456', 'png');
    expect(readdirSync(path.join(dir, 'results'))).toEqual([]);
  });
});

describe('env', () => {
  it('has safe defaults: mock provider, no database', () => {
    const env = loadEnv({});
    expect(env).toMatchObject({
      AI_PROVIDER: 'mock',
      API_PORT: 5000,
      maxUploadBytes: 8 * 1024 * 1024,
    });
    expect(env.MONGODB_URI).toBeUndefined();
  });
  it('treats empty values as unset and rejects invalid ones', () => {
    expect(loadEnv({ MONGODB_URI: '' }).MONGODB_URI).toBeUndefined();
    expect(() => loadEnv({ AI_PROVIDER: 'skynet' })).toThrow(/Invalid environment/);
  });
});

describe('gradio provider helpers', () => {
  it('substitutes placeholders recursively without touching other values', () => {
    const out = fillTemplate(
      { a: '{{person}}', nested: { list: ['{{garment}}', 'keep', 5] }, t: '{{clothType}}' },
      { person: 'P', garment: 'G', clothType: 'upper', category: 'tops' },
    );
    expect(out).toEqual({ a: 'P', nested: { list: ['G', 'keep', 5] }, t: 'upper' });
  });

  it('finds file references in nested outputs', () => {
    expect(findFileRef([{ url: 'https://x.hf.space/f.png' }])).toEqual({
      url: 'https://x.hf.space/f.png',
    });
    expect(findFileRef({ image: { path: '/tmp/a.png' } })).toEqual({ path: '/tmp/a.png' });
    expect(findFileRef('nothing')).toBeNull();
  });

  it('classifies quota and availability errors', () => {
    expect(classifyGradioError('You have exceeded your GPU quota (60s)').code).toBe(
      'AI_QUOTA_EXHAUSTED',
    );
    expect(classifyGradioError('Space is sleeping').code).toBe('AI_UNAVAILABLE');
    expect(
      classifyGradioError('Space "a/b" could not be accessed (received a 401 response)').code,
    ).toBe('AI_UNAVAILABLE');
    expect(classifyGradioError('boom').code).toBe('AI_FAILED');
  });

  it('is disabled until space, endpoint and parameter template are all configured', async () => {
    const base = { outputIndex: 0 };
    expect(new GradioProvider({ ...base }).isConfigured()).toBe(false);
    expect(new GradioProvider({ ...base, spaceId: 'a/b', apiName: '/x' }).isConfigured()).toBe(
      false,
    );
    expect(
      new GradioProvider({
        ...base,
        spaceId: 'a/b',
        apiName: '/x',
        paramsTemplate: 'not json',
      }).isConfigured(),
    ).toBe(false);
    const ok = new GradioProvider({
      ...base,
      spaceId: 'a/b',
      apiName: '/x',
      paramsTemplate: '{"p":"{{person}}"}',
    });
    expect(ok.isConfigured()).toBe(true);
    const off = new GradioProvider({ ...base });
    await expect(
      off.generate({
        personImage: Buffer.alloc(1),
        garmentImage: Buffer.alloc(1),
        category: 'tops',
      }),
    ).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
  });
});

describe('gradio preset resolution', () => {
  it('idm-vton preset makes the provider configured with a valid template', () => {
    const env = loadEnv({ AI_PROVIDER: 'gradio', GRADIO_PRESET: 'idm-vton' });
    const cfg = resolveGradioConfig(env);
    expect(cfg).toMatchObject({ spaceId: 'yisol/IDM-VTON', apiName: '/tryon', outputIndex: 0 });
    expect(JSON.parse(cfg.paramsTemplate as string)).toMatchObject({
      dict: { background: '{{person}}' },
      garm_img: '{{garment}}',
    });
    const provider = createProvider(env);
    expect(provider.isConfigured()).toBe(true);
    expect(provider.model).toBe('yisol/IDM-VTON');
    expect(provider.simulated).toBe(false);
  });

  it('explicit variables override the preset; no preset means not configured', () => {
    const over = resolveGradioConfig(
      loadEnv({
        AI_PROVIDER: 'gradio',
        GRADIO_PRESET: 'idm-vton',
        GRADIO_SPACE_ID: 'me/other',
        GRADIO_OUTPUT_INDEX: '1',
      }),
    );
    expect(over).toMatchObject({ spaceId: 'me/other', outputIndex: 1, apiName: '/tryon' });
    expect(createProvider(loadEnv({ AI_PROVIDER: 'gradio' })).isConfigured()).toBe(false);
    expect(() => loadEnv({ GRADIO_PRESET: 'nope' })).toThrow(/Invalid environment/);
  });
});
