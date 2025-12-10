
/**
 * Analyze a live episode using direct URLs (bypasses database)
 * @param {Object} episodeData - Episode with detections containing imageUrl/snapshot_path
 * @returns {Promise<Object>} The analysis result
 */
export async function analyzeLiveEpisode(episodeData) {
  const startTime = Date.now();
  const episodeId = episodeData.id;
  console.log(`[LiveAnalysis] Starting direct URL analysis for ${episodeId}`);

  // Extract URLs from detections
  const detections = episodeData.detections || [];
  if (detections.length === 0) {
    console.log(`[LiveAnalysis] No detections in episode`);
    return { success: false, error: 'No detections in episode', episode_id: episodeId };
  }

  // Smart selection: first, middle, last + highest confidence (max 4)
  const selectedDets = [];
  if (detections.length >= 1) selectedDets.push(detections[0]); // First
  if (detections.length >= 3) selectedDets.push(detections[Math.floor(detections.length / 2)]); // Middle
  if (detections.length >= 2) selectedDets.push(detections[detections.length - 1]); // Last
  // Add highest confidence if we have room
  const sorted = [...detections].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  if (sorted[0] && !selectedDets.includes(sorted[0]) && selectedDets.length < 4) {
    selectedDets.push(sorted[0]);
  }

  console.log(`[LiveAnalysis] Selected ${selectedDets.length} frames from ${detections.length} detections`);

  // Check API key
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[LiveAnalysis] GOOGLE_API_KEY not set - returning mock');
    return {
      success: true,
      mock: true,
      episode_id: episodeId,
      threat_assessment: { code: 'DPH', level: 'LOW', confidence: 0.85 },
      analysis: { subject_description: 'Person detected (mock - no API key)', subject_behavior: '' }
    };
  }

  // Fetch images from URLs
  const imageContent = [];
  for (const det of selectedDets) {
    const url = det.imageUrl || det.image_path || det.snapshot_path;
    if (!url) continue;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[LiveAnalysis] Failed to fetch ${url}: ${response.status}`);
        continue;
      }
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      imageContent.push({ base64, url, confidence: det.confidence });
    } catch (err) {
      console.error(`[LiveAnalysis] Error fetching ${url}: ${err.message}`);
    }
  }

  if (imageContent.length === 0) {
    return { success: false, error: 'Failed to fetch any images', episode_id: episodeId };
  }

  console.log(`[LiveAnalysis] Fetched ${imageContent.length} images, calling Gemini...`);

  // Build prompt
  const prompt = `Analyze these security camera frames from ${episodeData.camera_id || 'camera'}.
Identify:
1. Who/what is in the frame (person, vehicle, animal, etc.)
2. What they are doing
3. Threat level assessment

Respond ONLY with valid JSON:
{
  "threat_code": "DPH or UNK or VEH or FAM or SUS or PKG or ANM",
  "threat_level": "HIGH or MEDIUM or LOW",
  "confidence": 0.85,
  "subject_description": "Brief description",
  "behavior": "What they are doing"
}

Threat codes: DPH=Delivery/Pickup/Helper, UNK=Unknown Person, VEH=Vehicle, FAM=Family/Known, SUS=Suspicious, PKG=Package Delivery, ANM=Animal`;

  const parts = [{ text: prompt }];
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
            maxOutputTokens: 512,
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
    console.log(`[LiveAnalysis] Complete in ${elapsed}ms: ${parsed.threat_code}`);

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
      frames_analyzed: imageContent.length,
      analysis_time_ms: elapsed,
      model: 'gemini-2.0-flash'
    };

  } catch (err) {
    console.error(`[LiveAnalysis] Error: ${err.message}`);
    return { success: false, error: err.message, episode_id: episodeId };
  }
}
