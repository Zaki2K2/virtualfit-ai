import type { Metadata } from 'next';
import { WardrobeView } from '@/features/wardrobe/wardrobe-view';

export const metadata: Metadata = { title: 'Wardrobe' };

export default function WardrobePage() {
  return <WardrobeView />;
}
