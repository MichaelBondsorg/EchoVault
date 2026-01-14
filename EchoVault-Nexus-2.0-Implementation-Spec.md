# EchoVault Nexus 2.0: Comprehensive Implementation Specification

## Document Information
- **Version**: 2.0.0
- **Created**: January 13, 2026
- **Status**: Implementation Ready
- **Replaces**: All existing insight generation (`insightGenerator.js`, `featureExtraction.js`, `patternDetection.js`)

---

## Executive Summary

### What We're Building

Nexus 2.0 is a complete rebuild of EchoVault's insight engine. It moves from **correlation reporting** ("X correlates with Y") to **causal synthesis** ("X causes Y because Z, and here's what to do about it").

### The Four-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NEXUS 2.0 INSIGHT PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 1: PATTERN DETECTION                                          │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • Biometric-narrative correlations                                  │   │
│  │ • Somatic signal extraction                                         │   │
│  │ • Thread association                                                │   │
│  │ • Output: Raw patterns + correlation strengths                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 2: TEMPORAL REASONER                                          │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • Life state detection (waiting, recovery, strain, growth)          │   │
│  │ • Personal baseline comparison                                      │   │
│  │ • Trajectory analysis (improving, declining, volatile)              │   │
│  │ • Historical state matching                                         │   │
│  │ • Output: Contextualized patterns + temporal insights               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 3: CAUSAL SYNTHESIZER (LLM-Heavy)                             │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • Cross-thread pattern detection                                    │   │
│  │ • Psychological mechanism inference                                 │   │
│  │ • Counterfactual reasoning                                          │   │
│  │ • Belief-data dissonance detection                                  │   │
│  │ • Narrative arc construction                                        │   │
│  │ • Output: Deep insights with mechanisms + evidence                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ LAYER 4: INTERVENTION OPTIMIZER                                     │   │
│  │ ─────────────────────────────────────────────────────────────────── │   │
│  │ • Personalized intervention effectiveness scores                    │   │
│  │ • Context-aware action recommendations                              │   │
│  │ • Timing optimization                                               │   │
│  │ • Outcome prediction                                                │   │
│  │ • Output: Actionable recommendations with confidence scores         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Target Insight Quality

**Before (Current System):**
> "drag show boosts your mood by 30%"

**After (Nexus 2.0):**
> "Michael, we've identified a powerful 'stabilization loop' in your data. While you describe yourself as being 'patient' regarding the Anthropic and Cursor feedback loops, your Whoop data shows your Resting Heart Rate (RHR) has actually trended 4bpm higher during these 'waiting' periods—a sign of subconscious performance anxiety.
>
> However, on the days you mention Sterling (specifically the 'grooming' and 'walking' entries), your HRV recovers by an average of 12ms within 24 hours, effectively neutralizing that work-related strain.
>
> **The Nexus**: Caring for Sterling isn't just a chore; it is your most effective physical 'off-switch' for career-related nervous system tension.
>
> **Suggested Action**: Since you're still in a 'waiting' phase for visa/referral paperwork, prioritize Sterling's long walk this evening. It is statistically your best defense against the 'Adrenaline Buffer' crash we see in your historical patterns."

---

## Part 1: Files to Delete (Full Replacement)

The following files are **completely replaced** by Nexus 2.0:

| File | Reason for Deletion |
|------|---------------------|
| `src/services/patterns/insightGenerator.js` | Replaced by Layer 3 Synthesizer |
| `src/services/patterns/featureExtraction.js` | Replaced by Layer 1 Pattern Detection |
| `src/services/patterns/patternDetection.js` | Replaced by Layer 1 + Layer 2 |
| `src/services/patterns/insightRotation.js` | Replaced by new Insight Orchestrator |
| `src/services/patterns/index.js` | Will be rewritten |
| `src/hooks/usePatterns.js` | Replaced by `useNexusInsights.js` |
| `src/components/zen/widgets/PatternWidget.jsx` | Replaced by new insight widgets |

### Files to Modify

| File | Changes |
|------|---------|
| `src/services/background/entryPostProcessing.js` | Add Layer 1 processing |
| `src/App.jsx` | Update insight data flow |
| `src/components/zen/widgets/index.js` | Register new widgets |
| `src/hooks/useDashboardLayout.js` | Add new widget definitions |
| `src/services/memory/memoryGraph.js` | Add thread context |
| `src/pages/Settings.jsx` | Add Nexus settings section |

---

## Part 2: New Directory Structure

```
src/
├── services/
│   └── nexus/                          # NEW - All Nexus 2.0 services
│       ├── index.js                    # Public exports
│       ├── orchestrator.js             # Main insight orchestration
│       │
│       ├── layer1/                     # Pattern Detection
│       │   ├── index.js
│       │   ├── patternDetector.js      # Core correlation engine
│       │   ├── somaticExtractor.js     # Body signal extraction
│       │   └── threadManager.js        # Semantic thread management
│       │
│       ├── layer2/                     # Temporal Reasoner  
│       │   ├── index.js
│       │   ├── stateDetector.js        # Life state classification
│       │   ├── baselineManager.js      # Personal baseline calculation
│       │   ├── trajectoryAnalyzer.js   # Trend analysis
│       │   └── historicalMatcher.js    # Past state comparison
│       │
│       ├── layer3/                     # Causal Synthesizer
│       │   ├── index.js
│       │   ├── synthesizer.js          # Main LLM synthesis
│       │   ├── crossThreadDetector.js  # Meta-pattern detection
│       │   ├── mechanismInference.js   # Psychological mechanism inference
│       │   ├── counterfactual.js       # "What if" reasoning
│       │   ├── beliefDissonance.js     # Belief-data contradiction detection
│       │   └── narrativeArc.js         # Long-term story construction
│       │
│       ├── layer4/                     # Intervention Optimizer
│       │   ├── index.js
│       │   ├── interventionTracker.js  # Track what works
│       │   ├── effectivenessScorer.js  # Calculate intervention potency
│       │   ├── recommendationEngine.js # Generate actions
│       │   └── timingOptimizer.js      # When to intervene
│       │
│       ├── data/                       # Data management
│       │   ├── schemas.js              # Firestore schema definitions
│       │   ├── migrations.js           # Data migration utilities
│       │   └── cache.js                # Insight caching
│       │
│       └── prompts/                    # LLM prompt templates
│           ├── synthesis.js            # Layer 3 prompts
│           ├── beliefExtraction.js     # Belief detection prompts
│           └── interventionReasoning.js # Layer 4 prompts
│
├── hooks/
│   └── useNexusInsights.js             # NEW - Main insight hook
│
└── components/
    └── zen/
        └── widgets/
            ├── NexusInsightWidget.jsx  # NEW - Primary insight display
            ├── InterventionWidget.jsx  # NEW - Action recommendations
            └── NarrativeArcWidget.jsx  # NEW - Long-term story view
```

---

## Part 3: Firestore Schema

### 3.1 Threads Collection (Enhanced)

**Path**: `artifacts/{APP_COLLECTION_ID}/users/{uid}/threads/{threadId}`

```javascript
{
  // Identity
  id: "anthropic-opportunity-1704067200",
  displayName: "Anthropic Opportunity",
  category: "career",  // career | health | relationship | growth | somatic
  status: "active",    // active | resolved | archived | evolved
  
  // Thread Metamorphosis (NEW)
  rootThreadId: "job-hunt-1698000000",           // First thread in this lifecycle
  predecessorId: "databricks-career-1702000000", // Immediate parent thread
  successorId: null,                              // Set when this thread evolves
  evolutionType: "pivot",                         // continuation | pivot | resolution
  evolutionContext: "Databricks rejection led to Anthropic application",
  
  // Sentiment Tracking
  sentimentBaseline: 0.72,
  sentimentHistory: [0.65, 0.78, 0.73],
  sentimentTrajectory: "improving",  // improving | declining | stable | volatile
  
  // Emotional Arc (NEW)
  emotionalArc: [
    { date: "2026-01-03", sentiment: 0.70, event: "Started application" },
    { date: "2026-01-06", sentiment: 0.80, event: "Interview went well" },
    { date: "2026-01-09", sentiment: 0.85, event: "Moving to next round" }
  ],
  
  // Somatic Signals
  somaticSignals: ["tension", "fatigue"],
  somaticFrequency: {
    tension: 3,   // occurrences
    fatigue: 2
  },
  
  // Entry References
  entryIds: ["entry123", "entry456"],
  entryCount: 2,
  
  // Embedding for semantic matching
  embedding: [0.123, -0.456, ...],  // 768-dim vector
  
  // Timestamps
  createdAt: Timestamp,
  lastUpdated: Timestamp,
  lastEntryAt: Timestamp,
  resolvedAt: null
}
```

### 3.2 Personal Baselines (NEW)

**Path**: `artifacts/{APP_COLLECTION_ID}/users/{uid}/nexus/baselines`

```javascript
{
  calculatedAt: Timestamp,
  dataWindowDays: 30,
  whoopDaysConnected: 45,
  
  // Global Baselines
  global: {
    rhr: {
      mean: 58,
      stdDev: 4.2,
      min: 52,
      max: 68,
      trend: -0.5,  // bpm per week (negative = improving)
      percentiles: { p25: 55, p50: 58, p75: 62 }
    },
    hrv: {
      mean: 55,
      stdDev: 12,
      min: 35,
      max: 82,
      trend: +2.1,  // ms per week
      percentiles: { p25: 45, p50: 55, p75: 65 }
    },
    strain: {
      mean: 11.2,
      stdDev: 3.8,
      restDayAvg: 6.5,
      workoutDayAvg: 14.2
    },
    recovery: {
      mean: 62,
      stdDev: 15,
      greenDays: 18,    // recovery > 66%
      yellowDays: 9,    // 34-66%
      redDays: 3        // < 34%
    },
    sleep: {
      avgHours: 6.8,
      avgQuality: 72,
      avgLatency: 12,   // minutes
      avgDisturbances: 2.3
    },
    mood: {
      mean: 62,
      stdDev: 18,
      min: 20,
      max: 100
    }
  },
  
  // Contextual Baselines (The Magic)
  contextual: {
    // Life States
    "state:career_waiting": {
      rhr: { mean: 62, delta: +4 },    // elevated from global
      hrv: { mean: 48, delta: -7 },    // depressed from global
      mood: { mean: 55, delta: -7 },
      strain: { mean: 10.5 },
      sampleDays: 12,
      lastOccurrence: Timestamp
    },
    "state:recovery_mode": {
      rhr: { mean: 55, delta: -3 },
      hrv: { mean: 62, delta: +7 },
      mood: { mean: 68, delta: +6 },
      sampleDays: 8
    },
    "state:relationship_strain": {
      rhr: { mean: 61, delta: +3 },
      hrv: { mean: 50, delta: -5 },
      mood: { mean: 48, delta: -14 },
      sampleDays: 5
    },
    
    // Entity-Specific
    "entity:spencer": {
      mood: { mean: 68, delta: +6 },
      hrv: { mean: 60, delta: +5 },
      sampleDays: 25,
      effect: "stabilizing"
    },
    "entity:sterling": {
      mood: { mean: 65, delta: +3 },
      hrvRecovery: { mean: 12, unit: "ms within 24h" },
      sampleDays: 18,
      effect: "recovery_accelerant"
    },
    "entity:kobe": {
      mood: { mean: 52, delta: -10 },
      rhr: { mean: 63, delta: +5 },
      sampleDays: 8,
      effect: "stress_amplifier"
    },
    
    // Activity-Specific
    "activity:yoga": {
      nextDayRecovery: { mean: 68, delta: +6 },
      hrvDelta: { mean: +8 },
      moodDelta: { mean: +12 },
      sampleDays: 22,
      effectivenessScore: 0.85
    },
    "activity:barrys": {
      strainContribution: { mean: 8.5 },
      nextDayRecovery: { mean: 58, delta: -4 },
      moodDelta: { mean: +8 },
      sampleDays: 15,
      effectivenessScore: 0.72
    },
    "activity:sterling_walk": {
      hrvRecovery: { mean: 12, unit: "ms" },
      moodDelta: { mean: +5 },
      durationCorrelation: 0.6,  // longer walks = better effect
      sampleDays: 18,
      effectivenessScore: 0.88
    },
    
    // Temporal
    "temporal:monday": {
      mood: { mean: 66 },
      strain: { mean: 12.5 },
      recoveryStart: { mean: 58 }
    },
    "temporal:weekend": {
      mood: { mean: 70 },
      sleepHours: { mean: 7.4 },
      strain: { mean: 8.2 }
    }
  },
  
  // Correlation Matrix
  correlations: {
    "sleep_hours → next_day_mood": 0.62,
    "strain → next_day_recovery": -0.71,
    "hrv → same_day_mood": 0.58,
    "spencer_mention → mood": 0.45,
    "career_thread → rhr": 0.72,
    "yoga → next_day_hrv": 0.65
  }
}
```

### 3.3 Life States (NEW)

**Path**: `artifacts/{APP_COLLECTION_ID}/users/{uid}/nexus/states`

```javascript
{
  currentState: {
    primary: "career_waiting",
    secondary: ["relationship_growth"],
    confidence: 0.85,
    startedAt: Timestamp,
    durationDays: 5,
    triggerThread: "anthropic-opportunity-1704067200"
  },
  
  stateHistory: [
    {
      state: "career_waiting",
      startedAt: Timestamp,
      endedAt: Timestamp,
      durationDays: 12,
      averageMood: 55,
      averageHRV: 48,
      outcome: "negative",  // positive | negative | neutral
      outcomeEvent: "Databricks rejection"
    },
    {
      state: "recovery_mode",
      startedAt: Timestamp,
      endedAt: Timestamp,
      durationDays: 5,
      averageMood: 72,
      averageHRV: 62,
      outcome: "positive"
    }
  ],
  
  stateTransitionPatterns: {
    "career_waiting → career_rejection": {
      occurrences: 2,
      avgDuration: 14,
      avgMoodDelta: -25
    },
    "career_waiting → career_success": {
      occurrences: 0  // Not yet experienced
    }
  }
}
```

### 3.4 Beliefs (NEW)

**Path**: `artifacts/{APP_COLLECTION_ID}/users/{uid}/nexus/beliefs`

```javascript
{
  extractedBeliefs: [
    {
      id: "belief_001",
      statement: "I'm okay with my sense of self being tied to external success",
      category: "self_concept",
      extractedFrom: "entry_12042025_1",
      extractedAt: Timestamp,
      confidence: 0.85,
      
      // Behavioral validation
      validation: {
        supportingData: [],
        contradictingData: [
          {
            metric: "mood_career_correlation",
            value: 0.84,
            interpretation: "Mood highly correlated with career outcomes"
          },
          {
            metric: "rejection_mood_delta",
            value: -70,
            interpretation: "Databricks rejection caused 70-point mood drop"
          }
        ],
        dissonanceScore: 0.75,  // 0 = aligned, 1 = fully contradicted
        lastValidated: Timestamp
      }
    },
    {
      id: "belief_002",
      statement: "Rest days make me feel lazy",
      category: "self_judgment",
      extractedFrom: "entry_12262025_1",
      confidence: 0.80,
      
      validation: {
        supportingData: [],
        contradictingData: [
          {
            metric: "rest_day_mood_comparison",
            value: 2,
            interpretation: "Only 2-point mood difference on rest vs workout days"
          }
        ],
        dissonanceScore: 0.65
      }
    }
  ],
  
  // Belief categories for analysis
  beliefClusters: {
    "self_worth": ["belief_001"],
    "productivity": ["belief_002"],
    "relationships": [],
    "health": []
  },
  
  lastUpdated: Timestamp
}
```

### 3.5 Interventions (NEW)

**Path**: `artifacts/{APP_COLLECTION_ID}/users/{uid}/nexus/interventions`

```javascript
{
  // Tracked interventions and their effectiveness
  interventions: {
    "yoga": {
      category: "physical",
      totalOccurrences: 22,
      
      // Effectiveness by context
      effectiveness: {
        global: {
          moodDelta: { mean: +12, stdDev: 8 },
          hrvDelta: { mean: +8, stdDev: 5 },
          nextDayRecovery: { mean: +6, stdDev: 4 },
          score: 0.85
        },
        "during:career_waiting": {
          moodDelta: { mean: +15, stdDev: 6 },
          hrvDelta: { mean: +10, stdDev: 4 },
          score: 0.92  // More effective during stress
        },
        "during:low_mood": {
          moodDelta: { mean: +18, stdDev: 10 },
          score: 0.88
        }
      },
      
      // Optimal conditions
      optimal: {
        timeOfDay: "morning",
        duration: "75min",
        instructor: "Quinn",
        priorSleep: ">7h"
      }
    },
    
    "sterling_walk": {
      category: "relational",
      totalOccurrences: 18,
      
      effectiveness: {
        global: {
          moodDelta: { mean: +5, stdDev: 4 },
          hrvRecovery: { mean: +12, stdDev: 6, unit: "ms within 24h" },
          score: 0.88
        },
        "during:career_waiting": {
          hrvRecovery: { mean: +15, stdDev: 5 },
          score: 0.95  // Highly effective for career stress
        }
      },
      
      optimal: {
        duration: ">30min",
        location: "golden_gate_park"
      }
    },
    
    "spencer_time": {
      category: "relational",
      totalOccurrences: 45,
      
      effectiveness: {
        global: {
          moodFloor: 50,  // Prevents mood from dropping below this
          moodDelta: { mean: +6, stdDev: 8 },
          score: 0.82
        },
        "during:low_mood": {
          moodDelta: { mean: +15, stdDev: 10 },
          score: 0.90
        }
      },
      
      notes: "Functions as emotional stabilizer rather than mood booster"
    },
    
    "acts_of_service": {
      category: "behavioral",
      totalOccurrences: 8,
      
      effectiveness: {
        "during:low_mood": {
          moodDelta: { mean: +35, stdDev: 12 },
          recoveryTime: { mean: 48, unit: "hours" },
          score: 0.94
        }
      },
      
      notes: "Unconscious coping mechanism - restores agency during helplessness"
    }
  },
  
  // Recommended interventions by state
  recommendedByState: {
    "career_waiting": ["sterling_walk", "yoga", "spencer_time"],
    "low_mood": ["acts_of_service", "yoga", "spencer_time"],
    "high_strain": ["yoga", "rest_day"],
    "low_recovery": ["sleep_prioritization", "sterling_walk"]
  },
  
  lastUpdated: Timestamp
}
```

### 3.6 Generated Insights (NEW)

**Path**: `artifacts/{APP_COLLECTION_ID}/users/{uid}/nexus/insights`

