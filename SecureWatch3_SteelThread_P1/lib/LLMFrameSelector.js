/**
 * LLMFrameSelector - Intelligent frame selection for LLM threat analysis
 *
 * Selects frames that tell the complete "story" of an episode,
 * not just the highest-scoring frames.
 *
 * Selection Strategy:
 * 1. ENTRY - First appearance in frame
 * 2. ZONE_TRANSITIONS - Movement between areas (entry→center→exit)
 * 3. PEAK_THREAT - Highest threat score moment
 * 4. DWELL_POINTS - Extended stays in one location
 * 5. ANOMALIES - Unusual behavior (direction change, speed change)
 * 6. EXIT - Last appearance
 *
 * Plus: Rich metadata for each frame to give LLM context
 */

export default class LLMFrameSelector {
  constructor(options = {}) {
    // Maximum frames to send to LLM (API limits)
    this.maxFrames = options.maxFrames || 8;

    // Minimum time between selected frames (avoid redundancy)
    this.minFrameGapMs = options.minFrameGapMs || 1000;

    // Zone definitions for spatial analysis
    this.zones = options.zones || {
      entry: { yRange: [0.7, 1.0], label: 'Near Camera / Entry' },
      center: { yRange: [0.3, 0.7], label: 'Main Area' },
      far: { yRange: [0.0, 0.3], label: 'Background / Far' },
      left: { xRange: [0.0, 0.3], label: 'Left Side' },
      right: { xRange: [0.7, 1.0], label: 'Right Side' }
    };

    // Movement thresholds
    this.significantMovement = options.significantMovement || 0.1; // 10% of frame
    this.dwellThresholdMs = options.dwellThresholdMs || 3000; // 3 seconds
  }

  /**
   * Select optimal frames for LLM analysis from an episode
   * @param {Array} frames - All frames in the episode with detections
   * @param {Object} episodeMetadata - Episode-level metadata
   * @returns {Object} Selected frames with rich context
   */
  selectFrames(frames, episodeMetadata = {}) {
    if (!frames || frames.length === 0) {
      return { frames: [], context: null };
    }

    // Sort by timestamp
    const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);

    // Analyze the episode
    const analysis = this.analyzeEpisode(sorted);

    // Select key frames based on narrative importance
    const keyFrames = this.selectKeyFrames(sorted, analysis);

    // Enrich frames with context
    const enrichedFrames = keyFrames.map((frame, idx) =>
      this.enrichFrame(frame, idx, keyFrames, analysis)
    );

    // Build episode context for LLM
    const context = this.buildEpisodeContext(sorted, analysis, episodeMetadata);

