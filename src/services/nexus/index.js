/**
 * Nexus 2.0 - Insight Engine
 *
 * Four-layer architecture for generating deep, causal insights
 * from journal entries and biometric data.
 *
 * Layers:
 * 1. Pattern Detection - Identifies correlations between narrative and biometrics
 * 2. Temporal Reasoner - Detects life states, baselines, trajectories
 * 3. Causal Synthesizer - LLM-powered insight generation (Cloud Function)
 * 4. Intervention Optimizer - Personalized action recommendations
 */

// Layer 1: Pattern Detection
export {
  detectPatternsInEntry,
  detectPatternsInPeriod,
  NARRATIVE_PATTERNS
} from './layer1/patternDetector';

export {
  extractSomaticSignals,
  analyzeSomaticPatterns,
  detectSomaticEmotionalClusters,
  SOMATIC_TAXONOMY
} from './layer1/somaticExtractor';

export {
  getActiveThreads,
  getThread,
  getThreadLineage,
  createThread,
  appendToThread,
  resolveThread,
  identifyThreadAssociation
} from './layer1/threadManager';

// Layer 2: Temporal Reasoner
export {
  detectCurrentState,
  getStateHistory,
  updateCurrentState,
  findSimilarPastStates,
  LIFE_STATES
} from './layer2/stateDetector';

export {
  getBaselines,
  calculateAndSaveBaselines,
  compareToBaseline
} from './layer2/baselineManager';

// Layer 3: Causal Synthesizer (via Cloud Function)
export {
  generateCausalSynthesis,
  generateNarrativeArcInsight,
  INSIGHT_TYPES
} from './layer3/synthesizer';

export {
  detectMetaPatterns,
  generateMetaPatternInsight,
  META_PATTERNS
} from './layer3/crossThreadDetector';

export {
  extractBeliefsFromEntry,
  validateBeliefAgainstData,
  generateDissonanceInsight,
  saveBeliefs,
  getBeliefs
} from './layer3/beliefDissonance';

// Layer 4: Intervention Optimizer
export {
  detectInterventionsInEntry,
  updateInterventionData,
  getInterventionData
} from './layer4/interventionTracker';

export {
  generateRecommendations
} from './layer4/recommendationEngine';

// Orchestration
export {
  generateInsights,
  updateInsightsForNewEntry,
  getCachedInsights
} from './orchestrator';
