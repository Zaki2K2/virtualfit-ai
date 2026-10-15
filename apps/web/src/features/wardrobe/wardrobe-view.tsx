'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Search, Shirt, Sparkles, Trash2 } from 'lucide-react';
import { CategoryFilter, type CategoryFilterValue } from '@/components/clothing/category-filter';
import { AddGarmentDialog } from '@/components/clothing/add-garment-dialog';
import { ClothingCard } from '@/components/clothing/clothing-card';
import { ConfirmButton } from '@/components/shared/confirm-button';
import { PageContainer, PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useClothing, useDeleteClothing, useHealth } from '@/hooks/use-api';
import { describeError } from '@/lib/api-errors';

export function WardrobeView() {
  const [category, setCategory] = useState<CategoryFilterValue>('all');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search);
  const clothing = useClothing(category, q);
  const remove = useDeleteClothing();
  const health = useHealth();

  return (
    <PageContainer>
      <PageHeader
        title="Wardrobe"
        description="Browse the sample catalog or add your own garments, then send any item to the try-on studio."
        actions={<AddGarmentDialog maxMb={health.data?.limits.maxUploadMb ?? 8} />}
      />

      <div className="mb-6 space-y-4">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search garments"
            aria-label="Search garments"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <CategoryFilter value={category} onChange={setCategory} />
      </div>

      {clothing.isLoading ? (
        <GridSkeleton />
      ) : clothing.isError ? (
        <ErrorState error={clothing.error} onRetry={() => clothing.refetch()} />
      ) : clothing.data && clothing.data.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {clothing.data.map((item) => (
            <ClothingCard
              key={item.id}
              item={item}
              actions={
                <>
                  <Button asChild size="sm">
                    <Link href={`/try-on?garment=${item.id}`}>
                      <Sparkles /> Try on
                    </Link>
                  </Button>
                  {item.source === 'user' && (
                    <ConfirmButton
                      size="sm"
                      disabled={remove.isPending}
                      onConfirm={() => remove.mutate(item.id)}
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 />
                    </ConfirmButton>
                  )}
                </>
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Shirt />}
          title="No garments found"
          description={
            q
              ? `Nothing matches "${q}". Try a different search or category.`
              : 'There are no garments in this category yet.'
          }
        />
      )}
      {remove.isError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {describeError(remove.error).message}
        </p>
      )}
    </PageContainer>
  );
}
