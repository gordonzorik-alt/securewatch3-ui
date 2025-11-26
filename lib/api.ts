import { Video, Detection, Threat, Episode } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

export async function fetchVideos(): Promise<{ videos: Video[] }> {
  const response = await fetch(`${API_BASE}/api/videos`);
  if (!response.ok) {
    throw new Error('Failed to fetch videos');
  }
  return response.json();
}

export async function fetchDetections(limit: number = 500, videoId?: number): Promise<{ detections: Detection[], total: number }> {
  let url = `${API_BASE}/api/detections?limit=${limit}`;
  if (videoId) {
    url += `&video_id=${videoId}`;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch detections');
  }
  return response.json();
}

export async function uploadVideo(file: File): Promise<{ video: Video }> {
  const formData = new FormData();
  formData.append('video', file);

  const response = await fetch(`${API_BASE}/api/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Failed to upload video');
  }

  return response.json();
}

export async function startDetection(videoId: number, backend: 'yolo' | 'florence' | 'sam' | 'rfdetr' = 'yolo'): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/api/detect/${videoId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ backend }),
  });

  if (!response.ok) {
    throw new Error('Failed to start detection');
  }

  return response.json();
}

export async function fetchLlmSequence(
  detectionId: number,
  windowFrames: number = 30,
  maxSnapshots: number = 6
): Promise<{
  anchor_detection_id: number;
  video_id: number;
  snapshot_count: number;
  snapshots: {
    detection_id: number;
    frame_number: number;
    detected_at: string;
    confidence: number;
    snapshot_url: string;
  }[];
}> {
  const url = `${API_BASE}/api/llm-sequence/detection/${detectionId}?windowFrames=${windowFrames}&maxSnapshots=${maxSnapshots}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch LLM sequence');
  }
  return response.json();
}

export async function fetchThreats(limit: number = 50): Promise<{ threats: Threat[] }> {
  const response = await fetch(`${API_BASE}/api/threats?limit=${limit}`);
  if (!response.ok) {
    throw new Error('Failed to fetch threats');
  }
  return response.json();
}

export async function analyzeEpisode(detectionId: number, windowFrames: number = 60): Promise<any> {
  const response = await fetch(`${API_BASE}/api/analyze/episode/${detectionId}?windowFrames=${windowFrames}`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to analyze episode');
  }

  return response.json();
}

export async function fetchEpisodes(): Promise<{ episodes: Episode[] }> {
  const response = await fetch(`${API_BASE}/api/episodes`);
  if (!response.ok) {
    throw new Error('Failed to fetch episodes');
  }
  return response.json();
}

// Threat Analysis - using ThreatEpisodeSelector scoring
export interface ThreatEpisode {
  rank: number;
  id: string;
  videoId?: number;
  threatLevel: 'critical' | 'high' | 'medium' | 'low' | 'minimal';
  threatScore: number;
  timestamp: string;
  startTime?: number;  // Epoch ms - used for direct frame selection
  endTime?: number;    // Epoch ms - used for direct frame selection
  duration: string;
  keyframe: {
    imageUrl: string | null;
    frameNumber: number;
    detections: { label: string; confidence: string }[];
  };
  scoreBreakdown: {
    baseScore: number;
    interactionBonus: number;
    triggeredRules: string[];
  };
  objectsSeen: string[];
}

export interface ThreatAnalysisResponse {
  success: boolean;
  episodeCount: number;
  episodes: ThreatEpisode[];
  stats: {
    totalFrames: number;
    totalEpisodes: number;
    selectedEpisodes: number;
    scoreDistribution: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      minimal: number;
    };
    maxScore: number;
    avgScore: number;
  };
  metadata: {
    generatedAt: string;
    scorerConfig: {
      confidenceThreshold: number;
      classWeightsCount: number;
      interactionRulesCount: number;
      highThreatClasses: string[];
    };
  };
}

