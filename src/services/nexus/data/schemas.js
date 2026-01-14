/**
 * Nexus 2.0 Firestore Schema Definitions
 *
 * This file documents the schema for all Nexus collections.
 * These are reference schemas - Firestore is schemaless but this
 * documents the expected structure for each document type.
 *
 * Base Path: artifacts/{APP_COLLECTION_ID}/users/{userId}/
 */

// ============================================================
// THREADS COLLECTION
// ============================================================

/**
 * Path: users/{userId}/threads/{threadId}
 *
 * Threads track ongoing storylines across entries with evolution tracking.
 */
export const THREAD_SCHEMA = {
  // Identity
  id: 'string', // e.g., "anthropic-opportunity-1704067200"
  displayName: 'string', // e.g., "Anthropic Opportunity"
  category: 'string', // career | health | relationship | growth | somatic | financial | housing | creative | social
  status: 'string', // active | resolved | archived | evolved

  // Thread Metamorphosis
  rootThreadId: 'string', // First thread in this lifecycle
  predecessorId: 'string|null', // Immediate parent thread
  successorId: 'string|null', // Set when this thread evolves
  evolutionType: 'string|null', // continuation | pivot | resolution
  evolutionContext: 'string|null', // "Databricks rejection led to Anthropic application"

  // Sentiment Tracking
  sentimentBaseline: 'number', // 0-1
  sentimentHistory: '[number]', // Last 10 sentiment values
  sentimentTrajectory: 'string', // improving | declining | stable | volatile

  // Emotional Arc
  emotionalArc: [{
    date: 'string', // ISO date
    sentiment: 'number',
    event: 'string' // "Started application"
  }],

  // Somatic Signals
  somaticSignals: '[string]', // ["tension", "fatigue"]
  somaticFrequency: 'object', // { tension: 3, fatigue: 2 }

  // Entry References
  entryIds: '[string]',
  entryCount: 'number',

  // Embedding for semantic matching
  embedding: '[number]', // 768-dim vector

  // Timestamps
  createdAt: 'Timestamp',
  lastUpdated: 'Timestamp',
  lastEntryAt: 'Timestamp',
  resolvedAt: 'Timestamp|null'
};

// ============================================================
// NEXUS COLLECTION (Singleton Documents)
// ============================================================

/**
 * Path: users/{userId}/nexus/baselines
 *
 * Personal baselines for all metrics.
 */
export const BASELINES_SCHEMA = {
  calculatedAt: 'Timestamp',
  dataWindowDays: 'number', // 30
  whoopDaysConnected: 'number',

  // Global Baselines
  global: {
    rhr: {
      mean: 'number',
      stdDev: 'number',
      min: 'number',
      max: 'number',
      trend: 'number', // Change per day
      percentiles: { p25: 'number', p50: 'number', p75: 'number' }
    },
    hrv: '...same structure...',
    strain: '...same structure...',
    recovery: '...same structure...',
    sleep: '...same structure...',
    mood: '...same structure...'
  },

  // Contextual Baselines
  contextual: {
    'state:career_waiting': {
      rhr: { mean: 'number', delta: 'number' },
      hrv: { mean: 'number', delta: 'number' },
      mood: { mean: 'number', delta: 'number' },
      sampleDays: 'number'
    },
    'entity:spencer': {
      mood: { mean: 'number', delta: 'number' },
      effect: 'string' // "stabilizing"
    },
    'activity:yoga': {
      sameDayMood: '...stats...',
      nextDayRecovery: '...stats...',
      sampleDays: 'number'
    },
    'temporal:monday': {
      mood: '...stats...',
      strain: '...stats...'
    }
  },

  // Correlation Matrix
  correlations: {
    'mood_hrv': 'number', // Pearson correlation
    'sleep_mood': 'number'
  }
};

/**
 * Path: users/{userId}/nexus/states
 *
 * Life state tracking.
 */
export const STATES_SCHEMA = {
  currentState: {
    primary: 'string', // State ID
    secondary: '[string]',
    confidence: 'number',
    startedAt: 'Timestamp',
    durationDays: 'number',
    triggerThread: 'string|null'
  },

  stateHistory: [{
    state: 'string',
    startedAt: 'Timestamp',
    endedAt: 'Timestamp',
    durationDays: 'number',
    averageMood: 'number|null',
    outcome: 'string' // positive | negative | neutral
  }],

  updatedAt: 'Timestamp'
};

/**
 * Path: users/{userId}/nexus/beliefs
 *
 * Extracted beliefs for dissonance detection.
 */
export const BELIEFS_SCHEMA = {
  extractedBeliefs: [{
    id: 'string',
    statement: 'string', // "I'm okay with my sense of self being tied to external success"
    category: 'string', // self_worth | productivity | relationships | health | emotional_regulation
    extractedFrom: 'string', // Entry ID
    extractedAt: 'Timestamp',
    confidence: 'number',
    testableClaim: 'string|null',

    validation: {
      supportingData: '[object]',
      contradictingData: [{
        metric: 'string',
        value: 'number',
        interpretation: 'string'
      }],
      dissonanceScore: 'number', // 0 = aligned, 1 = fully contradicted
      lastValidated: 'Timestamp'
    }
  }],

  beliefClusters: {
    self_worth: '[string]', // Belief IDs
    productivity: '[string]'
  },

  lastUpdated: 'Timestamp'
};

