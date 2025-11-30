'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSecurityStore, Detection } from '@/lib/store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

interface V2Detection extends Detection {
  // V2Detection extends the store's Detection type
}

export default function DetectionTicker() {
  // ALL HOOKS MUST BE AT THE TOP - before any early returns
  const [isMounted, setIsMounted] = useState(false);
  const [expandedDetection, setExpandedDetection] = useState<V2Detection | null>(null);

  // Read from Zustand store
  const allDetections = useSecurityStore((state) => state.detections);
  const isConnected = useSecurityStore((state) => state.isSocketConnected);

  // Memoize the sliced array to prevent infinite re-renders
  const detections = useMemo(() => allDetections.slice(0, 7), [allDetections]);

  // Set mounted on client
  useEffect(() => { setIsMounted(true); }, []);

  // Close modal on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpandedDetection(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Helper to get image URL (supports both v2 and v3 formats)
  const getImageUrl = (det: V2Detection) => {
    if (det.imageUrl) {
      if (det.imageUrl.startsWith('http://') || det.imageUrl.startsWith('https://')) {
        return det.imageUrl;
      }
      return `${API_BASE}${det.imageUrl}`;
    }
    if (det.file) {
      const filename = det.file.split('/').pop();
      return `${API_BASE}/v2/live/${filename}`;
    }
    return '';
  };

  // Format timestamp for display
  const formatTime = (timeStr: string) => {
    try {
      const date = new Date(timeStr);
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch {
      return '--:--';
    }
  };

  // Format timestamp for expanded view
  const formatFullTime = (timeStr: string) => {
    try {
      const date = new Date(timeStr);
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
  };

  // Don't render store data on server - prevents hydration mismatch
  if (!isMounted) {
    return (
      <div className="w-full mb-6">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-gray-500"/>
            AI Stream (v3)
          </h3>
          <span className="text-xs text-gray-500 font-mono">Loading...</span>
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex-shrink-0 w-40 h-24 bg-slate-800 rounded-lg border border-slate-700 flex items-center justify-center">
              <span className="text-slate-600 text-xs">—</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (detections.length === 0) {
    return (
      <div className="w-full mb-6">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}/>
            AI Stream (v2)
          </h3>
          <span className="text-xs text-gray-500 font-mono">
            {isConnected ? 'Waiting...' : 'Disconnected'}
          </span>
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-40 h-24 bg-slate-800 rounded-lg border border-slate-700 flex items-center justify-center"
            >
              <span className="text-slate-600 text-xs">—</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-full mb-6">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"/>
            AI Stream (v2)
          </h3>
          <span className="text-xs text-green-400 font-mono">
            {detections.length} detections
          </span>
        </div>

        <div className="flex gap-3 overflow-hidden">
          <AnimatePresence initial={false}>
            {detections.map((det) => (
              <motion.div
                key={det.id}
                initial={{ opacity: 0, x: -20, width: 0 }}
                animate={{ opacity: 1, x: 0, width: 'auto' }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                className="relative flex-shrink-0 w-40 h-24 bg-black rounded-lg overflow-hidden border border-gray-800 shadow-lg group cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
                onClick={() => setExpandedDetection(det)}
              >
                {/* Image Layer */}
                <img
                  src={getImageUrl(det)}
                  className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                  alt={`${det.class} detection`}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 96"><rect fill="%231e293b" width="160" height="96"/><text x="80" y="52" text-anchor="middle" fill="%2364748b" font-size="10">No image</text></svg>';
                  }}
                />

                {/* Class Badge (Top Left) */}
                <div className={`absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                  det.class === 'person' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                }`}>
                  {det.class}
                </div>

                {/* Timestamp Badge (Top Right) */}
                <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[8px] text-white font-mono">
                  {formatTime(det.time)}
                </div>

                {/* Expand Icon (shows on hover) */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-8 h-8 bg-black/60 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                    </svg>
                  </div>
                </div>

                {/* Metadata Overlay */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase font-mono">{det.camera}</p>
                    </div>
                    <span className={`text-[10px] px-1 rounded font-mono ${
                      det.score > 0.8 ? 'bg-green-500/20 text-green-400' :
                      det.score > 0.5 ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-orange-500/20 text-orange-400'
                    }`}>
                      {(det.score * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Fill empty slots */}
          {[...Array(Math.max(0, 5 - detections.length))].map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex-shrink-0 w-40 h-24 bg-slate-800 rounded-lg border border-slate-700 flex items-center justify-center"
            >
              <span className="text-slate-600 text-xs">—</span>
            </div>
          ))}
        </div>
      </div>

      {/* Expanded View Modal */}
      <AnimatePresence>
        {expandedDetection && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setExpandedDetection(null)}
          >
            {/* Close Button */}
            <button
              onClick={() => setExpandedDetection(null)}
              className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors z-10"
            >
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Modal Content */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="max-w-4xl w-full bg-slate-900 rounded-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Image */}
              <div className="relative">
                <img
                  src={getImageUrl(expandedDetection)}
                  className="w-full max-h-[70vh] object-contain bg-black"
                  alt={`${expandedDetection.class} detection`}
                />

                {/* Class Badge */}
                <div className={`absolute top-4 left-4 px-3 py-1.5 rounded-lg text-sm font-bold uppercase ${
                  expandedDetection.class === 'person' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'
                }`}>
                  {expandedDetection.class}
                </div>
              </div>

              {/* Info Bar */}
              <div className="px-6 py-4 bg-slate-800 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-6">
                  {/* Camera */}
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Camera</p>
                    <p className="text-white font-medium">{expandedDetection.camera}</p>
                  </div>

                  {/* Timestamp */}
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Timestamp</p>
                    <p className="text-white font-mono">{formatFullTime(expandedDetection.time)}</p>
                  </div>

                  {/* Confidence */}
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider">Confidence</p>
                    <p className={`font-bold ${
                      expandedDetection.score > 0.8 ? 'text-green-400' :
                      expandedDetection.score > 0.5 ? 'text-yellow-400' :
                      'text-orange-400'
                    }`}>
                      {(expandedDetection.score * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <a
                    href={getImageUrl(expandedDetection)}
                    download={`detection_${expandedDetection.id}.jpg`}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
