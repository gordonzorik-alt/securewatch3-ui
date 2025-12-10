'use client';

import { useState, useEffect } from 'react';
import { Power, Loader2, Play, Square, Eye, EyeOff } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

interface CameraStatus {
  cameraId: string;
  running: boolean;
  pid?: number;
}

const CAMERAS = [
  { id: 'front_door', label: 'Front', color: 'blue' },
  { id: 'camera_2', label: 'Yard', color: 'green' },
  { id: 'camera_3', label: 'Back', color: 'purple' },
  { id: 'camera_4', label: 'Cam 4', color: 'orange' },
  { id: 'camera_5', label: 'Cam 5', color: 'pink' },
  { id: 'simulation', label: 'Sim', color: 'cyan' },
];

export default function CameraToggles() {
  const [statuses, setStatuses] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [fetching, setFetching] = useState(true);
  const [allLoading, setAllLoading] = useState(false);

  // Fetch current status
  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/monitor/status`);
      const data = await res.json();
      if (data.success) {
        const statusMap: Record<string, boolean> = {};
        CAMERAS.forEach(cam => statusMap[cam.id] = false);
        data.cameras?.forEach((cam: CameraStatus) => {
          statusMap[cam.cameraId] = cam.running;
        });
        setStatuses(statusMap);
      }
    } catch (err) {
      console.error('Failed to fetch monitor status:', err);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  const toggleCamera = async (cameraId: string) => {
    const isRunning = statuses[cameraId];
    setLoading(prev => ({ ...prev, [cameraId]: true }));

    try {
      if (isRunning) {
        await fetch(`${API_BASE}/api/monitor/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cameraId }),
        });
        setStatuses(prev => ({ ...prev, [cameraId]: false }));
      } else {
        await fetch(`${API_BASE}/api/monitor/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cameraId,
            rtspUrl: `rtsp://127.0.0.1:8554/${cameraId}`,
          }),
        });
        setStatuses(prev => ({ ...prev, [cameraId]: true }));
      }
    } catch (err) {
      console.error(`Failed to toggle ${cameraId}:`, err);
    } finally {
      setLoading(prev => ({ ...prev, [cameraId]: false }));
    }
  };

  const startAll = async () => {
    setAllLoading(true);
    for (const cam of CAMERAS) {
      if (!statuses[cam.id]) {
        await fetch(`${API_BASE}/api/monitor/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cameraId: cam.id,
            rtspUrl: `rtsp://127.0.0.1:8554/${cam.id}`,
          }),
        });
      }
    }
    await fetchStatus();
    setAllLoading(false);
  };

  const stopAll = async () => {
    setAllLoading(true);
    await fetch(`${API_BASE}/api/monitor/stop-all`, { method: 'POST' });
    await fetchStatus();
    setAllLoading(false);
  };

  const activeCount = Object.values(statuses).filter(Boolean).length;

  if (fetching) {
    return (
      <div className="flex items-center gap-2 text-gray-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      {/* Active count badge */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 rounded-md border border-gray-700">
        <Eye className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs font-medium text-gray-300">
          <span className={activeCount > 0 ? 'text-green-400' : 'text-gray-500'}>{activeCount}</span>
          <span className="text-gray-500">/{CAMERAS.length}</span>
        </span>
      </div>

      {/* Camera toggle pills */}
      <div className="flex items-center gap-1">
        {CAMERAS.map(cam => {
          const isRunning = statuses[cam.id];
          const isLoading = loading[cam.id];

          return (
            <button
              key={cam.id}
              onClick={() => toggleCamera(cam.id)}
              disabled={isLoading || allLoading}
              title={`${cam.label}: ${isRunning ? 'Running' : 'Stopped'}`}
              className={`
                relative px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-200
                ${isLoading || allLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
                ${isRunning
                  ? 'bg-green-600/20 text-green-400 border border-green-500/50 hover:bg-green-600/30'
                  : 'bg-gray-800 text-gray-500 border border-gray-700 hover:bg-gray-700 hover:text-gray-300'
                }
              `}
            >
              {isLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
                  {cam.label}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="w-px h-6 bg-gray-700" />

      {/* Quick actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={startAll}
          disabled={allLoading || activeCount === CAMERAS.length}
          title="Start All Cameras"
          className={`
            p-1.5 rounded-md transition-colors
            ${allLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
            ${activeCount === CAMERAS.length
              ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
              : 'bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-500/30'
            }
          `}
        >
          {allLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" fill="currentColor" />
          )}
        </button>
        <button
          onClick={stopAll}
          disabled={allLoading || activeCount === 0}
          title="Stop All Cameras"
          className={`
            p-1.5 rounded-md transition-colors
            ${allLoading ? 'opacity-50 cursor-wait' : 'cursor-pointer'}
            ${activeCount === 0
              ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
              : 'bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/30'
            }
          `}
        >
          <Square className="w-4 h-4" fill="currentColor" />
        </button>
      </div>
    </div>
  );
}