```javascript
{
  // Currently active insights (shown on dashboard)
  active: [
    {
      id: "insight_20260113_001",
      generatedAt: Timestamp,
      expiresAt: Timestamp,  // When to regenerate
      
      type: "causal_synthesis",  // causal_synthesis | belief_dissonance | narrative_arc | intervention
      priority: 1,  // 1 = primary, 2 = secondary, 3 = tertiary
      
      // The insight content
      title: "The Sterling Stabilization Loop",
      insight: "While you describe yourself as being 'patient' regarding the Anthropic feedback...",
      
      // Evidence structure
      evidence: {
        narrative: [
          { source: "entry_01132026_1", quote: "patient regarding Anthropic", sentiment: 0.65 }
        ],
        biometric: [
          { metric: "rhr_trend", value: "+4bpm", context: "during waiting periods" },
          { metric: "hrv_recovery", value: "+12ms", context: "after Sterling entries" }
        ],
        statistical: {
          correlation: 0.78,
          sampleSize: 18,
          confidence: 0.85
        }
      },
      
      // The synthesized mechanism
      mechanism: "Caring for Sterling activates parasympathetic response, counteracting career-induced sympathetic arousal",
      
      // Actionable recommendation
      recommendation: {
        action: "Prioritize Sterling's long walk this evening",
        reasoning: "You're in a waiting period with elevated RHR. Sterling walks are your most effective physical off-switch.",
        timing: "Before 7pm for optimal HRV recovery",
        expectedOutcome: "12ms HRV improvement within 24 hours",
        confidence: 0.85
      },
      
      // Metadata
      layers: [1, 2, 3, 4],  // Which layers contributed
      threadIds: ["anthropic-opportunity-1704067200"],
      stateContext: "career_waiting"
    }
  ],
  
  // Historical insights (for learning what resonates)
  history: [
    {
      id: "insight_20260110_001",
      type: "causal_synthesis",
      shownAt: Timestamp,
      
      // User engagement
      engagement: {
        viewed: true,
        viewDuration: 45,  // seconds
        expandedDetails: true,
        followedRecommendation: true,
        journaledAbout: false,
        dismissed: false,
        thumbsUp: true,
        thumbsDown: false
      },
      
      // Outcome tracking
      outcome: {
        recommendationFollowed: true,
        moodDeltaAfter24h: +15,
        hrvDeltaAfter24h: +10,
        effectivenessValidated: true
      }
    }
  ],
  
  // Insight generation metadata
  generation: {
    lastFullGeneration: Timestamp,
    lastIncrementalUpdate: Timestamp,
    nextScheduledGeneration: Timestamp,
    generationTrigger: "new_entry",  // new_entry | scheduled | manual | whoop_sync
    
    // Cost tracking
    llmCallsToday: 3,
    llmCostToday: 0.08,
    llmCallsThisMonth: 45,
    llmCostThisMonth: 1.20
  }
}
```

### 3.7 User Settings (NEW)

**Path**: `artifacts/{APP_COLLECTION_ID}/users/{uid}/settings/nexus`

```javascript
{
  // Feature toggles
  features: {
    beliefDissonanceInsights: {
      enabled: true,  // Default ON per requirements
      lastToggled: Timestamp
    },
    interventionRecommendations: {
      enabled: true
    },
    narrativeArcTracking: {
      enabled: true
    },
    counterfactualInsights: {
      enabled: true
    }
  },
  
  // Insight preferences
  preferences: {
    insightDepth: "comprehensive",  // minimal | balanced | comprehensive
    recommendationStyle: "specific",  // general | specific
    challengeFrequency: "moderate",  // rare | moderate | frequent
    moodGateThreshold: 50  // Don't show challenges below this mood
  },
  
  // Notification settings
  notifications: {
    dailyInsightSummary: true,
    interventionReminders: true,
    milestoneAlerts: true
  },
  
  updatedAt: Timestamp
}
```

---

## Part 4: Layer 1 — Pattern Detection

### 4.1 Core Pattern Detector

**File**: `src/services/nexus/layer1/patternDetector.js`

```javascript
/**
 * Pattern Detector
 * 
 * Identifies correlations between narrative content and biometric data.
 * This is the foundation layer that feeds into temporal and causal analysis.
 */

import { getActiveThreads } from './threadManager';
import { extractSomaticSignals } from './somaticExtractor';
import { getWhoopDataForPeriod } from '../../health/whoop';

// ============================================================
// PATTERN DEFINITIONS
// ============================================================

/**
 * Core narrative patterns to detect
 * These are expanded from the original 8 to cover more nuanced patterns
 */
export const NARRATIVE_PATTERNS = {
  // Career & Work
  CAREER_ANTICIPATION: {
    id: 'career_anticipation',
    triggers: ['interview', 'offer', 'application', 'recruiter', 'hiring'],
    category: 'career',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed' }
  },
  CAREER_WAITING: {
    id: 'career_waiting',
    triggers: ['waiting', 'haven\'t heard', 'no response', 'following up'],
    category: 'career',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed', strain: 'normal' }
  },
  CAREER_OUTCOME_POSITIVE: {
    id: 'career_outcome_positive',
    triggers: ['got the job', 'offer accepted', 'moving forward', 'next round'],
    category: 'career',
    biometricSignature: { mood: 'elevated', hrv: 'improved' }
  },
  CAREER_OUTCOME_NEGATIVE: {
    id: 'career_outcome_negative',
    triggers: ['rejected', 'didn\'t get', 'passed on', 'not moving forward'],
    category: 'career',
    biometricSignature: { mood: 'depressed', rhr: 'elevated', sleep: 'disrupted' }
  },
  
  // Relationships
  RELATIONSHIP_CONNECTION: {
    id: 'relationship_connection',
    triggers: ['spencer', 'together', 'cuddled', 'talked', 'connected'],
    category: 'relationship',
    biometricSignature: { hrv: 'improved', mood: 'stabilized' }
  },
  RELATIONSHIP_STRAIN: {
    id: 'relationship_strain',
    triggers: ['argued', 'frustrated with', 'annoyed', 'tension between'],
    category: 'relationship',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed', mood: 'volatile' }
  },
  CAREGIVING_STRESS: {
    id: 'caregiving_stress',
    triggers: ['kobe', 'psychosis', 'worried about', 'checking on'],
    category: 'relationship',
    biometricSignature: { rhr: 'elevated', mood: 'anxious' }
  },
  
  // Physical Activity
  EXERCISE_COMPLETION: {
    id: 'exercise_completion',
    triggers: ['workout', 'barrys', 'yoga', 'pilates', 'gym', 'lifted'],
    category: 'health',
    biometricSignature: { strain: 'elevated', nextDayRecovery: 'variable' }
  },
  EXERCISE_AVOIDANCE: {
    id: 'exercise_avoidance',
    triggers: ['skipped', 'didn\'t go', 'too tired', 'took a rest'],
    category: 'health',
    biometricSignature: { strain: 'low', mood: 'variable' }
  },
  
  // Somatic Signals
  PHYSICAL_DISCOMFORT: {
    id: 'physical_discomfort',
    triggers: ['pain', 'sore', 'hurt', 'ache', 'tight', 'injury'],
    category: 'somatic',
    biometricSignature: { strain: 'elevated', sleep: 'disrupted' }
  },
  FATIGUE: {
    id: 'fatigue',
    triggers: ['tired', 'exhausted', 'drained', 'no energy', 'groggy'],
    category: 'somatic',
    biometricSignature: { recovery: 'low', hrv: 'depressed' }
  },
  
  // Emotional States
  ANXIETY_SIGNAL: {
    id: 'anxiety_signal',
    triggers: ['anxious', 'worried', 'nervous', 'stressed', 'overwhelmed'],
    category: 'emotional',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed', sleep: 'disrupted' }
  },
  POSITIVE_MOMENTUM: {
    id: 'positive_momentum',
    triggers: ['happy', 'excited', 'great', 'amazing', 'fantastic', 'proud'],
    category: 'emotional',
    biometricSignature: { hrv: 'improved', recovery: 'elevated' }
  },
  
  // Stabilizers
  PET_INTERACTION: {
    id: 'pet_interaction',
    triggers: ['sterling', 'luna', 'walked', 'dog', 'grooming'],
    category: 'stabilizer',
    biometricSignature: { hrv: 'recovery', mood: 'stabilized' }
  },
  CREATIVE_ACTIVITY: {
    id: 'creative_activity',
    triggers: ['painting', 'built', 'created', 'working on', 'echovault'],
    category: 'stabilizer',
    biometricSignature: { mood: 'improved', hrv: 'stable' }
  },
  SOCIAL_CONNECTION: {
    id: 'social_connection',
    triggers: ['dinner with', 'hung out', 'met up', 'friends', 'called'],
    category: 'stabilizer',
    biometricSignature: { mood: 'improved', hrv: 'improved' }
  }
};

// ============================================================
// DETECTION FUNCTIONS
// ============================================================

/**
 * Detect patterns in a single entry
 * @param {Object} entry - Journal entry
 * @param {Object} whoopData - Same-day Whoop data
 * @returns {Array} Detected patterns with confidence scores
 */
export const detectPatternsInEntry = (entry, whoopData) => {
  const text = (entry.content || entry.text || '').toLowerCase();
  const detectedPatterns = [];
  
  for (const [key, pattern] of Object.entries(NARRATIVE_PATTERNS)) {
    const matches = pattern.triggers.filter(trigger => 
      text.includes(trigger.toLowerCase())
    );
    
    if (matches.length > 0) {
      detectedPatterns.push({
        patternId: pattern.id,
        category: pattern.category,
        triggers: matches,
        confidence: Math.min(0.5 + (matches.length * 0.15), 0.95),
        entryId: entry.id,
        entryDate: entry.date,
        mood: entry.analysis?.mood_score || entry.mood,
        whoopData: whoopData ? {
          rhr: whoopData.heartRate?.resting,
          hrv: whoopData.hrv?.average,
          strain: whoopData.strain?.score,
          recovery: whoopData.recovery?.score,
          sleep: whoopData.sleep?.totalHours
        } : null
      });
    }
  }
  
  return detectedPatterns;
};

/**
 * Detect patterns across a time period
 * @param {string} userId
 * @param {Array} entries - Journal entries
 * @param {Object} whoopHistory - Whoop data keyed by date
 * @returns {Object} Pattern analysis results
 */
export const detectPatternsInPeriod = async (userId, entries, whoopHistory) => {
  const allPatterns = [];
  
  for (const entry of entries) {
    const entryDate = entry.date || entry.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
    const whoopData = whoopHistory?.[entryDate] || null;
    
    const patterns = detectPatternsInEntry(entry, whoopData);
    allPatterns.push(...patterns);
  }
  
  // Aggregate patterns
  const patternCounts = {};
  const patternMoods = {};
  const patternBiometrics = {};
  
  for (const pattern of allPatterns) {
    const id = pattern.patternId;
    
    if (!patternCounts[id]) {
      patternCounts[id] = 0;
      patternMoods[id] = [];
      patternBiometrics[id] = [];
    }
    
    patternCounts[id]++;
    if (pattern.mood) patternMoods[id].push(pattern.mood);
    if (pattern.whoopData) patternBiometrics[id].push(pattern.whoopData);
  }
  
  // Calculate aggregates
  const patternAnalysis = {};
  
  for (const [id, count] of Object.entries(patternCounts)) {
    const moods = patternMoods[id];
    const biometrics = patternBiometrics[id];
    
    patternAnalysis[id] = {
      patternId: id,
      category: NARRATIVE_PATTERNS[id.toUpperCase()]?.category,
      occurrences: count,
      mood: {
        mean: moods.length > 0 ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
        min: moods.length > 0 ? Math.min(...moods) : null,
        max: moods.length > 0 ? Math.max(...moods) : null
      },
      biometrics: biometrics.length > 0 ? {
        avgRHR: average(biometrics.map(b => b.rhr).filter(Boolean)),
        avgHRV: average(biometrics.map(b => b.hrv).filter(Boolean)),
        avgStrain: average(biometrics.map(b => b.strain).filter(Boolean)),
        avgRecovery: average(biometrics.map(b => b.recovery).filter(Boolean))
      } : null
    };
  }
  
  return {
    rawPatterns: allPatterns,
    aggregated: patternAnalysis,
    totalEntries: entries.length,
    totalPatternsDetected: allPatterns.length
  };
};

/**
 * Calculate correlation between pattern and biometric
 * @param {Array} dataPoints - Array of {patternPresent, biometricValue}
 * @returns {number} Pearson correlation coefficient
 */
export const calculateCorrelation = (dataPoints) => {
  if (dataPoints.length < 5) return null;
  
  const n = dataPoints.length;
  const sumX = dataPoints.reduce((sum, d) => sum + (d.patternPresent ? 1 : 0), 0);
  const sumY = dataPoints.reduce((sum, d) => sum + d.biometricValue, 0);
  const sumXY = dataPoints.reduce((sum, d) => sum + (d.patternPresent ? 1 : 0) * d.biometricValue, 0);
  const sumX2 = sumX;  // Since X is binary
  const sumY2 = dataPoints.reduce((sum, d) => sum + d.biometricValue ** 2, 0);
  
  const numerator = (n * sumXY) - (sumX * sumY);
  const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  
  if (denominator === 0) return 0;
  return numerator / denominator;
};

// Utility
const average = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
```

### 4.2 Somatic Signal Extractor

**File**: `src/services/nexus/layer1/somaticExtractor.js`

```javascript
/**
 * Somatic Signal Extractor
 * 
 * Identifies body-related signals in journal entries.
 * Maintains a taxonomy of physical manifestations of emotional states.
 */

// ============================================================
// SOMATIC TAXONOMY
// ============================================================

export const SOMATIC_TAXONOMY = {
  PAIN: {
    id: 'pain',
    category: 'physical',
    triggers: [
      'pain', 'hurt', 'sore', 'ache', 'aching',
      'sharp', 'throbbing', 'stabbing'
    ],
    bodyParts: [
      'knee', 'back', 'lower back', 'shoulder', 'neck',
      'head', 'headache', 'migraine', 'stomach', 'chest'
    ],
    severity: {
      mild: ['slight', 'little', 'minor', 'bit of'],
      moderate: ['noticeable', 'uncomfortable', 'bothering'],
      severe: ['terrible', 'awful', 'excruciating', 'unbearable']
    }
  },
  
  TENSION: {
    id: 'tension',
    category: 'physical',
    triggers: [
      'tense', 'tight', 'tension', 'clenched', 'stiff',
      'holding', 'gripping', 'locked up'
    ],
    associations: ['stress', 'anxiety', 'worry', 'work'],
    releaseActivities: ['yoga', 'stretch', 'massage', 'bath']
  },
  
  FATIGUE: {
    id: 'fatigue',
    category: 'energy',
    triggers: [
      'tired', 'exhausted', 'drained', 'fatigued', 'wiped',
      'no energy', 'low energy', 'sluggish', 'lethargic',
      'groggy', 'sleepy', 'drowsy'
    ],
    temporalPatterns: {
      morning: ['woke up tired', 'didn\'t sleep well'],
      afternoon: ['afternoon slump', 'crash'],
      evening: ['worn out', 'beat']
    }
  },
  
  RESPIRATORY: {
    id: 'respiratory',
    category: 'physical',
    triggers: [
      'breath', 'breathing', 'cough', 'congested', 'stuffy',
      'runny nose', 'sinus', 'chest tight', 'hard to breathe'
    ],
    illnessIndicators: ['cold', 'flu', 'sick', 'covid', 'allergies']
  },
  
  DIGESTIVE: {
    id: 'digestive',
    category: 'physical',
    triggers: [
      'stomach', 'nausea', 'nauseous', 'bloated', 'bloating',
      'gas', 'indigestion', 'heartburn', 'appetite'
    ],
    stressIndicators: ['nervous stomach', 'butterflies', 'queasy']
  },
  
  COGNITIVE: {
    id: 'cognitive',
    category: 'mental',
    triggers: [
      'brain fog', 'foggy', 'can\'t focus', 'distracted',
      'scattered', 'fuzzy', 'unclear', 'hard to think',
      'concentration', 'focus issues'
    ],
    associations: ['sleep', 'stress', 'add', 'medication']
  },
  
  SLEEP_DISTURBANCE: {
    id: 'sleep_disturbance',
    category: 'sleep',
    triggers: [
      'couldn\'t sleep', 'insomnia', 'woke up', 'restless',
      'tossing and turning', 'racing thoughts', 'nightmares',
      'sleep issues'
    ],
    qualityIndicators: {
      poor: ['terrible sleep', 'awful night', 'barely slept'],
      disrupted: ['woke up multiple times', 'light sleep'],
      good: ['slept well', 'great sleep', 'solid night']
    }
  },
  
  CARDIOVASCULAR: {
    id: 'cardiovascular',
    category: 'physical',
    triggers: [
      'heart racing', 'pounding', 'palpitations', 'pulse',
      'heart rate', 'chest', 'dizzy', 'lightheaded'
    ],
    anxietyIndicators: ['panic', 'anxiety attack', 'nervous']
  }
};

// ============================================================
// EXTRACTION FUNCTIONS
// ============================================================

/**
 * Extract somatic signals from entry text
 * @param {string} text - Entry content
 * @returns {Array} Extracted somatic signals with metadata
 */
export const extractSomaticSignals = (text) => {
  const normalizedText = text.toLowerCase();
  const signals = [];
  
  for (const [key, signal] of Object.entries(SOMATIC_TAXONOMY)) {
    // Check for trigger words
    const matchedTriggers = signal.triggers.filter(trigger =>
      normalizedText.includes(trigger)
    );
    
    if (matchedTriggers.length > 0) {
      const signalData = {
        signalId: signal.id,
        category: signal.category,
        triggers: matchedTriggers,
        confidence: Math.min(0.5 + (matchedTriggers.length * 0.2), 0.95)
      };
      
      // Extract body part if applicable
      if (signal.bodyParts) {
        const matchedBodyParts = signal.bodyParts.filter(part =>
          normalizedText.includes(part)
        );
        if (matchedBodyParts.length > 0) {
          signalData.bodyParts = matchedBodyParts;
          signalData.confidence = Math.min(signalData.confidence + 0.1, 0.98);
        }
      }
      
      // Extract severity if applicable
      if (signal.severity) {
        for (const [level, indicators] of Object.entries(signal.severity)) {
          if (indicators.some(ind => normalizedText.includes(ind))) {
            signalData.severity = level;
            break;
          }
        }
      }
      
      signals.push(signalData);
    }
  }
  
  return signals;
};

/**
 * Analyze somatic patterns over time
 * @param {Array} entries - Journal entries with extracted somatic signals
 * @returns {Object} Somatic pattern analysis
 */
export const analyzeSomaticPatterns = (entries) => {
  const signalHistory = {};
  const temporalPatterns = {};
  
  for (const entry of entries) {
    const signals = entry.somaticSignals || extractSomaticSignals(entry.content || entry.text || '');
    const date = entry.date || entry.createdAt?.toDate?.();
    const dayOfWeek = date ? new Date(date).getDay() : null;
    
    for (const signal of signals) {
      const id = signal.signalId;
      
      if (!signalHistory[id]) {
        signalHistory[id] = {
          occurrences: 0,
          dates: [],
          associatedMoods: [],
          bodyParts: {},
          severityDistribution: { mild: 0, moderate: 0, severe: 0 }
        };
      }
      
      signalHistory[id].occurrences++;
      signalHistory[id].dates.push(date);
      
      if (entry.mood) {
        signalHistory[id].associatedMoods.push(entry.mood);
      }
      
      if (signal.bodyParts) {
        for (const part of signal.bodyParts) {
          signalHistory[id].bodyParts[part] = (signalHistory[id].bodyParts[part] || 0) + 1;
        }
      }
      
      if (signal.severity) {
        signalHistory[id].severityDistribution[signal.severity]++;
      }
      
      // Track day-of-week patterns
      if (dayOfWeek !== null) {
        if (!temporalPatterns[id]) temporalPatterns[id] = Array(7).fill(0);
        temporalPatterns[id][dayOfWeek]++;
      }
    }
  }
  
  // Calculate statistics
  const analysis = {};
  
  for (const [id, history] of Object.entries(signalHistory)) {
    const moods = history.associatedMoods;
    
    analysis[id] = {
      signalId: id,
      totalOccurrences: history.occurrences,
      frequencyPerWeek: history.occurrences / (entries.length / 7),
      
      moodCorrelation: {
        mean: moods.length > 0 ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
        moodDeltaFromBaseline: null  // Calculated with baseline data
      },
      
      bodyPartDistribution: history.bodyParts,
      mostCommonBodyPart: Object.entries(history.bodyParts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || null,
      
      severityDistribution: history.severityDistribution,
      
      temporalPattern: temporalPatterns[id] ? {
        byDayOfWeek: temporalPatterns[id],
        peakDay: temporalPatterns[id].indexOf(Math.max(...temporalPatterns[id]))
      } : null
    };
  }
  
  return analysis;
};

/**
 * Detect somatic-emotional clusters
 * @param {Array} entries - Entries with mood and somatic data
 * @returns {Array} Identified clusters
 */
export const detectSomaticEmotionalClusters = (entries) => {
  const clusters = [];
  
  // Look for patterns where somatic signals co-occur with emotional states
  const emotionalSomaticPairs = {};
  
  for (const entry of entries) {
    const signals = entry.somaticSignals || [];
    const mood = entry.mood || entry.analysis?.mood_score;
    const text = (entry.content || entry.text || '').toLowerCase();
    
    // Detect emotional context
    const emotionalContext = [];
    if (text.match(/anxious|worried|nervous|stressed/)) emotionalContext.push('anxiety');
    if (text.match(/sad|down|depressed|low/)) emotionalContext.push('sadness');
    if (text.match(/angry|frustrated|irritated|annoyed/)) emotionalContext.push('anger');
    if (text.match(/happy|excited|great|amazing/)) emotionalContext.push('positive');
    
    for (const signal of signals) {
      for (const emotion of emotionalContext) {
        const pairKey = `${emotion}_${signal.signalId}`;
        if (!emotionalSomaticPairs[pairKey]) {
          emotionalSomaticPairs[pairKey] = {
            emotion,
            somaticSignal: signal.signalId,
            occurrences: 0,
            moods: []
          };
        }
        emotionalSomaticPairs[pairKey].occurrences++;
        if (mood) emotionalSomaticPairs[pairKey].moods.push(mood);
      }
    }
  }
  
  // Identify significant clusters
  for (const [key, pair] of Object.entries(emotionalSomaticPairs)) {
    if (pair.occurrences >= 3) {  // Minimum threshold
      clusters.push({
        cluster: key,
        emotion: pair.emotion,
        somaticSignal: pair.somaticSignal,
        occurrences: pair.occurrences,
        averageMood: pair.moods.length > 0 
          ? pair.moods.reduce((a, b) => a + b, 0) / pair.moods.length 
          : null,
        interpretation: `${pair.emotion} tends to manifest as ${pair.somaticSignal} in your body`
      });
    }
  }
  
  return clusters.sort((a, b) => b.occurrences - a.occurrences);
};
```

