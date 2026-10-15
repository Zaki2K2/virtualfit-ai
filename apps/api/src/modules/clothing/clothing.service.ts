import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClothingItem } from '@virtualfit/shared';
import type { CreateClothingInput } from '@virtualfit/shared';
import type { Collection } from '../../db/collection';
import type { FileStore } from '../../storage/file-store';
import { AppError } from '../../utils/errors';
import { newId } from '../../utils/ids';
import { sanitizeImage } from '../../utils/image';
import { CATALOG, findCatalogEntry } from './clothing.catalog';
import type { ClothingDoc, ImagePayload } from './clothing.types';

export interface ClothingFilter {
  category?: string;
  q?: string;
}

export class ClothingService {
  constructor(
    private readonly docs: Collection<ClothingDoc>,
    private readonly files: FileStore,
    private readonly catalogDir: string,
    private readonly apiPrefix = '/api/v1',
    private readonly idFactory: () => string = newId,
  ) {}

  private imageUrl(id: string) {
    return `${this.apiPrefix}/clothing/${id}/image`;
  }

  private fromCatalog(entry: (typeof CATALOG)[number]): ClothingItem {
    return {
      ...entry,
      imageUrl: this.imageUrl(entry.id),
      source: 'catalog',
      createdAt: new Date(0).toISOString(),
    };
  }

  private fromDoc(doc: ClothingDoc): ClothingItem {
    return {
      id: doc.id,
      name: doc.name,
      category: doc.category,
      description: doc.description,
      imageUrl: this.imageUrl(doc.id),
      source: 'user',
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async list(guestId: string, filter: ClothingFilter = {}): Promise<ClothingItem[]> {
    const mine = (await this.docs.find({ uploadedBy: guestId })).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const items = [...mine.map((d) => this.fromDoc(d)), ...CATALOG.map((c) => this.fromCatalog(c))];
    const q = filter.q?.toLowerCase();
    return items.filter(
      (i) =>
        (!filter.category || i.category === filter.category) &&
        (!q || `${i.name} ${i.description}`.toLowerCase().includes(q)),
    );
  }

  async get(id: string, guestId: string): Promise<ClothingItem> {
    const entry = findCatalogEntry(id);
    if (entry) return this.fromCatalog(entry);
    const doc = await this.docs.get(id);
    if (!doc || doc.uploadedBy !== guestId) throw AppError.notFound('Clothing item');
    return this.fromDoc(doc);
  }

  async getImage(id: string, guestId: string): Promise<ImagePayload> {
    const entry = findCatalogEntry(id);
    if (entry) {
      const buffer = await readFile(path.join(this.catalogDir, `${entry.id}.png`)).catch(() => {
        throw AppError.notFound('Clothing image');
      });
      return { buffer, mime: 'image/png', cacheable: true };
    }
    const doc = await this.docs.get(id);
    if (!doc || doc.uploadedBy !== guestId) throw AppError.notFound('Clothing item');
    const buffer = await this.files.read('clothing', doc.id, doc.imageExt);
    if (!buffer) throw AppError.notFound('Clothing image');
    return { buffer, mime: doc.imageExt === 'png' ? 'image/png' : 'image/jpeg', cacheable: false };
  }

  async create(
    guestId: string,
    input: CreateClothingInput,
    file: Buffer | undefined,
  ): Promise<ClothingItem> {
    if (!file) throw AppError.badRequest('A garment image is required (field "image").');
    const image = await sanitizeImage(file, 'Garment image');
    const imageExt = image.mime === 'image/png' ? 'png' : 'jpg';
    const doc: ClothingDoc = {
      id: this.idFactory(),
      name: input.name,
      category: input.category,
      description: input.description,
      imageExt,
      uploadedBy: guestId,
      createdAt: new Date(),
    };
    await this.files.save('clothing', doc.id, imageExt, image.buffer);
    await this.docs.insert(doc);
    return this.fromDoc(doc);
  }

  async remove(id: string, guestId: string): Promise<void> {
    if (findCatalogEntry(id))
      throw new AppError(403, 'VALIDATION_ERROR', 'Catalog items cannot be deleted.');
    const doc = await this.docs.get(id);
    if (!doc || doc.uploadedBy !== guestId) throw AppError.notFound('Clothing item');
    await this.files.delete('clothing', doc.id, doc.imageExt);
    await this.docs.remove(doc.id);
  }

  /** Removes every garment (and file) uploaded by a guest. */
  async removeAllFor(guestId: string): Promise<void> {
    for (const doc of await this.docs.find({ uploadedBy: guestId })) {
      await this.files.delete('clothing', doc.id, doc.imageExt);
      await this.docs.remove(doc.id);
    }
  }
}
