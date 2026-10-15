import type { CreateTryOnInput, TryOn } from '@virtualfit/shared';
import type { Collection } from '../../db/collection';
import type { GenerationService } from '../../integrations/ai/services/generation.service';
import type { ModelRegistry } from '../../integrations/ai/services/model-registry';
import type { FileStore } from '../../storage/file-store';
import { AppError } from '../../utils/errors';
import { newId } from '../../utils/ids';
import { logger } from '../../utils/logger';
import { sanitizeImage } from '../../utils/image';
import type { ClothingService } from '../clothing/clothing.service';
import type { ImagePayload } from '../clothing/clothing.types';
import type { TryOnDoc } from './try-on.types';

export interface TryOnFiles {
  person?: Buffer;
  garment?: Buffer;
}

const MAX_ACTIVE_PER_GUEST = 1;

export class TryOnService {
  constructor(
    private readonly docs: Collection<TryOnDoc>,
    private readonly files: FileStore,
    private readonly clothing: ClothingService,
    private readonly models: ModelRegistry,
    private readonly timeoutMs: number,
  ) {}

  toDto(doc: TryOnDoc): TryOn {
    return {
      id: doc.id,
      clothingId: doc.clothingId,
      clothingName: doc.clothingName,
      category: doc.category,
      provider: doc.provider,
      model: doc.model,
      durationMs: doc.durationMs,
      simulated: doc.simulated,
      status: doc.status,
      resultUrl: doc.status === 'completed' ? `/api/v1/try-on/${doc.id}/image` : null,
      error:
        doc.status === 'failed' && doc.errorCode
          ? { code: doc.errorCode, message: doc.errorMessage ?? 'Generation failed.' }
          : null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /**
   * Validates inputs, records a "processing" job and starts generation in the background.
   * The client polls GET /try-on/:id; real models can take over a minute.
   */
  async create(guestId: string, input: CreateTryOnInput, uploads: TryOnFiles): Promise<TryOn> {
    // Unavailable models fail here with AI_UNAVAILABLE; they are never swapped for another model.
    const { generation } = await this.models.resolve(input.model);
    const provider = generation.info;
    if (provider.externalProcessing && !input.consent) {
      throw new AppError(
        400,
        'CONSENT_REQUIRED',
        'Your photos will be sent to an external AI service. Please confirm consent to continue.',
      );
    }
    if (!uploads.person) throw AppError.badRequest('Your photo is required (field "person").');
    if (input.clothingId && uploads.garment) {
      throw AppError.badRequest('Provide either clothingId or a garment image, not both.');
    }
    if (!input.clothingId && !uploads.garment) {
      throw AppError.badRequest('Select a garment or upload a garment image.');
    }

    const active = (await this.docs.find({ ownerId: guestId, status: 'processing' })).length;
    if (active >= MAX_ACTIVE_PER_GUEST) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        'A try-on is already being generated. Please wait for it to finish.',
      );
    }

    const person = await sanitizeImage(uploads.person, 'Your photo');
    let garmentBuffer: Buffer;
    let clothingName = 'Uploaded garment';
    let category = input.category;
    if (input.clothingId) {
      const item = await this.clothing.get(input.clothingId, guestId);
      clothingName = item.name;
      category = input.category ?? item.category;
      garmentBuffer = (await this.clothing.getImage(input.clothingId, guestId)).buffer;
    } else {
      garmentBuffer = (await sanitizeImage(uploads.garment as Buffer, 'Garment image')).buffer;
    }

    const now = new Date();
    const doc: TryOnDoc = {
      id: newId(),
      ownerId: guestId,
      clothingId: input.clothingId ?? null,
      clothingName,
      category,
      provider: provider.id,
      model: provider.model,
      durationMs: null,
      simulated: provider.simulated,
      status: 'processing',
      resultExt: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.docs.insert(doc);

    // Fire and forget: errors are captured on the document, never thrown into the request.
    void this.run(doc, generation, person.buffer, garmentBuffer).catch((err: unknown) => {
      logger.error('Could not persist try-on failure', {
        id: doc.id,
        message: err instanceof Error ? err.message : String(err),
      });
    });
    return this.toDto(doc);
  }

  private async run(
    doc: TryOnDoc,
    generation: GenerationService,
    personImage: Buffer,
    garmentImage: Buffer,
  ) {
    try {
      const result = await generation.generate({
        personImage,
        garmentImage,
        category: doc.category,
      });
      const ext = result.mime === 'image/png' ? 'png' : 'jpg';
      await this.files.save('results', doc.id, ext, result.buffer);
      await this.docs.update(doc.id, {
        status: 'completed',
        resultExt: ext,
        model: result.modelLabel ?? doc.model,
        durationMs: Date.now() - doc.createdAt.getTime(),
        updatedAt: new Date(),
      });
    } catch (err) {
      const appErr =
        err instanceof AppError
          ? err
          : new AppError(500, 'INTERNAL_ERROR', 'Generation failed unexpectedly.');
      logger.warn('Try-on failed', { id: doc.id, provider: doc.provider, code: appErr.code });
      await this.docs.update(doc.id, {
        status: 'failed',
        durationMs: Date.now() - doc.createdAt.getTime(),
        errorCode: appErr.code,
        errorMessage: appErr.message,
        updatedAt: new Date(),
      });
    }
  }

  async getOwned(id: string, guestId: string): Promise<TryOnDoc> {
    const doc = await this.docs.get(id);
    if (!doc || doc.ownerId !== guestId) throw AppError.notFound('Try-on');
    return doc;
  }

  async get(id: string, guestId: string): Promise<TryOn> {
    return this.toDto(await this.getOwned(id, guestId));
  }

  async getResultImage(id: string, guestId: string): Promise<ImagePayload> {
    const doc = await this.getOwned(id, guestId);
    if (doc.status !== 'completed' || !doc.resultExt) throw AppError.notFound('Result image');
    const buffer = await this.files.read('results', doc.id, doc.resultExt);
    if (!buffer) throw AppError.notFound('Result image');
    return { buffer, mime: doc.resultExt === 'png' ? 'image/png' : 'image/jpeg', cacheable: false };
  }

  async list(guestId: string): Promise<TryOn[]> {
    const docs = await this.docs.find({ ownerId: guestId });
    return docs
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((d) => this.toDto(d));
  }

  async remove(id: string, guestId: string): Promise<void> {
    const doc = await this.getOwned(id, guestId);
    await this.deleteDoc(doc);
  }

  async removeAllFor(guestId: string): Promise<void> {
    for (const doc of await this.docs.find({ ownerId: guestId })) await this.deleteDoc(doc);
  }

  private async deleteDoc(doc: TryOnDoc) {
    if (doc.resultExt) await this.files.delete('results', doc.id, doc.resultExt);
    await this.docs.remove(doc.id);
  }

  /**
   * Privacy housekeeping: marks jobs that never finished (e.g. server restart) as failed and
   * deletes results older than the retention window, except those the owner favorited.
   * Returns the ids of deleted try-ons.
   */
  async purgeExpired(maxAgeMs: number, isProtected: (tryOnId: string) => Promise<boolean>) {
    const removed: string[] = [];
    for (const doc of await this.docs.find()) {
      const age = Date.now() - doc.createdAt.getTime();
      if (doc.status === 'processing' && age > this.timeoutMs + 60_000) {
        await this.docs.update(doc.id, {
          status: 'failed',
          errorCode: 'AI_TIMEOUT',
          errorMessage: 'Generation did not finish.',
          updatedAt: new Date(),
        });
      } else if (age > maxAgeMs && !(await isProtected(doc.id))) {
        await this.deleteDoc(doc);
        removed.push(doc.id);
      }
    }
    // Result files whose record no longer exists (restart of the in-memory store, manual DB
    // cleanup, ...) would otherwise stay on disk forever: they are personal images.
    const orphans = await this.files.purgeOlderThan('results', maxAgeMs, async (id) =>
      Boolean(await this.docs.get(id)),
    );
    if (orphans.length) logger.info('Removed orphaned result files', { count: orphans.length });
    return removed;
  }

  /**
   * Jobs run inside this process, so after a (re)start every record still "processing" belongs to
   * a job that died with the previous process. Mark them failed right away instead of leaving
   * clients polling "Generating..." until the age-based sweep.
   */
  async failInterrupted(): Promise<number> {
    const stale = await this.docs.find({ status: 'processing' } as Partial<TryOnDoc>);
    for (const doc of stale) {
      await this.docs.update(doc.id, {
        status: 'failed',
        errorCode: 'AI_FAILED',
        errorMessage:
          'The server restarted while this try-on was being generated. Please try again.',
        updatedAt: new Date(),
      });
    }
    return stale.length;
  }
}