### 4.3 Thread Manager (Enhanced)

**File**: `src/services/nexus/layer1/threadManager.js`

```javascript
/**
 * Thread Manager
 * 
 * Manages semantic threads with full metamorphosis support.
 * Threads track ongoing storylines across entries with evolution tracking.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  arrayUnion
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { callGemini } from '../../ai/gemini';
import { generateEmbedding, cosineSimilarity } from '../../ai/embeddings';

// ============================================================
// CONSTANTS
// ============================================================

const THREAD_CATEGORIES = [
  'career', 'health', 'relationship', 'growth', 'somatic',
  'financial', 'housing', 'creative', 'social'
];

const SEMANTIC_SIMILARITY_THRESHOLD = 0.75;
const EVOLUTION_SIMILARITY_THRESHOLD = 0.50;  // Lower threshold for detecting pivots
const MIN_CONTENT_LENGTH = 50;
const MAX_ACTIVE_THREADS = 10;

// ============================================================
// THREAD RETRIEVAL
// ============================================================

/**
 * Get all active threads for a user
 */
export const getActiveThreads = async (userId) => {
  if (!userId) return [];
  
  try {
    const threadsRef = collection(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads'
    );
    
    const q = query(
      threadsRef,
      where('status', 'in', ['active', 'evolved']),
      orderBy('lastUpdated', 'desc'),
      limit(MAX_ACTIVE_THREADS)
    );
    
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('[ThreadManager] Failed to get threads:', error);
    return [];
  }
};

/**
 * Get thread by ID
 */
export const getThread = async (userId, threadId) => {
  if (!userId || !threadId) return null;
  
  try {
    const threadRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId
    );
    const threadDoc = await getDoc(threadRef);
    
    if (!threadDoc.exists()) return null;
    return { id: threadDoc.id, ...threadDoc.data() };
  } catch (error) {
    console.error('[ThreadManager] Failed to get thread:', error);
    return null;
  }
};

/**
 * Get full thread lineage (root to current)
 */
export const getThreadLineage = async (userId, threadId) => {
  const thread = await getThread(userId, threadId);
  if (!thread) return [];
  
  const lineage = [thread];
  
  // Walk backward to root
  let currentId = thread.predecessorId;
  while (currentId) {
    const predecessor = await getThread(userId, currentId);
    if (!predecessor) break;
    lineage.unshift(predecessor);
    currentId = predecessor.predecessorId;
  }
  
  return lineage;
};

/**
 * Get thread descendants (current to latest)
 */
export const getThreadDescendants = async (userId, threadId) => {
  const thread = await getThread(userId, threadId);
  if (!thread) return [];
  
  const descendants = [thread];
  
  let currentId = thread.successorId;
  while (currentId) {
    const successor = await getThread(userId, currentId);
    if (!successor) break;
    descendants.push(successor);
    currentId = successor.successorId;
  }
  
  return descendants;
};

// ============================================================
// SIMILARITY & MATCHING
// ============================================================

const normalizeThreadName = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const calculateNameSimilarity = (name1, name2) => {
  const n1 = normalizeThreadName(name1);
  const n2 = normalizeThreadName(name2);
  
  // Levenshtein distance
  const matrix = [];
  for (let i = 0; i <= n2.length; i++) matrix[i] = [i];
  for (let j = 0; j <= n1.length; j++) matrix[0][j] = j;
  
  for (let i = 1; i <= n2.length; i++) {
    for (let j = 1; j <= n1.length; j++) {
      if (n2.charAt(i - 1) === n1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return 1;
  return 1 - (matrix[n2.length][n1.length] / maxLen);
};

/**
 * Find similar thread using semantic matching
 */
export const findSimilarThread = async (proposedName, activeThreads, embedding = null) => {
  if (!activeThreads?.length) return null;
  
  // 1. Try semantic embedding match (primary)
  if (embedding) {
    for (const thread of activeThreads) {
      if (thread.embedding) {
        const similarity = cosineSimilarity(embedding, thread.embedding);
        if (similarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
          console.log(`[ThreadManager] Semantic match: "${proposedName}" → "${thread.displayName}" (${(similarity * 100).toFixed(1)}%)`);
          return { thread, matchType: 'semantic', similarity };
        }
      }
    }
  }
  
  // 2. Try name similarity for exact matches
  for (const thread of activeThreads) {
    const similarity = calculateNameSimilarity(proposedName, thread.displayName);
    if (similarity >= 0.95) {
      console.log(`[ThreadManager] Name match: "${proposedName}" → "${thread.displayName}"`);
      return { thread, matchType: 'exact', similarity };
    }
  }
  
  return null;
};

/**
 * Find potential evolution candidates
 * These are threads with same life domain but different specific topics
 */
export const findEvolutionCandidates = async (proposedName, category, activeThreads, embedding = null) => {
  const candidates = [];
  
  // Filter to same category
  const sameCategoryThreads = activeThreads.filter(t => t.category === category);
  
  for (const thread of sameCategoryThreads) {
    let similarity = 0;
    
    if (embedding && thread.embedding) {
      similarity = cosineSimilarity(embedding, thread.embedding);
    }
    
    // Threads in same category with moderate similarity are evolution candidates
    if (similarity >= EVOLUTION_SIMILARITY_THRESHOLD && similarity < SEMANTIC_SIMILARITY_THRESHOLD) {
      candidates.push({
        thread,
        similarity,
        potentialEvolution: true
      });
    }
  }
  
  return candidates.sort((a, b) => b.similarity - a.similarity);
};

// ============================================================
// THREAD CREATION & UPDATES
// ============================================================

const generateThreadId = (name) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `${slug}-${Date.now()}`;
};

/**
 * Create a new thread
 */
export const createThread = async (userId, threadData) => {
  const {
    displayName,
    category,
    sentiment,
    somaticSignals = [],
    entryId,
    rootThreadId = null,
    predecessorId = null,
    evolutionType = null,
    evolutionContext = null
  } = threadData;
  
  const threadId = generateThreadId(displayName);
  const now = Timestamp.now();
  
  // Generate embedding
  let embedding = null;
  try {
    embedding = await generateEmbedding(displayName);
  } catch (error) {
    console.warn('[ThreadManager] Embedding generation failed:', error);
  }
  
  const thread = {
    id: threadId,
    displayName,
    category: THREAD_CATEGORIES.includes(category) ? category : 'growth',
    status: 'active',
    
    // Metamorphosis tracking
    rootThreadId: rootThreadId || threadId,  // Self-reference if new root
    predecessorId,
    successorId: null,
    evolutionType,
    evolutionContext,
    
    // Sentiment tracking
    sentimentBaseline: sentiment || 0.5,
    sentimentHistory: sentiment ? [sentiment] : [],
    sentimentTrajectory: 'stable',
    
    // Emotional arc
    emotionalArc: [{
      date: now.toDate().toISOString().split('T')[0],
      sentiment: sentiment || 0.5,
      event: 'Thread created'
    }],
    
    // Somatic signals
    somaticSignals: somaticSignals.filter(s => 
      Object.values(require('./somaticExtractor').SOMATIC_TAXONOMY)
        .map(t => t.id)
        .includes(s)
    ),
    somaticFrequency: {},
    
    // Entry references
    entryIds: entryId ? [entryId] : [],
    entryCount: entryId ? 1 : 0,
    
    // Embedding
    embedding,
    
    // Timestamps
    createdAt: now,
    lastUpdated: now,
    lastEntryAt: now,
    resolvedAt: null
  };
  
  // Initialize somatic frequency
  for (const signal of thread.somaticSignals) {
    thread.somaticFrequency[signal] = 1;
  }
  
  const threadRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId
  );
  await setDoc(threadRef, thread);
  
  // If this is an evolution, update predecessor
  if (predecessorId) {
    await updateDoc(
      doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', predecessorId),
      {
        successorId: threadId,
        status: 'evolved',
        lastUpdated: now
      }
    );
  }
  
  console.log(`[ThreadManager] Created thread: ${displayName} (${threadId})`);
  return thread;
};

/**
 * Append entry to existing thread
 */
export const appendToThread = async (userId, threadId, updateData) => {
  const { entryId, sentiment, somaticSignals = [], event = null } = updateData;
  
  const threadRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId
  );
  const threadDoc = await getDoc(threadRef);
  
  if (!threadDoc.exists()) {
    throw new Error(`Thread ${threadId} not found`);
  }
  
  const thread = threadDoc.data();
  const now = Timestamp.now();
  
  // Update sentiment history
  let newSentimentHistory = [...(thread.sentimentHistory || [])];
  if (sentiment !== undefined) {
    newSentimentHistory.push(sentiment);
    if (newSentimentHistory.length > 10) {
      newSentimentHistory = newSentimentHistory.slice(-10);
    }
  }
  
  // Calculate new baseline and trajectory
  const newBaseline = newSentimentHistory.length > 0
    ? newSentimentHistory.reduce((a, b) => a + b, 0) / newSentimentHistory.length
    : thread.sentimentBaseline;
  
  const trajectory = calculateTrajectory(newSentimentHistory);
  
  // Update emotional arc
  const newArc = [...(thread.emotionalArc || [])];
  if (sentiment !== undefined) {
    newArc.push({
      date: now.toDate().toISOString().split('T')[0],
      sentiment,
      event: event || 'Entry added'
    });
  }
  
  // Update somatic frequency
  const newSomaticFrequency = { ...(thread.somaticFrequency || {}) };
  const existingSomatics = new Set(thread.somaticSignals || []);
  
  for (const signal of somaticSignals) {
    existingSomatics.add(signal);
    newSomaticFrequency[signal] = (newSomaticFrequency[signal] || 0) + 1;
  }
  
  await updateDoc(threadRef, {
    entryIds: arrayUnion(entryId),
    entryCount: (thread.entryCount || 0) + 1,
    sentimentHistory: newSentimentHistory,
    sentimentBaseline: newBaseline,
    sentimentTrajectory: trajectory,
    emotionalArc: newArc,
    somaticSignals: Array.from(existingSomatics),
    somaticFrequency: newSomaticFrequency,
    lastUpdated: now,
    lastEntryAt: now
  });
  
  console.log(`[ThreadManager] Appended to thread: ${thread.displayName}`);
};

/**
 * Resolve (close) a thread
 */
export const resolveThread = async (userId, threadId, resolution = null) => {
  const now = Timestamp.now();
  
  const threadRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId
  );
  
  await updateDoc(threadRef, {
    status: 'resolved',
    resolution,
    resolvedAt: now,
    lastUpdated: now
  });
  
  console.log(`[ThreadManager] Resolved thread: ${threadId}`);
};

/**
 * Calculate sentiment trajectory
 */
const calculateTrajectory = (history) => {
  if (history.length < 3) return 'stable';
  
  const recent = history.slice(-3);
  const earlier = history.slice(-6, -3);
  
  if (earlier.length === 0) return 'stable';
  
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  const delta = recentAvg - earlierAvg;
  
  // Calculate variance
  const variance = recent.reduce((sum, val) => sum + Math.pow(val - recentAvg, 2), 0) / recent.length;
  
  if (variance > 400) return 'volatile';  // High variance
  if (delta > 10) return 'improving';
  if (delta < -10) return 'declining';
  return 'stable';
};

// ============================================================
// LLM THREAD IDENTIFICATION
// ============================================================

/**
 * Build prompt for thread identification with evolution support
 */
const buildThreadIdentificationPrompt = (entryText, activeThreads, archivedThreads = []) => {
  const activeList = activeThreads.length > 0
    ? activeThreads.map(t => `- "${t.displayName}" (${t.category}, sentiment: ${(t.sentimentBaseline * 100).toFixed(0)}%)`).join('\n')
    : 'No active threads.';
  
  const archivedList = archivedThreads.length > 0
    ? archivedThreads.slice(0, 3).map(t => `- "${t.displayName}" (${t.category}, ${t.status})`).join('\n')
    : 'No recent archived threads.';
  
  return `You are analyzing a journal entry to identify thematic connections and potential story evolution.

ACTIVE THREADS:
${activeList}

RECENTLY ARCHIVED/EVOLVED THREADS:
${archivedList}

JOURNAL ENTRY:
"${entryText.slice(0, 2000)}"

TASK:
1. Determine if this entry:
   a) Continues an existing active thread (same topic)
   b) Represents a METAMORPHOSIS (new topic in same life domain - e.g., "Databricks" evolving to "Anthropic")
   c) Starts a genuinely new thread (new life domain)
2. Extract somatic (body) signals
3. Estimate emotional sentiment (0-1)
4. If metamorphosis: identify the predecessor thread and explain the evolution

SOMATIC SIGNALS (only use these):
- pain, tension, fatigue, respiratory, digestive, cognitive, sleep_disturbance, cardiovascular

RESPONSE FORMAT (JSON only, no markdown):
{
  "thread": {
    "action": "continue" | "metamorphosis" | "new",
    "existingThreadName": "exact name if continuing, null otherwise",
    "proposedName": "short descriptive name if new/metamorphosis",
    "category": "career" | "health" | "relationship" | "growth" | "somatic" | "housing" | "financial" | "creative" | "social",
    "metamorphosis": {
      "predecessorName": "thread this evolved from, if applicable",
      "evolutionType": "pivot" | "continuation" | "resolution",
      "evolutionContext": "brief explanation of the evolution"
    }
  },
  "somaticSignals": ["signal_id"],
  "sentiment": 0.72,
  "confidence": 0.85,
  "arcEvent": "Brief description for emotional arc (e.g., 'Interview scheduled')"
}`;
};

/**
 * Parse LLM response
 */
const parseThreadResponse = (response) => {
  try {
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    
    const parsed = JSON.parse(jsonStr);
    
    if (!parsed.thread?.action) {
      console.warn('[ThreadManager] Invalid response structure');
      return null;
    }
    
    return parsed;
  } catch (error) {
    console.error('[ThreadManager] Parse error:', error);
    return null;
  }
};

/**
 * Main entry point: Identify thread association for an entry
 */
export const identifyThreadAssociation = async (userId, entryId, entryText, sentiment = null) => {
  if (!userId || !entryText || entryText.length < MIN_CONTENT_LENGTH) {
    return { success: false, error: 'Invalid input' };
  }
  
  try {
    // Get active and recent archived threads
    const activeThreads = await getActiveThreads(userId);
    
    // Get recently archived for evolution detection
    const threadsRef = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads');
    const archivedQuery = query(
      threadsRef,
      where('status', 'in', ['resolved', 'evolved', 'archived']),
      orderBy('lastUpdated', 'desc'),
      limit(5)
    );
    const archivedSnapshot = await getDocs(archivedQuery);
    const archivedThreads = archivedSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Call LLM
    const prompt = buildThreadIdentificationPrompt(entryText, activeThreads, archivedThreads);
    let llmResult;
    
    try {
      const response = await callGemini(prompt, '');
      llmResult = parseThreadResponse(response);
    } catch (llmError) {
      console.warn('[ThreadManager] LLM failed:', llmError);
      return fallbackIdentification(userId, entryId, entryText, sentiment);
    }
    
    if (!llmResult) {
      return fallbackIdentification(userId, entryId, entryText, sentiment);
    }
    
    const { thread, somaticSignals, sentiment: llmSentiment, confidence, arcEvent } = llmResult;
    const finalSentiment = sentiment ?? llmSentiment ?? 0.5;
    
    // Handle based on action
    switch (thread.action) {
      case 'continue': {
        const matchedThread = activeThreads.find(
          t => normalizeThreadName(t.displayName) === normalizeThreadName(thread.existingThreadName)
        );
        
        if (matchedThread) {
          await appendToThread(userId, matchedThread.id, {
            entryId,
            sentiment: finalSentiment,
            somaticSignals,
            event: arcEvent
          });
          
          return {
            success: true,
            action: 'appended',
            threadId: matchedThread.id,
            threadName: matchedThread.displayName,
            somaticSignals,
            confidence
          };
        }
        // Fall through to new if match not found
      }
      
      case 'metamorphosis': {
        // Find predecessor
        let predecessorThread = null;
        if (thread.metamorphosis?.predecessorName) {
          predecessorThread = [...activeThreads, ...archivedThreads].find(
            t => normalizeThreadName(t.displayName) === normalizeThreadName(thread.metamorphosis.predecessorName)
          );
        }
        
        const newThread = await createThread(userId, {
          displayName: thread.proposedName,
          category: thread.category,
          sentiment: finalSentiment,
          somaticSignals,
          entryId,
          rootThreadId: predecessorThread?.rootThreadId || predecessorThread?.id,
          predecessorId: predecessorThread?.id,
          evolutionType: thread.metamorphosis?.evolutionType || 'pivot',
          evolutionContext: thread.metamorphosis?.evolutionContext
        });
        
        return {
          success: true,
          action: 'metamorphosis',
          threadId: newThread.id,
          threadName: newThread.displayName,
          predecessorId: predecessorThread?.id,
          predecessorName: predecessorThread?.displayName,
          evolutionContext: thread.metamorphosis?.evolutionContext,
          somaticSignals,
          confidence
        };
      }
      
      case 'new':
      default: {
        // Check for duplicates first
        const proposedName = thread.proposedName || 'Unnamed Thread';
        const embedding = await generateEmbedding(proposedName).catch(() => null);
        const similar = await findSimilarThread(proposedName, activeThreads, embedding);
        
        if (similar) {
          // Deduplicate
          await appendToThread(userId, similar.thread.id, {
            entryId,
            sentiment: finalSentiment,
            somaticSignals,
            event: arcEvent
          });
          
          return {
            success: true,
            action: 'deduplicated',
            threadId: similar.thread.id,
            threadName: similar.thread.displayName,
            originalProposal: proposedName,
            somaticSignals,
            confidence
          };
        }
        
        // Create new thread
        const newThread = await createThread(userId, {
          displayName: proposedName,
          category: thread.category,
          sentiment: finalSentiment,
          somaticSignals,
          entryId
        });
        
        return {
          success: true,
          action: 'created',
          threadId: newThread.id,
          threadName: newThread.displayName,
          somaticSignals,
          confidence
        };
      }
    }
  } catch (error) {
    console.error('[ThreadManager] Identification failed:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fallback identification when LLM unavailable
 */
const fallbackIdentification = async (userId, entryId, entryText, sentiment) => {
  const { extractSomaticSignals } = require('./somaticExtractor');
  const signals = extractSomaticSignals(entryText);
  
  return {
    success: true,
    action: 'fallback',
    threadId: null,
    threadName: null,
    somaticSignals: signals.map(s => s.signalId),
    confidence: 0.3,
    note: 'LLM unavailable - processed with heuristics only'
  };
};
```

