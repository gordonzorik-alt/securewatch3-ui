/**
 * ThreatEpisodeSelector - Intelligent episode selection for LLM analysis
 *
 * Combines:
 * 1. Episode clustering (time-based grouping)
 * 2. Threat scoring (heuristic-based)
 * 3. Keyframe selection (best representative frame)
 * 4. Final filtering (top N most suspicious)
 */

import ThreatScorer from './ThreatScorer.js';

/**
 * @typedef {Object} Detection
 * @property {string} label - Object class (e.g., "person", "knife")
 * @property {number} confidence - Detection confidence 0.0-1.0
 * @property {number[]} bbox - Bounding box [x1, y1, x2, y2]
 */

/**
 * @typedef {Object} FrameData
 * @property {number} timestamp - Frame timestamp in milliseconds
 * @property {string} imageUrl - URL/path to the frame image
 * @property {Detection[]} detections - Array of detections in this frame
 * @property {number} [frameNumber] - Optional frame number
 */

/**
 * @typedef {Object} Episode
 * @property {string} id - Unique episode identifier
 * @property {number} startTime - Episode start timestamp
 * @property {number} endTime - Episode end timestamp
 * @property {number} duration - Duration in seconds
 * @property {number} maxThreatScore - Highest threat score in episode
 * @property {string} threatLevel - Category: critical/high/medium/low/minimal
 * @property {FrameData} bestFrame - The highest-scoring frame (keyframe)
 * @property {Object} bestFrameBreakdown - Score breakdown for best frame
 * @property {string[]} allDetections - Summary of all objects detected
 * @property {number} frameCount - Number of frames in episode
 * @property {Object} objectCounts - Count of each object class
 */

export default class ThreatEpisodeSelector {
  /**
   * @param {Object} options Configuration options
   * @param {number} options.episodeGapMs - Gap threshold to split episodes (default: 3000ms)
   * @param {number} options.minEpisodeDurationMs - Minimum episode duration (default: 500ms)
   * @param {number} options.diversityWindowMs - Window for diversity filtering (default: 5000ms)
   * @param {Object} options.scorerOptions - Options for ThreatScorer
   */
  constructor(options = {}) {
    this.episodeGapMs = options.episodeGapMs || 3000;
    this.minEpisodeDurationMs = options.minEpisodeDurationMs || 500;
    this.diversityWindowMs = options.diversityWindowMs || 5000;
    this.scorer = new ThreatScorer(options.scorerOptions || {});

    // Internal state
    this.currentEpisode = null;
    this.episodes = [];
    this.frameBuffer = [];
  }

  /**
   * Process a single frame and add to current episode or start new one
   * @param {FrameData} frame Frame to process
   * @returns {Episode|null} Returns closed episode if gap exceeded
   */
  processFrame(frame) {
    const timestamp = frame.timestamp;
    let closedEpisode = null;

    // Calculate threat score for this frame
    const { score, breakdown } = this.scorer.calculateFrameScore(frame);
    const scoredFrame = { ...frame, threatScore: score, scoreBreakdown: breakdown };

    // No active episode - start new one
    if (!this.currentEpisode) {
      this.startNewEpisode(scoredFrame);
      return null;
    }

    // Check gap from last frame
    const gap = timestamp - this.currentEpisode.lastTimestamp;

    if (gap > this.episodeGapMs) {
      // Gap exceeded - close current episode and start new one
      closedEpisode = this.closeCurrentEpisode();
      this.startNewEpisode(scoredFrame);
      return closedEpisode;
    }

    // Within gap - add to current episode
    this.addFrameToEpisode(scoredFrame);
    return null;
  }

  /**
   * Start a new episode with the given frame
   * @param {Object} scoredFrame Frame with threatScore added
   */
  startNewEpisode(scoredFrame) {
    // Generate deterministic ID based on videoId and startTime so same episode always has same ID
    const videoId = scoredFrame.videoId || 0;
    const startTs = scoredFrame.timestamp;
    this.currentEpisode = {
      id: `ep_v${videoId}_${startTs}`,
      startTime: startTs,
      endTime: scoredFrame.timestamp,
      lastTimestamp: scoredFrame.timestamp,
      frames: [scoredFrame],
      maxThreatScore: scoredFrame.threatScore,
      bestFrame: scoredFrame,
      bestFrameBreakdown: scoredFrame.scoreBreakdown,
      allDetections: new Set(),
      objectCounts: {}
    };

    this.updateEpisodeStats(scoredFrame);
  }

