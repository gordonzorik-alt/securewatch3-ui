/**
 * SecureWatch SQLite Database Service
 * Replaces JSON file storage with high-performance SQLite + WAL mode
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'securewatch.db');

// Initialize database with WAL mode for better concurrency
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64MB cache
db.pragma('temp_store = MEMORY');

// Create schema
const initSchema = () => {
  db.exec(`
    -- Videos table (uploaded video files)
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER,
      uploaded_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'pending',
      duration REAL,
      fps REAL,
      width INTEGER,
      height INTEGER
    );

    -- Detections table (frame-level object detections)
    CREATE TABLE IF NOT EXISTS detections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER,
      camera_id TEXT,
      frame_number INTEGER NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      label TEXT NOT NULL,
      confidence REAL NOT NULL,
      bbox_json TEXT,
      bbox_normalized_json TEXT,
      image_path TEXT,
      track_id INTEGER,
      engine TEXT DEFAULT 'yolo',
      FOREIGN KEY (video_id) REFERENCES videos(id)
    );

    -- Episodes table (grouped detections)
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      video_id INTEGER,
      camera_id TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration_sec REAL,
      frame_count INTEGER DEFAULT 0,
      object_counts_json TEXT,
      best_snapshot_json TEXT,
      threat_score REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (video_id) REFERENCES videos(id)
    );

    -- Episode-Detection junction table
    CREATE TABLE IF NOT EXISTS episode_detections (
      episode_id TEXT NOT NULL,
      detection_id INTEGER NOT NULL,
      PRIMARY KEY (episode_id, detection_id),
      FOREIGN KEY (episode_id) REFERENCES episodes(id),
      FOREIGN KEY (detection_id) REFERENCES detections(id)
    );

    -- Threat analysis results (LLM outputs)
    CREATE TABLE IF NOT EXISTS threat_analysis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id TEXT NOT NULL,
      analyzed_at TEXT DEFAULT (datetime('now')),
      threat_code TEXT,
      threat_label TEXT,
      threat_level TEXT,
      confidence REAL,
      color TEXT,
      observations_json TEXT,
      reasoning TEXT,
      recommended_action TEXT,
      raw_response_json TEXT,
      FOREIGN KEY (episode_id) REFERENCES episodes(id)
    );

    -- Camera monitors configuration
    CREATE TABLE IF NOT EXISTS monitors (
      camera_id TEXT PRIMARY KEY,
      source_url TEXT NOT NULL,
      mode TEXT DEFAULT 'HTTP',
      enabled INTEGER DEFAULT 1,
      options_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Zones configuration
    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id TEXT,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'restricted',
      polygon_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Events log (generic event storage)
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      camera_id TEXT,
      timestamp TEXT DEFAULT (datetime('now')),
      type TEXT NOT NULL,
      data_json TEXT
    );

    -- Create indexes for fast queries
    CREATE INDEX IF NOT EXISTS idx_detections_timestamp ON detections(timestamp);
    CREATE INDEX IF NOT EXISTS idx_detections_camera ON detections(camera_id);
    CREATE INDEX IF NOT EXISTS idx_detections_video ON detections(video_id);
    CREATE INDEX IF NOT EXISTS idx_detections_label ON detections(label);
    CREATE INDEX IF NOT EXISTS idx_episodes_camera ON episodes(camera_id);
    CREATE INDEX IF NOT EXISTS idx_episodes_start ON episodes(start_time);
    CREATE INDEX IF NOT EXISTS idx_episodes_threat ON episodes(threat_score DESC);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_camera ON events(camera_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_threat_analysis_episode ON threat_analysis(episode_id);
  `);

  console.log('[DB] Schema initialized');
};

// Initialize schema on load
initSchema();

// ============================================
// PREPARED STATEMENTS (for performance)
// ============================================

const statements = {
  // Videos
  insertVideo: db.prepare(`
    INSERT INTO videos (filename, path, size, status, duration, fps, width, height)
    VALUES (@filename, @path, @size, @status, @duration, @fps, @width, @height)
  `),
  getVideo: db.prepare('SELECT * FROM videos WHERE id = ?'),
  getAllVideos: db.prepare('SELECT * FROM videos ORDER BY uploaded_at DESC'),
  updateVideoStatus: db.prepare('UPDATE videos SET status = ? WHERE id = ?'),

  // Detections
  insertDetection: db.prepare(`
    INSERT INTO detections (video_id, camera_id, frame_number, timestamp, label, confidence, bbox_json, bbox_normalized_json, image_path, track_id, engine)
    VALUES (@video_id, @camera_id, @frame_number, @timestamp, @label, @confidence, @bbox_json, @bbox_normalized_json, @image_path, @track_id, @engine)
  `),
  getDetection: db.prepare('SELECT * FROM detections WHERE id = ?'),
  getDetectionsByVideo: db.prepare('SELECT * FROM detections WHERE video_id = ? ORDER BY frame_number'),
  getDetectionsByCamera: db.prepare('SELECT * FROM detections WHERE camera_id = ? ORDER BY timestamp DESC LIMIT ?'),
  getDetectionsByEpisode: db.prepare(`
    SELECT d.* FROM detections d
    JOIN episode_detections ed ON d.id = ed.detection_id
    WHERE ed.episode_id = ?
    ORDER BY d.frame_number
  `),
  getRecentDetections: db.prepare('SELECT * FROM detections ORDER BY timestamp DESC LIMIT ?'),

  // Episodes
  insertEpisode: db.prepare(`
    INSERT INTO episodes (id, video_id, camera_id, start_time, end_time, duration_sec, frame_count, object_counts_json, best_snapshot_json, threat_score, status)
    VALUES (@id, @video_id, @camera_id, @start_time, @end_time, @duration_sec, @frame_count, @object_counts_json, @best_snapshot_json, @threat_score, @status)
  `),
  updateEpisode: db.prepare(`
    UPDATE episodes SET
      end_time = @end_time,
      duration_sec = @duration_sec,
      frame_count = @frame_count,
      object_counts_json = @object_counts_json,
      best_snapshot_json = @best_snapshot_json,
      threat_score = @threat_score,
      status = @status
    WHERE id = @id
  `),
  getEpisode: db.prepare('SELECT * FROM episodes WHERE id = ?'),
  getEpisodesByCamera: db.prepare('SELECT * FROM episodes WHERE camera_id = ? ORDER BY start_time DESC LIMIT ?'),
  getTopEpisodesByThreat: db.prepare('SELECT * FROM episodes ORDER BY threat_score DESC LIMIT ?'),
  getLiveEpisodes: db.prepare(`
    SELECT * FROM episodes
    WHERE camera_id IS NOT NULL
    ORDER BY start_time DESC
    LIMIT ?
  `),

  // Episode-Detection link
  linkEpisodeDetection: db.prepare(`
    INSERT OR IGNORE INTO episode_detections (episode_id, detection_id) VALUES (?, ?)
  `),

  // Threat Analysis
  insertThreatAnalysis: db.prepare(`
    INSERT INTO threat_analysis (episode_id, threat_code, threat_label, threat_level, confidence, color, observations_json, reasoning, recommended_action, raw_response_json)
    VALUES (@episode_id, @threat_code, @threat_label, @threat_level, @confidence, @color, @observations_json, @reasoning, @recommended_action, @raw_response_json)
  `),
  getThreatAnalysis: db.prepare('SELECT * FROM threat_analysis WHERE episode_id = ?'),
  getAllThreatAnalysis: db.prepare('SELECT * FROM threat_analysis ORDER BY analyzed_at DESC LIMIT ?'),

  // Monitors
  upsertMonitor: db.prepare(`
    INSERT INTO monitors (camera_id, source_url, mode, enabled, options_json, updated_at)
    VALUES (@camera_id, @source_url, @mode, @enabled, @options_json, datetime('now'))
    ON CONFLICT(camera_id) DO UPDATE SET
      source_url = @source_url,
      mode = @mode,
      enabled = @enabled,
      options_json = @options_json,
      updated_at = datetime('now')
  `),
  getMonitor: db.prepare('SELECT * FROM monitors WHERE camera_id = ?'),
  getAllMonitors: db.prepare('SELECT * FROM monitors'),
  deleteMonitor: db.prepare('DELETE FROM monitors WHERE camera_id = ?'),

  // Events
  insertEvent: db.prepare(`
    INSERT INTO events (camera_id, type, data_json) VALUES (?, ?, ?)
  `),
  getRecentEvents: db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?'),
  getEventsByCamera: db.prepare('SELECT * FROM events WHERE camera_id = ? ORDER BY timestamp DESC LIMIT ?'),
  getEventsByType: db.prepare('SELECT * FROM events WHERE type = ? ORDER BY timestamp DESC LIMIT ?'),

  // Zones
  insertZone: db.prepare(`
    INSERT INTO zones (camera_id, name, type, polygon_json) VALUES (@camera_id, @name, @type, @polygon_json)
  `),
  getZonesByCamera: db.prepare('SELECT * FROM zones WHERE camera_id = ?'),
  getAllZones: db.prepare('SELECT * FROM zones'),
  deleteZone: db.prepare('DELETE FROM zones WHERE id = ?'),
};

// ============================================
// DATABASE API
// ============================================

const database = {
  // Raw access for complex queries
  raw: db,

  // Videos
  videos: {
    insert: (video) => {
      const result = statements.insertVideo.run({
        filename: video.filename,
        path: video.path,
        size: video.size || null,
        status: video.status || 'pending',
        duration: video.duration || null,
        fps: video.fps || null,
        width: video.width || null,
        height: video.height || null,
      });
      return result.lastInsertRowid;
    },
    get: (id) => statements.getVideo.get(id),
    getAll: () => statements.getAllVideos.all(),
    updateStatus: (id, status) => statements.updateVideoStatus.run(status, id),
  },

  // Detections
  detections: {
    insert: (detection) => {
      const result = statements.insertDetection.run({
        video_id: detection.video_id || null,
        camera_id: detection.camera_id || null,
        frame_number: detection.frame_number,
        timestamp: detection.timestamp || new Date().toISOString(),
        label: detection.label,
        confidence: detection.confidence,
        bbox_json: JSON.stringify(detection.bbox || detection.box),
        bbox_normalized_json: JSON.stringify(detection.bbox_normalized),
        image_path: detection.image_path || detection.snapshot_path,
        track_id: detection.track_id || null,
        engine: detection.engine || 'yolo',
      });
      return result.lastInsertRowid;
    },
    get: (id) => {
      const row = statements.getDetection.get(id);
      return row ? parseDetectionRow(row) : null;
    },
    getByVideo: (videoId) => statements.getDetectionsByVideo.all(videoId).map(parseDetectionRow),
    getByCamera: (cameraId, limit = 100) => statements.getDetectionsByCamera.all(cameraId, limit).map(parseDetectionRow),
    getByEpisode: (episodeId) => statements.getDetectionsByEpisode.all(episodeId).map(parseDetectionRow),
    getRecent: (limit = 100) => statements.getRecentDetections.all(limit).map(parseDetectionRow),
  },

  // Episodes
  episodes: {
    insert: (episode) => {
      statements.insertEpisode.run({
        id: episode.id,
        video_id: episode.video_id || null,
        camera_id: episode.camera_id || null,
        start_time: episode.start_time || episode.startTime,
        end_time: episode.end_time || episode.endTime || null,
        duration_sec: episode.duration_sec || episode.duration || 0,
        frame_count: episode.frame_count || episode.frameCount || 0,
        object_counts_json: JSON.stringify(episode.object_counts || episode.objectCounts || {}),
        best_snapshot_json: JSON.stringify(episode.best_snapshot || episode.bestSnapshot || null),
        threat_score: episode.threat_score || episode.threatScore || 0,
        status: episode.status || 'active',
      });
      return episode.id;
    },
    update: (episode) => {
      statements.updateEpisode.run({
        id: episode.id,
        end_time: episode.end_time || episode.endTime,
        duration_sec: episode.duration_sec || episode.duration,
        frame_count: episode.frame_count || episode.frameCount,
        object_counts_json: JSON.stringify(episode.object_counts || episode.objectCounts || {}),
        best_snapshot_json: JSON.stringify(episode.best_snapshot || episode.bestSnapshot || null),
        threat_score: episode.threat_score || episode.threatScore || 0,
        status: episode.status || 'active',
      });
    },
    get: (id) => {
      const row = statements.getEpisode.get(id);
      return row ? parseEpisodeRow(row) : null;
    },
    getByCamera: (cameraId, limit = 50) => statements.getEpisodesByCamera.all(cameraId, limit).map(parseEpisodeRow),
    getTopByThreat: (limit = 20) => statements.getTopEpisodesByThreat.all(limit).map(parseEpisodeRow),
    getLive: (limit = 50) => statements.getLiveEpisodes.all(limit).map(parseEpisodeRow),
    linkDetection: (episodeId, detectionId) => statements.linkEpisodeDetection.run(episodeId, detectionId),
  },

  // Threat Analysis
  threats: {
    insert: (analysis) => {
      const result = statements.insertThreatAnalysis.run({
        episode_id: analysis.episode_id || analysis.episodeId,
        threat_code: analysis.threat_code || analysis.threatCode,
        threat_label: analysis.threat_label || analysis.threatLabel,
        threat_level: analysis.threat_level || analysis.threatLevel,
        confidence: analysis.confidence,
        color: analysis.color,
        observations_json: JSON.stringify(analysis.observations || []),
        reasoning: analysis.reasoning,
        recommended_action: analysis.recommended_action || analysis.recommendedAction,
        raw_response_json: JSON.stringify(analysis.raw_response || analysis.rawResponse || {}),
      });
      return result.lastInsertRowid;
    },
    getByEpisode: (episodeId) => {
      const row = statements.getThreatAnalysis.get(episodeId);
      return row ? parseThreatRow(row) : null;
    },
    getAll: (limit = 100) => statements.getAllThreatAnalysis.all(limit).map(parseThreatRow),
  },

  // Monitors
  monitors: {
    upsert: (monitor) => {
      statements.upsertMonitor.run({
        camera_id: monitor.cameraId || monitor.camera_id,
        source_url: monitor.sourceUrl || monitor.source_url,
        mode: monitor.mode || 'HTTP',
        enabled: monitor.enabled !== false ? 1 : 0,
        options_json: JSON.stringify(monitor.options || {}),
      });
    },
    get: (cameraId) => {
      const row = statements.getMonitor.get(cameraId);
      return row ? parseMonitorRow(row) : null;
    },
    getAll: () => statements.getAllMonitors.all().map(parseMonitorRow),
    delete: (cameraId) => statements.deleteMonitor.run(cameraId),
  },

  // Events
  events: {
    insert: (event) => {
      const result = statements.insertEvent.run(
        event.camera_id || event.cameraId || null,
        event.type,
        JSON.stringify(event.data || {})
      );
      return result.lastInsertRowid;
    },
    getRecent: (limit = 100) => statements.getRecentEvents.all(limit).map(parseEventRow),
    getByCamera: (cameraId, limit = 100) => statements.getEventsByCamera.all(cameraId, limit).map(parseEventRow),
    getByType: (type, limit = 100) => statements.getEventsByType.all(type, limit).map(parseEventRow),
  },

  // Zones
  zones: {
    insert: (zone) => {
      const result = statements.insertZone.run({
        camera_id: zone.camera_id || zone.cameraId,
        name: zone.name,
        type: zone.type || 'restricted',
        polygon_json: JSON.stringify(zone.polygon || zone.points || []),
      });
      return result.lastInsertRowid;
    },
    getByCamera: (cameraId) => statements.getZonesByCamera.all(cameraId).map(parseZoneRow),
    getAll: () => statements.getAllZones.all().map(parseZoneRow),
    delete: (id) => statements.deleteZone.run(id),
  },

  // Transactions for batch operations
  transaction: (fn) => db.transaction(fn)(),

  // Cleanup
  close: () => db.close(),
};

// ============================================
// ROW PARSERS (JSON fields → objects)
// ============================================

function parseDetectionRow(row) {
  return {
    ...row,
    bbox: JSON.parse(row.bbox_json || '[]'),
    bbox_normalized: JSON.parse(row.bbox_normalized_json || 'null'),
  };
}

function parseEpisodeRow(row) {
  return {
    ...row,
    object_counts: JSON.parse(row.object_counts_json || '{}'),
    best_snapshot: JSON.parse(row.best_snapshot_json || 'null'),
    // Camel case aliases
    startTime: row.start_time,
    endTime: row.end_time,
    frameCount: row.frame_count,
    threatScore: row.threat_score,
  };
}

function parseThreatRow(row) {
  return {
    ...row,
    observations: JSON.parse(row.observations_json || '[]'),
    raw_response: JSON.parse(row.raw_response_json || '{}'),
  };
}

function parseMonitorRow(row) {
  return {
    cameraId: row.camera_id,
    camera_id: row.camera_id,
    sourceUrl: row.source_url,
    source_url: row.source_url,
    rtsp_url: row.rtsp_url,
    mode: row.mode,
    enabled: row.enabled === 1,
    options: JSON.parse(row.options_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseEventRow(row) {
  return {
    ...row,
    data: JSON.parse(row.data_json || '{}'),
  };
}

function parseZoneRow(row) {
  return {
    ...row,
    polygon: JSON.parse(row.polygon_json || '[]'),
  };
}

export default database;