---

## Part 5: Layer 2 — Temporal Reasoner

### 5.1 State Detector

**File**: `src/services/nexus/layer2/stateDetector.js`

```javascript
/**
 * State Detector
 * 
 * Identifies the user's current life state based on active threads,
 * recent entries, and biometric patterns.
 */

import { getActiveThreads } from '../layer1/threadManager';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';

// ============================================================
// LIFE STATE DEFINITIONS
// ============================================================

export const LIFE_STATES = {
  // Career States
  CAREER_WAITING: {
    id: 'career_waiting',
    displayName: 'Career Waiting Period',
    description: 'Awaiting response on job applications or interviews',
    triggers: {
      threads: ['career'],
      keywords: ['waiting', 'haven\'t heard', 'following up', 'pending'],
      threadStatus: ['active']
    },
    biometricSignature: {
      rhr: { direction: 'elevated', magnitude: 'moderate' },
      hrv: { direction: 'depressed', magnitude: 'moderate' },
      sleep: { direction: 'disrupted', magnitude: 'mild' }
    },
    typicalDuration: { min: 3, max: 21, unit: 'days' },
    possibleOutcomes: ['career_success', 'career_rejection', 'career_pivot']
  },
  
  CAREER_ACTIVE: {
    id: 'career_active',
    displayName: 'Active Job Search',
    description: 'Actively interviewing or applying for positions',
    triggers: {
      threads: ['career'],
      keywords: ['interview', 'application', 'recruiter', 'applying'],
      activityLevel: 'high'
    },
    biometricSignature: {
      strain: { direction: 'elevated', magnitude: 'moderate' },
      rhr: { direction: 'elevated', magnitude: 'mild' }
    }
  },
  
  CAREER_SUCCESS: {
    id: 'career_success',
    displayName: 'Career Win',
    description: 'Positive career outcome achieved',
    triggers: {
      keywords: ['got the job', 'offer', 'accepted', 'start date']
    },
    biometricSignature: {
      hrv: { direction: 'improved', magnitude: 'significant' },
      mood: { direction: 'elevated', magnitude: 'significant' }
    },
    typicalDuration: { min: 3, max: 14, unit: 'days' }
  },
  
  CAREER_REJECTION: {
    id: 'career_rejection',
    displayName: 'Processing Rejection',
    description: 'Processing a career setback',
    triggers: {
      keywords: ['rejected', 'didn\'t get', 'passed', 'not moving forward']
    },
    biometricSignature: {
      mood: { direction: 'depressed', magnitude: 'significant' },
      rhr: { direction: 'elevated', magnitude: 'moderate' },
      sleep: { direction: 'disrupted', magnitude: 'moderate' }
    },
    typicalDuration: { min: 3, max: 21, unit: 'days' }
  },
  
  // Relationship States
  RELATIONSHIP_GROWTH: {
    id: 'relationship_growth',
    displayName: 'Relationship Growth',
    description: 'Deepening connection with partner',
    triggers: {
      threads: ['relationship'],
      keywords: ['closer', 'connected', 'love', 'future', 'together'],
      sentiment: { min: 0.65 }
    },
    biometricSignature: {
      hrv: { direction: 'improved', magnitude: 'mild' },
      mood: { direction: 'elevated', magnitude: 'moderate' }
    }
  },
  
  RELATIONSHIP_STRAIN: {
    id: 'relationship_strain',
    displayName: 'Relationship Tension',
    description: 'Navigating relationship challenges',
    triggers: {
      threads: ['relationship'],
      keywords: ['argument', 'frustrated', 'annoyed', 'tension', 'worried about us'],
      sentiment: { max: 0.45 }
    },
    biometricSignature: {
      rhr: { direction: 'elevated', magnitude: 'moderate' },
      hrv: { direction: 'depressed', magnitude: 'moderate' },
      sleep: { direction: 'disrupted', magnitude: 'mild' }
    }
  },
  
  // Health States
  RECOVERY_MODE: {
    id: 'recovery_mode',
    displayName: 'Recovery Mode',
    description: 'Recovering from illness, injury, or overexertion',
    triggers: {
      threads: ['health', 'somatic'],
      keywords: ['sick', 'recovering', 'rest', 'injury', 'taking it easy'],
      whoopRecovery: { max: 40 }
    },
    biometricSignature: {
      strain: { direction: 'low', magnitude: 'significant' },
      recovery: { direction: 'improving', magnitude: 'gradual' }
    }
  },
  
  HIGH_PERFORMANCE: {
    id: 'high_performance',
    displayName: 'High Performance',
    description: 'Peak physical and mental state',
    triggers: {
      keywords: ['great workout', 'feeling strong', 'best', 'crushed it'],
      whoopRecovery: { min: 70 },
      mood: { min: 70 }
    },
    biometricSignature: {
      hrv: { direction: 'elevated', magnitude: 'moderate' },
      recovery: { direction: 'high', magnitude: 'stable' }
    }
  },
  
  BURNOUT_RISK: {
    id: 'burnout_risk',
    displayName: 'Burnout Risk',
    description: 'Signs of approaching burnout',
    triggers: {
      keywords: ['overwhelmed', 'exhausted', 'can\'t keep up', 'too much'],
      whoopRecovery: { max: 35, duration: 3 },  // 3+ days
      rhrTrend: { direction: 'elevated', duration: 5 }
    },
    biometricSignature: {
      rhr: { direction: 'elevated', magnitude: 'significant' },
      hrv: { direction: 'depressed', magnitude: 'significant' },
      strain: { direction: 'elevated', magnitude: 'sustained' }
    },
    urgency: 'high'
  },
  
  // General States
  STABLE: {
    id: 'stable',
    displayName: 'Stable',
    description: 'No significant active state detected',
    triggers: {
      default: true
    },
    biometricSignature: {
      all: { direction: 'normal', magnitude: 'within_baseline' }
    }
  }
};

// ============================================================
// STATE DETECTION
// ============================================================

/**
 * Detect current life state(s) based on multiple signals
 */
export const detectCurrentState = async (userId, entries, whoopData, threads) => {
  if (!userId) return { primary: 'stable', secondary: [], confidence: 0.5 };
  
  const recentEntries = entries.slice(-5);  // Last 5 entries
  const recentText = recentEntries.map(e => e.content || e.text || '').join(' ').toLowerCase();
  const recentMood = recentEntries
    .map(e => e.mood || e.analysis?.mood_score)
    .filter(Boolean);
  const avgMood = recentMood.length > 0 
    ? recentMood.reduce((a, b) => a + b, 0) / recentMood.length 
    : 50;
  
  const activeThreadCategories = threads
    .filter(t => t.status === 'active')
    .map(t => t.category);
  
  const detectedStates = [];
  
  for (const [key, state] of Object.entries(LIFE_STATES)) {
    if (state.triggers.default) continue;  // Skip default state
    
    let score = 0;
    let maxScore = 0;
    
    // Check thread triggers
    if (state.triggers.threads) {
      maxScore += 30;
      const matchingThreads = state.triggers.threads.filter(t => 
        activeThreadCategories.includes(t)
      );
      score += matchingThreads.length * 15;
    }
    
    // Check keyword triggers
    if (state.triggers.keywords) {
      maxScore += 40;
      const matchingKeywords = state.triggers.keywords.filter(kw => 
        recentText.includes(kw.toLowerCase())
      );
      score += Math.min(matchingKeywords.length * 10, 40);
    }
    
    // Check sentiment triggers
    if (state.triggers.sentiment) {
      maxScore += 20;
      if (state.triggers.sentiment.min && avgMood >= state.triggers.sentiment.min * 100) {
        score += 20;
      }
      if (state.triggers.sentiment.max && avgMood <= state.triggers.sentiment.max * 100) {
        score += 20;
      }
    }
    
    // Check Whoop triggers
    if (whoopData && state.triggers.whoopRecovery) {
      maxScore += 20;
      const recovery = whoopData.recovery?.score;
      if (recovery) {
        if (state.triggers.whoopRecovery.min && recovery >= state.triggers.whoopRecovery.min) {
          score += 20;
        }
        if (state.triggers.whoopRecovery.max && recovery <= state.triggers.whoopRecovery.max) {
          score += 20;
        }
      }
    }
    
    // Check mood triggers
    if (state.triggers.mood) {
      maxScore += 15;
      if (state.triggers.mood.min && avgMood >= state.triggers.mood.min) {
        score += 15;
      }
      if (state.triggers.mood.max && avgMood <= state.triggers.mood.max) {
        score += 15;
      }
    }
    
    const confidence = maxScore > 0 ? score / maxScore : 0;
    
    if (confidence >= 0.4) {  // Minimum threshold
      detectedStates.push({
        stateId: state.id,
        displayName: state.displayName,
        description: state.description,
        confidence,
        biometricSignature: state.biometricSignature,
        urgency: state.urgency || 'normal'
      });
    }
  }
  
  // Sort by confidence
  detectedStates.sort((a, b) => b.confidence - a.confidence);
  
  // Determine primary and secondary states
  const primary = detectedStates[0]?.stateId || 'stable';
  const secondary = detectedStates.slice(1, 3).map(s => s.stateId);
  
  return {
    primary,
    secondary,
    confidence: detectedStates[0]?.confidence || 0.5,
    allDetected: detectedStates,
    detectedAt: new Date().toISOString()
  };
};

/**
 * Get historical state data
 */
export const getStateHistory = async (userId) => {
  const stateRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'states'
  );
  
  const stateDoc = await getDoc(stateRef);
  if (!stateDoc.exists()) return { currentState: null, stateHistory: [] };
  
  return stateDoc.data();
};

/**
 * Update current state
 */
export const updateCurrentState = async (userId, stateData) => {
  const stateRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'states'
  );
  
  const existing = await getStateHistory(userId);
  const now = Timestamp.now();
  
  // Check if state changed
  const previousState = existing.currentState;
  const stateChanged = previousState?.primary !== stateData.primary;
  
  // If state changed, add previous to history
  let newHistory = existing.stateHistory || [];
  if (stateChanged && previousState) {
    newHistory.push({
      state: previousState.primary,
      startedAt: previousState.startedAt,
      endedAt: now,
      durationDays: previousState.startedAt 
        ? Math.round((now.toMillis() - previousState.startedAt.toMillis()) / (1000 * 60 * 60 * 24))
        : null,
      averageMood: null,  // Calculate from entries
      outcome: stateData.primary  // New state is the outcome
    });
    
    // Keep last 20 states
    if (newHistory.length > 20) {
      newHistory = newHistory.slice(-20);
    }
  }
  
  await setDoc(stateRef, {
    currentState: {
      ...stateData,
      startedAt: stateChanged ? now : (previousState?.startedAt || now),
      durationDays: stateChanged ? 0 : (previousState?.durationDays || 0) + 1
    },
    stateHistory: newHistory,
    updatedAt: now
  }, { merge: true });
};

/**
 * Find similar past states for comparison
 */
export const findSimilarPastStates = async (userId, currentState) => {
  const history = await getStateHistory(userId);
  
  const similar = (history.stateHistory || [])
    .filter(s => s.state === currentState)
    .map(s => ({
      ...s,
      durationDays: s.durationDays,
      outcome: s.outcome
    }));
  
  return similar;
};
```

### 5.2 Baseline Manager

**File**: `src/services/nexus/layer2/baselineManager.js`

```javascript
/**
 * Baseline Manager
 * 
 * Calculates and maintains personal baselines for all metrics.
 * Enables comparison of current state to personal norms.
 */

import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { getWhoopHistory } from '../../health/whoop';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_WINDOW_DAYS = 30;
const MIN_DATA_POINTS = 7;

// ============================================================
// BASELINE CALCULATION
// ============================================================

/**
 * Calculate statistics for an array of values
 */
const calculateStats = (values) => {
  if (!values || values.length === 0) return null;
  
  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return null;
  
  const n = filtered.length;
  const mean = filtered.reduce((a, b) => a + b, 0) / n;
  const sorted = [...filtered].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[n - 1];
  
  // Standard deviation
  const squaredDiffs = filtered.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(avgSquaredDiff);
  
  // Percentiles
  const p25 = sorted[Math.floor(n * 0.25)];
  const p50 = sorted[Math.floor(n * 0.5)];
  const p75 = sorted[Math.floor(n * 0.75)];
  
  // Trend (simple linear regression)
  let trend = 0;
  if (n >= 7) {
    const recentAvg = filtered.slice(-7).reduce((a, b) => a + b, 0) / 7;
    const earlierAvg = filtered.slice(0, 7).reduce((a, b) => a + b, 0) / Math.min(7, filtered.length);
    trend = (recentAvg - earlierAvg) / 7;  // Change per day
  }
  
  return {
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    min,
    max,
    percentiles: { p25, p50, p75 },
    trend: Math.round(trend * 100) / 100,
    sampleSize: n
  };
};

/**
 * Calculate global baselines from Whoop and entry data
 */
export const calculateGlobalBaselines = async (whoopHistory, entries) => {
  // Extract values
  const rhrValues = [];
  const hrvValues = [];
  const strainValues = [];
  const recoveryValues = [];
  const sleepValues = [];
  const moodValues = [];
  
  // Process Whoop data
  for (const [date, data] of Object.entries(whoopHistory || {})) {
    if (data.heartRate?.resting) rhrValues.push(data.heartRate.resting);
    if (data.hrv?.average) hrvValues.push(data.hrv.average);
    if (data.strain?.score) strainValues.push(data.strain.score);
    if (data.recovery?.score) recoveryValues.push(data.recovery.score);
    if (data.sleep?.totalHours) sleepValues.push(data.sleep.totalHours);
  }
  
  // Process entry moods
  for (const entry of entries || []) {
    const mood = entry.mood || entry.analysis?.mood_score;
    if (mood) moodValues.push(mood);
  }
  
  return {
    rhr: calculateStats(rhrValues),
    hrv: calculateStats(hrvValues),
    strain: calculateStats(strainValues),
    recovery: calculateStats(recoveryValues),
    sleep: calculateStats(sleepValues),
    mood: calculateStats(moodValues)
  };
};

/**
 * Calculate contextual baselines (the magic)
 */
export const calculateContextualBaselines = async (whoopHistory, entries, threads) => {
  const contextual = {};
  
  // === STATE-BASED BASELINES ===
  
  // Find entries with career-waiting keywords
  const careerWaitingDays = new Set();
  for (const entry of entries) {
    const text = (entry.content || entry.text || '').toLowerCase();
    if (text.match(/waiting|haven't heard|following up|pending/)) {
      const date = entry.date || entry.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
      if (date) careerWaitingDays.add(date);
    }
  }
  
  if (careerWaitingDays.size >= MIN_DATA_POINTS) {
    const waitingMetrics = extractMetricsForDays(whoopHistory, entries, careerWaitingDays);
    contextual['state:career_waiting'] = {
      rhr: calculateStats(waitingMetrics.rhr),
      hrv: calculateStats(waitingMetrics.hrv),
      mood: calculateStats(waitingMetrics.mood),
      strain: calculateStats(waitingMetrics.strain),
      sampleDays: careerWaitingDays.size
    };
  }
  
  // === ENTITY-BASED BASELINES ===
  
  const entityPatterns = {
    'spencer': /spencer/i,
    'sterling': /sterling|dog walk|walked.*dog/i,
    'kobe': /kobe/i
  };
  
  for (const [entity, pattern] of Object.entries(entityPatterns)) {
    const entityDays = new Set();
    for (const entry of entries) {
      const text = entry.content || entry.text || '';
      if (pattern.test(text)) {
        const date = entry.date || entry.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
        if (date) entityDays.add(date);
      }
    }
    
    if (entityDays.size >= 3) {  // Lower threshold for entities
      const metrics = extractMetricsForDays(whoopHistory, entries, entityDays);
      contextual[`entity:${entity}`] = {
        mood: calculateStats(metrics.mood),
        hrv: calculateStats(metrics.hrv),
        rhr: calculateStats(metrics.rhr),
        sampleDays: entityDays.size
      };
    }
  }
  
  // === ACTIVITY-BASED BASELINES ===
  
  const activityPatterns = {
    'yoga': /yoga|flow|vinyasa|c3/i,
    'barrys': /barry'?s|barrys/i,
    'sterling_walk': /walked? sterling|sterling.*walk|walk.*sterling/i,
    'gym': /gym|lift|workout|lifted/i
  };
  
  for (const [activity, pattern] of Object.entries(activityPatterns)) {
    const activityDays = new Set();
    for (const entry of entries) {
      const text = entry.content || entry.text || '';
      if (pattern.test(text)) {
        const date = entry.date || entry.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
        if (date) activityDays.add(date);
      }
    }
    
    if (activityDays.size >= 3) {
      const metrics = extractMetricsForDays(whoopHistory, entries, activityDays);
      
      // Also calculate next-day effects
      const nextDayDates = new Set([...activityDays].map(d => {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        return next.toISOString().split('T')[0];
      }));
      const nextDayMetrics = extractMetricsForDays(whoopHistory, entries, nextDayDates);
      
      contextual[`activity:${activity}`] = {
        sameDayMood: calculateStats(metrics.mood),
        sameDayStrain: calculateStats(metrics.strain),
        nextDayRecovery: calculateStats(nextDayMetrics.recovery),
        nextDayHRV: calculateStats(nextDayMetrics.hrv),
        sampleDays: activityDays.size
      };
    }
  }
  
  // === TEMPORAL BASELINES ===
  
  const dayOfWeekMetrics = Array(7).fill(null).map(() => ({
    mood: [], rhr: [], hrv: [], strain: [], recovery: []
  }));
  
  for (const entry of entries) {
    const date = entry.date || entry.createdAt?.toDate?.();
    if (!date) continue;
    
    const dow = new Date(date).getDay();
    const dateStr = new Date(date).toISOString().split('T')[0];
    const whoop = whoopHistory?.[dateStr];
    
    if (entry.mood) dayOfWeekMetrics[dow].mood.push(entry.mood);
    if (whoop?.heartRate?.resting) dayOfWeekMetrics[dow].rhr.push(whoop.heartRate.resting);
    if (whoop?.hrv?.average) dayOfWeekMetrics[dow].hrv.push(whoop.hrv.average);
    if (whoop?.strain?.score) dayOfWeekMetrics[dow].strain.push(whoop.strain.score);
    if (whoop?.recovery?.score) dayOfWeekMetrics[dow].recovery.push(whoop.recovery.score);
  }
  
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < 7; i++) {
    if (dayOfWeekMetrics[i].mood.length >= 2) {
      contextual[`temporal:${dayNames[i]}`] = {
        mood: calculateStats(dayOfWeekMetrics[i].mood),
        strain: calculateStats(dayOfWeekMetrics[i].strain),
        recovery: calculateStats(dayOfWeekMetrics[i].recovery)
      };
    }
  }
  
  return contextual;
};

/**
 * Extract metrics for specific days
 */
const extractMetricsForDays = (whoopHistory, entries, daySet) => {
  const metrics = { rhr: [], hrv: [], strain: [], recovery: [], mood: [] };
  
  for (const date of daySet) {
    const whoop = whoopHistory?.[date];
    if (whoop) {
      if (whoop.heartRate?.resting) metrics.rhr.push(whoop.heartRate.resting);
      if (whoop.hrv?.average) metrics.hrv.push(whoop.hrv.average);
      if (whoop.strain?.score) metrics.strain.push(whoop.strain.score);
      if (whoop.recovery?.score) metrics.recovery.push(whoop.recovery.score);
    }
    
    // Find entries for this date
    const dayEntries = entries.filter(e => {
      const entryDate = e.date || e.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
      return entryDate === date;
    });
    
    for (const entry of dayEntries) {
      const mood = entry.mood || entry.analysis?.mood_score;
      if (mood) metrics.mood.push(mood);
    }
  }
  
  return metrics;
};

/**
 * Calculate correlation between two metric arrays
 */
export const calculateCorrelation = (x, y) => {
  if (x.length !== y.length || x.length < 5) return null;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
  const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);
  const sumY2 = y.reduce((total, yi) => total + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
};

/**
 * Calculate all correlations between metrics
 */
export const calculateCorrelations = (whoopHistory, entries) => {
  // Align data by date
  const alignedData = [];
  
  for (const entry of entries) {
    const date = entry.date || entry.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
    if (!date) continue;
    
    const whoop = whoopHistory?.[date];
    const mood = entry.mood || entry.analysis?.mood_score;
    
    if (whoop && mood) {
      alignedData.push({
        date,
        mood,
        rhr: whoop.heartRate?.resting,
        hrv: whoop.hrv?.average,
        strain: whoop.strain?.score,
        recovery: whoop.recovery?.score,
        sleep: whoop.sleep?.totalHours
      });
    }
  }
  
  if (alignedData.length < 7) return {};
  
  // Calculate correlations
  const correlations = {};
  const metrics = ['mood', 'rhr', 'hrv', 'strain', 'recovery', 'sleep'];
  
  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const m1 = metrics[i];
      const m2 = metrics[j];
      
      const values1 = alignedData.map(d => d[m1]).filter(v => v != null);
      const values2 = alignedData.map(d => d[m2]).filter(v => v != null);
      
      if (values1.length === values2.length && values1.length >= 7) {
        const corr = calculateCorrelation(values1, values2);
        if (corr !== null) {
          correlations[`${m1}_${m2}`] = corr;
        }
      }
    }
  }
  
  // Also calculate lagged correlations (e.g., sleep → next day mood)
  for (let i = 0; i < alignedData.length - 1; i++) {
    // This would need date-aligned data
    // Simplified for now
  }
  
  return correlations;
};

/**
 * Main function: Calculate and save all baselines
 */
export const calculateAndSaveBaselines = async (userId) => {
  console.log('[BaselineManager] Calculating baselines for user:', userId);
  
  // Fetch data
  const whoopHistory = await getWhoopHistory(userId, DEFAULT_WINDOW_DAYS);
  
  // Fetch entries (simplified - would use your entry service)
  const entries = [];  // TODO: Implement entry fetching
  
  // Fetch threads
  const threads = [];  // TODO: Implement thread fetching
  
  // Calculate baselines
  const global = await calculateGlobalBaselines(whoopHistory, entries);
  const contextual = await calculateContextualBaselines(whoopHistory, entries, threads);
  const correlations = calculateCorrelations(whoopHistory, entries);
  
  const baselines = {
    calculatedAt: Timestamp.now(),
    dataWindowDays: DEFAULT_WINDOW_DAYS,
    whoopDaysConnected: Object.keys(whoopHistory || {}).length,
    global,
    contextual,
    correlations
  };
  
  // Save to Firestore
  const baselineRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'baselines'
  );
  await setDoc(baselineRef, baselines);
  
  console.log('[BaselineManager] Baselines saved');
  return baselines;
};

/**
 * Get current baselines
 */
export const getBaselines = async (userId) => {
  const baselineRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'baselines'
  );
  
  const baselineDoc = await getDoc(baselineRef);
  if (!baselineDoc.exists()) return null;
  
  return baselineDoc.data();
};

/**
 * Compare current values to baseline
 */
export const compareToBaseline = (currentValue, baseline, metric) => {
  if (!baseline || !baseline[metric]?.mean) return null;
  
  const mean = baseline[metric].mean;
  const stdDev = baseline[metric].stdDev || mean * 0.1;
  
  const delta = currentValue - mean;
  const zScore = stdDev > 0 ? delta / stdDev : 0;
  
  let status = 'normal';
  if (zScore > 2) status = 'significantly_elevated';
  else if (zScore > 1) status = 'elevated';
  else if (zScore < -2) status = 'significantly_depressed';
  else if (zScore < -1) status = 'depressed';
  
  return {
    current: currentValue,
    baseline: mean,
    delta,
    deltaPercent: Math.round((delta / mean) * 100),
    zScore: Math.round(zScore * 100) / 100,
    status,
    interpretation: generateInterpretation(metric, delta, zScore)
  };
};

const generateInterpretation = (metric, delta, zScore) => {
  const direction = delta > 0 ? 'higher' : 'lower';
  const magnitude = Math.abs(zScore) > 2 ? 'significantly' : Math.abs(zScore) > 1 ? 'noticeably' : 'slightly';
  
  const metricNames = {
    rhr: 'resting heart rate',
    hrv: 'heart rate variability',
    strain: 'strain',
    recovery: 'recovery score',
    mood: 'mood'
  };
  
  return `Your ${metricNames[metric] || metric} is ${magnitude} ${direction} than your baseline`;
};
```

