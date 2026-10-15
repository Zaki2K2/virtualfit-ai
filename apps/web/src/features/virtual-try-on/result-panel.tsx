'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Check, Download, Heart, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import type { TryOn } from '@virtualfit/shared';
import { BeforeAfter } from '@/components/try-on/before-after';
import { SimulationBanner } from '@/components/shared/ai-notices';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAddFavorite } from '@/hooks/use-api';
import { ApiError } from '@/lib/api-client';

interface Props {
  tryOn: TryOn | null;
  processing: boolean;
  elapsed: number;
  requestError: unknown;
  originalUrl: string | null;
  onRetry: () => void;
  onReset: () => void;
}

export function ResultPanel({
  tryOn,
  processing,
  elapsed,
  requestError,
  originalUrl,
  onRetry,
  onReset,
}: Props) {
  if (processing) return <Progress elapsed={elapsed} />;

  if (requestError) {
    return (
      <Failure
        message={requestError instanceof ApiError ? requestError.message : 'Something went wrong.'}
        onRetry={onRetry}
      />
    );
  }
  if (tryOn?.status === 'failed') {
    return (
      <Failure
        message={tryOn.error?.message ?? 'Generation failed.'}
        code={tryOn.error?.code}
        onRetry={onRetry}
      />
    );
  }
  if (tryOn?.status === 'completed' && tryOn.resultUrl && originalUrl) {
    return <Completed tryOn={tryOn} originalUrl={originalUrl} onReset={onReset} />;
  }
  return <Idle />;
}

function Idle() {
  return (
    <div className="flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border bg-surface px-6 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
        <Sparkles className="size-5" />
      </div>
      <h3 className="font-semibold">Your preview appears here</h3>
      <p className="max-w-xs text-sm text-muted-foreground">
        Upload a photo, pick a garment, then generate. You can compare before and after, save or
        download the result.
      </p>
    </div>
  );
}

const STAGES = [
  { from: 0, label: 'Sending your images securely' },
  { from: 5, label: 'Analysing pose and garment' },
  { from: 20, label: 'Rendering the try-on' },
  { from: 60, label: 'Still working - large models can take a couple of minutes' },
];

function Progress({ elapsed }: { elapsed: number }) {
  const stage = [...STAGES].reverse().find((s) => elapsed >= s.from)!;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex aspect-[3/4] flex-col items-center justify-center gap-4 rounded-lg border border-border bg-surface px-6 text-center"
    >
      <Loader2 className="size-9 animate-spin text-accent" />
      <div className="space-y-1">
        <p className="font-semibold">Generating your try-on</p>
        <p className="text-sm text-muted-foreground">{stage.label}</p>
      </div>
      <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-accent" />
      </div>
      <p className="text-xs text-muted-foreground">{elapsed}s elapsed</p>
      <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  );
}

function Failure({
  message,
  code,
  onRetry,
}: {
  message: string;
  code?: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-4 rounded-lg border border-danger/30 bg-danger-soft px-6 py-12 text-center"
    >
      <AlertTriangle className="size-8 text-danger" />
      <div className="space-y-1">
        <p className="font-semibold text-danger">We could not create your try-on</p>
        <p className="max-w-sm text-sm text-danger">{message}</p>
        {code === 'AI_QUOTA_EXHAUSTED' && (
          <p className="text-xs text-danger/80">
            Free GPU quota resets over time - waiting a few minutes usually helps.
          </p>
        )}
      </div>
      <Button variant="outline" onClick={onRetry}>
        <RotateCcw /> Retry
      </Button>
    </div>
  );
}

function Completed({
  tryOn,
  originalUrl,
  onReset,
}: {
  tryOn: TryOn;
  originalUrl: string;
  onReset: () => void;
}) {
  const addFavorite = useAddFavorite();
  const [saved, setSaved] = useState(false);

  return (
    <div className="space-y-4">
      {tryOn.simulated ? (
        <SimulationBanner />
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="accent">
            <Sparkles className="size-3" /> AI-generated
          </Badge>
          <span className="text-muted-foreground">
            {tryOn.model}
            {tryOn.durationMs != null && ` · ${Math.round(tryOn.durationMs / 1000)}s`}
          </span>
        </p>
      )}
      <BeforeAfter beforeSrc={originalUrl} afterSrc={tryOn.resultUrl as string} />
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={`${tryOn.resultUrl}?download=1`} download>
            <Download /> Download
          </a>
        </Button>
        {saved ? (
          <Button asChild variant="outline">
            <Link href="/favorites">
              <Check /> Saved - view favorites
            </Link>
          </Button>
        ) : (
          <Button
            variant="accent"
            disabled={addFavorite.isPending}
            onClick={() => addFavorite.mutate(tryOn.id, { onSuccess: () => setSaved(true) })}
          >
            <Heart /> {addFavorite.isPending ? 'Saving...' : 'Save to favorites'}
          </Button>
        )}
        <Button variant="ghost" onClick={onReset}>
          <RotateCcw /> New try-on
        </Button>
      </div>
      {addFavorite.isError && (
        <p role="alert" className="text-sm text-danger">
          {addFavorite.error.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Results are deleted from the server after a retention period unless you save them to
        favorites.
      </p>
    </div>
  );
}
