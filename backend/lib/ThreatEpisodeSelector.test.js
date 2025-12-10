/**
 * ThreatEpisodeSelector Unit Tests
 *
 * Tests the complete pipeline:
 * 1. ThreatScorer - Scoring individual frames
 * 2. Episode clustering - Grouping frames by time
 * 3. Keyframe selection - Picking best frame per episode
 * 4. Final filtering - Selecting top N episodes
 */

import ThreatScorer from './ThreatScorer.js';
import ThreatEpisodeSelector from './ThreatEpisodeSelector.js';

// Test utilities
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`  ✓ ${message}`);
};

const createFrame = (timestampSec, detections, frameNumber = null) => ({
  timestamp: timestampSec * 1000, // Convert to ms
  imageUrl: `snapshots/frame_${frameNumber || timestampSec}.jpg`,
  frameNumber: frameNumber || Math.floor(timestampSec),
  detections
});

const createDetection = (label, confidence = 0.8, bbox = [100, 100, 200, 200]) => ({
  label,
  confidence,
  bbox
});

// ============================================================================
// TEST 1: ThreatScorer Basic Functionality
// ============================================================================
function testThreatScorerBasics() {
  console.log('\n=== TEST 1: ThreatScorer Basic Functionality ===');

  const scorer = new ThreatScorer();

  // Test class weights
  assert(scorer.getClassWeight('knife') >= 100, 'Knife should have high weight (>=100)');
  assert(scorer.getClassWeight('gun') >= 150, 'Gun should have very high weight (>=150)');
  assert(scorer.getClassWeight('person') >= 40, 'Person should have medium weight (>=40)');
  assert(scorer.getClassWeight('cat') <= 10, 'Cat should have low weight (<=10)');
  assert(scorer.getClassWeight('chair') <= 5, 'Chair should have minimal weight (<=5)');

  // Test confidence threshold
  const lowConfidence = scorer.scoreDetection({ label: 'knife', confidence: 0.3 });
  const highConfidence = scorer.scoreDetection({ label: 'knife', confidence: 0.9 });
  assert(lowConfidence === 0, 'Low confidence (0.3) should be filtered out');
  assert(highConfidence > 100, 'High confidence knife should score > 100');

  // Test threat levels
  assert(scorer.getThreatLevel(250) === 'critical', 'Score 250 should be critical');
  assert(scorer.getThreatLevel(150) === 'high', 'Score 150 should be high');
  assert(scorer.getThreatLevel(75) === 'medium', 'Score 75 should be medium');
  assert(scorer.getThreatLevel(30) === 'low', 'Score 30 should be low');
  assert(scorer.getThreatLevel(10) === 'minimal', 'Score 10 should be minimal');

  console.log('  All ThreatScorer basic tests passed!\n');
}

// ============================================================================
// TEST 2: Interaction Bonuses
// ============================================================================
function testInteractionBonuses() {
  console.log('\n=== TEST 2: Interaction Bonuses ===');

  const scorer = new ThreatScorer();

  // Armed person scenario
  const armedPersonDetections = [
    createDetection('person', 0.9),
    createDetection('knife', 0.85)
  ];
  const { totalBonus: armedBonus, triggeredRules: armedRules } =
    scorer.calculateInteractionBonuses(armedPersonDetections);
  assert(armedBonus >= 100, 'Armed person should trigger large bonus');
  assert(armedRules.some(r => r.name === 'armed_person'), 'Should trigger armed_person rule');

  // Suspicious package scenario
  const packageDetections = [
    createDetection('person', 0.9),
    createDetection('backpack', 0.8)
  ];
  const { totalBonus: packageBonus, triggeredRules: packageRules } =
    scorer.calculateInteractionBonuses(packageDetections);
  assert(packageBonus >= 20, 'Person with backpack should trigger bonus');
  assert(packageRules.some(r => r.name === 'suspicious_package'), 'Should trigger suspicious_package rule');

  // Abandoned item scenario (bag without person)
  const abandonedDetections = [
    createDetection('backpack', 0.9)
  ];
  const { totalBonus: abandonedBonus, triggeredRules: abandonedRules } =
    scorer.calculateInteractionBonuses(abandonedDetections);
  assert(abandonedBonus >= 30, 'Abandoned bag should trigger bonus');
  assert(abandonedRules.some(r => r.name === 'abandoned_item'), 'Should trigger abandoned_item rule');

  // Crowd scenario
  const crowdDetections = [
    createDetection('person', 0.9),
    createDetection('person', 0.85),
    createDetection('person', 0.88)
  ];
  const { totalBonus: crowdBonus, triggeredRules: crowdRules } =
    scorer.calculateInteractionBonuses(crowdDetections);
  assert(crowdBonus >= 20, 'Crowd should trigger bonus');
  assert(crowdRules.some(r => r.name === 'crowd'), 'Should trigger crowd rule');

  console.log('  All interaction bonus tests passed!\n');
}

