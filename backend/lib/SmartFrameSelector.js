/**
 * SmartFrameSelector - Intelligent frame selection for LLM analysis
 *
 * Instead of random sampling, selects the most informative frames:
 * - Entry: First detection (who entered)
 * - Exit: Last detection (where they went)
 * - Peak: Highest confidence frames (clearest view)
 * - Action: Largest bounding boxes (closest proximity)
 */

import fs from 'fs';
import path from 'path';
import db from './database.js';

/**
 * Calculate bounding box area from bbox_json
 */
function getBboxArea(bboxJson) {
  if (!bboxJson) return 0;
  try {
    const bbox = typeof bboxJson === 'string' ? JSON.parse(bboxJson) : bboxJson;
    // bbox format: [x, y, width, height] or {x, y, w, h}
    if (Array.isArray(bbox)) {
      return (bbox[2] || 0) * (bbox[3] || 0);
    }
    return (bbox.w || bbox.width || 0) * (bbox.h || bbox.height || 0);
  } catch {
    return 0;
  }
}

/**
 * Select the best frames for an episode using smart sampling
 * @param {string} episodeId - The episode ID
 * @param {number} limit - Maximum frames to return (default 8)
 * @returns {Array<{path: string, timestamp: string, confidence: number, label: string, reason: string}>}
 */
export function selectFrames(episodeId, limit = 8) {
  // Get all detections for this episode via the linking table
  const detections = db.raw.prepare(`
    SELECT d.*, ed.episode_id
    FROM detections d
    JOIN episode_detections ed ON d.id = ed.detection_id
    WHERE ed.episode_id = ?
    AND d.image_path IS NOT NULL
    ORDER BY d.timestamp ASC
  `).all(episodeId);

  if (detections.length === 0) {
    console.log(`[SmartFrameSelector] No detections found for episode ${episodeId}`);
    return [];
  }

  console.log(`[SmartFrameSelector] Found ${detections.length} detections for episode ${episodeId}`);

  const selectedFrames = new Map(); // Use Map to dedupe by image_path

  // 1. Entry Frame - First detection (chronologically)
  const entryFrame = detections[0];
  if (entryFrame && entryFrame.image_path) {
    selectedFrames.set(entryFrame.image_path, {
      ...entryFrame,
      reason: 'entry',
      bboxArea: getBboxArea(entryFrame.bbox_json)
    });
  }

  // 2. Exit Frame - Last detection (chronologically)
  const exitFrame = detections[detections.length - 1];
  if (exitFrame && exitFrame.image_path && exitFrame.image_path !== entryFrame?.image_path) {
    selectedFrames.set(exitFrame.image_path, {
      ...exitFrame,
      reason: 'exit',
      bboxArea: getBboxArea(exitFrame.bbox_json)
    });
  }

  // 3. Peak Frames - Highest confidence (clearest visual)
  const byConfidence = [...detections]
    .filter(d => d.image_path && !selectedFrames.has(d.image_path))
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  const peakCount = Math.min(4, Math.floor((limit - selectedFrames.size) / 2));
  for (let i = 0; i < peakCount && i < byConfidence.length; i++) {
    const frame = byConfidence[i];
    if (!selectedFrames.has(frame.image_path)) {
      selectedFrames.set(frame.image_path, {
        ...frame,
        reason: 'peak_confidence',
        bboxArea: getBboxArea(frame.bbox_json)
      });
    }
  }

  // 4. Action Frames - Largest bounding box (closest proximity)
  const withBboxArea = detections
    .filter(d => d.image_path && !selectedFrames.has(d.image_path))
    .map(d => ({
      ...d,
      bboxArea: getBboxArea(d.bbox_json)
    }))
    .sort((a, b) => b.bboxArea - a.bboxArea);

  const actionCount = Math.min(2, limit - selectedFrames.size);
  for (let i = 0; i < actionCount && i < withBboxArea.length; i++) {
    const frame = withBboxArea[i];
    if (!selectedFrames.has(frame.image_path)) {
      selectedFrames.set(frame.image_path, {
        ...frame,
        reason: 'action_proximity'
      });
    }
  }

  // Fill remaining slots with evenly distributed frames
  const remaining = limit - selectedFrames.size;
  if (remaining > 0) {
    const available = detections.filter(d => d.image_path && !selectedFrames.has(d.image_path));
    const step = Math.max(1, Math.floor(available.length / remaining));
    for (let i = 0; i < available.length && selectedFrames.size < limit; i += step) {
      const frame = available[i];
      if (!selectedFrames.has(frame.image_path)) {
        selectedFrames.set(frame.image_path, {
          ...frame,
          reason: 'distributed',
          bboxArea: getBboxArea(frame.bbox_json)
        });
      }
    }
  }

  // Convert to array and sort by timestamp for chronological narrative
  const frames = Array.from(selectedFrames.values())
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map(frame => ({
      path: frame.image_path,
      timestamp: frame.timestamp,
      confidence: frame.confidence,
      label: frame.label,
      reason: frame.reason,
      bboxArea: frame.bboxArea
    }));

  // Filter out missing files
  const validFrames = frames.filter(frame => {
    const fullPath = path.isAbsolute(frame.path)
      ? frame.path
      : path.join(process.cwd(), frame.path);

    if (!fs.existsSync(fullPath)) {
      console.log(`[SmartFrameSelector] Skipping missing file: ${frame.path}`);
      return false;
    }
    return true;
  });

  console.log(`[SmartFrameSelector] Selected ${validFrames.length} frames: ${validFrames.map(f => f.reason).join(', ')}`);

  return validFrames;
}

/**
 * Get frame selection summary for logging
 */
export function getSelectionSummary(frames) {
  const reasons = {};
  for (const frame of frames) {
    reasons[frame.reason] = (reasons[frame.reason] || 0) + 1;
  }
  return reasons;
}

export default { selectFrames, getSelectionSummary };
