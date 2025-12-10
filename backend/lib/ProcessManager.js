/**
 * ProcessManager - Singleton for managing live detection Python processes
 *
 * Central manager to start/stop live Python detection processes per camera.
 * Each camera gets its own Python process running detect_engine.py.
 * Supports LIVE (RTSP) and HTTP (snapshot polling) modes.
 *
 * Features:
 * - Persistence: Saves monitor configs to disk, auto-restores on server restart
 * - Watchdog: Automatically restarts crashed processes
 * - Graceful shutdown: Properly terminates all processes on server exit
 */

import { spawn } from 'child_process';
import kill from 'tree-kill';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Persistence file path
const MONITORS_DB_PATH = path.join(process.cwd(), 'data', 'monitors.json');

class ProcessManager {
  constructor() {
    // Map of cameraId -> { process, pid, sourceUrl, mode, options, startedAt, restartCount }
    this.activeProcesses = new Map();

    // Set of cameraIds that are intentionally stopped (won't auto-restart)
    this.stoppedCameras = new Set();

    // Default endpoint for detection callbacks
    this.defaultEndpoint = process.env.DETECTION_ENDPOINT || 'http://localhost:4000/api/live/ingest';

    // Path to Python executable (use venv if available)
    const venvPython = path.join(process.cwd(), 'venv', 'bin', 'python3');
    if (fs.existsSync(venvPython)) {
      this.pythonPath = venvPython;
      console.log(`[ProcessManager] Using venv Python: ${venvPython}`);
    } else {
      this.pythonPath = process.env.PYTHON_PATH || 'python3';
    }

    // Watchdog settings - aggressive for 99.999% uptime
    this.maxRestartAttempts = 1000;  // Effectively unlimited restarts
    this.restartDelayMs = 2000;      // Wait 2 seconds before restart
    this.restartResetMs = 60000;     // Reset restart count after 1 minute of stability

    console.log('[ProcessManager] Initialized with persistence enabled');

    // Load saved monitors on startup (delayed to allow server to fully start)
    setTimeout(() => this.loadState(), 2000);

    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  /**
   * Load saved monitor configurations and restart them
   */
  loadState() {
    if (!fs.existsSync(MONITORS_DB_PATH)) {
      console.log('[ProcessManager] No saved monitors found');
      return;
    }

    try {
      const saved = JSON.parse(fs.readFileSync(MONITORS_DB_PATH, 'utf8'));
      console.log(`[ProcessManager] Found ${saved.length} saved monitor(s). Restoring...`);

      for (const monitor of saved) {
        if (monitor.enabled) {
          console.log(`[ProcessManager] Auto-starting saved monitor: ${monitor.cameraId}`);
          this.startProcess(monitor.cameraId, monitor.sourceUrl, {
            ...monitor.options,
            _fromRestore: true  // Flag to skip re-saving
          });
        }
      }
    } catch (error) {
      console.error('[ProcessManager] Failed to load saved monitors:', error.message);
    }
  }

  /**
   * Save current monitor configurations to disk
   */
  saveState() {
    try {
      const state = [];

      for (const [cameraId, info] of this.activeProcesses) {
        state.push({
          cameraId,
          sourceUrl: info.sourceUrl,
          mode: info.mode,
          enabled: true,
          options: {
            endpoint: info.endpoint,
            confidence: info.confidence,
            mode: info.mode,
            username: info.username,
            password: info.password
          },
          savedAt: new Date().toISOString()
        });
      }

      // Ensure data directory exists
      const dataDir = path.dirname(MONITORS_DB_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(MONITORS_DB_PATH, JSON.stringify(state, null, 2));
      console.log(`[ProcessManager] Saved ${state.length} monitor(s) to disk`);
    } catch (error) {
      console.error('[ProcessManager] Failed to save state:', error.message);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`\n[ProcessManager] Received ${signal}. Shutting down gracefully...`);
      await this.stopAll();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  /**
   * Start a live detection process for a camera.
   *
   * @param {string} cameraId - Unique identifier for the camera
   * @param {string} sourceUrl - RTSP stream URL or HTTP snapshot URL
   * @param {object} options - Optional configuration
   * @param {string} options.endpoint - Custom callback endpoint
   * @param {number} options.confidence - Detection confidence threshold
   * @param {string} options.mode - Detection mode: 'LIVE' (RTSP) or 'HTTP' (snapshot polling)
   * @param {string} options.username - HTTP auth username (for HTTP mode)
   * @param {string} options.password - HTTP auth password (for HTTP mode)
   * @param {boolean} options._fromRestore - Internal flag: skip saving if restoring from disk
   * @param {boolean} options._fromWatchdog - Internal flag: skip saving if from watchdog restart
   * @returns {object} Status object with status, pid, and message
   */
  startProcess(cameraId, sourceUrl, options = {}) {
    // Remove from stopped set if it was there
    this.stoppedCameras.delete(cameraId);

    // Check if process already running for this camera
    if (this.activeProcesses.has(cameraId)) {
      const existing = this.activeProcesses.get(cameraId);
      console.log(`[ProcessManager] Camera ${cameraId} already running (PID: ${existing.pid})`);
      return {
        status: 'already_running',
        pid: existing.pid,
        message: `Detection process already running for camera ${cameraId}`
      };
    }

    // Build script path
    const scriptPath = path.join(process.cwd(), 'detect_engine.py');

    // Build endpoint URL
    const endpoint = options.endpoint || this.defaultEndpoint;

    // Determine mode - default to LIVE for backward compatibility
    const mode = options.mode || 'LIVE';

    // Build command arguments
    const args = [
      scriptPath,
      '--mode', mode,
      '--source', sourceUrl,
      '--camid', cameraId,
      '--endpoint', endpoint
    ];

    // Add optional confidence threshold
    if (options.confidence) {
      args.push('--confidence', options.confidence.toString());
    }

    // Add HTTP auth credentials for HTTP mode
    if (mode === 'HTTP') {
      if (options.username) {
        args.push('--username', options.username);
      }
      if (options.password) {
        args.push('--password', options.password);
      }
    }

    console.log(`[ProcessManager] Starting process for camera ${cameraId}`);
    console.log(`[ProcessManager] Command: ${this.pythonPath} ${args.join(' ')}`);

    // Spawn Python process
    const pythonProcess = spawn(this.pythonPath, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Handle stdout - detection JSON output
    pythonProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        if (line.startsWith('DETECTION_JSON:')) {
          // Parse and log detection (could emit event here)
          try {
            const jsonStr = line.substring('DETECTION_JSON:'.length);
            const detection = JSON.parse(jsonStr);
            console.log(`[${cameraId}] Detection: ${detection.detection_count} objects at frame ${detection.frame_number}`);
          } catch (e) {
            console.log(`[${cameraId}] stdout: ${line}`);
          }
        } else {
          console.log(`[${cameraId}] stdout: ${line}`);
        }
      }
    });

    // Handle stderr - log messages from Python
    pythonProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        console.log(`[${cameraId}] ${line}`);
      }
    });

    // Handle process errors
    pythonProcess.on('error', (error) => {
      console.error(`[ProcessManager] Error spawning process for ${cameraId}:`, error.message);
      this.activeProcesses.delete(cameraId);
    });

    // Handle process close - WATCHDOG LOGIC
    pythonProcess.on('close', (code, signal) => {
      const exitReason = signal ? `signal ${signal}` : `code ${code}`;
      console.log(`[ProcessManager] Process for ${cameraId} exited with ${exitReason}`);

      const processInfo = this.activeProcesses.get(cameraId);

      // Only restart if:
      // 1. Process was in our active map (not already cleaned up)
      // 2. Camera wasn't intentionally stopped
      // 3. Haven't exceeded max restart attempts
      if (processInfo && !this.stoppedCameras.has(cameraId)) {
        const restartCount = (processInfo.restartCount || 0) + 1;

        if (restartCount <= this.maxRestartAttempts) {
          console.log(`[ProcessManager] ⚠️ Monitor ${cameraId} crashed. Respawning in ${this.restartDelayMs/1000}s... (attempt ${restartCount}/${this.maxRestartAttempts})`);

          // Remove old reference
          this.activeProcesses.delete(cameraId);

          // Schedule restart
          setTimeout(() => {
            if (!this.stoppedCameras.has(cameraId)) {
              this.startProcess(cameraId, sourceUrl, {
                ...options,
                _fromWatchdog: true,
                _restartCount: restartCount
              });
            }
          }, this.restartDelayMs);
        } else {
          console.error(`[ProcessManager] ❌ Monitor ${cameraId} exceeded max restart attempts (${this.maxRestartAttempts}). Giving up.`);
          this.activeProcesses.delete(cameraId);
          // Don't save state - keep config for manual restart
          // this.saveState();
        }
      } else {
        this.activeProcesses.delete(cameraId);
      }
    });

    // Store process info
    const processInfo = {
      process: pythonProcess,
      pid: pythonProcess.pid,
      cameraId,
      sourceUrl,
      mode,
      endpoint,
      confidence: options.confidence,
      username: options.username,
      password: options.password,
      startedAt: new Date().toISOString(),
      restartCount: options._restartCount || 0
    };

    this.activeProcesses.set(cameraId, processInfo);

    console.log(`[ProcessManager] Started process for ${cameraId} (PID: ${pythonProcess.pid})`);

    // Reset restart count after stability period
    if (processInfo.restartCount > 0) {
      setTimeout(() => {
        const current = this.activeProcesses.get(cameraId);
        if (current && current.pid === pythonProcess.pid) {
          current.restartCount = 0;
          console.log(`[ProcessManager] Reset restart count for ${cameraId} (stable for ${this.restartResetMs/1000}s)`);
        }
      }, this.restartResetMs);
    }

    // Save state unless this is a restore or watchdog restart
    if (!options._fromRestore && !options._fromWatchdog) {
      this.saveState();
    }

    return {
      status: 'started',
      pid: pythonProcess.pid,
      cameraId,
      message: `Detection process started for camera ${cameraId}`
    };
  }

  /**
   * Stop a live detection process for a camera.
   *
   * @param {string} cameraId - Camera identifier to stop
   * @returns {Promise<object>} Status object
   */
  stopProcess(cameraId) {
    return new Promise((resolve) => {
      // Mark as intentionally stopped so watchdog doesn't restart
      this.stoppedCameras.add(cameraId);

      const processInfo = this.activeProcesses.get(cameraId);

      if (!processInfo) {
        console.log(`[ProcessManager] No process found for camera ${cameraId}`);
        resolve({
          status: 'not_found',
          message: `No running process found for camera ${cameraId}`
        });
        return;
      }

      const { pid } = processInfo;
      console.log(`[ProcessManager] Stopping process for ${cameraId} (PID: ${pid})`);

      // Remove from map FIRST (before kill) to prevent watchdog restart
      this.activeProcesses.delete(cameraId);

      // Use tree-kill to kill process and all children
      kill(pid, 'SIGTERM', (err) => {
        if (err) {
          console.error(`[ProcessManager] Error killing process ${pid}:`, err.message);

          // Try SIGKILL as fallback
          kill(pid, 'SIGKILL', (killErr) => {
            if (killErr) {
              console.error(`[ProcessManager] SIGKILL also failed:`, killErr.message);
            }
          });
        }

        console.log(`[ProcessManager] Process for ${cameraId} stopped`);

        // Don't save state on stop - we want to preserve config for restart
        // this.saveState();

        resolve({
          status: 'stopped',
          pid,
          cameraId,
          message: `Detection process stopped for camera ${cameraId}`
        });
      });
    });
  }

  /**
   * Stop all running processes.
   *
   * @returns {Promise<object>} Status object with stopped count
   */
  async stopAll() {
    const cameraIds = Array.from(this.activeProcesses.keys());
    console.log(`[ProcessManager] Stopping all ${cameraIds.length} processes`);

    const results = await Promise.all(
      cameraIds.map(cameraId => this.stopProcess(cameraId))
    );

    return {
      status: 'stopped_all',
      count: results.length,
      cameras: cameraIds
    };
  }

  /**
   * Get status of all active processes.
   *
   * @returns {object} Status object with active cameras
   */
  getStatus() {
    const cameras = [];

    for (const [cameraId, info] of this.activeProcesses) {
      cameras.push({
        cameraId,
        pid: info.pid,
        sourceUrl: info.sourceUrl,
        mode: info.mode,
        endpoint: info.endpoint,
        startedAt: info.startedAt,
        restartCount: info.restartCount || 0,
        running: true
      });
    }

    return {
      activeCount: cameras.length,
      cameras
    };
  }

  /**
   * Check if a camera has an active process.
   *
   * @param {string} cameraId - Camera identifier
   * @returns {boolean} True if process is running
   */
  isRunning(cameraId) {
    return this.activeProcesses.has(cameraId);
  }

  /**
   * Get process info for a specific camera.
   *
   * @param {string} cameraId - Camera identifier
   * @returns {object|null} Process info or null if not found
   */
  getProcessInfo(cameraId) {
    const info = this.activeProcesses.get(cameraId);
    if (!info) return null;

    return {
      cameraId: info.cameraId,
      pid: info.pid,
      sourceUrl: info.sourceUrl,
      mode: info.mode,
      endpoint: info.endpoint,
      startedAt: info.startedAt,
      restartCount: info.restartCount || 0
    };
  }
}

// Export singleton instance
const processManager = new ProcessManager();
export default processManager;