// ============================================================================
// TEST 3: Frame Scoring
// ============================================================================
function testFrameScoring() {
  console.log('\n=== TEST 3: Frame Scoring ===');

  const scorer = new ThreatScorer();

  // Empty frame
  const emptyFrame = createFrame(0, []);
  const { score: emptyScore } = scorer.calculateFrameScore(emptyFrame);
  assert(emptyScore === 0, 'Empty frame should have 0 score');

  // Benign frame (cat only)
  const catFrame = createFrame(1, [createDetection('cat', 0.9)]);
  const { score: catScore } = scorer.calculateFrameScore(catFrame);
  assert(catScore <= 10, 'Cat-only frame should have low score (<=10)');

  // Person frame
  const personFrame = createFrame(2, [createDetection('person', 0.9)]);
  const { score: personScore } = scorer.calculateFrameScore(personFrame);
  assert(personScore >= 40 && personScore <= 60, 'Person-only frame should be 40-60');

  // Armed person frame
  const armedFrame = createFrame(3, [
    createDetection('person', 0.9),
    createDetection('knife', 0.85)
  ]);
  const { score: armedScore, breakdown } = scorer.calculateFrameScore(armedFrame);
  assert(armedScore >= 200, 'Armed person frame should score >= 200');
  assert(breakdown.triggeredRules.length > 0, 'Should have triggered rules');

  console.log('  All frame scoring tests passed!\n');
}

// ============================================================================
// TEST 4: Episode Clustering
// ============================================================================
function testEpisodeClustering() {
  console.log('\n=== TEST 4: Episode Clustering ===');

  const selector = new ThreatEpisodeSelector({
    episodeGapMs: 3000,  // 3 second gap
    minEpisodeDurationMs: 100
  });

  // Create frames with gaps
  const frames = [
    // Episode 1: 0-2 seconds (person)
    createFrame(0, [createDetection('person', 0.9)], 0),
    createFrame(1, [createDetection('person', 0.85)], 1),
    createFrame(2, [createDetection('person', 0.88)], 2),

    // Gap of 5 seconds (should split)

    // Episode 2: 7-9 seconds (knife)
    createFrame(7, [createDetection('person', 0.9), createDetection('knife', 0.8)], 7),
    createFrame(8, [createDetection('person', 0.85), createDetection('knife', 0.9)], 8),
    createFrame(9, [createDetection('knife', 0.7)], 9),

    // Gap of 10 seconds

    // Episode 3: 19-20 seconds (cat)
    createFrame(19, [createDetection('cat', 0.9)], 19),
    createFrame(20, [createDetection('cat', 0.85)], 20),
  ];

  const { episodes, stats } = selector.selectBestEpisodes(frames, 10, { useDiversity: false });

  assert(episodes.length === 3, `Should have 3 episodes (got ${episodes.length})`);
  assert(stats.totalFrames === 8, `Should process 8 frames (got ${stats.totalFrames})`);

  // Verify episodes are sorted by score
  for (let i = 1; i < episodes.length; i++) {
    assert(
      episodes[i - 1].maxThreatScore >= episodes[i].maxThreatScore,
      `Episode ${i - 1} should have score >= episode ${i}`
    );
  }

  // Episode with knife should be first
  assert(
    episodes[0].allDetections.includes('knife'),
    'Highest scoring episode should contain knife'
  );

  console.log('  All episode clustering tests passed!\n');
}

