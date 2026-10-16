import { z } from 'zod';

export const novaChatSchema = z
  .object({
    conversationId: z.string().uuid(),
    message: z.string().trim().min(1).max(2000),
    attachmentIds: z.array(z.string().uuid()).max(1).default([]),
    mode: z.enum(['chat', 'wardrobe', 'vision']).default('chat'),
    externalConsent: z.boolean().default(false),
    regenerate: z.boolean().default(false),
  })
  .strict();
export type NovaChatInput = z.infer<typeof novaChatSchema>;
export const novaMemorySchema = z
  .object({
    content: z.string().trim().min(3).max(300),
    consent: z.literal(true),
  })
  .strict();
export const novaSettingsSchema = z
  .object({
    memoryEnabled: z.boolean().optional(),
    retentionDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();
export const novaImageSchema = z
  .object({
    prompt: z.string().trim().min(3).max(1500),
    externalConsent: z.boolean().default(false),
  })
  .strict();
export interface NovaConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  status: string;
  summary: string;
}
export interface NovaAttachment {
  id: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
}
export interface NovaMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  attachmentIds: string[];
  model: string;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  metadata: Record<string, unknown>;
}
export interface NovaMemory {
  id: string;
  content: string;
  source: string;
  validation: string;
  consent: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface NovaGeneration {
  id: string;
  prompt: string;
  provider: string;
  model: string;
  modelVersion?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  imageId?: string;
  error?: string;
  createdAt: string;
}
export interface NovaStatus {
  language: { available: boolean; model: string; reason: string };
  vision: { configured: boolean; model: string; external: boolean };
  images: { configured: boolean; model: string; external: boolean; cancellation: string };
  persistence: string;
  resources: {
    active: number;
    queued: number;
    concurrency: number;
    storageBytes: number;
    storageLimitBytes: number;
    freeDiskBytes: number;
  };
  settings: { memoryEnabled: boolean; retentionDays: number };
}
