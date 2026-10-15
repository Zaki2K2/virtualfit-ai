'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { StylingRecommendation, StylingStatus } from '@virtualfit/shared';
import { apiRequest, jsonBody } from '@/lib/api-client';
import { PageContainer, PageHeader } from '@/components/shared/page-header';
import { ClothingCard } from '@/components/clothing/clothing-card';
import { ErrorState, Spinner } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function StylistPage() {
  const [model, setModel] = useState<'base' | 'custom'>('base');
  const [message, setMessage] = useState(
    'Suggest a casual outfit with a white top and comfortable trousers.',
  );
  const status = useQuery({
    queryKey: ['styling-status'],
    queryFn: () => apiRequest<StylingStatus>('/styling/status'),
    staleTime: 15_000,
    retry: false,
  });
  const recommendation = useMutation({
    mutationFn: (text: string) =>
      apiRequest<StylingRecommendation>(
        '/styling/recommend',
        { method: 'POST', ...jsonBody({ message: text, model }) },
        125_000,
      ),
  });
  return (
    <PageContainer>
      <PageHeader
        title="AI Styling Assistant"
        description="Describe an outfit and get suggestions from your available wardrobe. Language recommendations run locally on your CPU."
      />
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">
              This assistant recommends clothing by name, category, and description. It does not
              inspect photos, generate images, or predict physical fit. Fashion instructions and
              verified wardrobe data guide recommendations. Custom checkpoints are offered only
              after training, load and evaluation checks pass.
            </p>
            {status.isPending ? (
              <Spinner label="Checking local language model..." />
            ) : status.isError ? (
              <ErrorState error={status.error} onRetry={() => status.refetch()} />
            ) : (
              <div role="status" className="rounded-md bg-muted p-3 text-sm">
                <p>{status.data.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {status.data.model} ·{' '}
                  {status.data.available ? 'Local language inference ready' : 'Unavailable'}
                </p>
                {!status.data.available && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => status.refetch()}
                  >
                    Check again
                  </Button>
                )}
              </div>
            )}
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                recommendation.mutate(message.trim());
              }}
            >
              <label htmlFor="styling-model" className="block text-sm font-medium">
                Language model
              </label>
              <select
                id="styling-model"
                value={model}
                onChange={(event) => {
                  setModel(event.target.value as 'base' | 'custom');
                  recommendation.reset();
                }}
                disabled={recommendation.isPending}
                className="w-full rounded-md border border-border bg-background p-2"
              >
                {(
                  status.data?.models ?? [
                    {
                      id: 'base',
                      model: 'Original Qwen',
                      available: false,
                      reason: 'Checking availability',
                    },
                  ]
                ).map((option) => (
                  <option key={option.id} value={option.id} disabled={!option.available}>
                    {option.id === 'base' ? 'Original Qwen (rollback)' : 'Custom checkpoint'} ?{' '}
                    {option.available ? 'Available' : option.reason}
                  </option>
                ))}
              </select>
              <label htmlFor="style-request" className="block text-sm font-medium">
                What would you like to wear?
              </label>
              <textarea
                id="style-request"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                minLength={3}
                maxLength={600}
                required
                rows={4}
                disabled={recommendation.isPending}
                className="w-full rounded-md border border-border bg-background p-3 text-sm"
                placeholder="A blue and white outfit for a relaxed office day. No dresses."
              />
              <p className="text-xs text-muted-foreground">
                Include the occasion, colors, clothing categories, and anything to avoid. Only the
                clothing visible to your guest session is used. Measurements and photographs are not
                sent to the language model.
              </p>
              <Button
                type="submit"
                disabled={
                  !(
                    status.data?.models?.find((option) => option.id === model)?.available ??
                    status.data?.available
                  ) ||
                  recommendation.isPending ||
                  message.trim().length < 3
                }
              >
                {recommendation.isPending ? 'Thinking locally...' : 'Suggest an outfit'}
              </Button>
            </form>
          </CardContent>
        </Card>
        {recommendation.isPending && (
          <Spinner label="Finding an outfit with your local language model..." />
        )}
        {recommendation.isError && (
          <ErrorState
            error={recommendation.error}
            onRetry={() => recommendation.mutate(message.trim())}
          />
        )}
        {recommendation.isSuccess && (
          <section aria-label="Styling recommendation" className="space-y-4">
            <p role="status" className="rounded-md border border-border bg-surface p-4">
              {recommendation.data.answer}
            </p>
            <p className="text-sm text-muted-foreground">
              Occasion: {recommendation.data.occasion || 'Not specified'} · Categories:{' '}
              {recommendation.data.categories.join(', ') || 'None'}
            </p>
            {recommendation.data.items.length ? (
              <div className="grid grid-cols-2 gap-4">
                {recommendation.data.items.map((item) => (
                  <ClothingCard
                    key={item.id}
                    item={item}
                    actions={
                      <Button asChild size="sm">
                        <Link href={`/try-on?garment=${encodeURIComponent(item.id)}`}>Try on</Link>
                      </Button>
                    }
                  />
                ))}
              </div>
            ) : (
              <p>
                No matching wardrobe items were selected. Try another request or add a garment in
                Wardrobe.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {recommendation.data.source === 'model'
                ? `Generated locally by ${recommendation.data.model}.`
                : recommendation.data.source === 'deterministic-fallback'
                  ? `Catalog fallback: the model response failed validation (${recommendation.data.fallbackReason}).`
                  : 'Answered by catalog rules; no model generation was needed.'}{' '}
              Suggestions may be imperfect; check that they match your preferences.
            </p>
          </section>
        )}
      </div>
    </PageContainer>
  );
}