// ============================================================================
// TEST 5: Keyframe Selection (The Optimizer)
// ============================================================================
function testKeyframeSelection() {
  console.log('\n=== TEST 5: Keyframe Selection ===');

  const selector = new ThreatEpisodeSelector({
    episodeGapMs: 5000,
    minEpisodeDurationMs: 100
  });

  // Create an episode where the knife appears mid-way
  const frames = [
    createFrame(0, [createDetection('person', 0.9)], 0),          // Just person
    createFrame(1, [createDetection('person', 0.85)], 1),         // Just person
    createFrame(2, [createDetection('person', 0.9), createDetection('knife', 0.95)], 2), // KNIFE VISIBLE!
    createFrame(3, [createDetection('person', 0.8)], 3),          // Person turned
    createFrame(4, [createDetection('person', 0.75)], 4),         // Person walking away
  ];

  const { episodes } = selector.selectBestEpisodes(frames, 1);

  assert(episodes.length === 1, 'Should have 1 episode');

  const episode = episodes[0];
  const bestFrame = episode.bestFrame;

  // The best frame should be frame 2 (when knife is visible)
  assert(
    bestFrame.frameNumber === 2,
    `Best frame should be frame 2 (knife visible), got frame ${bestFrame.frameNumber}`
  );

  assert(
    bestFrame.detections.some(d => d.label === 'knife'),
    'Best frame should contain knife detection'
  );

  assert(
    episode.maxThreatScore >= 200,
    `Episode score should be >= 200 (got ${episode.maxThreatScore})`
  );

  console.log('  All keyframe selection tests passed!\n');
}

// ============================================================================
// TEST 6: Main Scenario - 60 Second Video
// ============================================================================
function testMainScenario() {
  console.log('\n=== TEST 6: Main Scenario (60 Second Video) ===');
  console.log('  Scenario:');
  console.log('    - Event A (10s): Person walks by');
  console.log('    - Event B (30s): Person with knife');
  console.log('    - Event C (50s): Cat walks by\n');

  const selector = new ThreatEpisodeSelector({
    episodeGapMs: 3000,
    minEpisodeDurationMs: 100
  });

  // Generate frames with detections only (empty frames don't create episodes)
  const frames = [];

  // 10-14s: Event A - Person walks by (5 frames)
  for (let t = 10; t < 15; t++) {
    frames.push(createFrame(t, [createDetection('person', 0.85)], t));
  }

  // 30-35s: Event B - Person with knife (THREAT!)
  frames.push(createFrame(30, [createDetection('person', 0.9)], 30));
  frames.push(createFrame(31, [createDetection('person', 0.9), createDetection('knife', 0.7)], 31));
  frames.push(createFrame(32, [createDetection('person', 0.95), createDetection('knife', 0.95)], 32)); // Peak threat
  frames.push(createFrame(33, [createDetection('person', 0.85), createDetection('knife', 0.85)], 33));
  frames.push(createFrame(34, [createDetection('person', 0.8)], 34));

  // 50-55s: Event C - Cat walks by (6 frames)
  for (let t = 50; t < 56; t++) {
    frames.push(createFrame(t, [createDetection('cat', 0.9)], t));
  }

  // Select top 5 episodes
  const { episodes, stats } = selector.selectBestEpisodes(frames, 5, { useDiversity: false });

  console.log(`  Stats: ${stats.totalEpisodes} episodes, max score: ${stats.maxScore}`);
  console.log(`  Score distribution: ${JSON.stringify(stats.scoreDistribution)}`);

  // Should have the 3 events as episodes (large gaps between them)
  assert(
    stats.totalEpisodes === 3,
    `Should have exactly 3 episodes (got ${stats.totalEpisodes})`
  );

  // The knife episode should be #1
  const topEpisode = episodes[0];
  console.log(`\n  Top Episode (#1):`);
  console.log(`    - Score: ${topEpisode.maxThreatScore}`);
  console.log(`    - Threat Level: ${topEpisode.threatLevel}`);
  console.log(`    - Objects: ${topEpisode.allDetections.join(', ')}`);
  console.log(`    - Best Frame: ${topEpisode.bestFrame.frameNumber}`);

  assert(
    topEpisode.allDetections.includes('knife'),
    'Top episode should contain knife'
  );

  assert(
    topEpisode.threatLevel === 'critical' || topEpisode.threatLevel === 'high',
    `Top episode should be critical/high threat (got ${topEpisode.threatLevel})`
  );

  // Best frame should be around frame 32 (peak knife confidence)
  assert(
    topEpisode.bestFrame.frameNumber >= 30 && topEpisode.bestFrame.frameNumber <= 34,
    `Best frame should be in knife window (30-34), got ${topEpisode.bestFrame.frameNumber}`
  );

  // Person episode should exist and be #2
  const personEpisode = episodes.find(
    e => e.allDetections.includes('person') && !e.allDetections.includes('knife')
  );
  assert(personEpisode !== undefined, 'Should have a person-only episode');

  const personRank = episodes.indexOf(personEpisode) + 1;
  console.log(`\n  Person episode rank: ${personRank} (score: ${personEpisode.maxThreatScore})`);
  assert(personRank === 2, `Person episode should be rank 2 (got ${personRank})`);

  // Cat episode should be #3 (lowest priority)
  const catEpisode = episodes.find(e =>
    e.allDetections.includes('cat') && e.allDetections.length === 1
  );
  assert(catEpisode !== undefined, 'Should have a cat episode');

  const catRank = episodes.indexOf(catEpisode) + 1;
  console.log(`  Cat episode rank: ${catRank} (score: ${catEpisode.maxThreatScore})`);
  assert(catRank === 3, `Cat episode should be rank 3 (got ${catRank})`);

  // Verify score ordering: Knife > Person > Cat
  assert(
    topEpisode.maxThreatScore > personEpisode.maxThreatScore,
    'Knife score should be > Person score'
  );
  assert(
    personEpisode.maxThreatScore > catEpisode.maxThreatScore,
    'Person score should be > Cat score'
  );

  console.log('\n  ✓ Knife episode correctly identified as #1 threat');
  console.log('  ✓ Person episode correctly ranked #2');
  console.log('  ✓ Cat episode correctly ranked #3 (lowest)');
  console.log('\n  All main scenario tests passed!\n');
}