---

This document is getting quite long. Let me continue with Parts 6-12 (Layer 3, Layer 4, UI, Settings, Prompts, and Migration) in the next file.

# EchoVault Nexus 2.0: Implementation Specification (Part 2)

## Part 6: Layer 3 — Causal Synthesizer

This is the LLM-heavy layer that transforms raw patterns into deep insights.

### 6.1 Main Synthesizer

**File**: `src/services/nexus/layer3/synthesizer.js`

```javascript
/**
 * Causal Synthesizer
 * 
 * The brain of Nexus 2.0. Uses LLM to synthesize patterns, baselines,
 * and context into meaningful insights with psychological mechanisms.
 */

import { callGemini } from '../../ai/gemini';
import { getBaselines, compareToBaseline } from '../layer2/baselineManager';
import { detectCurrentState, findSimilarPastStates } from '../layer2/stateDetector';
import { getActiveThreads, getThreadLineage } from '../layer1/threadManager';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';

// ============================================================
// INSIGHT TYPES
// ============================================================

export const INSIGHT_TYPES = {
  CAUSAL_SYNTHESIS: 'causal_synthesis',        // Main insight type
  BELIEF_DISSONANCE: 'belief_dissonance',      // Gentle challenges
  NARRATIVE_ARC: 'narrative_arc',              // Long-term story insights
  INTERVENTION: 'intervention',                 // Action recommendations
  COUNTERFACTUAL: 'counterfactual',            // "What if" insights
  STATE_COMPARISON: 'state_comparison',         // Current vs past state
  PATTERN_ALERT: 'pattern_alert'               // Urgent pattern detection
};

// ============================================================
// SYNTHESIS PROMPTS
// ============================================================

const buildSynthesisPrompt = (context) => {
  const {
    recentEntries,
    activeThreads,
    currentState,
    baselines,
    whoopToday,
    beliefData,
    interventionData
  } = context;
  
  // Format entries
  const entrySummaries = recentEntries.slice(-5).map(e => {
    const date = e.date || e.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
    const mood = e.mood || e.analysis?.mood_score;
    const excerpt = (e.content || e.text || '').slice(0, 300);
    return `[${date}] Mood: ${mood}% - "${excerpt}..."`;
  }).join('\n');
  
  // Format threads
  const threadSummaries = activeThreads.slice(0, 5).map(t => {
    return `- ${t.displayName} (${t.category}): ${t.entryCount} entries, sentiment trajectory: ${t.sentimentTrajectory}, baseline: ${Math.round(t.sentimentBaseline * 100)}%`;
  }).join('\n');
  
  // Format current state
  const stateInfo = currentState ? 
    `Current Life State: ${currentState.primary} (${Math.round(currentState.confidence * 100)}% confidence)
Secondary states: ${currentState.secondary?.join(', ') || 'none'}
Duration in state: ${currentState.durationDays || 'unknown'} days` : 
    'Current state: Unknown';
  
  // Format baselines
  let baselineComparisons = '';
  if (baselines?.global && whoopToday) {
    const comparisons = [];
    if (whoopToday.heartRate?.resting && baselines.global.rhr) {
      const comp = compareToBaseline(whoopToday.heartRate.resting, baselines.global, 'rhr');
      if (comp) comparisons.push(`RHR: ${comp.current} bpm (${comp.status}, ${comp.deltaPercent > 0 ? '+' : ''}${comp.deltaPercent}% from baseline)`);
    }
    if (whoopToday.hrv?.average && baselines.global.hrv) {
      const comp = compareToBaseline(whoopToday.hrv.average, baselines.global, 'hrv');
      if (comp) comparisons.push(`HRV: ${comp.current} ms (${comp.status}, ${comp.deltaPercent > 0 ? '+' : ''}${comp.deltaPercent}% from baseline)`);
    }
    if (whoopToday.recovery?.score && baselines.global.recovery) {
      const comp = compareToBaseline(whoopToday.recovery.score, baselines.global, 'recovery');
      if (comp) comparisons.push(`Recovery: ${comp.current}% (${comp.status})`);
    }
    baselineComparisons = comparisons.join('\n');
  }
  
  // Format contextual baselines
  let contextualInfo = '';
  if (baselines?.contextual && currentState?.primary) {
    const stateBaseline = baselines.contextual[`state:${currentState.primary}`];
    if (stateBaseline) {
      contextualInfo = `
Historical pattern for "${currentState.primary}" state:
- Typical RHR: ${stateBaseline.rhr?.mean || 'N/A'} bpm
- Typical HRV: ${stateBaseline.hrv?.mean || 'N/A'} ms
- Typical mood: ${stateBaseline.mood?.mean || 'N/A'}%
- Sample size: ${stateBaseline.sampleDays || 'N/A'} days`;
    }
  }
  
  // Format intervention effectiveness
  let interventionInfo = '';
  if (interventionData?.interventions) {
    const topInterventions = Object.entries(interventionData.interventions)
      .filter(([_, data]) => data.effectiveness?.global?.score > 0.7)
      .slice(0, 3)
      .map(([name, data]) => `- ${name}: effectiveness ${Math.round(data.effectiveness.global.score * 100)}%`)
      .join('\n');
    if (topInterventions) {
      interventionInfo = `\nMost effective interventions for this user:\n${topInterventions}`;
    }
  }
  
  return `You are an expert behavioral psychologist and health coach analyzing a user's journal and biometric data. Your task is to generate a single, powerful insight that reveals a non-obvious pattern and its psychological mechanism.

## USER CONTEXT

### Recent Journal Entries
${entrySummaries}

### Active Life Threads
${threadSummaries}

### ${stateInfo}

### Today's Biometrics vs Personal Baseline
${baselineComparisons || 'Biometric data unavailable'}
${contextualInfo}
${interventionInfo}

## YOUR TASK

Generate ONE profound insight that:
1. Identifies a HIDDEN PATTERN the user likely hasn't noticed
2. Explains the PSYCHOLOGICAL MECHANISM behind it
3. Connects NARRATIVE (what they're saying) with BIOMETRICS (what their body is doing)
4. Provides a SPECIFIC, ACTIONABLE recommendation
5. Predicts the likely OUTCOME if the recommendation is followed

## QUALITY CRITERIA

- The insight should make the user think "holy shit, I didn't realize that"
- Avoid generic advice like "get more sleep" - be specific to THIS user
- Reference specific entities (Spencer, Sterling, etc.) when relevant
- Quantify when possible ("your HRV recovers 12ms faster when...")
- The mechanism should be psychologically sound (attachment theory, nervous system regulation, etc.)

## RESPONSE FORMAT (JSON only)

{
  "insight": {
    "title": "Short memorable title (e.g., 'The Sterling Stabilization Loop')",
    "type": "causal_synthesis",
    "summary": "One sentence hook",
    "body": "2-3 paragraph insight with the full explanation, mechanism, and evidence",
    "mechanism": "The psychological/physiological mechanism in one sentence",
    "evidence": {
      "narrative": ["Specific quote or pattern from entries"],
      "biometric": ["Specific metric with value and comparison to baseline"],
      "statistical": {
        "correlation": 0.78,
        "sampleSize": 18,
        "confidence": 0.85
      }
    }
  },
  "recommendation": {
    "action": "Specific action to take",
    "timing": "When to do it (e.g., 'this evening before 7pm')",
    "reasoning": "Why this action specifically addresses the pattern",
    "expectedOutcome": "What improvement to expect and by when",
    "confidence": 0.85
  },
  "metadata": {
    "primaryThread": "thread_id if applicable",
    "relatedThreads": ["other_thread_ids"],
    "stateContext": "current_state_id",
    "urgency": "low" | "medium" | "high"
  }
}`;
};

// ============================================================
// MAIN SYNTHESIS FUNCTION
// ============================================================

/**
 * Generate the primary causal synthesis insight
 */
export const generateCausalSynthesis = async (userId, context) => {
  console.log('[Synthesizer] Generating causal synthesis...');
  
  const prompt = buildSynthesisPrompt(context);
  
  try {
    const response = await callGemini(prompt, '', {
      temperature: 0.7,
      maxTokens: 2000
    });
    
    // Parse response
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    
    const parsed = JSON.parse(jsonStr);
    
    return {
      success: true,
      insight: {
        id: `insight_${Date.now()}`,
        generatedAt: new Date().toISOString(),
        userId,
        ...parsed.insight,
        recommendation: parsed.recommendation,
        metadata: {
          ...parsed.metadata,
          layers: [1, 2, 3, 4],
          generationMethod: 'llm_synthesis'
        }
      }
    };
  } catch (error) {
    console.error('[Synthesizer] Synthesis failed:', error);
    return {
      success: false,
      error: error.message,
      fallback: generateFallbackInsight(context)
    };
  }
};

/**
 * Generate fallback insight when LLM fails
 */
const generateFallbackInsight = (context) => {
  const { currentState, baselines, whoopToday } = context;
  
  // Simple rule-based fallback
  if (currentState?.primary === 'career_waiting' && whoopToday?.heartRate?.resting) {
    const rhrBaseline = baselines?.global?.rhr?.mean || 58;
    const rhrDelta = whoopToday.heartRate.resting - rhrBaseline;
    
    if (rhrDelta > 3) {
      return {
        title: "Career Anxiety Signal",
        type: INSIGHT_TYPES.PATTERN_ALERT,
        summary: "Your body is showing signs of career-related stress.",
        body: `Your resting heart rate is ${Math.round(rhrDelta)} bpm above your baseline during this waiting period. This is a common physiological response to uncertainty.`,
        recommendation: {
          action: "Take a 10-minute walk or do a breathing exercise",
          timing: "Now or within the next hour",
          reasoning: "Physical movement helps regulate the nervous system during periods of uncertainty",
          confidence: 0.6
        }
      };
    }
  }
  
  return {
    title: "System Learning",
    type: INSIGHT_TYPES.PATTERN_ALERT,
    summary: "Continue logging to unlock deeper insights.",
    body: "The more data you provide, the more personalized and powerful your insights become.",
    confidence: 0.3
  };
};

// ============================================================
// SPECIALIZED SYNTHESIS FUNCTIONS
// ============================================================

/**
 * Generate narrative arc insight (long-term story)
 */
export const generateNarrativeArcInsight = async (userId, threadId) => {
  const lineage = await getThreadLineage(userId, threadId);
  
  if (lineage.length < 2) {
    return null;  // Not enough history for arc
  }
  
  // Build arc data
  const arcData = lineage.map(t => ({
    name: t.displayName,
    sentiment: t.sentimentBaseline,
    duration: t.entryCount,
    evolution: t.evolutionType
  }));
  
  const prompt = `Analyze this narrative arc from a user's life:

THREAD EVOLUTION:
${arcData.map((t, i) => `${i + 1}. "${t.name}" - Sentiment: ${Math.round(t.sentiment * 100)}%, Entries: ${t.duration}`).join('\n')}

Generate a "Resilience Arc" insight that:
1. Identifies how the user has grown through this sequence
2. Compares their emotional trajectory now vs the beginning
3. Highlights a specific strength or pattern that emerged

Response format (JSON):
{
  "title": "The [Topic] Resilience Arc",
  "summary": "One sentence describing the growth",
  "body": "2-3 paragraphs analyzing the arc",
  "growth_metric": "Specific quantified growth (e.g., 'recovery time shortened from 3 weeks to 3 days')",
  "strength_identified": "The resilience factor that emerged"
}`;

  try {
    const response = await callGemini(prompt);
    return JSON.parse(response.replace(/```json?\n?|```/g, '').trim());
  } catch (error) {
    console.error('[Synthesizer] Arc insight failed:', error);
    return null;
  }
};

/**
 * Generate state comparison insight
 */
export const generateStateComparisonInsight = async (userId, currentState, pastStates) => {
  if (!pastStates || pastStates.length === 0) {
    return null;
  }
  
  const mostRecent = pastStates[pastStates.length - 1];
  
  const prompt = `Compare the user's current experience of "${currentState.primary}" with their previous experience:

CURRENT STATE:
- State: ${currentState.primary}
- Duration so far: ${currentState.durationDays || 0} days
- Confidence: ${Math.round(currentState.confidence * 100)}%

MOST RECENT SIMILAR STATE:
- Duration: ${mostRecent.durationDays} days
- Outcome: ${mostRecent.outcome}
- Average mood: ${mostRecent.averageMood}%

Generate an insight about how they're handling this state differently (or similarly) this time.

Response format (JSON):
{
  "title": "State Comparison Insight",
  "comparison": "How current compares to past",
  "improvement": "What's better this time (if any)",
  "concern": "What to watch for (if any)",
  "prediction": "Likely outcome based on trajectory"
}`;

  try {
    const response = await callGemini(prompt);
    return JSON.parse(response.replace(/```json?\n?|```/g, '').trim());
  } catch (error) {
    console.error('[Synthesizer] State comparison failed:', error);
    return null;
  }
};
```

### 6.2 Cross-Thread Detector

**File**: `src/services/nexus/layer3/crossThreadDetector.js`

```javascript
/**
 * Cross-Thread Pattern Detector
 * 
 * Identifies meta-patterns that span multiple threads.
 * Example: Career stress and friend health concerns share the same
 * underlying pattern of "helplessness about people you care for"
 */

import { getActiveThreads, getThread } from '../layer1/threadManager';
import { callGemini } from '../../ai/gemini';

// ============================================================
// META-PATTERN DEFINITIONS
// ============================================================

export const META_PATTERNS = {
  CONTROL_ANXIETY: {
    id: 'control_anxiety',
    displayName: 'Control Anxiety Pattern',
    description: 'Anxiety triggered by situations outside your control',
    threadCategories: ['career', 'relationship', 'health'],
    narrativeSignals: ['can\'t control', 'helpless', 'waiting', 'nothing I can do', 'out of my hands'],
    somaticSignature: ['tension', 'sleep_disturbance', 'digestive'],
    biometricSignature: { rhr: 'elevated', hrv: 'depressed' }
  },
  
  CARETAKER_BURDEN: {
    id: 'caretaker_burden',
    displayName: 'Caretaker Burden',
    description: 'Stress from caring for others at expense of self',
    threadCategories: ['relationship', 'health'],
    narrativeSignals: ['worried about', 'taking care of', 'helping', 'supporting', 'checking on'],
    somaticSignature: ['fatigue', 'tension'],
    biometricSignature: { strain: 'elevated', recovery: 'low' }
  },
  
  IDENTITY_THREAT: {
    id: 'identity_threat',
    displayName: 'Identity Threat Response',
    description: 'Perceived threats to self-concept or worth',
    threadCategories: ['career', 'relationship', 'growth'],
    narrativeSignals: ['what does this say about me', 'failure', 'incompetent', 'not good enough', 'inadequate'],
    somaticSignature: ['cardiovascular', 'sleep_disturbance'],
    biometricSignature: { rhr: 'elevated', mood: 'volatile' }
  },
  
  BELONGING_UNCERTAINTY: {
    id: 'belonging_uncertainty',
    displayName: 'Belonging Uncertainty',
    description: 'Anxiety about place in relationships or communities',
    threadCategories: ['relationship', 'social', 'career'],
    narrativeSignals: ['do they like me', 'fitting in', 'belong', 'outsider', 'alone'],
    somaticSignature: ['tension', 'cognitive'],
    biometricSignature: { hrv: 'depressed' }
  },
  
  MOMENTUM_SEEKING: {
    id: 'momentum_seeking',
    displayName: 'Momentum Seeking',
    description: 'Need for progress and forward motion',
    threadCategories: ['career', 'growth', 'creative'],
    narrativeSignals: ['stuck', 'stagnant', 'making progress', 'moving forward', 'accomplishing'],
    somaticSignature: [],
    biometricSignature: { mood: 'correlated_with_progress' }
  }
};

// ============================================================
// DETECTION FUNCTIONS
// ============================================================

/**
 * Analyze threads for meta-patterns
 */
export const detectMetaPatterns = async (userId, threads, entries) => {
  const detectedPatterns = [];
  
  // Combine all thread and entry text
  const allText = [
    ...threads.map(t => t.displayName),
    ...entries.slice(-20).map(e => e.content || e.text || '')
  ].join(' ').toLowerCase();
  
  // Collect somatic signals across threads
  const allSomatics = new Set();
  for (const thread of threads) {
    (thread.somaticSignals || []).forEach(s => allSomatics.add(s));
  }
  
  // Check each meta-pattern
  for (const [key, pattern] of Object.entries(META_PATTERNS)) {
    let score = 0;
    const evidence = [];
    
    // Check narrative signals
    const matchingSignals = pattern.narrativeSignals.filter(signal => 
      allText.includes(signal)
    );
    if (matchingSignals.length > 0) {
      score += matchingSignals.length * 15;
      evidence.push({ type: 'narrative', signals: matchingSignals });
    }
    
    // Check thread categories
    const threadCategories = threads.map(t => t.category);
    const matchingCategories = pattern.threadCategories.filter(cat =>
      threadCategories.includes(cat)
    );
    if (matchingCategories.length >= 2) {
      score += 20;
      evidence.push({ type: 'threads', categories: matchingCategories });
    }
    
    // Check somatic signature
    const matchingSomatics = pattern.somaticSignature.filter(s =>
      allSomatics.has(s)
    );
    if (matchingSomatics.length > 0) {
      score += matchingSomatics.length * 10;
      evidence.push({ type: 'somatic', signals: matchingSomatics });
    }
    
    // Threshold check
    if (score >= 35) {
      detectedPatterns.push({
        patternId: pattern.id,
        displayName: pattern.displayName,
        description: pattern.description,
        confidence: Math.min(score / 100, 0.95),
        evidence,
        affectedThreads: threads
          .filter(t => matchingCategories.includes(t.category))
          .map(t => t.id)
      });
    }
  }
  
  return detectedPatterns.sort((a, b) => b.confidence - a.confidence);
};

/**
 * Generate insight from meta-pattern
 */
export const generateMetaPatternInsight = async (userId, metaPattern, context) => {
  const { threads, entries, baselines } = context;
  
  const affectedThreads = threads.filter(t => 
    metaPattern.affectedThreads.includes(t.id)
  );
  
  const prompt = `A user is exhibiting the "${metaPattern.displayName}" meta-pattern across multiple areas of their life.

META-PATTERN: ${metaPattern.description}

AFFECTED LIFE AREAS:
${affectedThreads.map(t => `- ${t.displayName} (${t.category}): sentiment ${Math.round(t.sentimentBaseline * 100)}%`).join('\n')}

EVIDENCE:
${metaPattern.evidence.map(e => `- ${e.type}: ${JSON.stringify(e.signals || e.categories)}`).join('\n')}

Generate an insight that:
1. Helps the user see the COMMON THREAD connecting these seemingly separate concerns
2. Names the underlying psychological pattern in accessible language
3. Explains why their body/mood responds similarly across these different areas
4. Provides ONE unified intervention that could help across all areas

Response format (JSON):
{
  "title": "The Connection Between [X] and [Y]",
  "realization": "The 'aha' moment in one sentence",
  "explanation": "2 paragraphs connecting the dots",
  "unified_intervention": {
    "action": "One thing that helps across all areas",
    "why": "Why this works for the underlying pattern"
  }
}`;

  try {
    const response = await callGemini(prompt);
    const parsed = JSON.parse(response.replace(/```json?\n?|```/g, '').trim());
    
    return {
      type: 'meta_pattern',
      patternId: metaPattern.patternId,
      ...parsed,
      confidence: metaPattern.confidence
    };
  } catch (error) {
    console.error('[CrossThread] Meta-pattern insight failed:', error);
    return null;
  }
};
```

### 6.3 Belief Dissonance Detector

**File**: `src/services/nexus/layer3/beliefDissonance.js`

```javascript
/**
 * Belief-Data Dissonance Detector
 * 
 * Identifies contradictions between user's stated beliefs about themselves
 * and their actual behavioral/biometric data.
 * 
 * This is a powerful but sensitive feature that must be handled with care.
 */

import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { callGemini } from '../../ai/gemini';

// ============================================================
// BELIEF EXTRACTION
// ============================================================

/**
 * Patterns that indicate self-descriptive statements
 */
const BELIEF_PATTERNS = [
  // "I am" statements
  { pattern: /i(?:'m| am) (?:a |an |the |very |pretty |quite |not |really )?(\w+(?:\s+\w+)?)/gi, type: 'identity' },
  
  // "I don't" / "I never" statements
  { pattern: /i (?:don't|never|rarely|seldom) (\w+(?:\s+\w+){0,3})/gi, type: 'behavior_denial' },
  
  // "I always" / "I usually" statements  
  { pattern: /i (?:always|usually|often|typically) (\w+(?:\s+\w+){0,3})/gi, type: 'behavior_claim' },
  
  // "I feel like I" statements
  { pattern: /i feel (?:like |that )?i(?:'m| am) (\w+(?:\s+\w+){0,3})/gi, type: 'self_perception' },
  
  // "I think I'm" statements
  { pattern: /i think i(?:'m| am) (\w+(?:\s+\w+){0,3})/gi, type: 'self_assessment' },
  
  // "I'm okay with" / "I'm fine with" statements
  { pattern: /i(?:'m| am) (?:okay|fine|good|comfortable) with (\w+(?:\s+\w+){0,5})/gi, type: 'acceptance' },
  
  // "I should" / "I need to" statements (reveal implicit beliefs)
  { pattern: /i (?:should|need to|have to|must) (\w+(?:\s+\w+){0,4})/gi, type: 'should_statement' }
];

/**
 * Extract beliefs from entry text
 */
export const extractBeliefsFromEntry = (entryText, entryId) => {
  const beliefs = [];
  
  for (const { pattern, type } of BELIEF_PATTERNS) {
    const matches = entryText.matchAll(pattern);
    
    for (const match of matches) {
      const statement = match[0];
      const content = match[1];
      
      // Filter out common false positives
      if (content.length < 3) continue;
      if (/^(going|doing|trying|getting|having|being)$/i.test(content)) continue;
      
      beliefs.push({
        id: `belief_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        statement: statement.trim(),
        content: content.trim(),
        type,
        extractedFrom: entryId,
        extractedAt: new Date().toISOString(),
        confidence: 0.7  // Base confidence, refined by LLM
      });
    }
  }
  
  return beliefs;
};

