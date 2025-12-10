/**
 * EpisodeManager - Ring-Standard Deterministic State Machine
 * 
 * States:
 * - IDLE: Waiting for a person
 * - ACTIVE: Person is in view (recording)
 * - COOLDOWN: Person disappeared, might come back (behind bush)
 * - FINALIZING: Selecting keyframes, sending to AI
 * 
 * This prevents:
 * - Fragmented Episodes (one event splitting into two)
 * - Ghost detections (< 1s events)
 * - Flaky timeout logic
 * - Zombie Sessions (stale episodes that never close)
 */

import { EventEmitter } from 'events';
import db from './database.js';

// CONFIGURATION
const COOLDOWN_MS = 3000;      // Wait 3s after person leaves before cutting
const MIN_DURATION_MS = 1500;  // Ignore <1.5s "ghost" events
const MAX_FRAMES = 100;        // Limit frames per episode (memory safety)

// ZOMBIE SESSION PROTECTION (Self-Healing)
const MAX_IDLE_TIME = 5000;       // 5 seconds max gap between frames
const MAX_EPISODE_DURATION = 60000; // 1 minute max episode length

class EpisodeManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
    this.episodeCounter = 0;
    console.log('[EpisodeManager] Initialized (Ring-Standard State Machine with Zombie Protection)');
  }

  processFrame(cameraId, detection) {
    const now = Date.now();
    let session = this.sessions.get(cameraId);

    // ZOMBIE SESSION PROTECTION
    if (session) {
      const timeSinceLastFrame = now - session.lastSeen;
      const episodeDuration = now - session.startTime;
      
      if (timeSinceLastFrame > MAX_IDLE_TIME || episodeDuration > MAX_EPISODE_DURATION) {
        console.warn(`[EpisodeManager] ${cameraId}: ZOMBIE DETECTED! Idle: ${Math.round(timeSinceLastFrame/1000)}s, Duration: ${Math.round(episodeDuration/1000)}s`);
        if (session.timer) clearTimeout(session.timer);
        this.finalizeEpisode(session).catch(err => {
          console.error(`[EpisodeManager] Zombie cleanup error: ${err.message}`);
        });
        this.sessions.delete(cameraId);
        session = null;
        console.log(`[EpisodeManager] ${cameraId}: Zombie cleared, starting fresh`);
      }
    }

    // Normalize detection - ensure we have a unique ID
    const frameId = detection.id || `${cameraId}_${now}_${Math.random().toString(36).substr(2,9)}`;
    const frame = {
      id: frameId,
      timestamp: detection.time || new Date().toISOString(),
      imageUrl: detection.imageUrl || detection.image_path || detection.url,
      confidence: detection.score || detection.confidence || 0,
      class: detection.class || detection.label || 'person',
      dbId: detection.dbId,
      raw: detection
    };

    // STATE: IDLE -> START NEW EPISODE
    if (!session) {
      this.episodeCounter++;
      const episodeId = `ep_${cameraId}_${now}_${this.episodeCounter}`;
      
      console.log(`[EpisodeManager] ${cameraId}: IDLE -> ACTIVE (Episode: ${episodeId})`);
      
      session = {
        id: episodeId,
        cameraId,
        state: 'ACTIVE',
        startTime: now,
        lastSeen: now,
        frames: [frame],
        detection_ids: [detection.dbId || frameId],  // Track specific detection IDs
        bestFrame: frame,
        timer: null
      };
      this.sessions.set(cameraId, session);
      
      this.emit('episode:start', {
        id: session.id,
        camera_id: cameraId,
        start_time: new Date(session.startTime).toISOString(),
        state: 'ACTIVE'
      });
      
      this.resetWatchdog(session);
      return;
    }

    // STATE: ACTIVE/COOLDOWN -> UPDATE
    session.lastSeen = now;
    session.state = 'ACTIVE';
    
    if (session.frames.length < MAX_FRAMES) {
      session.frames.push(frame);
      session.detection_ids.push(detection.dbId || frameId);  // Track this detection ID
    }

    if (frame.confidence > session.bestFrame.confidence) {
      session.bestFrame = frame;
      console.log(`[EpisodeManager] ${cameraId}: New best frame (conf: ${frame.confidence.toFixed(2)})`);
    }

    this.resetWatchdog(session);
  }

  resetWatchdog(session) {
    if (session.timer) clearTimeout(session.timer);

    session.timer = setTimeout(() => {
      session.state = 'COOLDOWN';
      console.log(`[EpisodeManager] ${session.cameraId}: ACTIVE -> COOLDOWN`);
      
      session.timer = setTimeout(() => {
        this.finalizeEpisode(session);
      }, COOLDOWN_MS / 2);
      
    }, COOLDOWN_MS);
  }

  async finalizeEpisode(session) {
    const duration = Date.now() - session.startTime;
    session.state = 'FINALIZING';

    if (duration < MIN_DURATION_MS) {
      console.log(`[EpisodeManager] ${session.cameraId}: DISCARDED (Too short: ${duration}ms)`);
      this.sessions.delete(session.cameraId);
      return;
    }

    console.log(`[EpisodeManager] ${session.cameraId}: FINALIZING (Duration: ${Math.round(duration/1000)}s, Frames: ${session.frames.length})`);

    // Build episode with frames and detection_ids
    const episodeData = {
      id: session.id,
      camera_id: session.cameraId,
      start_time: new Date(session.startTime).toISOString(),
      end_time: new Date().toISOString(),
      duration_sec: Math.round(duration / 1000),
      frame_count: session.frames.length,
      detection_ids: session.detection_ids,  // Include all detection IDs
      keyframe: {
        imageUrl: session.bestFrame.imageUrl,
        confidence: session.bestFrame.confidence,
        timestamp: session.bestFrame.timestamp
      },
      frame_selection: this.selectFramesForAnalysis(session.frames),
      // Include full frames for cache (with imageUrls)
      detections: session.frames.map(f => ({
        id: f.id,
        imageUrl: f.imageUrl,
        image_path: f.imageUrl,
        confidence: f.confidence,
        timestamp: f.timestamp
      }))
    };

    // Save to DB (non-critical)
    try {
      if (db.liveEpisodes && db.liveEpisodes.insert) {
        db.liveEpisodes.insert({
          id: episodeData.id,
          camera_id: episodeData.camera_id,
          start_time: episodeData.start_time,
          end_time: episodeData.end_time,
          keyframe_path: episodeData.keyframe.imageUrl,
          frame_count: episodeData.frame_count,
          max_confidence: episodeData.keyframe.confidence,
          detection_ids: JSON.stringify(episodeData.detection_ids),
          status: 'pending'
        });
        console.log(`[EpisodeManager] ${session.cameraId}: Saved to DB with ${episodeData.detection_ids.length} detection_ids`);
      }
    } catch (err) {
      console.error(`[EpisodeManager] DB Error: ${err.message}`);
    }

    // Emit for cache + AI analysis
    this.emit('episode:ready', episodeData);

    this.sessions.delete(session.cameraId);
  }

  selectFramesForAnalysis(frames, maxFrames = 8) {
    if (frames.length <= maxFrames) {
      return frames.map(f => ({ 
        id: f.id,
        imageUrl: f.imageUrl, 
        confidence: f.confidence, 
        timestamp: f.timestamp 
      }));
    }

    const selected = [];
    selected.push(frames[0]);
    
    const sorted = [...frames].sort((a, b) => b.confidence - a.confidence);
    for (let i = 0; i < Math.min(3, sorted.length); i++) {
      if (!selected.find(s => s.id === sorted[i].id)) {
        selected.push(sorted[i]);
      }
    }
    
    const step = Math.floor(frames.length / (maxFrames - selected.length));
    for (let i = step; i < frames.length && selected.length < maxFrames - 1; i += step) {
      if (!selected.find(s => s.id === frames[i].id)) {
        selected.push(frames[i]);
      }
    }
    
    if (!selected.find(s => s.id === frames[frames.length - 1].id)) {
      selected.push(frames[frames.length - 1]);
    }

    return selected.map(f => ({ 
      id: f.id,
      imageUrl: f.imageUrl, 
      confidence: f.confidence, 
      timestamp: f.timestamp 
    }));
  }

  getStatus() {
    const status = {};
    for (const [cameraId, session] of this.sessions) {
      status[cameraId] = {
        state: session.state,
        episodeId: session.id,
        duration: Math.round((Date.now() - session.startTime) / 1000),
        frameCount: session.frames.length,
        detectionCount: session.detection_ids.length,
        bestConfidence: session.bestFrame.confidence,
        idleTime: Math.round((Date.now() - session.lastSeen) / 1000)
      };
    }
    return status;
  }

  cleanupAllZombies() {
    const now = Date.now();
    let cleaned = 0;
    for (const [cameraId, session] of this.sessions) {
      const timeSinceLastFrame = now - session.lastSeen;
      const episodeDuration = now - session.startTime;
      if (timeSinceLastFrame > MAX_IDLE_TIME || episodeDuration > MAX_EPISODE_DURATION) {
        console.warn(`[EpisodeManager] Cleaning up zombie: ${session.id}`);
        if (session.timer) clearTimeout(session.timer);
        this.sessions.delete(cameraId);
        cleaned++;
      }
    }
    return cleaned;
  }
}

export default new EpisodeManager();
