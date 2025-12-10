/**
 * LiveEpisodeAggregator v5 (Gold Standard)
 * - Groups real-time detections into episodes
 * - Fetches images from MinIO via HTTP (Internal/External handling)
 * - Uses Gemini 2.0 Flash with "V4 Gold Standard" Security Prompt
 * - Outputs Hybrid JSON (Structured Data + Full Markdown Report)
 */

import db from './database.js';

const liveEpisodes = new Map();
const EPISODE_GAP_MS = 3000;
const EPISODE_CHECK_INTERVAL = 1000;
const MAX_FRAMES_PER_EPISODE = 6;

let ioRef = null;
let apiKey = null;

// --- V4 GOLD STANDARD PROMPT ---
const SECURITY_PROMPT_V4 = `
System Role
You are an AI Security Surveillance Analyst specialized in detecting behaviors that precede or constitute break-ins at residential or commercial properties. Analyze fixed security camera footage objectively, raising timely alerts only for verified threats. Prioritize accuracy to minimize false positives.

THREAT CODES & RULES:
High Threat: FE (Forced entry), WD (Weapon display), VI (Violence), VP (Vandalism), FS (Fire), GA (Gated access), BT (Boundary trespass)
Medium Threat: SL (Suspicious loitering), CS (Casing), SA (Suspicious attire), TM (Tampering), UI (Unattended item)
Low Threat: UNK (Unknown/Benign), MOV (Environmental), DEL (Delivery), RES (Resident)

MANDATORY OUTPUT FORMAT (JSON):
You must respond with a VALID JSON object. Do not wrap in markdown code blocks.
The JSON must have this structure:
{
  "threat_code": "STRING (e.g. 'SL', 'UNK', 'DEL')",
  "threat_level": "STRING (HIGH, MEDIUM, LOW)",
  "confidence": NUMBER (0.0 to 1.0),
  "subject_description": "STRING (Visual summary)",
  "behavior": "STRING (Action summary)",
  "full_report": "STRING (The full text report)"
}

Format for 'full_report' string:
Include: Location, Time, What We See (t0 observations), AI Analysis (Objects, Trends, Context, Direction, Escalation logic), Result (ALERT LEVEL, summary, confidence).
`;

function init(io) {
  ioRef = io;
  apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  setInterval(checkStaleEpisodes, EPISODE_CHECK_INTERVAL);
  console.log("[Episode] Live episode aggregator initialized (v5 Gold Standard)" + (apiKey ? " (Gemini enabled)" : " (Gemini disabled - no API key)"));
}

function normalizeTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  if (typeof ts === 'string' && ts.includes('T')) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return ts;
  }
  if (typeof ts === 'number') {
    if (ts < 100000000000) {
      return new Date(ts * 1000).toISOString();
    }
    return new Date(ts).toISOString();
  }
  const d = new Date(ts);
  if (!isNaN(d.getTime())) return d.toISOString();
  return new Date().toISOString();
}

function checkStaleEpisodes() {
  const now = Date.now();
  for (const [cameraId, episode] of liveEpisodes.entries()) {
    if (now - episode.last_update > EPISODE_GAP_MS) {
      closeAndEmitEpisode(cameraId, episode);
      liveEpisodes.delete(cameraId);
    }
  }
}

async function closeAndEmitEpisode(cameraId, episode) {
  if (!ioRef) return;

  const endTime = new Date().toISOString();
  const startMs = new Date(episode.start_time).getTime();
  const endMs = new Date(endTime).getTime();
  const durationMs = endMs - startMs;
  const durationSec = Math.max(1, Math.round(durationMs / 1000));

  const episodeData = {
    id: episode.id,
    camera_id: cameraId,
    start_time: episode.start_time,
    end_time: endTime,
    duration_sec: durationSec,
    frame_count: episode.detections.length,
    keyframe: episode.keyframe || (episode.detections[0] && episode.detections[0].imageUrl) || null,
    status: "analyzing",
    threat_assessment: null,
    analysis: null,
    detections: episode.detections
  };

  // Save to database first
  try {
    db.episodes.insert({
      id: episodeData.id,
      camera_id: episodeData.camera_id,
      start_time: episodeData.start_time,
      end_time: episodeData.end_time,
      duration_sec: episodeData.duration_sec,
      frame_count: episodeData.frame_count,
      status: 'analyzing'
    });
    console.log("[Episode] DB: Saved episode " + episode.id);
  } catch (err) {
    if (!err.message.includes('UNIQUE constraint')) {
      console.error("[Episode] DB error:", err.message);
    }
  }

  // Emit initial episode (analyzing state)
  ioRef.emit("episode:new", episodeData);
  console.log("[Episode] Closed: " + episode.id + " (" + episode.detections.length + " frames, " + durationSec + "s)");

  // Trigger Gemini analysis if API key is available
  if (apiKey && episode.detections.length > 0) {
    try {
      console.log("[Episode] Triggering Gemini V5 Analysis for " + episode.id);
      const analysis = await analyzeLiveEpisode(episodeData);

      if (analysis.success) {
        // Emit analyzed episode
        ioRef.emit("episode:analyzed", {
          episode_id: episodeData.id,
          threat_assessment: analysis.threat_assessment,
          analysis: analysis.analysis,
          full_report: analysis.full_report,
          frames_analyzed: analysis.frames_analyzed,
          analysis_time_ms: analysis.analysis_time_ms,
          model: analysis.model
        });

        // Update database
        try {
          const analysisJson = JSON.stringify({
            threat_assessment: analysis.threat_assessment,
            analysis: analysis.analysis,
            full_report: analysis.full_report,
            frames_analyzed: analysis.frames_analyzed,
            model: analysis.model
          });
          db.raw.prepare(`UPDATE episodes SET status = 'complete', analysis_json = ? WHERE id = ?`).run(analysisJson, episodeData.id);
          console.log("[Episode] Analysis complete: " + episode.id + " -> " + (analysis.threat_assessment?.code || 'unknown'));
        } catch (dbErr) {
          console.error("[Episode] DB update error:", dbErr.message);
        }
      } else {
        try {
          db.raw.prepare(`UPDATE episodes SET status = 'complete' WHERE id = ?`).run(episodeData.id);
        } catch (err) {}
      }
    } catch (err) {
      console.error("[Episode] Analysis error:", err.message);
      try {
        db.raw.prepare(`UPDATE episodes SET status = 'complete' WHERE id = ?`).run(episodeData.id);
      } catch (e) {}
    }
  } else {
    try {
      db.raw.prepare(`UPDATE episodes SET status = 'complete' WHERE id = ?`).run(episodeData.id);
    } catch (err) {}
  }
}

