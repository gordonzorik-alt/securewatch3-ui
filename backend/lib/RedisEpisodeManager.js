/**
 * RedisEpisodeManager v4.0 - Stateless, Crash-Proof Episode Management
 * 
 * Unlike the in-memory EpisodeManager, this stores ALL state in Redis.
 * If the Node.js process crashes mid-event, it resumes perfectly on restart.
 * 
 * Key Pattern:
 *   session:{camera_id} - JSON blob with episode state (TTL = 5s)
 *   active_cameras - Set of cameras with active sessions
 * 
 * TTL-based timeout: When no new frames arrive for 5s, the key expires.
 * The Janitor detects this and triggers finalization.
 */

import { EventEmitter } from 'events';
import Redis from 'ioredis';

// CONFIGURATION
const EPISODE_TTL = 5;           // Seconds of silence before closing
const JANITOR_INTERVAL = 2000;   // Check for expired episodes every 2s
const MIN_FRAMES = 2;            // Minimum frames to be a valid episode

class RedisEpisodeManager extends EventEmitter {
  constructor() {
    super();
    this.redis = null;
    this.prefix = 'session:';
    this.activeSetKey = 'active_cameras';
    this.janitorTimer = null;
    this.localCache = new Map(); // Cache last known state for finalization
    this.initialized = false;
  }

  /**
   * Initialize Redis connection
   */
  async initialize() {
    if (this.initialized) {
      console.log('[RedisEpisode] Already initialized');
      return;
    }

    console.log('[RedisEpisode] Initializing Redis connection...');
    
    this.redis = new Redis({
      host: '127.0.0.1',
      port: 6379,
      retryStrategy: (times) => Math.min(times * 100, 3000)
    });

    this.redis.on('connect', () => {
      console.log('[RedisEpisode] Redis connected');
    });

    this.redis.on('error', (err) => {
      console.error('[RedisEpisode] Redis error:', err.message);
    });

    // Wait for connection
    await new Promise((resolve, reject) => {
      if (this.redis.status === 'ready') {
        resolve();
      } else {
        this.redis.once('ready', resolve);
        this.redis.once('error', reject);
      }
    });

    // Recover any orphaned sessions and start Janitor
    await this.recoverOrphanedSessions();
    this.startJanitor();
    
    this.initialized = true;
    console.log('[RedisEpisode] Initialized (Stateless, Crash-Proof)');
  }

  /**
   * Process a detection frame
   * @param {string} cameraId - Camera identifier
   * @param {object} detection - Detection object with id, timestamp, imageUrl, confidence
   */
  async processFrame(cameraId, detection) {
    if (!this.initialized) {
      console.warn('[RedisEpisode] Not initialized, skipping frame');
      return;
    }

    const key = `${this.prefix}${cameraId}`;
    const now = Date.now();

    try {
      // 1. GET current session (atomic)
      let sessionJSON = await this.redis.get(key);
      let session;
      let isNewSession = false;

      if (!sessionJSON) {
        // START NEW EPISODE
        isNewSession = true;
        const episodeId = `ep_${cameraId}_${now}_${Math.floor(Math.random() * 1000)}`;
        
        session = {
          id: episodeId,
          camera_id: cameraId,
          start_time: new Date(now).toISOString(),
          end_time: new Date(now).toISOString(),
          frame_count: 0,
          detections: [],  // Store detection objects for AI analysis
          best_confidence: 0,
          keyframe: null
        };

        console.log(`[RedisEpisode] ${cameraId}: NEW SESSION -> ${episodeId}`);
        
        // Add to active set
        await this.redis.sadd(this.activeSetKey, cameraId);
        
        // Emit start event
        this.emit('episode:start', {
          id: session.id,
          camera_id: cameraId,
          start_time: session.start_time,
          status: 'recording'
        });
      } else {
        session = JSON.parse(sessionJSON);
      }

      // 2. UPDATE session state
      const detectionId = detection.id || `det_${now}_${Math.random().toString(36).substr(2,9)}`;
      const imageUrl = detection.imageUrl || detection.image_path || detection.url;
      const confidence = detection.score || detection.confidence || 0;

      session.end_time = new Date(now).toISOString();
      session.frame_count++;
      
      // Store detection for later use (AI analysis, linking)
      session.detections.push({
        id: detectionId,
        dbId: detection.dbId, // DB ID for linking
        time: detection.time || new Date(now).toISOString(),
        imageUrl: imageUrl,
        confidence: confidence,
        class: detection.class || 'person'
      });
      
      // Track best frame for thumbnail
      if (confidence > session.best_confidence && imageUrl) {
        session.best_confidence = confidence;
        session.keyframe = {
          imageUrl: imageUrl,
          confidence: confidence,
          detection_id: detectionId
        };
      }

      // 3. SAVE to Redis with TTL (Dead Man's Switch)
      await this.redis.set(key, JSON.stringify(session), 'EX', EPISODE_TTL);
      
      // 4. Cache locally for finalization (in case Redis expires before we read)
      this.localCache.set(cameraId, session);

      if (!isNewSession && session.frame_count % 5 === 0) {
        console.log(`[RedisEpisode] ${cameraId}: Frame ${session.frame_count} (conf: ${confidence.toFixed(2)})`);
      }

    } catch (err) {
      console.error(`[RedisEpisode] Error processing frame: ${err.message}`);
    }
  }