    return {
      frames: enrichedFrames,
      context,
      analysis
    };
  }

  /**
   * Analyze the full episode to understand the narrative
   */
  analyzeEpisode(frames) {
    const analysis = {
      duration: 0,
      entryPoint: null,
      exitPoint: null,
      peakThreatFrame: null,
      zoneTransitions: [],
      dwellPoints: [],
      movementPattern: [],
      anomalies: [],
      objectsDetected: new Set(),
      personTrack: []
    };

    if (frames.length === 0) return analysis;

    // Calculate duration
    analysis.duration = frames[frames.length - 1].timestamp - frames[0].timestamp;
    analysis.entryPoint = frames[0];
    analysis.exitPoint = frames[frames.length - 1];

    // Track person movement and find peak threat
    let maxThreat = 0;
    let currentZone = null;
    let zoneEntryTime = frames[0].timestamp;
    let prevCenter = null;

    frames.forEach((frame, idx) => {
      // Track all detected objects
      (frame.detections || []).forEach(det => {
        analysis.objectsDetected.add(det.label || det.object_class);
      });

      // Find person detection for tracking
      const personDet = (frame.detections || []).find(d =>
        (d.label || d.object_class || '').toLowerCase() === 'person'
      );

      if (personDet && personDet.bbox) {
        const center = this.getBboxCenter(personDet.bbox);
        const zone = this.getZone(center);

        // Track movement
        analysis.personTrack.push({
          timestamp: frame.timestamp,
          frameNumber: frame.frameNumber,
          center,
          zone,
          confidence: personDet.confidence
        });

        // Detect zone transitions
        if (currentZone && zone !== currentZone) {
          const dwellTime = frame.timestamp - zoneEntryTime;

          analysis.zoneTransitions.push({
            from: currentZone,
            to: zone,
            timestamp: frame.timestamp,
            frameNumber: frame.frameNumber,
            dwellTimeMs: dwellTime
          });

          // Check for significant dwell
          if (dwellTime >= this.dwellThresholdMs) {
            analysis.dwellPoints.push({
              zone: currentZone,
              startTime: zoneEntryTime,
              duration: dwellTime,
              frameNumber: frame.frameNumber
            });
          }

          zoneEntryTime = frame.timestamp;
        }
        currentZone = zone;

        // Detect movement anomalies (sudden direction change, stopping)
        if (prevCenter) {
          const movement = this.calculateMovement(prevCenter, center);
          analysis.movementPattern.push(movement);

          if (idx > 1) {
            const prevMovement = analysis.movementPattern[analysis.movementPattern.length - 2];
            if (this.isAnomalousMovement(prevMovement, movement)) {
              analysis.anomalies.push({
                type: 'direction_change',
                timestamp: frame.timestamp,
                frameNumber: frame.frameNumber,
                description: `Sudden ${movement.direction} movement after ${prevMovement.direction}`
              });
            }
          }
        }
        prevCenter = center;
      }

      // Track peak threat
      const threatScore = frame.threatScore || 0;
      if (threatScore > maxThreat) {
        maxThreat = threatScore;
        analysis.peakThreatFrame = frame;
      }
    });

    // Check final dwell
    if (currentZone && frames.length > 0) {
      const finalDwell = frames[frames.length - 1].timestamp - zoneEntryTime;
      if (finalDwell >= this.dwellThresholdMs) {
        analysis.dwellPoints.push({
          zone: currentZone,
          startTime: zoneEntryTime,
          duration: finalDwell,
          frameNumber: frames[frames.length - 1].frameNumber
        });
      }
    }

    analysis.objectsDetected = Array.from(analysis.objectsDetected);
    return analysis;
  }

  /**
   * Select key frames that tell the story
   */
  selectKeyFrames(frames, analysis) {
    const selected = new Map(); // frameNumber -> frame
    const budget = this.maxFrames;

    // Priority 1: Entry frame (always include)
    if (analysis.entryPoint) {
      selected.set(analysis.entryPoint.frameNumber, {
        frame: analysis.entryPoint,
        reason: 'ENTRY',
        priority: 1
      });
    }

    // Priority 2: Exit frame (always include)
    if (analysis.exitPoint && analysis.exitPoint.frameNumber !== analysis.entryPoint?.frameNumber) {
      selected.set(analysis.exitPoint.frameNumber, {
        frame: analysis.exitPoint,
        reason: 'EXIT',
        priority: 1
      });
    }

    // Priority 3: Peak threat frame
    if (analysis.peakThreatFrame && !selected.has(analysis.peakThreatFrame.frameNumber)) {
      selected.set(analysis.peakThreatFrame.frameNumber, {
        frame: analysis.peakThreatFrame,
        reason: 'PEAK_THREAT',
        priority: 2
      });
    }

    // Priority 4: Zone transitions (important for understanding movement)
    for (const transition of analysis.zoneTransitions) {
      if (selected.size >= budget) break;

      const transitionFrame = frames.find(f => f.frameNumber === transition.frameNumber);
      if (transitionFrame && !selected.has(transition.frameNumber)) {
        selected.set(transition.frameNumber, {
          frame: transitionFrame,
          reason: `ZONE_TRANSITION: ${transition.from} → ${transition.to}`,
          priority: 3
        });
      }
    }

    // Priority 5: Dwell points (suspicious loitering)
    for (const dwell of analysis.dwellPoints) {
      if (selected.size >= budget) break;

      const dwellFrame = frames.find(f => f.frameNumber === dwell.frameNumber);
      if (dwellFrame && !selected.has(dwell.frameNumber)) {
        selected.set(dwell.frameNumber, {
          frame: dwellFrame,
          reason: `DWELL: ${Math.round(dwell.duration / 1000)}s in ${dwell.zone}`,
          priority: 4
        });
      }
    }

    // Priority 6: Anomalies
    for (const anomaly of analysis.anomalies) {
      if (selected.size >= budget) break;

      const anomalyFrame = frames.find(f => f.frameNumber === anomaly.frameNumber);
      if (anomalyFrame && !selected.has(anomaly.frameNumber)) {
        selected.set(anomaly.frameNumber, {
          frame: anomalyFrame,
          reason: `ANOMALY: ${anomaly.description}`,
          priority: 5
        });
      }
    }

    // Priority 7: Fill remaining slots with evenly distributed frames
    if (selected.size < budget) {
      const remainingSlots = budget - selected.size;
      const unselected = frames.filter(f => !selected.has(f.frameNumber));

      if (unselected.length > 0) {
        const step = Math.floor(unselected.length / (remainingSlots + 1));
        for (let i = 1; i <= remainingSlots && (i * step) < unselected.length; i++) {
          const frame = unselected[i * step];
          if (!selected.has(frame.frameNumber)) {
            selected.set(frame.frameNumber, {
              frame,
              reason: 'SEQUENCE_FILL',
              priority: 6
            });
          }
        }
      }
    }

    // Sort by timestamp and return
    return Array.from(selected.values())
      .sort((a, b) => a.frame.timestamp - b.frame.timestamp)
      .slice(0, budget);
  }

  /**
   * Enrich a frame with contextual metadata for LLM
   */
  enrichFrame(frameData, index, allSelectedFrames, analysis) {
    const { frame, reason } = frameData;
    const totalFrames = allSelectedFrames.length;

    // Calculate relative timing
    const episodeStart = analysis.entryPoint?.timestamp || frame.timestamp;
    const relativeTime = frame.timestamp - episodeStart;

    // Find person position
    const personDet = (frame.detections || []).find(d =>
      (d.label || d.object_class || '').toLowerCase() === 'person'
    );

    let position = null;
    let zone = null;
    if (personDet && personDet.bbox) {
      position = this.getBboxCenter(personDet.bbox);
      zone = this.getZone(position);
    }

    // Calculate movement from previous frame
    let movement = null;
    if (index > 0) {
      const prevFrame = allSelectedFrames[index - 1].frame;
      const prevPerson = (prevFrame.detections || []).find(d =>
        (d.label || d.object_class || '').toLowerCase() === 'person'
      );
      if (prevPerson && prevPerson.bbox && position) {
        const prevPos = this.getBboxCenter(prevPerson.bbox);
        movement = this.calculateMovement(prevPos, position);
      }
    }

    return {
      // Frame identification
      frameNumber: frame.frameNumber,
      sequencePosition: `${index + 1}/${totalFrames}`,

      // Timing
      timestamp: frame.timestamp,
      relativeTimeMs: relativeTime,
      relativeTimeFormatted: this.formatDuration(relativeTime),

      // Why this frame was selected
      selectionReason: reason,

      // Spatial information
      zone: zone,
      zoneLabel: zone ? this.zones[zone]?.label : null,
      personPosition: position,

      // Movement
      movement: movement,

      // Detections
      detections: (frame.detections || []).map(d => ({
        label: d.label || d.object_class,
        confidence: Math.round((d.confidence || 0) * 100),
        bbox: d.bbox
      })),

      // Threat score
      threatScore: frame.threatScore || 0,

      // Image URL
      imageUrl: frame.imageUrl
    };
  }

  /**
   * Build episode-level context for LLM prompt
   */
  buildEpisodeContext(frames, analysis, metadata) {
    const duration = analysis.duration;

    // Determine movement pattern
    let movementSummary = 'stationary';
    if (analysis.zoneTransitions.length > 2) {
      movementSummary = 'erratic/pacing';
    } else if (analysis.zoneTransitions.length > 0) {
      const zones = analysis.zoneTransitions.map(t => t.to);
      movementSummary = `directional (${zones.join(' → ')})`;
    }

    // Identify threat indicators
    const threatIndicators = [];

    // Check for weapons
    const weaponClasses = ['gun', 'knife', 'rifle', 'weapon'];
    const weapons = analysis.objectsDetected.filter(obj =>
      weaponClasses.some(w => obj.toLowerCase().includes(w))
    );
    if (weapons.length > 0) {
      threatIndicators.push(`Weapon detected: ${weapons.join(', ')}`);
    }

    // Check for suspicious dwell
    if (analysis.dwellPoints.length > 0) {
      const maxDwell = Math.max(...analysis.dwellPoints.map(d => d.duration));
      threatIndicators.push(`Extended dwell: ${Math.round(maxDwell / 1000)}s`);
    }

    // Check for anomalous movement
    if (analysis.anomalies.length > 0) {
      threatIndicators.push(`Movement anomalies: ${analysis.anomalies.length}`);
    }

    return {
      // Episode summary
      episodeDuration: this.formatDuration(duration),
      episodeDurationMs: duration,
      totalFramesAnalyzed: frames.length,
      framesSelected: Math.min(frames.length, this.maxFrames),

      // Objects detected throughout episode
      objectsDetected: analysis.objectsDetected,

      // Movement analysis
      movementPattern: movementSummary,
      zoneTransitions: analysis.zoneTransitions.length,
      dwellPoints: analysis.dwellPoints.map(d => ({
        zone: d.zone,
        duration: this.formatDuration(d.duration)
      })),

      // Threat assessment
      peakThreatScore: analysis.peakThreatFrame?.threatScore || 0,
      threatIndicators,

      // Site context (from metadata)
      cameraId: metadata.cameraId || 'unknown',
      siteLocation: metadata.siteLocation || 'unknown',
      timeOfDay: metadata.timeOfDay || this.getTimeOfDay(frames[0]?.timestamp),

      // Narrative summary for LLM
      narrativeSummary: this.generateNarrativeSummary(analysis)
    };
  }

  /**
   * Generate a text narrative summary of the episode
   */
  generateNarrativeSummary(analysis) {
    const parts = [];

    // Entry
    if (analysis.entryPoint) {
      const zone = analysis.personTrack[0]?.zone || 'unknown';
      parts.push(`Subject entered from ${zone} area`);
    }

    // Movement pattern
    if (analysis.zoneTransitions.length === 0) {
      parts.push('remained stationary');
    } else {
      const path = [analysis.personTrack[0]?.zone,
        ...analysis.zoneTransitions.map(t => t.to)
      ].filter(Boolean);
      parts.push(`moved through ${path.join(' → ')}`);
    }

    // Dwell points
    if (analysis.dwellPoints.length > 0) {
      const dwells = analysis.dwellPoints.map(d =>
        `${Math.round(d.duration / 1000)}s in ${d.zone}`
      );
      parts.push(`lingered (${dwells.join(', ')})`);
    }

    // Anomalies
    if (analysis.anomalies.length > 0) {
      parts.push(`exhibited ${analysis.anomalies.length} unusual movement pattern(s)`);
    }

    // Exit
    const lastZone = analysis.personTrack[analysis.personTrack.length - 1]?.zone;
    if (lastZone) {
      parts.push(`exited via ${lastZone}`);
    }

    // Duration
    parts.push(`Total duration: ${this.formatDuration(analysis.duration)}`);

    return parts.join('. ') + '.';
  }

  // ===== Helper Methods =====

  getBboxCenter(bbox) {
    // bbox format: [x1, y1, x2, y2] (pixel coordinates or normalized)
    const [x1, y1, x2, y2] = bbox;
    return {
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2
    };
  }

  getZone(center) {
    // Normalize if needed (assume frame is ~1920x1080 if values are large)
    let x = center.x;
    let y = center.y;

    if (x > 1 || y > 1) {
      x = x / 1920;
      y = y / 1080;
    }

    // Determine zone based on position
    if (y > 0.7) return 'entry';
    if (y < 0.3) return 'far';
    if (x < 0.3) return 'left';
    if (x > 0.7) return 'right';
    return 'center';
  }

  calculateMovement(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    let direction = 'stationary';
    if (distance > this.significantMovement) {
      if (Math.abs(dx) > Math.abs(dy)) {
        direction = dx > 0 ? 'right' : 'left';
      } else {
        direction = dy > 0 ? 'toward_camera' : 'away_from_camera';
      }
    }

    return {
      dx,
      dy,
      distance,
      direction,
      speed: distance // Could divide by time delta for actual speed
    };
  }

  isAnomalousMovement(prev, current) {
    // Detect sudden direction changes
    // Guard against undefined movement data
    if (!prev || !current || !prev.direction || !current.direction) {
      return false;
    }

    const opposites = {
      'left': 'right',
      'right': 'left',
      'toward_camera': 'away_from_camera',
      'away_from_camera': 'toward_camera'
    };

    return opposites[prev.direction] === current.direction &&
           prev.distance > this.significantMovement &&
           current.distance > this.significantMovement;
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  getTimeOfDay(timestamp) {
    if (!timestamp) return 'unknown';
    const date = new Date(timestamp);
    const hour = date.getHours();
    if (hour < 6) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 21) return 'evening';
    return 'night';
  }
}
