/**
 * ThreatAnalysisPrompt - Real-Time Threat Intelligence Engine for SecureWatch
 *
 * Uses Context Triage approach:
 * 1. Temporal Filter (Day/Night sensitivity)
 * 2. Zonal Filter (Public/Private zones)
 * 3. Legitimacy Filter (Authorized business indicators)
 */

export const THREAT_CODES = {
  CLEAR: {
    code: 'CLEAR',
    label: 'No Threat',
    description: 'Residents, known staff, pets',
    color: 'green'
  },
  DPH: {
    code: 'DPH',
    label: 'Delivery/Pickup/Helper',
    description: 'Legitimate visitor - package delivery, contractor, expected guest',
    color: 'blue'
  },
  SL: {
    code: 'SL',
    label: 'Suspicious Loitering',
    description: 'Person lingering without clear purpose, may warrant monitoring',
    color: 'yellow'
  },
  CS: {
    code: 'CS',
    label: 'Casing/Surveillance',
    description: 'Assessing cameras, peering in windows, off-path movement, coordinated group stops',
    color: 'orange'
  },
  AT: {
    code: 'AT',
    label: 'Active Threat',
    description: 'Weapon visible, mask/balaclava verified, or tools (crowbar/cutter) visible',
    color: 'red'
  },
  EH: {
    code: 'EH',
    label: 'Entry Attempt',
    description: 'Unauthorized physical manipulation - prying, kicking, climbing',
    color: 'red'
  },
  BT: {
    code: 'BT',
    label: 'Breaking/Theft',
    description: 'Property damage, glass breaking, theft in progress',
    color: 'red'
  }
};

export const BEHAVIORAL_INDICATORS = {
  // Legitimacy indicators (reduce threat)
  holding_package: { indicator: 'Holding Package', type: 'legitimacy', weight: -3 },
  branded_vehicle: { indicator: 'Branded Delivery Vehicle', type: 'legitimacy', weight: -3 },
  using_intercom: { indicator: 'Using Intercom/Doorbell', type: 'legitimacy', weight: -2 },
  high_vis_vest: { indicator: 'High-Visibility Vest', type: 'legitimacy', weight: -2 },
  clipboard_phone: { indicator: 'Checking Clipboard/Phone at Gate', type: 'legitimacy', weight: -1 },

  // Threat indicators (increase threat)
  mask_worn: { indicator: 'Mask/Balaclava Worn', type: 'threat', weight: 10 },
  weapon_visible: { indicator: 'Weapon Visible', type: 'threat', weight: 10 },
  tools_visible: { indicator: 'Break-in Tools Visible', type: 'threat', weight: 8 },
  crouching_hiding: { indicator: 'Crouching/Hiding in Bushes', type: 'threat', weight: 6 },
  checking_windows: { indicator: 'Checking Windows', type: 'threat', weight: 5 },
  off_path_movement: { indicator: 'Off-Path Movement (Grass/Landscaping)', type: 'threat', weight: 4 },
  tactical_spacing: { indicator: 'Tactical Group Spacing', type: 'threat', weight: 5 },
  lookout_behavior: { indicator: 'Lookout Behavior', type: 'threat', weight: 5 },
  wall_hugging: { indicator: 'Hugging Walls/Avoiding Lit Paths', type: 'threat', weight: 4 },
  loitering: { indicator: 'Loitering >30s Without Purpose', type: 'threat', weight: 3 }
};

export default class ThreatAnalysisPrompt {
  constructor(options = {}) {
    this.siteContext = options.siteContext || {};
    this.threatCodes = THREAT_CODES;
    this.behavioralIndicators = BEHAVIORAL_INDICATORS;
  }

  /**
   * Build the complete prompt for LLM analysis
   */
  buildPrompt(frameSelection, siteConfig = {}) {
    const { frames, context } = frameSelection;

    const systemPrompt = this.buildSystemPrompt(siteConfig);
    const userPrompt = this.buildUserPrompt(frames, context);
    const expectedOutputFormat = this.getExpectedOutputFormat();

    return {
      systemPrompt,
      userPrompt,
      expectedOutputFormat,
      frameCount: frames.length
    };
  }

