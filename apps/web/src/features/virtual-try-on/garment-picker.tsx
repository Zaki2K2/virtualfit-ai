'use client';

import { useState } from 'react';
import {
  CATEGORY_LABELS,
  CLOTHING_CATEGORIES,
  type ClothingCategory,
  type ClothingItem,
} from '@virtualfit/shared';
import { Shirt, Upload } from 'lucide-react';
import { CategoryFilter, type CategoryFilterValue } from '@/components/clothing/category-filter';
import { ClothingCard } from '@/components/clothing/clothing-card';
import { ImageDropzone } from '@/components/shared/image-dropzone';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/shared/states';
import { Select, Label } from '@/components/ui/input';
import { useClothing } from '@/hooks/use-api';
import { cn } from '@/lib/utils';

export type GarmentChoice =
  | { kind: 'catalog'; item: ClothingItem }
  | { kind: 'upload'; file: File | null; category: ClothingCategory };

interface Props {
  value: GarmentChoice | null;
  onChange: (choice: GarmentChoice | null) => void;
  maxMb: number;
  disabled?: boolean;
}

export function GarmentPicker({ value, onChange, maxMb, disabled }: Props) {
  const [mode, setMode] = useState<'wardrobe' | 'upload'>(
    value?.kind === 'upload' ? 'upload' : 'wardrobe',
  );
  const [category, setCategory] = useState<CategoryFilterValue>('all');
  const clothing = useClothing(category, '');

  const upload = value?.kind === 'upload' ? value : null;
  const selectedId = value?.kind === 'catalog' ? value.item.id : undefined;

  function switchMode(next: 'wardrobe' | 'upload') {
    setMode(next);
    onChange(next === 'upload' ? { kind: 'upload', file: null, category: 'tops' } : null);
  }

  return (
    <div className={cn('space-y-4', disabled && 'pointer-events-none opacity-60')}>
      <div
        role="tablist"
        aria-label="Garment source"
        className="inline-flex rounded-md bg-muted p-1"
      >
        {(
          [
            ['wardrobe', 'Wardrobe', Shirt],
            ['upload', 'Upload image', Upload],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={mode === id}
            onClick={() => switchMode(id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
              mode === id ? 'bg-surface shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {mode === 'wardrobe' ? (
        <>
          <CategoryFilter value={category} onChange={setCategory} />
          {clothing.isLoading ? (
            <GridSkeleton count={6} />
          ) : clothing.isError ? (
            <ErrorState error={clothing.error} onRetry={() => clothing.refetch()} />
          ) : clothing.data?.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {clothing.data.map((item) => (
                <ClothingCard
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={(it) => onChange({ kind: 'catalog', item: it })}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Shirt />}
              title="Nothing here yet"
              description="No garments in this category."
            />
          )}
        </>
      ) : (
        <div className="space-y-3">
          <ImageDropzone
            file={upload?.file ?? null}
            onChange={(file) =>
              onChange({ kind: 'upload', file, category: upload?.category ?? 'tops' })
            }
            maxMb={maxMb}
            label="Garment image"
            hint="A single garment on a plain background works best"
            aspect="aspect-[4/3]"
          />
          <div className="space-y-1.5">
            <Label htmlFor="upload-category">What kind of garment is it?</Label>
            <Select
              id="upload-category"
              value={upload?.category ?? 'tops'}
              onChange={(e) =>
                onChange({
                  kind: 'upload',
                  file: upload?.file ?? null,
                  category: e.target.value as ClothingCategory,
                })
              }
            >
              {CLOTHING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              This one-off upload is used for this try-on only. Add it to your wardrobe to keep it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
