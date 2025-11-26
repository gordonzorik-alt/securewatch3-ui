export interface Video {
  id: number;
  filename: string;
  path: string;
  size: number;
  uploaded_at: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
}

export interface Detection {
  id: number;
  video_id: number;
  frame_number: number;
  object_class: string;
  confidence: number;
  bbox: [number, number, number, number];
  detected_at: string;
  snapshot_path?: string | null;
  engine?: 'yolo' | 'florence';
  track_id?: number | null;
}

export interface Threat {
  id: number;
  detection_id: number;
  video_id: number;
  start_time: string;
  end_time: string;
  detection_count: number;
  snapshot_count: number;
  snapshots?: Array<{
    detection_id: number;
    frame_number: number;
    confidence: number;
    snapshot_path: string;
  }>;
  threat_report: string;
  timeline: string;
  analysis_model?: string;
  analyzed_at: string;
}

export interface AnalyticsEvent {
  id: number;
  event_type: string;
  zone_id: string | null;
  camera_id: string;
  video_id: number;
  track_id: string | null;
  object_class: string;
  confidence: number;
  start_time: string;
  end_time: string | null;
  duration_sec: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface Zone {
  id: string;
  camera_id: string;
  name: string;
  type: 'restricted' | 'monitored' | 'tripwire' | 'package_zone';
  polygon?: number[][] | null;
  line?: number[][] | null;
  rules: {
    loitering_threshold_sec?: number;
    allowed_classes?: string[];
    alert_on_entry?: boolean;
    direction?: 'inbound' | 'outbound' | 'both';
    min_confidence?: number;
    detect_object_changes?: boolean;
    min_dwell_time_sec?: number;
  };
  active: boolean;
}

export interface Episode {
  id: string;
  video_id: number;
  start_time: string;
  end_time: string;
  duration_sec: number;
  frame_count: number;
  detection_ids: number[];
  object_counts: Record<string, number>;
  best_snapshot: {
    path: string;
    confidence: number;
    label: string;
    detection_id: number;
    frame_number: number;
    bounding_box?: [number, number, number, number];
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
