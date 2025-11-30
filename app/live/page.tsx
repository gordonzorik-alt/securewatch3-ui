'use client';

import React, { useMemo, useState, useEffect } from 'react';
import SocketManager from '@/components/SocketManager';
import { useSecurityStore, Episode } from '@/lib/store';
import DetectionTicker from '@/components/DetectionTicker';
import HLSPlayer from '@/components/HLSPlayer';
import EpisodeExpandedView from '@/components/EpisodeExpandedView';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';
const STREAM_BASE = 'http://136.119.129.106:8888'; // HLS streams on port 8888

// Format episode timestamp with date and time
function formatEpisodeTime(ep: { end_time?: string; start_time?: string }): string {
  const timestamp = ep.end_time || ep.start_time;
  if (!timestamp) return 'Unknown time';

  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Unknown time';

    // Format: "Nov 29, 3:45:23 PM"
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch {
    return 'Unknown time';
  }
}

// Generate intelligent headline from threat code and analysis
function getIntelligentHeadline(ep: {
  threat_assessment?: { code: string; level: string };
  analysis?: { subject_description: string };
  camera_id: string;
}): string {
  const code = ep.threat_assessment?.code;
  const description = ep.analysis?.subject_description;

  // If we have a description, use it as the headline
  if (description && description !== 'Activity detected') {
    // Truncate long descriptions
    return description.length > 60 ? description.slice(0, 57) + '...' : description;
  }

  // Fallback: Generate headline from threat code
  const codeHeadlines: Record<string, string> = {
    'PKG': 'Package Delivery Detected',
    'DPH': 'Delivery/Service Person',
    'UNK': 'Unknown Person Detected',
    'VEH': 'Vehicle Activity',
    'FAM': 'Family Member',
    'SUS': 'Suspicious Activity',
    'ANM': 'Animal Detected',
  };

  if (code && codeHeadlines[code]) {
    return codeHeadlines[code];
  }

  return code || 'Motion Detected';
}

