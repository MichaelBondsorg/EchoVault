# Insights Engine Redesign - Implementation Plan

## Executive Summary

This plan addresses two core issues with the current insights engine:
1. **Shallow insights**: Current patterns are basic correlations ("yoga boosts mood by 23%")
2. **Stale data**: 6-hour cache + deterministic "top insight" selection = same content every visit

The redesign introduces **4 Power Tiers** of insights, fixes the staleness problem, and adds a **Narrative Summary** feature.

---

## Phase 1: Fix Staleness (Quick Win)

**Goal**: Users see different insights each visit, even with unchanged data.

### 1.1 Insight Rotation System

**File**: `src/services/patterns/insightRotation.js` (new)

```javascript
// Core concept: Track which insights have been shown, rotate through available pool
export const getNextInsight = async (userId, allInsights) => {
  // 1. Load rotation state from localStorage/Firestore
  // 2. Filter out recently-shown insights (last 3 views)
  // 3. Weight by: recency of pattern + significance + days since last shown
  // 4. Return top candidate
  // 5. Update rotation state
}
```

**Changes Required**:
- Add `lastShownAt` tracking per insight in `InsightBite.jsx`
- Modify `InsightsPanel.jsx` to shuffle order based on rotation state
- Store rotation state in localStorage with Firestore backup

### 1.2 Triggered Pattern Recomputation

**File**: `src/services/background/entryPostProcessing.js`

Add pattern cache invalidation after entry save:

```javascript
// After line 40, add:
// Task 2: Invalidate pattern cache for immediate refresh
tasks.push(invalidatePatternCache(userId));
```

**File**: `src/services/patterns/cached.js`

Add cache invalidation function:

```javascript
export const invalidatePatternCache = async (userId) => {
  // Set a flag that forces recomputation on next load
  // OR trigger Cloud Function refreshPatterns
}
```

### 1.3 Partial Refresh Strategy

| Pattern Type | Refresh Trigger | Frequency |
|--------------|-----------------|-----------|
| `activity_sentiment` | Every new entry | Immediate |
| `temporal` | Daily or 7+ new entries | 24h max |
| `contradictions` | Weekly or significant event | Weekly |
| `narrative_summary` | Monday morning | Weekly |

**Implementation**: Modify `functions/index.js` to support partial pattern updates.

---

## Phase 2: Shadow Friction (Entity + Topic Intersections)

**Goal**: "Conversations with Sarah about work are 40% more stressful than personal topics"

### 2.1 Data Structure Changes

**File**: `src/services/patterns/index.js`

Modify `computeActivitySentiment` to build compound keys:

```javascript
// Current: entityMoods.set('@person:sarah', { moods: [...] })
// New: Also track compound keys

// Extract topic tags from same entry
const topicTags = entry.tags?.filter(t => t.startsWith('@topic:')) || [];

// Create intersection keys
personTags.forEach(person => {
  topicTags.forEach(topic => {
    const compoundKey = `${person}+${topic}`;
    if (!entityMoods.has(compoundKey)) {
      entityMoods.set(compoundKey, { moods: [], entries: [], type: 'intersection' });
    }
    // ... track mood data
  });
});
```

### 2.2 Insight Generation

Add new insight template:

```javascript
// If compound pattern has significant delta vs individual entities
if (compoundPattern.moodDelta < personPattern.moodDelta - 0.15) {
  insight = `Discussions with ${personName} about ${topicName} are ${Math.abs(deltaPercent)}% more challenging than other interactions with them`;
}
```

### 2.3 UI Updates

**File**: `src/components/modals/InsightsPanel.jsx`

Add new section for "Relationship Dynamics" showing intersection insights.

---

## Phase 3: Compounding Impact (Health + Context Joins)

**Goal**: "Office days after poor sleep lead to 50% mood drop by evening"

### 3.1 Health Data Integration

**File**: `src/services/patterns/compoundTriggers.js` (new)

```javascript
import { getHealthSummary } from '../health/platformHealth';

export const computeCompoundTriggers = async (userId, entries) => {
  const healthData = await getHealthSummary(userId, 30); // 30 days

  // Join health data with entries by date
  const entriesWithHealth = entries.map(entry => {
    const entryDate = formatDate(entry.effectiveDate);
    const healthForDay = healthData.find(h => h.date === entryDate);
    return { ...entry, health: healthForDay };
  });

  // Look for compound patterns
  return analyzeCompoundPatterns(entriesWithHealth);
};

const analyzeCompoundPatterns = (entries) => {
  const patterns = [];

  // Pattern: Poor sleep + specific activity = bad outcome
  const poorSleepDays = entries.filter(e => e.health?.sleep < 6);
  const goodSleepDays = entries.filter(e => e.health?.sleep >= 7);

  // Compare mood for same activities on poor vs good sleep days
  // If delta > 0.2, flag as compound trigger

  return patterns;
};
```

