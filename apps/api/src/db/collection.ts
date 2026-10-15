import mongoose, { type Model, type Schema } from 'mongoose';

export interface Doc {
  id: string;
}

/**
 * Tiny persistence port so modules work identically with MongoDB or the in-memory
 * fallback used when no MONGODB_URI is configured.
 */
export interface Collection<T extends Doc> {
  insert(doc: T): Promise<T>;
  get(id: string): Promise<T | null>;
  find(filter?: Partial<T>): Promise<T[]>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
  remove(id: string): Promise<boolean>;
}

export type CollectionFactory = <T extends Doc>(name: string, schema: Schema) => Collection<T>;

class MemoryCollection<T extends Doc> implements Collection<T> {
  private readonly items = new Map<string, T>();

  async insert(doc: T) {
    this.items.set(doc.id, { ...doc });
    return { ...doc };
  }
  async get(id: string) {
    const d = this.items.get(id);
    return d ? { ...d } : null;
  }
  async find(filter: Partial<T> = {}) {
    const entries = Object.entries(filter);
    return [...this.items.values()]
      .filter((d) => entries.every(([k, v]) => (d as Record<string, unknown>)[k] === v))
      .map((d) => ({ ...d }));
  }
  async update(id: string, patch: Partial<T>) {
    const cur = this.items.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch, id };
    this.items.set(id, next);
    return { ...next };
  }
  async remove(id: string) {
    return this.items.delete(id);
  }
}

class MongoCollection<T extends Doc> implements Collection<T> {
  constructor(private readonly model: Model<Record<string, unknown>>) {}

  private toDomain(raw: Record<string, unknown> | null): T | null {
    if (!raw) return null;
    const { _id, __v, ...rest } = raw;
    void __v;
    return { ...rest, id: String(_id) } as unknown as T;
  }
  private toRow(doc: Partial<T>) {
    const { id, ...rest } = doc as Record<string, unknown>;
    return id === undefined ? rest : { _id: id, ...rest };
  }

  async insert(doc: T) {
    await this.model.create(this.toRow(doc));
    return doc;
  }
  async get(id: string) {
    return this.toDomain(await this.model.findById(id).lean<Record<string, unknown>>());
  }
  async find(filter: Partial<T> = {}) {
    const rows = await this.model.find(this.toRow(filter)).lean<Record<string, unknown>[]>();
    return rows.map((r) => this.toDomain(r) as T);
  }
  async update(id: string, patch: Partial<T>) {
    const row = await this.model
      .findByIdAndUpdate(id, { $set: this.toRow(patch) }, { new: true })
      .lean<Record<string, unknown>>();
    return this.toDomain(row);
  }
  async remove(id: string) {
    const res = await this.model.deleteOne({ _id: id });
    return res.deletedCount > 0;
  }
}

export const memoryCollectionFactory: CollectionFactory = () => new MemoryCollection();

export const mongoCollectionFactory: CollectionFactory = (name, schema) => {
  const model =
    (mongoose.models[name] as Model<Record<string, unknown>> | undefined) ??
    mongoose.model<Record<string, unknown>>(name, schema);
  return new MongoCollection(model);
};
