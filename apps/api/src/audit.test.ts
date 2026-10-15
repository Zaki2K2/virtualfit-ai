import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationService } from './integrations/ai/services/generation.service';
import type { VirtualTryOnProvider } from './integrations/ai/interfaces/virtual-try-on-provider';
import { browser, buildTestApp, makeImage } from './test/helpers';
import { logger } from './utils/logger';
import type { CollectionFactory, Doc } from './db/collection';
import type { Schema } from 'mongoose';
import { isLoopbackUrl } from './integrations/ai/providers/custom-python.provider';
import { GradioProvider } from './integrations/ai/providers/gradio.provider';
import { readImageResponse } from './utils/image-response';
import { FavoritesService } from './modules/favorites/favorites.service';
import { memoryCollectionFactory } from './db/collection';
import { favoriteSchema } from './modules/favorites/favorites.model';
import type { FavoriteDoc } from './modules/favorites/favorites.types';
import type { TryOnService } from './modules/try-on/try-on.service';

const input = {
  personImage: Buffer.alloc(0),
  garmentImage: Buffer.alloc(0),
  category: 'tops' as const,
};
const provider: VirtualTryOnProvider = {
  id: 'gradio',
  model: 'test',
  simulated: false,
  externalProcessing: true,
  allowedImageHosts: ['hf.space'],
  isConfigured: () => true,
  generate: async () => ({ imageUrl: 'https://test.hf.space/result.png' }),
};
afterEach(() => vi.unstubAllGlobals());

describe('audit regressions', () => {
  it('handles a database failure while recording a background job error', async () => {
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const collections: CollectionFactory = <T extends Doc>(name: string, schema: Schema) => {
      const docs = memoryCollectionFactory<T>(name, schema);
      return {
        insert: docs.insert.bind(docs),
        get: docs.get.bind(docs),
        find: docs.find.bind(docs),
        remove: docs.remove.bind(docs),
        update: async () => {
          throw new Error('database went offline');
        },
      };
    };
    try {
      const { app } = buildTestApp(
        {},
        {
          collections,
          provider: {
            ...provider,
            externalProcessing: false,
            generate: async () => {
              throw new Error('provider failed');
            },
          },
        },
      );
      const res = await browser(app)
        .post('/api/v1/try-on')
        .field('category', 'tops')
        .field('clothingId', 'tee-classic-white')
        .attach('person', await makeImage(), 'person.png');
      expect(res.status).toBe(202);
      await vi.waitFor(() =>
        expect(logged).toHaveBeenCalledWith(
          'Could not persist try-on failure',
          expect.objectContaining({ message: 'database went offline' }),
        ),
      );
    } finally {
      logged.mockRestore();
    }
  });

  it('requires external-processing consent for hostnames beginning with 127', () => {
    expect(isLoopbackUrl('https://127.attacker.example')).toBe(false);
    expect(isLoopbackUrl('http://127.0.0.1:8000')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:8000')).toBe(true);
    expect(isLoopbackUrl('https://localhost.attacker.example')).toBe(false);
  });

  it('closes Gradio connections after a provider error', async () => {
    const close = vi.fn();
    const heartbeatClose = vi.fn();
    vi.doMock('@gradio/client', () => ({
      Client: {
        connect: async () => ({
          close,
          heartbeat_event: { close: heartbeatClose },
          submit: () => ({
            async *[Symbol.asyncIterator]() {
              yield { type: 'status', stage: 'error', message: 'quota exceeded' };
            },
            cancel: async () => undefined,
          }),
        }),
      },
      handle_file: (value: unknown) => value,
    }));
    try {
      const p = new GradioProvider({
        spaceId: 'test/space',
        apiName: '/tryon',
        paramsTemplate: '{}',
        outputIndex: 0,
      });
      await expect(p.generate(input)).rejects.toMatchObject({ code: 'AI_QUOTA_EXHAUSTED' });
      expect(close).toHaveBeenCalledOnce();
      expect(heartbeatClose).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('@gradio/client');
    }
  });

  it('cancels an oversized stream before reading its entire body', async () => {
    const cancel = vi.fn();
    const res = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(21 * 1024 * 1024));
        },
        cancel,
      }),
    );
    await expect(readImageResponse(res)).rejects.toMatchObject({ code: 'AI_FAILED' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not hide a database outage as an empty favorites list', async () => {
    const docs = memoryCollectionFactory<FavoriteDoc>('Favorite', favoriteSchema);
    await docs.insert({
      id: 'favorite12345',
      ownerId: 'owner12345',
      tryOnId: 'tryon12345',
      createdAt: new Date(),
    });
    const error = Object.assign(new Error('unreachable'), { name: 'MongoNetworkError' });
    const tryOns = {
      get: async () => {
        throw error;
      },
    } as unknown as TryOnService;
    await expect(new FavoritesService(docs, tryOns).list('owner12345')).rejects.toBe(error);
  });

  it('bounds the result download by the generation deadline', async () => {
    const fetchMock = vi.fn(
      (_url, options: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(new GenerationService(provider, 30).generate(input)).rejects.toMatchObject({
      code: 'AI_TIMEOUT',
      status: 504,
    });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });

  it('rejects oversized provider buffers before decoding', async () => {
    await expect(
      new GenerationService(
        { ...provider, generate: async () => ({ imageBuffer: Buffer.alloc(21 * 1024 * 1024) }) },
        1000,
      ).generate(input),
    ).rejects.toMatchObject({ code: 'AI_FAILED', status: 502 });
  });

  it('rejects an untrusted result host without requesting it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new GenerationService(
        { ...provider, generate: async () => ({ imageUrl: 'https://localhost/private' }) },
        1000,
      ).generate(input),
    ).rejects.toMatchObject({ code: 'AI_FAILED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 413 for oversized JSON instead of 500', async () => {
    const { app } = buildTestApp();
    const res = await browser(app)
      .patch('/api/v1/profile')
      .send({ displayName: 'x'.repeat(110000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
