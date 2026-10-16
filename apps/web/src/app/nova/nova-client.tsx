'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUp,
  Check,
  Copy,
  ImagePlus,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Square,
  Sun,
  Trash2,
  X,
  Sparkles,
  ArrowLeft,
  Pencil,
  Download,
  Brain,
} from 'lucide-react';
import {
  nova,
  type NovaConversation,
  type NovaMessage,
  type NovaMemory,
  type NovaAttachment,
  type NovaStatus,
  type NovaGeneration,
} from '@virtualfit/shared';
import { apiRequest, jsonBody } from '@/lib/api-client';
import { consumeNovaStream } from './stream';

const api = <T,>(url: string, init?: RequestInit) => apiRequest<T>(`/nova${url}`, init, 150_000);
type Detail = { conversation: NovaConversation; messages: NovaMessage[] };
type Mode = 'chat' | 'wardrobe' | 'vision' | 'image';
const visible = (messages: NovaMessage[]) => messages.filter((m) => !m.metadata.superseded);

export function NovaClient() {
  const [conversations, setConversations] = useState<NovaConversation[]>([]);
  const [selected, setSelected] = useState<string>();
  const [messages, setMessages] = useState<NovaMessage[]>([]);
  const [status, setStatus] = useState<NovaStatus>();
  const [memories, setMemories] = useState<NovaMemory[]>([]);
  const [training, setTraining] = useState<
    Array<{ id: string; input: string; reviewStatus: string }>
  >([]);
  const [notice, setNotice] = useState('');
  const [jobs, setJobs] = useState<NovaGeneration[]>([]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>('chat');
  const [attachment, setAttachment] = useState<NovaAttachment>();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NovaConversation[]>([]);
  const [mobile, setMobile] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');
  const [memoryEdit, setMemoryEdit] = useState<string>();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [copied, setCopied] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'Nova could not complete the request.');
  const refresh = useCallback(async () => {
    const [list, state, memory, images, examples] = await Promise.all([
      api<NovaConversation[]>('/conversations'),
      api<NovaStatus>('/status'),
      api<NovaMemory[]>('/memory'),
      api<NovaGeneration[]>('/generations'),
      api<Array<{ id: string; input: string; reviewStatus: string }>>('/training/examples'),
    ]);
    setConversations(list);
    setStatus(state);
    setMemories(memory);
    setTraining(examples);
    setJobs(images);
  }, []);
  const select = useCallback(async (id: string) => {
    const detail = await api<Detail>(`/conversations/${id}`);
    setSelected(id);
    setMessages(visible(detail.messages));
    setMobile(false);
    setError('');
    window.history.replaceState(null, '', `/nova?chat=${id}`);
  }, []);
  useEffect(() => {
    let alive = true;
    void refresh()
      .then(async () => {
        const id = new URLSearchParams(window.location.search).get('chat');
        if (id && alive) await select(id);
      })
      .catch(fail);
    const saved = localStorage.getItem('nova-theme');
    if (saved === 'light') setTheme('light');
    return () => {
      alive = false;
      controller.current?.abort();
    };
  }, [refresh, select]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);
  useEffect(() => {
    if (!query.trim()) return;
    const control = new AbortController();
    const timer = setTimeout(() => {
      void api<NovaConversation[]>(`/conversations?q=${encodeURIComponent(query.trim())}`, {
        signal: control.signal,
      })
        .then(setSearchResults)
        .catch((e) => {
          if (!control.signal.aborted) fail(e);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [query]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!controller.current) void refresh().catch(fail);
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (
      !jobs.some((j) => ['queued', 'processing'].includes(j.status)) &&
      !(!busy && messages.some((m) => m.status === 'pending'))
    )
      return;
    const timer = setInterval(() => {
      void api<NovaGeneration[]>('/generations').then(setJobs).catch(fail);
      if (selected && !busy)
        void api<Detail>(`/conversations/${selected}`)
          .then((d) => setMessages(visible(d.messages)))
          .catch(fail);
    }, 2000);
    return () => clearInterval(timer);
  }, [jobs, messages, selected, busy]);
  const newChat = () => {
    if (busy) return;
    setSelected(undefined);
    setMessages([]);
    setDraft('');
    setAttachment(undefined);
    setConsent(false);
    setError('');
    setMobile(false);
    window.history.replaceState(null, '', '/nova');
  };
  const settings = async (patch: { memoryEnabled?: boolean; retentionDays?: number }) => {
    const previous = status;
    if (previous) setStatus({ ...previous, settings: { ...previous.settings, ...patch } });
    try {
      await api('/settings', { method: 'PATCH', ...jsonBody(patch) });
      await refresh();
    } catch (e) {
      setStatus(previous);
      fail(e);
    }
  };
  const removeConversation = async (id: string) => {
    if (
      !window.confirm(
        'Delete this conversation, its unshared attachments and any linked training submissions?',
      )
    )
      return;
    try {
      await api(`/conversations/${id}`, { method: 'DELETE' });
      if (selected === id) newChat();
      await refresh();
    } catch (e) {
      fail(e);
    }
  };
  const rename = async (conversation: NovaConversation) => {
    const title = window.prompt('Conversation title', conversation.title);
    if (!title?.trim()) return;
    try {
      await api(`/conversations/${conversation.id}`, {
        method: 'PATCH',
        ...jsonBody({ title: title.trim() }),
      });
      await refresh();
    } catch (e) {
      fail(e);
    }
  };
  const upload = async (image: File) => {
    setError('');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('image', image);
      setAttachment(await api<NovaAttachment>('/attachments', { method: 'POST', body: form }));
      setMode('vision');
    } catch (e) {
      fail(e);
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };
  const send = async (regenerate = false) => {
    if (busy) return;
    const user = [...messages].reverse().find((m) => m.role === 'user');
    const text = regenerate ? (user?.content ?? '') : draft.trim();
    if (!text) return;
    setError('');
    const imageMode =
      !regenerate &&
      (mode === 'image' ||
        /\b(?:generate|draw|create)\b.{0,70}\b(?:image|picture|design)\b/i.test(text));
    if (imageMode) {
      setMode('image');
      try {
        const job = await api<NovaGeneration>('/images/generate', {
          method: 'POST',
          ...jsonBody({ prompt: text, externalConsent: consent }),
        });
        setJobs((list) => [job, ...list]);
        setDraft('');
      } catch (e) {
        fail(e);
      }
      return;
    }
    setBusy(true);
    setPhase('Connecting');
    const control = new AbortController();
    controller.current = control;
    let id = selected;
    let assistantId = '';
    let done = false;
    try {
      if (!id) {
        const created = await api<NovaConversation>('/conversations', {
          method: 'POST',
          ...jsonBody({}),
        });
        id = created.id;
        setSelected(id);
        window.history.replaceState(null, '', `/nova?chat=${id}`);
      }
      const response = await fetch('/api/v1/nova/chat/stream', {
        method: 'POST',
        credentials: 'same-origin',
        signal: control.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: id,
          message: text,
          attachmentIds: regenerate
            ? (user?.attachmentIds ?? [])
            : attachment
              ? [attachment.id]
              : [],
          mode: mode === 'image' ? 'chat' : mode,
          externalConsent: consent,
          regenerate,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Nova returned HTTP ${response.status}.`);
      }
      await consumeNovaStream(response, (event, value) => {
        if (event === 'meta') {
          const meta = value as { user: NovaMessage; assistant: NovaMessage };
          assistantId = meta.assistant.id;
          setMessages((list) =>
            regenerate
              ? [
                  ...list.filter(
                    (m) =>
                      m.id !== [...list].reverse().find((entry) => entry.role === 'assistant')?.id,
                  ),
                  meta.assistant,
                ]
              : [...list, meta.user, meta.assistant],
          );
          setDraft('');
          setAttachment(undefined);
        } else if (event === 'delta') {
          const text = (value as { text: string }).text;
          setMessages((list) =>
            list.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)),
          );
        } else if (event === 'status')
          setPhase((value as { status: string }).status.replaceAll('-', ' '));
        else if (event === 'done') {
          const message = (value as { message: NovaMessage }).message;
          setMessages((list) => list.map((m) => (m.id === message.id ? message : m)));
          done = true;
        } else if (event === 'error')
          throw new Error((value as { error: { message: string } }).error.message);
      });
      if (!done)
        throw new Error(
          'The connection ended before the response completed. Reload the conversation to recover saved output.',
        );
    } catch (e) {
      if (!control.signal.aborted) fail(e);
    } finally {
      controller.current = null;
      setBusy(false);
      setPhase('');
      if (id)
        void api<Detail>(`/conversations/${id}`)
          .then((detail) => setMessages(visible(detail.messages)))
          .catch(fail);
      void refresh().catch(fail);
    }
  };
  const stop = () => {
    controller.current?.abort();
    if (selected) void api(`/conversations/${selected}/stop`, { method: 'POST' }).catch(fail);
  };
  const saveMemory = async () => {
    try {
      await api(`/memory${memoryEdit ? `/${memoryEdit}` : ''}`, {
        method: memoryEdit ? 'PATCH' : 'POST',
        ...jsonBody({ content: memoryDraft, consent: true }),
      });
      setMemoryDraft('');
      setMemoryEdit(undefined);
      await refresh();
    } catch (e) {
      fail(e);
    }
  };
  const offerTraining = async (message: NovaMessage) => {
    if (!selected) return;
    const user = messages
      .slice(
        0,
        messages.findIndex((m) => m.id === message.id),
      )
      .filter((m) => m.role === 'user')
      .at(-1);
    if (!user) return;
    const correction = window.prompt(
      'Review and correct the answer before submitting it for operator review. No training starts automatically.',
      message.content,
    );
    if (
      !correction?.trim() ||
      !window.confirm(
        'I explicitly consent to use of this text example for model training after operator approval. Images are excluded. I can revoke this submission in Memory & privacy.',
      )
    )
      return;
    try {
      const items = Array.isArray(message.metadata.items)
        ? (message.metadata.items as Array<{
            id: string;
            name: string;
            category: string;
            description: string;
          }>)
        : [];
      await api('/training/examples', {
        method: 'POST',
        ...jsonBody({
          conversationId: selected,
          input: JSON.stringify({
            message: user.content,
            wardrobe: items.map(({ id, name, category, description }) => ({
              id,
              name,
              category,
              description,
            })),
          }),
          expectedOutput: JSON.stringify({
            answer: correction.trim(),
            itemIds: items.map((i) => i.id),
            categories: [...new Set(items.map((i) => i.category))],
            occasion: '',
          }),
          consent: true,
        }),
      });
      setNotice('Submitted for operator review. No training or model update has occurred.');
      await refresh();
    } catch (e) {
      fail(e);
    }
  };
  const remote =
    (mode === 'vision' && status?.vision.external) || (mode === 'image' && status?.images.external);
  const filtered = query.trim() ? searchResults : conversations;
  return (
    <div className="nova-app" data-theme={theme}>
      {mobile && (
        <button
          className="nova-backdrop"
          aria-label="Dismiss sidebar overlay"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`nova-sidebar ${mobile ? 'is-open' : ''}`}>
        <button
          className="nova-sidebar-close"
          aria-label="Close sidebar"
          onClick={() => setMobile(false)}
        >
          <X size={17} />
        </button>
        <Link
          href="/nova"
          className="nova-brand"
          onClick={(e) => {
            e.preventDefault();
            newChat();
          }}
        >
          <span className="nova-mark">✦</span>
          <span>
            Nova<span className="nova-ai-label"> AI</span>
          </span>
          <span className="nova-local-tag">LOCAL</span>
        </Link>
        <button className="nova-new" onClick={newChat} disabled={busy}>
          <Plus size={17} /> New conversation <span>↗</span>
        </button>
        <label className="nova-search">
          <Search size={15} />
          <input
            aria-label="Search conversations"
            placeholder="Search conversations"
            maxLength={100}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="nova-history-label">
          YOUR CONVERSATIONS <span>{conversations.length}</span>
        </div>
        <nav className="nova-chat-list" aria-label="Conversations">
          {filtered.map((conversation) => (
            <div
              key={conversation.id}
              className={`nova-chat-row ${selected === conversation.id ? 'selected' : ''}`}
            >
              <button disabled={busy} onClick={() => void select(conversation.id).catch(fail)}>
                {conversation.title}
              </button>
              <button
                aria-label={`Rename ${conversation.title}`}
                onClick={() => void rename(conversation)}
                disabled={busy}
              >
                <Pencil size={13} />
              </button>
              <button
                aria-label={`Delete ${conversation.title}`}
                onClick={() => void removeConversation(conversation.id)}
                disabled={busy}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!filtered.length && (
            <p className="nova-empty-history">
              A little space for your next idea.
              <br />
              Your conversations will appear here.
            </p>
          )}
        </nav>
        <div className="nova-sidebar-bottom">
          <button onClick={() => setMemoryOpen(true)}>
            <Brain size={17} /> Memory & privacy <span>{memories.length}</span>
          </button>
          <Link href="/stylist">
            <ArrowLeft size={16} /> VirtualFit wardrobe stylist
          </Link>
          <div className="nova-powered">
            <span>
              Powered by <strong>NovaCTO</strong>
            </span>
            <button
              aria-label="Toggle theme"
              onClick={() => {
                const next = theme === 'dark' ? 'light' : 'dark';
                setTheme(next);
                localStorage.setItem('nova-theme', next);
              }}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </aside>
      <section className="nova-workspace">
        <header className="nova-header">
          <div>
            <button
              className="nova-mobile-menu"
              aria-label="Open sidebar"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <strong>{nova.label}</strong>
            <span className="nova-header-divider" />
            <span className="nova-model-label">Qwen 0.5B · on your computer</span>
          </div>
          <button
            className={`nova-status ${status?.language.available ? 'ready' : ''}`}
            onClick={() => void refresh().catch(fail)}
          >
            <span />
            {status?.language.available
              ? 'Local model ready'
              : status
                ? 'Model unavailable'
                : 'Checking model'}
          </button>
        </header>
        <div className="nova-scroll-area">
          {!messages.length && mode !== 'image' && (
            <div className="nova-welcome">
              <div className="nova-welcome-badge">
                <span /> YOUR IDEAS. YOUR SPACE.
              </div>
              <span className="nova-hero-star">✦</span>
              <h1>
                A fresh perspective.
                <br />
                <em>Entirely yours.</em>
              </h1>
              <p>
                Meet Nova, your local thinking partner for style,
                <br className="hidden sm:block" /> wardrobe inspiration, and the ideas in between.
              </p>
              <div className="nova-starters">
                {[
                  {
                    label: 'Find my next outfit',
                    text: 'Suggest a casual outfit from my wardrobe.',
                    mode: 'wardrobe' as Mode,
                  },
                  {
                    label: 'A little color inspiration',
                    text: 'Which colors go well with navy blue?',
                    mode: 'chat' as Mode,
                  },
                  {
                    label: 'Explore an image',
                    text: 'Describe this outfit.',
                    mode: 'vision' as Mode,
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      setDraft(item.text);
                      setMode(item.mode);
                    }}
                  >
                    <Sparkles size={15} />
                    <span>{item.label}</span>
                    <span>↗</span>
                  </button>
                ))}
              </div>
              <div className="nova-capability-note">
                Text stays local. Image tools use a separate, explicitly configured model.
              </div>
            </div>
          )}
          <div className="nova-thread" aria-live="polite">
            {messages.map((message) => (
              <article key={message.id} className={`nova-message ${message.role}`}>
                <div className="nova-message-avatar">
                  {message.role === 'assistant' ? '✦' : 'Y'}
                </div>
                <div className="nova-message-body">
                  <div className="nova-message-heading">
                    {message.role === 'assistant' ? 'Nova' : 'You'}
                    <span>
                      {message.role === 'assistant'
                        ? message.metadata.source === 'deterministic-fallback'
                          ? 'Disclosed fallback'
                          : message.metadata.source === 'vision-model'
                            ? 'Vision provider'
                            : message.status === 'pending'
                              ? phase
                              : message.model
                        : ''}
                    </span>
                  </div>
                  {message.attachmentIds.map((id) => (
                    <Image
                      key={id}
                      src={`/api/v1/nova/attachments/${id}`}
                      alt="Attached image"
                      width={480}
                      height={360}
                      unoptimized
                      className="nova-attached-image"
                    />
                  ))}
                  <div className="nova-markdown">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      disallowedElements={['img']}
                      components={{
                        a: ({ children, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                  {message.status === 'pending' && !message.content && (
                    <span className="nova-thinking">
                      Thinking<span>···</span>
                    </span>
                  )}
                  {['failed', 'cancelled'].includes(message.status) && (
                    <p className="nova-message-error">
                      {String(message.metadata.error ?? 'Generation interrupted.')}
                    </p>
                  )}
                  {Array.isArray(message.metadata.items) && (
                    <div className="nova-garment-links">
                      {(message.metadata.items as Array<{ id: string; name: string }>).map(
                        (item) => (
                          <Link
                            key={item.id}
                            href={`/try-on?garment=${encodeURIComponent(item.id)}`}
                          >
                            {item.name} ↗
                          </Link>
                        ),
                      )}
                    </div>
                  )}
                  {message.role === 'assistant' && message.status !== 'pending' && (
                    <div className="nova-message-actions">
                      <button
                        aria-label="Copy message"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(message.content)
                            .then(() => setCopied(message.id))
                            .catch(fail);
                        }}
                      >
                        {copied === message.id ? <Check size={14} /> : <Copy size={14} />}{' '}
                        {copied === message.id ? 'Copied' : 'Copy'}
                      </button>
                      {message.id === messages.at(-1)?.id && (
                        <button disabled={busy} onClick={() => void send(true)}>
                          <RefreshCw size={14} /> Regenerate
                        </button>
                      )}
                      {message.status === 'completed' &&
                        message.metadata.source !== 'vision-model' && (
                          <button onClick={() => void offerTraining(message)}>
                            Offer for training review
                          </button>
                        )}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
          {mode === 'image' && (
            <section className="nova-gallery">
              <div className="nova-section-heading">
                <h1>From an idea to an image.</h1>
                <p>A dedicated image model. Never a pretend result.</p>
              </div>
              {!status?.images.configured && (
                <div className="nova-info">
                  Image generation is unavailable. Configure a GPU image worker to enable it. Your
                  existing local Qwen model generates text only.
                </div>
              )}
              {jobs.map((job) => (
                <article key={job.id} className="nova-generation">
                  <div>
                    <strong>{job.prompt}</strong>
                    <span>
                      {job.status} · {job.model}
                    </span>
                  </div>
                  {job.imageId && (
                    <>
                      <Image
                        src={`/api/v1/nova/attachments/${job.imageId}`}
                        alt={job.prompt}
                        width={512}
                        height={512}
                        unoptimized
                      />
                      <a href={`/api/v1/nova/attachments/${job.imageId}?download=1`}>
                        <Download size={15} /> Download image
                      </a>
                    </>
                  )}
                  {job.error && <p role="alert">{job.error}</p>}
                  <div className="nova-message-actions">
                    {['queued', 'processing'].includes(job.status) ? (
                      <button
                        onClick={() =>
                          void api(`/generations/${job.id}/cancel`, { method: 'POST' })
                            .then(refresh)
                            .catch(fail)
                        }
                      >
                        <Square size={13} /> Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          void api(`/generations/${job.id}`, { method: 'DELETE' })
                            .then(refresh)
                            .catch(fail)
                        }
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    )}
                    {['failed', 'cancelled'].includes(job.status) && (
                      <button
                        onClick={() =>
                          void api(`/generations/${job.id}/retry`, {
                            method: 'POST',
                            ...jsonBody({ externalConsent: consent }),
                          })
                            .then(refresh)
                            .catch(fail)
                        }
                      >
                        <RefreshCw size={13} /> Retry
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )}
          <div ref={end} />
        </div>
        <div className="nova-composer-wrap">
          {notice && (
            <div className="nova-info">
              {notice}
              <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
                <X size={13} />
              </button>
            </div>
          )}
          {error && (
            <div className="nova-error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {status?.persistence === 'memory' && (
            <p className="nova-info">
              Temporary storage: MongoDB is unavailable. History will be lost if the API restarts.
            </p>
          )}
          {attachment && (
            <div className="nova-preview">
              <Image src={attachment.url} width={64} height={64} alt="Upload preview" unoptimized />
              <div>
                Image attached<span>Stored privately · metadata removed</span>
              </div>
              <button
                aria-label="Remove attachment"
                onClick={() => {
                  void api(`/attachments/${attachment.id}`, { method: 'DELETE' })
                    .then(() => setAttachment(undefined))
                    .catch(fail);
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {mode === 'vision' && !status?.vision.configured && (
            <p className="nova-info">
              Image understanding is unavailable until a real vision worker is configured.
            </p>
          )}
          {remote && (
            <label className="nova-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{' '}
              I allow this request{mode === 'vision' ? ' and image' : ''} to be sent to the
              configured external {mode === 'vision' ? 'vision' : 'image-generation'} provider.
            </label>
          )}
          <form
            className="nova-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              aria-label="Message Nova"
              placeholder={
                mode === 'image'
                  ? 'Describe the image you want to create…'
                  : 'Ask Nova anything about your next look…'
              }
              value={draft}
              maxLength={mode === 'image' ? 1500 : 2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={busy}
            />
            <div className="nova-composer-tools">
              <input
                ref={file}
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Upload image"
                onChange={(e) => {
                  const image = e.target.files?.[0];
                  if (image) void upload(image);
                }}
              />
              <button
                type="button"
                aria-label="Attach image"
                onClick={() => file.current?.click()}
                disabled={uploading || busy}
              >
                <ImagePlus size={19} />
              </button>
              <select
                aria-label="Nova mode"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as Mode);
                  setConsent(false);
                }}
                disabled={busy}
              >
                <option value="chat">Local chat</option>
                <option value="wardrobe">Wardrobe</option>
                <option value="vision">Understand image</option>
                <option value="image">Generate image</option>
              </select>
              <span className="nova-composer-spacer" />
              {busy ? (
                <button
                  type="button"
                  className="nova-send"
                  aria-label="Stop generation"
                  onClick={stop}
                >
                  <Square size={17} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="nova-send"
                  aria-label="Send message"
                  disabled={!draft.trim() || uploading}
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </form>
          <p className="nova-fine-print">
            {uploading
              ? 'Validating image…'
              : busy
                ? `${phase} · ${status?.language.model ?? 'local model'}`
                : `Chats saved for ${status?.settings.retentionDays ?? 30} days. Memory is ${status?.settings.memoryEnabled ? 'enabled with your approval' : 'off until you opt in'}.`}{' '}
            <button onClick={() => setMemoryOpen(true)}>Manage privacy</button>
          </p>
        </div>
      </section>
      {memoryOpen && (
        <div className="nova-modal-backdrop">
          <section
            className="nova-memory-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Memory and privacy"
          >
            <div className="nova-modal-title">
              <div>
                <Brain size={21} />
                <h2>Memory & privacy</h2>
              </div>
              <button aria-label="Close memory" onClick={() => setMemoryOpen(false)}>
                <X />
              </button>
            </div>
            <p>
              Nova remembers only preferences you explicitly save here. Chat history is separate. No
              automatic training or weight updates occur.
            </p>
            <label className="nova-setting-row">
              <span>Use my approved memories</span>
              <input
                type="checkbox"
                checked={status?.settings.memoryEnabled ?? false}
                onChange={(e) => void settings({ memoryEnabled: e.target.checked })}
              />
            </label>
            <label className="nova-setting-row">
              Data retention
              <select
                aria-label="Data retention"
                value={status?.settings.retentionDays ?? 30}
                onChange={(e) => void settings({ retentionDays: Number(e.target.value) })}
              >
                {[1, 7, 30, 90, 365].map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </label>
            {memories.map((memory) => (
              <article className="nova-memory-entry" key={memory.id}>
                <p>{memory.content}</p>
                <span>Approved by you · {memory.source}</span>
                <div>
                  <button
                    aria-label="Edit memory"
                    onClick={() => {
                      setMemoryEdit(memory.id);
                      setMemoryDraft(memory.content);
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    aria-label="Delete memory"
                    onClick={() =>
                      void api(`/memory/${memory.id}`, { method: 'DELETE' })
                        .then(refresh)
                        .catch(fail)
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveMemory();
              }}
            >
              <label htmlFor="nova-memory-input">A preference you want Nova to remember</label>
              <textarea
                id="nova-memory-input"
                maxLength={300}
                placeholder="I prefer black formal outfits."
                value={memoryDraft}
                onChange={(e) => setMemoryDraft(e.target.value)}
              />
              <button
                className="nova-new"
                disabled={!status?.settings.memoryEnabled || memoryDraft.trim().length < 3}
              >
                <Check size={16} />
                {memoryEdit ? 'Approve edited memory' : 'Approve & save memory'}
              </button>
            </form>
            <div className="nova-privacy-actions">
              {training.length > 0 && (
                <div>
                  <p>Your training submissions — explicit consent, operator review required</p>
                  {training.map((row) => (
                    <div key={row.id}>
                      <span>{row.reviewStatus}</span>
                      <button
                        onClick={() =>
                          void api(`/training/examples/${row.id}`, { method: 'DELETE' })
                            .then(refresh)
                            .catch(fail)
                        }
                      >
                        Revoke training consent
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      'Delete all Nova conversation history and linked training submissions?',
                    )
                  )
                    void api('/conversations', { method: 'DELETE' })
                      .then(() => {
                        newChat();
                        return refresh();
                      })
                      .catch(fail);
                }}
              >
                <Trash2 size={15} /> Clear conversation history
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      'Delete all your Nova chats, memories, images and training submissions?',
                    )
                  )
                    void api('/data', { method: 'DELETE' })
                      .then(() => {
                        newChat();
                        return refresh();
                      })
                      .catch(fail);
                }}
              >
                Delete all my Nova data
              </button>
            </div>
            <div className="nova-model-info">
              <Settings2 size={15} />
              <span>
                Nova by NovaCTO · Qwen2.5-0.5B-Instruct by the Qwen team at Alibaba Cloud ·
                llama.cpp. No verified fine-tuned Nova checkpoint is active. Media providers:{' '}
                {status?.vision.configured ? status.vision.model : 'vision not configured'};{' '}
                {status?.images.configured
                  ? status.images.model
                  : 'image generation not configured'}
                .
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
