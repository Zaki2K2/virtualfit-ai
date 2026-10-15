import type { Metadata } from 'next';
import { FavoritesView } from '@/features/favorites/favorites-view';

export const metadata: Metadata = { title: 'Favorites' };

export default function FavoritesPage() {
  return <FavoritesView />;
}
