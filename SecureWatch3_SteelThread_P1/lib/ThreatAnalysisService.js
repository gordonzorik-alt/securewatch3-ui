/**
 * ThreatAnalysisService - Smart Threat Analysis with Intelligent Frame Selection
 *
 * Replaces random frame sampling with intelligent selection:
 * - Entry/Exit frames for context
 * - Peak confidence frames for clearest visual
 * - Action frames (largest bbox) for closest proximity
 *
 * Uses SmartFrameSelector for frame selection and stores results in SQLite.
 */

import fs from 'fs';
import path from 'path';
import { selectFrames, getSelectionSummary } from './SmartFrameSelector.js';
import ThreatAnalysisPrompt, { THREAT_CODES } from './ThreatAnalysisPrompt.js';
import db from './database.js';

const promptBuilder = new ThreatAnalysisPrompt();

/**
 * Analyze an episode using smart frame selection and Gemini LLM
 * @param {string} episodeId - The episode ID to analyze
 * @param {Object} options - Optional configuration
 * @returns {Promise<Object>} The analysis result
 */
export async function analyzeEpisode(episodeId, options = {}) {
  const startTime = Date.now();
  console.log(`[ThreatAnalysis] Starting analysis for episode ${episodeId}`);

  // 1. Fetch episode metadata from database
  const episode = db.episodes.get(episodeId);
  if (!episode) {
    return {
      error: `Episode ${episodeId} not found`,
      success: false
    };
  }

  console.log(`[ThreatAnalysis] Episode: camera=${episode.camera_id}, duration=${episode.duration_sec}s`);

  // 2. Get smart-selected frames
  const frames = selectFrames(episodeId, options.maxFrames || 8);

  if (frames.length === 0) {
    console.log(`[ThreatAnalysis] No valid frames found for episode ${episodeId}`);
    return {
      error: 'No valid frames available for analysis',
      success: false,
      episode_id: episodeId
    };
  }

  const selectionSummary = getSelectionSummary(frames);
  console.log(`[ThreatAnalysis] Frame selection: ${JSON.stringify(selectionSummary)}`);

  // 3. Build image content array with base64 encoding
  const imageContent = [];
  for (const frame of frames) {
    let fullPath;
    if (frame.path.includes('v2/live')) {
      // v2 RAM disk image
      const filename = path.basename(frame.path);
      fullPath = path.join('/dev/shm/securewatch_v2', filename);
    } else if (path.isAbsolute(frame.path)) {
      fullPath = frame.path;
    } else {
      // Legacy disk image
      fullPath = path.join(process.cwd(), frame.path);
    }

    try {
      const imageBuffer = fs.readFileSync(fullPath);
      const base64Image = imageBuffer.toString('base64');
      imageContent.push({
        path: frame.path,
        base64: base64Image,
        timestamp: frame.timestamp,
        confidence: frame.confidence,
        label: frame.label,
        reason: frame.reason,
        bboxArea: frame.bboxArea
      });
    } catch (err) {
      console.error(`[ThreatAnalysis] Error reading image ${fullPath}:`, err.message);
    }
  }

  if (imageContent.length === 0) {
    return {
      error: 'Failed to load any images for analysis',
      success: false,
      episode_id: episodeId
    };
  }

  // 4. Check for API key
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[ThreatAnalysis] GOOGLE_API_KEY not set - returning mock response');
    return createMockResponse(episodeId, episode, frames);
  }

  // 5. Build the prompt using ThreatAnalysisPrompt
  const frameSelection = buildFrameSelection(imageContent, episode);
  const prompt = promptBuilder.buildPrompt(frameSelection, {
    location: episode.camera_id || 'Security Camera'
  });

  // 6. Build Gemini API request
  const parts = [];

  // Add text prompt
  parts.push({ text: prompt.userPrompt });

  // Add images as inline data
  for (const img of imageContent) {
    parts.push({
      inline_data: {
        mime_type: 'image/jpeg',
        data: img.base64
      }
    });
  }

  // 7. Call Gemini API
  try {
    console.log(`[ThreatAnalysis] Calling Gemini API with ${imageContent.length} images`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          systemInstruction: {
            parts: [{ text: prompt.systemPrompt }]
          },
          generationConfig: {
            temperature: 0.2,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const llmResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!llmResponse) {
      throw new Error('Empty response from Gemini API');
    }

    // 8. Parse the response
    const parsedResponse = promptBuilder.parseResponse(llmResponse);
    const formattedResult = promptBuilder.formatResult(parsedResponse, episodeId, frameSelection);

    // 9. Store in database
    const analysisRecord = {
      episode_id: episodeId,
      threat_code: formattedResult.threat_assessment.code,
      threat_label: formattedResult.threat_assessment.code_label,
      threat_level: formattedResult.threat_assessment.level,
      confidence: formattedResult.threat_assessment.confidence,
      color: formattedResult.threat_assessment.color,
      observations: [
        ...formattedResult.legitimacy_indicators.map(i => ({ type: 'legitimacy', indicator: i })),
        ...formattedResult.threat_indicators.map(i => ({ type: 'threat', indicator: i }))
      ],
      reasoning: formattedResult.analysis.reasoning,
      recommended_action: formattedResult.recommended_action,
      raw_response: {
        ...formattedResult,
        frame_selection: selectionSummary,
        frames_analyzed: imageContent.length,
        analysis_time_ms: Date.now() - startTime
      }
    };

    // Insert or replace in database
    try {
      db.threats.insert(analysisRecord);
      console.log(`[ThreatAnalysis] Stored analysis in database`);
    } catch (dbErr) {
      console.error(`[ThreatAnalysis] DB error (continuing):`, dbErr.message);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[ThreatAnalysis] Completed in ${elapsed}ms: ${formattedResult.threat_assessment.code}`);

    return {
      success: true,
      episode_id: episodeId,
      ...formattedResult,
      frame_selection: selectionSummary,
      frames_analyzed: imageContent.length,
      analysis_time_ms: elapsed,
      model: 'gemini-2.0-flash'
    };

  } catch (error) {
    console.error('[ThreatAnalysis] Analysis error:', error);
    return {
      success: false,
      error: error.message,
      episode_id: episodeId,
      frames_analyzed: imageContent.length,
      frame_selection: selectionSummary
    };
  }
}

/**
 * Build frame selection context for the prompt
 */
function buildFrameSelection(imageContent, episode) {
  const startTime = new Date(episode.start_time);
  const endTime = new Date(episode.end_time);
  const durationSec = episode.duration_sec || Math.round((endTime - startTime) / 1000);

  // Determine time of day
  const hour = startTime.getHours();
  const timeOfDay = (hour >= 6 && hour < 18) ? 'Day' : 'Night';

  // Collect unique labels
  const objectsDetected = [...new Set(imageContent.map(f => f.label).filter(Boolean))];

  // Build frames with context
  const frames = imageContent.map((img, idx) => {
    const frameTime = new Date(img.timestamp);
    const relativeMs = frameTime - startTime;
    const relativeSec = Math.round(relativeMs / 1000);

    return {
      frameNumber: idx + 1,
      selectionReason: formatSelectionReason(img.reason),
      relativeTimeFormatted: `${relativeSec}s`,
      zone: 'Unknown', // Could be enhanced with zone detection
      zoneLabel: 'Unknown',
      detections: [{
        label: img.label || 'person',
        confidence: Math.round((img.confidence || 0) * 100)
      }],
      movement: null, // Could be enhanced with motion analysis
      imagePath: img.path
    };
  });

  // Build movement pattern description
  const movementPattern = describeMovementPattern(imageContent);

  return {
    frames,
    context: {
      episodeDuration: `${durationSec} seconds`,
      objectsDetected,
      movementPattern,
      zoneTransitions: 'Unknown → Unknown',
      timeOfDay,
      narrativeSummary: buildNarrativeSummary(imageContent, durationSec)
    }
  };
}

/**
 * Format selection reason for display
 */
function formatSelectionReason(reason) {
  const reasonMap = {
    'entry': 'Entry Frame (First Detection)',
    'exit': 'Exit Frame (Last Detection)',
    'peak_confidence': 'Peak Confidence (Clearest View)',
    'action_proximity': 'Action Frame (Closest Proximity)',
    'distributed': 'Timeline Sample'
  };
  return reasonMap[reason] || reason;
}

/**
 * Describe movement pattern based on frames
 */
function describeMovementPattern(imageContent) {
  if (imageContent.length < 2) return 'Single frame - no movement data';

  const bboxAreas = imageContent.map(f => f.bboxArea || 0);
  const avgArea = bboxAreas.reduce((a, b) => a + b, 0) / bboxAreas.length;
  const maxArea = Math.max(...bboxAreas);
  const minArea = Math.min(...bboxAreas.filter(a => a > 0));

  if (maxArea > avgArea * 1.5) {
    return 'Subject approached camera (increasing size)';
  } else if (minArea < avgArea * 0.5) {
    return 'Subject moved away from camera (decreasing size)';
  }
  return 'Subject moved laterally or stationary';
}

/**
 * Build narrative summary from frames
 */
function buildNarrativeSummary(imageContent, durationSec) {
  const labels = imageContent.map(f => f.label).filter(Boolean);
  const uniqueLabels = [...new Set(labels)];
  const labelStr = uniqueLabels.join(', ') || 'subject';

  const reasons = imageContent.map(f => f.reason);
  const hasEntry = reasons.includes('entry');
  const hasExit = reasons.includes('exit');

  let summary = `${labelStr} detected over ${durationSec} seconds. `;

  if (hasEntry && hasExit) {
    summary += `Captured entry and exit frames showing complete transit. `;
  } else if (hasEntry) {
    summary += `Captured initial entry into view. `;
  }

  const peakCount = reasons.filter(r => r === 'peak_confidence').length;
  if (peakCount > 0) {
    summary += `${peakCount} high-confidence frame(s) selected for clear identification. `;
  }

  return summary.trim();
}

/**
 * Create mock response when API key is not available
 */
function createMockResponse(episodeId, episode, frames) {
  return {
    success: true,
    mock: true,
    episode_id: episodeId,
    threat_assessment: {
      code: 'DPH',
      code_label: 'Delivery/Pickup/Helper',
      level: 'low',
      confidence: 0.85,
      color: 'blue'
    },
    context_assessment: {
      time_of_day: 'Day',
      zone_type: 'Public-Facing',
      vehicle_detected: 'None'
    },
    legitimacy_indicators: ['Normal approach pattern'],
    threat_indicators: [],
    analysis: {
      subject_behavior: 'Normal visitor behavior',
      reasoning: 'Mock response - GOOGLE_API_KEY not configured'
    },
    recommended_action: 'Monitor Only',
    frame_selection: getSelectionSummary(frames),
    frames_analyzed: frames.length,
    model: 'mock'
  };
}

/**
 * Get cached analysis for an episode
 */
export function getCachedAnalysis(episodeId) {
  return db.threats.getByEpisode(episodeId);
}

/**
 * Check if episode has been analyzed
 */
export function hasAnalysis(episodeId) {
  return !!db.threats.getByEpisode(episodeId);
}

export default {
  analyzeEpisode,
  getCachedAnalysis,
  hasAnalysis
};