  /**
   * Add a frame to the current episode
   * @param {Object} scoredFrame Frame with threatScore added
   */
  addFrameToEpisode(scoredFrame) {
    this.currentEpisode.frames.push(scoredFrame);
    this.currentEpisode.endTime = scoredFrame.timestamp;
    this.currentEpisode.lastTimestamp = scoredFrame.timestamp;

    // Update best frame if this one has higher score
    if (scoredFrame.threatScore > this.currentEpisode.maxThreatScore) {
      this.currentEpisode.maxThreatScore = scoredFrame.threatScore;
      this.currentEpisode.bestFrame = scoredFrame;
      this.currentEpisode.bestFrameBreakdown = scoredFrame.scoreBreakdown;
    }

    this.updateEpisodeStats(scoredFrame);
  }

  /**
   * Update episode statistics from a frame
   * @param {Object} scoredFrame
   */
  updateEpisodeStats(scoredFrame) {
    const detections = scoredFrame.detections || [];

    for (const det of detections) {
      const label = (det.label || det.object_class || 'unknown').toLowerCase();
      this.currentEpisode.allDetections.add(label);
      this.currentEpisode.objectCounts[label] =
        (this.currentEpisode.objectCounts[label] || 0) + 1;
    }
  }

  /**
   * Close and finalize the current episode
   * @returns {Episode|null}
   */
  closeCurrentEpisode() {
    if (!this.currentEpisode) return null;

    const episode = this.currentEpisode;
    const duration = (episode.endTime - episode.startTime) / 1000;

    // Skip episodes that are too short
    if (duration * 1000 < this.minEpisodeDurationMs && episode.frames.length < 2) {
      this.currentEpisode = null;
      return null;
    }

    // Finalize the episode
    const finalEpisode = {
      id: episode.id,
      startTime: episode.startTime,
      endTime: episode.endTime,
      duration: Math.round(duration * 100) / 100,
      maxThreatScore: episode.maxThreatScore,
      threatLevel: this.scorer.getThreatLevel(episode.maxThreatScore),
      bestFrame: {
        timestamp: episode.bestFrame.timestamp,
        imageUrl: episode.bestFrame.imageUrl,
        frameNumber: episode.bestFrame.frameNumber,
        videoId: episode.bestFrame.videoId,
        detections: episode.bestFrame.detections,
        threatScore: episode.bestFrame.threatScore
      },
      bestFrameBreakdown: episode.bestFrameBreakdown,
      allDetections: Array.from(episode.allDetections),
      frameCount: episode.frames.length,
      objectCounts: episode.objectCounts
    };

    this.episodes.push(finalEpisode);
    this.currentEpisode = null;

    return finalEpisode;
  }

  /**
   * Flush any remaining open episode
   * @returns {Episode|null}
   */
  flush() {
    return this.closeCurrentEpisode();
  }

  /**
   * Process multiple frames at once
   * @param {FrameData[]} frames Array of frames (should be sorted by timestamp)
   * @returns {Episode[]} Array of closed episodes
   */
  processFrames(frames) {
    const closedEpisodes = [];

    // Sort by timestamp
    const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);

    for (const frame of sorted) {
      const closed = this.processFrame(frame);
      if (closed) {
        closedEpisodes.push(closed);
      }
    }

