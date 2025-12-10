/**
 * HealthService - System Health & Watchdog Service
 *
 * Provides health checks for:
 * - Database (SQLite)
 * - Redis (optional)
 * - Python Detector Processes (via heartbeat keys)
 * - Network (listening status)
 */

import db from './database.js';

// Heartbeat staleness threshold (30 seconds)
const HEARTBEAT_STALE_THRESHOLD_MS = 30000;

class HealthService {
  constructor(redisClient = null) {
    this.redisClient = redisClient;
    this.startTime = Date.now();
  }

  /**
   * Set the Redis client (called after Redis connects)
   */
  setRedisClient(client) {
    this.redisClient = client;
  }

  /**
   * Check database health
   * @returns {Promise<{status: string, latencyMs: number, error?: string}>}
   */
  async checkDatabase() {
    const start = Date.now();
    try {
      // Simple query to verify database is responsive
      const result = db.raw.prepare('SELECT 1 as test').get();
      const latencyMs = Date.now() - start;

      if (result && result.test === 1) {
        // Also check we can write (important for WAL mode)
        db.raw.prepare(`
          INSERT OR REPLACE INTO health_checks (id, last_check)
          VALUES (1, datetime('now'))
        `).run();

        return {
          status: 'ok',
          latencyMs,
          mode: 'WAL'
        };
      }

      return {
        status: 'error',
        latencyMs,
        error: 'Query returned unexpected result'
      };
    } catch (err) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        error: err.message
      };
    }
  }

  /**
   * Check Redis health
   * @returns {Promise<{status: string, latencyMs: number, error?: string}>}
   */
  async checkRedis() {
    if (!this.redisClient) {
      return {
        status: 'unavailable',
        latencyMs: 0,
        error: 'Redis client not configured'
      };
    }

    const start = Date.now();
    try {
      const pong = await this.redisClient.ping();
      const latencyMs = Date.now() - start;

      if (pong === 'PONG') {
        return {
          status: 'ok',
          latencyMs
        };
      }

      return {
        status: 'error',
        latencyMs,
        error: `Unexpected ping response: ${pong}`
      };
    } catch (err) {
      return {
        status: 'error',
        latencyMs: Date.now() - start,
        error: err.message
      };
    }
  }

  /**
   * Check detector processes via heartbeat keys
   * @returns {Promise<{detectors: Object, activeCount: number, stalledCount: number}>}
   */
  async checkDetectors() {
    const detectors = {};
    let activeCount = 0;
    let stalledCount = 0;

    if (!this.redisClient) {
      return {
        detectors: {},
        activeCount: 0,
        stalledCount: 0,
        error: 'Redis unavailable - cannot check detector heartbeats'
      };
    }

    try {
      // Scan for heartbeat keys
      const keys = await this.redisClient.keys('heartbeat:detector:*');

      for (const key of keys) {
        const cameraId = key.replace('heartbeat:detector:', '');
        const timestamp = await this.redisClient.get(key);

        if (timestamp) {
          const heartbeatTime = parseInt(timestamp, 10);
          const age = Date.now() - heartbeatTime;
          const isStale = age > HEARTBEAT_STALE_THRESHOLD_MS;

          detectors[cameraId] = {
            status: isStale ? 'stalled' : 'active',
            lastHeartbeat: new Date(heartbeatTime).toISOString(),
            ageMs: age
          };

          if (isStale) {
            stalledCount++;
          } else {
            activeCount++;
          }
        }
      }

      return {
        detectors,
        activeCount,
        stalledCount
      };
    } catch (err) {
      return {
        detectors: {},
        activeCount: 0,
        stalledCount: 0,
        error: err.message
      };
    }
  }

  /**
   * Check active camera monitors from ProcessManager
   * @param {Object} processManager - The ProcessManager instance
   * @returns {Object} Monitor status
   */
  checkMonitors(processManager) {
    if (!processManager) {
      return {
        monitors: {},
        activeCount: 0,
        error: 'ProcessManager not available'
      };
    }

    const monitors = {};
    let activeCount = 0;

    try {
      const status = processManager.getStatus();

      for (const [cameraId, info] of Object.entries(status)) {
        monitors[cameraId] = {
          status: info.running ? 'running' : 'stopped',
          pid: info.pid || null,
          uptime: info.startTime ? Date.now() - new Date(info.startTime).getTime() : 0
        };

        if (info.running) {
          activeCount++;
        }
      }

      return {
        monitors,
        activeCount
      };
    } catch (err) {
      return {
        monitors: {},
        activeCount: 0,
        error: err.message
      };
    }
  }

  /**
   * Get comprehensive system status
   * @param {Object} options - Optional ProcessManager instance
   * @returns {Promise<Object>} Full system status
   */
  async getSystemStatus(options = {}) {
    const { processManager, port, host } = options;

    const [dbStatus, redisStatus, detectorStatus] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkDetectors()
    ]);

    const monitorStatus = this.checkMonitors(processManager);

    // Determine overall health
    let overallStatus = 'healthy';
    const issues = [];

    if (dbStatus.status !== 'ok') {
      overallStatus = 'critical';
      issues.push(`Database: ${dbStatus.error || 'unavailable'}`);
    }

    if (redisStatus.status === 'error') {
      // Redis is optional, so only warning
      if (overallStatus === 'healthy') overallStatus = 'degraded';
      issues.push(`Redis: ${redisStatus.error}`);
    }

    if (detectorStatus.stalledCount > 0) {
      if (overallStatus === 'healthy') overallStatus = 'warning';
      issues.push(`${detectorStatus.stalledCount} detector(s) stalled`);
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      uptimeFormatted: this.formatUptime(Date.now() - this.startTime),
      network: {
        status: 'listening',
        host: host || '0.0.0.0',
        port: port || 4000
      },
      database: dbStatus,
      redis: redisStatus,
      detectors: detectorStatus,
      monitors: monitorStatus,
      issues
    };
  }

  /**
   * Format uptime in human-readable format
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Print startup self-test to console
   */
  async printStartupReport(options = {}) {
    const status = await this.getSystemStatus(options);

    console.log('\n');
    console.log('='.repeat(50));
    console.log('  SecureWatch3 Startup Self-Test');
    console.log('='.repeat(50));

    // Database
    const dbIcon = status.database.status === 'ok' ? '\u2705' : '\u274C';
    const dbLatency = status.database.latencyMs ? `(${status.database.latencyMs}ms)` : '';
    console.log(`${dbIcon} Database:   ${status.database.status.toUpperCase()} ${dbLatency}`);

    // Redis
    const redisIcon = status.redis.status === 'ok' ? '\u2705' :
                      status.redis.status === 'unavailable' ? '\u26A0\uFE0F' : '\u274C';
    const redisLatency = status.redis.latencyMs ? `(${status.redis.latencyMs}ms)` : '';
    console.log(`${redisIcon} Redis:      ${status.redis.status.toUpperCase()} ${redisLatency}`);

    // Network
    const netIcon = '\u2705';
    console.log(`${netIcon} Network:    LISTENING (${status.network.host}:${status.network.port})`);

    // Monitors
    const monIcon = status.monitors.activeCount > 0 ? '\u2705' : '\u26A0\uFE0F';
    console.log(`${monIcon} Monitors:   ${status.monitors.activeCount} active`);

    // Detectors
    if (status.detectors.activeCount > 0 || status.detectors.stalledCount > 0) {
      const detIcon = status.detectors.stalledCount === 0 ? '\u2705' : '\u26A0\uFE0F';
      console.log(`${detIcon} Detectors:  ${status.detectors.activeCount} active, ${status.detectors.stalledCount} stalled`);
    }

    console.log('-'.repeat(50));

    // Overall status
    const statusIcon = status.status === 'healthy' ? '\u2705' :
                       status.status === 'warning' ? '\u26A0\uFE0F' :
                       status.status === 'degraded' ? '\u26A0\uFE0F' : '\u274C';
    console.log(`System Status: ${statusIcon} ${status.status.toUpperCase()}`);

    if (status.issues.length > 0) {
      console.log('\nIssues:');
      status.issues.forEach(issue => console.log(`  - ${issue}`));
    }

    console.log('='.repeat(50));
    console.log('\n');

    return status;
  }
}

// Ensure health_checks table exists
try {
  db.raw.exec(`
    CREATE TABLE IF NOT EXISTS health_checks (
      id INTEGER PRIMARY KEY,
      last_check TEXT
    )
  `);
} catch (err) {
  console.error('[HealthService] Failed to create health_checks table:', err.message);
}

// Export singleton
const healthService = new HealthService();
export { healthService, HealthService };
export default healthService;