// Thumbnail component that fetches first detection for episode
function EpisodeThumbnail({ episodeId }: { episodeId: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/episodes/${episodeId}/details`)
      .then(res => {
        if (!res.ok) throw new Error('Not found');
        return res.json();
      })
      .then(data => {
        if (data.success && data.detections?.length > 0) {
          setImageUrl(data.detections[0].imageUrl);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true));
  }, [episodeId]);

  if (error) {
    return <div className="w-full h-full bg-gray-700 flex items-center justify-center text-gray-500 text-xs">No preview</div>;
  }

  if (!imageUrl) {
    return <div className="w-full h-full bg-gray-700 flex items-center justify-center text-gray-500 text-xs animate-pulse">Loading...</div>;
  }

  return <img src={imageUrl} className="w-full h-full object-cover" alt="Episode thumbnail" />;
}

// Camera configuration
const CAMERAS = [
  { id: 'front_door', label: 'Front Door' },
  { id: 'camera_2', label: 'Front Yard' },
  { id: 'camera_3', label: 'Backyard Door' },
  { id: 'camera_4', label: 'Camera 4' },
  { id: 'camera_5', label: 'Camera 5' },
];

export default function LiveDashboardV2() {
  // Hydration safety: don't render store data on server
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  // View mode: 'single' or 'grid'
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');
  const [selectedCamera, setSelectedCamera] = useState(CAMERAS[0]);

  // Fetch initial episodes from API on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/episodes`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.episodes) {
          // Add each episode to the store (limit to recent 20)
          const recentEpisodes = data.episodes.slice(0, 20);
          recentEpisodes.forEach((ep: Record<string, unknown>) => {
            // Parse analysis_json if it's a string (from database)
            let parsedAnalysis: {
              threat_assessment?: Episode['threat_assessment'];
              analysis?: Episode['analysis'];
              full_report?: string;
              frames_analyzed?: number;
              model?: string
            } = {};
            if (ep.analysis_json && typeof ep.analysis_json === 'string') {
              try {
                parsedAnalysis = JSON.parse(ep.analysis_json);
              } catch {
                // Invalid JSON, ignore
              }
            }

            // Merge full_report into analysis object if present
            const analysisWithReport = {
              ...(parsedAnalysis.analysis || ep.analysis as Episode['analysis'] || {}),
              full_report: parsedAnalysis.full_report
            };

            useSecurityStore.getState().addEpisode({
              id: ep.id as string,
              camera_id: ep.camera_id as string,
              start_time: ep.start_time as string,
              end_time: ep.end_time as string,
              // Include persisted analysis data (from parsed analysis_json or direct properties)
              threat_assessment: parsedAnalysis.threat_assessment || ep.threat_assessment as Episode['threat_assessment'],
              analysis: analysisWithReport as Episode['analysis'],
              frames_analyzed: parsedAnalysis.frames_analyzed || ep.frames_analyzed as number,
              analysis_time_ms: ep.analysis_time_ms as number,
              model: parsedAnalysis.model || ep.model as string,
            });
          });
        }
      })
      .catch(err => console.error('[LiveDashboard] Failed to fetch episodes:', err));
  }, []);

  // Expanded episode state (inline expansion instead of modal)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (episodeId: string) => {
    setExpandedId(prev => prev === episodeId ? null : episodeId);
  };

  // Get raw episodes object from store
  const episodesMap = useSecurityStore((state) => state.episodes);
  const isConnected = useSecurityStore((state) => state.isSocketConnected);

  // Memoize the sorted array with bulletproof date handling
  const episodes = useMemo(() => {
    return Object.values(episodesMap).sort((a, b) => {
      // Safety: Handle missing dates (Default to 0)
      const timeA = new Date(a.start_time || 0).getTime();
      const timeB = new Date(b.start_time || 0).getTime();

      // Safety: Handle "Invalid Date" strings (NaN)
      const validA = isNaN(timeA) ? 0 : timeA;
      const validB = isNaN(timeB) ? 0 : timeB;

      // Sort DESCENDING (Newest first)
      return validB - validA;
    });
  }, [episodesMap]);

  // Server-side: show loading state
  if (!isMounted) {
    return (
      <main className="min-h-screen bg-gray-900 text-white p-6">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">SecureWatch v3.0</h1>
          <div className="px-3 py-1 rounded-full text-xs bg-gray-700 text-gray-400">Loading...</div>
        </div>
        <div className="text-center py-20 text-gray-500">Initializing...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-900 text-white p-6">
      <SocketManager /> {/* The Data Engine */}


      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">SecureWatch v3.0</h1>
        <div className={`px-3 py-1 rounded-full text-xs ${isConnected ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
          {isConnected ? 'System Online' : 'Disconnected'}
        </div>
      </div>

      {/* 1. Video Section - Single or Grid View */}
      <div className="mb-8">
        {/* View Toggle & Camera Selector */}
        <div className="flex items-center justify-between mb-4">
          {/* Camera selector buttons (only in single view) */}
          {viewMode === 'single' && (
            <div className="flex gap-2 flex-wrap">
              {CAMERAS.map(cam => (
                <button
                  key={cam.id}
                  onClick={() => setSelectedCamera(cam)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    selectedCamera.id === cam.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {cam.label}
                </button>
              ))}
            </div>
          )}
          {viewMode === 'grid' && <div />}

          {/* View mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('single')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1 ${
                viewMode === 'single'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2"/>
              </svg>
              Single
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1 ${
                viewMode === 'grid'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" strokeWidth="2"/>
                <rect x="14" y="3" width="7" height="7" strokeWidth="2"/>
                <rect x="3" y="14" width="7" height="7" strokeWidth="2"/>
                <rect x="14" y="14" width="7" height="7" strokeWidth="2"/>
              </svg>
              Grid
            </button>
          </div>
        </div>

        {/* Single Large View */}
        {viewMode === 'single' && (
          <div className="aspect-video bg-black rounded-lg overflow-hidden border border-gray-800 relative max-w-5xl mx-auto">
            <HLSPlayer
              key={selectedCamera.id}
              src={`${STREAM_BASE}/${selectedCamera.id}/index.m3u8`}
              className="w-full h-full"
            />
            <div className="absolute bottom-3 left-3 bg-black/70 px-3 py-1.5 text-sm rounded font-medium">
              {selectedCamera.label}
            </div>
          </div>
        )}

        {/* Grid View */}
        {viewMode === 'grid' && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {CAMERAS.map(cam => (
              <div
                key={cam.id}
                onClick={() => { setSelectedCamera(cam); setViewMode('single'); }}
                className="aspect-video bg-black rounded-lg overflow-hidden border border-gray-800 relative cursor-pointer hover:border-blue-500 transition-colors"
              >
                <HLSPlayer
                  src={`${STREAM_BASE}/${cam.id}/index.m3u8`}
                  className="w-full h-full"
                />
                <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-1 text-xs rounded">{cam.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. The Ticker (Reads from Store) */}
      <div className="mb-8">
        <h2 className="text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Live AI Detection Stream</h2>
        <DetectionTicker />
      </div>

      {/* 3. The Episodes (Reads from Store) */}
      <div>
        <h2 className="text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Intelligence Feed</h2>
        <div className="grid gap-4">
          {episodes.map(ep => (
            <div key={ep.id} className="space-y-3">
              {/* Collapsed Card - Click to Expand */}
              <div
                onClick={() => toggleExpand(ep.id)}
                className={`bg-gray-800 rounded-lg p-4 flex gap-4 border cursor-pointer transition-all ${
                  expandedId === ep.id
                    ? 'border-blue-500 ring-1 ring-blue-500/30'
                    : 'border-gray-700 hover:border-gray-600'
                }`}
              >
                {/* Thumbnail */}
                <div className="w-32 h-24 bg-black rounded-md overflow-hidden flex-shrink-0">
                  <EpisodeThumbnail episodeId={ep.id} />
                </div>

                {/* Info */}
                <div className="flex-1">
                   <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-lg text-white">
                          {getIntelligentHeadline(ep)}
                        </h3>
                        <p className="text-xs text-gray-400">
                          {formatEpisodeTime(ep)} • {ep.camera_id}
                          {ep.threat_assessment?.code && (
                            <span className="ml-2 text-gray-500">[{ep.threat_assessment.code}]</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {ep.threat_assessment && (
                          <span className={`px-2 py-1 rounded text-xs font-bold ${
                            ep.threat_assessment.level === 'HIGH' ? 'bg-red-900 text-red-200' :
                            ep.threat_assessment.level === 'MEDIUM' ? 'bg-yellow-900 text-yellow-200' :
                            'bg-blue-900 text-blue-200'
                          }`}>
                            {ep.threat_assessment.level}
                          </span>
                        )}
                        <svg
                          className={`w-5 h-5 text-gray-400 transition-transform ${
                            expandedId === ep.id ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                   </div>

                   {/* The Gemini Analysis - behavior description (shown in collapsed view) */}
                   {ep.analysis?.subject_behavior && (
                     <p className="mt-2 text-sm text-gray-300 line-clamp-2">
                       {ep.analysis.subject_behavior}
                     </p>
                   )}
                   {/* Analysis metadata */}
                   {ep.frames_analyzed && (
                     <p className="mt-1 text-xs text-gray-500">
                       {ep.frames_analyzed} frames analyzed in {ep.analysis_time_ms}ms ({ep.model})
                     </p>
                   )}
                </div>
              </div>

              {/* Expanded View */}
              {expandedId === ep.id && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <EpisodeExpandedView
                    episode={ep}
                    onClose={() => setExpandedId(null)}
                  />
                </div>
              )}
            </div>
          ))}
          {episodes.length === 0 && (
            <div className="text-center py-10 text-gray-500">No episodes yet. Walk in front of a camera to trigger.</div>
          )}
        </div>
      </div>
    </main>
  );
}