/**
 * Path: users/{userId}/nexus/interventions
 *
 * Tracked interventions and their effectiveness.
 */
export const INTERVENTIONS_SCHEMA = {
  interventions: {
    yoga: {
      category: 'string', // physical | relational | behavioral | recovery
      totalOccurrences: 'number',
      effectiveness: {
        global: {
          moodDelta: { mean: 'number', stdDev: 'number' },
          hrvDelta: { mean: 'number', stdDev: 'number' },
          nextDayRecovery: { mean: 'number', stdDev: 'number' },
          score: 'number' // 0-1 effectiveness score
        },
        'during:career_waiting': {
          moodDelta: { mean: 'number', stdDev: 'number' },
          score: 'number'
        }
      },
      optimal: {
        timeOfDay: 'string',
        duration: 'string',
        priorSleep: 'string'
      }
    }
  },

  recommendedByState: {
    career_waiting: '[string]', // Intervention names
    low_mood: '[string]'
  },

  lastUpdated: 'Timestamp'
};

/**
 * Path: users/{userId}/nexus/insights
 *
 * Generated insights (active and historical).
 */
export const INSIGHTS_SCHEMA = {
  // Currently active insights
  active: [{
    id: 'string',
    generatedAt: 'Timestamp',
    expiresAt: 'Timestamp',

    type: 'string', // causal_synthesis | belief_dissonance | narrative_arc | intervention | counterfactual | state_comparison | pattern_alert
    priority: 'number', // 1 = primary, 2 = secondary, 3 = tertiary

    // Content
    title: 'string',
    summary: 'string',
    body: 'string',

    // Evidence
    evidence: {
      narrative: [{ source: 'string', quote: 'string', sentiment: 'number' }],
      biometric: [{ metric: 'string', value: 'string', context: 'string' }],
      statistical: { correlation: 'number', sampleSize: 'number', confidence: 'number' }
    },

    mechanism: 'string',

    // Recommendation
    recommendation: {
      action: 'string',
      reasoning: 'string',
      timing: 'string',
      expectedOutcome: 'string',
      confidence: 'number'
    },

    // Metadata
    layers: '[number]', // Which layers contributed [1, 2, 3, 4]
    threadIds: '[string]',
    stateContext: 'string'
  }],

  // Historical insights
  history: [{
    id: 'string',
    type: 'string',
    shownAt: 'Timestamp',

    engagement: {
      viewed: 'boolean',
      viewDuration: 'number', // seconds
      expandedDetails: 'boolean',
      followedRecommendation: 'boolean',
      dismissed: 'boolean',
      thumbsUp: 'boolean',
      thumbsDown: 'boolean'
    },

    outcome: {
      recommendationFollowed: 'boolean',
      moodDeltaAfter24h: 'number',
      hrvDeltaAfter24h: 'number',
      effectivenessValidated: 'boolean'
    }
  }],

  // Generation metadata
  generation: {
    lastFullGeneration: 'Timestamp',
    lastIncrementalUpdate: 'Timestamp',
    nextScheduledGeneration: 'Timestamp|null',
    generationTrigger: 'string', // new_entry | scheduled | manual | whoop_sync
    stale: 'boolean'
  }
};

/**
 * Path: users/{userId}/settings/nexus
 *
 * User settings for Nexus features.
 */
export const SETTINGS_SCHEMA = {
  features: {
    beliefDissonanceInsights: { enabled: 'boolean', lastToggled: 'Timestamp|null' },
    interventionRecommendations: { enabled: 'boolean' },
    narrativeArcTracking: { enabled: 'boolean' },
    counterfactualInsights: { enabled: 'boolean' }
  },

  preferences: {
    insightDepth: 'string', // minimal | balanced | comprehensive
    recommendationStyle: 'string', // general | specific
    challengeFrequency: 'string', // rare | moderate | frequent
    moodGateThreshold: 'number' // 0-100, don't show challenges below this mood
  },

  notifications: {
    dailyInsightSummary: 'boolean',
    interventionReminders: 'boolean',
    milestoneAlerts: 'boolean'
  },

  updatedAt: 'Timestamp'
};

// ============================================================
// DEFAULT VALUES
// ============================================================

export const getDefaultSettings = () => ({
  features: {
    beliefDissonanceInsights: { enabled: true }, // ON by default
    interventionRecommendations: { enabled: true },
    narrativeArcTracking: { enabled: true },
    counterfactualInsights: { enabled: true }
  },
  preferences: {
    insightDepth: 'comprehensive',
    recommendationStyle: 'specific',
    challengeFrequency: 'moderate',
    moodGateThreshold: 50
  },
  notifications: {
    dailyInsightSummary: true,
    interventionReminders: true,
    milestoneAlerts: true
  }
});
