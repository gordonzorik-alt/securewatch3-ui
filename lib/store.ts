// lib/store.ts
import { create } from 'zustand';

export interface Detection {
  id: string;
  camera: string;
  class: string;
  score: number;
  file: string;
  time: string;
  imageUrl?: string; // v3: Direct S3 URL
  url?: string;      // v3 alt field
}

export interface EpisodeDetection {
  id?: string | number;
  imageUrl?: string;
  snapshot_url?: string;
  image?: string;
  thumbnail?: string;
  timestamp?: string;
  confidence?: number;
  class?: string;
}

export interface Episode {
  id: string;
  camera_id: string;
  start_time: string;
  end_time?: string;
  keyframe?: { imageUrl: string };
  thumbnail_url?: string; // Direct thumbnail URL from backend
  detection_count?: number; // Number of detections in this episode
  detections?: EpisodeDetection[]; // Array of detections for filmstrip
  best_confidence?: number;
  primary_class?: string;
  source?: 'live' | 'upload';
  threat_assessment?: {
    level: string;
    code: string;
    code_label?: string;
    confidence: number;
  };
  analysis?: {
    subject_description?: string;
    subject_behavior?: string;
    reasoning?: string;
    full_report?: string;
  };
  // Full analysis metadata from Gemini
  frames_analyzed?: number;
  analysis_time_ms?: number;
  model?: string;
}

interface SecurityStore {
  // Data State
  detections: Detection[];
  episodes: Record<string, Episode>; // Map for fast updates by ID
  isSocketConnected: boolean;

  // Actions
  setSocketConnected: (status: boolean) => void;
  addDetection: (det: Detection) => void;
  addEpisode: (ep: Episode) => void;
  updateEpisode: (id: string, data: Partial<Episode>) => void;
}

export const useSecurityStore = create<SecurityStore>((set) => ({
  detections: [],
  episodes: {},
  isSocketConnected: false,

  setSocketConnected: (status) => set({ isSocketConnected: status }),

  // Add new detection to the ticker (Limit to 20 items)
  addDetection: (det) => set((state) => {
    // Avoid duplicates
    if (state.detections.some(d => d.id === det.id)) return state;
    return { detections: [det, ...state.detections].slice(0, 20) };
  }),

  // Add or overwrite an episode
  addEpisode: (ep) => set((state) => ({
    episodes: { ...state.episodes, [ep.id]: ep }
  })),

  // Merge new analysis data into an existing episode (Fixes the "Pop-in" effect)
  updateEpisode: (id, data) => set((state) => {
    const existing = state.episodes[id];
    if (!existing) return state;
    return {
      episodes: {
        ...state.episodes,
        [id]: { ...existing, ...data }
      }
    };
  })
}));