    return closedEpisodes;
  }

  /**
   * Apply diversity filtering to remove temporally close episodes
   * @param {Episode[]} episodes Sorted episodes (by score descending)
   * @param {number} limit Maximum episodes to return
   * @returns {Episode[]}
   */
  applyDiversityFilter(episodes, limit) {
    const selected = [];
    const usedTimeRanges = [];

    for (const episode of episodes) {
      if (selected.length >= limit) break;

      // Check if this episode is too close to an already selected one
      const tooClose = usedTimeRanges.some(range => {
        const overlap =
          (episode.startTime >= range.start - this.diversityWindowMs &&
           episode.startTime <= range.end + this.diversityWindowMs) ||
          (episode.endTime >= range.start - this.diversityWindowMs &&
           episode.endTime <= range.end + this.diversityWindowMs);
        return overlap;
      });

      if (!tooClose) {
        selected.push(episode);
        usedTimeRanges.push({
          start: episode.startTime,
          end: episode.endTime
        });
      }
    }

    return selected;
  }

  /**
   * Main entry function - select best episodes for LLM analysis
   * @param {FrameData[]} frames Array of all frames to process
   * @param {number} limit Maximum number of episodes to return (default: 5)
   * @param {Object} options Additional options
   * @param {boolean} options.useDiversity Apply diversity filtering (default: true)
   * @param {number} options.minScore Minimum score threshold (default: 0)
   * @returns {Object} { episodes, stats }
   */
  selectBestEpisodes(frames, limit = 5, options = {}) {
    const useDiversity = options.useDiversity !== false;
    const minScore = options.minScore || 0;

    // Reset state
    this.currentEpisode = null;
    this.episodes = [];

    // Process all frames
    this.processFrames(frames);

    // Flush final episode
    this.flush();

    // Filter by minimum score
    let candidates = this.episodes.filter(ep => ep.maxThreatScore >= minScore);

    // Sort by threat score (descending)
    candidates.sort((a, b) => b.maxThreatScore - a.maxThreatScore);

    // Apply diversity filter if enabled
    let selected;
    if (useDiversity) {
      selected = this.applyDiversityFilter(candidates, limit);
    } else {
      selected = candidates.slice(0, limit);
    }

    // Generate stats
    const stats = {
      totalFrames: frames.length,
      totalEpisodes: this.episodes.length,
      selectedEpisodes: selected.length,
      scoreDistribution: {
        critical: this.episodes.filter(e => e.threatLevel === 'critical').length,
        high: this.episodes.filter(e => e.threatLevel === 'high').length,
        medium: this.episodes.filter(e => e.threatLevel === 'medium').length,
        low: this.episodes.filter(e => e.threatLevel === 'low').length,
        minimal: this.episodes.filter(e => e.threatLevel === 'minimal').length
      },
      maxScore: Math.max(...this.episodes.map(e => e.maxThreatScore), 0),
      avgScore: this.episodes.length > 0
        ? Math.round(this.episodes.reduce((s, e) => s + e.maxThreatScore, 0) / this.episodes.length)
        : 0
    };

    return {
      episodes: selected,
      stats
    };
  }

  /**
   * Generate LLM-ready payload from selected episodes
   * @param {Episode[]} episodes Selected episodes
   * @returns {Object} Formatted payload for LLM
   */
  generateLLMPayload(episodes) {
    return {
      episodeCount: episodes.length,
      episodes: episodes.map((ep, idx) => ({
        rank: idx + 1,
        id: ep.id,
        videoId: ep.bestFrame.videoId,
        threatLevel: ep.threatLevel,
        threatScore: ep.maxThreatScore,
        timestamp: new Date(ep.startTime).toISOString(),
        startTime: ep.startTime,  // Raw epoch ms for direct frame selection
        endTime: ep.endTime,      // Raw epoch ms for direct frame selection
        duration: `${ep.duration}s`,
        keyframe: {
          imageUrl: ep.bestFrame.imageUrl + `?t=${ep.startTime}`,
          frameNumber: ep.bestFrame.frameNumber,
          detections: ep.bestFrame.detections.map(d => ({
            label: d.label || d.object_class,
            confidence: Math.round((d.confidence || 0) * 100) + '%'
          }))
        },
        scoreBreakdown: {
          baseScore: ep.bestFrameBreakdown.baseScore,
          interactionBonus: ep.bestFrameBreakdown.interactionBonus,
          triggeredRules: ep.bestFrameBreakdown.triggeredRules.map(r => r.name)
        },
        objectsSeen: ep.allDetections
      })),
      metadata: {
        generatedAt: new Date().toISOString(),
        scorerConfig: this.scorer.getConfig()
      }
    };
  }

  /**
   * Get all episodes (for debugging/analysis)
   * @returns {Episode[]}
   */
  getAllEpisodes() {
    return this.episodes;
  }

  /**
   * Reset the selector state
   */
  reset() {
    this.currentEpisode = null;
    this.episodes = [];
    this.frameBuffer = [];
  }
}
