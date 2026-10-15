'use client';

import { Cpu, FlaskConical, Globe, Sparkles } from 'lucide-react';
import type { ModelOption, ModelOptionId } from '@virtualfit/shared';
import { cn } from '@/lib/utils';

const ICONS: Record<ModelOptionId, typeof Cpu> = {
  mock: FlaskConical,
  hosted: Globe,
  pretrained: Cpu,
  custom: Sparkles,
};

const DESCRIPTIONS: Record<ModelOptionId, string> = {
  mock: 'Instant demo of the workflow. Not AI: your photo is returned with a simulation banner.',
  hosted: 'Real AI on a free shared GPU hosted by Hugging Face.',
  pretrained: 'CatVTON with its original published weights, run by our own engine.',
  custom: 'CatVTON fine-tuned by this project (LoRA), run by our own engine.',
};

/** Only models that can run right now are selectable; the reason is shown for the others. */
export function ModelSelector({
  options,
  value,
  onChange,
  disabled,
}: {
  options: ModelOption[];
  value: ModelOptionId;
  onChange: (id: ModelOptionId) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium">AI model</legend>
      {options.map((o) => {
        const Icon = ICONS[o.id];
        const selected = value === o.id;
        return (
          <label
            key={o.id}
            className={cn(
              'flex gap-3 rounded-md border p-3 text-sm transition-colors',
              o.available ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-60',
              selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
            )}
          >
            <input
              type="radio"
              name="model"
              value={o.id}
              checked={selected}
              disabled={!o.available || disabled}
              onChange={() => onChange(o.id)}
              className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                <Icon className="size-4" /> {o.label}
                {o.simulated && (
                  <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning">
                    simulation
                  </span>
                )}
              </span>
              <span className="block text-muted-foreground">
                {o.available ? DESCRIPTIONS[o.id] : `Unavailable: ${o.reason}`}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
