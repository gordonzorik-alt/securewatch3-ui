'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useVideos } from '@/hooks/useVideos';
import { uploadVideo, startDetection, fetchThreatAnalysis, runLLMAnalysis, fetchLLMPreview, fetchStoredAnalysis, ThreatEpisode, LLMAnalysisResult } from '@/lib/api';
import { useQueryClient, useQuery } from '@tanstack/react-query';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

// Helper to get action icon
const getActionIcon = (action: string) => {
  const lowerAction = action?.toLowerCase() || '';
  if (lowerAction.includes('dispatch') || lowerAction.includes('police')) {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    );
  }
  if (lowerAction.includes('warning') || lowerAction.includes('audio')) {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
      </svg>
    );
  }
  // Monitor Only / Default
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
};

// Helper to get action color classes
const getActionColorClasses = (action: string) => {
  const lowerAction = action?.toLowerCase() || '';
  if (lowerAction.includes('dispatch') || lowerAction.includes('police')) {
    return 'bg-red-50 text-red-700 border-red-200';
  }
  if (lowerAction.includes('warning') || lowerAction.includes('audio')) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  return 'bg-green-50 text-green-700 border-green-200';
};

export default function DispatchPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [expandedEpisodeId, setExpandedEpisodeId] = useState<string | null>(null);
  const [galleryImages, setGalleryImages] = useState<{ url: string; label: string }[]>([]);
  const [galleryIndex, setGalleryIndex] = useState<number>(0);
  const [analyzingEpisodeId, setAnalyzingEpisodeId] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, LLMAnalysisResult>>({});
  const [analyzedVideoIds, setAnalyzedVideoIds] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const { data: videosData } = useVideos();
  const videos = videosData?.videos || [];
  const latestVideo = videos.filter((v: any) => v.status === 'completed').sort((a: any, b: any) => b.id - a.id)[0];

  // Fetch episodes from ALL videos (no video filter)
  const { data: episodesData, isLoading: episodesLoading } = useQuery({
    queryKey: ['threatEpisodes', 50],
    queryFn: () => fetchThreatAnalysis(50),
    refetchInterval: expandedEpisodeId ? false : 5000,
  });

  const expandedEpisode = expandedEpisodeId
    ? (episodesData?.episodes || []).find((ep: ThreatEpisode) => ep.id === expandedEpisodeId)
    : null;
  const expandedEpisodeRank = expandedEpisode?.rank || 1;
  const expandedEpisodeVideoId = expandedEpisode?.videoId;
  const expandedEpisodeStartTime = expandedEpisode?.startTime;
  const expandedEpisodeEndTime = expandedEpisode?.endTime;

  const { data: llmPreview, isLoading: previewLoading } = useQuery({
    queryKey: ['llmPreview', expandedEpisodeId, expandedEpisodeVideoId, expandedEpisodeStartTime, expandedEpisodeEndTime],
    queryFn: () => fetchLLMPreview(expandedEpisodeVideoId, 8, expandedEpisodeRank, expandedEpisodeStartTime, expandedEpisodeEndTime),
    enabled: !!expandedEpisodeId && !!expandedEpisodeVideoId,
    refetchInterval: false,
    staleTime: 0,
  });

  const episodes = episodesData?.episodes || [];
  const stats = episodesData?.stats;

  // Load stored analysis results for episodes when they change
  const [loadedEpisodeIds, setLoadedEpisodeIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadStoredAnalyses = async () => {
      for (const episode of episodes) {
        if (loadedEpisodeIds.has(episode.id) || analysisResults[episode.id]) {
          continue;
        }

        try {
          const response = await fetchStoredAnalysis(episode.id);
          if (response.found && response.analysis) {
            setAnalysisResults(prev => ({ ...prev, [episode.id]: response.analysis! }));
          }
        } catch (error) {
          console.debug(`No stored analysis for episode ${episode.id}`);
        }

        setLoadedEpisodeIds(prev => new Set([...prev, episode.id]));
      }
    };

    if (episodes.length > 0) {
      loadStoredAnalyses();
    }
  }, [episodes, loadedEpisodeIds, analysisResults]);

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const result = await uploadVideo(selectedFile);
      await startDetection(result.video.id, 'yolo');
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      queryClient.invalidateQueries({ queryKey: ['threatEpisodes'] });
      queryClient.invalidateQueries({ queryKey: ['llmPreview'] });
      setSelectedFile(null);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleAnalyze = useCallback(async (episode: ThreatEpisode, markVideoAnalyzed: boolean = false) => {
    if (analysisResults[episode.id]) {
      console.log(`[AI Analysis] Using stored analysis for episode ${episode.id}`);
      return;
    }

    setAnalyzingEpisodeId(episode.id);
    try {
      const storedResponse = await fetchStoredAnalysis(episode.id);
      if (storedResponse.found && storedResponse.analysis) {
        console.log(`[AI Analysis] Found stored analysis for episode ${episode.id}`);
        setAnalysisResults(prev => ({ ...prev, [episode.id]: storedResponse.analysis! }));
        return;
      }

      console.log(`[AI Analysis] Running new analysis for episode ${episode.id}`);
      const result = await runLLMAnalysis(episode.videoId, 8, { location: 'Security Camera' }, episode.rank);
      if (result.success) {
        setAnalysisResults(prev => ({ ...prev, [episode.id]: result }));
        if (markVideoAnalyzed && episode.videoId) {
          setAnalyzedVideoIds(prev => new Set([...prev, episode.videoId!]));
        }
      }
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setAnalyzingEpisodeId(null);
    }
  }, [analysisResults]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const openGallery = (images: { url: string; label: string }[], startIndex: number) => {
    setGalleryImages(images);
    setGalleryIndex(startIndex);
  };

  const closeGallery = () => {
    setGalleryImages([]);
    setGalleryIndex(0);
  };

  const downloadImages = async (frames: { imageUrl: string; frameNumber: number }[], episodeId: string) => {
    for (const frame of frames) {
      try {
        const response = await fetch(`${API_BASE}${frame.imageUrl}`);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `episode_${episodeId}_frame_${frame.frameNumber}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to download frame ${frame.frameNumber}:`, error);
      }
    }
  };

  const nextImage = useCallback(() => {
    if (galleryImages.length > 0) {
      setGalleryIndex((prev) => (prev + 1) % galleryImages.length);
    }
  }, [galleryImages.length]);

  const prevImage = useCallback(() => {
    if (galleryImages.length > 0) {
      setGalleryIndex((prev) => (prev - 1 + galleryImages.length) % galleryImages.length);
    }
  }, [galleryImages.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (galleryImages.length === 0) return;
      if (e.key === 'ArrowRight') nextImage();
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'Escape') closeGallery();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [galleryImages.length, nextImage, prevImage]);

  // Auto-analyze when frames load
  useEffect(() => {
    if (
      expandedEpisode &&
      llmPreview?.success &&
      expandedEpisode.videoId &&
      !analyzedVideoIds.has(expandedEpisode.videoId) &&
      !analysisResults[expandedEpisode.id] &&
      !analyzingEpisodeId
    ) {
      handleAnalyze(expandedEpisode, true);
    }
  }, [expandedEpisode, llmPreview?.success, analyzedVideoIds, analysisResults, analyzingEpisodeId, handleAnalyze]);

  // Threat level to status dot color
  const getThreatIndicator = (level: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-500',
      high: 'bg-orange-400',
      medium: 'bg-yellow-400',
      low: 'bg-slate-300',
      minimal: 'bg-slate-200',
    };
    return colors[level] || 'bg-slate-200';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/50 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <h1 className="text-[17px] font-semibold text-slate-900 tracking-tight">SecureWatch</h1>
          <div className="flex items-center gap-4">
            {episodes.length > 0 && (
              <span className="flex items-center gap-2 text-[13px] text-slate-500">
                {Object.keys(analysisResults).length < episodes.length ? (
                  <>
                    <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                    AI: {Object.keys(analysisResults).length}/{episodes.length}
                  </>
                ) : (
                  <span className="text-green-600 font-medium">AI Complete</span>
                )}
              </span>
            )}
            {stats && (stats.scoreDistribution.critical > 0 || stats.scoreDistribution.high > 0) && (
              <span className="flex items-center gap-1.5 text-[13px] text-red-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {stats.scoreDistribution.critical + stats.scoreDistribution.high} alerts
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Video Preview */}
        <div className="mb-4">
          {latestVideo ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/50 overflow-hidden">
              <video
                className="w-full aspect-video bg-slate-900"
                controls
                loop
                muted
                autoPlay
                src={`${API_BASE}/${latestVideo.path}`}
              />
            </div>
          ) : (
            <div className="bg-slate-100 rounded-2xl border border-slate-200/50 flex items-center justify-center aspect-video">
              <span className="text-slate-400 text-[13px]">No video yet</span>
            </div>
          )}
        </div>

        {/* Upload Buttons - Symmetrical */}
        <div className="flex justify-center gap-4 mb-6">
          <input
            type="file"
            id="video-upload"
            className="hidden"
            accept="video/*"
            onChange={(e) => e.target.files?.[0] && setSelectedFile(e.target.files[0])}
          />

          <label
            htmlFor="video-upload"
            className="flex-1 max-w-[200px] py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[14px] font-medium rounded-full text-center cursor-pointer transition-colors border border-slate-200"
          >
            {selectedFile ? selectedFile.name.slice(0, 20) + (selectedFile.name.length > 20 ? '...' : '') : 'Choose Video'}
          </label>

          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="flex-1 max-w-[200px] py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[14px] font-medium rounded-full transition-colors"
          >
            {uploading ? 'Processing...' : 'Upload'}
          </button>
        </div>

        {/* Recent Videos with Status */}
        {videos.length > 0 && (
          <div className="mb-6">
            <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Recent Videos</h3>
            <div className="flex flex-wrap gap-2">
              {videos.slice().reverse().slice(0, 8).map((video: any) => (
                <div
                  key={video.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium border ${
                    video.status === 'completed'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : video.status === 'processing'
                        ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${
                    video.status === 'completed'
                      ? 'bg-blue-500'
                      : video.status === 'processing'
                        ? 'bg-yellow-500 animate-pulse'
                        : 'bg-slate-400'
                  }`} />
                  <span className="truncate max-w-[120px]">{video.filename}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Row */}
        <div className="flex items-center justify-between mb-4">
          {stats ? (
            <div>
              <span className="text-[32px] font-semibold text-slate-900 tracking-tight">{stats.totalEpisodes}</span>
              <span className="text-[13px] text-slate-500 ml-2">episodes detected</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
              <span className="text-[13px] text-slate-400">Loading...</span>
            </div>
          )}
          {episodes.length > 0 && (
            <span className="flex items-center gap-2 text-[13px] text-slate-500">
              {Object.keys(analysisResults).length < episodes.length ? (
                <>
                  <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                  AI: {Object.keys(analysisResults).length}/{episodes.length}
                </>
              ) : (
                <span className="text-green-600 font-medium">AI Complete</span>
              )}
            </span>
          )}
        </div>

        {/* Episodes List */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-[15px] font-semibold text-slate-900">Episodes</h2>
          </div>

          {episodesLoading ? (
            <div className="px-6 py-12 text-center">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto" />
            </div>
          ) : episodes.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-[15px] text-slate-500">No episodes yet</p>
              <p className="text-[13px] text-slate-400 mt-1">Upload a video to begin analysis</p>
            </div>
          ) : (
            <div className="space-y-3 p-3">
              {episodes.slice(0, 10).map((episode: ThreatEpisode) => {
                    const isExpanded = expandedEpisodeId === episode.id;
                    const analysis = analysisResults[episode.id];
                    const isAnalyzing = analyzingEpisodeId === episode.id;

                    return (
                      <div key={episode.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                        {/* COLLAPSED ROW */}
                        <div
                          className="px-5 py-4 flex items-center gap-4 cursor-pointer bg-white hover:bg-slate-50/50 transition-colors"
                          onClick={() => setExpandedEpisodeId(isExpanded ? null : episode.id)}
                        >
                          {/* Status Dot */}
                          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getThreatIndicator(episode.threatLevel)}`} />

                          {/* Info Column */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[15px] font-medium text-slate-900">
                                Episode {episode.rank}
                              </span>
                              {episode.videoId && (
                                <span className="text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                                  v{episode.videoId}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[13px] text-slate-500 mt-0.5">
                              <span>{episode.duration}</span>
                              <span className="text-slate-300">·</span>
                              <span>{formatTimestamp(episode.timestamp)}</span>
                            </div>
                          </div>

                          {/* Classification Badge */}
                          {analysis ? (
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-700 text-[12px] font-medium rounded-full whitespace-nowrap">
                              {analysis.threat_assessment.code_label}
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-blue-50 text-blue-600 text-[11px] font-medium rounded-full whitespace-nowrap flex items-center gap-1.5">
                              {isAnalyzing ? (
                                <>
                                  <span className="w-3 h-3 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                                  Analyzing...
                                </>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                  Prompt AI
                                </>
                              )}
                            </span>
                          )}

                          {/* Recommended Action (if analyzed) */}
                          {analysis?.recommended_action && (
                            <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium rounded-full border ${getActionColorClasses(analysis.recommended_action)}`}>
                              {getActionIcon(analysis.recommended_action)}
                              <span className="whitespace-nowrap">{analysis.recommended_action}</span>
                            </div>
                          )}

                          {/* Chevron */}
                          <svg
                            className={`w-5 h-5 text-slate-300 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </div>

                        {/* EXPANDED VIEW - Vertical Layout */}
                        {isExpanded && (
                          <div className="px-5 pb-5 pt-2 space-y-4 bg-white border-t border-slate-100">
                            {/* Frames Grid */}
                            {previewLoading ? (
                              <div className="h-32 bg-slate-100 rounded-xl flex items-center justify-center">
                                <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
                              </div>
                            ) : llmPreview?.success && llmPreview.frame_selection?.frames?.length > 0 ? (
                              <div>
                                <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                                  {llmPreview.frame_selection.frames.slice(0, 8).map((frame: any, idx: number) => (
                                    <div
                                      key={idx}
                                      className="relative aspect-video bg-slate-100 rounded-lg overflow-hidden cursor-pointer group"
                                      onClick={() => {
                                        const images = llmPreview.frame_selection.frames.map((f: any) => ({
                                          url: `${API_BASE}${f.imageUrl}`,
                                          label: `Frame ${f.frameNumber}`
                                        }));
                                        openGallery(images, idx);
                                      }}
                                    >
                                      <img
                                        src={`${API_BASE}${frame.imageUrl}`}
                                        alt=""
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                      />
                                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1 py-0.5">
                                        <span className="text-[9px] text-white/90 font-mono">{frame.relativeTime}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  onClick={() => downloadImages(llmPreview.frame_selection.frames, episode.id)}
                                  className="mt-2 flex items-center gap-1.5 px-2 py-1 text-[12px] text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                  Download {llmPreview.frame_selection.frames.length} frames
                                </button>
                              </div>
                            ) : episode.keyframe.imageUrl ? (
                              <div
                                className="w-32 aspect-video bg-slate-100 rounded-lg overflow-hidden cursor-pointer"
                                onClick={() => openGallery([{
                                  url: `${API_BASE}${episode.keyframe.imageUrl}`,
                                  label: `Frame ${episode.keyframe.frameNumber}`
                                }], 0)}
                              >
                                <img
                                  src={`${API_BASE}${episode.keyframe.imageUrl}`}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : null}

                            {/* Loading state */}
                            {isAnalyzing && !analysis && (
                              <div className="bg-blue-50 border border-blue-100 px-4 py-3 rounded-xl flex items-center gap-3">
                                <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                                <span className="text-[13px] text-blue-700">Analyzing {llmPreview?.frame_selection?.count || 8} frames...</span>
                              </div>
                            )}

                            {analysis && (
                              <>
                                {/* Action + Confidence + Context Row */}
                                <div className="flex flex-wrap items-stretch gap-3">
                                  {/* Action Box */}
                                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                                    analysis.recommended_action?.toLowerCase().includes('dispatch')
                                      ? 'bg-red-50 border-red-200 text-red-800'
                                      : analysis.recommended_action?.toLowerCase().includes('warning')
                                        ? 'bg-amber-50 border-amber-200 text-amber-800'
                                        : 'bg-green-50 border-green-200 text-green-800'
                                  }`}>
                                    {getActionIcon(analysis.recommended_action)}
                                    <span className="text-[13px] font-semibold">{analysis.recommended_action}</span>
                                  </div>

                                  {/* Confidence */}
                                  <div className="px-3 py-2 bg-slate-100 rounded-lg flex items-center gap-2">
                                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">Confidence</span>
                                    <span className="text-[15px] font-semibold text-slate-900 tabular-nums">
                                      {Math.round(analysis.threat_assessment.confidence * 100)}%
                                    </span>
                                  </div>

                                  {/* Context Pills */}
                                  {analysis.context_assessment && (
                                    <div className="flex items-center gap-2">
                                      <div className="px-2.5 py-1.5 bg-slate-100 rounded-lg">
                                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">Time</span>
                                        <span className="ml-1.5 text-[12px] font-medium text-slate-700">{analysis.context_assessment.time_of_day || '—'}</span>
                                      </div>
                                      <div className="px-2.5 py-1.5 bg-slate-100 rounded-lg">
                                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">Zone</span>
                                        <span className="ml-1.5 text-[12px] font-medium text-slate-700">{analysis.context_assessment.zone_type || '—'}</span>
                                      </div>
                                      {analysis.context_assessment.vehicle_detected && analysis.context_assessment.vehicle_detected !== 'None' && (
                                        <div className="px-2.5 py-1.5 bg-slate-100 rounded-lg">
                                          <span className="text-[10px] text-slate-400 uppercase tracking-wide">Vehicle</span>
                                          <span className="ml-1.5 text-[12px] font-medium text-slate-700">{analysis.context_assessment.vehicle_detected}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Threat Indicators */}
                                {analysis.threat_indicators && analysis.threat_indicators.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[10px] text-red-500 uppercase tracking-wide font-medium mr-1">Threats</span>
                                    {analysis.threat_indicators.map((ind: string, i: number) => (
                                      <span key={i} className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-[11px] font-medium">
                                        {ind}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* Legitimacy Indicators */}
                                {analysis.legitimacy_indicators && analysis.legitimacy_indicators.length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[10px] text-blue-500 uppercase tracking-wide font-medium mr-1">Legitimacy</span>
                                    {analysis.legitimacy_indicators.map((ind: string, i: number) => (
                                      <span key={i} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[11px] font-medium">
                                        {ind}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* Subject Behavior */}
                                {(analysis.analysis?.subject_behavior || analysis.analysis?.subject_description) && (
                                  <div>
                                    <div className="text-[10px] text-slate-400 uppercase tracking-wide font-medium mb-1">Subject Behavior</div>
                                    <p className="text-[13px] text-slate-700 leading-relaxed">
                                      {analysis.analysis.subject_behavior || analysis.analysis.subject_description}
                                    </p>
                                  </div>
                                )}

                                {/* Reasoning */}
                                {analysis.analysis?.reasoning && (
                                  <div className="pt-2 border-t border-slate-100">
                                    <div className="text-[10px] text-slate-400 uppercase tracking-wide font-medium mb-1">Reasoning</div>
                                    <p className="text-[13px] text-slate-500 leading-relaxed">
                                      {analysis.analysis.reasoning}
                                    </p>
                                  </div>
                                )}
                              </>
                            )}

                            {/* No analysis yet */}
                            {!analysis && !isAnalyzing && (
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => handleAnalyze(episode)}
                                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium rounded-lg transition-colors"
                                >
                                  Run AI Analysis
                                </button>
                                <span className="text-[13px] text-slate-400">Click to analyze this episode</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
      </main>

      {/* Gallery Modal */}
      {galleryImages.length > 0 && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center"
          onClick={closeGallery}
        >
          <button
            onClick={closeGallery}
            className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {galleryImages.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); prevImage(); }}
                className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); nextImage(); }}
                className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </>
          )}

          <div className="max-w-5xl max-h-[85vh] px-16" onClick={(e) => e.stopPropagation()}>
            <img
              src={galleryImages[galleryIndex]?.url}
              alt=""
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            {galleryImages.length > 1 && (
              <div className="mt-4 flex justify-center gap-1.5">
                {galleryImages.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setGalleryIndex(idx)}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${
                      idx === galleryIndex ? 'bg-white' : 'bg-white/30'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
