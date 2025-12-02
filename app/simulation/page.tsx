'use client';

import { useState, useEffect, useCallback } from 'react';
import { Upload, Play, Square, Activity, AlertCircle, CheckCircle2, Loader2, Monitor, Cpu, Film, Eye } from 'lucide-react';
import HLSPlayer from '@/components/HLSPlayer';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';
const STREAM_BASE = 'http://136.119.129.106:8888';

type Status = 'idle' | 'uploading' | 'streaming' | 'error';

interface ProcessStatus {
  running: boolean;
  ffmpeg: {
    running: boolean;
    pid: number | null;
    cpu: number;
    cpuTime: string | null;
    source: string | null;
  };
  detector: {
    running: boolean;
    name: string | null;
    uptime: number;
    memory: number;
  };
}

export default function SimulationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ stream: string; cameraId: string } | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [processStatus, setProcessStatus] = useState<ProcessStatus | null>(null);

  // Fetch process status (FFmpeg + Detector)
  const fetchProcessStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/simulation/status`);
      const data = await res.json();
      setProcessStatus(data);
    } catch (e) {
      // Ignore errors
    }
  }, []);

  // Check simulation status on mount and poll every 5 seconds
  useEffect(() => {
    fetchProcessStatus();
    const interval = setInterval(fetchProcessStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchProcessStatus]);

  // Check simulation status on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/simulation/status`)
      .then(res => res.json())
      .then(data => {
        if (data.running) {
          setStatus('streaming');
          setStreamInfo({ stream: 'rtsp://localhost:8554/simulation', cameraId: 'simulation' });
          setStreamReady(true); // Already running, stream should be ready
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
        // Wait for HLS stream to become available (FFmpeg needs time to start)
        setTimeout(() => setStreamReady(true), 3000);
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
      setStreamReady(false);
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
      <div className="max-w-5xl mx-auto">
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

        {/* Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT: Upload Controls */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-blue-500" />
              Video Upload
            </h2>

            {/* Drop Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="mb-6"
            >
              <label className="cursor-pointer block border-2 border-dashed border-gray-600 hover:border-blue-500 rounded-lg p-8 transition-colors text-center">
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  disabled={status === 'streaming'}
                />
                <Upload className="w-10 h-10 mx-auto mb-3 text-gray-500" />
                <span className="text-base font-medium text-gray-300">
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
                  className={`flex-1 py-3 rounded-lg font-bold text-base flex items-center justify-center gap-2 transition-all
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
                  className="flex-1 py-3 rounded-lg font-bold text-base flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white transition-all"
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
              <div className="mt-4 p-4 bg-green-900/20 border border-green-800 rounded-lg">
                <div className="flex items-center gap-2 text-green-400 font-medium mb-2">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="animate-pulse">LIVE INJECTION ACTIVE</span>
                </div>
                <div className="text-sm text-green-300 space-y-1">
                  <p>
                    <span className="text-green-500">Stream:</span>{' '}
                    <code className="bg-green-900/30 px-2 py-0.5 rounded text-xs">{streamInfo.stream}</code>
                  </p>
                  <p>
                    <span className="text-green-500">Camera ID:</span>{' '}
                    <code className="bg-green-900/30 px-2 py-0.5 rounded text-xs">{streamInfo.cameraId}</code>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Live Preview Monitor */}
          <div className="bg-black border border-gray-700 rounded-xl overflow-hidden flex flex-col">
            {/* Process Status Bar */}
            <div className="p-2 bg-gray-950 border-b border-gray-800 flex items-center gap-4 text-xs">
              {/* FFmpeg Status */}
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-gray-500" />
                <span className="text-gray-400">FFmpeg:</span>
                {processStatus?.ffmpeg?.running ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-green-400 font-mono">
                      PID {processStatus.ffmpeg.pid} | CPU {processStatus.ffmpeg.cpuTime}
                    </span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    <span className="text-red-400">STOPPED</span>
                  </span>
                )}
              </div>

              {/* Detector Status */}
              <div className="flex items-center gap-2 border-l border-gray-800 pl-4">
                <Eye className="w-4 h-4 text-gray-500" />
                <span className="text-gray-400">Detector:</span>
                {processStatus?.detector?.running ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-green-400 font-mono">
                      {processStatus.detector.name} | {Math.round((processStatus.detector.memory || 0) / 1024 / 1024)}MB
                    </span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    <span className="text-red-400">STOPPED</span>
                  </span>
                )}
              </div>
            </div>

            {/* Monitor Header */}
            <div className="p-3 border-b border-gray-800 bg-gray-900 flex justify-between items-center">
              <span className="font-mono text-sm text-gray-400 flex items-center gap-2">
                <Monitor className="w-4 h-4" />
                CAM: SIMULATION
              </span>
              {(status === 'streaming' || processStatus?.ffmpeg?.running) && (
                <span className="flex items-center gap-2 text-red-500 text-xs font-bold uppercase">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                  LIVE
                </span>
              )}
            </div>

            {/* Video Player */}
            <div className="aspect-video relative bg-gray-950 flex items-center justify-center">
              {status === 'streaming' && streamReady ? (
                <HLSPlayer
                  src={`${STREAM_BASE}/simulation/index.m3u8`}
                  className="w-full h-full object-contain"
                />
              ) : status === 'streaming' && !streamReady ? (
                <div className="text-blue-400 flex flex-col items-center">
                  <Loader2 className="mb-2 w-10 h-10 animate-spin" />
                  <span className="text-sm">Starting stream...</span>
                  <span className="text-xs text-gray-500 mt-1">Waiting for FFmpeg to initialize</span>
                </div>
              ) : (
                <div className="text-gray-600 flex flex-col items-center">
                  <AlertCircle className="mb-2 w-10 h-10 opacity-50" />
                  <span className="text-sm">No Active Simulation</span>
                  <span className="text-xs text-gray-700 mt-1">Upload and start a video to preview</span>
                </div>
              )}
            </div>

            {/* Monitor Footer */}
            <div className="p-3 bg-gray-900 border-t border-gray-800 text-xs text-gray-500 font-mono">
              HLS: {STREAM_BASE}/simulation/index.m3u8
            </div>
          </div>
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
              <span>Watch the live preview on the right to verify it's working</span>
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
