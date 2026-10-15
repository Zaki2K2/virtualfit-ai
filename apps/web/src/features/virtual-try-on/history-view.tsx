'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  History,
  Loader2,
  Repeat,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { CATEGORY_LABELS, type TryOn } from '@virtualfit/shared';
import { SimulationBadge } from '@/components/shared/ai-notices';
import { ConfirmButton } from '@/components/shared/confirm-button';
import { PageContainer, PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDeleteHistory, useHistory } from '@/hooks/use-api';
import { formatDate } from '@/lib/utils';
import { describeError } from '@/lib/api-errors';

function StatusBadge({ status }: { status: TryOn['status'] }) {
  if (status === 'completed')
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3" /> Completed
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge variant="danger">
        <AlertTriangle className="size-3" /> Failed
      </Badge>
    );
  return (
    <Badge variant="accent">
      <Loader2 className="size-3 animate-spin" /> Processing
    </Badge>
  );
}

function HistoryCard({
  item,
  onDelete,
  deleting,
}: {
  item: TryOn;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <article className="flex flex-col gap-3 sm:flex-row">
      <div className="relative aspect-[3/4] w-full shrink-0 overflow-hidden rounded-lg border border-border bg-muted sm:w-36">
        {item.resultUrl ? (
          <img
            src={item.resultUrl}
            alt={`Try-on with ${item.clothingName}`}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            {item.status === 'failed' ? (
              <AlertTriangle className="size-6" />
            ) : (
              <Loader2 className="size-6 animate-spin" />
            )}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{item.clothingName}</h3>
            <StatusBadge status={item.status} />
            {item.simulated && <SimulationBadge />}
            {item.status === 'completed' && !item.simulated && (
              <Badge variant="accent">AI-generated</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {CATEGORY_LABELS[item.category]} · {formatDate(item.createdAt)}
          </p>
          {item.error && <p className="text-sm text-danger">{item.error.message}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {item.clothingId ? (
            <Button asChild size="sm">
              <Link href={`/try-on?garment=${item.clothingId}`}>
                <Repeat /> Reuse outfit
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              disabled
              title="This garment was a one-off upload and was not kept. Add garments to your wardrobe to reuse them."
            >
              <Repeat /> Reuse outfit
            </Button>
          )}
          {item.resultUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={`${item.resultUrl}?download=1`} download>
                <Download /> Download
              </a>
            </Button>
          )}
          <ConfirmButton
            size="sm"
            disabled={deleting}
            onConfirm={onDelete}
            confirmLabel="Delete?"
            aria-label={`Delete ${item.clothingName} try-on`}
          >
            <Trash2 /> Delete
          </ConfirmButton>
        </div>
      </div>
    </article>
  );
}

export function HistoryView() {
  const history = useHistory();
  const remove = useDeleteHistory();

  return (
    <PageContainer>
      <PageHeader
        title="History"
        description="Your recent try-ons. Your original photo is never stored, so reusing an outfit means choosing a photo again. Results are deleted automatically after the retention period."
      />
      {history.isLoading ? (
        <GridSkeleton count={4} />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => history.refetch()} />
      ) : history.data && history.data.length > 0 ? (
        <>
          <div className="grid gap-x-8 gap-y-8 md:grid-cols-2">
            {history.data.map((item) => (
              <HistoryCard
                key={item.id}
                item={item}
                deleting={remove.isPending}
                onDelete={() => remove.mutate(item.id)}
              />
            ))}
          </div>
          {remove.isError && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {describeError(remove.error).message}
            </p>
          )}
        </>
      ) : (
        <EmptyState
          icon={<History />}
          title="No try-ons yet"
          description="Your generated try-ons will show up here."
          action={
            <Button asChild>
              <Link href="/try-on">
                <Sparkles /> Open the studio
              </Link>
            </Button>
          }
        />
      )}
    </PageContainer>
  );
}
