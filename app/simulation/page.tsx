'use client';

import { useState, useEffect, useCallback } from 'react';
import { Upload, Play, Square, Activity, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

type Status = 'idle' | 'uploading' | 'streaming' | 'error';

export default function SimulationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ stream: string; cameraId: string } | null>(null);

  // Check simulation status on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/simulation/status`)
      .then(res => res.json())
      .then(data => {
        if (data.running) {
          setStatus('streaming');
        }
      })
      .catch(() => {});
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file) return;

    setStatus('uploading');
    setError(null);

    const formData = new FormData();
    formData.append('video', file);

    try {
      const res = await fetch(`${API_BASE}/api/simulation/start`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatus('streaming');
        setStreamInfo({ stream: data.stream, cameraId: data.cameraId });
      } else {
        throw new Error(data.error || 'Failed to start simulation');
      }
    } catch (err) {
      console.error(err);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [file]);

  const handleStop = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/simulation/stop`, { method: 'POST' });
      setStatus('idle');
      setStreamInfo(null);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type.startsWith('video/')) {
      setFile(droppedFile);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity className="text-blue-500" />
            Injection Testing Lab
          </h1>
          <p className="text-gray-400 mt-2">
            Upload a video file to simulate a live camera feed for testing the detection pipeline.
          </p>
        </div>

        {/* Upload Card */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-8">
          {/* Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="mb-6"
          >
            <label className="cursor-pointer block border-2 border-dashed border-gray-600 hover:border-blue-500 rounded-lg p-12 transition-colors text-center">
              <input
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                disabled={status === 'streaming'}
              />
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-500" />
              <span className="text-lg font-medium text-gray-300">
                {file ? file.name : 'Drop MP4/WebM Video Here'}
              </span>
              <p className="text-sm text-gray-500 mt-2">
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                  : 'Simulates a live camera feed at 1x speed'}
              </p>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            {status !== 'streaming' ? (
              <button
                onClick={handleUpload}
                disabled={!file || status === 'uploading'}
                className={`flex-1 py-4 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-all
                  ${!file || status === 'uploading'
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
              >
                {status === 'uploading' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" fill="currentColor" />
                    Start Simulation
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="flex-1 py-4 rounded-lg font-bold text-lg flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white transition-all"
              >
                <Square className="w-5 h-5" fill="currentColor" />
                Stop Simulation
              </button>
            )}
          </div>

          {/* Error Message */}
          {status === 'error' && error && (
            <div className="mt-4 p-4 bg-red-900/20 border border-red-800 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 font-medium">Simulation Failed</p>
                <p className="text-red-300 text-sm mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Active Stream Info */}
          {status === 'streaming' && streamInfo && (
            <div className="mt-6 p-4 bg-green-900/20 border border-green-800 rounded-lg">
              <div className="flex items-center gap-2 text-green-400 font-medium mb-2">
                <CheckCircle2 className="w-5 h-5" />
                <span className="animate-pulse">LIVE INJECTION ACTIVE</span>
              </div>
              <div className="text-sm text-green-300 space-y-1">
                <p>
                  <span className="text-green-500">Stream:</span>{' '}
                  <code className="bg-green-900/30 px-2 py-0.5 rounded">{streamInfo.stream}</code>
                </p>
                <p>
                  <span className="text-green-500">Camera ID:</span>{' '}
                  <code className="bg-green-900/30 px-2 py-0.5 rounded">{streamInfo.cameraId}</code>
                </p>
              </div>
              <p className="text-green-400/70 text-xs mt-3">
                The video is looping at 1x speed. Check the main dashboard for detections.
              </p>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-8 bg-gray-800/50 border border-gray-700 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">How It Works</h2>
          <ol className="space-y-3 text-gray-300 text-sm">
            <li className="flex gap-3">
              <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
              <span>Upload a video file (ideally with people walking)</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
              <span>FFmpeg broadcasts the video to MediaMTX as a fake RTSP camera</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
              <span>The simulation worker picks it up and runs YOLO detection</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
              <span>Detections appear in the main dashboard like a real camera</span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
