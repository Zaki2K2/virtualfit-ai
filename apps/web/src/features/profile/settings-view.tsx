'use client';

import { CheckCircle2, CircleDashed, Database, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { ConfirmButton } from '@/components/shared/confirm-button';
import { PageContainer, PageHeader } from '@/components/shared/page-header';
import { ErrorState, Spinner } from '@/components/shared/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useEraseAllData, useHealth } from '@/hooks/use-api';

const FEATURES: Array<{ name: string; done: boolean; note?: string }> = [
  { name: 'Photo-based virtual try-on workflow', done: true },
  { name: 'Wardrobe, favorites, history and profile', done: true },
  {
    name: 'Real AI generation through a Hugging Face Space',
    done: false,
    note: 'Needs server configuration - see docs/ai-integration.md',
  },
  { name: 'User accounts and sign-in', done: false, note: 'Guest mode only for now' },
  { name: 'Size recommendations from measurements', done: false, note: 'Not implemented' },
  { name: 'Live camera try-on', done: false, note: 'Planned for a later version' },
];

export function SettingsView() {
  const health = useHealth();
  const erase = useEraseAllData();
  const h = health.data;

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="Settings"
        description="How the app is running and how your data is handled."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" /> AI &amp; server status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {health.isLoading ? (
              <Spinner label="Checking server..." />
            ) : health.isError ? (
              <ErrorState error={health.error} onRetry={() => health.refetch()} />
            ) : h ? (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">AI provider</dt>
                  <dd className="mt-0.5 flex items-center gap-2 font-medium">
                    {h.ai.provider}
                    {h.ai.simulated ? (
                      <Badge variant="warning">Simulation - not real AI</Badge>
                    ) : h.ai.configured ? (
                      <Badge variant="success">Connected</Badge>
                    ) : (
                      <Badge variant="danger">Not configured</Badge>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Photos leave this server</dt>
                  <dd className="mt-0.5 font-medium">
                    {h.ai.externalProcessing
                      ? 'Yes - sent to an external AI service'
                      : 'No - processed locally'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Database</dt>
                  <dd className="mt-0.5 flex items-center gap-2 font-medium">
                    <Database className="size-4" />{' '}
                    {h.database === 'mongodb'
                      ? 'MongoDB'
                      : 'In-memory (resets when the server restarts)'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Limits</dt>
                  <dd className="mt-0.5 font-medium">
                    {h.limits.maxUploadMb} MB per image · results kept{' '}
                    {h.limits.resultRetentionHours} h
                  </dd>
                </div>
              </dl>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-accent" /> Privacy
            </CardTitle>
            <CardDescription>What happens to your photos.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Your photo is checked, stripped of metadata (such as GPS location) and processed in
                memory. The original is not saved on the server.
              </li>
              <li>
                Only the generated result is stored, and it is deleted automatically after{' '}
                {h?.limits.resultRetentionHours ?? 24} hours unless you save it to favorites.
              </li>
              <li>
                With a real AI provider your photo and the garment are sent to that third-party
                service (Hugging Face). You are asked for consent first.
              </li>
              <li>
                You can delete any result from History or Favorites, or erase everything below.
              </li>
              <li>
                This is a noncommercial university project; the underlying research models carry
                noncommercial licenses.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Feature status</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {FEATURES.map((f) => (
                <li key={f.name} className="flex items-start gap-3">
                  {f.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span>
                    {f.name}
                    {f.note && (
                      <span className="block text-xs text-muted-foreground">{f.note}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-danger/30">
          <CardHeader>
            <CardTitle className="text-danger">Erase my data</CardTitle>
            <CardDescription>
              Permanently deletes your profile, history, favorites, uploaded garments and all stored
              images for this browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <ConfirmButton
              onConfirm={() => erase.mutate()}
              disabled={erase.isPending}
              confirmLabel="Yes, erase everything"
            >
              <Trash2 /> {erase.isPending ? 'Erasing...' : 'Erase all my data'}
            </ConfirmButton>
            {erase.isSuccess && (
              <span role="status" className="text-sm text-success">
                All data erased.
              </span>
            )}
            {erase.isError && (
              <span role="alert" className="text-sm text-danger">
                {erase.error.message}
              </span>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
