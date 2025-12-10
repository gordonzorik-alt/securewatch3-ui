/**
 * EpisodeAggregator - Sliding Window Aggregator for SecureWatch3
 *
 * Groups detections occurring within a configurable time gap into "Episodes"
 * to reduce noise and optimize LLM analysis costs.
 *
 * Priority logic for best snapshot:
 * 1. Person > Vehicle > Other
 * 2. Higher confidence > Lower confidence
 */

export default class EpisodeAggregator {
  /**
   * @param {Object} options Configuration options
   * @param {number} options.gapThreshold - Max gap between detections in ms (default: 2000)
   * @param {number} options.videoId - Video ID for this aggregator instance
   */
  constructor(options = {}) {
    this.gapThreshold = options.gapThreshold || 2000; // 2 seconds default
    this.videoId = options.videoId || null;
    this.currentEpisode = null;
    this.episodeCounter = 0;
    this.closedEpisodes = [];
  }

  /**
   * Get priority score for object class (higher = better for snapshots)
   * @param {string} objectClass
   * @returns {number}
   */
  getClassPriority(objectClass) {
    const cls = (objectClass || '').toLowerCase();

    // Person has highest priority
    if (cls === 'person' || cls === 'human' || cls === 'pedestrian') {
      return 100;
    }

    // Vehicles have medium priority
    if (['car', 'truck', 'vehicle', 'motorcycle', 'bus', 'bicycle', 'bike'].some(v => cls.includes(v))) {
      return 50;
    }

    // Everything else has low priority
    return 10;
  }

  /**
   * Check if a detection is a better snapshot candidate than current best
   * @param {Object} detection New detection
   * @param {Object} currentBest Current best snapshot
   * @returns {boolean}
   */
  isBetterSnapshot(detection, currentBest) {
    if (!currentBest) return true;

    const newPriority = this.getClassPriority(detection.object_class);
    const currentPriority = this.getClassPriority(currentBest.label);

    // Higher class priority wins
    if (newPriority > currentPriority) return true;
    if (newPriority < currentPriority) return false;

    // Same class priority: higher confidence wins
    return (detection.confidence || 0) > (currentBest.confidence || 0);
  }

  /**
   * Start a new episode from a detection
   * @param {Object} detection
   */
  startNewEpisode(detection) {
    const timestamp = new Date(detection.detected_at).getTime();

    this.currentEpisode = {
      id: `ep_${Date.now()}_${++this.episodeCounter}`,
      video_id: detection.video_id || this.videoId,
      start_time: detection.detected_at,
      end_time: detection.detected_at,
      start_timestamp: timestamp,
      end_timestamp: timestamp,
      frame_count: 1,
      detection_ids: [detection.id],
      object_counts: {},
      best_snapshot: null
    };

    // Initialize object count
    const objClass = (detection.object_class || 'unknown').toLowerCase();
    this.currentEpisode.object_counts[objClass] = 1;

    // Set initial best snapshot
    this.updateBestSnapshot(detection);
  }

  /**
   * Update best snapshot if this detection is better
   * @param {Object} detection
   */
  updateBestSnapshot(detection) {
    const candidate = {
      path: detection.snapshot_path || `snapshots/video${detection.video_id}_frame${detection.frame_number}.jpg`,
      confidence: detection.confidence || 0,
      label: detection.object_class || 'unknown',
      detection_id: detection.id,
      frame_number: detection.frame_number,
      bounding_box: detection.bounding_box
    };

    if (this.isBetterSnapshot(detection, this.currentEpisode.best_snapshot)) {
      this.currentEpisode.best_snapshot = candidate;
    }
  }

  /**
   * Close the current episode and return it
   * @returns {Object|null} The closed episode or null if none active
   */
  closeCurrentEpisode() {
    if (!this.currentEpisode) return null;

    const episode = {
      ...this.currentEpisode,
      duration_sec: Math.round((this.currentEpisode.end_timestamp - this.currentEpisode.start_timestamp) / 1000 * 100) / 100
    };

    // Clean up internal timestamps
    delete episode.start_timestamp;
    delete episode.end_timestamp;

    this.closedEpisodes.push(episode);
    this.currentEpisode = null;

    return episode;
  }

  /**
   * Process a new detection
   * @param {Object} detection Detection object with: id, video_id, object_class, confidence, detected_at, frame_number, snapshot_path, bounding_box
   * @returns {Object|null} Returns closed episode if gap threshold exceeded, otherwise null
   */
  process(detection) {
    const timestamp = new Date(detection.detected_at).getTime();
    let closedEpisode = null;

    // No active episode - start new one
    if (!this.currentEpisode) {
      this.startNewEpisode(detection);
      return null;
    }

    // Calculate gap from last detection
    const gap = timestamp - this.currentEpisode.end_timestamp;

    // Gap exceeds threshold - close current episode and start new one
    if (gap > this.gapThreshold) {
      closedEpisode = this.closeCurrentEpisode();
      this.startNewEpisode(detection);
      return closedEpisode;
    }

    // Within threshold - update current episode
    this.currentEpisode.end_time = detection.detected_at;
    this.currentEpisode.end_timestamp = timestamp;
    this.currentEpisode.frame_count++;
    this.currentEpisode.detection_ids.push(detection.id);

    // Update object counts
    const objClass = (detection.object_class || 'unknown').toLowerCase();
    this.currentEpisode.object_counts[objClass] = (this.currentEpisode.object_counts[objClass] || 0) + 1;

    // Check if this is a better snapshot
    this.updateBestSnapshot(detection);

    return null;
  }

  /**
   * Process multiple detections in order
   * @param {Array} detections Array of detection objects
   * @returns {Array} Array of closed episodes
   */
  processMany(detections) {
    const episodes = [];

    // Sort by detected_at to ensure chronological processing
    const sorted = [...detections].sort((a, b) =>
      new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime()
    );

    for (const detection of sorted) {
      const episode = this.process(detection);
      if (episode) {
        episodes.push(episode);
      }
    }

    return episodes;
  }

  /**
   * Force close any open episode (call at end of video processing)
   * @returns {Object|null} The closed episode or null if none active
   */
  flush() {
    return this.closeCurrentEpisode();
  }

  /**
   * Get all closed episodes
   * @returns {Array}
   */
  getClosedEpisodes() {
    return this.closedEpisodes;
  }

  /**
   * Get current episode state (for debugging)
   * @returns {Object|null}
   */
  getCurrentEpisode() {
    return this.currentEpisode;
  }

  /**
   * Reset the aggregator state
   */
  reset() {
    this.currentEpisode = null;
    this.closedEpisodes = [];
    this.episodeCounter = 0;
  }

  /**
   * Get statistics about processed episodes
   * @returns {Object}
   */
  getStats() {
    const allEpisodes = [...this.closedEpisodes];
    if (this.currentEpisode) {
      allEpisodes.push(this.currentEpisode);
    }

    const totalDetections = allEpisodes.reduce((sum, ep) => sum + ep.frame_count, 0);
    const totalDuration = allEpisodes.reduce((sum, ep) => {
      const duration = ep.duration_sec || ((ep.end_timestamp - ep.start_timestamp) / 1000);
      return sum + duration;
    }, 0);

    return {
      episode_count: allEpisodes.length,
      total_detections: totalDetections,
      total_duration_sec: Math.round(totalDuration * 100) / 100,
      compression_ratio: totalDetections > 0 ? Math.round(totalDetections / allEpisodes.length * 100) / 100 : 0,
      has_active_episode: !!this.currentEpisode
    };
  }
}

// ES module export is handled by the class declaration
