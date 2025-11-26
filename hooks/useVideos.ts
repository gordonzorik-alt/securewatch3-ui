'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchVideos } from '@/lib/api';

export function useVideos() {
  return useQuery({
    queryKey: ['videos'],
    queryFn: fetchVideos,
    refetchInterval: 5000, // Poll every 5 seconds
  });
}
