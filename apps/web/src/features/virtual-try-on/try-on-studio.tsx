'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldAlert, Sparkles } from 'lucide-react';
import { CATEGORY_LABELS, type ModelOptionId } from '@virtualfit/shared';
import { ImageDropzone } from '@/components/shared/image-dropzone';
import { FitDisclaimer, SimulationBadge } from '@/components/shared/ai-notices';
import { PageContainer, PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useClothing, useHealth, useProfile } from '@/hooks/use-api';
import { GarmentPicker, type GarmentChoice } from './garment-picker';
import { ResultPanel } from './result-panel';
import { ModelSelector } from './model-selector';
import { useTryOn, type GenerateInput } from './use-try-on';
import { describeError } from '@/lib/api-errors';

function StepTitle({ n, title, description }: { n: number; title: string; description: string }) {
  return (
    <CardHeader>
      <div className="flex items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {n}
        </span>
        <CardTitle>{title}</CardTitle>
      </div>
      <CardDescription className="pl-10">{description}</CardDescription>
    </CardHeader>
  );
}

export function TryOnStudio() {
  const preselect = useSearchParams().get('garment');
  const health = useHealth();
  const profile = useProfile();
  const allClothing = useClothing('all', '');
  const tryOnJob = useTryOn();

  const [person, setPerson] = useState<File | null>(null);
  const [garment, setGarment] = useState<GarmentChoice | null>(null);
  const [consent, setConsent] = useState(false);
  const [modelChoice, setModelChoice] = useState<ModelOptionId | null>(null);
  const lastInput = useRef<GenerateInput | null>(null);

  const maxMb = health.data?.limits.maxUploadMb ?? 8;
  const ai = health.data?.ai;
  const selectedId = modelChoice ?? ai?.defaultOption ?? 'mock';
  const selected = ai?.options.find((o) => o.id === selectedId);
  const needsConsent = !!selected?.externalProcessing;

  // Pre-select a garment coming from the wardrobe / history ("?garment=<id>")
  useEffect(() => {
    if (!preselect || garment) return;
    const item = allClothing.data?.find((i) => i.id === preselect);
    if (item) setGarment({ kind: 'catalog', item });
  }, [preselect, garment, allClothing.data]);

  useEffect(() => {
    if (profile.data?.privacy.rememberAiConsent) setConsent(true);
  }, [profile.data?.privacy.rememberAiConsent]);

  // Created inside the effect (not useMemo) so StrictMode's mount/unmount/mount cycle can't leave
  // us holding a revoked blob URL.
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!person) return setOriginalUrl(null);
    const url = URL.createObjectURL(person);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [person]);

  const garmentReady =
    garment?.kind === 'catalog' || (garment?.kind === 'upload' && !!garment.file);
  const blockers = [
    !person && 'Upload your photo',
    !garmentReady && 'Choose a garment',
    needsConsent && !consent && 'Confirm AI processing consent',
    selected && !selected.available && `${selected.label} is not available`,
  ].filter(Boolean) as string[];

  function buildInput(): GenerateInput | null {
    if (!person || !garment) return null;
    if (garment.kind === 'catalog') {
      return {
        person,
        category: garment.item.category,
        garment: { kind: 'catalog', id: garment.item.id },
        consent,
        model: selectedId,
      };
    }
    if (!garment.file) return null;
    return {
      person,
      category: garment.category,
      garment: { kind: 'upload', file: garment.file },
      consent,
      model: selectedId,
    };
  }

  function generate(input = buildInput()) {
    if (!input) return;
    lastInput.current = input;
    tryOnJob.generate(input);
  }

  const busy = tryOnJob.processing;

  return (
    <PageContainer>
      <PageHeader
        title="Virtual Try-On Studio"
        description="Upload a photo, choose a garment and preview how it could look on you."
        actions={selected?.simulated ? <SimulationBadge /> : undefined}
      />

      {health.isError && (
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-md border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            {describeError(health.error).message}{' '}
            {describeError(health.error).kind === 'unreachable' && (
              <button type="button" className="underline" onClick={() => health.refetch()}>
                Check again
              </button>
            )}
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <StepTitle
              n={1}
              title="Upload your photo"
              description="A clear, front-facing photo with good lighting and a plain background works best."
            />
            <CardContent>
              <div className="mx-auto max-w-xs">
                <ImageDropzone
                  file={person}
                  onChange={setPerson}
                  maxMb={maxMb}
                  label="Your photo"
                  hint={`JPEG or PNG, up to ${maxMb} MB`}
                  disabled={busy}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <StepTitle
              n={2}
              title="Choose clothing"
              description="Pick from the wardrobe or upload an image of a garment."
            />
            <CardContent>
              <GarmentPicker value={garment} onChange={setGarment} maxMb={maxMb} disabled={busy} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <StepTitle
              n={3}
              title="Generate & preview"
              description="Review your selection, then generate the try-on."
            />
            <CardContent className="space-y-4">
              {garment && garmentReady && (
                <p className="text-sm text-muted-foreground">
                  Garment:{' '}
                  <strong className="text-foreground">
                    {garment.kind === 'catalog' ? garment.item.name : garment.file?.name}
                  </strong>{' '}
                  (
                  {
                    CATEGORY_LABELS[
                      garment.kind === 'catalog' ? garment.item.category : garment.category
                    ]
                  }
                  )
                </p>
              )}

              {ai && (
                <ModelSelector
                  options={ai.options}
                  value={selectedId}
                  onChange={setModelChoice}
                  disabled={busy}
                />
              )}

              {needsConsent && (
                <label className="flex cursor-pointer gap-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    disabled={busy}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <ShieldAlert className="size-4" /> Send my photo to an external AI service
                    </span>
                    <span className="text-muted-foreground">
                      Your photo and the garment are sent to an AI service outside this server (for
                      example Hugging Face) to create the result. They are not stored on this server
                      after processing.
                    </span>
                  </span>
                </label>
              )}

              <Button
                size="lg"
                className="w-full"
                variant="accent"
                disabled={busy || blockers.length > 0}
                onClick={() => generate()}
              >
                <Sparkles /> {busy ? 'Generating...' : 'Generate try-on'}
              </Button>
              {blockers.length > 0 && !busy && (
                <p className="text-center text-xs text-muted-foreground">
                  To continue: {blockers.join(' · ')}
                </p>
              )}

              <ResultPanel
                tryOn={tryOnJob.tryOn}
                processing={busy}
                elapsed={tryOnJob.elapsed}
                requestError={tryOnJob.requestError ?? tryOnJob.pollError}
                originalUrl={originalUrl}
                onRetry={() => generate(lastInput.current)}
                onReset={tryOnJob.reset}
              />
              <FitDisclaimer />
              <p className="text-xs text-muted-foreground">
                Want to know how your photos are handled? See{' '}
                <Link href="/settings" className="underline">
                  privacy &amp; settings
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