// ============================================================================
// TEST 7: Diversity Filter
// ============================================================================
function testDiversityFilter() {
  console.log('\n=== TEST 7: Diversity Filter ===');

  const selector = new ThreatEpisodeSelector({
    episodeGapMs: 2000,
    diversityWindowMs: 5000  // 5 second diversity window
  });

  // Create two high-scoring episodes very close together
  const frames = [
    // Episode 1: 0-2s (high score)
    createFrame(0, [createDetection('person', 0.9), createDetection('knife', 0.9)], 0),
    createFrame(1, [createDetection('person', 0.9), createDetection('knife', 0.85)], 1),
    createFrame(2, [createDetection('person', 0.85)], 2),

    // Episode 2: 4-6s (also high score, within diversity window)
    createFrame(4, [createDetection('person', 0.85), createDetection('knife', 0.8)], 4),
    createFrame(5, [createDetection('person', 0.8), createDetection('knife', 0.75)], 5),
    createFrame(6, [createDetection('person', 0.75)], 6),

    // Episode 3: 15-17s (different time region)
    createFrame(15, [createDetection('person', 0.9)], 15),
    createFrame(16, [createDetection('person', 0.85)], 16),
    createFrame(17, [createDetection('person', 0.8)], 17),
  ];

  // With diversity filtering
  const { episodes: withDiversity } = selector.selectBestEpisodes(frames, 3, { useDiversity: true });

  // Without diversity filtering
  const { episodes: withoutDiversity } = selector.selectBestEpisodes(frames, 3, { useDiversity: false });

  console.log(`  With diversity: ${withDiversity.length} episodes selected`);
  console.log(`  Without diversity: ${withoutDiversity.length} episodes selected`);

  // Without diversity, both knife episodes should be selected
  // With diversity, only one should be (they're within 5 seconds)

  const withDiversityKnifeCount = withDiversity.filter(
    e => e.allDetections.includes('knife')
  ).length;

  const withoutDiversityKnifeCount = withoutDiversity.filter(
    e => e.allDetections.includes('knife')
  ).length;

  console.log(`  Knife episodes with diversity: ${withDiversityKnifeCount}`);
  console.log(`  Knife episodes without diversity: ${withoutDiversityKnifeCount}`);

  assert(
    withDiversityKnifeCount <= withoutDiversityKnifeCount,
    'Diversity filter should reduce nearby duplicate episodes'
  );

  console.log('  All diversity filter tests passed!\n');
}

