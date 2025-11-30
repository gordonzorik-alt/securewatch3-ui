'use client';

import React, { useState, useEffect, useRef } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

interface Detection {
  id: number;
  imageUrl: string;
  key?: string;
  camera_id?: string;
  timestamp?: string;
}

interface EpisodeDetails {
  success: boolean;
  episode_id: string;
  camera_id?: string;
  start_time?: string;
  end_time?: string;
  count: number;
  source?: string;
  detections: Detection[];
}

interface FilmstripProps {
  episodeId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function Filmstrip({ episodeId, isOpen, onClose }: FilmstripProps) {
  const [details, setDetails] = useState<EpisodeDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && episodeId) {
      fetchDetails();
    }
  }, [isOpen, episodeId]);

  const fetchDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/episodes/${episodeId}/details`);
      const data = await res.json();
      if (data.success) {
        // Limit to max 10 frames (LLM processing limit)
        if (data.detections && data.detections.length > 10) {
          data.detections = data.detections.slice(0, 10);
          data.count = 10;
        }
        setDetails(data);
        setSelectedIndex(0);
      } else {
        setError(data.error || 'Failed to load episode details');
      }
    } catch (err) {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const scrollToIndex = (index: number) => {
    if (scrollRef.current) {
      const thumbWidth = 80; // matches w-20
      scrollRef.current.scrollTo({
        left: index * thumbWidth - scrollRef.current.clientWidth / 2 + thumbWidth / 2,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    scrollToIndex(selectedIndex);
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-gray-700">
        <div>
          <h2 className="text-xl font-bold text-white">Episode Details</h2>
          <p className="text-sm text-gray-400">
            {details?.camera_id} | {details?.count || 0} frames
            {details?.source && <span className="ml-2 text-blue-400">({details.source})</span>}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-2xl px-3 py-1"
        >
          x
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden p-4">
        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-gray-400">Loading...</div>
          </div>
        )}

        {error && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-red-400">{error}</div>
          </div>
        )}

        {details && details.detections.length > 0 && (
          <>
            {/* Main Image */}
            <div className="flex-1 flex items-center justify-center mb-4 min-h-0">
              <img
                src={details.detections[selectedIndex]?.imageUrl}
                alt={`Frame ${selectedIndex + 1}`}
                className="max-h-full max-w-full object-contain rounded-lg"
              />
            </div>

            {/* Navigation Arrows & Frame Counter */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
                disabled={selectedIndex === 0}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white"
              >
                Prev
              </button>
              <span className="text-gray-300">
                {selectedIndex + 1} / {details.detections.length}
              </span>
              <button
                onClick={() => setSelectedIndex(Math.min(details.detections.length - 1, selectedIndex + 1))}
                disabled={selectedIndex === details.detections.length - 1}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-30 rounded text-white"
              >
                Next
              </button>
            </div>

            {/* Filmstrip Thumbnails */}
            <div
              ref={scrollRef}
              className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-600"
            >
              {details.detections.map((det, idx) => (
                <button
                  key={det.id}
                  onClick={() => setSelectedIndex(idx)}
                  className={`flex-shrink-0 w-20 h-14 rounded overflow-hidden border-2 transition-all ${
                    idx === selectedIndex
                      ? 'border-blue-500 ring-2 ring-blue-500/50'
                      : 'border-gray-600 hover:border-gray-500'
                  }`}
                >
                  <img
                    src={det.imageUrl}
                    alt={`Thumb ${idx + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </>
        )}

        {details && details.detections.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-gray-400 text-center">
              <p>No frames available for this episode.</p>
              {details.source === 'live' && (
                <p className="mt-2 text-sm">Live episodes may not have persisted detections.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
