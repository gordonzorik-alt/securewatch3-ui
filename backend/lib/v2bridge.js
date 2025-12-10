// =============================================================================
// v3 Vision Worker Bridge (Redis-Backed State Machine Integration)
// =============================================================================

import redisEpisodeManager from './RedisEpisodeManager.js';
import db from './database.js';

// Throttle state for detections (one per camera, 500ms cooldown)
const v2ThrottleState = {};
const V2_THROTTLE_MS = 500;

// ============================================================================
// DETECTION ID CACHE - Track DB IDs for linking
// ============================================================================
const detectionIdCache = new Map(); // Maps v3Data.id -> database rowid
const DETECTION_CACHE_MAX_SIZE = 5000;
const DETECTION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cacheDetectionId(v3Id, dbId) {
  // Prune old entries if too large
  if (detectionIdCache.size > DETECTION_CACHE_MAX_SIZE) {
    const now = Date.now();
    for (const [key, val] of detectionIdCache) {
      if (now - val.time > DETECTION_CACHE_TTL_MS) {
        detectionIdCache.delete(key);
      }
    }
  }
  detectionIdCache.set(v3Id, { dbId, time: Date.now() });
}

function getDetectionDbId(v3Id) {
  const cached = detectionIdCache.get(v3Id);
  return cached ? cached.dbId : null;
}

// ============================================================================
// SANITIZATION: Max episode duration to prevent zombie sessions
// ============================================================================
const MAX_EPISODE_DURATION_SEC = 60; // Only keep last 60 seconds of frames

/**
 * Sanitize frames for zombie episodes
 * If episode > 60 seconds, only keep frames from the last 60 seconds
 */
function sanitizeFrames(episodeData) {
  const detections = episodeData.detections || [];
  if (detections.length === 0) return [];
  
  // If episode is short, keep all frames
  const durationSec = episodeData.duration_sec || 0;
  if (durationSec <= MAX_EPISODE_DURATION_SEC) {
    console.log(`[v3-Bridge] Episode ${episodeData.id}: Normal duration (${durationSec}s), keeping all ${detections.length} frames`);
    return detections;
  }
  
  // Zombie episode detected! Only keep frames from last 60 seconds
  const cutoffTime = new Date(episodeData.end_time).getTime() - (MAX_EPISODE_DURATION_SEC * 1000);
  
  const sanitizedFrames = detections.filter(det => {
    const detTime = new Date(det.time || det.timestamp).getTime();
    return detTime >= cutoffTime;
  });
  
  console.log(`[v3-Bridge] ZOMBIE DETECTED: Episode ${episodeData.id} was ${durationSec}s, sliced ${detections.length} -> ${sanitizedFrames.length} frames (last 60s only)`);
  
  return sanitizedFrames;
}

// ============================================================================
// LIVE EPISODE CACHE - Store frames for filmstrip access
// ============================================================================
const liveEpisodeCache = new Map();
const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes TTL
const CACHE_MAX_SIZE = 50;

function cacheEpisode(episodeData, sanitizedFrames) {
  const now = Date.now();
  
  // Clean old entries
  for (const [id, cached] of liveEpisodeCache) {
    if (now - cached.timestamp > CACHE_MAX_AGE_MS) {
      liveEpisodeCache.delete(id);
    }
  }
  
  // Enforce max size
  if (liveEpisodeCache.size >= CACHE_MAX_SIZE) {
    const oldest = [...liveEpisodeCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) liveEpisodeCache.delete(oldest[0]);
  }
  
  // Cache with SANITIZED frames only
  liveEpisodeCache.set(episodeData.id, {
    episodeData,
    frames: sanitizedFrames,
    timestamp: now
  });
  
  console.log(`[v3-Bridge] Cached episode ${episodeData.id} with ${sanitizedFrames.length} sanitized frames`);
}

function getCachedEpisode(episodeId) {
  const cached = liveEpisodeCache.get(episodeId);
  if (cached && Date.now() - cached.timestamp < CACHE_MAX_AGE_MS) {
    return cached;
  }
  return null;
}

