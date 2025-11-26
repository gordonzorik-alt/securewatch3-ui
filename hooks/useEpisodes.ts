'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchEpisodes } from '@/lib/api';

export function useEpisodes() {
  return useQuery({
    queryKey: ['episodes'],
    queryFn: () => fetchEpisodes(),
    refetchInterval: 5000, // Poll every 5 seconds
  });
}