async function fetchImageAsBase64(imageUrl) {
  try {
    let fetchUrl = imageUrl;
    if (imageUrl.includes('136.119.129.106:9000')) {
      fetchUrl = imageUrl.replace('136.119.129.106:9000', 'localhost:9000');
    }

    console.log("[Episode] Fetching image: " + fetchUrl);
    const response = await fetch(fetchUrl, { timeout: 5000 });

    if (!response.ok) {
      console.log("[Episode] Image fetch failed: " + response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    console.log("[Episode] Image fetched successfully (" + Math.round(base64.length / 1024) + "KB)");
    return base64;
  } catch (err) {
    console.error("[Episode] Image fetch error:", err.message);
    return null;
  }
}

async function analyzeLiveEpisode(episodeData) {
  const startTime = Date.now();
  const episodeId = episodeData.id;

  // Select up to 6 frames for analysis (increased for Gold Standard)
  const detections = episodeData.detections || [];
  const framesToAnalyze = detections.slice(0, MAX_FRAMES_PER_EPISODE);

  // Fetch images as base64 via HTTP
  const imageContent = [];
  for (const det of framesToAnalyze) {
    const imageUrl = det.imageUrl;
    if (!imageUrl) continue;

    const base64 = await fetchImageAsBase64(imageUrl);
    if (base64) {
      imageContent.push({ base64 });
    }
  }

  if (imageContent.length === 0) {
    console.log("[Episode] No valid images to analyze for " + episodeId);
    return { success: false, error: 'No images available' };
  }

  // Calculate quiet hours context (8 PM - 6 AM)
  const hour = new Date().getHours();
  const isQuietHours = (hour >= 20 || hour < 6);
  
  const contextJson = {
    camera_id: episodeData.camera_id,
    timestamp: new Date().toISOString(),
    quiet_hours_active: isQuietHours,
    episode_duration_sec: episodeData.duration_sec,
    frame_count: imageContent.length
  };

  const parts = [
    { text: SECURITY_PROMPT_V4 },
    { text: "CONTEXT: " + JSON.stringify(contextJson) }
  ];
  
  for (const img of imageContent) {
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: img.base64 } });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const llmText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!llmText) {
      throw new Error('Empty response from Gemini');
    }

    const parsed = JSON.parse(llmText);
    const elapsed = Date.now() - startTime;
    console.log(`[Episode] Gemini V5 complete in ${elapsed}ms: ${parsed.threat_code}`);

    return {
      success: true,
      episode_id: episodeId,
      threat_assessment: {
        code: parsed.threat_code || 'UNK',
        level: parsed.threat_level || 'LOW',
        confidence: parsed.confidence || 0.5
      },
      analysis: {
        subject_description: parsed.subject_description || 'Activity detected',
        subject_behavior: parsed.behavior || ''
      },
      full_report: parsed.full_report || '',
      frames_analyzed: imageContent.length,
      analysis_time_ms: elapsed,
      model: 'gemini-2.0-flash-v5'
    };

  } catch (err) {
    console.error(`[Episode] Gemini error: ${err.message}`);
    return { success: false, error: err.message, episode_id: episodeId };
  }
}

function aggregateDetection(v2Data) {
  const cameraId = v2Data.camera;
  const now = Date.now();

  let episode = liveEpisodes.get(cameraId);

  if (!episode) {
    const startTime = normalizeTimestamp(v2Data.time);
    episode = {
      id: "ep_" + cameraId + "_" + Date.now(),
      detections: [],
      start_time: startTime,
      last_update: now,
      keyframe: v2Data.imageUrl
    };
    liveEpisodes.set(cameraId, episode);
    console.log("[Episode] Started: " + episode.id + " at " + startTime);
  }

  episode.detections.push({
    id: v2Data.id,
    time: normalizeTimestamp(v2Data.time),
    imageUrl: v2Data.imageUrl,
    class: v2Data.class,
    score: v2Data.score
  });

  if (!episode.keyframe || (v2Data.score > 0.8 && v2Data.imageUrl)) {
    episode.keyframe = v2Data.imageUrl;
  }

  episode.last_update = now;
}

export { init, aggregateDetection };
export default { init, aggregateDetection };