/**
 * Process a v3 detection message
 */
async function processV2Detection(v3Data, io, processLiveDetection = null) {
  const cameraId = v3Data.camera;
  const now = Date.now();
  const snapshotUrl = v3Data.url || v3Data.imageUrl;

  // Throttle frontend emissions
  const lastEmit = v2ThrottleState[cameraId] || 0;
  const shouldEmit = (now - lastEmit) >= V2_THROTTLE_MS;

  if (shouldEmit) {
    v2ThrottleState[cameraId] = now;
    io.emit('detection:v2', {
      id: v3Data.id,
      camera: cameraId,
      time: v3Data.time,
      imageUrl: snapshotUrl,
      class: v3Data.class,
      score: v3Data.score
    });
    console.log(`[v3-Bridge] ${cameraId}: ${v3Data.class} (${v3Data.score.toFixed(2)}) -> Ticker`);
  }

  // =========================================================================
  // IMMEDIATE DB INSERT - Save detection NOW (before episode finishes)
  // This eliminates the race condition where linking fails
  // =========================================================================
  let dbDetectionId = null;
  try {
    dbDetectionId = db.detections.insert({
      camera_id: cameraId,
      frame_number: 0,
      timestamp: v3Data.time,
      label: v3Data.class || 'person',
      confidence: v3Data.score || 0,
      image_path: snapshotUrl,
      engine: 'v3-live'
    });
    // Cache the DB ID for later linking
    cacheDetectionId(v3Data.id, dbDetectionId);
  } catch (err) {
    // Ignore duplicates or errors
    console.error(`[v3-Bridge] DB insert error (non-fatal): ${err.message}`);
  }

  // Build detection object with DB ID attached
  const detection = {
    id: v3Data.id,
    dbId: dbDetectionId, // Attach the DB ID for linking
    camera: cameraId,
    time: v3Data.time,
    imageUrl: snapshotUrl,
    image_path: snapshotUrl,
    class: v3Data.class,
    score: v3Data.score,
    confidence: v3Data.score
  };

  // Feed to Redis-backed Episode Manager
  await redisEpisodeManager.processFrame(cameraId, detection);

  // Legacy support
  if (processLiveDetection) {
    const v1Data = {
      camera_id: cameraId,
      timestamp: v3Data.time,
      frame_number: Math.floor(Date.now() / 1000),
      frame_image: null,
      image_path: snapshotUrl,
      detections: [{
        label: v3Data.class,
        confidence: v3Data.score,
        bbox: [0, 0, 0, 0],
        bbox_normalized: [0, 0, 0, 0]
      }],
      detection_count: 1,
      source: 'v3'
    };
    processLiveDetection(v1Data);
  }
}

/**
 * Initialize Redis Episode Manager and event handlers
 */
