'use client';

import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  Camera,
  Clock,
  Radio,
  Eye,
  ChevronRight,
  ChevronLeft,
  Zap,
  Activity,
  X
} from 'lucide-react';
import HLSPlayer from './HLSPlayer';
import { Episode } from '@/lib/store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';
const STREAM_BASE = 'http://136.119.129.106:8888';

interface Detection {
  id: string;
  imageUrl?: string;
  image_path?: string;
  snapshot_path?: string;
  snapshot_url?: string;
  image?: string;
  thumbnail?: string;
  timestamp?: string;
  time?: string;
  label?: string;
  confidence?: number;
  class?: string;
}

// Threat code to human-readable labels
const THREAT_LABELS: Record<string, string> = {
  'PKG': 'Package Delivery',
  'DPH': 'Delivery Person',
  'UNK': 'Unknown Person',
  'VEH': 'Vehicle Activity',
  'FAM': 'Known Person',
  'SUS': 'Suspicious Activity',
  'ANM': 'Animal Detected',
};

// Format timestamp to LA time
function formatTimestamp(ts: string): string {
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'America/Los_Angeles'
    });
  } catch {
    return 'Unknown';
  }
}

// Get threat level color classes
function getThreatColors(level: string): { bg: string; text: string; border: string; glow: string } {
  switch (level?.toUpperCase()) {
    case 'HIGH':
      return {
        bg: 'bg-red-900/30',
        text: 'text-red-400',
        border: 'border-red-500/50',
        glow: 'shadow-red-500/20'
      };
    case 'MEDIUM':
      return {
        bg: 'bg-amber-900/30',
        text: 'text-amber-400',
        border: 'border-amber-500/50',
        glow: 'shadow-amber-500/20'
      };
    default:
      return {
        bg: 'bg-blue-900/30',
        text: 'text-blue-400',
        border: 'border-blue-500/50',
        glow: 'shadow-blue-500/20'
      };
  }
}

