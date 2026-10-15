'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

/** Before/after slider: drag (or use arrow keys on the range input) to reveal the original photo. */
export function BeforeAfter({
  beforeSrc,
  afterSrc,
  className,
}: {
  beforeSrc: string;
  afterSrc: string;
  className?: string;
}) {
  const id = useId();
  const [pos, setPos] = useState(50);

  function updateFromPointer(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, pct)));
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className="relative aspect-[3/4] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-lg border border-border bg-muted"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) updateFromPointer(e);
        }}
      >
        <img
          src={afterSrc}
          alt="Virtual try-on result"
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full object-cover"
        />
        <img
          src={beforeSrc}
          alt="Your original photo"
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full object-cover"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
          Before
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
          After
        </span>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
          style={{ left: `${pos}%` }}
        >
          <span className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs shadow-md">
            &#8596;
          </span>
        </div>
      </div>
      <label htmlFor={id} className="sr-only">
        Compare original and result
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}
