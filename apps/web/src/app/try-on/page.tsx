import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TryOnStudio } from '@/features/virtual-try-on/try-on-studio';

export const metadata: Metadata = { title: 'Try-On Studio' };

export default function TryOnPage() {
  return (
    <Suspense>
      <TryOnStudio />
    </Suspense>
  );
}