/**
 * Refine and categorize beliefs using LLM
 */
export const refineBeliefsWithLLM = async (rawBeliefs, fullEntryText) => {
  if (rawBeliefs.length === 0) return [];
  
  const prompt = `Analyze these self-descriptive statements extracted from a journal entry:

RAW STATEMENTS:
${rawBeliefs.map((b, i) => `${i + 1}. "${b.statement}" (type: ${b.type})`).join('\n')}

FULL CONTEXT:
"${fullEntryText.slice(0, 1000)}"

For each statement, determine:
1. Is this a genuine self-belief or just casual language?
2. What category does it fall into? (self_worth, productivity, relationships, health, emotional_regulation, identity)
3. What is the testable claim? (something we could validate against behavioral data)
4. Confidence that this represents a real self-belief (0-1)

Response format (JSON array):
[
  {
    "original": "I'm okay with being reliant on external success",
    "isGenuineBelief": true,
    "category": "self_worth",
    "testableClaim": "Mood is not significantly affected by career outcomes",
    "confidence": 0.85,
    "notes": "Direct statement about self-perception"
  }
]

Only include statements that represent genuine self-beliefs. Skip casual language.`;

  try {
    const response = await callGemini(prompt);
    const refined = JSON.parse(response.replace(/```json?\n?|```/g, '').trim());
    
    return refined
      .filter(b => b.isGenuineBelief && b.confidence > 0.6)
      .map((b, i) => ({
        ...rawBeliefs[i],
        category: b.category,
        testableClaim: b.testableClaim,
        confidence: b.confidence,
        llmNotes: b.notes
      }));
  } catch (error) {
    console.error('[BeliefDissonance] LLM refinement failed:', error);
    return rawBeliefs;  // Return raw if LLM fails
  }
};

// ============================================================
// DISSONANCE DETECTION
// ============================================================

/**
 * Validate beliefs against behavioral data
 */
export const validateBeliefAgainstData = async (belief, userData) => {
  const { entries, baselines, threads } = userData;
  
  const validation = {
    supportingData: [],
    contradictingData: [],
    dissonanceScore: 0
  };
  
  // Category-specific validation logic
  switch (belief.category) {
    case 'self_worth': {
      // Check mood correlation with career events
      const careerEntries = entries.filter(e => {
        const text = (e.content || e.text || '').toLowerCase();
        return text.match(/job|career|interview|offer|rejected|work/);
      });
      
      if (careerEntries.length >= 5) {
        const careerMoods = careerEntries.map(e => e.mood || e.analysis?.mood_score).filter(Boolean);
        const otherEntries = entries.filter(e => !careerEntries.includes(e));
        const otherMoods = otherEntries.map(e => e.mood || e.analysis?.mood_score).filter(Boolean);
        
        const careerMoodAvg = careerMoods.reduce((a, b) => a + b, 0) / careerMoods.length;
        const otherMoodAvg = otherMoods.reduce((a, b) => a + b, 0) / otherMoods.length;
        const careerMoodVariance = calculateVariance(careerMoods);
        const otherMoodVariance = calculateVariance(otherMoods);
        
        // High variance on career days suggests high sensitivity
        if (careerMoodVariance > otherMoodVariance * 1.5) {
          validation.contradictingData.push({
            metric: 'mood_variance_career_vs_other',
            value: careerMoodVariance / otherMoodVariance,
            interpretation: `Mood variance is ${Math.round(careerMoodVariance / otherMoodVariance * 100)}% higher on career-related days`
          });
        }
        
        // Check for extreme mood swings around career events
        const moodRange = Math.max(...careerMoods) - Math.min(...careerMoods);
        if (moodRange > 50) {
          validation.contradictingData.push({
            metric: 'career_mood_range',
            value: moodRange,
            interpretation: `Career events caused mood swings of ${moodRange} points`
          });
        }
      }
      break;
    }
    
    case 'productivity': {
      // Check if rest days actually correlate with negative mood
      const restDays = entries.filter(e => {
        const text = (e.content || e.text || '').toLowerCase();
        return text.match(/rest|lazy|didn't work out|skipped|took it easy/);
      });
      
      const workoutDays = entries.filter(e => {
        const text = (e.content || e.text || '').toLowerCase();
        return text.match(/workout|gym|yoga|exercise|run/);
      });
      
      if (restDays.length >= 3 && workoutDays.length >= 5) {
        const restMoodAvg = average(restDays.map(e => e.mood).filter(Boolean));
        const workoutMoodAvg = average(workoutDays.map(e => e.mood).filter(Boolean));
        
        const moodDiff = workoutMoodAvg - restMoodAvg;
        
        if (Math.abs(moodDiff) < 5) {
          validation.contradictingData.push({
            metric: 'rest_vs_workout_mood',
            value: moodDiff,
            interpretation: `Only ${Math.abs(Math.round(moodDiff))}-point mood difference between rest and workout days`
          });
        }
      }
      break;
    }
    
    case 'emotional_regulation': {
      // Check mood volatility
      const moods = entries.map(e => e.mood).filter(Boolean);
      const volatility = calculateVolatility(moods);
      
      if (belief.statement.toLowerCase().includes('stable') && volatility > 20) {
        validation.contradictingData.push({
          metric: 'mood_volatility',
          value: volatility,
          interpretation: `Mood volatility of ${Math.round(volatility)}% suggests emotional variability`
        });
      }
      break;
    }
  }
  
  // Calculate dissonance score
  const supportWeight = validation.supportingData.length * 0.3;
  const contradictWeight = validation.contradictingData.length * 0.4;
  
  validation.dissonanceScore = Math.min(
    contradictWeight / (supportWeight + contradictWeight + 0.1),
    1
  );
  
  return validation;
};

/**
 * Generate gentle dissonance insight
 */
export const generateDissonanceInsight = async (belief, validation, userSettings) => {
  // Check mood gate
  const currentMood = userSettings?.currentMood || 50;
  const moodThreshold = userSettings?.preferences?.moodGateThreshold || 50;
  
  if (currentMood < moodThreshold) {
    console.log('[BeliefDissonance] Mood gate triggered, queuing insight for later');
    return { queued: true, reason: 'mood_gate' };
  }
  
  // Only surface high-confidence dissonances
  if (validation.dissonanceScore < 0.5) {
    return null;
  }
  
  const prompt = `Generate a gentle, therapeutic insight about a potential belief-data dissonance.

USER'S STATED BELIEF:
"${belief.statement}"

CONTRADICTING DATA:
${validation.contradictingData.map(d => `- ${d.interpretation}`).join('\n')}

REQUIREMENTS:
1. Frame this as curiosity, not criticism
2. Use "I notice" or "Your data shows" language
3. End with an open question, not a conclusion
4. Normalize the gap between belief and behavior
5. Make it feel like an invitation to explore, not a judgment

FRAMING OPTIONS (choose one):
- "A Pattern Worth Noticing"
- "An Interesting Tension"  
- "Something Your Data Reveals"

Response format (JSON):
{
  "title": "A Pattern Worth Noticing",
  "opening": "On [date], you reflected: '[belief]'",
  "observation": "Your data shows [specific finding]",
  "normalization": "This isn't a contradiction to resolve...",
  "invitation": "What do you make of this? Is this something you want to explore?",
  "journalPrompt": "A specific prompt for journaling about this"
}`;

  try {
    const response = await callGemini(prompt);
    const insight = JSON.parse(response.replace(/```json?\n?|```/g, '').trim());
    
    return {
      type: 'belief_dissonance',
      beliefId: belief.id,
      ...insight,
      confidence: validation.dissonanceScore,
      originalBelief: belief.statement,
      evidence: validation.contradictingData
    };
  } catch (error) {
    console.error('[BeliefDissonance] Insight generation failed:', error);
    return null;
  }
};

// ============================================================
// BELIEF STORAGE
// ============================================================

/**
 * Save extracted beliefs to Firestore
 */
export const saveBeliefs = async (userId, beliefs) => {
  const beliefRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'beliefs'
  );
  
  const existing = await getDoc(beliefRef);
  const existingBeliefs = existing.exists() ? existing.data().extractedBeliefs || [] : [];
  
  // Deduplicate by content similarity
  const newBeliefs = beliefs.filter(newB => 
    !existingBeliefs.some(existB => 
      similarity(newB.content, existB.content) > 0.8
    )
  );
  
  if (newBeliefs.length === 0) return;
  
  await setDoc(beliefRef, {
    extractedBeliefs: [...existingBeliefs, ...newBeliefs].slice(-50),  // Keep last 50
    lastUpdated: Timestamp.now()
  }, { merge: true });
};

/**
 * Get beliefs for validation
 */
export const getBeliefs = async (userId) => {
  const beliefRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'beliefs'
  );
  
  const beliefDoc = await getDoc(beliefRef);
  if (!beliefDoc.exists()) return [];
  
  return beliefDoc.data().extractedBeliefs || [];
};

// ============================================================
// UTILITIES
// ============================================================

const calculateVariance = (arr) => {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
};

const calculateVolatility = (arr) => {
  if (arr.length < 2) return 0;
  let totalChange = 0;
  for (let i = 1; i < arr.length; i++) {
    totalChange += Math.abs(arr[i] - arr[i-1]);
  }
  return totalChange / (arr.length - 1);
};

const average = (arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

const similarity = (str1, str2) => {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  if (s1 === s2) return 1;
  
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);
  
  return intersection.length / union.size;
};
```

### 6.4 Counterfactual Reasoner

**File**: `src/services/nexus/layer3/counterfactual.js`

```javascript
/**
 * Counterfactual Reasoner
 * 
 * Generates "what if" insights by analyzing what the user didn't do
 * on bad days that they typically do on good days.
 */

import { callGemini } from '../../ai/gemini';

/**
 * Identify missing interventions on a bad day
 */
export const identifyMissingInterventions = (badDayEntry, interventionData, typicalGoodDayActivities) => {
  const badDayText = (badDayEntry.content || badDayEntry.text || '').toLowerCase();
  const badDayMood = badDayEntry.mood || badDayEntry.analysis?.mood_score;
  
  const missing = [];
  
  // Check what usually happens on good days that didn't happen today
  for (const activity of typicalGoodDayActivities) {
    const activityPatterns = {
      'yoga': /yoga|flow|vinyasa/i,
      'sterling_walk': /sterling|walked.*dog|dog.*walk/i,
      'workout': /workout|gym|barrys|lift/i,
      'spencer': /spencer/i,
      'social': /dinner with|hung out|met up/i
    };
    
    const pattern = activityPatterns[activity];
    if (pattern && !pattern.test(badDayText)) {
      const effectiveness = interventionData?.interventions?.[activity]?.effectiveness?.global;
      
      if (effectiveness?.score > 0.7) {
        missing.push({
          activity,
          expectedMoodBoost: effectiveness.moodDelta?.mean || 10,
          effectivenessScore: effectiveness.score,
          typicalFrequency: interventionData.interventions[activity].totalOccurrences
        });
      }
    }
  }
  
  return missing.sort((a, b) => b.effectivenessScore - a.effectivenessScore);
};

/**
 * Generate counterfactual insight
 */
