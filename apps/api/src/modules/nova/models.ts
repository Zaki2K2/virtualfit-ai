import { Schema } from 'mongoose';
import type { CollectionFactory, Collection } from '../../db/collection';
import type {
  NovaConversation,
  NovaMessage,
  NovaMemory,
  NovaAttachment,
  NovaGeneration,
} from '@virtualfit/shared';

type Owned<T> = T & { ownerId: string };
export type Conversation = Owned<NovaConversation>;
export type Message = Owned<NovaMessage>;
export type Memory = Owned<NovaMemory>;
export type Attachment = Owned<NovaAttachment> & { expiresAt: string };
export type Generation = Owned<NovaGeneration>;
export interface Settings {
  id: string;
  ownerId: string;
  memoryEnabled: boolean;
  retentionDays: number;
}
export interface TrainingExample {
  id: string;
  ownerId: string;
  conversationId: string;
  input: string;
  expectedOutput: string;
  source: string;
  qualityStatus: string;
  consent: boolean;
  reviewStatus: string;
  datasetVersion: string;
  createdAt: string;
}

function schema(fields: Record<string, unknown>) {
  return new Schema(
    {
      _id: { type: String, required: true },
      ownerId: { type: String, required: true, index: true },
      ...fields,
    },
    { versionKey: false },
  );
}

export class NovaStore {
  conversations: Collection<Conversation>;
  messages: Collection<Message>;
  memory: Collection<Memory>;
  attachments: Collection<Attachment>;
  generations: Collection<Generation>;
  settings: Collection<Settings>;
  training: Collection<TrainingExample>;
  constructor(factory: CollectionFactory) {
    this.conversations = factory(
      'NovaConversation',
      schema({
        title: String,
        createdAt: String,
        updatedAt: String,
        expiresAt: { type: String, index: true },
        status: String,
        summary: String,
      }),
    );
    this.messages = factory(
      'NovaMessage',
      schema({
        conversationId: { type: String, index: true },
        role: { type: String, enum: ['user', 'assistant'] },
        content: String,
        attachmentIds: [String],
        model: String,
        status: String,
        metadata: Schema.Types.Mixed,
        createdAt: String,
      }),
    );
    this.memory = factory(
      'NovaMemory',
      schema({
        content: String,
        source: String,
        validation: String,
        consent: Boolean,
        createdAt: String,
        updatedAt: String,
      }),
    );
    this.attachments = factory(
      'NovaAttachment',
      schema({
        url: String,
        width: Number,
        height: Number,
        bytes: Number,
        createdAt: String,
        expiresAt: String,
      }),
    );
    this.generations = factory(
      'NovaGeneration',
      schema({
        prompt: String,
        provider: String,
        model: String,
        modelVersion: String,
        status: String,
        imageId: String,
        error: String,
        createdAt: String,
      }),
    );
    this.settings = factory(
      'NovaSettings',
      schema({ memoryEnabled: Boolean, retentionDays: Number }),
    );
    this.training = factory(
      'NovaTrainingExample',
      schema({
        conversationId: String,
        input: String,
        expectedOutput: String,
        source: String,
        qualityStatus: String,
        consent: Boolean,
        reviewStatus: String,
        datasetVersion: String,
        createdAt: String,
      }),
    );
  }
}

/** Never serialize the bearer-session identity back to a client. */
export function publicDoc<T extends { ownerId: string }>(doc: T): Omit<T, 'ownerId'> {
  const { ownerId: _ownerId, ...result } = doc;
  return result;
}
