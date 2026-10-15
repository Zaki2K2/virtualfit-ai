'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClothingCategory, ProfileUpdateInput } from '@virtualfit/shared';
import { api } from '@/services/api';

export const keys = {
  health: ['health'] as const,
  clothing: (category: string, q: string) => ['clothing', category, q] as const,
  history: ['history'] as const,
  favorites: ['favorites'] as const,
  profile: ['profile'] as const,
};

export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: api.health, staleTime: 60_000 });

export const useClothing = (category: ClothingCategory | 'all', q: string) =>
  useQuery({
    queryKey: keys.clothing(category, q),
    queryFn: () => api.listClothing({ category, q }),
  });

export const useDeleteClothing = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteClothing,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clothing'] }),
  });
};

export const useHistory = () => useQuery({ queryKey: keys.history, queryFn: api.listHistory });

export const useDeleteHistory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteHistory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.history });
      qc.invalidateQueries({ queryKey: keys.favorites });
    },
  });
};

export const useFavorites = () =>
  useQuery({ queryKey: keys.favorites, queryFn: api.listFavorites });

export const useAddFavorite = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.addFavorite,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.favorites }),
  });
};

export const useRemoveFavorite = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.removeFavorite,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.favorites }),
  });
};

export const useProfile = () => useQuery({ queryKey: keys.profile, queryFn: api.getProfile });

export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileUpdateInput) => api.updateProfile(input),
    onSuccess: (profile) => qc.setQueryData(keys.profile, profile),
  });
};

export const useEraseAllData = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.eraseAllData, onSuccess: () => qc.invalidateQueries() });
};
