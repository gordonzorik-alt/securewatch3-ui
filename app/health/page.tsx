'use client';

import { useState, useEffect } from 'react';
import {
  Activity, Cpu, HardDrive, Database, Server, Wifi,
  AlertTriangle, CheckCircle, XCircle, RefreshCw,
  Skull, Zap, Radio, MemoryStick, Camera, Video, Brain
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://136.119.129.106:4000';

interface DeepHealth {
  timestamp: string;
  cpu: {
    loadAvg: number;
    cores: number;
    currentLoad: number;
  };
  memory: {
    totalMB: number;
    usedMB: number;
    usedPercent: number;
  };
  disk: {
    totalGB: number;
    usedGB: number;
    usedPercent: number;
  };
  zombies: number;
  services: {
    api: { running: boolean; port: number };
    rtsp: { running: boolean; port: number };
    hls: { running: boolean; port: number };
    redis: { running: boolean; port: number };
  };
  status: 'HEALTHY' | 'WARNING' | 'DEGRADED' | 'CRITICAL' | 'ERROR';
  error?: string;
}

interface HealthStatus {
  status: 'healthy' | 'warning' | 'degraded' | 'critical';
  timestamp: string;
  uptime: number;
  uptimeFormatted: string;
  detectionReady: boolean;
  database: { status: string; latencyMs?: number; error?: string };
  redis: { status: string; latencyMs?: number; error?: string };
  mediamtx: { status: string; port?: number; error?: string };
  python: { status: string; python?: string; yolo?: string; model?: string; error?: string };
  pm2Workers: { status: string; total: number; online: number; stopped: number; errored: number };
  disk: { status: string; usedPercent?: number; available?: string; snapshots?: number };
  network: { status: string; host: string; port: number };
  monitors: { activeCount: number };
  detectors: { activeCount: number; stalledCount: number };
  issues: string[];
}

interface CameraInfo {
  id: string;
  name: string;
  enabled: boolean;
  status: 'live' | 'enabled' | 'disabled';
  priority: number;
}

interface CamerasStatus {
  success: boolean;
  cameras: CameraInfo[];
  activeCount: number;
}

interface LLMStats {
  success: boolean;
  models: {
    [key: string]: {
      calls: number;
      errors: number;
      inputTokens: number;
      outputTokens: number;
    };
  };
  total: {
    calls: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
  };
  lastCall?: {
    model: string;
    success: boolean;
    timestamp: string;
  };
  activeProvider?: {
    provider: string;
    model: string;
    configured: string;
  };
}

// Circular gauge component
function CircularGauge({
  value,
  max,
  label,
  unit,
  color,
  icon: Icon,
  warning = 75,
  critical = 90
}: {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
  icon: React.ElementType;
  warning?: number;
  critical?: number;
}) {
  const percentage = Math.min((value / max) * 100, 100);
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const getColor = () => {
    if (percentage >= critical) return 'text-red-500';
    if (percentage >= warning) return 'text-amber-500';
    return color;
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <svg className="w-28 h-28 transform -rotate-90">
          <circle
            cx="56"
            cy="56"
            r="45"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            className="text-gray-700"
          />
          <circle
            cx="56"
            cy="56"
            r="45"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            className={`transition-all duration-500 ${getColor()}`}
            style={{
              strokeDasharray: circumference,
              strokeDashoffset: strokeDashoffset,
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon className={`w-5 h-5 mb-1 ${getColor()}`} />
          <span className={`text-xl font-bold ${getColor()}`}>
            {percentage.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="mt-2 text-center">
        <div className="text-sm font-medium text-gray-300">{label}</div>
        <div className="text-xs text-gray-500">{value.toLocaleString()}{unit} / {max.toLocaleString()}{unit}</div>
      </div>
    </div>
  );
}

// Service status indicator
function ServiceStatus({
  name,
  running,
  port,
  icon: Icon
}: {
  name: string;
  running: boolean;
  port: number;
  icon: React.ElementType;
}) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${
      running
        ? 'bg-green-900/20 border-green-500/30'
        : 'bg-red-900/20 border-red-500/30'
    }`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${running ? 'text-green-400' : 'text-red-400'}`} />
        <div>
          <div className="font-medium text-white">{name}</div>
          <div className="text-xs text-gray-400">Port {port}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {running ? (
          <>
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-green-400 text-sm font-medium">RUNNING</span>
          </>
        ) : (
          <>
            <span className="w-2 h-2 bg-red-400 rounded-full" />
            <span className="text-red-400 text-sm font-medium">STOPPED</span>
          </>
        )}
      </div>
    </div>
  );
}

// Status badge
function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; border: string }> = {
    HEALTHY: { bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-500/50' },
    healthy: { bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-500/50' },
    ok: { bg: 'bg-green-900/30', text: 'text-green-400', border: 'border-green-500/50' },
    WARNING: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-500/50' },
    warning: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-500/50' },
    DEGRADED: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-500/50' },
    degraded: { bg: 'bg-amber-900/30', text: 'text-amber-400', border: 'border-amber-500/50' },
    CRITICAL: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-500/50' },
    critical: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-500/50' },
    error: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-500/50' },
    ERROR: { bg: 'bg-red-900/30', text: 'text-red-400', border: 'border-red-500/50' },
  };
  const c = config[status] || { bg: 'bg-gray-800', text: 'text-gray-400', border: 'border-gray-600' };
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-bold border ${c.bg} ${c.text} ${c.border}`}>
      {status.toUpperCase()}
    </span>
  );
}

// GPT-5.1 & Gemini 2.5 Pro Pricing (per million tokens) - prompts ≤ 200K context
// Both providers have IDENTICAL pricing as of December 2025!
// GPT-5.1: OpenAI's flagship model for advanced reasoning, coding, and agentic tasks
// Gemini 2.5 Pro: Google's multimodal reasoning model
// ~80% cheaper than Claude 3.5 Sonnet ($3/M input, $15/M output)
const PRICING = {
  inputPerMillion: 1.25,   // $1.25 per million input tokens
  outputPerMillion: 10.00, // $10.00 per million output tokens
  imagePerUnit: 0.0006,    // ~$0.0006 per image (vision/multimodal)
};

// Calculate cost from token counts
function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * PRICING.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * PRICING.outputPerMillion;
  return inputCost + outputCost;
}

// Cache keys for localStorage
const CACHE_KEYS = {
  deep: 'securewatch_health_deep',
  basic: 'securewatch_health_basic',
  cameras: 'securewatch_health_cameras',
  llmStats: 'securewatch_health_llmStats',
  lastRefresh: 'securewatch_health_lastRefresh'
};

// Load cached data from localStorage
function loadCached<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(key);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// Save to localStorage
function saveCache(key: string, data: unknown) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

export default function HealthPage() {
  // Initialize as null - load from cache in useEffect to avoid hydration mismatch
  const [deepHealth, setDeepHealth] = useState<DeepHealth | null>(null);
  const [basicHealth, setBasicHealth] = useState<HealthStatus | null>(null);
  const [cameras, setCameras] = useState<CamerasStatus | null>(null);
  const [llmStats, setLlmStats] = useState<LLMStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [mounted, setMounted] = useState(false);
  const REFRESH_INTERVAL = 10; // seconds

  const fetchHealth = async (isManual = false) => {
    // Only show full loading if no cached data
    if (!deepHealth && !basicHealth) {
      setLoading(true);
    }
    if (isManual) {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const [deepRes, basicRes, camerasRes, llmRes] = await Promise.all([
        fetch(`${API_BASE}/api/health/deep`),
        fetch(`${API_BASE}/api/health`),
        fetch(`${API_BASE}/api/cameras/status`),
        fetch(`${API_BASE}/api/llm/stats`)
      ]);

      if (deepRes.ok) {
        const deepData = await deepRes.json();
        setDeepHealth(deepData);
        saveCache(CACHE_KEYS.deep, deepData);
      }

      if (basicRes.ok) {
        const basicData = await basicRes.json();
        setBasicHealth(basicData);
        saveCache(CACHE_KEYS.basic, basicData);
      }

      if (camerasRes.ok) {
        const camerasData = await camerasRes.json();
        setCameras(camerasData);
        saveCache(CACHE_KEYS.cameras, camerasData);
      }

      if (llmRes.ok) {
        const llmData = await llmRes.json();
        setLlmStats(llmData);
        saveCache(CACHE_KEYS.llmStats, llmData);
      }

      const now = new Date();
      setLastRefresh(now);
      saveCache(CACHE_KEYS.lastRefresh, now.toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health status');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    // Load cached data on mount (client-side only)
    setMounted(true);
    const cachedDeep = loadCached<DeepHealth>(CACHE_KEYS.deep);
    const cachedBasic = loadCached<HealthStatus>(CACHE_KEYS.basic);
    const cachedCameras = loadCached<CamerasStatus>(CACHE_KEYS.cameras);
    const cachedLlm = loadCached<LLMStats>(CACHE_KEYS.llmStats);
    const cachedRefresh = loadCached<string>(CACHE_KEYS.lastRefresh);

    if (cachedDeep) setDeepHealth(cachedDeep);
    if (cachedBasic) setBasicHealth(cachedBasic);
    if (cachedCameras) setCameras(cachedCameras);
    if (cachedLlm) setLlmStats(cachedLlm);
    if (cachedRefresh) setLastRefresh(new Date(cachedRefresh));

    fetchHealth();

    // Refresh data every REFRESH_INTERVAL seconds
    const dataInterval = setInterval(() => {
      fetchHealth();
      setCountdown(REFRESH_INTERVAL);
    }, REFRESH_INTERVAL * 1000);

    // Countdown timer - tick every second
    const countdownInterval = setInterval(() => {
      setCountdown(c => c > 0 ? c - 1 : REFRESH_INTERVAL);
    }, 1000);

    return () => {
      clearInterval(dataInterval);
      clearInterval(countdownInterval);
    };
  }, []);

  const overallStatus = deepHealth?.status || basicHealth?.status || 'UNKNOWN';

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Activity className="w-8 h-8 text-blue-500" />
              System Health Dashboard
            </h1>
            <p className="text-gray-400 mt-1 flex items-center gap-3">
              {!mounted ? (
                'Loading...'
              ) : lastRefresh ? (
                <>
                  Last updated: {lastRefresh.toLocaleTimeString()}
                  {isRefreshing ? (
                    <span className="text-blue-400">(refreshing...)</span>
                  ) : (
                    <span className="text-gray-500 text-sm">
                      Next refresh in <span className="font-mono text-blue-400">{countdown}s</span>
                    </span>
                  )}
                </>
              ) : (
                'Fetching...'
              )}
            </p>
          </div>
          <button
            onClick={() => fetchHealth(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 disabled:opacity-50 text-white"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-lg text-red-400 flex items-center gap-3">
            <XCircle className="w-5 h-5" />
            <span><strong>Error:</strong> {error}</span>
          </div>
        )}

        {/* Overall Status Banner */}
        <div className={`mb-8 p-6 rounded-xl border-2 ${
          overallStatus === 'HEALTHY' || overallStatus === 'healthy' ? 'border-green-500 bg-green-900/20' :
          overallStatus === 'WARNING' || overallStatus === 'warning' || overallStatus === 'DEGRADED' || overallStatus === 'degraded' ? 'border-amber-500 bg-amber-900/20' :
          'border-red-500 bg-red-900/20'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {overallStatus === 'HEALTHY' || overallStatus === 'healthy' ? (
                <CheckCircle className="w-12 h-12 text-green-400" />
              ) : overallStatus === 'WARNING' || overallStatus === 'warning' || overallStatus === 'DEGRADED' || overallStatus === 'degraded' ? (
                <AlertTriangle className="w-12 h-12 text-amber-400" />
              ) : (
                <XCircle className="w-12 h-12 text-red-400" />
              )}
              <div>
                <h2 className="text-2xl font-bold text-white">
                  System Status
                </h2>
                <p className="text-gray-400">
                  {basicHealth?.uptimeFormatted ? `Uptime: ${basicHealth.uptimeFormatted}` : 'Monitoring all services'}
                </p>
              </div>
            </div>
            <StatusBadge status={overallStatus} />
          </div>
        </div>

        {/* Deep Health Metrics */}
        {deepHealth && (
          <>
            {/* Resource Gauges */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Server className="w-5 h-5 text-blue-500" />
                Server Resources
              </h3>
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {/* CPU Load */}
                  <CircularGauge
                    value={deepHealth.cpu.loadAvg}
                    max={deepHealth.cpu.cores}
                    label="CPU Load"
                    unit=""
                    color="text-blue-500"
                    icon={Cpu}
                    warning={75}
                    critical={100}
                  />

                  {/* Memory */}
                  <CircularGauge
                    value={deepHealth.memory.usedMB}
                    max={deepHealth.memory.totalMB}
                    label="Memory"
                    unit=" MB"
                    color="text-purple-500"
                    icon={MemoryStick}
                    warning={75}
                    critical={90}
                  />

                  {/* Disk */}
                  <CircularGauge
                    value={deepHealth.disk.usedGB}
                    max={deepHealth.disk.totalGB}
                    label="Disk"
                    unit=" GB"
                    color="text-cyan-500"
                    icon={HardDrive}
                    warning={75}
                    critical={90}
                  />

                  {/* Zombie Counter */}
                  <div className="flex flex-col items-center">
                    <div className={`relative w-28 h-28 rounded-full flex flex-col items-center justify-center border-4 ${
                      deepHealth.zombies === 0
                        ? 'border-green-500 bg-green-900/20'
                        : deepHealth.zombies <= 3
                          ? 'border-amber-500 bg-amber-900/20'
                          : 'border-red-500 bg-red-900/20 animate-pulse'
                    }`}>
                      <Skull className={`w-8 h-8 mb-1 ${
                        deepHealth.zombies === 0 ? 'text-green-400' :
                        deepHealth.zombies <= 3 ? 'text-amber-400' : 'text-red-400'
                      }`} />
                      <span className={`text-3xl font-bold ${
                        deepHealth.zombies === 0 ? 'text-green-400' :
                        deepHealth.zombies <= 3 ? 'text-amber-400' : 'text-red-400'
                      }`}>
                        {deepHealth.zombies}
                      </span>
                    </div>
                    <div className="mt-2 text-center">
                      <div className="text-sm font-medium text-gray-300">Zombie Processes</div>
                      <div className="text-xs text-gray-500">detect_engine / vision_worker</div>
                    </div>
                  </div>
                </div>

                {/* Current Load Stat */}
                <div className="mt-6 pt-4 border-t border-gray-700">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Current CPU Usage:</span>
                    <span className="text-white font-mono">{deepHealth.cpu.currentLoad.toFixed(1)}%</span>
                  </div>
                  <div className="mt-2 w-full bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        deepHealth.cpu.currentLoad > 80 ? 'bg-red-500' :
                        deepHealth.cpu.currentLoad > 50 ? 'bg-amber-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(deepHealth.cpu.currentLoad, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Services Grid */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-500" />
                Core Services
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <ServiceStatus
                  name="API Server"
                  running={deepHealth.services.api.running}
                  port={deepHealth.services.api.port}
                  icon={Server}
                />
                <ServiceStatus
                  name="RTSP (MediaMTX)"
                  running={deepHealth.services.rtsp.running}
                  port={deepHealth.services.rtsp.port}
                  icon={Radio}
                />
                <ServiceStatus
                  name="HLS Streaming"
                  running={deepHealth.services.hls.running}
                  port={deepHealth.services.hls.port}
                  icon={Wifi}
                />
                <ServiceStatus
                  name="Redis"
                  running={deepHealth.services.redis.running}
                  port={deepHealth.services.redis.port}
                  icon={Database}
                />
              </div>
            </div>
          </>
        )}

        {/* Cameras Section */}
        {cameras && cameras.cameras && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Video className="w-5 h-5 text-cyan-500" />
              Camera Status
              <span className="text-sm font-normal text-gray-400">
                ({cameras.activeCount} live)
              </span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {cameras.cameras.map((cam) => (
                <div
                  key={cam.id}
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    cam.status === 'live'
                      ? 'bg-green-900/20 border-green-500/30'
                      : cam.status === 'enabled'
                        ? 'bg-amber-900/20 border-amber-500/30'
                        : 'bg-gray-800 border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Camera className={`w-5 h-5 ${
                      cam.status === 'live' ? 'text-green-400' :
                      cam.status === 'enabled' ? 'text-amber-400' : 'text-gray-500'
                    }`} />
                    <div>
                      <div className="font-medium text-white capitalize">{cam.name}</div>
                      <div className="text-xs text-gray-400">Priority {cam.priority}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {cam.status === 'live' ? (
                      <>
                        <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                        <span className="text-green-400 text-sm font-medium">LIVE</span>
                      </>
                    ) : cam.status === 'enabled' ? (
                      <>
                        <span className="w-2 h-2 bg-amber-400 rounded-full" />
                        <span className="text-amber-400 text-sm font-medium">ENABLED</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 bg-gray-500 rounded-full" />
                        <span className="text-gray-500 text-sm font-medium">DISABLED</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* LLM Stats Section */}
        {llmStats && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Brain className="w-5 h-5 text-violet-500" />
              AI Model Usage
              <span className="text-sm font-normal text-gray-400">
                ({llmStats.total?.calls || 0} total calls)
              </span>
            </h3>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
              {/* Active Provider Banner */}
              {llmStats.activeProvider && (
                <div className={`mb-4 p-4 rounded-lg flex items-center justify-between ${
                  llmStats.activeProvider.provider === 'openai'
                    ? 'bg-gradient-to-r from-green-900/40 to-emerald-900/30 border border-green-500/40'
                    : 'bg-gradient-to-r from-blue-900/40 to-indigo-900/30 border border-blue-500/40'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-400 animate-pulse" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-400">Active Model:</span>
                        <span className="font-mono text-lg text-white font-bold">
                          {llmStats.activeProvider.model}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {llmStats.activeProvider.provider === 'openai'
                          ? 'Flagship model for advanced reasoning, coding & agentic tasks'
                          : 'Multimodal reasoning with extended context'}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-sm px-3 py-1 rounded-full font-medium ${
                      llmStats.activeProvider.provider === 'openai'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    }`}>
                      {llmStats.activeProvider.provider === 'openai' ? 'OpenAI GPT-5.1' : 'Google Gemini'}
                    </span>
                    <span className="text-xs text-gray-500">
                      $1.25/M in • $10/M out
                    </span>
                  </div>
                </div>
              )}

              {/* Estimated Cost Banner */}
              {(() => {
                const totalCost = calculateCost(
                  llmStats.total?.inputTokens || 0,
                  llmStats.total?.outputTokens || 0
                );
                return (
                  <div className="mb-6 p-4 bg-gradient-to-r from-emerald-900/30 to-teal-900/30 border border-emerald-500/30 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-emerald-400 font-medium">Estimated API Cost</div>
                        <div className="text-xs text-gray-500 mt-1">
                          GPT-5.1 & Gemini 2.5 Pro have identical pricing
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-3xl font-bold text-emerald-400">
                          ${totalCost.toFixed(4)}
                        </div>
                        <div className="text-xs text-gray-500">
                          Input: ${PRICING.inputPerMillion}/M • Output: ${PRICING.outputPerMillion}/M
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Total Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center p-4 bg-gray-900/50 rounded-lg">
                  <div className="text-3xl font-bold text-violet-400">
                    {llmStats.total?.calls?.toLocaleString() || 0}
                  </div>
                  <div className="text-sm text-gray-400">Total Calls</div>
                </div>
                <div className="text-center p-4 bg-gray-900/50 rounded-lg">
                  <div className="text-3xl font-bold text-red-400">
                    {llmStats.total?.errors?.toLocaleString() || 0}
                  </div>
                  <div className="text-sm text-gray-400">Errors</div>
                </div>
                <div className="text-center p-4 bg-gray-900/50 rounded-lg">
                  <div className="text-3xl font-bold text-blue-400">
                    {((llmStats.total?.inputTokens || 0) / 1000).toFixed(1)}K
                  </div>
                  <div className="text-sm text-gray-400">Input Tokens</div>
                </div>
                <div className="text-center p-4 bg-gray-900/50 rounded-lg">
                  <div className="text-3xl font-bold text-green-400">
                    {((llmStats.total?.outputTokens || 0) / 1000).toFixed(1)}K
                  </div>
                  <div className="text-sm text-gray-400">Output Tokens</div>
                </div>
              </div>

              {/* Per-Model Stats */}
              {Object.keys(llmStats.models || {}).length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-gray-400 mb-2">By Model</h4>
                  {Object.entries(llmStats.models).map(([model, stats]) => {
                    const modelCost = calculateCost(stats.inputTokens, stats.outputTokens);
                    return (
                      <div
                        key={model}
                        className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Brain className="w-4 h-4 text-violet-400" />
                          <span className="font-mono text-sm text-white">{model}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-gray-400">
                            <span className="text-violet-400 font-medium">{stats.calls}</span> calls
                          </span>
                          {stats.errors > 0 && (
                            <span className="text-red-400">{stats.errors} errors</span>
                          )}
                          <span className="text-gray-500">
                            {((stats.inputTokens + stats.outputTokens) / 1000).toFixed(1)}K tokens
                          </span>
                          <span className="text-emerald-400 font-medium">
                            ${modelCost.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Last Call */}
              {llmStats.lastCall && (
                <div className="mt-4 pt-4 border-t border-gray-700 text-sm text-gray-500">
                  Last call: {llmStats.lastCall.model} at{' '}
                  {new Date(llmStats.lastCall.timestamp).toLocaleTimeString()}
                  {llmStats.lastCall.success ? (
                    <span className="text-green-400 ml-2">(success)</span>
                  ) : (
                    <span className="text-red-400 ml-2">(failed)</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Basic Health Details */}
        {basicHealth && (
          <>
            {/* Issues */}
            {basicHealth.issues && basicHealth.issues.length > 0 && (
              <div className="mb-8 p-4 bg-amber-900/20 border border-amber-500/50 rounded-lg">
                <h3 className="text-lg font-semibold flex items-center gap-2 text-amber-400 mb-3">
                  <AlertTriangle className="w-5 h-5" />
                  Issues Detected
                </h3>
                <ul className="space-y-2">
                  {basicHealth.issues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2 text-amber-300">
                      <span className="text-amber-500 mt-1">-</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Detailed Service Grid */}
            <div>
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-purple-500" />
                Service Details
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Database */}
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-3 text-gray-300">
                    <Database className="w-4 h-4" />
                    Database (SQLite)
                  </h4>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={basicHealth.database?.status || 'unknown'} />
                    {basicHealth.database?.latencyMs !== undefined && (
                      <span className="text-sm text-gray-400">{basicHealth.database.latencyMs}ms</span>
                    )}
                  </div>
                </div>

                {/* Python/YOLO */}
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-3 text-gray-300">
                    <Cpu className="w-4 h-4" />
                    Python / YOLO
                  </h4>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={basicHealth.python?.status || 'unknown'} />
                    {basicHealth.python?.model && (
                      <span className="text-sm text-gray-400">{basicHealth.python.model}</span>
                    )}
                  </div>
                </div>

                {/* PM2 Workers */}
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-3 text-gray-300">
                    <Activity className="w-4 h-4" />
                    PM2 Workers
                  </h4>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={basicHealth.pm2Workers?.status || 'unknown'} />
                    <span className="text-sm text-gray-400">
                      {basicHealth.pm2Workers?.online || 0}/{basicHealth.pm2Workers?.total || 0}
                    </span>
                  </div>
                </div>

                {/* Monitors */}
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-3 text-gray-300">
                    <Activity className="w-4 h-4" />
                    Camera Monitors
                  </h4>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={basicHealth.monitors?.activeCount > 0 ? 'ok' : 'warning'} />
                    <span className="text-sm text-gray-400">
                      {basicHealth.monitors?.activeCount || 0} active
                    </span>
                  </div>
                </div>

                {/* Detectors */}
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-3 text-gray-300">
                    <Zap className="w-4 h-4" />
                    Detectors
                  </h4>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={
                      basicHealth.detectors?.stalledCount === 0 && basicHealth.detectors?.activeCount > 0 ? 'ok' :
                      basicHealth.detectors?.stalledCount > 0 ? 'warning' : 'none'
                    } />
                    <span className="text-sm text-gray-400">
                      {basicHealth.detectors?.activeCount || 0} active
                    </span>
                  </div>
                  {(basicHealth.detectors?.stalledCount || 0) > 0 && (
                    <p className="text-xs text-amber-400 mt-2">
                      {basicHealth.detectors?.stalledCount} stalled
                    </p>
                  )}
                </div>

                {/* Disk Details */}
                <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2 mb-3 text-gray-300">
                    <HardDrive className="w-4 h-4" />
                    Disk Storage
                  </h4>
                  <div className="flex items-center justify-between mb-2">
                    <StatusBadge status={basicHealth.disk?.status || 'unknown'} />
                    <span className="text-sm text-gray-400">
                      {basicHealth.disk?.available || 'N/A'} free
                    </span>
                  </div>
                  {basicHealth.disk?.snapshots !== undefined && (
                    <p className="text-xs text-gray-500">
                      {basicHealth.disk.snapshots.toLocaleString()} snapshots stored
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {!deepHealth && !basicHealth && !loading && !error && (
          <div className="text-center py-12 text-gray-500">
            No health data available
          </div>
        )}

        {/* Timestamp footer */}
        {deepHealth?.timestamp && (
          <div className="mt-8 text-center text-sm text-gray-500">
            Server timestamp: {new Date(deepHealth.timestamp).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
