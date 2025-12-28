# EchoVault Feature Implementation Plan
## Burnout Prevention, Leadership Support & Holistic Wellness Integration

### Executive Summary

This document outlines the implementation plan for 8 major feature enhancements to EchoVault, designed to transform it from a reactive journaling tool into a proactive mental wellness companion. The features leverage existing infrastructure while introducing new modules for burnout prediction, leadership support, environmental awareness, value tracking, anticipatory support, performance optimization, social connection, and biometric integration.

---

## Table of Contents

1. [Feature 1: Burnout Prediction and Proactive Shelter Mode](#feature-1-burnout-prediction-and-proactive-shelter-mode)
2. [Feature 2: Leadership and Management Support](#feature-2-leadership-and-management-support)
3. [Feature 3: SAD and Environmental Contextualization](#feature-3-sad-and-environmental-contextualization)
4. [Feature 4: Value-Alignment Tracking (ACT Enhancement)](#feature-4-value-alignment-tracking-act-enhancement)
5. [Feature 5: Anticipatory Anxiety and "Future Self" Check-in](#feature-5-anticipatory-anxiety-and-future-self-check-in)
6. [Feature 6: Vector Database Migration](#feature-6-vector-database-migration)
7. [Feature 7: Social Connection Nudges](#feature-7-social-connection-nudges)
8. [Feature 8: HealthKit Integration](#feature-8-healthkit-integration)
9. [Implementation Priority & Dependencies](#implementation-priority--dependencies)
10. [Technical Architecture Overview](#technical-architecture-overview)

---

## Feature 1: Burnout Prediction and Proactive Shelter Mode

### Current State Analysis

**Existing Infrastructure:**
- `computeMoodTrajectory()` in `/src/services/analysis/index.js` calculates 7-day mood trends
- `ShelterView.jsx` exists but only triggers on low mood score (<0.35)
- Tag extraction for `@project:X`, `@activity:X` already implemented
- Entry analysis extracts `mood_score`, `entry_type`, and framework

**Gap Analysis:**
- No dedicated burnout risk scoring system
- No detection of work-related stress patterns (overtime, fatigue keywords)
- ShelterView trigger is reactive (low mood) not predictive (declining trajectory)
- No distinction between general low mood and work-induced burnout

### Implementation Plan

#### 1.1 Burnout Risk Score Service

**New File:** `/src/services/burnout/burnoutRiskScore.js`

```javascript
// Core burnout detection logic
export const computeBurnoutRiskScore = (entries, options = {}) => {
  // Input: recent 14 entries
  // Output: {
  //   riskScore: 0-1,
  //   riskLevel: 'low' | 'moderate' | 'high' | 'critical',
  //   signals: [],
  //   recommendation: string,
  //   triggerShelterMode: boolean
  // }
}

export const BURNOUT_INDICATORS = {
  // Keyword patterns
  fatigue: ['tired', 'exhausted', 'drained', 'burned out', 'burnout', 'can\'t keep up'],
  overwork: ['overtime', '10 PM', 'late night', 'weekend work', 'no break', 'back-to-back'],
  physical: ['eyes hurt', 'headache', 'can\'t sleep', 'insomnia', 'stress eating'],
  emotional: ['overwhelmed', 'drowning', 'nothing left', 'running on empty'],

  // Tag patterns
  workTags: ['@project:', '@deadline:', '@meeting:', '@1on1:'],
  stressTags: ['overtime', 'rush', 'urgent', 'ASAP']
}
```

**Algorithm Design:**

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Mood Trajectory | 25% | Map 'declining' → 0.8, 'stable' → 0.4, 'improving' → 0.1 |
| Fatigue Keywords | 20% | Frequency of fatigue indicators per entry |
| Overwork Indicators | 20% | Late-night entries, weekend entries, overtime mentions |
| Physical Symptoms | 15% | Eyes hurt, headache, sleep disruption mentions |
| Work Tag Density | 10% | Ratio of work-related tags vs personal tags |
| Low Streak | 10% | Consecutive days below 0.4 mood |

**Risk Level Thresholds:**
- `0.0 - 0.3`: Low risk (green)
- `0.3 - 0.5`: Moderate risk (yellow) - gentle nudge
- `0.5 - 0.7`: High risk (orange) - suggest break
- `0.7 - 1.0`: Critical (red) - show strong nudge banner (see 1.2)

#### 1.2 Soft Block UX Pattern (Critical Refinement)

**Problem:** Auto-triggering Shelter Mode during high-stress projects (like "Project Orion") could be jarring and anxiety-inducing if the user is mid-task.

**Solution:** Implement a "Strong Nudge" pattern instead of forced transition.

**New Component:** `/src/components/shelter/BurnoutNudgeBanner.jsx`

```javascript
const BurnoutNudgeBanner = ({ burnoutRisk, onEnterShelter, onDismiss }) => {
  const [dismissCount, setDismissCount] = useState(0);
  const [acknowledgmentRequired, setAcknowledgmentRequired] = useState(false);

  // After 3 dismissals, require acknowledgment
  const handleDismiss = () => {
    if (dismissCount >= 2) {
      setAcknowledgmentRequired(true);
    } else {
      setDismissCount(prev => prev + 1);
      onDismiss();
    }
  };

  return (
    <PersistentBanner priority="critical" dismissable={!acknowledgmentRequired}>
      <AlertTriangle className="text-amber-500" />
      <div>
        <h3>Burnout Warning</h3>
        <p>
          Our signals suggest you're reaching a critical burnout threshold.
          We recommend taking a break to decompress.
        </p>
        <div className="detected-signals">
          {burnoutRisk.signals.map(signal => (
            <Badge key={signal}>{signal}</Badge>
          ))}
        </div>
      </div>

      <div className="actions">
        <Button variant="primary" onClick={onEnterShelter}>
          Enter Shelter Mode
        </Button>
        {!acknowledgmentRequired ? (
          <Button variant="ghost" onClick={handleDismiss}>
            Keep Journaling
          </Button>
        ) : (
          <AcknowledgmentPrompt
            message="I understand I may be at risk for burnout"
            onAcknowledge={() => {
              setAcknowledgmentRequired(false);
              onDismiss();
            }}
          />
        )}
      </div>
    </PersistentBanner>
  );
};
```

**Escalation Ladder:**
1. **First Detection (0.5-0.7):** Gentle suggestion in dashboard
2. **Second Detection (0.7+):** Persistent banner, dismissable
3. **Third Dismissal:** Requires acknowledgment checkbox
4. **Continued Pattern:** Logs "burnout_warning_dismissed" for later reflection

**Database Tracking:**

```javascript
// Add to burnout_tracking collection
{
  // ... existing fields ...
  nudgesShown: number,
  nudgesDismissed: number,
  acknowledgmentGiven: boolean,
  userChoice: 'entered_shelter' | 'continued_journaling' | 'acknowledged_risk'
}
```

#### 1.3 Enhanced ShelterView Trigger Logic

**Modified File:** `/src/components/dashboard/DayDashboard.jsx`

```javascript
// New trigger conditions (OR logic)
const shouldShowShelterView = () => {
  return (
    currentMoodScore < 0.35 ||  // Original reactive trigger
    (burnoutRisk.riskLevel === 'critical') ||  // Burnout-specific trigger
    (moodTrajectory.trend === 'declining' &&
     burnoutRisk.riskLevel === 'high' &&
     hasFatigueTags(recentEntries))
  );
}
```

#### 1.3 Enhanced ShelterView Component

**Modified File:** `/src/components/dashboard/views/ShelterView.jsx`

**New Sections:**

1. **Burnout Context Display**
   - Show detected burnout signals
   - Display work/life balance indicator
   - Show streak of overwork days

2. **Decompression Focus Mode**
   - Hide all work-related entries
   - Simplify UI to only show:
     - Breathing exercises (4-7-8, box breathing)
     - Grounding exercises (5-4-3-2-1)
     - Gentle movement prompts
     - Nature/calming visuals

3. **Exit Criteria**
   - Mood stabilizes above 0.5 for 2+ entries
   - User completes 3+ decompression activities
   - Manual override with acknowledgment

**New Subcomponents:**

```
/src/components/shelter/
├── BurnoutContext.jsx       # Displays detected signals
├── BreathingExercise.jsx    # Guided breathing animations
├── GroundingExercise.jsx    # 5-4-3-2-1 sensory grounding
├── GentleMovement.jsx       # Simple stretching prompts
└── DecompressionTimer.jsx   # Suggested break duration
```

#### 1.4 Cloud Function Enhancement

**Modified File:** `/functions/index.js`

Add burnout-specific extraction to `analyzeEntry`:

```javascript
// New extraction in analyzeEntry
"burnout_signals": {
  "detected": boolean,
  "indicators": ["fatigue", "overwork", "physical"],
  "work_life_balance": 0-1,  // Higher = more work-focused
  "recovery_suggestions": ["take a walk", "step away from screen", ...]
}
```

#### 1.5 Database Schema Additions

**New Collection:** `/users/{userId}/burnout_tracking`

```javascript
{
  date: Date,
  riskScore: number,
  riskLevel: string,
  signals: [],
  workEntryCount: number,
  personalEntryCount: number,
  shelterModeTriggered: boolean,
  shelterModeExitedAt: Date | null
}
```

#### 1.6 Implementation Steps

| Step | Task | Files Affected |
|------|------|----------------|
| 1 | Create burnout service with risk score calculation | New: `/src/services/burnout/` |
| 2 | Add burnout indicator extraction to Cloud Function | `/functions/index.js` |
| 3 | Modify ShelterView trigger logic | `/src/components/dashboard/DayDashboard.jsx` |
| 4 | Create decompression-focused ShelterView enhancements | `/src/components/dashboard/views/ShelterView.jsx` |
| 5 | Add breathing/grounding exercise components | New: `/src/components/shelter/` |
| 6 | Create burnout tracking Firestore collection | `/firestore.rules` |
| 7 | Add burnout risk to dashboard UI | `/src/components/dashboard/shared/QuickStatsBar.jsx` |
| 8 | Write unit tests for burnout scoring | New: `/src/services/burnout/__tests__/` |

---

## Feature 2: Leadership and Management Support

### Current State Analysis

**Existing Infrastructure:**
- `@person:X` tags extracted for people mentions
- `team_conflict` detection in entry analysis
- CBT framework for cognitive distortions
- ACT framework for values-based action

**Gap Analysis:**
- No specific handling for leadership/management scenarios
- No distinction between personal and professional relationship stress
- No "post-mortem" analysis for difficult conversations
- No advice generation for management situations

### Implementation Plan

#### 2.1 Leadership Context Detection

**New File:** `/src/services/leadership/leadershipDetector.js`

```javascript
export const LEADERSHIP_CONTEXTS = {
  performance_review: ['performance review', 'feedback session', 'PIP', 'annual review'],
  one_on_one: ['1:1', 'one-on-one', '1 on 1', 'direct report', 'skip level'],
  conflict_resolution: ['mediate', 'conflict', 'tension between', 'team drama'],
  delegation: ['delegate', 'handoff', 'assign task'],
  difficult_conversation: ['hard conversation', 'let go', 'termination', 'bad news'],
  mentorship: ['mentor', 'coaching', 'career advice', 'growth conversation'],
  burnout_support: ['their burnout', 'team stress', 'workload concern']
}

export const detectLeadershipContext = (entry) => {
  // Returns: {
  //   isLeadershipEntry: boolean,
  //   contexts: ['performance_review', 'difficult_conversation'],
  //   mentionedPeople: ['@person:sarah', '@person:jason'],
  //   emotionalLabor: 'high' | 'moderate' | 'low',
  //   suggestPostMortem: boolean
  // }
}
```

#### 2.2 Leadership Insights Module

**New File:** `/src/services/leadership/leadershipInsights.js`

```javascript
export const generateLeadershipInsight = async (entry, context) => {
  // AI-powered advice generation for management situations
  // Uses CBT to reframe imposter syndrome, people-pleasing
  // Uses ACT to identify values (fairness, growth, honesty)

  // Returns: {
  //   situation_summary: string,
  //   emotional_impact: string,
  //   cognitive_distortions: ['imposter_syndrome', 'people_pleasing'],
  //   reframes: [{distortion: 'imposter_syndrome', reframe: '...'}],
  //   leadership_values: ['fairness', 'growth'],
  //   action_suggestions: ['schedule follow-up', 'document conversation'],
  //   self_care_reminder: string
  // }
}
```

#### 2.3 Post-Mortem Component

**New File:** `/src/components/leadership/PostMortem.jsx`

A guided reflection flow for after difficult leadership conversations:

**Sections:**
1. **What Happened** - Factual summary (auto-extracted)
2. **How I Felt** - Emotional acknowledgment
3. **Distortions Check** - CBT analysis of thinking patterns
   - "Did I take too much responsibility?"
   - "Did I catastrophize the outcome?"
   - "Did I discount my preparation?"
4. **Values Alignment** - ACT framework
   - "Was I acting in line with my values?"
   - "What value was I protecting?"
5. **What I'd Do Differently** - Learning extraction
6. **Self-Compassion** - Closing affirmation

#### 2.4 Cloud Function Enhancement

**Modified File:** `/functions/index.js`

New analysis type for leadership entries:

```javascript
// Add to analyzeEntry framework routing
if (hasLeadershipContext) {
  frameworks.push('leadership');
}

// New response structure
"leadership_analysis": {
  "context": "performance_review",
  "emotional_labor_score": 0.8,
  "common_distortions": [
    {
      "type": "imposter_syndrome",
      "evidence": "worried I wasn't qualified to give this feedback",
      "reframe": "Your experience and perspective are exactly why you were chosen for this role"
    }
  ],
  "values_demonstrated": ["honesty", "growth"],
  "self_care_action": "Take 10 minutes before your next meeting to decompress"
}
```

#### 2.5 Leadership Threads (Longitudinal Mentee Tracking)

**Problem:** The Post-Mortem focuses on single events, but managers need to track mentee growth over months (e.g., giving Jason feedback in December, noting his growth in February).

**Solution:** Create "Leadership Threads" that link feedback conversations to follow-up mentions.

**New File:** `/src/services/leadership/leadershipThreads.js`

```javascript
export const createLeadershipThread = async (userId, entry, leadershipContext) => {
  // When feedback session detected, create a Growth Goal thread
  if (leadershipContext.contexts.includes('performance_review') ||
      leadershipContext.contexts.includes('one_on_one')) {

    const thread = {
      id: generateId(),
      createdAt: new Date(),
      person: leadershipContext.mentionedPeople[0],  // e.g., @person:jason
      threadType: 'growth_tracking',
      initialEntry: {
        id: entry.id,
        date: entry.createdAt,
        summary: extractFeedbackSummary(entry),
        feedbackGiven: extractFeedbackTopics(entry)  // e.g., ['communication', 'ownership']
      },
      followUps: [],
      status: 'active'
    };

    await saveLeadershipThread(userId, thread);
    return thread;
  }
};

export const linkFollowUpMention = async (userId, entry, personTag) => {
  // When person is mentioned again, check for active threads
  const activeThreads = await getActiveThreadsForPerson(userId, personTag);

  if (activeThreads.length > 0) {
    const thread = activeThreads[0];
    const followUp = {
      entryId: entry.id,
      date: entry.createdAt,
      sentiment: entry.analysis.mood_score > 0.6 ? 'positive' : 'neutral',
      progressIndicators: extractProgressIndicators(entry),  // e.g., ['showed initiative', 'improved communication']
      summary: extractMentionSummary(entry)
    };

    await addFollowUpToThread(userId, thread.id, followUp);

    // Return context for AI to surface
    return {
      hasActiveThread: true,
      previousFeedback: thread.initialEntry.feedbackGiven,
      daysSinceInitial: daysBetween(thread.initialEntry.date, new Date()),
      progressNotes: thread.followUps.map(f => f.progressIndicators).flat()
    };
  }

  return { hasActiveThread: false };
};
```

**Enhanced Leadership Analysis with Thread Context:**

```javascript
// In Cloud Function analyzeEntry, include thread context
"leadership_analysis": {
  // ... existing fields ...
  "thread_context": {
    "has_active_thread": true,
    "person": "@person:jason",
    "days_since_feedback": 45,
    "original_feedback": ["communication", "taking ownership"],
    "observed_progress": ["showed initiative on Q4 planning", "led team meeting confidently"],
    "reflection_prompt": "You gave Jason feedback on communication 45 days ago. Based on today's entry, it sounds like he's showing real growth. Consider acknowledging this in your next 1:1."
  }
}
```

**New Component:** `/src/components/leadership/LeadershipThreadCard.jsx`

Displays:
1. **Timeline View** - Initial feedback → Follow-up mentions over time
2. **Progress Indicators** - Extracted growth signals
3. **Next Action Suggestion** - "Acknowledge growth in next 1:1"
4. **Thread Archive** - Mark thread complete when goal achieved

**Database Schema:**

```javascript
// New Collection: /users/{userId}/leadership_threads
{
  id: string,
  person: string,  // @person:jason
  threadType: 'growth_tracking' | 'conflict_resolution' | 'mentorship',
  status: 'active' | 'completed' | 'archived',
  initialEntry: {
    id: string,
    date: Date,
    summary: string,
    feedbackGiven: string[]
  },
  followUps: [
    {
      entryId: string,
      date: Date,
      sentiment: string,
      progressIndicators: string[],
      summary: string
    }
  ],
  completedAt: Date | null,
  completionNote: string | null
}
```

#### 2.6 UI Integration

**EntryCard Enhancement:**
- Add "Leadership Insights" expandable section
- Show detected management context
- Link to Post-Mortem guided reflection
- **NEW:** Show thread context when mentee has active growth thread

**New Dashboard Widget:**
- "Team Emotional Labor" tracker
- People you've supported recently
- Self-care reminders for managers
- **NEW:** "Active Growth Threads" - people with pending feedback follow-ups

#### 2.7 Implementation Steps

| Step | Task | Files Affected |
|------|------|----------------|
| 1 | Create leadership detection service | New: `/src/services/leadership/leadershipDetector.js` |
| 2 | Build leadership insights generator | New: `/src/services/leadership/leadershipInsights.js` |
| 3 | Add leadership framework to Cloud Functions | `/functions/index.js` |
| 4 | Create Post-Mortem reflection component | New: `/src/components/leadership/PostMortem.jsx` |
| 5 | Enhance EntryCard with leadership section | `/src/components/entries/EntryCard.jsx` |
| 6 | Add emotional labor tracking widget | New: `/src/components/dashboard/shared/EmotionalLaborTracker.jsx` |
| 7 | Create manager self-care prompts | `/src/services/prompts/index.js` |

---

## Feature 3: SAD and Environmental Contextualization

### Current State Analysis

**Existing Infrastructure:**
- `hasTemporalIndicators` flag in signal extraction
- SAD tags extracted when seasonal patterns mentioned
- Mood calendar heatmap for longitudinal view
- Cyclical pattern detection (day-of-week analysis)

**Gap Analysis:**
- No location awareness
- No weather/sunset data integration
- No correlation between environmental factors and mood
- No proactive environmental interventions

### Implementation Plan

#### 3.1 Location and Environment Service

**New File:** `/src/services/environment/environmentService.js`

```javascript
import { Geolocation } from '@capacitor/geolocation';

export const getEnvironmentContext = async () => {
  const position = await Geolocation.getCurrentPosition();
  const { latitude, longitude } = position.coords;

  // Fetch from external APIs
  const weather = await fetchWeatherData(latitude, longitude);
  const sunTimes = await fetchSunriseSunset(latitude, longitude);

  return {
    location: { latitude, longitude, city: weather.city },
    weather: {
      condition: weather.condition,  // 'cloudy', 'sunny', 'rainy'
      temperature: weather.temp,
      humidity: weather.humidity
    },
    daylight: {
      sunrise: sunTimes.sunrise,
      sunset: sunTimes.sunset,
      daylightHours: sunTimes.daylightHours,
      currentlyDark: isAfterSunset(sunTimes.sunset)
    },
    season: calculateSeason(latitude)
  }
}
```

#### 3.2 Environmental Pattern Analysis

**New File:** `/src/services/environment/environmentalPatterns.js`

```javascript
export const analyzeEnvironmentalCorrelations = (entries, environmentData) => {
  // Cross-reference mood with environmental factors

  return {
    weatherCorrelation: {
      cloudy: { avgMood: 0.42, entriesCount: 15 },
      sunny: { avgMood: 0.68, entriesCount: 23 },
      rainy: { avgMood: 0.51, entriesCount: 8 }
    },
    darkHoursCorrelation: {
      afterSunset: { avgMood: 0.45, pattern: 'consistent_dip' },
      daylightHours: { avgMood: 0.61 }
    },
    seasonalTrend: {
      winter: { avgMood: 0.43, sadIndicators: 12 },
      summer: { avgMood: 0.72, sadIndicators: 0 }
    },
    interventionSuggestions: [
      { type: 'SAD_lamp', confidence: 0.85, reason: 'Consistent 23% mood dip after sunset' },
      { type: 'morning_light', confidence: 0.72, reason: 'Low mood entries cluster before 9 AM in winter' },
      { type: 'exercise_boost', confidence: 0.68, reason: 'Gym visits correlate with 31% mood improvement' }
    ]
  }
}
```

#### 3.3 Indoor Time Correlation (Critical Refinement)

**Problem:** A user can be in a sunny city but stuck in a windowless office until 10 PM (like Alex during Project Orion). Weather API alone misses this context.

**Solution:** Cross-reference environmental data with overwork indicators from Feature 1 to detect "missed daylight" patterns.

**New File:** `/src/services/environment/indoorTimeAnalysis.js`

```javascript
export const analyzeIndoorExposure = (entries, environmentData, burnoutData) => {
  const missedDaylightDays = [];

  entries.forEach((entry, index) => {
    const env = environmentData[index];
    const burnout = burnoutData[index];

    // Detect "sunny outside but user missed it"
    const wasSunnyDay = env?.weather?.condition === 'sunny' ||
                        env?.daylight?.daylightHours > 10;
    const wasOverworking = burnout?.signals?.includes('overwork') ||
                           entry.createdAt.getHours() >= 20;  // Entry after 8 PM
    const mentionsIndoor = /office|desk|meeting|screen|computer/i.test(entry.text);

    if (wasSunnyDay && wasOverworking && mentionsIndoor) {
      missedDaylightDays.push({
        date: entry.createdAt,
        sunsetTime: env.daylight.sunset,
        entryTime: entry.createdAt,
        hoursOfDaylightMissed: calculateMissedHours(env, entry),
        mood: entry.analysis.mood_score
      });
    }
  });

  return {
    missedDaylightDays,
    missedDaylightStreak: calculateStreak(missedDaylightDays),
    avgMoodOnMissedDays: average(missedDaylightDays.map(d => d.mood)),
    avgMoodOnExposedDays: calculateExposedDaysMood(entries, missedDaylightDays),
    recommendation: generateIndoorRecommendation(missedDaylightDays)
  };
};

const generateIndoorRecommendation = (missedDays) => {
  if (missedDays.length >= 5) {
    return {
      type: 'critical_light_deficit',
      message: "You've been indoors during daylight hours for 5+ days. This significantly increases SAD risk, even in sunny weather.",
      suggestions: [
        { action: 'SAD_lamp', priority: 'high', reason: 'Compensate for missed natural light' },
        { action: 'lunch_walk', priority: 'medium', reason: 'Get 15 min of midday light' },
        { action: 'morning_light', priority: 'medium', reason: 'Open blinds immediately on waking' }
      ]
    };
  }
  // ... other thresholds
};
```

**Enhanced Environmental Insights Display:**

```javascript
// In SADInterventions.jsx, add indoor context
<InsightCard type="warning">
  <h4>Light Exposure Gap</h4>
  <p>
    The weather was sunny this week, but you logged entries after dark
    on {missedDays} of {totalDays} days.
  </p>
  <p>
    Your mood averaged {avgMissed} on missed-daylight days vs {avgExposed}
    on days with outdoor time.
  </p>
  <Recommendation>
    A SAD lamp is especially important when work keeps you indoors
    during available sunlight.
  </Recommendation>
</InsightCard>
```

#### 3.4 Proactive SAD Interventions

**New Component:** `/src/components/environment/SADInterventions.jsx`

When SAD patterns detected, show:
1. **Light Therapy Reminder** - "Days are getting shorter. Consider using a SAD lamp in the morning."
2. **Exercise Nudge** - "Your gym visits boost your mood by 31%. Winter might be a good time to increase frequency."
3. **Social Connection** - "Dark evenings can feel isolating. Have you texted Mark recently?"
4. **Vitamin D Reminder** - Link to health considerations
5. **NEW: Indoor Alert** - "You've been missing available daylight. Even 15 min at lunch helps."

#### 3.5 Entry Enrichment

**Enhanced Entry Storage:**

```javascript
// Add to entry document
"environmental_context": {
  "weather": "cloudy",
  "temperature": 42,
  "sunset_time": "5:15 PM",
  "was_after_dark": true,
  "daylight_hours": 9.5
}
```

#### 3.6 External API Integration

**APIs to Integrate:**

| API | Purpose | Free Tier |
|-----|---------|-----------|
| Open-Meteo | Weather data | Unlimited |
| Sunrise-Sunset.org | Sun times | Unlimited |
| TimeZoneDB | Timezone by location | 1 req/sec |

**New File:** `/src/services/environment/apis/`
- `weatherApi.js`
- `sunTimesApi.js`
- `locationApi.js`

#### 3.7 Implementation Steps

| Step | Task | Files Affected |
|------|------|----------------|
| 1 | Add Capacitor Geolocation plugin | `package.json`, `capacitor.config.json` |
| 2 | Create environment service | New: `/src/services/environment/` |
| 3 | Integrate weather/sun APIs | New: `/src/services/environment/apis/` |
| 4 | Add environmental context to entry creation | `/src/App.jsx` or entry service |
| 5 | Create environmental correlation analysis | `/src/services/environment/environmentalPatterns.js` |
| 6 | Build SAD intervention component | New: `/src/components/environment/` |
| 7 | Add environmental insights to dashboard | `/src/components/dashboard/DayDashboard.jsx` |
| 8 | Create seasonal mood heatmap overlay | `/src/components/entries/MoodHeatmap.jsx` |
| 9 | Add location permission request flow | `/src/components/modals/` |

---

## Feature 4: Value-Alignment Tracking (ACT Enhancement)

### Current State Analysis

**Existing Infrastructure:**
- `act_analysis.values_context` extracted per entry
- `committed_action` suggested for alignment
- Entry analysis includes values identification
- No longitudinal values tracking

**Gap Analysis:**
- Values are per-entry, not tracked over time
- No visualization of values consistency
- No behavior extraction to compare against stated values
- No gap analysis between intentions and actions

### Implementation Plan

#### 4.1 Values Tracker Service

**New File:** `/src/services/values/valuesTracker.js`

```javascript
export const CORE_VALUES = [
  'health', 'connection', 'growth', 'creativity', 'family',
  'achievement', 'security', 'adventure', 'self-care', 'honesty',
  'consistency', 'balance', 'contribution', 'learning', 'freedom'
];

export const extractBehaviorSignals = (entry) => {
  // Extract actual behaviors from entry text
  return {
    positive: ['went to gym', 'called mom', 'meditated'],
    negative: ['skipped workout', 'takeout at desk', 'ignored texts'],
    neutral: ['worked late', 'meeting-heavy day']
  }
}

export const computeValueAlignment = (entries, dateRange) => {
  // Returns: {
  //   byValue: {
  //     'health': {
  //       stated: 15,           // Times mentioned as important
  //       supported: 8,         // Actions aligned with value
  //       violated: 5,          // Actions against value
  //       alignmentScore: 0.62  // 0-1 score
  //     },
  //     ...
  //   },
  //   overallAlignment: 0.67,
  //   biggestGap: 'health',     // Value with largest alignment gap
  //   strongestAlignment: 'family',
  //   trends: { improving: ['growth'], declining: ['self-care'] }
  // }
}
```

#### 4.2 Values Dashboard Component

**New File:** `/src/components/values/ValuesDashboard.jsx`

**Visualizations:**

1. **Values Radar Chart**
   - Each spoke = a core value
   - Inner ring = stated importance (from entries)
   - Outer ring = behavioral alignment
   - Gap = visual discrepancy

2. **Values Timeline**
   - Weekly/monthly view
   - Shows alignment score over time
   - Highlight events that affected alignment

3. **Gap Alert Cards**
   - "Your 'Self-care' alignment dropped 23% this week"
   - "You mentioned 'health' 5 times but skipped gym 3 times"
   - Actionable micro-commitment suggestions

4. **Values-Behavior Log**
   - List of extracted behaviors
   - Mapped to corresponding values
   - Color-coded (green = aligned, red = misaligned)

#### 4.3 Compassionate Reframe for Value Gaps (Critical Refinement)

**Problem:** Simply showing "You violated your 'Health' value by skipping the gym" can feel judgmental and shame-inducing. Users often make conscious trade-offs between values (e.g., sacrificing gym time to meet a work deadline).

**Solution:** Detect value trade-offs and frame them with compassion, acknowledging that sometimes values conflict.

**New File:** `/src/services/values/compassionateReframe.js`

```javascript
export const generateCompassionateReframe = (valueGap, entry) => {
  // Detect if violation was a conscious trade-off vs unconscious neglect
  const tradeOff = detectValueTradeOff(valueGap, entry);

  if (tradeOff.isTradeOff) {
    // User consciously chose one value over another
    return {
      type: 'trade_off_acknowledgment',
      prioritizedValue: tradeOff.prioritizedValue,  // e.g., 'achievement'
      sacrificedValue: tradeOff.sacrificedValue,    // e.g., 'health'
      context: tradeOff.context,                     // e.g., 'project deadline'
      message: generateTradeOffMessage(tradeOff),
      rebalancePrompt: generateRebalancePrompt(tradeOff)
    };
  } else {
    // Unconscious drift from values
    return {
      type: 'gentle_awareness',
      value: valueGap.value,
      message: generateGentleAwarenessMessage(valueGap),
      microCommitment: suggestMicroCommitment(valueGap.value)
    };
  }
};

const generateTradeOffMessage = (tradeOff) => {
  return `You prioritized '${tradeOff.prioritizedValue}' over '${tradeOff.sacrificedValue}' ` +
         `this week because of ${tradeOff.context}. This was a conscious choice for a ` +
         `deadline, not a failure of character. Values sometimes compete, and you chose ` +
         `what mattered most in the moment.`;
};

const generateRebalancePrompt = (tradeOff) => {
  return {
    question: `Now that ${tradeOff.context} is behind you, how might you rebalance toward '${tradeOff.sacrificedValue}' this week?`,
    suggestions: [
      `Schedule one ${tradeOff.sacrificedValue}-aligned activity`,
      `Set a boundary to protect ${tradeOff.sacrificedValue} time`,
      `Reflect on what sustainable balance looks like for you`
    ]
  };
};

const detectValueTradeOff = (valueGap, entry) => {
  // Look for evidence of competing values in the same entry
  const mentionedValues = entry.analysis?.behavior_extraction?.values_mentioned || [];
  const demonstratedValues = entry.analysis?.behavior_extraction?.values_demonstrated || [];

  // If user mentioned health but demonstrated achievement, it's a trade-off
  if (mentionedValues.includes(valueGap.value) &&
      demonstratedValues.length > 0 &&
      !demonstratedValues.includes(valueGap.value)) {

    const prioritizedValue = demonstratedValues[0];
    const contextClues = extractContextClues(entry.text);

    return {
      isTradeOff: true,
      prioritizedValue,
      sacrificedValue: valueGap.value,
      context: contextClues.reason || 'competing priorities'
    };
  }

  return { isTradeOff: false };
};
```

**Enhanced Gap Alert Component:**

**Modified File:** `/src/components/values/ValueGapAlert.jsx`

```javascript
const ValueGapAlert = ({ valueGap, entry }) => {
  const reframe = generateCompassionateReframe(valueGap, entry);

  if (reframe.type === 'trade_off_acknowledgment') {
    return (
      <AlertCard variant="compassionate">
        <ValueTradeOffIcon
          from={reframe.sacrificedValue}
          to={reframe.prioritizedValue}
        />

        <div className="message">
          <p>{reframe.message}</p>
        </div>

        <RebalanceSection>
          <h4>{reframe.rebalancePrompt.question}</h4>
          <ul>
            {reframe.rebalancePrompt.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </RebalanceSection>

        <SelfCompassionReminder>
          "Living by your values doesn't mean perfect alignment every day.
          It means returning to them when you notice you've drifted."
        </SelfCompassionReminder>
      </AlertCard>
    );
  }

  // Gentle awareness for unconscious drift
  return (
    <AlertCard variant="gentle">
      <p>{reframe.message}</p>
      <MicroCommitment action={reframe.microCommitment} />
    </AlertCard>
  );
};
```

**Key UX Principles:**

1. **No Shame** - Never use words like "failed", "violated", or "broke"
2. **Context Awareness** - Acknowledge external pressures (deadlines, crises)
3. **Trade-off Recognition** - Validate that sometimes values compete
4. **Forward Focus** - Always offer a path to rebalance, not dwell on gap
5. **Self-Compassion** - Include reminders that imperfection is human

#### 4.4 Behavior Extraction Enhancement

**Modified File:** `/functions/index.js`

Add behavior extraction to entry analysis (note: avoid judgmental language):

```javascript
"behavior_extraction": {
  "explicit_actions": [
    { "action": "skipped gym", "value_impact": { "health": -1 } },
    { "action": "had takeout at desk", "value_impact": { "health": -1, "self-care": -1 } },
    { "action": "called mom", "value_impact": { "family": +1, "connection": +1 } }
  ],
  "implicit_behaviors": [
    { "behavior": "worked through lunch", "inferred_from": "back-to-back meetings" }
  ],
  "values_mentioned": ["health", "consistency"],
  "values_demonstrated": ["achievement", "contribution"],
  "alignment_conflict": {
    "stated": "health",
    "violated_by": "skipped gym for deadline"
  }
}
```

#### 4.5 Database Schema

**New Collection:** `/users/{userId}/values_tracking`

```javascript
{
  date: Date,
  valueScores: {
    health: { stated: 2, supported: 1, violated: 1 },
    connection: { stated: 1, supported: 1, violated: 0 },
    // ...
  },
  overallAlignment: 0.72,
  entryIds: ['entry1', 'entry2']  // Entries contributing to this day
}
```

**New Collection:** `/users/{userId}/values_profile`

```javascript
{
  coreValues: ['health', 'family', 'growth'],  // Top 3-5 stated
  lastUpdated: Date,
  alignmentHistory: [
    { week: '2024-W01', score: 0.68 },
    { week: '2024-W02', score: 0.72 },
    // ...
  ]
}
```

#### 4.6 Implementation Steps

| Step | Task | Files Affected |
|------|------|----------------|
| 1 | Create values tracker service | New: `/src/services/values/valuesTracker.js` |
| 2 | Add behavior extraction to Cloud Functions | `/functions/index.js` |
| 3 | Create values profile Firestore structure | `/firestore.rules` |
| 4 | Build Values Dashboard component | New: `/src/components/values/ValuesDashboard.jsx` |
| 5 | Create radar chart visualization | New: `/src/components/values/ValuesRadarChart.jsx` |
| 6 | Add gap alert cards | New: `/src/components/values/ValueGapAlert.jsx` |
| 7 | Integrate values view into main navigation | `/src/App.jsx` |
| 8 | Add values prompt generation | `/src/services/prompts/index.js` |

---

## Feature 5: Anticipatory Anxiety and "Future Self" Check-in

### Current State Analysis

**Existing Infrastructure:**
- `signalExtractor.js` distinguishes "plan" signals from "feeling" signals
- Plan signals have `targetDate` for future events
- MorningCompass provides morning prompts
- Existing grounding exercises in ShelterView

**Gap Analysis:**
- Plan signals not used for proactive intervention
- No "morning of" stressful event detection
- No automatic surfacing of grounding tools
- No anticipatory anxiety-specific support

### Implementation Plan

#### 5.1 Future Event Monitor Service

**New File:** `/src/services/anticipatory/futureEventMonitor.js`

```javascript
export const getUpcomingStressfulEvents = async (userId) => {
  // Query plan signals for today and near-future
  const todayPlans = await getPlanSignalsForDate(userId, today);
  const tomorrowPlans = await getPlanSignalsForDate(userId, tomorrow);

  // Identify anxiety-associated plans
  const stressfulEvents = [...todayPlans, ...tomorrowPlans].filter(plan => {
    return plan.sentiment === 'anxious' ||
           plan.sentiment === 'nervous' ||
           STRESSFUL_EVENT_KEYWORDS.some(kw => plan.content.includes(kw));
  });

  return {
    today: stressfulEvents.filter(e => isToday(e.targetDate)),
    upcoming: stressfulEvents.filter(e => !isToday(e.targetDate)),
    mostUrgent: stressfulEvents[0] || null
  }
}

const STRESSFUL_EVENT_KEYWORDS = [
  'interview', 'presentation', 'first date', 'flight', 'doctor',
  'dentist', 'review', 'deadline', 'exam', 'confrontation',
  'difficult conversation', 'meeting with'
];
```

#### 5.2 "Future Self" Check-in Component

**New File:** `/src/components/anticipatory/FutureSelfCheckIn.jsx`

Triggered when user opens app on morning of stressful event:

**Flow:**
1. **Acknowledgment** - "You have [event] today. It's normal to feel nervous."
2. **Body Scan** - "Where do you feel the anxiety in your body?"
3. **Grounding Tool** - Present 5-4-3-2-1 technique
4. **Reframe** - CBT-based thought reframing
5. **Values Anchor** - ACT-based values reminder
6. **Micro-Commitment** - "What's one small thing you can do to prepare?"
7. **Affirmation** - Personalized encouragement

#### 5.3 Grounding Tool Suite

**New Directory:** `/src/components/grounding/`

```
/grounding/
├── GroundingToolSelector.jsx   # Choose appropriate technique
├── FiveFourThreeTwoOne.jsx     # 5-4-3-2-1 sensory grounding
├── BoxBreathing.jsx            # 4-4-4-4 breathing
├── BodyScanQuick.jsx           # 2-minute body scan
├── ProgressiveMuscle.jsx       # Tension-release technique
└── SafePlaceVisualization.jsx  # Mental safe space
```

#### 5.4 Integration with MorningCompass

**Modified File:** `/src/components/dashboard/views/MorningCompass.jsx`

```javascript
// Add anticipatory event check
useEffect(() => {
  const checkStressfulEvents = async () => {
    const events = await getUpcomingStressfulEvents(userId);
    if (events.today.length > 0) {
      setShowFutureSelfCheckIn(true);
      setPendingEvent(events.today[0]);
    }
  };
  checkStressfulEvents();
}, []);
```

#### 5.5 Proactive Notifications

**New File:** `/src/services/notifications/anticipatoryNotifications.js`

```javascript
export const scheduleAnticipatorySupportNotification = (event) => {
  // Schedule push notification for morning of stressful event
  const notificationTime = calculateMorningNotificationTime(event.targetDate);

  return {
    title: "Support for today",
    body: `You have ${event.content} today. Tap for a grounding exercise.`,
    scheduledTime: notificationTime,
    data: { eventId: event.id, type: 'anticipatory_support' }
  }
}
```

#### 5.6 "How Did It Go?" Follow-Up (CBT Loop Closure)

**Problem:** Feature 5 provides grounding tools before a stressful event, but doesn't close the CBT loop by helping the user reflect on whether their anticipatory anxiety matched reality.

**Solution:** Trigger a follow-up reflection in EveningMirror when a morning check-in was completed.

**New File:** `/src/services/anticipatory/eventFollowUp.js`

```javascript
export const checkForPendingFollowUps = async (userId) => {
  // Find events that had a morning check-in but no evening reflection
  const todayCheckIns = await getMorningCheckInsForDate(userId, today);

  const pendingFollowUps = todayCheckIns.filter(checkIn =>
    !checkIn.eveningReflectionCompleted &&
    isAfter(new Date(), checkIn.eventTime)  // Event has passed
  );

  return pendingFollowUps.map(checkIn => ({
    eventId: checkIn.id,
    eventDescription: checkIn.eventContent,
    anticipatedAnxiety: checkIn.anxietyLevel,  // 1-10 from morning
    groundingToolUsed: checkIn.groundingToolCompleted,
    promptType: 'event_reflection'
  }));
};

export const recordEventReflection = async (userId, eventId, reflection) => {
  // Store the reflection and compute CBT insight
  const checkIn = await getMorningCheckIn(userId, eventId);

  const cbtInsight = {
    anticipatedWorst: checkIn.worstCaseThought,
    actualOutcome: reflection.whatHappened,
    anxietyAccuracy: calculateAnxietyAccuracy(checkIn.anxietyLevel, reflection.actualAnxiety),
    catastrophizingEvidence: reflection.actualAnxiety < checkIn.anxietyLevel - 3,
    reframeLearning: generateReframeLearning(checkIn, reflection)
  };

  await saveEventReflection(userId, eventId, {
    ...reflection,
    cbtInsight,
    completedAt: new Date()
  });

  return cbtInsight;
};

const generateReframeLearning = (checkIn, reflection) => {
  if (reflection.actualAnxiety < checkIn.anxietyLevel - 3) {
    return {
      type: 'catastrophizing_evidence',
      message: `Your anxiety before the ${checkIn.eventContent} was ${checkIn.anxietyLevel}/10, but afterward it was ${reflection.actualAnxiety}/10. This is evidence that your mind overestimated the threat.`,
      futureReframe: "Next time you feel anxious about a similar event, remember: your predictions tend to be worse than reality."
    };
  }
  // ... other patterns
};
```

**Enhanced EveningMirror Component:**

**Modified File:** `/src/components/dashboard/views/EveningMirror.jsx`

```javascript
const EveningMirror = ({ userId }) => {
  const [pendingFollowUps, setPendingFollowUps] = useState([]);

  useEffect(() => {
    const loadFollowUps = async () => {
      const followUps = await checkForPendingFollowUps(userId);
      setPendingFollowUps(followUps);
    };
    loadFollowUps();
  }, [userId]);

  return (
    <div className="evening-mirror">
      {/* Existing evening reflection content */}

      {pendingFollowUps.length > 0 && (
        <EventReflectionPrompt
          event={pendingFollowUps[0]}
          onComplete={handleReflectionComplete}
        />
      )}
    </div>
  );
};
```

**New Component:** `/src/components/anticipatory/EventReflectionPrompt.jsx`

```javascript
const EventReflectionPrompt = ({ event, onComplete }) => {
  const [step, setStep] = useState(1);
  const [reflection, setReflection] = useState({});

  const steps = [
    {
      title: "How did it go?",
      prompt: `You were nervous about your ${event.eventDescription} this morning. Now that it's over, how did it actually go?`,
      input: 'textarea'
    },
    {
      title: "Anxiety Check",
      prompt: "On a scale of 1-10, how anxious did you actually feel during the event?",
      input: 'slider',
      compare: event.anticipatedAnxiety
    },
    {
      title: "Reality vs. Worry",
      prompt: "Did the worst-case scenario you imagined actually happen?",
      input: 'select',
      options: ['No, it went better than I thought', 'It was about what I expected', 'Yes, it was as bad as I feared', 'It was worse than I expected']
    },
    {
      title: "Learning",
      prompt: "What's one thing you learned from this experience?",
      input: 'textarea'
    }
  ];

  const handleComplete = async () => {
    const cbtInsight = await recordEventReflection(userId, event.eventId, reflection);
    onComplete(cbtInsight);
  };

  return (
    <ReflectionCard>
      <ProgressDots current={step} total={steps.length} />
      <Step {...steps[step - 1]} value={reflection} onChange={setReflection} />
      <Navigation onNext={() => setStep(s => s + 1)} onComplete={handleComplete} />

      {step === 2 && event.anticipatedAnxiety && (
        <ComparisonDisplay
          before={event.anticipatedAnxiety}
          after={reflection.actualAnxiety}
        />
      )}
    </ReflectionCard>
  );
};
```

**Database Schema:**

```javascript
// Add to signals collection or new collection
// /users/{userId}/event_reflections
{
  eventId: string,
  eventDescription: string,
  morningCheckIn: {
    completedAt: Date,
    anxietyLevel: number,
    worstCaseThought: string,
    groundingToolUsed: string
  },
  eveningReflection: {
    completedAt: Date,
    whatHappened: string,
    actualAnxiety: number,
    outcomeVsExpectation: string,
    learning: string
  },
  cbtInsight: {
    catastrophizingEvidence: boolean,
    anxietyAccuracy: number,  // How close prediction was to reality
    reframeLearning: string
  }
}
```

**Longitudinal CBT Pattern Tracking:**

Over time, the system can show users:
- "Your anxiety predictions are typically 40% higher than actual outcomes"
- "You've completed 12 event reflections. In 10 of them, reality was better than expected."
- "This evidence suggests your mind tends to overestimate threat."

#### 5.7 Implementation Steps

| Step | Task | Files Affected |
|------|------|----------------|
| 1 | Create future event monitor service | New: `/src/services/anticipatory/` |
| 2 | Build grounding tool components | New: `/src/components/grounding/` |
| 3 | Create Future Self Check-in flow | New: `/src/components/anticipatory/FutureSelfCheckIn.jsx` |
| 4 | Integrate with MorningCompass | `/src/components/dashboard/views/MorningCompass.jsx` |
| 5 | Add anticipatory notification scheduling | `/src/services/notifications/` |
| 6 | Create evening "tomorrow prep" prompt | `/src/services/prompts/index.js` |
| 7 | Add stressful event detection to signal extraction | `/src/services/signals/signalExtractor.js` |

---

## Feature 6: Vector Database Migration

### Current State Analysis

**Existing Infrastructure:**
- Embeddings generated via OpenAI `text-embedding-004`
- Embeddings stored in Firestore `rag_embeddings` collection
- Cosine similarity calculated in-memory
- Hybrid retrieval combines: vector similarity (40%), recency (30%), entity (20%), mood (10%)

**Performance Concerns:**
- 60 entries in 2 months = ~360 entries/year
- In-memory similarity O(n) with entry count
- 1000+ entries will cause noticeable latency
- No approximate nearest neighbor (ANN) optimization

### Implementation Plan

#### 6.1 Vector Database Selection

**Comparison:**

| Feature | Pinecone | Weaviate | Qdrant | Milvus |
|---------|----------|----------|--------|--------|
| Free Tier | 1M vectors | Self-host | Self-host | Self-host |
| Managed Service | Yes | Yes | Yes | Zilliz |
| Hybrid Search | Yes | Yes | Yes | Yes |
| Metadata Filtering | Yes | Yes | Yes | Yes |
| Serverless | Yes | No | No | No |
| Firebase Integration | Easy | Medium | Medium | Medium |
| Cold Start | None | ~10s | ~10s | ~10s |

**Recommendation:** **Pinecone** for managed serverless, **Weaviate** for self-hosted flexibility

#### 6.2 Migration Architecture

**New File:** `/src/services/vectorSearch/vectorDatabase.js`

```javascript
import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

export const indexEntry = async (entry, embedding) => {
  const index = pinecone.index('echovault-entries');

  await index.upsert([{
    id: entry.id,
    values: embedding,
    metadata: {
      userId: entry.userId,
      createdAt: entry.createdAt.toISOString(),
      moodScore: entry.analysis.mood_score,
      category: entry.category,
      tags: entry.tags,
      entryType: entry.analysis.entry_type
    }
  }]);
}

export const queryRelevantEntries = async (queryEmbedding, userId, options = {}) => {
  const index = pinecone.index('echovault-entries');

  const results = await index.query({
    vector: queryEmbedding,
    topK: options.topK || 10,
    filter: {
      userId: userId,
      ...(options.category && { category: options.category }),
      ...(options.minMood && { moodScore: { $gte: options.minMood } })
    },
    includeMetadata: true
  });

  return results.matches;
}
```

#### 6.3 Hybrid Retrieval Preservation

**Key Requirement:** Maintain hybrid retrieval weighting during migration

```javascript
export const hybridQuery = async (query, userId, recentEntries) => {
  // 1. Vector similarity from Pinecone (40%)
  const embedding = await generateEmbedding(query);
  const vectorResults = await queryRelevantEntries(embedding, userId);

  // 2. Recency scoring (30%) - still computed locally
  const recencyScores = computeRecencyScores(vectorResults, recentEntries);

  // 3. Entity matching (20%) - metadata filter in Pinecone
  const entityScores = computeEntityScores(vectorResults, query);

  // 4. Mood similarity (10%) - metadata filter in Pinecone
  const moodScores = computeMoodSimilarity(vectorResults, currentMood);

  // Combine scores
  return combineScores(vectorResults, recencyScores, entityScores, moodScores);
}
```

#### 6.4 Migration Script

**New File:** `/scripts/migrateToVectorDB.js`

```javascript
// One-time migration of existing embeddings
const migrateExistingEntries = async () => {
  const users = await getAllUsers();

  for (const user of users) {
    const entries = await getEntriesWithEmbeddings(user.id);
    const vectors = entries.map(e => ({
      id: e.id,
      values: e.embedding,
      metadata: { userId: user.id, ...extractMetadata(e) }
    }));

    // Batch upsert (Pinecone supports 100 vectors/batch)
    await batchUpsert(vectors, 100);
    console.log(`Migrated ${vectors.length} entries for user ${user.id}`);
  }
}
```

#### 6.5 Cloud Function Update

**Modified File:** `/functions/index.js`

```javascript
// Update onEntryCreate to index in vector DB
exports.onEntryCreate = functions.firestore
  .document('artifacts/echo-vault/users/{userId}/entries/{entryId}')
  .onCreate(async (snap, context) => {
    // ... existing embedding generation ...

    // NEW: Index in Pinecone
    await indexInVectorDatabase(snap.id, embedding, {
      userId: context.params.userId,
      ...extractMetadata(snap.data())
    });
  });
```

#### 6.6 Implementation Steps

| Step | Task | Files Affected |
|------|------|----------------|
| 1 | Set up Pinecone account and index | External: Pinecone console |
| 2 | Add Pinecone SDK to dependencies | `package.json`, `functions/package.json` |
| 3 | Create vector database service wrapper | New: `/src/services/vectorSearch/vectorDatabase.js` |
| 4 | Update Cloud Functions for dual-write | `/functions/index.js` |
| 5 | Create migration script | New: `/scripts/migrateToVectorDB.js` |
| 6 | Update RAG service for Pinecone query | `/src/services/rag/index.js` |
| 7 | Add environment variables | `.env`, Cloud Functions config |
| 8 | Performance testing with synthetic data | New: `/tests/performance/` |
| 9 | Gradual rollout with feature flag | `/src/config/featureFlags.js` |

---

## Feature 7: Social Connection Nudges

### Current State Analysis

**Existing Infrastructure:**
- `@person:X` tags extracted for all people mentions
- No distinction between work and personal relationships
- RAG can retrieve past mentions of specific people
- No social connection health tracking

**Gap Analysis:**
- No monitoring of social connection frequency
- No detection of isolation patterns
- No proactive nudges for social connection
- No categorization of relationships (work vs personal)

### Implementation Plan

#### 7.1 Social Connection Tracker

**New File:** `/src/services/social/socialTracker.js`

```javascript
export const RELATIONSHIP_CATEGORIES = {
  work: ['manager', 'colleague', 'team', 'boss', 'report', 'client'],
  personal: ['friend', 'partner', 'family', 'mom', 'dad', 'brother', 'sister'],
  ambiguous: []  // Requires user classification
};

export const categorizeRelationship = (personTag, entryContext) => {
  // Heuristic categorization based on tag and context
  // Returns: 'work' | 'personal' | 'ambiguous'
}

export const analyzeSocialHealth = async (userId, dateRange = 14) => {
  const entries = await getRecentEntries(userId, dateRange);
  const personMentions = extractPersonMentions(entries);

  const categorized = personMentions.map(p => ({
    ...p,
    category: categorizeRelationship(p.tag, p.context)
  }));

  const workMentions = categorized.filter(p => p.category === 'work');
  const personalMentions = categorized.filter(p => p.category === 'personal');

  return {
    totalMentions: personMentions.length,
    workMentions: workMentions.length,
    personalMentions: personalMentions.length,
    workPersonalRatio: workMentions.length / Math.max(personalMentions.length, 1),
    isolationRisk: personalMentions.length < 3,  // Less than 3 personal mentions in 14 days
    neglectedConnections: findNeglectedConnections(userId, personMentions),
    suggestions: []
  }
}

export const findNeglectedConnections = async (userId, recentMentions) => {
  // Find people mentioned in past but not recently
  const allPersons = await getAllPersonMentions(userId);
  const recentPersons = new Set(recentMentions.map(p => p.tag));

  return allPersons.filter(p =>
    p.category === 'personal' &&
    !recentPersons.has(p.tag) &&
    p.lastMentioned > 30  // Days since last mention
  );
}
```

#### 7.2 Social Resilience Alerts

**New Component:** `/src/components/social/SocialResilienceAlert.jsx`

```javascript
const SocialResilienceAlert = ({ socialHealth }) => {
  if (!socialHealth.isolationRisk) return null;

  return (
    <Alert type="gentle">
      <h3>Checking in on Connection</h3>
      <p>It's been a while since you mentioned personal connections outside of work.</p>

      {socialHealth.neglectedConnections.length > 0 && (
        <div>
          <p>You haven't mentioned these people in a while:</p>
          <ul>
            {socialHealth.neglectedConnections.map(person => (
              <li key={person.tag}>
                {person.name} - last mentioned {person.daysSince} days ago
                <Button onClick={() => suggestAction(person)}>
                  Suggest a small action
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ValuesReminder value="Connection" />

      <SuggestedActions>
        <Action>Send a quick text to {topNeglected.name}</Action>
        <Action>Schedule a call for this weekend</Action>
        <Action>Share something you've been thinking about</Action>
      </SuggestedActions>
    </Alert>
  );
}
```

#### 7.3 Social Health Dashboard Widget

**New Component:** `/src/components/dashboard/shared/SocialHealthWidget.jsx`

Visualizations:
1. **Connection Balance Meter** - Work vs Personal mention ratio
2. **Connection Timeline** - When you last mentioned key people
3. **Isolation Alert Banner** - When personal connections are low
4. **Quick Action Buttons** - "Text [person]", "Call [person]"

#### 7.4 AI-Powered Social Nudges

**Modified File:** `/src/services/prompts/index.js`

```javascript
// Add social connection context to prompt generation
const generateSocialPrompt = (socialHealth, cyclicalPatterns) => {
  if (socialHealth.isolationRisk) {
    return {
      type: 'social_nudge',
      prompt: `You value connection. Who could use a quick text from you today?`,
      suggestedPerson: socialHealth.neglectedConnections[0]?.name,
      smallAction: 'Send a 1-sentence check-in'
    };
  }
}
```

#### 7.5 Implementation Steps

| Step | Task | Files Affected |
|------|------|----------------|
| 1 | Create social tracker service | New: `/src/services/social/socialTracker.js` |
| 2 | Add relationship categorization | New: `/src/services/social/relationshipCategorizer.js` |
| 3 | Create isolation detection logic | `/src/services/social/socialTracker.js` |
| 4 | Build Social Resilience Alert component | New: `/src/components/social/SocialResilienceAlert.jsx` |
| 5 | Create Social Health dashboard widget | New: `/src/components/dashboard/shared/SocialHealthWidget.jsx` |
| 6 | Integrate social prompts | `/src/services/prompts/index.js` |
| 7 | Add relationship category to person tags | `/functions/index.js` |
| 8 | Create user settings for relationship classification | `/src/components/settings/` |

---

## Feature 8: HealthKit Integration

### Current State Analysis

**Existing Infrastructure:**
- Capacitor configured for iOS and Android
- No health data integration currently
- Mood analysis uses only journal entries
- No biometric correlation with mood

**Gap Analysis:**
- No sleep data to correlate with mood
- No exercise data to validate gym mentions
- No heart rate variability for stress detection
- No step count for activity levels

### Implementation Plan

#### 8.1 Capacitor HealthKit Plugin Setup

**Packages to Install:**

```bash
npm install @nickmjones/capacitor-healthkit
npx cap sync
```

**Capacitor Configuration:**

```javascript
// capacitor.config.ts
{
  plugins: {
    HealthKit: {
      // Request these data types
      readTypes: [
        'HKQuantityTypeIdentifierStepCount',
        'HKQuantityTypeIdentifierHeartRate',
        'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
        'HKCategoryTypeIdentifierSleepAnalysis',
        'HKQuantityTypeIdentifierActiveEnergyBurned',
        'HKWorkoutTypeIdentifier'
      ]
    }
  }
}
```

**iOS Permissions (Info.plist):**

```xml
<key>NSHealthShareUsageDescription</key>
<string>EchoVault uses your health data to provide personalized insights about how sleep and exercise affect your mood.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>EchoVault can record wellness activities you complete in the app.</string>
```

#### 8.2 Health Data Service

**New File:** `/src/services/health/healthDataService.js`

```javascript
import { HealthKit } from '@nickmjones/capacitor-healthkit';

export const requestHealthPermissions = async () => {
  const result = await HealthKit.requestAuthorization({
    read: [
      'stepCount', 'heartRate', 'heartRateVariabilitySDNN',
      'sleepAnalysis', 'activeEnergyBurned', 'workout'
    ],
    write: []
  });
  return result.authorized;
}

export const getHealthSummary = async (date) => {
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));

  const [steps, sleep, hrv, workouts, heartRate] = await Promise.all([
    HealthKit.queryQuantitySamples({
      sampleType: 'stepCount',
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString()
    }),
    HealthKit.queryCategorySamples({
      sampleType: 'sleepAnalysis',
      startDate: new Date(startOfDay - 86400000).toISOString(), // Previous night
      endDate: endOfDay.toISOString()
    }),
    HealthKit.queryQuantitySamples({
      sampleType: 'heartRateVariabilitySDNN',
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString()
    }),
    HealthKit.queryWorkouts({
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString()
    }),
    HealthKit.queryQuantitySamples({
      sampleType: 'heartRate',
      startDate: startOfDay.toISOString(),
      endDate: endOfDay.toISOString()
    })
  ]);

  return {
    steps: aggregateSteps(steps),
    sleep: parseSleepData(sleep),
    hrv: averageHRV(hrv),
    workouts: workouts.map(parseWorkout),
    restingHeartRate: calculateRestingHR(heartRate),
    stressIndicator: calculateStressFromHRV(hrv)
  };
}
```

#### 8.3 Health-Mood Correlation Analysis

**New File:** `/src/services/health/healthMoodCorrelation.js`

```javascript
export const analyzeHealthMoodCorrelation = async (entries, healthData, dateRange) => {
  // Correlate health metrics with mood scores

  const correlations = {
    sleep: calculateCorrelation(
      healthData.map(d => d.sleep.totalHours),
      entries.map(e => e.analysis.mood_score)
    ),
    steps: calculateCorrelation(
      healthData.map(d => d.steps),
      entries.map(e => e.analysis.mood_score)
    ),
    hrv: calculateCorrelation(
      healthData.map(d => d.hrv),
      entries.map(e => e.analysis.mood_score)
    ),
    workouts: calculateCorrelation(
      healthData.map(d => d.workouts.length > 0 ? 1 : 0),
      entries.map(e => e.analysis.mood_score)
    )
  };

  return {
    correlations,
    insights: generateHealthInsights(correlations),
    recommendations: generateHealthRecommendations(correlations, healthData)
  };
}

// Example insights:
// "Your mood is 23% higher on days you get 7+ hours of sleep"
// "Days with workouts show a 0.31 point mood boost on average"
// "Your HRV drops before low-mood days, suggesting stress buildup"
```

#### 8.4 Health Dashboard Integration

**New Component:** `/src/components/health/HealthInsightsWidget.jsx`

Visualizations:
1. **Sleep-Mood Chart** - Line graph correlating sleep hours with mood
2. **Activity Ring** - Today's steps, exercise, stand hours (Apple style)
3. **HRV Stress Meter** - Current stress level from heart rate variability
4. **Workout Impact** - Before/after mood comparison for exercise days

#### 8.5 Entry Enrichment with Health Context

**Enhanced Entry Creation:**

```javascript
// When creating entry, fetch relevant health data
const createEntryWithHealth = async (entryText, userId) => {
  const healthToday = await getHealthSummary(new Date());

  const entry = {
    text: entryText,
    createdAt: new Date(),
    healthContext: {
      sleepLastNight: healthToday.sleep.totalHours,
      stepsToday: healthToday.steps,
      workoutToday: healthToday.workouts.length > 0,
      currentHRV: healthToday.hrv,
      stressLevel: healthToday.stressIndicator
    }
  };

  return saveEntry(entry);
}
```

#### 8.6 Proactive Health-Based Prompts

**Modified File:** `/src/services/prompts/index.js`

```javascript
const generateHealthAwarePrompt = (healthData, moodTrajectory) => {
  if (healthData.sleep.totalHours < 6 && moodTrajectory.trend === 'declining') {
    return {
      type: 'health_intervention',
      prompt: 'You got less than 6 hours of sleep and your mood has been declining. How are you feeling about rest tonight?',
      suggestedAction: 'Set a wind-down alarm for 10 PM'
    };
  }

  if (healthData.stressIndicator === 'high' && !healthData.workouts.length) {
    return {
      type: 'stress_relief',
      prompt: 'Your stress indicators are elevated. A quick walk or stretch might help.',
      suggestedAction: 'Take a 10-minute walk'
    };
  }
}
```

#### 8.7 Database Schema

**Enhanced Entry Document:**

```javascript
{
  // ... existing fields ...
  healthContext: {
    sleepHours: number,
    sleepQuality: 'poor' | 'fair' | 'good' | 'excellent',
    steps: number,
    workoutMinutes: number,
    workoutType: string | null,
    hrv: number,
    stressLevel: 'low' | 'moderate' | 'high'
  }
}
```

**New Collection:** `/users/{userId}/health_snapshots`

```javascript
{
  date: Date,
  sleep: { totalHours, quality, bedtime, wakeTime },
  activity: { steps, activeMinutes, caloriesBurned },
  heart: { restingHR, hrvAverage, stressLevel },
  workouts: [{ type, duration, calories }],
  moodCorrelation: {
    sameDayMood: number,
    nextDayMood: number  // For predictive correlation
  }
}
```

#### 8.8 Android Google Fit Integration

For Android, use Google Fit API:

**Package:**
```bash
npm install @nickmjones/capacitor-health-connect
```

**Service Abstraction:**

```javascript
// /src/services/health/healthPlatform.js
import { Capacitor } from '@capacitor/core';

export const getHealthService = () => {
  if (Capacitor.getPlatform() === 'ios') {
    return import('./healthKitService');
  } else if (Capacitor.getPlatform() === 'android') {
    return import('./googleFitService');
  }
  return null;  // Web fallback - no health data
}
```

#### 8.9 Implementation Steps

| Step | Task | Files Affected |
|------|------|----------------|
| 1 | Install Capacitor HealthKit plugin | `package.json`, `capacitor.config.ts` |
| 2 | Configure iOS permissions | `ios/App/App/Info.plist` |
| 3 | Create health data service | New: `/src/services/health/healthDataService.js` |
| 4 | Build health-mood correlation analysis | New: `/src/services/health/healthMoodCorrelation.js` |
| 5 | Create permission request flow | New: `/src/components/health/HealthPermissionModal.jsx` |
| 6 | Build Health Insights dashboard widget | New: `/src/components/health/HealthInsightsWidget.jsx` |
| 7 | Integrate health context into entry creation | `/src/App.jsx` or entry service |
| 8 | Add health-aware prompts | `/src/services/prompts/index.js` |
| 9 | Create health snapshot Firestore collection | `/firestore.rules` |
| 10 | Add Google Fit support for Android | New: `/src/services/health/googleFitService.js` |
| 11 | Create unified health platform abstraction | New: `/src/services/health/healthPlatform.js` |

---

## Implementation Priority & Dependencies

### Priority Matrix

| Feature | Impact | Effort | Priority | Dependencies |
|---------|--------|--------|----------|--------------|
| 1. Burnout Prediction | High | Medium | P0 | None |
| 5. Anticipatory Anxiety | High | Low | P0 | Signal extraction (exists) |
| 7. Social Connection | High | Low | P1 | Person tags (exists) |
| 2. Leadership Support | Medium | Medium | P1 | None |
| 4. Value Tracking | High | Medium | P1 | ACT framework (exists) |
| 6. Vector DB | High | High | P2 | Can defer until 500+ entries |
| 3. SAD Environmental | Medium | High | P2 | Location permissions |
| 8. HealthKit | Medium | High | P3 | Mobile-only, permissions |

### Recommended Implementation Order

```
Phase A (Foundation) - Features 1, 5
├── Burnout risk scoring service
├── Enhanced ShelterView with decompression tools
├── Future event monitoring
└── Grounding tool components

Phase B (Insights) - Features 2, 4, 7
├── Leadership context detection
├── Values tracker service
├── Social connection monitoring
└── Dashboard widgets for all three

Phase C (External Data) - Features 3, 8
├── Location permissions flow
├── Weather/sunset API integration
├── HealthKit permissions flow
├── Health data correlation analysis

Phase D (Scale) - Feature 6
├── Pinecone account setup
├── Migration script
├── Hybrid retrieval refactoring
└── Performance testing
```

### Dependency Graph

```
Feature 1 (Burnout) ──────────────────────────┐
                                               │
Feature 5 (Anticipatory) ─── Signal Extraction ├──> Enhanced ShelterView
                                               │
Feature 3 (SAD) ─────── Environment Service ───┤
                                               │
Feature 8 (HealthKit) ── Health Service ───────┘

Feature 2 (Leadership) ─── Person Tags ───────┐
                                               ├──> Enhanced Prompts
Feature 7 (Social) ─────── Person Tags ───────┤
                                               │
Feature 4 (Values) ────── ACT Framework ──────┘

Feature 6 (Vector DB) ─── Embeddings ──> RAG Service (standalone)
```

---

## Technical Architecture Overview

### New Services Map

```
/src/services/
├── burnout/
│   ├── burnoutRiskScore.js      # Core burnout detection
│   ├── burnoutIndicators.js     # Keyword/pattern definitions
│   └── index.js
├── leadership/
│   ├── leadershipDetector.js    # Context detection
│   ├── leadershipInsights.js    # AI advice generation
│   └── index.js
├── environment/
│   ├── environmentService.js    # Location/weather fetching
│   ├── environmentalPatterns.js # Correlation analysis
│   ├── apis/
│   │   ├── weatherApi.js
│   │   └── sunTimesApi.js
│   └── index.js
├── values/
│   ├── valuesTracker.js         # Longitudinal tracking
│   ├── behaviorExtractor.js     # Action extraction
│   └── index.js
├── anticipatory/
│   ├── futureEventMonitor.js    # Stressful event detection
│   ├── groundingTools.js        # Technique library
│   └── index.js
├── social/
│   ├── socialTracker.js         # Connection monitoring
│   ├── relationshipCategorizer.js
│   └── index.js
├── health/
│   ├── healthDataService.js     # HealthKit wrapper
│   ├── healthMoodCorrelation.js
│   ├── healthPlatform.js        # iOS/Android abstraction
│   └── index.js
└── vectorSearch/
    ├── vectorDatabase.js        # Pinecone integration
    └── migration.js
```

### New Components Map

```
/src/components/
├── shelter/
│   ├── BurnoutContext.jsx
│   ├── BreathingExercise.jsx
│   ├── GroundingExercise.jsx
│   └── DecompressionTimer.jsx
├── leadership/
│   ├── PostMortem.jsx
│   └── LeadershipInsights.jsx
├── grounding/
│   ├── GroundingToolSelector.jsx
│   ├── FiveFourThreeTwoOne.jsx
│   ├── BoxBreathing.jsx
│   └── BodyScanQuick.jsx
├── anticipatory/
│   └── FutureSelfCheckIn.jsx
├── values/
│   ├── ValuesDashboard.jsx
│   ├── ValuesRadarChart.jsx
│   └── ValueGapAlert.jsx
├── social/
│   ├── SocialResilienceAlert.jsx
│   └── SocialHealthWidget.jsx
├── health/
│   ├── HealthInsightsWidget.jsx
│   ├── HealthPermissionModal.jsx
│   └── SleepMoodChart.jsx
└── environment/
    ├── SADInterventions.jsx
    └── EnvironmentalInsights.jsx
```

### Database Collections Summary

```
/users/{userId}/
├── entries/                 # Existing - enhanced with health context
├── signals/                 # Existing
├── day_summaries/           # Existing
├── burnout_tracking/        # NEW - daily risk scores
├── values_tracking/         # NEW - daily value alignment
├── values_profile/          # NEW - core values definition
├── social_health/           # NEW - connection metrics
├── health_snapshots/        # NEW - daily biometric data
└── environment_context/     # NEW - weather/location per day
```

---

## Success Metrics

### Feature 1: Burnout Prevention
- Reduction in "burned out" keyword frequency after Shelter Mode
- User-reported helpfulness of decompression tools
- Time spent in Shelter Mode before mood stabilization

### Feature 2: Leadership Support
- Engagement rate with Post-Mortem feature
- Reduction in negative self-talk in leadership entries
- User-reported confidence after difficult conversations

### Feature 3: SAD/Environmental
- Proactive SAD lamp adoption rate
- Correlation between intervention suggestions and mood improvement
- User engagement with environmental insights

### Feature 4: Value Tracking
- Improvement in alignment scores over 30-day periods
- User engagement with gap alerts
- Reduction in values-behavior conflicts

### Feature 5: Anticipatory Support
- Usage rate of grounding tools on stressful mornings
- User-reported anxiety levels before vs after check-in
- Completion rate of Future Self flow

### Feature 6: Vector DB
- Query latency at 1000+ entries (<500ms)
- Relevance of retrieved context in RAG responses
- Migration success rate

### Feature 7: Social Connection
- Increase in personal @person tags after nudges
- User-reported social connection satisfaction
- Action completion rate from nudge suggestions

### Feature 8: HealthKit
- Permission grant rate
- Accuracy of sleep-mood correlation predictions
- User engagement with health insights

---

## Cross-Cutting Concern: Privacy Ledger (Features 3 & 8)

### Problem Statement

EchoVault is designed as a "vault" - a safe, private space for users to process their emotions. Features 3 (Environmental) and 8 (HealthKit) introduce external data sources that may feel invasive:

- **Location tracking** (even if only for weather/sunset data)
- **Health data access** (sleep, heart rate, workouts)
- **Continuous environmental correlation**

Users may be wary of "Always On" tracking, even if it's well-intentioned.

### Solution: Privacy Ledger

A transparent, user-accessible log of exactly how their data is being used.

**New Component:** `/src/components/privacy/PrivacyLedger.jsx`

```javascript
const PrivacyLedger = ({ userId }) => {
  const [ledgerEntries, setLedgerEntries] = useState([]);

  useEffect(() => {
    const loadLedger = async () => {
      const entries = await getPrivacyLedger(userId);
      setLedgerEntries(entries);
    };
    loadLedger();
  }, [userId]);

  return (
    <div className="privacy-ledger">
      <h2>Your Data Usage</h2>
      <p className="intro">
        EchoVault collects some data to provide personalized insights.
        Here's exactly what we've accessed and how it was used.
      </p>

      <DataTypeSection type="location">
        <h3>Location Data</h3>
        <p>Used to: Determine sunrise/sunset times and weather for SAD correlation</p>
        <ul>
          {ledgerEntries.filter(e => e.type === 'location').map(entry => (
            <LedgerEntry key={entry.id} entry={entry} />
          ))}
        </ul>
        <PrivacyNote>
          Your location is only accessed when you open the app.
          It is never shared with third parties.
          Processed locally on your device.
        </PrivacyNote>
      </DataTypeSection>

      <DataTypeSection type="health">
        <h3>Health Data (HealthKit/Google Fit)</h3>
        <p>Used to: Correlate sleep, activity, and stress indicators with your mood</p>
        <ul>
          {ledgerEntries.filter(e => e.type === 'health').map(entry => (
            <LedgerEntry key={entry.id} entry={entry} />
          ))}
        </ul>
        <PrivacyNote>
          Health data is read-only. EchoVault never writes to HealthKit.
          All correlation analysis happens locally or in your private Firestore.
          We do not sell or share health data.
        </PrivacyNote>
      </DataTypeSection>

      <RevokeSection>
        <h3>Manage Permissions</h3>
        <Button onClick={revokeLocation}>Revoke Location Access</Button>
        <Button onClick={revokeHealth}>Revoke Health Access</Button>
        <Button onClick={deleteAllExternalData}>Delete All External Data</Button>
      </RevokeSection>
    </div>
  );
};

const LedgerEntry = ({ entry }) => (
  <li className="ledger-entry">
    <span className="date">{formatDate(entry.timestamp)}</span>
    <span className="action">{entry.action}</span>
    <span className="purpose">{entry.purpose}</span>
    <span className="data-points">{entry.dataPoints.join(', ')}</span>
  </li>
);
```

### Privacy Ledger Service

**New File:** `/src/services/privacy/privacyLedger.js`

```javascript
export const logDataAccess = async (userId, accessLog) => {
  // Called whenever external data is accessed
  await addDoc(collection(db, `users/${userId}/privacy_ledger`), {
    timestamp: new Date(),
    type: accessLog.type,  // 'location' | 'health' | 'weather'
    action: accessLog.action,  // 'fetched_sunset_time' | 'read_sleep_data'
    purpose: accessLog.purpose,  // 'SAD_correlation' | 'mood_prediction'
    dataPoints: accessLog.dataPoints,  // ['sunset_time: 5:15 PM', 'city: Seattle']
    processingLocation: accessLog.processingLocation  // 'local' | 'cloud'
  });
};

// Example usage in environment service
export const getEnvironmentContext = async () => {
  const position = await Geolocation.getCurrentPosition();

  // Log the access
  await logDataAccess(userId, {
    type: 'location',
    action: 'fetched_location_for_weather',
    purpose: 'Determine sunrise/sunset times for SAD pattern analysis',
    dataPoints: [`lat: ${position.coords.latitude.toFixed(2)}`, `lon: ${position.coords.longitude.toFixed(2)}`],
    processingLocation: 'local'
  });

  // ... continue with weather fetch
};

// Example usage in health service
export const getHealthSummary = async (date) => {
  const sleep = await HealthKit.queryCategorySamples({ sampleType: 'sleepAnalysis', ... });

  // Log the access
  await logDataAccess(userId, {
    type: 'health',
    action: 'read_sleep_data',
    purpose: 'Correlate sleep hours with mood for personalized insights',
    dataPoints: [`sleep_hours: ${parseSleepData(sleep).totalHours}h`],
    processingLocation: 'local'
  });

  // ... continue with health summary
};
```

### In-Context Privacy Callouts

When displaying insights that use external data, show the source:

**Example in SADInterventions.jsx:**

```javascript
<InsightCard>
  <h4>Light Exposure Pattern</h4>
  <p>Your mood drops 23% on days with less than 10 hours of daylight.</p>

  <PrivacyCallout>
    <LockIcon />
    <span>
      This insight uses your location to determine sunset times.
      Location data is processed locally and never shared.
      <Link to="/privacy-ledger">View full data usage</Link>
    </span>
  </PrivacyCallout>
</InsightCard>
```

**Example in HealthInsightsWidget.jsx:**

```javascript
<InsightCard>
  <h4>Sleep-Mood Connection</h4>
  <p>You're 31% happier on days with 7+ hours of sleep.</p>

  <PrivacyCallout>
    <LockIcon />
    <span>
      This insight uses sleep data from HealthKit.
      Health data is read-only and stays on your device.
      <Link to="/privacy-ledger">View full data usage</Link>
    </span>
  </PrivacyCallout>
</InsightCard>
```

### Database Schema

**New Collection:** `/users/{userId}/privacy_ledger`

```javascript
{
  id: string,
  timestamp: Date,
  type: 'location' | 'health' | 'weather' | 'environmental',
  action: string,  // Human-readable action
  purpose: string,  // Why this data was accessed
  dataPoints: string[],  // What specific data was accessed (sanitized)
  processingLocation: 'local' | 'cloud',
  feature: string  // Which feature triggered this access
}
```

### Key Privacy Principles

1. **Transparency** - Users can see exactly what data was accessed and when
2. **Purpose Limitation** - Each access logged with specific purpose
3. **Local Processing** - Prefer on-device processing when possible
4. **Easy Revocation** - One-click to revoke permissions
5. **Data Deletion** - Users can delete all external data without affecting journal entries
6. **Minimal Collection** - Only collect what's needed for the specific insight
7. **No Selling** - Explicit commitment that health/location data is never sold

### Implementation Steps

| Step | Task | Files Affected |
|------|------|----------------|
| 1 | Create privacy ledger service | New: `/src/services/privacy/privacyLedger.js` |
| 2 | Add logging to environment service | `/src/services/environment/environmentService.js` |
| 3 | Add logging to health service | `/src/services/health/healthDataService.js` |
| 4 | Create Privacy Ledger UI component | New: `/src/components/privacy/PrivacyLedger.jsx` |
| 5 | Create in-context PrivacyCallout component | New: `/src/components/privacy/PrivacyCallout.jsx` |
| 6 | Add privacy ledger to settings navigation | `/src/components/settings/` |
| 7 | Create revocation handlers | `/src/services/privacy/revokePermissions.js` |
| 8 | Add privacy ledger Firestore collection | `/firestore.rules` |

---

## Conclusion

This implementation plan transforms EchoVault from a reactive journaling tool into a proactive mental wellness companion. By leveraging existing infrastructure (mood trajectory, ACT framework, signal extraction, person tags) and adding targeted new capabilities (burnout detection, environmental awareness, biometric integration), the app can anticipate user needs and provide timely interventions.

The phased approach ensures high-impact features are delivered first while building toward a comprehensive wellness platform. Each feature is designed to integrate seamlessly with existing patterns and can be developed independently after core dependencies are satisfied.

---

*Document Version: 1.1*
*Created: December 2024*
*Updated: December 2024*
*Author: Implementation Planning*

### Changelog

**v1.1** - Added Critical UX Refinements:
- Feature 1: Soft Block pattern instead of auto-trigger (addresses jarring UX concern)
- Feature 2: Leadership Threads for longitudinal mentee growth tracking
- Feature 3: Indoor Time correlation for missed daylight detection
- Feature 4: Compassionate Reframe for value gap handling (no shame approach)
- Feature 5: "How Did It Go?" follow-up for CBT loop closure
- Cross-cutting: Privacy Ledger for transparent data usage (Features 3 & 8)
