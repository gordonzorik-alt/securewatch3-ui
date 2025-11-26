'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchDetections } from '@/lib/api';

export function useDetections(limit: number = 500, videoId?: number) {
  return useQuery({
    queryKey: ['detections', limit, videoId],
    queryFn: () => fetchDetections(limit, videoId),
    refetchInterval: 5000, // Poll every 5 seconds
  });
}