### 3.2 Cloud Function Integration

**File**: `functions/index.js`

Add health data fetch to `computePatternsForUser`:

```javascript
// Fetch health data from user's health subcollection
const healthSnapshot = await db
  .collection('artifacts')
  .doc(APP_COLLECTION_ID)
  .collection('users')
  .doc(userId)
  .collection('health_data')
  .orderBy('date', 'desc')
  .limit(30)
  .get();
```

---

## Phase 4: Pre-emptive Warnings (Absence Detection)

**Goal**: "You typically stop mentioning yoga 3 days before anxiety spikes"

### 4.1 Absence Pattern Detection

**File**: `src/services/patterns/absencePatterns.js` (new)

```javascript
export const computeAbsencePatterns = (entries, activityPatterns) => {
  const highSentimentEntities = activityPatterns
    .filter(p => p.sentiment === 'positive' && p.entryCount >= 3);

  const absencePatterns = [];

  highSentimentEntities.forEach(entity => {
    // Find mood drops (entries where mood < baseline - 0.2)
    const moodDrops = findMoodDrops(entries);

    moodDrops.forEach(drop => {
      // Look at 72 hours before the drop
      const windowStart = subtractHours(drop.date, 72);
      const windowEnd = drop.date;

      // Check if entity was mentioned in window
      const mentionedInWindow = entries.some(e =>
        e.date >= windowStart &&
        e.date < windowEnd &&
        e.tags?.includes(entity.entity)
      );

      if (!mentionedInWindow) {
        // Entity was absent before mood drop
        trackAbsenceBeforeDrop(entity, drop);
      }
    });
  });

  // Calculate statistical significance
  // Return patterns where absence precedes drop > 60% of the time
  return absencePatterns.filter(p => p.correlation > 0.6);
};
```

### 4.2 Proactive Warning Generation

**File**: `src/services/patterns/index.js`

Add to `generateProactiveContext`:

```javascript
// 5. Absence-based warnings
const absencePatterns = computeAbsencePatterns(entries, activityPatterns);
const now = new Date();

absencePatterns.forEach(pattern => {
  const hoursSinceLastMention = getHoursSinceLastMention(entries, pattern.entity);

  if (hoursSinceLastMention > 48 && hoursSinceLastMention < 96) {
    insights.push({
      type: 'absence_warning',
      priority: 'preemptive',
      entity: pattern.entity,
      message: `You typically stop mentioning ${pattern.entityName} before a dip. Consider a session today?`,
      data: {
        hoursSinceLastMention,
        historicalCorrelation: pattern.correlation
      }
    });
  }
});
```

---

## Phase 5: Linguistic Shifts (Identity Analysis)

**Goal**: "You've switched from 'I need to' to 'I want to' 25% more this week"

### 5.1 Self-Statement Tracking

**File**: `src/services/patterns/linguisticPatterns.js` (new)

```javascript
const LINGUISTIC_MARKERS = {
  obligation: ['I need to', 'I have to', 'I should', 'I must', 'I ought to'],
  agency: ['I want to', 'I choose to', 'I get to', 'I decided to'],
  negative_self: ['I always', 'I never', 'I can\'t', 'I\'m not good at'],
  positive_self: ['I can', 'I\'m learning', 'I\'m getting better at'],
  catastrophizing: ['everything is', 'nothing works', 'always happens'],
  growth: ['I realized', 'I learned', 'I\'m starting to']
};

export const computeLinguisticPatterns = (entries, windowDays = 14) => {
  const now = new Date();
  const windowStart = subtractDays(now, windowDays);
  const previousWindowStart = subtractDays(windowStart, windowDays);

  const currentWindow = entries.filter(e => e.date >= windowStart);
  const previousWindow = entries.filter(e => e.date >= previousWindowStart && e.date < windowStart);

  const patterns = [];

  Object.entries(LINGUISTIC_MARKERS).forEach(([category, markers]) => {
    const currentCount = countMarkers(currentWindow, markers);
    const previousCount = countMarkers(previousWindow, markers);

    // Normalize by entry count
    const currentRate = currentCount / currentWindow.length;
    const previousRate = previousCount / previousWindow.length;

    const change = ((currentRate - previousRate) / previousRate) * 100;

    if (Math.abs(change) > 20) {
      patterns.push({
        category,
        direction: change > 0 ? 'increase' : 'decrease',
        changePercent: Math.abs(Math.round(change)),
        insight: generateLinguisticInsight(category, change)
      });
    }
  });

  return patterns;
};

const generateLinguisticInsight = (category, change) => {
  const templates = {
    obligation_decrease: 'You\'re using fewer "should" and "must" statements - a shift toward self-compassion',
    agency_increase: 'More "I want to" language this week suggests growing sense of choice',
    negative_self_decrease: 'You\'ve been gentler in how you talk about yourself lately',
    // ... more templates
  };

  const key = `${category}_${change > 0 ? 'increase' : 'decrease'}`;
  return templates[key] || null;
};
```

