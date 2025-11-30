'use client';

import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import SetupWizard from './SetupWizard';
import ScoutSetup from './ScoutSetup';
import SystemHealth from './SystemHealth';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';
const MEDIAMTX_WEBRTC = 'http://136.119.129.106:8889';

// Detection with bounding box info
interface Detection {
  label: string;
  confidence: number;
  bbox?: number[];
  bbox_normalized?: number[];
}

// Event types from the backend
interface DetectionEvent {
  camera_id?: string;
  cameraId?: string;
  timestamp?: string;
  detection_count?: number;
  detections?: Detection[];
  frame_number?: number;
  mode?: 'LIVE' | 'HTTP' | 'UPLOAD';
  duration_sec?: number;
  yolo_detections?: Record<string, number>;
  severity?: 'high' | 'medium' | 'low';
}

interface MonitorStatus {
  activeCount: number;
  cameras: {
    cameraId: string;
    pid: number;
    sourceUrl: string;
    mode: string;
    startedAt: string;
    restartCount?: number;
  }[];
}

export default function ThreatDashboard() {
  const [mode, setMode] = useState<'LIVE' | 'HTTP' | 'UPLOAD'>('HTTP');
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [cameraId, setCameraId] = useState('front_door');
  const [sourceUrl, setSourceUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [currentDetections, setCurrentDetections] = useState<Detection[]>([]);
  const [lastStatusUpdate, setLastStatusUpdate] = useState<Date>(new Date());
  const [expandedCamera, setExpandedCamera] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<Array<{
    ip: string;
    port: number;
    vendor: string;
    model: string;
    needsAuth: boolean;
    suggestedUrl: string;
    status: string;
  }>>([]);
  const [showScanner, setShowScanner] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [showScout, setShowScout] = useState(false);

  // Socket.IO connection
  useEffect(() => {
    const socket: Socket = io(API_BASE, {
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log('[Socket.IO] Connected:', socket.id);
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[Socket.IO] Disconnected');
      setIsConnected(false);
    });

    // Subscribe to threat alerts
    socket.on('threat-alert', (event: DetectionEvent) => {
      console.log('[Socket.IO] Threat alert:', event);
      setEvents((prev) => [event, ...prev].slice(0, 50)); // Keep last 50 events
      // Update current detections for bounding box overlay
      if (event.detections) {
        setCurrentDetections(event.detections);
      }
    });

    // Subscribe to episode events
    socket.on('episode-received', (event: DetectionEvent) => {
      console.log('[Socket.IO] Episode received:', event);
      setEvents((prev) => [event, ...prev].slice(0, 50));
      // Update current detections for bounding box overlay
      if (event.detections) {
        setCurrentDetections(event.detections);
      }
    });

    // Also listen to detection:live (backend Redis subscriber emits this)
    socket.on('detection:live', (event: DetectionEvent) => {
      console.log('[Socket.IO] Live detection:', event);
      setEvents((prev) => [event, ...prev].slice(0, 50));
      if (event.detections) {
        setCurrentDetections(event.detections);
      }
    });

    // Also listen to episode:new (backend Redis subscriber emits this)
    socket.on('episode:new', (event: DetectionEvent) => {
      console.log('[Socket.IO] New episode:', event);
      setEvents((prev) => [event, ...prev].slice(0, 50));
      if (event.detections) {
        setCurrentDetections(event.detections);
      }
    });

    // Monitor status updates
    socket.on('monitor:started', (data) => {
      console.log('[Socket.IO] Monitor started:', data);
      setIsStreaming(true);
      fetchMonitorStatus();
    });

    socket.on('monitor:stopped', (data) => {
      console.log('[Socket.IO] Monitor stopped:', data);
      setIsStreaming(false);
      fetchMonitorStatus();
    });

    // Subscribe to camera-specific events
    socket.emit('subscribe', cameraId);

    return () => {
      socket.emit('unsubscribe', cameraId);
      socket.disconnect();
    };
  }, [cameraId]);

  // Fetch monitor status on mount
  const fetchMonitorStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/monitor/status`);
      const data = await response.json();
      if (data.success) {
        setMonitorStatus(data);
        setIsStreaming(data.activeCount > 0);
        setLastStatusUpdate(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch monitor status:', error);
    }
  }, []);

  // Auto-poll monitor status every 3 seconds for real-time updates
  useEffect(() => {
    fetchMonitorStatus();
    const interval = setInterval(fetchMonitorStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchMonitorStatus]);

  // Auto-sync to active HTTP camera on page load (RTSP-only mode – no snapshot polling)
  useEffect(() => {
    if (isStreaming && mode === 'HTTP') {
      // Find any active HTTP camera
      const activeHttpCamera = monitorStatus?.cameras?.find(cam => cam.mode === 'HTTP');

      if (activeHttpCamera) {
        // Auto-switch to the active camera if different
        if (activeHttpCamera.cameraId !== cameraId) {
          setCameraId(activeHttpCamera.cameraId);
          setSourceUrl(activeHttpCamera.sourceUrl);
        }
      }
    }
  }, [isStreaming, mode, monitorStatus, cameraId]);

  // Start live monitoring
  async function startLive() {
    if (!sourceUrl) {
      alert(mode === 'HTTP' ? 'Please enter an HTTP snapshot URL' : 'Please enter an RTSP URL');
      return;
    }

    try {
      const body: Record<string, string> = {
        cameraId,
        sourceUrl,
        mode
      };

      // Add credentials for HTTP mode
      if (mode === 'HTTP' && username) {
        body.username = username;
        body.password = password;
      }

      const response = await fetch(`${API_BASE}/api/monitor/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (data.success) {
        setIsStreaming(true);
        fetchMonitorStatus();

        // Register camera credentials for snapshot proxy (HTTP mode only)
        if (mode === 'HTTP') {
          await fetch(`${API_BASE}/api/camera/credentials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              cameraId,
              snapshotUrl: sourceUrl,
              username,
              password
            }),
          });
        }
      } else {
        alert(`Failed to start: ${data.error || data.message}`);
      }
    } catch (error) {
      console.error('Start live error:', error);
      alert('Failed to start monitoring');
    }
  }

  // Stop live monitoring
  async function stopLive() {
    try {
      const response = await fetch(`${API_BASE}/api/monitor/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cameraId }),
      });
      const data = await response.json();

      if (data.success) {
        setIsStreaming(false);
        fetchMonitorStatus();
        setCurrentDetections([]);
      }
    } catch (error) {
      console.error('Stop live error:', error);
    }
  }

  // Upload video file
  async function uploadFile() {
    if (!selectedFile) {
      alert('Please select a file');
      return;
    }

    setUploadProgress('Uploading...');

    try {
      const formData = new FormData();
      formData.append('video', selectedFile);

      const response = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (data.video) {
        setUploadProgress('Processing...');

        // Start detection on the uploaded video
        const detectResponse = await fetch(`${API_BASE}/api/detect/${data.video.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backend: 'yolo' }),
        });

        if (detectResponse.ok) {
          setUploadProgress('Detection started');
          setTimeout(() => setUploadProgress(null), 3000);
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadProgress('Upload failed');
      setTimeout(() => setUploadProgress(null), 3000);
    }
  }

  // Stop a specific camera by ID
  async function stopCamera(camId: string) {
    try {
      const response = await fetch(`${API_BASE}/api/monitor/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cameraId: camId }),
      });
      const data = await response.json();
      if (data.success) {
        fetchMonitorStatus();
        if (camId === cameraId) {
          setIsStreaming(false);
          setCurrentDetections([]);
        }
      }
    } catch (error) {
      console.error('Stop camera error:', error);
    }
  }

  // Calculate uptime from startedAt timestamp
  const getUptime = (startedAt: string) => {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMs = now - start;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ${diffHours % 24}h`;
    if (diffHours > 0) return `${diffHours}h ${diffMins % 60}m`;
    return `${diffMins}m`;
  };

  // Format timestamp
  const formatTime = (timestamp?: string) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  // Get severity color
  const getSeverityColor = (event: DetectionEvent) => {
    if (event.severity === 'high') return 'bg-red-500';
    if (event.severity === 'medium') return 'bg-orange-400';
    if (event.severity === 'low') return 'bg-yellow-400';
    return 'bg-blue-400';
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-bold text-gray-900">Live Threat Monitor</h1>
          <SystemHealth />
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm text-gray-500">
            {isConnected ? 'Connected to server' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setMode('HTTP')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            mode === 'HTTP'
              ? 'bg-green-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Live Camera
        </button>
        <button
          onClick={() => setMode('UPLOAD')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
            mode === 'UPLOAD'
              ? 'bg-blue-500 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          File Upload
        </button>
      </div>

      {/* HTTP Mode Controls */}
      {mode === 'HTTP' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            HTTP Camera Configuration (Hikvision/ISAPI)
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Camera ID</label>
              <input
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
                placeholder="e.g., front_door"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Snapshot URL</label>
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="http://192.168.1.100:8001/ISAPI/Streaming/channels/101/picture"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="password"
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={startLive}
                disabled={isStreaming}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                {isStreaming ? 'Monitoring...' : 'Start Monitoring'}
              </button>
              <button
                onClick={stopLive}
                disabled={!isStreaming}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                Stop
              </button>
            </div>

            {/* Network Scanner */}
            <div className="pt-3 border-t border-gray-200 mt-3">
              <button
                onClick={async () => {
                  setShowScanner(true);
                  setIsScanning(true);
                  setScanResults([]);
                  try {
                    const response = await fetch(`${API_BASE}/api/setup/scan`);
                    const data = await response.json();
                    if (data.success) {
                      setScanResults(data.cameras);
                    }
                  } catch (error) {
                    console.error('Scan failed:', error);
                  } finally {
                    setIsScanning(false);
                  }
                }}
                disabled={isScanning}
                className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isScanning ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Scanning Network...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Scan Network for Cameras
                  </>
                )}
              </button>

              {/* Scan Results */}
              {showScanner && (
                <div className="mt-3 space-y-2">
                  {isScanning && (
                    <div className="text-center py-4">
                      <div className="inline-flex items-center gap-2 text-purple-600">
                        <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
                        <span className="text-sm font-medium">Discovering cameras on your network...</span>
                      </div>
                    </div>
                  )}

                  {!isScanning && scanResults.length === 0 && (
                    <div className="text-center py-4 text-gray-500 text-sm">
                      No cameras found. Make sure cameras are powered on and connected to your network.
                    </div>
                  )}

                  {!isScanning && scanResults.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm text-gray-600 font-medium">
                        Found {scanResults.length} camera{scanResults.length > 1 ? 's' : ''}:
                      </div>
                      {scanResults.map((cam, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setCameraId(`camera_${cam.ip.split('.').pop()}`);
                            setSourceUrl(cam.suggestedUrl);
                            setShowScanner(false);
                          }}
                          className="p-3 bg-purple-50 border border-purple-200 rounded-lg cursor-pointer hover:bg-purple-100 hover:border-purple-300 transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <div>
                                <div className="font-semibold text-gray-800">{cam.vendor}</div>
                                <div className="text-sm text-gray-500">{cam.ip}:{cam.port}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {cam.needsAuth && (
                                <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">
                                  Needs Auth
                                </span>
                              )}
                              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Active Monitors - Enhanced Command Center */}
          {monitorStatus && monitorStatus.activeCount > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Active Monitors ({monitorStatus.activeCount})
                </h4>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowScout(true)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <span>🔍</span>
                    Scout Setup
                  </button>
                  <button
                    onClick={() => setShowSetupWizard(true)}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    Manual
                  </button>
                  <span className="text-xs text-gray-400">
                    Updated: {lastStatusUpdate.toLocaleTimeString()}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                {monitorStatus.cameras.map((cam) => (
                  <div key={cam.cameraId} className="flex items-center justify-between text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 hover:border-blue-300 transition-all group">
                    <div className="flex items-center gap-3">
                      {/* Animated pulse indicator */}
                      <div className="relative">
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500 block animate-pulse" />
                        <span className="absolute top-0 left-0 w-2.5 h-2.5 rounded-full bg-green-500 animate-ping opacity-75" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-800">{cam.cameraId}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded-full font-mono">
                            PID: {cam.pid}
                          </span>
                          {cam.restartCount && cam.restartCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              {cam.restartCount}x
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 font-mono truncate max-w-[250px]" title={cam.sourceUrl}>
                          {cam.sourceUrl}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Uptime</p>
                        <p className="text-xs font-mono text-gray-600">{getUptime(cam.startedAt)}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        cam.mode === 'HTTP' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {cam.mode}
                      </span>
                      <button
                        onClick={() => stopCamera(cam.cameraId)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                        title="Stop monitoring"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="6" width="12" height="12" rx="1" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Multi-Camera Live Preview Grid */}
      {mode === 'HTTP' && isStreaming && showPreview && monitorStatus && monitorStatus.activeCount > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live Cameras ({monitorStatus.activeCount})
            </h3>
            <div className="flex items-center gap-2">
              {/* RTSP-only mode – no toggle needed */}
              {expandedCamera && (
                <button
                  onClick={() => setExpandedCamera(null)}
                  className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                >
                  Show Grid
                </button>
              )}
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title="Hide preview"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Expanded single camera view – MediaMTX WebRTC */}
          {expandedCamera && (
            <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '16/9' }}>
              <iframe
                src={`${MEDIAMTX_WEBRTC}/${expandedCamera}/`}
                className="w-full h-full border-none"
                allow="autoplay"
                title={`Live feed from ${expandedCamera}`}
              />
              <div className="absolute bottom-2 left-2 bg-black/70 text-white text-sm font-medium px-2 py-1 rounded flex items-center gap-2">
                {expandedCamera}
                <span className="text-xs text-green-400">WebRTC</span>
              </div>
            </div>
          )}

          {/* Camera grid view – MediaMTX WebRTC */}
          {!expandedCamera && (
            <div className={`grid gap-3 ${
              monitorStatus.activeCount === 1 ? 'grid-cols-1' :
              monitorStatus.activeCount === 2 ? 'grid-cols-2' :
              monitorStatus.activeCount <= 4 ? 'grid-cols-2' :
              'grid-cols-3'
            }`}>
              {monitorStatus.cameras.map((cam) => (
                <div
                  key={`${cam.cameraId}-webrtc`}
                  className="relative bg-black rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
                  style={{ aspectRatio: '16/9' }}
                  onClick={() => setExpandedCamera(cam.cameraId)}
                >
                  <iframe
                    src={`${MEDIAMTX_WEBRTC}/${cam.cameraId}/`}
                    className="w-full h-full border-none pointer-events-none"
                    allow="autoplay"
                    title={`Live feed from ${cam.cameraId}`}
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <span className="text-white text-xs font-medium">{cam.cameraId}</span>
                  </div>
                  {/* Live indicator */}
                  <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/50 px-1.5 py-0.5 rounded">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-white text-[10px] font-medium">WebRTC</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 text-xs text-gray-500">
            <span>MediaMTX WebRTC (ultra-low latency)</span>
          </div>
        </div>
      )}

      {/* Show Preview button when hidden */}
      {mode === 'HTTP' && isStreaming && !showPreview && (
        <button
          onClick={() => setShowPreview(true)}
          className="w-full mb-6 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Show Live Preview
        </button>
      )}

      {/* RTSP Mode Controls */}
      {mode === 'LIVE' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            RTSP Stream Configuration
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Camera ID</label>
              <input
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
                placeholder="e.g., front_door"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">RTSP URL</label>
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="rtsp://user:pass@192.168.1.100:554/stream"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={startLive}
                disabled={isStreaming}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                {isStreaming ? 'Streaming...' : 'Start Live'}
              </button>
              <button
                onClick={stopLive}
                disabled={!isStreaming}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
              >
                Stop Live
              </button>
            </div>
          </div>

          {/* Active Streams - Enhanced Command Center */}
          {monitorStatus && monitorStatus.activeCount > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Active Streams ({monitorStatus.activeCount})
                </h4>
                <span className="text-xs text-gray-400">
                  Updated: {lastStatusUpdate.toLocaleTimeString()}
                </span>
              </div>
              <div className="space-y-2">
                {monitorStatus.cameras.map((cam) => (
                  <div key={cam.cameraId} className="flex items-center justify-between text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 hover:border-red-300 transition-all group">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 block animate-pulse" />
                        <span className="absolute top-0 left-0 w-2.5 h-2.5 rounded-full bg-red-500 animate-ping opacity-75" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-800">{cam.cameraId}</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded-full font-mono">
                            PID: {cam.pid}
                          </span>
                          {cam.restartCount && cam.restartCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              {cam.restartCount}x
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 font-mono truncate max-w-[250px]" title={cam.sourceUrl}>
                          {cam.sourceUrl}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Uptime</p>
                        <p className="text-xs font-mono text-gray-600">{getUptime(cam.startedAt)}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        cam.mode === 'HTTP' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {cam.mode}
                      </span>
                      <button
                        onClick={() => stopCamera(cam.cameraId)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                        title="Stop streaming"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="6" width="12" height="12" rx="1" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upload Mode Controls */}
      {mode === 'UPLOAD' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Upload Video File
          </h3>
          <div className="space-y-3">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="hidden"
                id="video-upload"
              />
              <label
                htmlFor="video-upload"
                className="cursor-pointer flex flex-col items-center"
              >
                <svg className="w-10 h-10 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                {selectedFile ? (
                  <span className="text-sm text-gray-900 font-medium">{selectedFile.name}</span>
                ) : (
                  <span className="text-sm text-gray-500">Click to select a video file</span>
                )}
              </label>
            </div>
            <button
              onClick={uploadFile}
              disabled={!selectedFile || !!uploadProgress}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
            >
              {uploadProgress || 'Upload & Analyze'}
            </button>
          </div>
        </div>
      )}

      {/* Event Feed */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Threat Feed</h3>
          <span className="text-xs text-gray-500">{events.length} events</span>
        </div>

        {events.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <p className="text-gray-500 text-sm">No threat events yet</p>
            <p className="text-gray-400 text-xs mt-1">
              {mode === 'LIVE' ? 'Start a live stream to begin monitoring' : 'Upload a video to analyze'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {events.map((event, idx) => (
              <div key={idx} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${getSeverityColor(event)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900 text-sm">
                        {event.camera_id || event.cameraId || 'Unknown'}
                      </span>
                      {event.mode && (
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          event.mode === 'LIVE' ? 'bg-red-100 text-red-700' :
                          event.mode === 'HTTP' ? 'bg-green-100 text-green-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>
                          {event.mode}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatTime(event.timestamp)}
                      {event.detection_count !== undefined && (
                        <span className="ml-2">{event.detection_count} detections</span>
                      )}
                      {event.yolo_detections && (
                        <span className="ml-2">
                          {Object.entries(event.yolo_detections).map(([k, v]) => `${k}: ${v}`).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Setup Wizard Modal */}
      {showSetupWizard && (
        <SetupWizard
          onComplete={() => {
            setShowSetupWizard(false);
            fetchMonitorStatus();
          }}
          onCancel={() => setShowSetupWizard(false)}
        />
      )}

      {/* Scout Chat Assistant */}
      {showScout && (
        <ScoutSetup
          onComplete={() => {
            setShowScout(false);
            fetchMonitorStatus();
          }}
          onCancel={() => setShowScout(false)}
        />
      )}
    </div>
  );
}
