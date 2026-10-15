'use client';

import { CATEGORY_LABELS, CLOTHING_CATEGORIES, type ClothingCategory } from '@virtualfit/shared';
import { cn } from '@/lib/utils';

export type CategoryFilterValue = ClothingCategory | 'all';

const OPTIONS: Array<{ value: CategoryFilterValue; label: string }> = [
  { value: 'all', label: 'All' },
  ...CLOTHING_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
];

export function CategoryFilter({
  value,
  onChange,
}: {
  value: CategoryFilterValue;
  onChange: (v: CategoryFilterValue) => void;
}) {
  return (
    <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
            value === o.value
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-surface text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
