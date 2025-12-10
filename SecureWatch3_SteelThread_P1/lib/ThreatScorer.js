/**
 * ThreatScorer - Heuristic-based threat scoring for video surveillance
 *
 * Assigns scores to detections based on:
 * 1. Object class weights (weapons > people > objects)
 * 2. Interaction bonuses (person + suspicious object)
 * 3. Confidence thresholds
 * 4. Behavioral patterns
 */

// Default class weights - configurable
const DEFAULT_CLASS_WEIGHTS = {
  // CRITICAL - Immediate threat (100+ points)
  weapon: 150,
  knife: 150,
  gun: 200,
  firearm: 200,
  rifle: 200,
  pistol: 200,
  fire: 120,
  flame: 120,
  blood: 100,
  explosion: 180,

  // HIGH - Requires attention (50-99 points)
  person: 50,
  human: 50,
  pedestrian: 50,
  masked_person: 80,
  hooded_person: 70,
  running_person: 75,

  // MEDIUM - Context dependent (20-49 points)
  backpack: 30,
  bag: 25,
  package: 35,
  suitcase: 30,
  box: 20,
  bottle: 15,

  // LOW - Generally benign (1-19 points)
  car: 10,
  truck: 12,
  vehicle: 10,
  motorcycle: 15,
  bicycle: 8,
  bus: 10,

  // MINIMAL - Background objects (0-5 points)
  chair: 2,
  table: 2,
  plant: 1,
  potted_plant: 1,
  tree: 1,
  bench: 2,
  cat: 5,
  dog: 8,
  bird: 1,
};

// Interaction bonuses - when multiple objects appear together
const DEFAULT_INTERACTION_RULES = [
  {
    name: 'armed_person',
    requires: ['person', ['weapon', 'knife', 'gun', 'firearm']],
    bonus: 100,
    description: 'Person with weapon detected'
  },
  {
    name: 'suspicious_package',
    requires: ['person', ['backpack', 'bag', 'package', 'suitcase']],
    bonus: 25,
    description: 'Person with bag/package'
  },
  {
    name: 'abandoned_item',
    requires: [['backpack', 'bag', 'package', 'suitcase', 'box']],
    requiresAbsent: ['person'],
    bonus: 40,
    description: 'Unattended bag/package'
  },
  {
    name: 'vehicle_person',
    requires: ['person', ['car', 'truck', 'vehicle']],
    bonus: 15,
    description: 'Person near vehicle'
  },
  {
    name: 'crowd',
    requires: ['person'],
    minCount: { person: 3 },
    bonus: 20,
    description: 'Multiple people gathered'
  },
  {
    name: 'fire_hazard',
    requires: [['fire', 'flame'], ['person', 'car', 'building']],
    bonus: 50,
    description: 'Fire near people or property'
  }
];

export default class ThreatScorer {
  /**
   * @param {Object} options Configuration options
   * @param {Object} options.classWeights Custom class weights (merged with defaults)
   * @param {Array} options.interactionRules Custom interaction rules
   * @param {number} options.confidenceThreshold Minimum confidence to consider (default: 0.4)
   */
  constructor(options = {}) {
    this.classWeights = { ...DEFAULT_CLASS_WEIGHTS, ...options.classWeights };
    this.interactionRules = options.interactionRules || DEFAULT_INTERACTION_RULES;
    this.confidenceThreshold = options.confidenceThreshold || 0.4;
  }

  /**
   * Get the base score for an object class
   * @param {string} label Object class label
   * @returns {number} Base score
   */
  getClassWeight(label) {
    if (!label) return 0.1; // Default weight for undefined labels
    const normalizedLabel = label.toLowerCase().replace(/[_\s-]/g, '_');

    // Direct match
    if (this.classWeights[normalizedLabel] !== undefined) {
      return this.classWeights[normalizedLabel];
    }

    // Partial match (e.g., "hunting_knife" matches "knife")
    for (const [key, weight] of Object.entries(this.classWeights)) {
      if (normalizedLabel.includes(key) || key.includes(normalizedLabel)) {
        return weight;
      }
    }

    // Unknown class - assign moderate score for safety
    return 15;
  }

