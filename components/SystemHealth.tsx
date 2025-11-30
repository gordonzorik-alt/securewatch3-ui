'use client';

import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

interface SystemStatus {
  status: 'healthy' | 'warning' | 'degraded' | 'critical' | 'error';
  timestamp: string;
  uptime: number;
  uptimeFormatted: string;
  network: {
    status: string;
    host: string;
    port: number;
  };
  database: {
    status: string;
    latencyMs?: number;
    error?: string;
  };
  redis: {
    status: string;
    latencyMs?: number;
    error?: string;
  };
  detectors: {
    activeCount: number;
    stalledCount: number;
    detectors: Record<string, {
      status: string;
      lastHeartbeat: string;
      ageMs: number;
    }>;
    error?: string;
  };
  monitors: {
    activeCount: number;
    monitors: Record<string, {
      status: string;
      pid: number | null;
      uptime: number;
    }>;
    error?: string;
  };
  issues: string[];
}

export default function SystemHealth() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/system/health`);
      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('[SystemHealth] Failed to fetch:', error);
      setStatus({
        status: 'error',
        timestamp: new Date().toISOString(),
        uptime: 0,
        uptimeFormatted: '—',
        network: { status: 'error', host: '—', port: 0 },
        database: { status: 'error', error: 'Connection failed' },
        redis: { status: 'error', error: 'Connection failed' },
        detectors: { activeCount: 0, stalledCount: 0, detectors: {} },
        monitors: { activeCount: 0, monitors: {} },
        issues: ['Failed to connect to server']
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and polling every 10 seconds
  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-500';
      case 'warning':
        return 'bg-yellow-500';
      case 'degraded':
        return 'bg-orange-500';
      case 'critical':
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  // Get component status indicator
  const getComponentStatus = (status: string) => {
    switch (status) {
      case 'ok':
        return { color: 'text-green-600', icon: 'check' };
      case 'unavailable':
        return { color: 'text-yellow-600', icon: 'warning' };
      case 'error':
        return { color: 'text-red-600', icon: 'x' };
      default:
        return { color: 'text-gray-400', icon: 'question' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full bg-gray-300 animate-pulse" />
        <span className="text-xs text-gray-400">Checking...</span>
      </div>
    );
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={() => setShowTooltip(!showTooltip)}
        className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors cursor-pointer"
      >
        <div className="relative">
          <span className={`w-2.5 h-2.5 rounded-full ${getStatusColor(status?.status || 'error')} block`} />
          {status?.status === 'healthy' && (
            <span className={`absolute top-0 left-0 w-2.5 h-2.5 rounded-full ${getStatusColor(status.status)} animate-ping opacity-75`} />
          )}
        </div>
        <span className="text-xs text-gray-500 hidden sm:inline">
          System {status?.status || 'Unknown'}
        </span>
      </button>

      {/* Tooltip with detailed status */}
      {showTooltip && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-[100]">
          {!status ? (
            <div className="text-center py-4">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-500">Connecting to server...</p>
              <p className="text-xs text-gray-400 mt-1">Check that the backend is running</p>
            </div>
          ) : (
            <>
          {/* Header */}
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
            <span className="font-semibold text-gray-800 text-sm">System Health</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              status.status === 'healthy' ? 'bg-green-100 text-green-700' :
              status.status === 'warning' ? 'bg-yellow-100 text-yellow-700' :
              status.status === 'degraded' ? 'bg-orange-100 text-orange-700' :
              'bg-red-100 text-red-700'
            }`}>
              {status.status.toUpperCase()}
            </span>
          </div>

          {/* Components */}
          <div className="space-y-2">
            {/* Database */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  status.database.status === 'ok' ? 'bg-green-500' :
                  status.database.status === 'unavailable' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-gray-600">Database</span>
              </div>
              <span className="text-gray-400">
                {status.database.status === 'ok' && status.database.latencyMs !== undefined
                  ? `${status.database.latencyMs}ms`
                  : status.database.status}
              </span>
            </div>

            {/* Redis */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  status.redis.status === 'ok' ? 'bg-green-500' :
                  status.redis.status === 'unavailable' ? 'bg-yellow-500' : 'bg-red-500'
                }`} />
                <span className="text-gray-600">Redis</span>
              </div>
              <span className="text-gray-400">
                {status.redis.status === 'ok' && status.redis.latencyMs !== undefined
                  ? `${status.redis.latencyMs}ms`
                  : status.redis.status}
              </span>
            </div>

            {/* Network */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-gray-600">Network</span>
              </div>
              <span className="text-gray-400">
                {status.network.host}:{status.network.port}
              </span>
            </div>

            {/* Monitors */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  status.monitors.activeCount > 0 ? 'bg-green-500' : 'bg-yellow-500'
                }`} />
                <span className="text-gray-600">Monitors</span>
              </div>
              <span className="text-gray-400">
                {status.monitors.activeCount} active
              </span>
            </div>

            {/* Detectors */}
            {(status.detectors.activeCount > 0 || status.detectors.stalledCount > 0) && (
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    status.detectors.stalledCount === 0 ? 'bg-green-500' : 'bg-yellow-500'
                  }`} />
                  <span className="text-gray-600">Detectors</span>
                </div>
                <span className="text-gray-400">
                  {status.detectors.activeCount} active
                  {status.detectors.stalledCount > 0 && `, ${status.detectors.stalledCount} stalled`}
                </span>
              </div>
            )}
          </div>

          {/* Issues */}
          {status.issues.length > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-100">
              <span className="text-xs font-medium text-red-600">Issues:</span>
              <ul className="mt-1 space-y-1">
                {status.issues.map((issue, idx) => (
                  <li key={idx} className="text-xs text-red-500 flex items-start gap-1">
                    <span className="mt-0.5">•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer */}
          <div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between">
            <span className="text-[10px] text-gray-400">
              Uptime: {status.uptimeFormatted}
            </span>
            <span className="text-[10px] text-gray-400">
              {new Date(status.timestamp).toLocaleTimeString()}
            </span>
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