export default function EpisodeExpandedView({ episode, onClose }: { episode: Episode; onClose?: () => void }) {
  const [frames, setFrames] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFrame, setSelectedFrame] = useState<Detection | null>(null);

  useEffect(() => {
    // For live episodes, use detections directly from the episode object
    if (episode.detections && episode.detections.length > 0) {
      const localFrames: Detection[] = episode.detections.slice(0, 10).map((det, idx) => ({
        id: String(det.id || idx),
        imageUrl: det.imageUrl,
        snapshot_url: det.snapshot_url,
        image: det.image,
        thumbnail: det.thumbnail,
        timestamp: det.timestamp,
        confidence: det.confidence,
        label: det.class
      }));
      setFrames(localFrames);
      if (localFrames.length > 0) {
        setSelectedFrame(localFrames[0]);
      }
      setLoading(false);
      return;
    }

    // For persisted episodes, fetch from API
    fetch(`${API_BASE}/api/episodes/${episode.id}/details`)
      .then(res => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(data => {
        if (data.success && data.detections) {
          setFrames(data.detections);
          if (data.detections.length > 0) {
            setSelectedFrame(data.detections[0]);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        // Handle 404 gracefully - the endpoint may not exist on this server
        setLoading(false);
      });
  }, [episode.id, episode.detections]);

  const threatLevel = episode.threat_assessment?.level || 'LOW';
  const threatCode = episode.threat_assessment?.code || 'UNK';
  const confidence = episode.threat_assessment?.confidence || 0;
  const colors = getThreatColors(threatLevel);

  const title = THREAT_LABELS[threatCode] || threatCode;
  const description = episode.analysis?.subject_description || 'Activity detected on camera';
  const behavior = episode.analysis?.subject_behavior || '';

  const getImageUrl = (det: Detection): string => {
    // Handle various URL formats from different sources
    let url = '';
    if (det.imageUrl) url = det.imageUrl;
    else if (det.snapshot_url) url = det.snapshot_url;
    else if (det.image) url = det.image;
    else if (det.thumbnail) url = det.thumbnail;
    else if (det.image_path) url = det.image_path;
    else if (det.snapshot_path) url = det.snapshot_path;

    if (!url) return '';
    // Prepend API_BASE if it's a relative path
    if (url.startsWith('/')) return `${API_BASE}${url}`;
    if (url.startsWith('http')) return url;
    return `${API_BASE}/${url}`;
  };

  return (
    <div className="rounded-3xl bg-gray-800 overflow-hidden shadow-2xl shadow-black/50">
      {/* Centered Header */}
      <div className="relative px-6 pt-6 pb-4">
        {/* Close Button - Top Right */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-gray-900/50 hover:bg-gray-700 transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        )}

        {/* Centered Title Block */}
        <div className="text-center">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className={`p-2.5 rounded-2xl ${colors.bg}`}>
              <ShieldAlert className={`w-6 h-6 ${colors.text}`} />
            </div>
            <h2 className="text-2xl font-bold text-white">{title}</h2>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${colors.bg} ${colors.text}`}>
              {threatLevel}
            </span>
          </div>
          <p className="text-sm text-gray-400 max-w-md mx-auto">{description}</p>
        </div>

        {/* Centered Metadata Row */}
        <div className="flex items-center justify-center gap-6 mt-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <div className="flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5 text-blue-500" />
            <span>{episode.camera_id?.replace(/_/g, ' ')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-500" />
            <span>{formatTimestamp(episode.start_time)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-blue-500" />
            <span>{Math.round(confidence * 100)}%</span>
          </div>
          {episode.frames_analyzed && (
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-blue-500" />
              <span>{episode.frames_analyzed} frames</span>
            </div>
          )}
        </div>
      </div>

      {/* Twin Windows - Side by Side */}
      <div className="px-6 pb-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Left: Recorded Evidence */}
          <div className="flex-1">
            <div className="aspect-video bg-gray-900 rounded-2xl overflow-hidden relative shadow-lg">
              {selectedFrame ? (
                <img
                  src={getImageUrl(selectedFrame)}
                  alt="Evidence"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600">
                  <Eye className="w-8 h-8" />
                </div>
              )}
              {/* Overlay Badge - Bottom Left */}
              <div className="absolute bottom-3 left-3 flex items-center gap-2">
                <div className="bg-gray-900/80 backdrop-blur px-2.5 py-1 rounded-lg text-xs text-white flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-blue-400" />
                  {formatTimestamp(selectedFrame?.timestamp || selectedFrame?.time || '')}
                </div>
                {selectedFrame?.confidence && (
                  <div className="bg-green-900/80 backdrop-blur px-2.5 py-1 rounded-lg text-xs text-green-400 font-medium">
                    {Math.round(selectedFrame.confidence * 100)}%
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Live Feed */}
          <div className="flex-1">
            <div className="aspect-video bg-gray-900 rounded-2xl overflow-hidden relative shadow-lg">
              <HLSPlayer
                src={`${STREAM_BASE}/${episode.camera_id}/index.m3u8`}
                className="w-full h-full"
              />
              {/* Live Badge - Top Left */}
              <div className="absolute top-3 left-3 bg-red-900/80 backdrop-blur px-2.5 py-1 rounded-lg text-xs text-red-400 font-medium flex items-center gap-1.5">
                <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                LIVE
              </div>
              {/* Camera Icon - Bottom Right */}
              <div className="absolute bottom-3 right-3 bg-gray-900/80 backdrop-blur p-2 rounded-lg">
                <Radio className="w-4 h-4 text-red-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Centered Timeline Filmstrip */}
      <div className="px-6 pb-4">
        <div className="flex items-center justify-center gap-3">
          {/* Left Arrow */}
          <button
            onClick={() => {
              const currentIdx = frames.findIndex(f => f.id === selectedFrame?.id);
              if (currentIdx > 0) {
                setSelectedFrame(frames[currentIdx - 1]);
              }
            }}
            disabled={frames.findIndex(f => f.id === selectedFrame?.id) <= 0}
            className="flex-shrink-0 p-2.5 rounded-xl bg-gray-900 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>

          {/* Filmstrip */}
          {loading ? (
            <div className="flex gap-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="w-20 h-14 rounded-xl bg-gray-900 animate-pulse" />
              ))}
            </div>
          ) : frames.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto py-1 scrollbar-thin scrollbar-thumb-gray-700">
              {frames.slice(0, 8).map((frame, idx) => (
                <div
                  key={frame.id || idx}
                  onClick={() => setSelectedFrame(frame)}
                  className={`flex-shrink-0 w-20 h-14 rounded-xl overflow-hidden cursor-pointer transition-all ${
                    selectedFrame?.id === frame.id
                      ? 'ring-2 ring-blue-500 scale-105 shadow-lg shadow-blue-500/20'
                      : 'opacity-60 hover:opacity-100 hover:scale-102'
                  }`}
                >
                  <img
                    src={getImageUrl(frame)}
                    alt={`Frame ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
              {frames.length > 8 && (
                <div className="flex-shrink-0 w-20 h-14 rounded-xl bg-gray-900 flex items-center justify-center text-gray-500 text-xs font-medium">
                  +{frames.length - 8}
                </div>
              )}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">No frames</div>
          )}

          {/* Right Arrow */}
          <button
            onClick={() => {
              const currentIdx = frames.findIndex(f => f.id === selectedFrame?.id);
              if (currentIdx < frames.length - 1) {
                setSelectedFrame(frames[currentIdx + 1]);
              }
            }}
            disabled={frames.findIndex(f => f.id === selectedFrame?.id) >= frames.length - 1}
            className="flex-shrink-0 p-2.5 rounded-xl bg-gray-900 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
        </div>
      </div>

      {/* AI Analysis Box */}
      <div className="px-6 pb-4">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-gray-900/80 to-gray-900/40 border border-gray-700/30">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg bg-blue-500/20">
              <Zap className="w-3.5 h-3.5 text-blue-400" />
            </div>
            <span className="text-xs font-medium text-gray-400">AI Analysis</span>
          </div>
          {episode.analysis?.full_report ? (
            <div className="text-sm text-gray-200 leading-relaxed max-h-48 overflow-y-auto space-y-3">
              {episode.analysis.full_report.split('\n\n').map((paragraph: string, idx: number) => {
                const trimmed = paragraph.trim();
                if (!trimmed || trimmed.match(/^[═━─]+$/)) return null;
                const isHeader = (trimmed.startsWith('Threat Level:') || trimmed.startsWith('Classification:') || trimmed.startsWith('Recommended Action:'));
                return (
                  <p key={idx} className={isHeader ? 'text-xs text-blue-400 font-medium' : ''}>
                    {trimmed}
                  </p>
                );
              })}
            </div>
          ) : behavior ? (
            <p className="text-sm text-gray-200 leading-relaxed">{behavior}</p>
          ) : (
            <p className="text-sm text-gray-500 italic text-center">No analysis available</p>
          )}
        </div>
      </div>

      {/* Centered Action Bar */}
      <div className="px-6 pb-6">
        <div className="flex items-center justify-center gap-3">
          <button className="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-700 border border-gray-700 text-sm font-medium text-gray-300 transition-colors">
            Continue Monitoring
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-8 py-2.5 rounded-xl bg-green-900/30 hover:bg-green-900/50 border border-green-500/30 text-sm font-medium text-green-400 transition-colors"
            >
              Dismiss
            </button>
          )}
        </div>
        <div className="text-center mt-3 text-xs text-gray-600">
          {episode.id}
        </div>
      </div>
    </div>
  );
}
