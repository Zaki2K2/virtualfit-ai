'use client';

import Link from 'next/link';
import { Download, Heart, Sparkles, Trash2 } from 'lucide-react';
import { CATEGORY_LABELS, type Favorite } from '@virtualfit/shared';
import { SimulationBadge, SimulationBanner } from '@/components/shared/ai-notices';
import { ConfirmButton } from '@/components/shared/confirm-button';
import { PageContainer, PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useFavorites, useRemoveFavorite } from '@/hooks/use-api';
import { formatDate } from '@/lib/utils';

function FavoriteCard({
  fav,
  onRemove,
  removing,
}: {
  fav: Favorite;
  onRemove: () => void;
  removing: boolean;
}) {
  const { tryOn } = fav;
  return (
    <article className="flex flex-col gap-3">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            className="group relative aspect-[3/4] overflow-hidden rounded-lg border border-border bg-muted"
            aria-label={`View details for ${tryOn.clothingName}`}
          >
            <img
              src={tryOn.resultUrl ?? ''}
              alt={`Try-on with ${tryOn.clothingName}`}
              loading="lazy"
              className="size-full object-cover"
            />
            {tryOn.simulated && (
              <span className="absolute left-2 top-2">
                <SimulationBadge />
              </span>
            )}
          </button>
        </DialogTrigger>
        <DialogContent className="max-w-xl">
          <DialogTitle className="text-lg font-semibold">{tryOn.clothingName}</DialogTitle>
          <DialogDescription className="mb-3 text-sm text-muted-foreground">
            {CATEGORY_LABELS[tryOn.category]} · saved {formatDate(fav.createdAt)} ·{' '}
            {tryOn.simulated ? 'Simulation (mock provider)' : `AI provider: ${tryOn.provider}`}
          </DialogDescription>
          {tryOn.simulated && (
            <div className="mb-3">
              <SimulationBanner />
            </div>
          )}
          <img
            src={tryOn.resultUrl ?? ''}
            alt={`Try-on with ${tryOn.clothingName}`}
            className="mx-auto max-h-[60vh] rounded-lg border border-border"
          />
        </DialogContent>
      </Dialog>
      <div className="space-y-2 px-0.5">
        <div>
          <h3 className="text-sm font-medium">{tryOn.clothingName}</h3>
          <p className="text-xs text-muted-foreground">{formatDate(fav.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a
              href={`${tryOn.resultUrl}?download=1`}
              download
              aria-label={`Download ${tryOn.clothingName}`}
            >
              <Download /> Download
            </a>
          </Button>
          <ConfirmButton
            size="sm"
            disabled={removing}
            onConfirm={onRemove}
            confirmLabel="Remove?"
            aria-label={`Remove ${tryOn.clothingName} from favorites`}
          >
            <Trash2 /> Remove
          </ConfirmButton>
        </div>
      </div>
    </article>
  );
}

export function FavoritesView() {
  const favorites = useFavorites();
  const remove = useRemoveFavorite();

  return (
    <PageContainer>
      <PageHeader
        title="Favorites"
        description="Outfits you saved. Saved results are kept; everything else is deleted automatically after a retention period."
      />
      {favorites.isLoading ? (
        <GridSkeleton count={4} />
      ) : favorites.isError ? (
        <ErrorState error={favorites.error} onRetry={() => favorites.refetch()} />
      ) : favorites.data && favorites.data.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {favorites.data.map((fav) => (
              <FavoriteCard
                key={fav.id}
                fav={fav}
                removing={remove.isPending}
                onRemove={() => remove.mutate(fav.id)}
              />
            ))}
          </div>
          {remove.isError && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {remove.error.message}
            </p>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Heart />}
          title="No favorites yet"
          description="Generate a try-on and choose “Save to favorites” to keep it here."
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