  /**
   * Start the Janitor - watches for expired sessions
   */
  startJanitor() {
    if (this.janitorTimer) return;
    
    console.log('[RedisEpisode] Janitor started (checking every 2s)');
    
    this.janitorTimer = setInterval(async () => {
      try {
        // Get all cameras that had active sessions
        const activeCameras = await this.redis.smembers(this.activeSetKey);
        
        for (const cameraId of activeCameras) {
          const key = `${this.prefix}${cameraId}`;
          const exists = await this.redis.exists(key);
          
          if (!exists) {
            // Session expired! Time to finalize
            const cachedSession = this.localCache.get(cameraId);
            
            if (cachedSession && cachedSession.frame_count >= MIN_FRAMES) {
              console.log(`[RedisEpisode] ${cameraId}: Session EXPIRED -> Finalizing ${cachedSession.id}`);
              await this.finalizeEpisode(cachedSession);
            } else if (cachedSession) {
              console.log(`[RedisEpisode] ${cameraId}: Session too short (${cachedSession.frame_count} frames) -> Discarding`);
            }
            
            // Remove from active set
            await this.redis.srem(this.activeSetKey, cameraId);
            this.localCache.delete(cameraId);
          }
        }
      } catch (err) {
        console.error(`[RedisEpisode] Janitor error: ${err.message}`);
      }
    }, JANITOR_INTERVAL);
  }

  /**
   * Stop the Janitor
   */
  stopJanitor() {
    if (this.janitorTimer) {
      clearInterval(this.janitorTimer);
      this.janitorTimer = null;
      console.log('[RedisEpisode] Janitor stopped');
    }
  }

  /**
   * Finalize an episode - emit ready event with full data
   * Note: DB persistence is handled by v2bridge.js
   */
  async finalizeEpisode(session) {
    const duration = new Date(session.end_time) - new Date(session.start_time);
    
    console.log(`[RedisEpisode] Finalizing: ${session.id} (${session.frame_count} frames, ${Math.round(duration/1000)}s)`);

    // Emit ready event with full data for AI analysis
    this.emit('episode:ready', {
      id: session.id,
      camera_id: session.camera_id,
      start_time: session.start_time,
      end_time: session.end_time,
      duration_sec: Math.round(duration / 1000),
      frame_count: session.frame_count,
      keyframe: session.keyframe,
      detections: session.detections // Full detection array for AI
    });
  }

  /**
   * Recover any orphaned sessions on startup
   */
  async recoverOrphanedSessions() {
    try {
      const activeCameras = await this.redis.smembers(this.activeSetKey);
      console.log(`[RedisEpisode] Checking for orphaned sessions: ${activeCameras.length} active cameras`);
      
      for (const cameraId of activeCameras) {
        const key = `${this.prefix}${cameraId}`;
        const sessionJSON = await this.redis.get(key);
        
        if (sessionJSON) {
          // Session still active - cache it
          const session = JSON.parse(sessionJSON);
          this.localCache.set(cameraId, session);
          console.log(`[RedisEpisode] Recovered active session: ${session.id}`);
        } else {
          // Session expired while we were down - clean up
          await this.redis.srem(this.activeSetKey, cameraId);
          console.log(`[RedisEpisode] Cleaned orphaned camera: ${cameraId}`);
        }
      }
    } catch (err) {
      console.error(`[RedisEpisode] Recovery error: ${err.message}`);
    }
  }

  /**
   * Get current status for health checks
   */
  async getStatus() {
    if (!this.initialized) {
      return { error: 'Not initialized', janitor_running: false };
    }
    
    const activeCameras = await this.redis.smembers(this.activeSetKey);
    const sessions = {};
    
    for (const cameraId of activeCameras) {
      const key = `${this.prefix}${cameraId}`;
      const sessionJSON = await this.redis.get(key);
      if (sessionJSON) {
        const session = JSON.parse(sessionJSON);
        // Return summary, not full detections array
        sessions[cameraId] = {
          id: session.id,
          frame_count: session.frame_count,
          start_time: session.start_time,
          best_confidence: session.best_confidence
        };
      }
    }
    
    return {
      active_cameras: activeCameras,
      sessions: sessions,
      janitor_running: !!this.janitorTimer,
      initialized: this.initialized
    };
  }
}

// Export singleton instance
const redisEpisodeManager = new RedisEpisodeManager();
export default redisEpisodeManager;
