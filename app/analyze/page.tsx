'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchLLMPreview, runLLMAnalysis, LLMAnalysisResult } from '@/lib/api';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

export default function AnalyzePage() {
  const [analysisResult, setAnalysisResult] = useState<LLMAnalysisResult | null>(null);

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['llmPreview', undefined, 8],
    queryFn: () => fetchLLMPreview(undefined, 8),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => runLLMAnalysis(undefined, 8, { location: 'Security Camera' }),
    onSuccess: (data) => {
      setAnalysisResult(data);
    },
  });

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-red-600';
    if (confidence >= 0.5) return 'text-amber-600';
    return 'text-green-600';
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-neutral-200/50 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/dispatch" className="text-[17px] font-semibold text-neutral-900 tracking-tight hover:text-neutral-600 transition-colors">
            SecureWatch
          </Link>
          <nav className="flex items-center gap-6">
            <Link href="/dispatch" className="text-[14px] text-neutral-500 hover:text-neutral-900 transition-colors">
              Episodes
            </Link>
            <Link href="/threats" className="text-[14px] text-neutral-500 hover:text-neutral-900 transition-colors">
              Analysis
            </Link>
            <span className="text-[14px] text-neutral-900 font-medium">
              AI
            </span>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-[32px] font-semibold text-neutral-900 tracking-tight mb-2">
            AI Analysis
          </h1>
          <p className="text-[15px] text-neutral-500 max-w-md mx-auto">
            Deep threat analysis powered by Gemini
          </p>
        </div>

        {/* Main Action */}
        <div className="max-w-md mx-auto mb-16">
          <button
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending || !preview?.success}
            className="w-full py-4 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 text-white text-[15px] font-medium rounded-2xl transition-colors"
          >
            {analyzeMutation.isPending ? (
              <span className="flex items-center justify-center gap-3">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Analyzing...
              </span>
            ) : (
              'Run Analysis'
            )}
          </button>
          {!preview?.success && !previewLoading && (
            <p className="text-[13px] text-neutral-400 text-center mt-3">
              No episodes available to analyze
            </p>
          )}
        </div>

        {/* Results */}
        {analysisResult?.success && (
          <div className="space-y-8">
            {/* Assessment Card */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/50 p-8">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Assessment</div>
                  <div className="text-[28px] font-semibold text-neutral-900">
                    {analysisResult.threat_assessment.code_label}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-1">Confidence</div>
                  <div className={`text-[28px] font-semibold tabular-nums ${getConfidenceColor(analysisResult.threat_assessment.confidence)}`}>
                    {Math.round(analysisResult.threat_assessment.confidence * 100)}%
                  </div>
                </div>
              </div>

              {analysisResult.recommended_action && (
                <div className="p-4 bg-neutral-50 rounded-xl">
                  <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-2">Recommended Action</div>
                  <p className="text-[15px] text-neutral-900">{analysisResult.recommended_action}</p>
                </div>
              )}
            </div>

            {/* Analysis Details */}
            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/50 overflow-hidden">
              {/* Subject */}
              <div className="p-6 border-b border-neutral-100">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3">Subject</div>
                <p className="text-[15px] text-neutral-700 leading-relaxed">
                  {analysisResult.analysis.subject_description}
                </p>
              </div>

              {/* Movement */}
              <div className="p-6 border-b border-neutral-100">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3">Movement</div>
                <p className="text-[15px] text-neutral-700 leading-relaxed">
                  {analysisResult.analysis.movement_analysis}
                </p>
              </div>

              {/* Timeline */}
              <div className="p-6 border-b border-neutral-100">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3">Timeline</div>
                <p className="text-[15px] text-neutral-700 leading-relaxed">
                  {analysisResult.analysis.timeline_summary}
                </p>
              </div>

              {/* Reasoning */}
              <div className="p-6">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-3">Reasoning</div>
                <p className="text-[15px] text-neutral-700 leading-relaxed">
                  {analysisResult.analysis.reasoning}
                </p>
              </div>
            </div>

            {/* Behavioral Indicators */}
            {analysisResult.analysis.behavioral_indicators.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/50 p-6">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-4">Behavioral Indicators</div>
                <div className="flex flex-wrap gap-2">
                  {analysisResult.analysis.behavioral_indicators.map((ind, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-full text-[13px]"
                    >
                      {ind}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Key Observations */}
            {analysisResult.analysis.key_observations.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/50 p-6">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-4">Key Observations</div>
                <ul className="space-y-2">
                  {analysisResult.analysis.key_observations.map((obs, i) => (
                    <li key={i} className="text-[15px] text-neutral-700 flex items-start gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 mt-2 flex-shrink-0" />
                      {obs}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Frames Analyzed */}
            {analysisResult.frame_selection_reasons.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/50 p-6">
                <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-4">Frames Analyzed</div>
                <div className="grid grid-cols-2 gap-3">
                  {analysisResult.frame_selection_reasons.map((fr, i) => (
                    <div key={i} className="flex items-center justify-between py-2 px-3 bg-neutral-50 rounded-lg">
                      <span className="text-[14px] text-neutral-500">Frame {fr.frame}</span>
                      <span className="text-[13px] text-neutral-700">{fr.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Preview Frames (when no result yet) */}
        {!analysisResult && preview?.success && (
          <div className="bg-white rounded-2xl shadow-sm border border-neutral-200/50 p-6">
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 mb-4">
              {preview.frame_selection.count} frames ready for analysis
            </div>
            <div className="grid grid-cols-4 gap-2">
              {preview.frame_selection.frames.map((frame, idx) => (
                <div key={idx} className="aspect-video bg-neutral-100 rounded-lg overflow-hidden">
                  <img
                    src={`${API_BASE}${frame.imageUrl}`}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {analyzeMutation.isError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mt-8">
            <p className="text-[15px] text-red-700">
              Analysis failed: {(analyzeMutation.error as Error).message}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