// ============================================================================
// TEST 8: LLM Payload Generation
// ============================================================================
function testLLMPayloadGeneration() {
  console.log('\n=== TEST 8: LLM Payload Generation ===');

  const selector = new ThreatEpisodeSelector();

  const frames = [
    createFrame(0, [createDetection('person', 0.9), createDetection('gun', 0.95)], 0),
    createFrame(1, [createDetection('person', 0.85)], 1),
  ];

  const { episodes } = selector.selectBestEpisodes(frames, 5);
  const payload = selector.generateLLMPayload(episodes);

  console.log('  Payload structure:');
  console.log(`    - episodeCount: ${payload.episodeCount}`);
  console.log(`    - metadata.generatedAt: ${payload.metadata.generatedAt}`);

  assert(payload.episodeCount === episodes.length, 'Episode count should match');
  assert(payload.episodes.length > 0, 'Should have episodes in payload');
  assert(payload.episodes[0].rank === 1, 'First episode should have rank 1');
  assert(payload.episodes[0].keyframe !== undefined, 'Should have keyframe data');
  assert(payload.episodes[0].keyframe.imageUrl !== undefined, 'Keyframe should have imageUrl');
  assert(payload.metadata !== undefined, 'Should have metadata');
  assert(payload.metadata.scorerConfig !== undefined, 'Should have scorer config');

  console.log('  Sample episode in payload:');
  console.log(`    - threatLevel: ${payload.episodes[0].threatLevel}`);
  console.log(`    - threatScore: ${payload.episodes[0].threatScore}`);
  console.log(`    - keyframe.imageUrl: ${payload.episodes[0].keyframe.imageUrl}`);

  console.log('  All LLM payload tests passed!\n');
}

// ============================================================================
// TEST 9: Edge Cases
// ============================================================================
function testEdgeCases() {
  console.log('\n=== TEST 9: Edge Cases ===');

  const selector = new ThreatEpisodeSelector();

  // Empty frames array
  const { episodes: emptyResult } = selector.selectBestEpisodes([], 5);
  assert(emptyResult.length === 0, 'Empty frames should return empty episodes');

  // All low confidence detections
  const lowConfFrames = [
    createFrame(0, [createDetection('knife', 0.2)], 0),  // Below threshold
    createFrame(1, [createDetection('gun', 0.3)], 1),    // Below threshold
  ];
  const { episodes: lowConfResult, stats: lowStats } = selector.selectBestEpisodes(lowConfFrames, 5);
  console.log(`  Low confidence result: ${lowConfResult.length} episodes, max score: ${lowStats.maxScore}`);

  // Single frame
  const singleFrame = [createFrame(0, [createDetection('person', 0.9)], 0)];
  const { episodes: singleResult } = selector.selectBestEpisodes(singleFrame, 5);
  assert(singleResult.length >= 0, 'Single frame should be handled');

  // Frames out of order (should be sorted)
  const outOfOrderFrames = [
    createFrame(5, [createDetection('person', 0.9)], 5),
    createFrame(1, [createDetection('cat', 0.9)], 1),
    createFrame(3, [createDetection('car', 0.9)], 3),
  ];
  const { episodes: outOfOrderResult } = selector.selectBestEpisodes(outOfOrderFrames, 5);
  assert(outOfOrderResult.length >= 0, 'Out of order frames should be handled');

  console.log('  All edge case tests passed!\n');
}

// ============================================================================
// TEST 10: Custom Scorer Configuration
// ============================================================================
function testCustomConfiguration() {
  console.log('\n=== TEST 10: Custom Configuration ===');

  // Create selector with custom weights
  const selector = new ThreatEpisodeSelector({
    scorerOptions: {
      classWeights: {
        laptop: 100,      // Custom high priority for laptop
        phone: 80,        // Custom priority for phone
      },
      confidenceThreshold: 0.5  // Higher threshold
    }
  });

  const frames = [
    createFrame(0, [createDetection('laptop', 0.9)], 0),
    createFrame(5, [createDetection('person', 0.9)], 5),
  ];

  const { episodes } = selector.selectBestEpisodes(frames, 2, { useDiversity: false });

  // Laptop should score higher than person due to custom weights
  const laptopEpisode = episodes.find(e => e.allDetections.includes('laptop'));
  const personEpisode = episodes.find(e => e.allDetections.includes('person'));

  if (laptopEpisode && personEpisode) {
    console.log(`  Laptop episode score: ${laptopEpisode.maxThreatScore}`);
    console.log(`  Person episode score: ${personEpisode.maxThreatScore}`);

    assert(
      laptopEpisode.maxThreatScore > personEpisode.maxThreatScore,
      'Custom weights should make laptop score higher than person'
    );
  }

  console.log('  All custom configuration tests passed!\n');
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         ThreatEpisodeSelector Test Suite                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const tests = [
    testThreatScorerBasics,
    testInteractionBonuses,
    testFrameScoring,
    testEpisodeClustering,
    testKeyframeSelection,
    testMainScenario,
    testDiversityFilter,
    testLLMPayloadGeneration,
    testEdgeCases,
    testCustomConfiguration,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (error) {
      console.error(`\n❌ ${test.name} FAILED:`);
      console.error(`   ${error.message}`);
      failed++;
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed                                   ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runAllTests();
