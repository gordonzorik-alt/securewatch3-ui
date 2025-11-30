'use client';

import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  Camera,
  Clock,
  User,
  AlertTriangle,
  Phone,
  Radio,
  Eye,
  ChevronRight,
  Zap,
  MapPin,
  Activity
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
  timestamp?: string;
  time?: string;
  label?: string;
  confidence?: number;
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
    fetch(`${API_BASE}/api/episodes/${episode.id}/details`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.detections) {
          setFrames(data.detections);
          if (data.detections.length > 0) {
            setSelectedFrame(data.detections[0]);
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [episode.id]);

  const threatLevel = episode.threat_assessment?.level || 'LOW';
  const threatCode = episode.threat_assessment?.code || 'UNK';
  const confidence = episode.threat_assessment?.confidence || 0;
  const colors = getThreatColors(threatLevel);

  const title = THREAT_LABELS[threatCode] || threatCode;
  const description = episode.analysis?.subject_description || 'Activity detected on camera';
  const behavior = episode.analysis?.subject_behavior || '';

  const getImageUrl = (det: Detection): string => {
    return det.imageUrl || det.image_path || det.snapshot_path || '';
  };

  return (
    <div className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden shadow-lg ${colors.glow}`}>
      {/* Header */}
      <div className="p-4 border-b border-gray-700/50">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${colors.bg} ${colors.border} border`}>
              <ShieldAlert className={`w-6 h-6 ${colors.text}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white">{title}</h3>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${colors.bg} ${colors.text} border ${colors.border}`}>
                  {threatLevel}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-0.5">{description}</p>
            </div>
          </div>

          {/* Confidence Badge */}
          <div className="text-right">
            <div className="flex items-center gap-1 text-gray-400">
              <Activity className="w-4 h-4" />
              <span className="text-sm">Confidence</span>
            </div>
            <span className={`text-2xl font-bold ${colors.text}`}>
              {Math.round(confidence * 100)}%
            </span>
          </div>
        </div>

        {/* Metadata Row */}
        <div className="flex items-center gap-6 mt-4 text-sm text-gray-400">
          <div className="flex items-center gap-1.5">
            <Camera className="w-4 h-4" />
            <span>{episode.camera_id?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            <span>{formatTimestamp(episode.start_time)}</span>
          </div>
          {episode.frames_analyzed && (
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4" />
              <span>{episode.frames_analyzed} frames analyzed</span>
            </div>
          )}
          {episode.analysis_time_ms && (
            <div className="flex items-center gap-1.5">
              <Activity className="w-4 h-4" />
              <span>{episode.analysis_time_ms}ms</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        {/* Left: Evidence Section */}
        <div className="space-y-4">
          {/* Selected Frame (Large) */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Primary Evidence
            </h4>
            <div className="aspect-video bg-black rounded-lg overflow-hidden relative">
              {selectedFrame ? (
                <img
                  src={getImageUrl(selectedFrame)}
                  alt="Selected frame"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600">
                  No frame selected
                </div>
              )}
              {selectedFrame && (
                <div className="absolute bottom-2 left-2 right-2 flex justify-between items-end">
                  <div className="bg-black/70 px-2 py-1 rounded text-xs text-white">
                    {formatTimestamp(selectedFrame.timestamp || selectedFrame.time || '')}
                  </div>
                  {selectedFrame.confidence && (
                    <div className="bg-green-600/80 px-2 py-1 rounded text-xs text-white font-medium">
                      {selectedFrame.label || 'person'} {Math.round(selectedFrame.confidence * 100)}%
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Frame Filmstrip */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Trigger Sequence ({frames.length} frames)
            </h4>
            {loading ? (
              <div className="h-20 bg-gray-800 rounded-lg animate-pulse flex items-center justify-center text-gray-600">
                Loading frames...
              </div>
            ) : frames.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-700">
                {frames.slice(0, 12).map((frame, idx) => (
                  <div
                    key={frame.id || idx}
                    onClick={() => setSelectedFrame(frame)}
                    className={`flex-shrink-0 w-24 h-16 rounded-md overflow-hidden cursor-pointer transition-all ${
                      selectedFrame?.id === frame.id
                        ? 'ring-2 ring-blue-500 scale-105'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={getImageUrl(frame)}
                      alt={`Frame ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
                {frames.length > 12 && (
                  <div className="flex-shrink-0 w-24 h-16 rounded-md bg-gray-800 flex items-center justify-center text-gray-500 text-xs">
                    +{frames.length - 12} more
                  </div>
                )}
              </div>
            ) : (
              <div className="h-20 bg-gray-800/50 rounded-lg flex items-center justify-center text-gray-600 text-sm">
                No frames available
              </div>
            )}
          </div>
        </div>

        {/* Right: Live View + Analysis */}
        <div className="space-y-4">
          {/* Live Camera Feed */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Radio className="w-4 h-4 animate-pulse text-red-500" />
              Live View
            </h4>
            <div className="aspect-video bg-black rounded-lg overflow-hidden relative">
              <HLSPlayer
                src={`${STREAM_BASE}/${episode.camera_id}/index.m3u8`}
                className="w-full h-full"
              />
              <div className="absolute top-2 left-2 bg-red-600/80 px-2 py-0.5 rounded text-xs text-white font-medium flex items-center gap-1">
                <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                LIVE
              </div>
            </div>
          </div>

          {/* AI Analysis - Show full_report if available, otherwise behavior */}
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              AI Threat Analysis
            </h4>
            {episode.analysis?.full_report ? (
              <div className="font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                {episode.analysis.full_report}
              </div>
            ) : behavior ? (
              <p className="text-sm text-gray-300 leading-relaxed">{behavior}</p>
            ) : (
              <p className="text-sm text-gray-500 italic">No detailed analysis available.</p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium text-white transition-colors">
              <User className="w-4 h-4" />
              Mark as Known
            </button>
            <button className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium text-white transition-colors">
              <MapPin className="w-4 h-4" />
              View on Map
            </button>
            <button className="flex items-center justify-center gap-2 px-4 py-3 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium text-white transition-colors">
              <AlertTriangle className="w-4 h-4" />
              Flag Suspicious
            </button>
            <button className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium text-white transition-colors">
              <Phone className="w-4 h-4" />
              Call 911
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-700/50 flex items-center justify-between">
        <div className="text-xs text-gray-500">
          Episode ID: {episode.id}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
          >
            Collapse <ChevronRight className="w-3 h-3 rotate-90" />
          </button>
        )}
      </div>
    </div>
  );
}