export const generateCounterfactualInsight = async (badDayEntry, missingInterventions, historicalData) => {
  if (missingInterventions.length === 0) return null;
  
  const topMissing = missingInterventions[0];
  
  const prompt = `Generate a "what if" insight for a user who had a low mood day.

BAD DAY CONTEXT:
- Date: ${badDayEntry.date}
- Mood: ${badDayEntry.mood}%
- Brief summary: "${(badDayEntry.content || '').slice(0, 200)}"

MISSING INTERVENTION:
- Activity: ${topMissing.activity}
- Historical effectiveness: ${Math.round(topMissing.effectivenessScore * 100)}%
- Typical mood boost: +${topMissing.expectedMoodBoost} points

Generate a brief, non-judgmental counterfactual insight:
1. Don't say "you should have" - that's not helpful
2. Frame as useful information for future similar situations
3. Be specific about the expected impact
4. Acknowledge that some days are just hard

Response format (JSON):
{
  "title": "A Pattern to Note",
  "insight": "On days like [this day], [activity] has historically helped you by [specific amount]. This isn't about what you 'should' have done—it's information for next time.",
  "futureAction": "When you notice similar feelings, [activity] might help",
  "probability": 0.73
}`;

  try {
    const response = await callGemini(prompt);
    return JSON.parse(response.replace(/```json?\n?|```/g, '').trim());
  } catch (error) {
    console.error('[Counterfactual] Insight generation failed:', error);
    return null;
  }
};
```

---

## Part 7: Layer 4 — Intervention Optimizer

### 7.1 Intervention Tracker

**File**: `src/services/nexus/layer4/interventionTracker.js`

```javascript
/**
 * Intervention Tracker
 * 
 * Tracks what activities/behaviors the user does and measures their
 * effectiveness on mood and biometrics.
 */

import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';

// ============================================================
// INTERVENTION DEFINITIONS
// ============================================================

export const INTERVENTION_PATTERNS = {
  // Physical
  yoga: {
    category: 'physical',
    patterns: [/yoga/i, /flow/i, /vinyasa/i, /c3/i, /pilates/i],
    measureWindow: { same_day: true, next_day: true }
  },
  barrys: {
    category: 'physical',
    patterns: [/barry'?s/i, /barrys/i],
    measureWindow: { same_day: true, next_day: true }
  },
  gym: {
    category: 'physical',
    patterns: [/gym/i, /lift/i, /workout/i, /lifted/i, /weights/i],
    measureWindow: { same_day: true, next_day: true }
  },
  walk: {
    category: 'physical',
    patterns: [/walk/i, /walked/i, /walking/i, /hike/i],
    measureWindow: { same_day: true }
  },
  bike: {
    category: 'physical',
    patterns: [/bike/i, /ride/i, /cycling/i, /rode/i],
    measureWindow: { same_day: true, next_day: true }
  },
  
  // Relational
  sterling_walk: {
    category: 'relational',
    patterns: [/sterling/i, /walked.*dog/i, /dog.*walk/i],
    measureWindow: { same_day: true, next_day: true }
  },
  spencer_time: {
    category: 'relational',
    patterns: [/spencer/i, /boyfriend/i],
    measureWindow: { same_day: true }
  },
  social: {
    category: 'relational',
    patterns: [/dinner with/i, /hung out/i, /met up/i, /friends/i, /called/i],
    measureWindow: { same_day: true }
  },
  
  // Behavioral
  acts_of_service: {
    category: 'behavioral',
    patterns: [/cleaned.*for/i, /helped/i, /made.*for/i, /cooked.*for/i],
    measureWindow: { same_day: true, next_day: true }
  },
  creative: {
    category: 'behavioral',
    patterns: [/paint/i, /built/i, /created/i, /echovault/i, /app/i],
    measureWindow: { same_day: true }
  },
  
  // Recovery
  rest_day: {
    category: 'recovery',
    patterns: [/rest/i, /took it easy/i, /relaxed/i, /lazy day/i],
    measureWindow: { same_day: true, next_day: true }
  },
  sleep_focus: {
    category: 'recovery',
    patterns: [/slept in/i, /extra sleep/i, /early to bed/i],
    measureWindow: { next_day: true }
  }
};

// ============================================================
// DETECTION & TRACKING
// ============================================================

/**
 * Detect interventions in an entry
 */
export const detectInterventionsInEntry = (entry) => {
  const text = entry.content || entry.text || '';
  const detected = [];
  
  for (const [name, config] of Object.entries(INTERVENTION_PATTERNS)) {
    const matched = config.patterns.some(pattern => pattern.test(text));
    
    if (matched) {
      detected.push({
        intervention: name,
        category: config.category,
        entryId: entry.id,
        entryDate: entry.date,
        entryMood: entry.mood || entry.analysis?.mood_score
      });
    }
  }
  
  return detected;
};

/**
 * Calculate intervention effectiveness from historical data
 */
export const calculateInterventionEffectiveness = (interventionOccurrences, allEntries, whoopHistory) => {
  const effectiveness = {
    global: { moodDelta: [], hrvDelta: [], recoveryDelta: [] },
    contextual: {}
  };
  
  for (const occurrence of interventionOccurrences) {
    const date = occurrence.entryDate;
    const nextDate = getNextDate(date);
    
    // Find same-day mood
    const sameDayMood = occurrence.entryMood;
    
    // Find baseline mood (last 7 days excluding this day)
    const baselineMoods = allEntries
      .filter(e => {
        const eDate = e.date || e.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
        return eDate !== date && isWithinDays(eDate, date, 7);
      })
      .map(e => e.mood || e.analysis?.mood_score)
      .filter(Boolean);
    
    const baselineMood = baselineMoods.length > 0 
      ? baselineMoods.reduce((a, b) => a + b, 0) / baselineMoods.length 
      : 50;
    
    const moodDelta = sameDayMood - baselineMood;
    effectiveness.global.moodDelta.push(moodDelta);
    
    // Whoop metrics
    if (whoopHistory) {
      const todayWhoop = whoopHistory[date];
      const nextDayWhoop = whoopHistory[nextDate];
      
      if (nextDayWhoop?.hrv?.average && todayWhoop?.hrv?.average) {
        effectiveness.global.hrvDelta.push(
          nextDayWhoop.hrv.average - todayWhoop.hrv.average
        );
      }
      
      if (nextDayWhoop?.recovery?.score) {
        effectiveness.global.recoveryDelta.push(nextDayWhoop.recovery.score);
      }
    }
  }
  
  // Calculate statistics
  const calcStats = (arr) => {
    if (arr.length === 0) return null;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = Math.sqrt(
      arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length
    );
    return { mean: Math.round(mean * 10) / 10, stdDev: Math.round(stdDev * 10) / 10 };
  };
  
  return {
    global: {
      moodDelta: calcStats(effectiveness.global.moodDelta),
      hrvDelta: calcStats(effectiveness.global.hrvDelta),
      nextDayRecovery: calcStats(effectiveness.global.recoveryDelta),
      score: calculateEffectivenessScore(effectiveness.global)
    },
    sampleSize: interventionOccurrences.length
  };
};

/**
 * Calculate overall effectiveness score (0-1)
 */
const calculateEffectivenessScore = (metrics) => {
  let score = 0.5;  // Neutral baseline
  
  // Mood impact
  if (metrics.moodDelta.length >= 3) {
    const avgMoodDelta = metrics.moodDelta.reduce((a, b) => a + b, 0) / metrics.moodDelta.length;
    score += Math.min(avgMoodDelta / 30, 0.25);  // Max +0.25 from mood
  }
  
  // HRV impact
  if (metrics.hrvDelta.length >= 3) {
    const avgHRVDelta = metrics.hrvDelta.reduce((a, b) => a + b, 0) / metrics.hrvDelta.length;
    score += Math.min(avgHRVDelta / 20, 0.15);  // Max +0.15 from HRV
  }
  
  // Recovery impact
  if (metrics.recoveryDelta.length >= 3) {
    const avgRecovery = metrics.recoveryDelta.reduce((a, b) => a + b, 0) / metrics.recoveryDelta.length;
    if (avgRecovery > 60) score += 0.1;
  }
  
  return Math.max(0, Math.min(1, score));
};

// ============================================================
// STORAGE
// ============================================================

/**
 * Update intervention data in Firestore
 */
export const updateInterventionData = async (userId, entries, whoopHistory) => {
  // Detect all interventions
  const allInterventions = {};
  
  for (const entry of entries) {
    const detected = detectInterventionsInEntry(entry);
    
    for (const intervention of detected) {
      const name = intervention.intervention;
      if (!allInterventions[name]) {
        allInterventions[name] = {
          category: intervention.category,
          occurrences: []
        };
      }
      allInterventions[name].occurrences.push(intervention);
    }
  }
  
  // Calculate effectiveness for each
  const interventionData = { interventions: {} };
  
  for (const [name, data] of Object.entries(allInterventions)) {
    const effectiveness = calculateInterventionEffectiveness(
      data.occurrences, 
      entries, 
      whoopHistory
    );
    
    interventionData.interventions[name] = {
      category: data.category,
      totalOccurrences: data.occurrences.length,
      effectiveness
    };
  }
  
  // Save to Firestore
  const interventionRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'interventions'
  );
  
  await setDoc(interventionRef, {
    ...interventionData,
    lastUpdated: Timestamp.now()
  });
  
  return interventionData;
};

/**
 * Get intervention data
 */
export const getInterventionData = async (userId) => {
  const interventionRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'interventions'
  );
  
  const doc_ = await getDoc(interventionRef);
  if (!doc_.exists()) return null;
  
  return doc_.data();
};

// Utilities
const getNextDate = (dateStr) => {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
};

const isWithinDays = (date1, date2, days) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffDays = Math.abs((d1 - d2) / (1000 * 60 * 60 * 24));
  return diffDays <= days;
};
```

### 7.2 Recommendation Engine

**File**: `src/services/nexus/layer4/recommendationEngine.js`

```javascript
/**
 * Recommendation Engine
 * 
 * Generates personalized, context-aware action recommendations
 * based on current state, intervention effectiveness, and timing.
 */

import { getInterventionData } from './interventionTracker';
import { detectCurrentState } from '../layer2/stateDetector';
import { getBaselines } from '../layer2/baselineManager';

// ============================================================
// RECOMMENDATION GENERATION
// ============================================================

/**
 * Generate recommendations for current context
 */
export const generateRecommendations = async (userId, context) => {
  const { currentState, whoopToday, recentMood, timeOfDay } = context;
  
  const interventionData = await getInterventionData(userId);
  if (!interventionData) return [];
  
  const recommendations = [];
  
  // Get state-specific interventions
  const stateInterventions = getInterventionsForState(
    currentState?.primary,
    interventionData
  );
  
  // Score and rank recommendations
  for (const intervention of stateInterventions) {
    const score = scoreRecommendation(intervention, context);
    
    if (score > 0.5) {
      recommendations.push({
        intervention: intervention.name,
        category: intervention.category,
        score,
        reasoning: generateReasoning(intervention, currentState, context),
        timing: suggestTiming(intervention, timeOfDay),
        expectedOutcome: predictOutcome(intervention, context)
      });
    }
  }
  
  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);  // Top 3 recommendations
};

/**
 * Get interventions that work well for a given state
 */
const getInterventionsForState = (state, interventionData) => {
  const stateInterventionMap = {
    'career_waiting': ['sterling_walk', 'yoga', 'creative', 'social'],
    'career_rejection': ['spencer_time', 'acts_of_service', 'yoga', 'social'],
    'low_mood': ['yoga', 'sterling_walk', 'spencer_time', 'acts_of_service'],
    'high_strain': ['rest_day', 'yoga', 'sleep_focus'],
    'recovery_mode': ['rest_day', 'walk', 'sleep_focus'],
    'burnout_risk': ['rest_day', 'sleep_focus', 'social'],
    'stable': ['gym', 'barrys', 'creative', 'social']
  };
  
  const relevantInterventions = stateInterventionMap[state] || stateInterventionMap['stable'];
  
  return relevantInterventions
    .map(name => ({
      name,
      ...(interventionData.interventions?.[name] || {})
    }))
    .filter(i => i.effectiveness);
};

/**
 * Score a recommendation based on context
 */
const scoreRecommendation = (intervention, context) => {
  const { currentState, whoopToday, recentMood, timeOfDay } = context;
  
  let score = intervention.effectiveness?.global?.score || 0.5;
  
  // Boost for context-specific effectiveness
  if (intervention.effectiveness?.contextual?.[`during:${currentState?.primary}`]) {
    const contextScore = intervention.effectiveness.contextual[`during:${currentState.primary}`].score;
    score = Math.max(score, contextScore);
  }
  
  // Adjust for time of day
  const timeBoost = getTimeBoost(intervention.name, timeOfDay);
  score += timeBoost;
  
  // Adjust for current recovery
  if (whoopToday?.recovery?.score) {
    if (whoopToday.recovery.score < 40 && intervention.category === 'physical') {
      score -= 0.2;  // Reduce physical recommendations on low recovery
    }
    if (whoopToday.recovery.score < 40 && intervention.category === 'recovery') {
      score += 0.2;  // Boost recovery recommendations
    }
  }
  
  // Adjust for recent mood
  if (recentMood < 40 && intervention.name === 'acts_of_service') {
    score += 0.15;  // This user's pattern shows acts of service help during low mood
  }
  
  return Math.max(0, Math.min(1, score));
};

/**
 * Get time-of-day boost for intervention
 */
const getTimeBoost = (intervention, timeOfDay) => {
  const optimalTimes = {
    yoga: ['morning', 'afternoon'],
    barrys: ['morning'],
    sterling_walk: ['morning', 'evening'],
    gym: ['morning', 'afternoon'],
    rest_day: ['any'],
    social: ['evening'],
    creative: ['afternoon', 'evening']
  };
  
  const optimal = optimalTimes[intervention] || ['any'];
  if (optimal.includes('any') || optimal.includes(timeOfDay)) {
    return 0.1;
  }
  return -0.05;
};

/**
 * Generate reasoning for recommendation
 */
const generateReasoning = (intervention, currentState, context) => {
  const templates = {
    'career_waiting': {
      'sterling_walk': `You're in a waiting period with elevated stress markers. Sterling walks have historically recovered your HRV by ${intervention.effectiveness?.global?.hrvDelta?.mean || 12}ms within 24 hours.`,
      'yoga': `During career uncertainty, yoga has been your most effective physical reset, with a ${Math.round((intervention.effectiveness?.global?.score || 0.8) * 100)}% effectiveness rate.`,
      'creative': `Working on creative projects provides a sense of agency when career outcomes feel out of your control.`
    },
    'low_mood': {
      'acts_of_service': `When your mood is low, doing something for someone else has historically boosted your mood by ${intervention.effectiveness?.global?.moodDelta?.mean || 35} points within 48 hours.`,
      'spencer_time': `Spencer's presence has a stabilizing effect—your mood floor is 50% when he's mentioned.`
    }
  };
  
  return templates[currentState?.primary]?.[intervention.name] || 
    `Based on your history, ${intervention.name.replace('_', ' ')} has a ${Math.round((intervention.effectiveness?.global?.score || 0.7) * 100)}% effectiveness rate.`;
};

/**
 * Suggest optimal timing
 */
const suggestTiming = (intervention, currentTimeOfDay) => {
  const optimalTiming = {
    yoga: 'This morning if possible, or early afternoon',
    sterling_walk: 'Before 7pm for optimal HRV recovery',
    barrys: 'Morning classes tend to set a better tone for your day',
    rest_day: 'Today and tomorrow if needed',
    social: 'This evening',
    creative: 'When you have 30+ uninterrupted minutes'
  };
  
  return optimalTiming[intervention.name] || 'When you have time today';
};

/**
 * Predict outcome if recommendation is followed
 */
const predictOutcome = (intervention, context) => {
  const moodDelta = intervention.effectiveness?.global?.moodDelta?.mean || 10;
  const hrvDelta = intervention.effectiveness?.global?.hrvDelta?.mean;
  
  let prediction = `Expected mood improvement: +${Math.round(moodDelta)} points`;
  
  if (hrvDelta) {
    prediction += `. HRV recovery: +${Math.round(hrvDelta)}ms within 24 hours`;
  }
  
  return {
    description: prediction,
    confidence: intervention.effectiveness?.global?.score || 0.7,
    timeframe: '24-48 hours'
  };
};
```

---

## Part 8: Main Orchestrator

**File**: `src/services/nexus/orchestrator.js`

```javascript
/**
 * Nexus Orchestrator
 * 
 * Coordinates all four layers to generate insights.
 * This is the main entry point for insight generation.
 */

import { detectPatternsInPeriod } from './layer1/patternDetector';
import { identifyThreadAssociation, getActiveThreads } from './layer1/threadManager';
import { extractSomaticSignals } from './layer1/somaticExtractor';

import { detectCurrentState, updateCurrentState } from './layer2/stateDetector';
import { getBaselines, calculateAndSaveBaselines, compareToBaseline } from './layer2/baselineManager';

import { generateCausalSynthesis, generateNarrativeArcInsight } from './layer3/synthesizer';
import { detectMetaPatterns, generateMetaPatternInsight } from './layer3/crossThreadDetector';
import { extractBeliefsFromEntry, refineBeliefsWithLLM, validateBeliefAgainstData, generateDissonanceInsight, saveBeliefs, getBeliefs } from './layer3/beliefDissonance';
import { identifyMissingInterventions, generateCounterfactualInsight } from './layer3/counterfactual';

import { updateInterventionData, getInterventionData } from './layer4/interventionTracker';
import { generateRecommendations } from './layer4/recommendationEngine';

import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getWhoopSummary, getWhoopHistory } from '../health/whoop';

// ============================================================
// MAIN ORCHESTRATION
// ============================================================

/**
 * Run full insight generation pipeline
 * Called on dashboard load or manual refresh
 */
