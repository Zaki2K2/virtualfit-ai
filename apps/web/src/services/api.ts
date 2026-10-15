import type {
  ClothingCategory,
  ClothingItem,
  Favorite,
  HealthStatus,
  Profile,
  ProfileUpdateInput,
  TryOn,
} from '@virtualfit/shared';
import { apiRequest, jsonBody } from '@/lib/api-client';

export const api = {
  health: () => apiRequest<HealthStatus>('/health'),

  listClothing: (filter: { category?: ClothingCategory | 'all'; q?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.category && filter.category !== 'all') params.set('category', filter.category);
    if (filter.q?.trim()) params.set('q', filter.q.trim());
    const qs = params.toString();
    return apiRequest<{ items: ClothingItem[] }>(`/clothing${qs ? `?${qs}` : ''}`).then(
      (r) => r.items,
    );
  },
  createClothing: (form: FormData) =>
    apiRequest<{ item: ClothingItem }>('/clothing', { method: 'POST', body: form }).then(
      (r) => r.item,
    ),
  deleteClothing: (id: string) => apiRequest<void>(`/clothing/${id}`, { method: 'DELETE' }),

  createTryOn: (form: FormData) =>
    apiRequest<{ tryOn: TryOn }>('/try-on', { method: 'POST', body: form }).then((r) => r.tryOn),
  getTryOn: (id: string) => apiRequest<{ tryOn: TryOn }>(`/try-on/${id}`).then((r) => r.tryOn),

  listHistory: () => apiRequest<{ items: TryOn[] }>('/history').then((r) => r.items),
  deleteHistory: (id: string) => apiRequest<void>(`/history/${id}`, { method: 'DELETE' }),

  listFavorites: () => apiRequest<{ items: Favorite[] }>('/favorites').then((r) => r.items),
  addFavorite: (tryOnId: string) =>
    apiRequest<{ favorite: Favorite }>('/favorites', {
      method: 'POST',
      ...jsonBody({ tryOnId }),
    }).then((r) => r.favorite),
  removeFavorite: (id: string) => apiRequest<void>(`/favorites/${id}`, { method: 'DELETE' }),

  getProfile: () => apiRequest<{ profile: Profile }>('/profile').then((r) => r.profile),
  updateProfile: (input: ProfileUpdateInput) =>
    apiRequest<{ profile: Profile }>('/profile', { method: 'PATCH', ...jsonBody(input) }).then(
      (r) => r.profile,
    ),
  eraseAllData: () => apiRequest<void>('/profile', { method: 'DELETE' }),
};