### 5.2 @self: Tag Integration

Leverage existing `@self:statement` tags from analysis:

```javascript
// In computeLinguisticPatterns
const selfStatements = entries
  .flatMap(e => e.tags?.filter(t => t.startsWith('@self:')) || [])
  .map(t => t.replace('@self:', ''));

// Analyze sentiment trends in self-statements over time
```

---

## Phase 6: Narrative Summary ("State of the Vault")

**Goal**: Weekly synthesized narrative instead of individual insight cards

### 6.1 Cloud Function for Digest Generation

**File**: `functions/index.js`

Add new function:

```javascript
export const generateWeeklyDigest = onSchedule(
  {
    schedule: 'every monday 06:00',
    timeZone: 'America/New_York',
    secrets: [geminiApiKey]
  },
  async (event) => {
    // Get all users who have entries in the past week
    const usersWithActivity = await getActiveUsers(7);

    for (const userId of usersWithActivity) {
      await generateUserDigest(userId, geminiApiKey.value());
    }
  }
);

async function generateUserDigest(userId, apiKey) {
  // 1. Fetch all patterns for user
  const patterns = await getPatternsForUser(userId);

  // 2. Fetch week's entries for context
  const weekEntries = await getEntriesForWeek(userId);

  // 3. Build prompt for AI synthesis
  const prompt = buildDigestPrompt(patterns, weekEntries);

  // 4. Generate narrative
  const narrative = await callGemini(apiKey, DIGEST_SYSTEM_PROMPT, prompt);

  // 5. Store digest
  await storeWeeklyDigest(userId, {
    narrative,
    generatedAt: new Date(),
    weekOf: getWeekStart(),
    patterns: summarizePatterns(patterns)
  });
}

const DIGEST_SYSTEM_PROMPT = `
You are a compassionate journaling companion synthesizing a week of insights.

Write a 2-3 paragraph narrative that:
1. Opens with the emotional arc of the week (not just "you had X entries")
2. Connects patterns to specific moments when relevant
3. Notes any shifts, growth, or areas needing attention
4. Ends with one forward-looking observation or gentle suggestion

Tone: Warm but not saccharine. Insightful but not clinical. Personal but not presumptuous.

Do NOT:
- Use bullet points
- List statistics
- Sound like a report
- Be vague or generic

DO:
- Reference specific patterns by name (e.g., "your mornings with Sarah")
- Acknowledge both challenges and strengths
- Write like a thoughtful friend who's been paying attention
`;
```

### 6.2 Digest UI Component

**File**: `src/components/dashboard/shared/NarrativeDigest.jsx` (new)

```jsx
const NarrativeDigest = ({ userId, category }) => {
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLatestDigest(userId).then(setDigest).finally(() => setLoading(false));
  }, [userId]);

  if (!digest || !isCurrentWeek(digest.weekOf)) return null;

  return (
    <motion.div className="bg-gradient-to-br from-primary-50 to-secondary-50 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen size={18} className="text-primary-600" />
        <h3 className="font-display font-semibold text-warm-800">Your Week</h3>
      </div>

      <div className="prose prose-warm text-sm leading-relaxed">
        {digest.narrative.split('\n\n').map((para, i) => (
          <p key={i} className="mb-3">{para}</p>
        ))}
      </div>

      <p className="text-xs text-warm-400 mt-4">
        Generated {formatRelativeTime(digest.generatedAt)}
      </p>
    </motion.div>
  );
};
```

### 6.3 On-Demand Regeneration

Add ability to regenerate digest after significant events:

```javascript
// In entryPostProcessing.js
if (isSignificantEvent(entry)) {
  // Trigger mid-week digest update
  tasks.push(triggerDigestRefresh(userId, 'significant_event'));
}

const isSignificantEvent = (entry) => {
  return entry.analysis?.mood_score < 0.25 || // Crisis
         entry.analysis?.mood_score > 0.85 || // Peak
         entry.goal_update?.status === 'achieved'; // Goal achieved
};
```

---

## Phase 7: Hypothesis Framing (UX Enhancement)

**Goal**: Present insights as collaborative questions, not facts

### 7.1 Insight Template Updates

