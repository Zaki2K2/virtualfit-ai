import type { ClothingCategory } from '@virtualfit/shared';
import type { Doc } from '../../db/collection';

export type ImageExt = 'png' | 'jpg';

/** A garment uploaded by a guest. Bundled catalog items are not stored in the database. */
export interface ClothingDoc extends Doc {
  name: string;
  category: ClothingCategory;
  description: string;
  imageExt: ImageExt;
  uploadedBy: string;
  createdAt: Date;
}

export interface CatalogEntry {
  id: string;
  name: string;
  category: ClothingCategory;
  description: string;
}

export interface ImagePayload {
  buffer: Buffer;
  mime: 'image/png' | 'image/jpeg';
  cacheable: boolean;
}
