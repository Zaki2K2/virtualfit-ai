import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { novaIdentityQuestion, type NovaChatInput } from '@virtualfit/shared';
import type { Env } from '../../config/env';
import type { Collection } from '../../db/collection';
import type { FileStore } from '../../storage/file-store';
import type { StylingService } from '../styling/styling.service';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { NovaStore, publicDoc, type Attachment, type Message, type Settings } from './models';
import { InferenceQueue } from './queue';
import {
  novaSystem,
  type ChatTurn,
  type NovaLanguageProvider,
  type NovaVisionProvider,
  type NovaImageProvider,
} from './providers';

const now = () => new Date().toISOString();
const expiry = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
export function cleanMemory(text: string) {
  if (/@|https?:|data:image|\b\d[\d ()+-]{7,}\d\b|\b\d{1,3}\s*(?:cm|kg|lbs?|inches)\b/i.test(text))
    throw AppError.badRequest(
      'Save styling preferences only; remove contact details, links and body measurements.',
    );
  return text.trim();
}

export class NovaService {
  readonly queue: InferenceQueue;
  private readonly active = new Map<string, AbortController>();
  private storageWrite: Promise<unknown> = Promise.resolve();
  constructor(
    readonly store: NovaStore,
    private readonly env: Env,
    private readonly files: FileStore,
    private readonly styling: StylingService,
    readonly language: NovaLanguageProvider,
    readonly vision: NovaVisionProvider,
    readonly images: NovaImageProvider,
    readonly database: string,
  ) {
    this.queue = new InferenceQueue(env.NOVA_CONCURRENCY, env.NOVA_QUEUE_SIZE);
  }
  async owned<T extends { id: string; ownerId: string }>(
    collection: Collection<T>,
    ownerId: string,
    id: string,
  ): Promise<T> {
    const value = await collection.get(id);
    if (!value || value.ownerId !== ownerId) throw AppError.notFound('Nova resource');
    return value;
  }
  async settings(ownerId: string): Promise<Settings> {
    const current = await this.store.settings.get(ownerId);
    if (current) return current;
    const defaults = { id: ownerId, ownerId, memoryEnabled: false, retentionDays: 30 };
    try {
      return await this.store.settings.insert(defaults);
    } catch (error) {
      const existing = await this.store.settings.get(ownerId);
      if (existing) return existing;
      throw error;
    }
  }
  async setSettings(
    ownerId: string,
    patch: Partial<Pick<Settings, 'memoryEnabled' | 'retentionDays'>>,
  ) {
    await this.settings(ownerId);
    await this.store.settings.update(ownerId, patch);
    if (patch.retentionDays) {
      for (const conversation of await this.store.conversations.find({ ownerId }))
        await this.store.conversations.update(conversation.id, {
          expiresAt: new Date(
            new Date(conversation.updatedAt).getTime() + patch.retentionDays * 86_400_000,
          ).toISOString(),
        });
    }
    const saved = await this.settings(ownerId);
    return { memoryEnabled: saved.memoryEnabled, retentionDays: saved.retentionDays };
  }
  async resources() {
    const folder = path.join(this.env.uploadDir, 'nova');
    await mkdir(folder, { recursive: true });
    let bytes = 0;
    for (const file of await readdir(folder)) {
      try {
        bytes += (await stat(path.join(folder, file))).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const disk = await statfs(folder);
    return {
      active: this.queue.active,
      queued: this.queue.queued,
      concurrency: this.env.NOVA_CONCURRENCY,
      storageBytes: bytes,
      storageLimitBytes: this.env.NOVA_STORAGE_MB * 1024 ** 2,
      freeDiskBytes: disk.bavail * disk.bsize,
    };
  }
  async status(ownerId: string) {
    const status = await this.styling.status();
    const settings = await this.settings(ownerId);
    return {
      language: { available: status.available, model: status.model, reason: status.reason },
      vision: {
        configured: this.vision.configured,
        model: this.vision.model,
        external: this.vision.external,
      },
      images: {
        configured: this.images.configured,
        model: this.images.model,
        external: this.images.external,
        cancellation: this.images.cancellation,
      },
      persistence: this.database,
      resources: await this.resources(),
      settings: { memoryEnabled: settings.memoryEnabled, retentionDays: settings.retentionDays },
    };
  }
  async createConversation(ownerId: string, title: string) {
    const settings = await this.settings(ownerId);
    return publicDoc(
      await this.store.conversations.insert({
        id: randomUUID(),
        ownerId,
        title,
        createdAt: now(),
        updatedAt: now(),
        expiresAt: expiry(settings.retentionDays),
        status: 'active',
        summary: '',
      }),
    );
  }
  async conversations(ownerId: string, query = '') {
    const needle = query.toLowerCase();
    const matches = needle
      ? new Set(
          (await this.store.messages.find({ ownerId }))
            .filter(
              (m) =>
                m.status === 'completed' &&
                !m.metadata.superseded &&
                m.content.toLowerCase().includes(needle),
            )
            .map((m) => m.conversationId),
        )
      : new Set<string>();
    return (await this.store.conversations.find({ ownerId }))
      .filter(
        (c) =>
          c.expiresAt > now() &&
          (!needle || c.title.toLowerCase().includes(needle) || matches.has(c.id)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(publicDoc);
  }
  async detail(ownerId: string, id: string) {
    const conversation = await this.owned(this.store.conversations, ownerId, id);
    if (conversation.expiresAt < now()) throw AppError.notFound('Expired conversation');
    const messages = (await this.store.messages.find({ ownerId, conversationId: id })).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt),
    );
    return { conversation: publicDoc(conversation), messages: messages.map(publicDoc) };
  }
  async rename(ownerId: string, id: string, title: string) {
    await this.owned(this.store.conversations, ownerId, id);
    return publicDoc((await this.store.conversations.update(id, { title, updatedAt: now() }))!);
  }
  async stop(ownerId: string, id: string) {
    await this.owned(this.store.conversations, ownerId, id);
    this.active.get(id)?.abort(new Error('Stopped by user'));
  }
  async deleteConversation(ownerId: string, id: string) {
    await this.stop(ownerId, id);
    if (this.active.has(id))
      throw new AppError(
        409,
        'VALIDATION_ERROR',
        'Generation is stopping. Retry deletion after it finishes.',
      );
    const messages = await this.store.messages.find({ ownerId, conversationId: id });
    for (const message of messages) await this.store.messages.remove(message.id);
    for (const row of await this.store.training.find({ ownerId, conversationId: id }))
      await this.store.training.remove(row.id);
    await this.store.conversations.remove(id);
    const remaining = await this.store.messages.find({ ownerId });
    const generations = await this.store.generations.find({ ownerId });
    for (const attachmentId of new Set(messages.flatMap((m) => m.attachmentIds))) {
      if (
        !remaining.some((m) => m.attachmentIds.includes(attachmentId)) &&
        !generations.some((g) => g.imageId === attachmentId)
      )
        await this.deleteAttachment(ownerId, attachmentId);
    }
  }
  async clearHistory(ownerId: string) {
    for (const conversation of await this.store.conversations.find({ ownerId }))
      await this.deleteConversation(ownerId, conversation.id);
  }
  async memories(ownerId: string) {
    return (await this.store.memory.find({ ownerId })).map(publicDoc);
  }
  async saveMemory(ownerId: string, content: string, id?: string) {
    if (!(await this.settings(ownerId)).memoryEnabled)
      throw AppError.badRequest('Enable approved memory storage first.');
    const cleaned = cleanMemory(content);
    if (id) {
      await this.owned(this.store.memory, ownerId, id);
      return publicDoc(
        (await this.store.memory.update(id, {
          content: cleaned,
          updatedAt: now(),
          consent: true,
          validation: 'user-approved',
        }))!,
      );
    }
    const current = await this.store.memory.find({ ownerId });
    if (current.length >= 100)
      throw AppError.badRequest('Memory storage is full. Delete or edit an existing preference.');
    return publicDoc(
      await this.store.memory.insert({
        id: randomUUID(),
        ownerId,
        content: cleaned,
        source: 'explicit-user-entry',
        consent: true,
        validation: 'user-approved',
        createdAt: now(),
        updatedAt: now(),
      }),
    );
  }
  async deleteMemory(ownerId: string, id: string) {
    await this.owned(this.store.memory, ownerId, id);
    await this.store.memory.remove(id);
  }
  private async relevantMemory(ownerId: string, message: string) {
    if (!(await this.settings(ownerId)).memoryEnabled) return [];
    const words = message.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    return (await this.store.memory.find({ ownerId }))
      .filter((m) => m.consent && m.validation === 'user-approved')
      .sort(
        (a, b) =>
          words.filter((w) => b.content.toLowerCase().includes(w)).length -
          words.filter((w) => a.content.toLowerCase().includes(w)).length,
      )
      .slice(0, 4)
      .map((m) => m.content);
  }
  async saveImage(ownerId: string, input: Buffer): Promise<Attachment> {
    if (input.length > this.env.maxUploadBytes)
      throw new AppError(413, 'FILE_TOO_LARGE', 'Image exceeds the configured upload limit.');
    let output: { data: Buffer; info: sharp.OutputInfo };
    try {
      const image = sharp(input, { limitInputPixels: 16_777_216, failOn: 'error' });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1)
        throw new Error('Unsupported image');
      output = await image
        .rotate()
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 92 })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw AppError.badRequest(
        'Upload a valid single-frame JPEG, PNG or WebP image (at most 16 megapixels).',
      );
    }
    const operation = this.storageWrite
      .catch(() => undefined)
      .then(async () => {
        const resources = await this.resources();
        if (
          resources.storageBytes + output.data.length > resources.storageLimitBytes ||
          resources.freeDiskBytes - output.data.length < this.env.NOVA_MIN_FREE_DISK_MB * 1024 ** 2
        )
          throw new AppError(
            507,
            'FILE_TOO_LARGE',
            'Nova storage is full or disk space is low. Delete files or increase the configured storage allowance.',
          );
        const id = randomUUID();
        await this.files.save('nova', id, 'webp', output.data);
        try {
          return await this.store.attachments.insert({
            id,
            ownerId,
            url: `/api/v1/nova/attachments/${id}`,
            width: output.info.width,
            height: output.info.height,
            bytes: output.data.length,
            createdAt: now(),
            expiresAt: expiry(1),
          });
        } catch (error) {
          await this.files.delete('nova', id, 'webp');
          throw error;
        }
      });
    this.storageWrite = operation;
    return operation;
  }
  async attachment(ownerId: string, id: string) {
    await this.owned(this.store.attachments, ownerId, id);
    const image = await this.files.read('nova', id, 'webp');
    if (!image) throw AppError.notFound('Image');
    return image;
  }
  async deleteAttachment(ownerId: string, id: string) {
    const attachment = await this.store.attachments.get(id);
    if (!attachment) return;
    if (attachment.ownerId !== ownerId) throw AppError.notFound('Image');
    await this.files.delete('nova', id, 'webp');
    await this.store.attachments.remove(id);
  }
  async chat(
    ownerId: string,
    input: NovaChatInput,
    signal: AbortSignal,
    emit: (event: string, value: unknown) => void,
  ): Promise<Message> {
    const { conversation, messages } = await this.detail(ownerId, input.conversationId);
    if (this.active.has(conversation.id))
      throw new AppError(409, 'RATE_LIMITED', 'This conversation is already generating a reply.');
    if (
      /data:image|\b\d{1,3}\s*(?:cm|kg|lbs?|inches)\b|\b(?:height|weight|waist|chest|hips?)\s*(?:is|:|=)?\s*\d/i.test(
        input.message,
      )
    )
      throw AppError.badRequest(
        'Do not send body measurements or image bytes to the language model.',
      );
    if ((input.mode === 'vision' || input.attachmentIds.length) && !this.vision.configured)
      throw new AppError(
        503,
        'AI_UNAVAILABLE',
        'Vision inference is unavailable. The text-only Qwen model cannot describe image pixels.',
      );
    if (input.attachmentIds.length && this.vision.external && !input.externalConsent)
      throw AppError.badRequest(
        'Explicit consent is required before sending an image to the external vision provider.',
      );
    for (const id of input.attachmentIds) await this.owned(this.store.attachments, ownerId, id);
    const control = new AbortController();
    this.active.set(conversation.id, control);
    const combined = AbortSignal.any([
      signal,
      control.signal,
      AbortSignal.timeout(this.env.NOVA_TIMEOUT_MS),
    ]);
    let answer = '';
    let reply: Message | undefined;
    try {
      let user: Message;
      if (input.regenerate) {
        const last = messages.filter((m) => !m.metadata.superseded).at(-1);
        const previous = messages.filter((m) => m.role === 'user').at(-1);
        if (!last || last.role !== 'assistant' || !previous || previous.content !== input.message)
          throw AppError.badRequest('Regenerate the most recent assistant response only.');
        user = { ...previous, ownerId };
        input = {
          ...input,
          attachmentIds: previous.attachmentIds,
          mode: (previous.metadata.mode as NovaChatInput['mode']) ?? 'chat',
        };
        if (input.attachmentIds.length && this.vision.external && !input.externalConsent)
          throw AppError.badRequest('External vision consent is required again.');
        await this.store.messages.update(last.id, {
          metadata: { ...last.metadata, superseded: true },
        });
      } else {
        user = await this.store.messages.insert({
          id: randomUUID(),
          ownerId,
          conversationId: conversation.id,
          role: 'user',
          content: input.message,
          attachmentIds: input.attachmentIds,
          model: '',
          status: 'completed',
          createdAt: now(),
          metadata: { mode: input.mode },
        });
      }
      reply = await this.store.messages.insert({
        id: randomUUID(),
        ownerId,
        conversationId: conversation.id,
        role: 'assistant',
        content: '',
        attachmentIds: [],
        model: this.env.SLM_MODEL,
        status: 'pending',
        metadata: {},
        createdAt: now(),
      });
      emit('meta', {
        conversationId: conversation.id,
        user: publicDoc(user),
        assistant: publicDoc(reply),
      });
      emit('status', { status: 'queued' });
      const memories = await this.relevantMemory(ownerId, input.message);
      let metadata: Record<string, unknown> = {
        source: 'model',
        memoryUsed: memories.length,
        provider: 'llama-cpp',
      };
      await this.queue.run(combined, async () => {
        emit('status', { status: 'generating' });
        if (input.attachmentIds.length) {
          const image = await this.attachment(ownerId, input.attachmentIds[0]!);
          const description = await this.vision.describe(image, input.message, combined);
          answer = description.text;
          reply!.model = this.vision.model;
          metadata = {
            source: 'vision-model',
            provider: this.vision.model,
            external: this.vision.external,
            modelVersion: description.modelVersion,
          };
          emit('delta', { text: answer });
        } else if (input.mode === 'vision')
          throw AppError.badRequest('Attach an image for visual understanding.');
        else if (
          input.mode === 'wardrobe' ||
          (!novaIdentityQuestion(input.message) &&
            /\b(outfit|wardrobe|garment|trousers|shirt|jacket|dress|pants|skirt|clothes|clothing|wear)\b/i.test(
              input.message,
            ))
        ) {
          const prompt =
            input.message +
            (memories.length ? ` Approved styling preferences: ${memories.join('; ')}` : '');
          if (prompt.length > 600)
            throw AppError.badRequest(
              'Wardrobe requests including preferences must be under 600 characters. Shorten the request or edit saved preferences.',
            );
          emit('status', { status: 'validating-wardrobe' });
          const result = await this.styling.recommend(
            ownerId,
            prompt,
            'base',
            messages
              .filter((m) => m.role === 'user')
              .slice(-2)
              .map((m) => m.content)
              .filter((m) => m.length <= 600),
            combined,
          );
          combined.throwIfAborted();
          answer = result.answer;
          metadata = {
            source: result.source,
            itemIds: result.itemIds,
            items: result.items,
            fallbackReason: result.fallbackReason,
            provider: 'llama-cpp',
            memoryUsed: memories.length,
          };
          // Buffer until the existing grounding checks pass; do not expose unverified token drafts.
          emit('delta', { text: answer });
        } else {
          const history = messages
            .filter((m) => m.status === 'completed' && !m.metadata.superseded && m.id !== user.id)
            .slice(-8);
          const turns: ChatTurn[] = [
            { role: 'system', content: novaSystem(input.message, memories, conversation.summary) },
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: input.message },
          ];
          let saved = 0;
          for await (const chunk of this.language.stream(turns, combined)) {
            combined.throwIfAborted();
            answer += chunk;
            emit('delta', { text: chunk });
            if (answer.length - saved > 300) {
              await this.store.messages.update(reply!.id, { content: answer });
              saved = answer.length;
            }
          }
        }
      });
      combined.throwIfAborted();
      if (!answer.trim()) throw new AppError(502, 'AI_FAILED', 'The model generated no response.');
      reply = (await this.store.messages.update(reply.id, {
        content: answer,
        status: 'completed',
        metadata,
        model: reply.model,
      }))!;
      const settings = await this.settings(ownerId);
      // Extractive note from old user topics only; this is not automatic preference approval.
      const summary = messages
        .filter((m) => m.role === 'user')
        .slice(-12, -4)
        .map((m) => m.content.slice(0, 80))
        .join(' | ')
        .slice(0, 400);
      await this.store.conversations.update(conversation.id, {
        updatedAt: now(),
        expiresAt: expiry(settings.retentionDays),
        summary,
        ...(conversation.title === 'New conversation' ? { title: input.message.slice(0, 60) } : {}),
      });
      emit('done', { message: publicDoc(reply) });
      return reply;
    } catch (error) {
      const cancelled = signal.aborted || control.signal.aborted;
      const timeout = combined.aborted && !cancelled;
      if (reply)
        await this.store.messages.update(reply.id, {
          content: answer,
          status: cancelled ? 'cancelled' : 'failed',
          metadata: {
            error: timeout
              ? 'Generation timed out.'
              : cancelled
                ? 'Stopped by user.'
                : error instanceof AppError
                  ? error.message
                  : 'Inference failed; retry after checking the server.',
          },
        });
      if (cancelled)
        throw new AppError(409, 'AI_FAILED', 'Generation stopped. Partial output was saved.');
      if (timeout)
        throw new AppError(
          504,
          'AI_TIMEOUT',
          'Nova generation timed out. Retry or shorten the request.',
        );
      throw error;
    } finally {
      this.active.delete(conversation.id);
    }
  }
  async generate(ownerId: string, prompt: string, externalConsent: boolean) {
    if (!this.images.configured)
      throw new AppError(
        503,
        'AI_UNAVAILABLE',
        'Image generation is not configured. No image was generated.',
      );
    if (this.images.external && !externalConsent)
      throw AppError.badRequest(
        'Consent is required to send this prompt to an external image model.',
      );
    const job = await this.store.generations.insert({
      id: randomUUID(),
      ownerId,
      prompt,
      provider: 'image-generation',
      model: this.images.model,
      status: 'queued',
      createdAt: now(),
    });
    const control = new AbortController();
    this.active.set(job.id, control);
    const signal = AbortSignal.any([control.signal, AbortSignal.timeout(this.env.NOVA_TIMEOUT_MS)]);
    void this.queue
      .run(signal, async () => {
        await this.store.generations.update(job.id, { status: 'processing' });
        const generated = await this.images.generate(prompt, signal);
        signal.throwIfAborted();
        const image = await this.saveImage(ownerId, generated.image);
        if (signal.aborted) {
          await this.deleteAttachment(ownerId, image.id);
          signal.throwIfAborted();
        }
        await this.store.generations.update(job.id, {
          status: 'completed',
          imageId: image.id,
          modelVersion: generated.modelVersion,
        });
      })
      .catch(async (error: unknown) => {
        await this.store.generations.update(job.id, {
          status: control.signal.aborted ? 'cancelled' : 'failed',
          error: control.signal.aborted
            ? 'Cancelled; remote compute may still be running.'
            : error instanceof AppError
              ? error.message
              : signal.aborted
                ? 'Image inference timed out.'
                : 'Image inference failed; no image was produced.',
        });
      })
      .finally(() => this.active.delete(job.id))
      .catch((error: unknown) => {
        logger.error('Nova image job persistence failed', {
          id: job.id,
          message: (error as Error).message,
        });
      });
    return publicDoc(job);
  }
  async cancelGeneration(ownerId: string, id: string) {
    await this.owned(this.store.generations, ownerId, id);
    this.active.get(id)?.abort(new Error('Cancelled by user'));
  }
  async deleteGeneration(ownerId: string, id: string) {
    const job = await this.owned(this.store.generations, ownerId, id);
    if (this.active.has(id)) {
      await this.cancelGeneration(ownerId, id);
      throw new AppError(
        409,
        'VALIDATION_ERROR',
        'Cancellation requested. Delete after the job stops.',
      );
    }
    if (
      job.imageId &&
      !(await this.store.messages.find({ ownerId })).some((m) =>
        m.attachmentIds.includes(job.imageId!),
      )
    )
      await this.deleteAttachment(ownerId, job.imageId);
    await this.store.generations.remove(id);
  }
  async collectExample(
    ownerId: string,
    conversationId: string,
    input: string,
    expectedOutput: string,
  ) {
    await this.owned(this.store.conversations, ownerId, conversationId);
    cleanMemory(input);
    cleanMemory(expectedOutput);
    return publicDoc(
      await this.store.training.insert({
        id: randomUUID(),
        ownerId,
        conversationId,
        input,
        expectedOutput,
        source: 'explicit-user-submission',
        consent: true,
        qualityStatus: 'unvalidated',
        reviewStatus: 'pending',
        datasetVersion: '',
        createdAt: now(),
      }),
    );
  }
  async erase(ownerId: string) {
    await this.clearHistory(ownerId);
    for (const job of await this.store.generations.find({ ownerId }))
      await this.deleteGeneration(ownerId, job.id);
    for (const m of await this.store.memory.find({ ownerId })) await this.store.memory.remove(m.id);
    for (const a of await this.store.attachments.find({ ownerId }))
      await this.deleteAttachment(ownerId, a.id);
    for (const e of await this.store.training.find({ ownerId }))
      await this.store.training.remove(e.id);
    await this.store.settings.remove(ownerId);
  }
  async recover() {
    for (const m of await this.store.messages.find({ status: 'pending' }))
      await this.store.messages.update(m.id, {
        status: 'failed',
        metadata: { error: 'API restarted during generation. Regenerate to retry.' },
      });
    for (const g of await this.store.generations.find())
      if (['queued', 'processing'].includes(g.status))
        await this.store.generations.update(g.id, {
          status: 'failed',
          error: 'API restarted; retry explicitly.',
        });
  }
  async purge() {
    for (const memory of await this.store.memory.find()) {
      const settings = await this.settings(memory.ownerId);
      if (Date.now() - new Date(memory.updatedAt).getTime() > settings.retentionDays * 86_400_000)
        await this.store.memory.remove(memory.id);
    }
    for (const example of await this.store.training.find()) {
      const settings = await this.settings(example.ownerId);
      if (Date.now() - new Date(example.createdAt).getTime() > settings.retentionDays * 86_400_000)
        await this.store.training.remove(example.id);
    }
    for (const c of await this.store.conversations.find())
      if (c.expiresAt < now() && !this.active.has(c.id))
        await this.deleteConversation(c.ownerId, c.id);
    for (const job of await this.store.generations.find()) {
      const settings = await this.settings(job.ownerId);
      if (
        Date.now() - new Date(job.createdAt).getTime() > settings.retentionDays * 86_400_000 &&
        !this.active.has(job.id)
      )
        await this.deleteGeneration(job.ownerId, job.id);
    }
    const messages = await this.store.messages.find();
    const jobs = await this.store.generations.find();
    for (const a of await this.store.attachments.find())
      if (
        a.expiresAt < now() &&
        !messages.some((m) => m.attachmentIds.includes(a.id)) &&
        !jobs.some((g) => g.imageId === a.id)
      )
        await this.deleteAttachment(a.ownerId, a.id);
  }
}