  /**
   * Build the system prompt - Real-Time Threat Intelligence Engine
   */
  buildSystemPrompt(siteConfig) {
    return `You are the **Real-Time Threat Intelligence Engine** for SecureWatch. Your objective is to analyze surveillance frames and classify security events with high precision, balancing **Zero-Tolerance Threat Detection** against **False Positive Reduction**.

## 1. CORE DIRECTIVE: THE "CONTEXT TRIAGE"
You must assess every event through three specific filters before assigning a Threat Code. You are looking for **Contextual Incongruence**.

1. **Temporal Filter**: Is it Day (Standard Sensitivity) or Night (High Sensitivity)?
2. **Zonal Filter**: Is the subject in a Public Zone (Driveway/Street/Gate) or Private Zone (Backyard/Pool/Side)?
3. **Legitimacy Filter**: Are there visual indicators of authorized business (Uniforms, Commercial Vehicles, Packages)?

## 2. THREAT CLASSIFICATION CODES
* **CLEAR**: Residents, known staff, pets.
* **DPH** (Delivery/Pickup/Helper): **CRITICAL EXEMPTION**. Use this for legitimate visitors.
    * *Indicators:* Box trucks, branded vans, holding packages, checking clipboards/phones at gate, high-visibility vests.
* **SL** (Suspicious Loitering):
    * *Day:* Loitering off-path without purpose >30s (no delivery attempt).
    * *Night:* **ANY** unknown presence in a Private Zone.
* **CS** (Casing/Surveillance): Assessing cameras, peering in windows, off-path movement in landscaping, coordinated group stops.
* **AT** (Active Threat): **AUTOMATIC IF**: Weapon visible OR **Mask/Balaclava verified** OR Tools (crowbar/cutter) visible.
* **EH** (Entry Attempt): **Unauthorized** physical manipulation (prying, kicking, climbing). *Note: Ringing a doorbell or using an intercom is NOT an Entry Attempt.*
* **BT** (Breaking/Theft): Property damage, glass breaking, theft in progress.

## 3. VISUAL ANALYSIS LOGIC (DECISION TREE)

**STEP A: The "Delivery Exemption" Check (Run First)**
* *IF* Zone = Public/Driveway *AND* (Vehicle = Box Truck/Van *OR* Item = Package/Food):
* *THEN* Classification = **DPH** (Low Threat).
* *REASONING:* Verified legitimate business.

**STEP B: The "Nighttime Multiplier" Check**
* *IF* Time = Night *AND* Zone = Private/Curtilage *AND* Subject = Unknown:
* *THEN* Classification = **SL** (Minimum) or **CS** (Likely).
* *REASONING:* Presence alone in private zones at night is a threat.

**STEP C: The "Hostile Indicator" Check**
* *IF* Attire = Balaclava/Mask (Identity Concealment) *OR* Posture = Crouching/Hiding:
* *THEN* Classification = **AT** (Active Threat).
* *REASONING:* Intent to evade identification or detection.

## 4. BEHAVIORAL INDICATORS

**Pathing:**
* *Benign:* Walks on pavement/path directly to door/gate.
* *Hostile:* Walks on grass, dirt, or landscaping; hugs walls; avoids well-lit paths.

**Group Tactics:**
* *Benign:* Walking together casually, talking.
* *Hostile:* Spacing out (tactical separation), one standing watch (lookout) while others move.

${siteConfig.location ? `## SITE CONTEXT\n- Location: ${siteConfig.location}` : ''}

## OUTPUT FORMAT
You must respond with a valid JSON object following the exact schema provided in the user prompt. Do NOT wrap the response in markdown code blocks.`;
  }

  /**
   * Build the user prompt with frame-by-frame analysis
   */
  buildUserPrompt(frames, context) {
    // Build frame descriptions
    const frameDescriptions = frames.map((frame, idx) => {
      return `### Frame ${idx + 1} of ${frames.length} [${frame.selectionReason}]
- **Time**: ${frame.relativeTimeFormatted} into episode
- **Zone**: ${frame.zoneLabel || frame.zone || 'Unknown'}
- **Detections**: ${frame.detections.map(d => `${d.label} (${d.confidence}%)`).join(', ') || 'None'}
- **Movement**: ${frame.movement ? `${frame.movement.direction} (distance: ${frame.movement.distance.toFixed(2)})` : 'N/A'}
- **Frame Number**: ${frame.frameNumber}`;
    }).join('\n\n');

    // Build context summary
    const contextSummary = `## EPISODE CONTEXT
- **Duration**: ${context.episodeDuration}
- **Objects Detected**: ${context.objectsDetected.join(', ') || 'None'}
- **Movement Pattern**: ${context.movementPattern}
- **Zone Transitions**: ${context.zoneTransitions}
- **Time of Day**: ${context.timeOfDay}

## NARRATIVE SUMMARY
${context.narrativeSummary}`;

    return `Analyze the following surveillance episode and provide a threat assessment using the Context Triage method.

${contextSummary}

## FRAME-BY-FRAME SEQUENCE
The following ${frames.length} frames have been selected to represent this episode. They are in chronological order.

${frameDescriptions}

## IMAGES
The ${frames.length} images below correspond to the frames described above, in the same order.

## REQUIRED JSON OUTPUT
Respond with this exact JSON structure:

{
  "threat_code": "CLEAR|DPH|SL|CS|AT|EH|BT",
  "threat_level": "none|low|medium|high|critical",
  "confidence": 0.0-1.0,
  "context_assessment": {
    "time_of_day": "Day|Night",
    "zone_type": "Public-Facing|Private/Secure",
    "vehicle_detected": "None|Box Truck|Work Van|Sedan|Other"
  },
  "legitimacy_indicators": ["List indicators like 'Holding Package', 'FedEx Truck', 'Using Intercom'"],
  "threat_indicators": ["List indicators like 'Mask Worn', 'Crouching in Bushes', 'Checking Windows'"],
  "subject_behavior": "Concise description of movement and apparent intent",
  "recommended_action": "Monitor Only|Audio Warning|Dispatch Police",
  "reasoning": "Explain decision based on Context Triage (e.g., 'Classified as DPH because subject arrived in white box truck and walked directly to gate with package, despite being unknown.')"
}

Provide your analysis now.`;
  }

  /**
   * Get the expected JSON output format for validation
   */
  getExpectedOutputFormat() {
    return {
      threat_code: 'string (one of: CLEAR, DPH, SL, CS, AT, EH, BT)',
      threat_level: 'string (one of: none, low, medium, high, critical)',
      confidence: 'number (0.0 to 1.0)',
      context_assessment: {
        time_of_day: 'string (Day or Night)',
        zone_type: 'string (Public-Facing or Private/Secure)',
        vehicle_detected: 'string'
      },
      legitimacy_indicators: 'array of strings',
      threat_indicators: 'array of strings',
      subject_behavior: 'string',
      recommended_action: 'string (Monitor Only, Audio Warning, or Dispatch Police)',
      reasoning: 'string'
    };
  }

  /**
   * Parse and validate LLM response
   */
  parseResponse(llmResponse) {
    try {
      // Try to extract JSON from response
      let jsonStr = llmResponse;

      // Handle markdown code blocks (if model still wraps despite instructions)
      const jsonMatch = llmResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      const requiredFields = ['threat_code', 'threat_level', 'confidence'];
      for (const field of requiredFields) {
        if (!(field in parsed)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Validate threat_code
      const validCodes = Object.keys(this.threatCodes);
      if (!validCodes.includes(parsed.threat_code)) {
        console.warn(`Unknown threat code: ${parsed.threat_code}, defaulting to CLEAR`);
        parsed.threat_code = 'CLEAR';
      }

      // Validate confidence range
      parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

      // Ensure arrays exist
      parsed.legitimacy_indicators = parsed.legitimacy_indicators || [];
      parsed.threat_indicators = parsed.threat_indicators || [];

      // Add metadata
      parsed.valid = true;
      parsed.threatCodeInfo = this.threatCodes[parsed.threat_code];

      return parsed;

    } catch (error) {
      return {
        valid: false,
        error: error.message,
        raw_response: llmResponse,
        threat_code: 'CLEAR',
        threat_level: 'none',
        confidence: 0,
        reasoning: 'Failed to parse LLM response'
      };
    }
  }

  /**
   * Format analysis result for storage/display
   */
  formatResult(parsedResponse, episodeId, frameSelection) {
    return {
      episode_id: episodeId,
      analyzed_at: new Date().toISOString(),

      // Core assessment
      threat_assessment: {
        code: parsedResponse.threat_code,
        code_label: parsedResponse.threatCodeInfo?.label || parsedResponse.threat_code,
        level: parsedResponse.threat_level,
        confidence: parsedResponse.confidence,
        color: parsedResponse.threatCodeInfo?.color || 'gray'
      },

      // Context Triage assessment
      context_assessment: parsedResponse.context_assessment || {
        time_of_day: 'Unknown',
        zone_type: 'Unknown',
        vehicle_detected: 'None'
      },

      // Indicators
      legitimacy_indicators: parsedResponse.legitimacy_indicators || [],
      threat_indicators: parsedResponse.threat_indicators || [],

      // Detailed analysis
      analysis: {
        subject_behavior: parsedResponse.subject_behavior,
        reasoning: parsedResponse.reasoning
      },

      // Recommended action
      recommended_action: parsedResponse.recommended_action,

      // Context from frame selection
      episode_context: {
        duration: frameSelection.context?.episodeDuration,
        objects_detected: frameSelection.context?.objectsDetected,
        movement_pattern: frameSelection.context?.movementPattern,
        frames_analyzed: frameSelection.frames?.length
      },

      // Validation
      valid: parsedResponse.valid,
      error: parsedResponse.error
    };
  }
}