export async function fetchThreatAnalysis(
  limit: number = 10,
  videoId?: number,
  minScore: number = 0
): Promise<ThreatAnalysisResponse> {
  let url = `${API_BASE}/api/threats/analyze?limit=${limit}&min_score=${minScore}`;
  if (videoId) {
    url += `&video_id=${videoId}`;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch threat analysis');
  }
  return response.json();
}

// LLM Frame Selection Preview
export interface FrameSelectionPreview {
  success: boolean;
  episode: {
    id: string;
    duration: number;
    threat_score: number;
    threat_level: string;
    total_frames: number;
  };
  frame_selection: {
    count: number;
    frames: {
      frameNumber: number;
      reason: string;
      relativeTime: string;
      zone: string;
      imageUrl: string;
      detections: { label: string; confidence: number }[];
    }[];
  };
  context: {
    episodeDuration: string;
    objectsDetected: string[];
    movementPattern: string;
    zoneTransitions: number;
    dwellPoints: { zone: string; duration: string }[];
    threatIndicators: string[];
    narrativeSummary: string;
  };
}

export async function fetchLLMPreview(
  videoId?: number,
  maxFrames: number = 8,
  episodeRank: number = 1,
  startTime?: number,
  endTime?: number
): Promise<FrameSelectionPreview> {
  let url = `${API_BASE}/api/threats/llm-analyze/preview?max_frames=${maxFrames}&episode_rank=${episodeRank}`;
  if (videoId) {
    url += `&video_id=${videoId}`;
  }
  // Use direct time range selection if provided - this is more reliable than rank-based lookup
  if (startTime !== undefined && endTime !== undefined) {
    url += `&start_time=${startTime}&end_time=${endTime}`;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch LLM preview');
  }
  return response.json();
}

// LLM Threat Analysis Result - Context Triage format
export interface LLMAnalysisResult {
  success: boolean;
  threat_id: number;
  threat_assessment: {
    code: string;
    code_label: string;
    level: string;
    confidence: number;
    color: string;
  };
  // Context Triage assessment
  context_assessment?: {
    time_of_day: string;
    zone_type: string;
    vehicle_detected: string;
  };
  // Indicator arrays
  legitimacy_indicators?: string[];
  threat_indicators?: string[];
  // Analysis details
  analysis: {
    subject_behavior?: string;
    reasoning?: string;
    // Legacy fields for backwards compatibility
    subject_description?: string;
    movement_analysis?: string;
    behavioral_indicators?: string[];
    timeline_summary?: string;
    key_observations?: string[];
    uncertainty_factors?: string[];
  };
  recommended_action: string;
  episode_summary?: {
    id: string;
    duration: number;
    heuristic_score: number;
    heuristic_level: string;
    frames_in_episode: number;
    frames_sent_to_llm: number;
  };
  episode_context?: {
    duration: string;
    objects_detected: string[];
    movement_pattern: string;
    frames_analyzed: number;
  };
  frame_selection_reasons?: {
    frame: number;
    reason: string;
    time: string;
  }[];
}

// Fetch stored analysis by episode_id (returns null if none exists)
export interface StoredAnalysisResponse {
  success: boolean;
  found: boolean;
  episode_id: string;
  analysis: LLMAnalysisResult | null;
}

export async function fetchStoredAnalysis(episodeId: string): Promise<StoredAnalysisResponse> {
  const response = await fetch(`${API_BASE}/api/threats/episode/${encodeURIComponent(episodeId)}`);
  if (!response.ok) {
    throw new Error('Failed to fetch stored analysis');
  }
  return response.json();
}

export async function runLLMAnalysis(
  videoId?: number,
  maxFrames: number = 8,
  siteConfig?: { location?: string },
  episodeRank: number = 1
): Promise<LLMAnalysisResult> {
  const response = await fetch(`${API_BASE}/api/threats/llm-analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      video_id: videoId,
      max_frames: maxFrames,
      site_config: siteConfig || {},
      episode_rank: episodeRank,
    }),
  });
  if (!response.ok) {
    throw new Error('Failed to run LLM analysis');
  }
  return response.json();
}
