import { Check } from 'lucide-react';
import { CATEGORY_LABELS, type ClothingItem } from '@virtualfit/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  item: ClothingItem;
  selected?: boolean;
  /** When provided the whole image becomes a selectable button. */
  onSelect?: (item: ClothingItem) => void;
  actions?: React.ReactNode;
}

export function ClothingCard({ item, selected, onSelect, actions }: Props) {
  const image = (
    <>
      <img
        src={item.imageUrl}
        alt={item.name}
        loading="lazy"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />
      {selected && (
        <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-accent text-accent-foreground">
          <Check className="size-3.5" />
        </span>
      )}
    </>
  );

  const frame = cn(
    'group relative block aspect-square w-full overflow-hidden rounded-lg border bg-muted',
    selected ? 'border-accent ring-2 ring-accent' : 'border-border',
  );

  return (
    <article className="flex flex-col gap-2">
      {onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(item)}
          aria-pressed={selected}
          aria-label={`Select ${item.name}`}
          className={frame}
        >
          {image}
        </button>
      ) : (
        <div className={frame}>{image}</div>
      )}
      <div className="space-y-1 px-0.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium leading-snug">{item.name}</h3>
          {item.source === 'user' && <Badge variant="accent">Yours</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[item.category]}</p>
        {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
      </div>
    </article>
  );
}