**File**: `src/services/patterns/insightTemplates.js` (new)

```javascript
export const INSIGHT_TEMPLATES = {
  positive_activity: {
    statement: '{entity} tends to boost your mood by {percent}%',
    hypothesis: 'I noticed you feel better around {entity}. What makes those moments special?'
  },
  negative_activity: {
    statement: 'Your mood tends to dip {percent}% around {entity}',
    hypothesis: 'There seems to be some friction around {entity}. Would it help to explore that?'
  },
  shadow_friction: {
    statement: 'Discussions with {person} about {topic} are {percent}% more challenging',
    hypothesis: 'I noticed {topic} conversations with {person} feel different. Did something shift there?'
  },
  absence_warning: {
    statement: 'You typically stop mentioning {entity} before mood dips',
    hypothesis: 'It\'s been a few days since {entity} came up. Might be worth a session?'
  },
  linguistic_shift: {
    statement: 'You\'ve used {percent}% fewer "should" statements this week',
    hypothesis: 'Your language is shifting - less obligation, more choice. Does that feel accurate?'
  }
};

export const formatInsight = (pattern, preferHypothesis = true) => {
  const template = INSIGHT_TEMPLATES[pattern.type];
  if (!template) return pattern.message;

  const format = preferHypothesis ? template.hypothesis : template.statement;
  return interpolate(format, pattern.data);
};
```

### 7.2 User Preference

Add setting for insight style:

```javascript
// In user preferences
insightStyle: 'hypothesis' | 'statement' | 'mixed'
```

---

## Implementation Sequence

### Sprint 1 (Days 1-3): Staleness Fix
1. Implement insight rotation in `insightRotation.js`
2. Add rotation state to `InsightBite.jsx`
3. Wire up cache invalidation in `entryPostProcessing.js`
4. Test: Verify different insights appear on each visit

### Sprint 2 (Days 4-7): Shadow Friction
1. Modify `computeActivitySentiment` for compound keys
2. Add intersection insight generation
3. Update `InsightsPanel.jsx` with new section
4. Test: Verify entity+topic patterns generate correctly

### Sprint 3 (Days 8-11): Compound Triggers + Absence
1. Create `compoundTriggers.js` with health joins
2. Create `absencePatterns.js`
3. Integrate into `generateProactiveContext`
4. Test: Verify health-mood correlations appear

### Sprint 4 (Days 12-15): Linguistic + Narrative
1. Create `linguisticPatterns.js`
2. Add `generateWeeklyDigest` Cloud Function
3. Create `NarrativeDigest.jsx` component
4. Test: Generate sample digests, verify quality

### Sprint 5 (Days 16-18): Polish + Hypothesis Framing
1. Create `insightTemplates.js`
2. Update all insight consumers to use templates
3. Add user preference for insight style
4. Final integration testing

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/services/patterns/insightRotation.js` | Rotation logic for insight freshness |
| `src/services/patterns/compoundTriggers.js` | Health + context compound patterns |
| `src/services/patterns/absencePatterns.js` | Absence-before-drop detection |
| `src/services/patterns/linguisticPatterns.js` | Self-talk analysis |
| `src/services/patterns/insightTemplates.js` | Hypothesis vs statement templates |
| `src/components/dashboard/shared/NarrativeDigest.jsx` | Weekly narrative UI |

## Files to Modify

| File | Changes |
|------|---------|
| `src/services/patterns/index.js` | Add compound keys, absence detection, linguistic analysis |
| `src/services/patterns/cached.js` | Add cache invalidation, partial refresh |
| `src/services/background/entryPostProcessing.js` | Add pattern cache invalidation trigger |
| `src/components/modals/InsightsPanel.jsx` | Add new sections, rotation integration |
| `src/components/insights/InsightBite.jsx` | Add rotation tracking |
| `functions/index.js` | Add `generateWeeklyDigest`, partial refresh support |

---

## Success Metrics

1. **Freshness**: < 10% of visits show same top insight as previous visit
2. **Engagement**: Insight dismissal rate decreases by 25%
3. **Perceived value**: User feedback shifts from "obvious" to "insightful"
4. **Depth**: Average insight references 2+ data points (vs current 1)

---

## Questions for Review

1. **Priority confirmation**: Should we start with staleness fix, or jump to higher-impact features like Narrative Summary?

2. **Health data**: How complete is health data integration currently? Need to assess before Phase 3.

3. **AI cost**: Narrative digest uses AI for synthesis. Acceptable for all users, or premium feature?

4. **Hypothesis framing**: Default to hypothesis style, or make it a user preference from day one?

5. **Compound triggers**: Focus on health compounds first, or include other intersections (time + activity, person + place)?