export const generateInsights = async (userId, options = {}) => {
  console.log('[Orchestrator] Starting insight generation...');
  
  const startTime = Date.now();
  const insights = [];
  const errors = [];
  
  try {
    // ========== GATHER DATA ==========
    
    // Fetch all required data in parallel
    const [
      entries,
      threads,
      baselines,
      whoopToday,
      whoopHistory,
      interventionData,
      beliefs,
      settings
    ] = await Promise.all([
      fetchRecentEntries(userId, 30),
      getActiveThreads(userId),
      getBaselines(userId),
      getWhoopSummary(),
      getWhoopHistory(userId, 30),
      getInterventionData(userId),
      getBeliefs(userId),
      getUserSettings(userId)
    ]);
    
    // Check if we have enough data
    const whoopDays = Object.keys(whoopHistory || {}).length;
    const dataStatus = {
      entries: entries.length,
      threads: threads.length,
      whoopDays,
      hasBaselines: !!baselines,
      isCalibrating: whoopDays < 14
    };
    
    console.log('[Orchestrator] Data status:', dataStatus);
    
    // ========== LAYER 1: PATTERN DETECTION ==========
    
    const patterns = await detectPatternsInPeriod(userId, entries, whoopHistory);
    
    // ========== LAYER 2: TEMPORAL REASONING ==========
    
    // Detect current state
    const currentState = await detectCurrentState(userId, entries, whoopToday, threads);
    await updateCurrentState(userId, currentState);
    
    // Recalculate baselines if stale (older than 24h)
    if (!baselines || isStale(baselines.calculatedAt, 24)) {
      await calculateAndSaveBaselines(userId);
    }
    
    // ========== LAYER 3: CAUSAL SYNTHESIS ==========
    
    // Build context for synthesis
    const synthesisContext = {
      recentEntries: entries,
      activeThreads: threads,
      currentState,
      baselines,
      whoopToday,
      whoopHistory,
      beliefData: beliefs,
      interventionData
    };
    
    // Generate primary causal synthesis insight
    if (entries.length >= 10 && (!dataStatus.isCalibrating || entries.length >= 20)) {
      const synthesis = await generateCausalSynthesis(userId, synthesisContext);
      if (synthesis.success) {
        insights.push({
          ...synthesis.insight,
          priority: 1
        });
      } else if (synthesis.fallback) {
        insights.push({
          ...synthesis.fallback,
          priority: 2
        });
      }
    }
    
    // Generate narrative arc insight if applicable
    const longestThread = threads
      .filter(t => t.predecessorId)  // Has history
      .sort((a, b) => b.entryCount - a.entryCount)[0];
    
    if (longestThread) {
      const arcInsight = await generateNarrativeArcInsight(userId, longestThread.id);
      if (arcInsight) {
        insights.push({
          type: 'narrative_arc',
          ...arcInsight,
          priority: 2
        });
      }
    }
    
    // Detect and generate meta-pattern insights
    const metaPatterns = await detectMetaPatterns(userId, threads, entries);
    if (metaPatterns.length > 0) {
      const metaInsight = await generateMetaPatternInsight(
        userId, 
        metaPatterns[0], 
        synthesisContext
      );
      if (metaInsight) {
        insights.push({
          ...metaInsight,
          priority: 2
        });
      }
    }
    
    // Generate belief dissonance insight (if enabled)
    if (settings?.features?.beliefDissonanceInsights?.enabled !== false) {
      // Extract new beliefs from recent entries
      for (const entry of entries.slice(-5)) {
        const rawBeliefs = extractBeliefsFromEntry(entry.content || entry.text || '', entry.id);
        if (rawBeliefs.length > 0) {
          const refined = await refineBeliefsWithLLM(rawBeliefs, entry.content || entry.text);
          await saveBeliefs(userId, refined);
        }
      }
      
      // Validate existing beliefs and generate insights
      const allBeliefs = await getBeliefs(userId);
      for (const belief of allBeliefs.slice(0, 3)) {  // Check top 3
        const validation = await validateBeliefAgainstData(belief, { entries, baselines, threads });
        
        if (validation.dissonanceScore > 0.5) {
          const dissonanceInsight = await generateDissonanceInsight(
            belief, 
            validation, 
            { ...settings, currentMood: entries[0]?.mood }
          );
          
          if (dissonanceInsight && !dissonanceInsight.queued) {
            insights.push({
              ...dissonanceInsight,
              priority: 3
            });
          }
        }
      }
    }
    
    // ========== LAYER 4: INTERVENTION OPTIMIZATION ==========
    
    // Update intervention effectiveness data
    await updateInterventionData(userId, entries, whoopHistory);
    
    // Generate recommendations
    const recommendations = await generateRecommendations(userId, {
      currentState,
      whoopToday,
      recentMood: entries[0]?.mood || 50,
      timeOfDay: getTimeOfDay()
    });
    
    // Add top recommendation as an insight
    if (recommendations.length > 0) {
      insights.push({
        type: 'intervention',
        title: 'Recommended Action',
        ...recommendations[0],
        priority: 1
      });
    }
    
    // ========== CALIBRATION STATE ==========
    
    // If still calibrating, add calibration insight
    if (dataStatus.isCalibrating) {
      insights.push({
        type: 'calibration',
        title: 'Learning Your Baseline',
        summary: `${14 - whoopDays} days until full biometric insights`,
        body: `Your Whoop is teaching me what "normal" looks like for you. Keep logging to unlock deeper mind-body insights.`,
        progress: whoopDays / 14,
        priority: 0
      });
    }
    
    // ========== SAVE & RETURN ==========
    
    // Sort by priority
    insights.sort((a, b) => a.priority - b.priority);
    
    // Save insights to Firestore
    await saveInsights(userId, insights);
    
    const duration = Date.now() - startTime;
    console.log(`[Orchestrator] Generated ${insights.length} insights in ${duration}ms`);
    
    return {
      success: true,
      insights,
      dataStatus,
      generatedAt: new Date().toISOString(),
      duration
    };
    
  } catch (error) {
    console.error('[Orchestrator] Insight generation failed:', error);
    errors.push(error.message);
    
    return {
      success: false,
      insights: [],
      errors,
      generatedAt: new Date().toISOString()
    };
  }
};

/**
 * Run incremental insight update after new entry
 * Lighter weight than full generation
 */
export const updateInsightsForNewEntry = async (userId, entryId, entryText, entrySentiment) => {
  console.log('[Orchestrator] Updating insights for new entry...');
  
  try {
    // Thread identification
    const threadResult = await identifyThreadAssociation(userId, entryId, entryText, entrySentiment);
    
    // Extract and save beliefs
    const rawBeliefs = extractBeliefsFromEntry(entryText, entryId);
    if (rawBeliefs.length > 0) {
      const refined = await refineBeliefsWithLLM(rawBeliefs, entryText);
      await saveBeliefs(userId, refined);
    }
    
    // Mark insights as stale (will regenerate on next dashboard load)
    await markInsightsStale(userId);
    
    return {
      success: true,
      threadResult
    };
  } catch (error) {
    console.error('[Orchestrator] Incremental update failed:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

const fetchRecentEntries = async (userId, days) => {
  // Implementation depends on your entry storage
  // This is a placeholder
  return [];
};

const getUserSettings = async (userId) => {
  const settingsRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', 'nexus'
  );
  const settingsDoc = await getDoc(settingsRef);
  return settingsDoc.exists() ? settingsDoc.data() : getDefaultSettings();
};

const getDefaultSettings = () => ({
  features: {
    beliefDissonanceInsights: { enabled: true },  // ON by default per requirements
    interventionRecommendations: { enabled: true },
    narrativeArcTracking: { enabled: true },
    counterfactualInsights: { enabled: true }
  },
  preferences: {
    insightDepth: 'comprehensive',
    recommendationStyle: 'specific',
    challengeFrequency: 'moderate',
    moodGateThreshold: 50
  }
});

const saveInsights = async (userId, insights) => {
  const insightRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights'
  );
  
  await setDoc(insightRef, {
    active: insights,
    generatedAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)  // 24h
  }, { merge: true });
};

const markInsightsStale = async (userId) => {
  const insightRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights'
  );
  
  await setDoc(insightRef, {
    stale: true,
    staleAt: Timestamp.now()
  }, { merge: true });
};

const isStale = (timestamp, hours) => {
  if (!timestamp) return true;
  const age = Date.now() - timestamp.toMillis();
  return age > hours * 60 * 60 * 1000;
};

const getTimeOfDay = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
};
```

---

## Part 9: Settings UI

**File**: `src/components/settings/NexusSettings.jsx`

```jsx
/**
 * Nexus Settings Component
 * 
 * User controls for Nexus 2.0 features
 */

import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { Switch } from '../ui/Switch';
import { Slider } from '../ui/Slider';
import { 
  Brain, 
  Heart, 
  Lightbulb, 
  Shield, 
  Sparkles,
  AlertTriangle,
  Info
} from 'lucide-react';

const NexusSettings = ({ user }) => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      if (!user?.uid) return;
      
      const settingsRef = doc(
        db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'settings', 'nexus'
      );
      
      const settingsDoc = await getDoc(settingsRef);
      
      if (settingsDoc.exists()) {
        setSettings(settingsDoc.data());
      } else {
        // Set defaults
        setSettings({
          features: {
            beliefDissonanceInsights: { enabled: true },
            interventionRecommendations: { enabled: true },
            narrativeArcTracking: { enabled: true },
            counterfactualInsights: { enabled: true }
          },
          preferences: {
            insightDepth: 'comprehensive',
            moodGateThreshold: 50
          }
        });
      }
      
      setLoading(false);
    };
    
    loadSettings();
  }, [user?.uid]);
  
  // Save settings
  const saveSettings = async (newSettings) => {
    if (!user?.uid) return;
    
    setSaving(true);
    
    const settingsRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'settings', 'nexus'
    );
    
    await setDoc(settingsRef, {
      ...newSettings,
      updatedAt: Timestamp.now()
    });
    
    setSettings(newSettings);
    setSaving(false);
  };
  
  // Toggle feature
  const toggleFeature = (featureName) => {
    const newSettings = {
      ...settings,
      features: {
        ...settings.features,
        [featureName]: {
          ...settings.features[featureName],
          enabled: !settings.features[featureName]?.enabled
        }
      }
    };
    saveSettings(newSettings);
  };
  
  // Update preference
  const updatePreference = (prefName, value) => {
    const newSettings = {
      ...settings,
      preferences: {
        ...settings.preferences,
        [prefName]: value
      }
    };
    saveSettings(newSettings);
  };
  
  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-warm-400 border-t-transparent rounded-full" />
      </div>
    );
  }
  
  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-xl">
          <Brain className="w-6 h-6 text-purple-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-warm-100">Nexus Insights</h2>
          <p className="text-sm text-warm-400">Control how EchoVault analyzes your patterns</p>
        </div>
      </div>
      
      {/* Feature Toggles */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-warm-300 uppercase tracking-wider">
          Insight Types
        </h3>
        
        {/* Belief Dissonance */}
        <FeatureToggle
          icon={<Lightbulb className="w-5 h-5" />}
          title="Deep Pattern Insights"
          description="Surface patterns that might challenge your self-perception. These insights are designed to promote growth, not judgment."
          enabled={settings.features.beliefDissonanceInsights?.enabled}
          onToggle={() => toggleFeature('beliefDissonanceInsights')}
          color="amber"
          badge="Recommended"
        />
        
        {/* Intervention Recommendations */}
        <FeatureToggle
          icon={<Heart className="w-5 h-5" />}
          title="Action Recommendations"
          description="Get personalized suggestions based on what has historically worked for you."
          enabled={settings.features.interventionRecommendations?.enabled}
          onToggle={() => toggleFeature('interventionRecommendations')}
          color="rose"
        />
        
        {/* Narrative Arc */}
        <FeatureToggle
          icon={<Sparkles className="w-5 h-5" />}
          title="Narrative Arc Tracking"
          description="Track how your life stories evolve over time and identify growth patterns."
          enabled={settings.features.narrativeArcTracking?.enabled}
          onToggle={() => toggleFeature('narrativeArcTracking')}
          color="purple"
        />
        
        {/* Counterfactual */}
        <FeatureToggle
          icon={<AlertTriangle className="w-5 h-5" />}
          title="'What If' Insights"
          description="Learn from days that didn't go well by identifying what might have helped."
          enabled={settings.features.counterfactualInsights?.enabled}
          onToggle={() => toggleFeature('counterfactualInsights')}
          color="blue"
        />
      </div>
      
      {/* Preferences */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-warm-300 uppercase tracking-wider">
          Preferences
        </h3>
        
        {/* Mood Gate */}
        <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700/50">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-green-400 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-warm-200">Mood Gate</span>
                <span className="text-sm text-warm-400">
                  {settings.preferences.moodGateThreshold}%
                </span>
              </div>
              <p className="text-sm text-warm-400 mt-1 mb-3">
                Deep pattern insights won't be shown when your mood is below this threshold
              </p>
              <Slider
                value={settings.preferences.moodGateThreshold}
                onChange={(value) => updatePreference('moodGateThreshold', value)}
                min={30}
                max={70}
                step={5}
              />
              <div className="flex justify-between text-xs text-warm-500 mt-1">
                <span>More insights</span>
                <span>More protection</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Info Box */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
          <div className="flex gap-3">
            <Info className="w-5 h-5 text-blue-400 flex-shrink-0" />
            <div className="text-sm text-blue-200">
              <p className="font-medium mb-1">About Deep Pattern Insights</p>
              <p className="text-blue-300/80">
                These insights identify gaps between your stated beliefs and behavioral data. 
                They're framed as invitations to explore, not judgments. You can turn them off 
                anytime if they don't feel helpful.
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Save Indicator */}
      {saving && (
        <div className="fixed bottom-4 right-4 bg-warm-800 border border-warm-700 rounded-lg px-4 py-2 flex items-center gap-2">
          <div className="animate-spin w-4 h-4 border-2 border-warm-400 border-t-transparent rounded-full" />
          <span className="text-sm text-warm-300">Saving...</span>
        </div>
      )}
    </div>
  );
};

/**
 * Feature Toggle Component
 */
const FeatureToggle = ({ icon, title, description, enabled, onToggle, color, badge }) => {
  const colorClasses = {
    amber: 'text-amber-400 bg-amber-500/20',
    rose: 'text-rose-400 bg-rose-500/20',
    purple: 'text-purple-400 bg-purple-500/20',
    blue: 'text-blue-400 bg-blue-500/20'
  };
  
  return (
    <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700/50">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-warm-200">{title}</span>
            {badge && (
              <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded-full">
                {badge}
              </span>
            )}
          </div>
          <p className="text-sm text-warm-400 mt-1">{description}</p>
        </div>
        <Switch checked={enabled} onChange={onToggle} />
      </div>
    </div>
  );
};

export default NexusSettings;
```

---

## Part 10: Implementation Phases

### Phase 1: Foundation (Days 1-3)

**Objective**: Replace existing patterns system with Layer 1 + Layer 2

```
Tasks:
[ ] Delete old pattern files
[ ] Create /nexus directory structure
[ ] Implement Layer 1: patternDetector.js
[ ] Implement Layer 1: somaticExtractor.js  
[ ] Implement Layer 1: threadManager.js (enhanced)
[ ] Implement Layer 2: stateDetector.js
[ ] Implement Layer 2: baselineManager.js
[ ] Create Firestore schemas
[ ] Test with your existing data
```

### Phase 2: Synthesis (Days 4-6)

**Objective**: Implement Layer 3 LLM synthesis

```
Tasks:
[ ] Implement Layer 3: synthesizer.js
[ ] Implement Layer 3: crossThreadDetector.js
[ ] Implement Layer 3: beliefDissonance.js
[ ] Implement Layer 3: counterfactual.js
[ ] Create and test all LLM prompts
[ ] Implement prompt fallbacks
```

### Phase 3: Optimization (Days 7-8)

**Objective**: Implement Layer 4 and orchestration

```
Tasks:
[ ] Implement Layer 4: interventionTracker.js
[ ] Implement Layer 4: recommendationEngine.js
[ ] Implement orchestrator.js
[ ] Implement useNexusInsights.js hook
[ ] Test full pipeline
```

### Phase 4: UI & Polish (Days 9-10)

**Objective**: Build UI components and settings

```
Tasks:
[ ] Create NexusInsightWidget.jsx
[ ] Create NexusSettings.jsx
[ ] Add settings to Settings page
[ ] Implement calibration UI
[ ] Test all user flows
[ ] Performance optimization
```

### Phase 5: Migration & Launch (Days 11-12)

**Objective**: Migrate existing users and launch

```
Tasks:
[ ] Create migration script for existing data
[ ] Backfill threads from historical entries
[ ] Calculate initial baselines
[ ] Run full pipeline for existing users
[ ] Monitor and fix issues
[ ] Document everything
```

---

## Part 11: Cost Analysis

### Per-User Monthly Cost Breakdown

| Component | Tokens/Call | Calls/Month | Cost/User |
|-----------|-------------|-------------|-----------|
| Thread Identification | ~800 | 30 | $0.12 |
| Causal Synthesis | ~2,500 | 30 | $0.75 |
| Belief Extraction | ~1,000 | 15 | $0.15 |
| Counterfactual | ~1,500 | 8 | $0.12 |
| Meta-Pattern | ~1,500 | 4 | $0.06 |
| **Total** | | | **$1.20** |

### At Scale

| Users | Monthly Cost | Revenue @ $9.99 | Margin |
|-------|--------------|-----------------|--------|
| 100 | $120 | $999 | 88% |
| 1,000 | $1,200 | $9,990 | 88% |
| 10,000 | $12,000 | $99,900 | 88% |

### Optimization Strategies

1. **Caching**: Cache synthesis results for 24h (reduces calls by 60%)
2. **Batching**: Run synthesis nightly instead of real-time
3. **Tiering**: Free tier gets basic insights, paid gets full synthesis

---

## Part 12: Testing Checklist

### Unit Tests

```
[ ] patternDetector.detectPatternsInEntry()
[ ] somaticExtractor.extractSomaticSignals()
[ ] threadManager.findSimilarThread()
[ ] threadManager.identifyThreadAssociation()
[ ] stateDetector.detectCurrentState()
[ ] baselineManager.calculateStats()
[ ] baselineManager.compareToBaseline()
[ ] beliefDissonance.extractBeliefsFromEntry()
[ ] beliefDissonance.validateBeliefAgainstData()
[ ] interventionTracker.detectInterventionsInEntry()
```

### Integration Tests

```
[ ] Full pipeline: entry → thread → insight
[ ] Whoop integration
[ ] Firestore read/write
[ ] LLM calls with retries
[ ] Settings persistence
```

### User Flow Tests

```
[ ] New user with no data → calibration UI
[ ] User with entries, no Whoop → partial insights
[ ] User with full data → full insights
[ ] Low mood → belief insights gated
[ ] Settings toggle → feature disabled
```

---

## Appendix: Example Insights

### Example 1: Causal Synthesis

```json
{
  "type": "causal_synthesis",
  "title": "The Sterling Stabilization Loop",
  "summary": "Caring for Sterling is your most effective off-switch for career stress",
  "body": "While you describe yourself as being 'patient' regarding the Anthropic and Cursor feedback loops, your Whoop data shows your Resting Heart Rate has trended 4bpm higher during these 'waiting' periods—a sign of subconscious performance anxiety.\n\nHowever, on days you mention Sterling (specifically the 'grooming' and 'walking' entries), your HRV recovers by an average of 12ms within 24 hours, effectively neutralizing that work-related strain.\n\nThe Nexus: Caring for Sterling isn't just a chore; it is your most effective physical 'off-switch' for career-related nervous system tension.",
  "mechanism": "Pet interaction activates parasympathetic response, counteracting sympathetic arousal from career uncertainty",
  "evidence": {
    "narrative": ["waiting period mentions", "Sterling entries"],
    "biometric": ["RHR +4bpm during waiting", "HRV +12ms after Sterling"],
    "statistical": { "correlation": 0.78, "sampleSize": 18, "confidence": 0.85 }
  },
  "recommendation": {
    "action": "Prioritize Sterling's long walk this evening",
    "timing": "Before 7pm for optimal HRV recovery",
    "reasoning": "You're in a waiting period with elevated RHR. Sterling walks are your most effective intervention.",
    "expectedOutcome": "+12ms HRV within 24 hours",
    "confidence": 0.85
  }
}
```

### Example 2: Belief Dissonance

```json
{
  "type": "belief_dissonance",
  "title": "A Pattern Worth Noticing",
  "opening": "On December 4th, you reflected: 'I'm okay with my sense of self being tied to external success'",
  "observation": "Over the past 6 weeks, your mood has correlated with career news at r=0.84—one of the strongest correlations in your data. The Databricks rejection caused a 70-point mood drop.",
  "normalization": "This isn't a contradiction to resolve. The gap between what we believe and how we feel is part of being human.",
  "invitation": "What do you make of this? Is decoupling self-worth from career outcomes something you want to explore, or is the current coupling actually serving you?",
  "journalPrompt": "What would it feel like if my baseline self-worth wasn't affected by career outcomes?",
  "confidence": 0.75
}
```

### Example 3: Narrative Arc

```json
{
  "type": "narrative_arc",
  "title": "The Career Resilience Arc",
  "summary": "Your recovery time from setbacks has shortened dramatically",
  "body": "Your job search has evolved through 4 distinct chapters:\n\n1. Initial Anxiety (Oct): Baseline mood 45%\n2. Databricks Hope (Nov): Peaked at 90%\n3. Rejection Processing (Dec): Dropped to 20%\n4. Anthropic Pivot (Jan): Stabilized at 70%\n\nThe Pattern: Your recovery time has shortened. The Google firing took 3 months to process emotionally. Databricks took 3 weeks. You're building emotional antibodies.",
  "growth_metric": "Recovery time shortened from 12 weeks to 3 weeks",
  "strength_identified": "Pivot resilience - ability to redirect energy to new opportunities quickly"
}
```

---

## Final Notes

This document represents a complete rebuild of EchoVault's insight engine. The key differences from the current system:

1. **Four-layer architecture** instead of flat correlation rules
2. **Personal baselines** instead of population averages
3. **LLM-powered synthesis** instead of template strings
4. **Psychological mechanisms** instead of just correlations
5. **Actionable recommendations** with predicted outcomes
6. **Belief-data dissonance** detection (opt-in, on by default)
7. **Thread metamorphosis** for tracking life story evolution

The system is designed to scale to 100k+ users while maintaining the depth of insight that makes it feel like having a personal analyst.

Build it expensive first. Feel the magic. Then optimize.
