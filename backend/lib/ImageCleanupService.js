/**
 * ImageCleanupService - Automatic cleanup of old detection images
 *
 * Prevents disk space exhaustion by periodically removing old snapshots
 * from the data/snapshots and v2_images directories.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ImageCleanupService {
  constructor(options = {}) {
    // Configuration with defaults
    this.snapshotsDir = options.snapshotsDir || path.join(__dirname, '..', 'data', 'snapshots');
    this.v2ImagesDir = options.v2ImagesDir || path.join(__dirname, '..', 'v2_images');

    // Max age in milliseconds (default: 1 hour)
    this.maxAgeMs = options.maxAgeMs || (parseInt(process.env.IMAGE_MAX_AGE_HOURS, 10) || 1) * 60 * 60 * 1000;

    // Cleanup interval in milliseconds (default: 5 minutes)
    this.intervalMs = options.intervalMs || (parseInt(process.env.IMAGE_CLEANUP_INTERVAL_MINS, 10) || 5) * 60 * 1000;

    // File extensions to clean up
    this.extensions = options.extensions || ['.jpg', '.jpeg', '.png', '.webp'];

    // Minimum files to keep per directory (safety net)
    this.minFilesToKeep = options.minFilesToKeep || 100;

    // Stats
    this.stats = {
      lastRun: null,
      totalCleaned: 0,
      totalBytesFreed: 0,
      runs: 0
    };

    this.intervalId = null;
    this.isRunning = false;
  }

  /**
   * Start the cleanup service
   */
  start() {
    if (this.intervalId) {
      console.log('[ImageCleanup] Service already running');
      return;
    }

    console.log(`[ImageCleanup] Starting service:`);
    console.log(`  - Snapshots dir: ${this.snapshotsDir}`);
    console.log(`  - V2 images dir: ${this.v2ImagesDir}`);
    console.log(`  - Max age: ${this.maxAgeMs / (60 * 60 * 1000)} hours`);
    console.log(`  - Cleanup interval: ${this.intervalMs / (60 * 1000)} minutes`);

    // Run immediately on start
    this.runCleanup();

    // Schedule periodic cleanup
    this.intervalId = setInterval(() => this.runCleanup(), this.intervalMs);
  }

  /**
   * Stop the cleanup service
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[ImageCleanup] Service stopped');
    }
  }

  /**
   * Run a cleanup cycle
   */
  async runCleanup() {
    if (this.isRunning) {
      console.log('[ImageCleanup] Cleanup already in progress, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    let totalDeleted = 0;
    let totalBytesFreed = 0;

    try {
      // Clean snapshots directory
      const snapshotsResult = await this.cleanDirectory(this.snapshotsDir);
      totalDeleted += snapshotsResult.deleted;
      totalBytesFreed += snapshotsResult.bytesFreed;

      // Clean v2_images directory
      const v2Result = await this.cleanDirectory(this.v2ImagesDir);
      totalDeleted += v2Result.deleted;
      totalBytesFreed += v2Result.bytesFreed;

      // Update stats
      this.stats.lastRun = new Date().toISOString();
      this.stats.totalCleaned += totalDeleted;
      this.stats.totalBytesFreed += totalBytesFreed;
      this.stats.runs++;

      const duration = Date.now() - startTime;

      if (totalDeleted > 0) {
        console.log(`[ImageCleanup] Cleaned ${totalDeleted} files (${this.formatBytes(totalBytesFreed)}) in ${duration}ms`);
      }
    } catch (error) {
      console.error('[ImageCleanup] Error during cleanup:', error.message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Clean a single directory of old images
   */
  async cleanDirectory(dirPath) {
    const result = { deleted: 0, bytesFreed: 0, errors: 0 };

    if (!fs.existsSync(dirPath)) {
      return result;
    }

    try {
      const files = fs.readdirSync(dirPath);
      const now = Date.now();
      const cutoffTime = now - this.maxAgeMs;

      // Get file stats and sort by mtime
      const fileInfos = [];
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!this.extensions.includes(ext)) continue;

        const filePath = path.join(dirPath, file);
        try {
          const stats = fs.statSync(filePath);
          fileInfos.push({
            path: filePath,
            mtime: stats.mtimeMs,
            size: stats.size
          });
        } catch (err) {
          // File may have been deleted by another process
          continue;
        }
      }

      // Sort by modification time (newest first)
      fileInfos.sort((a, b) => b.mtime - a.mtime);

      // Delete old files, but keep at least minFilesToKeep
      const filesToProcess = fileInfos.slice(this.minFilesToKeep);

      for (const fileInfo of filesToProcess) {
        if (fileInfo.mtime < cutoffTime) {
          try {
            fs.unlinkSync(fileInfo.path);
            result.deleted++;
            result.bytesFreed += fileInfo.size;
          } catch (err) {
            result.errors++;
          }
        }
      }
    } catch (error) {
      console.error(`[ImageCleanup] Error reading directory ${dirPath}:`, error.message);
    }

    return result;
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      config: {
        maxAgeHours: this.maxAgeMs / (60 * 60 * 1000),
        intervalMins: this.intervalMs / (60 * 1000),
        minFilesToKeep: this.minFilesToKeep
      }
    };
  }

  /**
   * Get current disk usage for image directories
   */
  getDiskUsage() {
    const usage = {
      snapshots: { files: 0, bytes: 0 },
      v2Images: { files: 0, bytes: 0 },
      total: { files: 0, bytes: 0 }
    };

    try {
      if (fs.existsSync(this.snapshotsDir)) {
        const snapshotStats = this.getDirectoryStats(this.snapshotsDir);
        usage.snapshots = snapshotStats;
        usage.total.files += snapshotStats.files;
        usage.total.bytes += snapshotStats.bytes;
      }

      if (fs.existsSync(this.v2ImagesDir)) {
        const v2Stats = this.getDirectoryStats(this.v2ImagesDir);
        usage.v2Images = v2Stats;
        usage.total.files += v2Stats.files;
        usage.total.bytes += v2Stats.bytes;
      }
    } catch (error) {
      console.error('[ImageCleanup] Error getting disk usage:', error.message);
    }

    return {
      ...usage,
      totalFormatted: this.formatBytes(usage.total.bytes)
    };
  }

  /**
   * Get stats for a directory
   */
  getDirectoryStats(dirPath) {
    const stats = { files: 0, bytes: 0 };

    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!this.extensions.includes(ext)) continue;

        try {
          const fileStat = fs.statSync(path.join(dirPath, file));
          stats.files++;
          stats.bytes += fileStat.size;
        } catch (err) {
          continue;
        }
      }
    } catch (error) {
      // Directory doesn't exist or not readable
    }

    return stats;
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Force immediate cleanup (manual trigger)
   */
  async forceCleanup() {
    console.log('[ImageCleanup] Manual cleanup triggered');
    await this.runCleanup();
    return this.getStats();
  }
}

// Create singleton instance
const imageCleanupService = new ImageCleanupService();

export default imageCleanupService;
export { ImageCleanupService };
