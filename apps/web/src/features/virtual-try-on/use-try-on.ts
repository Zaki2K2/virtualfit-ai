'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClothingCategory, TryOn } from '@virtualfit/shared';
import { keys } from '@/hooks/use-api';
import { api } from '@/services/api';

export type GarmentSelection = { kind: 'catalog'; id: string } | { kind: 'upload'; file: File };

export interface GenerateInput {
  person: File;
  garment: GarmentSelection;
  category: ClothingCategory;
  consent: boolean;
}

/**
 * Starts a try-on job and polls it until it finishes. The server keeps nothing but the result image,
 * so the original photo for the before/after view stays in the browser.
 */
export function useTryOn() {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const create = useMutation({
    mutationFn: ({ person, garment, category, consent }: GenerateInput) => {
      const form = new FormData();
      form.append('category', category);
      form.append('consent', String(consent));
      form.append('person', person);
      if (garment.kind === 'catalog') form.append('clothingId', garment.id);
      else form.append('garment', garment.file);
      return api.createTryOn(form);
    },
    onMutate: () => {
      setJobId(null);
      setStartedAt(Date.now());
      setElapsed(0);
    },
    onSuccess: (tryOn) => {
      qc.setQueryData(['try-on', tryOn.id], tryOn);
      setJobId(tryOn.id);
    },
  });

  const poll = useQuery({
    queryKey: ['try-on', jobId],
    queryFn: () => api.getTryOn(jobId as string),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 1500 : false),
    retry: 2,
  });

  const tryOn: TryOn | null = poll.data ?? null;
  const processing = create.isPending || (!!jobId && (!tryOn || tryOn.status === 'processing'));

  const finished = useRef(false);
  useEffect(() => {
    if (tryOn?.status === 'completed' && !finished.current) {
      finished.current = true;
      qc.invalidateQueries({ queryKey: keys.history });
    }
    if (tryOn?.status === 'processing') finished.current = false;
  }, [tryOn?.status, qc]);

  useEffect(() => {
    if (!processing || !startedAt) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [processing, startedAt]);

  const reset = () => {
    create.reset();
    setJobId(null);
    setStartedAt(null);
    setElapsed(0);
  };

  return {
    generate: create.mutate,
    reset,
    processing,
    elapsed,
    tryOn,
    /** Request-level failure (validation, consent, rate limit...) before a job existed. */
    requestError: create.error,
    pollError: poll.error,
  };
}
