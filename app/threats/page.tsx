'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchThreatAnalysis, ThreatEpisode } from '@/lib/api';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

export default function ThreatsPage() {
  const [expandedEpisodeId, setExpandedEpisodeId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['threatAnalysis', 20],
    queryFn: () => fetchThreatAnalysis(20),
    refetchInterval: expandedEpisodeId ? false : 10000,
  });

  const episodes = data?.episodes || [];
  const stats = data?.stats;

  const getThreatIndicator = (level: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-500',
      high: 'bg-orange-400',
      medium: 'bg-yellow-400',
      low: 'bg-neutral-300',
      minimal: 'bg-neutral-200',
    };
    return colors[level] || 'bg-neutral-200';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-neutral-200 border-t-neutral-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-neutral-200/50 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/dispatch" className="text-[17px] font-semibold text-neutral-900 tracking-tight hover:text-neutral-600 transition-colors">
            SecureWatch
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/dispatch" className="text-[14px] text-neutral-500 hover:text-neutral-900 transition-colors">
              Episodes
            </Link>
            <span className="text-[14px] text-neutral-900 font-medium">
              Analysis
            </span>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="mb-12">
          <h1 className="text-[32px] font-semibold text-neutral-900 tracking-tight mb-2">
            Threat Analysis
          </h1>
          <p className="text-[15px] text-neutral-500">
            AI-scored security episodes ranked by threat level
          </p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-6 mb-12">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Total</div>
              <div className="text-[28px] font-semibold text-neutral-900 tabular-nums">{stats.totalEpisodes}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Max Score</div>
              <div className="text-[28px] font-semibold text-neutral-900 tabular-nums">{stats.maxScore}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Average</div>
              <div className="text-[28px] font-semibold text-neutral-900 tabular-nums">{stats.avgScore}</div>
            </div>
          </div>
        )}

        {/* Episodes */}
        {episodes.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[15px] text-neutral-500">No episodes detected</p>
            <p className="text-[13px] text-neutral-400 mt-1">Upload a video to begin</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/50 overflow-hidden">
            {episodes.map((episode: ThreatEpisode, index: number) => {
              const isExpanded = expandedEpisodeId === episode.id;
              const isLast = index === episodes.length - 1;

              return (
                <div key={episode.id} className={!isLast ? 'border-b border-neutral-100' : ''}>
                  {/* Row */}
                  <div
                    className="px-6 py-5 flex items-center gap-5 cursor-pointer hover:bg-neutral-50 transition-colors"
                    onClick={() => setExpandedEpisodeId(isExpanded ? null : episode.id)}
                  >
                    {/* Rank */}
                    <div className="w-8 text-[15px] font-medium text-neutral-400 tabular-nums">
                      {episode.rank}
                    </div>

                    {/* Indicator */}
                    <div className={`w-2.5 h-2.5 rounded-full ${getThreatIndicator(episode.threatLevel)}`} />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] text-neutral-900">
                        {episode.objectsSeen.slice(0, 3).join(', ')}
                        {episode.objectsSeen.length > 3 && (
                          <span className="text-neutral-400"> +{episode.objectsSeen.length - 3}</span>
                        )}
                      </div>
                      <div className="text-[13px] text-neutral-400 mt-0.5">
                        {episode.duration}
                      </div>
                    </div>

                    {/* Score */}
                    <div className="text-[20px] font-semibold text-neutral-900 tabular-nums">
                      {episode.threatScore}
                    </div>

                    {/* Chevron */}
                    <svg
                      className={`w-5 h-5 text-neutral-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  {/* Expanded */}
                  {isExpanded && (
                    <div className="px-6 pb-6 pt-2 ml-8">
                      {/* Keyframe */}
                      {episode.keyframe.imageUrl && (
                        <div className="mb-6">
                          <img
                            src={`${API_BASE}${episode.keyframe.imageUrl}`}
                            alt=""
                            className="max-w-md rounded-xl"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}

                      {/* Details Grid */}
                      <div className="grid grid-cols-3 gap-8 mb-6">
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Base Score</div>
                          <div className="text-[20px] font-semibold text-neutral-900 tabular-nums">
                            {episode.scoreBreakdown.baseScore}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Bonus</div>
                          <div className="text-[20px] font-semibold text-neutral-900 tabular-nums">
                            +{episode.scoreBreakdown.interactionBonus}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Total</div>
                          <div className="text-[20px] font-semibold text-neutral-900 tabular-nums">
                            {episode.threatScore}
                          </div>
                        </div>
                      </div>

                      {/* Detections */}
                      {episode.keyframe.detections.length > 0 && (
                        <div className="mb-6">
                          <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3">Detections</div>
                          <div className="flex flex-wrap gap-2">
                            {episode.keyframe.detections.slice(0, 6).map((det, idx) => (
                              <span
                                key={idx}
                                className="px-3 py-1.5 bg-neutral-100 text-neutral-700 rounded-full text-[13px]"
                              >
                                {det.label}
                                <span className="text-neutral-400 ml-1">{det.confidence}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Rules */}
                      {episode.scoreBreakdown.triggeredRules.length > 0 && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3">Triggered Rules</div>
                          <div className="flex flex-wrap gap-2">
                            {episode.scoreBreakdown.triggeredRules.map((rule, idx) => (
                              <span
                                key={idx}
                                className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-[13px]"
                              >
                                {rule.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
