'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { checkImageFile } from '@/lib/image-validation';
import { cn } from '@/lib/utils';

interface Props {
  file: File | null;
  onChange: (file: File | null) => void;
  maxMb: number;
  label: string;
  hint: string;
  aspect?: string;
  disabled?: boolean;
}

/** Click-or-drop image picker with instant validation and an object-URL preview. */
export function ImageDropzone({
  file,
  onChange,
  maxMb,
  label,
  hint,
  aspect = 'aspect-[3/4]',
  disabled,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return setPreviewUrl(null);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function accept(candidate: File | undefined) {
    if (!candidate) return;
    const check = await checkImageFile(candidate, maxMb);
    if (!check.ok) {
      setError(check.error ?? 'Invalid image.');
      return;
    }
    setError(null);
    onChange(candidate);
  }

  function clear() {
    setError(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => accept(e.target.files?.[0])}
      />
      {previewUrl ? (
        <div
          className={cn(
            'relative overflow-hidden rounded-lg border border-border bg-muted',
            aspect,
          )}
        >
          <img src={previewUrl} alt={`${label} preview`} className="size-full object-cover" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute right-2 top-2 size-9 bg-surface/90"
            onClick={clear}
            disabled={disabled}
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <X />
          </Button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!disabled) void accept(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 text-center transition-colors',
            aspect,
            dragging ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-muted',
            disabled && 'pointer-events-none opacity-60',
          )}
        >
          <ImagePlus className="size-8 text-muted-foreground" />
          <span className="text-sm font-medium">Click to upload or drag &amp; drop</span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