  /**
   * Calculate score for a single detection
   * @param {Object} detection Detection object with label, confidence, bbox
   * @returns {number} Detection score
   */
  scoreDetection(detection) {
    const { label, confidence } = detection;

    // Filter low confidence detections
    if (confidence < this.confidenceThreshold) {
      return 0;
    }

    const baseWeight = this.getClassWeight(label);

    // Scale by confidence (higher confidence = higher score)
    // Use exponential scaling to reward high confidence detections
    const confidenceMultiplier = Math.pow(confidence, 0.5); // sqrt for smoother curve

    return Math.round(baseWeight * confidenceMultiplier);
  }

  /**
   * Check if a rule's requirements are met
   * @param {Object} rule Interaction rule
   * @param {Array} labels Array of detected labels
   * @param {Object} labelCounts Count of each label
   * @returns {boolean}
   */
  checkRuleRequirements(rule, labels, labelCounts) {
    const labelSet = new Set(labels.map(l => l.toLowerCase()));

    // Check requires conditions
    for (const req of rule.requires) {
      if (Array.isArray(req)) {
        // Any of these labels must be present
        const hasAny = req.some(r => labelSet.has(r.toLowerCase()));
        if (!hasAny) return false;
      } else {
        // This specific label must be present
        if (!labelSet.has(req.toLowerCase())) return false;
      }
    }

    // Check requiresAbsent conditions
    if (rule.requiresAbsent) {
      for (const absent of rule.requiresAbsent) {
        if (labelSet.has(absent.toLowerCase())) return false;
      }
    }

    // Check minCount conditions
    if (rule.minCount) {
      for (const [label, minCount] of Object.entries(rule.minCount)) {
        const count = labelCounts[label.toLowerCase()] || 0;
        if (count < minCount) return false;
      }
    }

    return true;
  }

  /**
   * Calculate interaction bonuses for a frame
   * @param {Array} detections Array of detections in the frame
   * @returns {Object} { totalBonus, triggeredRules }
   */
  calculateInteractionBonuses(detections) {
    const labels = detections
      .filter(d => d.confidence >= this.confidenceThreshold)
      .map(d => d.label || d.object_class).filter(Boolean);

    // Count occurrences
    const labelCounts = {};
    labels.forEach(label => {
      const normalized = label.toLowerCase();
      labelCounts[normalized] = (labelCounts[normalized] || 0) + 1;
    });

    let totalBonus = 0;
    const triggeredRules = [];

    for (const rule of this.interactionRules) {
      if (this.checkRuleRequirements(rule, labels, labelCounts)) {
        totalBonus += rule.bonus;
        triggeredRules.push({
          name: rule.name,
          bonus: rule.bonus,
          description: rule.description
        });
      }
    }

    return { totalBonus, triggeredRules };
  }

  /**
   * Calculate total threat score for a frame
   * @param {Object} frame Frame data with detections
   * @returns {Object} { score, breakdown }
   */
  calculateFrameScore(frame) {
    const detections = frame.detections || [];

    // Base scores from individual detections
    let baseScore = 0;
    const detectionScores = [];

    for (const detection of detections) {
      const score = this.scoreDetection(detection);
      if (score > 0) {
        baseScore += score;
        detectionScores.push({
          label: detection.label || detection.object_class,
          confidence: detection.confidence,
          score
        });
      }
    }

    // Interaction bonuses
    const { totalBonus, triggeredRules } = this.calculateInteractionBonuses(detections);

    const totalScore = baseScore + totalBonus;

    return {
      score: totalScore,
      breakdown: {
        baseScore,
        interactionBonus: totalBonus,
        detectionScores,
        triggeredRules
      }
    };
  }

  /**
   * Get threat level category from score
   * @param {number} score Threat score
   * @returns {string} Threat level: 'critical', 'high', 'medium', 'low', 'minimal'
   */
  getThreatLevel(score) {
    if (score >= 200) return 'critical';
    if (score >= 100) return 'high';
    if (score >= 50) return 'medium';
    if (score >= 20) return 'low';
    return 'minimal';
  }

  /**
   * Get configuration summary
   * @returns {Object}
   */
  getConfig() {
    return {
      confidenceThreshold: this.confidenceThreshold,
      classWeightsCount: Object.keys(this.classWeights).length,
      interactionRulesCount: this.interactionRules.length,
      highThreatClasses: Object.entries(this.classWeights)
        .filter(([_, w]) => w >= 100)
        .map(([k, _]) => k)
    };
  }
}

// Named exports for convenience
export { DEFAULT_CLASS_WEIGHTS, DEFAULT_INTERACTION_RULES };
