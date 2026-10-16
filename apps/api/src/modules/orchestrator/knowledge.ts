import { createHash, randomUUID } from 'node:crypto';
import { Schema } from 'mongoose';
import type { Collection, CollectionFactory } from '../../db/collection';
import { AppError } from '../../utils/errors';

export interface EmbeddingProvider {
  /** Vectors from different ids live in different spaces and are never compared. */
  id: string;
  dimensions: number;
  /** False for the built-in hashing embedder: it matches words, not meaning. */
  semantic: boolean;
  embed(texts: string[], signal: AbortSignal): Promise<number[][]>;
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

/** Dependency-free hashing-trick embedder: honest lexical retrieval until a real model is enabled. */
export class LexicalHashEmbedder implements EmbeddingProvider {
  readonly id = 'lexical-hash-v1';
  readonly dimensions = 256;
  readonly semantic = false;
  async embed(texts: string[], signal: AbortSignal) {
    signal.throwIfAborted();
    return texts.map((text) => {
      const vector = new Array<number>(this.dimensions).fill(0);
      const tokens = words(text);
      const grams = [...tokens, ...tokens.slice(1).map((t, i) => `${tokens[i]} ${t}`)];
      for (const gram of grams) {
        const digest = createHash('sha1').update(gram).digest();
        const slot = digest.readUInt16BE(0) % this.dimensions;
        vector[slot] = (vector[slot] ?? 0) + (digest[2]! & 1 ? 1 : -1);
      }
      const norm = Math.hypot(...vector) || 1;
      return vector.map((v) => v / norm);
    });
  }
}

export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const boundary = Math.max(
        clean.lastIndexOf('\n\n', end),
        clean.lastIndexOf('. ', end),
        clean.lastIndexOf('\n', end),
      );
      if (boundary > start + size / 2) end = boundary + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

const TEXT_TYPES = new Set(['text/plain', 'text/markdown']);
/** Only formats that are genuinely handled; anything else is refused, never half-parsed. */
export function extractText(content: string, mimeType: string): string {
  if (!TEXT_TYPES.has(mimeType))
    throw AppError.badRequest(
      `Extraction for ${mimeType} is not implemented. Supported: text/plain, text/markdown.`,
    );
  // eslint-disable-next-line no-control-regex
  return content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export interface KnowledgeDoc {
  id: string;
  ownerId: string;
  title: string;
  mimeType: string;
  bytes: number;
  chunkCount: number;
  embedder: string;
  consent: boolean;
  createdAt: string;
}
interface KnowledgeChunk {
  id: string;
  ownerId: string;
  docId: string;
  index: number;
  text: string;
  embedder: string;
  vector: number[];
}
export interface KnowledgeHit {
  docId: string;
  title: string;
  chunkIndex: number;
  score: number;
  text: string;
}

const owned = (fields: Record<string, unknown>) =>
  new Schema(
    {
      _id: { type: String, required: true },
      ownerId: { type: String, required: true, index: true },
      ...fields,
    },
    { versionKey: false },
  );

export const KNOWLEDGE_LIMITS = { maxBytes: 200_000, maxDocsPerOwner: 50, maxChunks: 400 } as const;

export class KnowledgeService {
  private readonly docs: Collection<KnowledgeDoc>;
  private readonly chunks: Collection<KnowledgeChunk>;
  constructor(
    factory: CollectionFactory,
    private embedder: EmbeddingProvider = new LexicalHashEmbedder(),
  ) {
    this.docs = factory(
      'NovaKnowledgeDoc',
      owned({
        title: String,
        mimeType: String,
        bytes: Number,
        chunkCount: Number,
        embedder: String,
        consent: Boolean,
        createdAt: String,
      }),
    );
    this.chunks = factory(
      'NovaKnowledgeChunk',
      owned({
        docId: { type: String, index: true },
        index: Number,
        text: String,
        embedder: String,
        vector: [Number],
      }),
    );
  }
  get embedderInfo() {
    return { id: this.embedder.id, semantic: this.embedder.semantic };
  }
  /** Provider switching: new documents use the new space; old ones are reported as stale. */
  useEmbedder(embedder: EmbeddingProvider) {
    this.embedder = embedder;
  }

  async ingest(
    ownerId: string,
    input: { title: string; content: string; mimeType: string; consent: boolean },
    signal: AbortSignal,
  ) {
    if (input.consent !== true)
      throw AppError.badRequest('Explicit consent is required to store a document for retrieval.');
    const text = extractText(input.content, input.mimeType);
    const bytes = Buffer.byteLength(text);
    if (bytes > KNOWLEDGE_LIMITS.maxBytes)
      throw AppError.badRequest(`Document exceeds ${KNOWLEDGE_LIMITS.maxBytes} bytes.`);
    if ((await this.docs.find({ ownerId })).length >= KNOWLEDGE_LIMITS.maxDocsPerOwner)
      throw AppError.badRequest('Document limit reached. Delete a document first.');
    const pieces = chunkText(text);
    if (!pieces.length) throw AppError.badRequest('The document has no extractable text.');
    if (pieces.length > KNOWLEDGE_LIMITS.maxChunks)
      throw AppError.badRequest('The document is too long to index.');
    const vectors = await this.embedder.embed(pieces, signal);
    signal.throwIfAborted();
    const doc: KnowledgeDoc = {
      id: randomUUID(),
      ownerId,
      title: input.title,
      mimeType: input.mimeType,
      bytes,
      chunkCount: pieces.length,
      embedder: this.embedder.id,
      consent: true,
      createdAt: new Date().toISOString(),
    };
    await this.docs.insert(doc);
    for (const [index, chunkText] of pieces.entries())
      await this.chunks.insert({
        id: randomUUID(),
        ownerId,
        docId: doc.id,
        index,
        text: chunkText,
        embedder: this.embedder.id,
        vector: vectors[index]!,
      });
    return doc;
  }
  async list(ownerId: string) {
    return (await this.docs.find({ ownerId })).map((d) => ({
      ...d,
      stale: d.embedder !== this.embedder.id,
    }));
  }
  async remove(ownerId: string, docId: string) {
    const doc = await this.docs.get(docId);
    if (!doc || doc.ownerId !== ownerId) throw AppError.notFound('Document');
    await this.removeChunks(docId);
    await this.docs.remove(docId);
  }
  async erase(ownerId: string) {
    for (const doc of await this.docs.find({ ownerId })) {
      await this.removeChunks(doc.id);
      await this.docs.remove(doc.id);
    }
  }
  private async removeChunks(docId: string) {
    for (const chunk of await this.chunks.find({ docId })) await this.chunks.remove(chunk.id);
  }

  async search(
    ownerId: string,
    query: string,
    signal: AbortSignal,
    limit = 4,
  ): Promise<KnowledgeHit[]> {
    const [q] = await this.embedder.embed([query], signal);
    const titles = new Map((await this.docs.find({ ownerId })).map((d) => [d.id, d.title]));
    const hits: KnowledgeHit[] = [];
    // Owner filter first, then embedder filter: never compares across users or vector spaces.
    for (const chunk of await this.chunks.find({ ownerId })) {
      if (chunk.embedder !== this.embedder.id || !titles.has(chunk.docId)) continue;
      const score = chunk.vector.reduce((sum, v, i) => sum + v * q![i]!, 0);
      if (score > 0.05)
        hits.push({
          docId: chunk.docId,
          title: titles.get(chunk.docId)!,
          chunkIndex: chunk.index,
          score: Math.round(score * 1000) / 1000,
          text: chunk.text,
        });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