async function initEpisodeManagerEvents(io, threatAnalysisService = null) {
  // Initialize Redis connection
  await redisEpisodeManager.initialize();
  
  // Episode Started
  redisEpisodeManager.on('episode:start', (data) => {
    console.log(`[v3-Bridge] Episode Started: ${data.id}`);
    io.emit('episode:new', {
      id: data.id,
      camera_id: data.camera_id,
      start_time: data.start_time,
      status: 'recording',
      keyframe: null,
      threat_assessment: null,
      analysis: null
    });
  });

  // Episode Ready for AI (triggered by Janitor when session expires)
  redisEpisodeManager.on('episode:ready', async (episodeData) => {
    console.log(`[v3-Bridge] Episode Ready: ${episodeData.id} (${episodeData.frame_count} frames, ${episodeData.duration_sec}s)`);
    
    // =========================================================================
    // SANITIZATION: Slice zombie sessions (keep only last 60 seconds)
    // =========================================================================
    const sanitizedFrames = sanitizeFrames(episodeData);
    
    // Cache for filmstrip access (with sanitized frames)
    cacheEpisode(episodeData, sanitizedFrames);
    
    // =========================================================================
    // LINK FRAMES TO EPISODE (detections already in DB from immediate insert)
    // =========================================================================
    try {
      // Collect DB IDs from cached detections
      const linkedIds = [];
      for (const det of sanitizedFrames) {
        const dbId = det.dbId || getDetectionDbId(det.id);
        if (dbId) {
          linkedIds.push(dbId);
        }
      }
      
      // Save episode to database
      db.episodes.insert({
        id: episodeData.id,
        camera_id: episodeData.camera_id,
        start_time: episodeData.start_time,
        end_time: episodeData.end_time,
        duration_sec: episodeData.duration_sec,
        frame_count: sanitizedFrames.length,
        status: 'complete'
      });
      
      // STRICT ID LINKING: Use episode_frames table with bulk insert
      if (linkedIds.length > 0) {
        db.episodes.linkFrames(episodeData.id, linkedIds);
        console.log(`[v3-Bridge] DB: Linked ${linkedIds.length} frames to ${episodeData.id}`);
      } else {
        console.log(`[v3-Bridge] DB: No DB IDs found to link for ${episodeData.id}`);
      }
    } catch (err) {
      console.error('[v3-Bridge] DB persist error:', err.message);
    }
    
    // Emit to frontend
    io.emit('episode:new', {
      id: episodeData.id,
      camera_id: episodeData.camera_id,
      start_time: episodeData.start_time,
      end_time: episodeData.end_time,
      duration_sec: episodeData.duration_sec,
      frame_count: sanitizedFrames.length,
      keyframe: episodeData.keyframe,
      status: 'analyzing',
      threat_assessment: null,
      analysis: null
    });

    // Trigger Gemini Analysis (with sanitized frames)
    if (threatAnalysisService) {
      try {
        console.log(`[v3-Bridge] Triggering Gemini analysis for ${episodeData.id}`);
        // Override detections with sanitized frames for analysis
        const sanitizedEpisode = { ...episodeData, detections: sanitizedFrames };
        const analysis = await threatAnalysisService.analyzeLiveEpisode(sanitizedEpisode);
        
        io.emit('episode:analyzed', {
          episode_id: episodeData.id,
          threat_assessment: analysis.threat_assessment,
          analysis: analysis.analysis,
          frames_analyzed: analysis.frames_analyzed,
          analysis_time_ms: analysis.analysis_time_ms,
          model: analysis.model
        });

        // =========================================================================
        // PERSIST ANALYSIS TO DATABASE - Critical fix for analysis disappearing
        // =========================================================================
        try {
          const analysisJson = JSON.stringify({
            threat_assessment: analysis.threat_assessment,
            analysis: analysis.analysis,
            frames_analyzed: analysis.frames_analyzed,
            analysis_time_ms: analysis.analysis_time_ms,
            model: analysis.model
          });
          db.raw.prepare(`
            UPDATE episodes SET analysis_json = ? WHERE id = ?
          `).run(analysisJson, episodeData.id);
          console.log(`[v3-Bridge] DB: Persisted analysis for ${episodeData.id}`);
        } catch (dbErr) {
          console.error(`[v3-Bridge] DB persist error: ${dbErr.message}`);
        }

        console.log(`[v3-Bridge] Analysis complete: ${episodeData.id} -> ${analysis.threat_assessment?.code || 'unknown'}`);
      } catch (err) {
        console.error(`[v3-Bridge] Analysis failed: ${err.message}`);
      }
    }
  });

  console.log('[v3-Bridge] Redis EpisodeManager events initialized');
}

/**
 * Get episode status from Redis
 */
async function getEpisodeStatus() {
  return await redisEpisodeManager.getStatus();
}

export { 
  processV2Detection, 
  initEpisodeManagerEvents, 
  getEpisodeStatus, 
  v2ThrottleState,
  getCachedEpisode,
  liveEpisodeCache,
  getDetectionDbId
};
