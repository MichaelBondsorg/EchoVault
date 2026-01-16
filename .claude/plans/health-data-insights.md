# Health & Environment Data Everywhere + Nexus 2.0 Integration

## Goal
Health AND environment data should be **everywhere** - associated with entries, used in insights, available in chat, powering reflections, and deeply analyzed by Nexus 2.0.

---

## Current State

| Component | Has Data? | Uses Health? | Uses Environment? |
|-----------|-----------|--------------|-------------------|
| Entries | ✅ `healthContext` + `environmentContext` | N/A | N/A |
| AI Chat (`askJournalAI`) | ❌ Not passed | ❌ No | ❌ No |
| Insight Generation (`generateInsight`) | ❌ Not passed | ❌ No | ❌ No |
| Day Summary (`generateDaySummary`) | ❌ Not passed | ❌ No | ❌ No |
| Reflections/Prompts | ❌ Not passed | ❌ No | ❌ No |
| Nexus 2.0 | 🔧 Spec ready | 🔧 Not implemented | 🔧 Not implemented |

### Data Already Being Captured

**healthContext:**
```javascript
{
  sleep: { totalHours, quality, score, stages: { deep, rem, core } },
  heart: { restingRate, hrv, hrvTrend, stressIndicator },
  recovery: { score, status },  // Whoop
  strain: { score },            // Whoop
  activity: { stepsToday, totalExerciseMinutes, hasWorkout, workouts }
}
```

**environmentContext:**
```javascript
{
  weather: 'partly_cloudy',
  weatherLabel: 'Partly Cloudy',
  temperature: 72,
  temperatureUnit: '°F',
  cloudCover: 45,
  isDay: true,
  daySummary: {
    condition: 'sunny',
    tempHigh: 78,
    tempLow: 52,
    sunshineMinutes: 480,
    sunshinePercent: 75
  },
  sunsetTime: '5:45 PM',
  sunriseTime: '7:15 AM',
  daylightHours: 10.5,
  isAfterDark: false,
  lightContext: 'daylight',  // daylight | dark | low_light | fading
  daylightRemaining: 4.2
}
```

---

## Architecture: Context Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     HEALTH + ENVIRONMENT DATA FLOW                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  HealthKit/Whoop ──→ healthContext ──┐                                  │
│                                       ├──→ Entry                         │
│  Weather/Location ──→ environmentContext                                │
│                              │                                           │
│         ┌────────────────────┼────────────────────┐                     │
│         │                    │                    │                     │
│         ▼                    ▼                    ▼                     │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │ AI Chat     │    │ Insights     │    │ Reflections  │               │
│  │ askJournalAI│    │ generateInsight│  │ Daily prompts│               │
│  └─────────────┘    └──────────────┘    └──────────────┘               │
│         │                    │                    │                     │
│         └────────────────────┼────────────────────┘                     │
│                              │                                           │
│                              ▼                                           │
│                    ┌──────────────────┐                                 │
│                    │   NEXUS 2.0      │                                 │
│                    │ Deep Analysis    │                                 │
│                    │ - Health-mood    │                                 │
│                    │ - Weather-mood   │                                 │
│                    │ - Light-mood     │                                 │
│                    │ - Interventions  │                                 │
│                    └──────────────────┘                                 │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 0: Environment Backfill + Export Fixes
**Goal**: Apply environment data retroactively to existing entries, fix export

#### 0a. Environment Backfill Service

**New File**: `src/services/environment/environmentBackfill.js`

Similar to `healthBackfill.js`, but for environment data:

```javascript
/**
 * Environment Data Backfill Service
 *
 * Retroactively applies environment data to existing entries.
 * Note: Historical weather requires paid API - we can only backfill
 * entries from the past ~7 days (Open-Meteo free tier limitation).
 * For older entries, we mark as "unavailable" but don't error.
 */

import { auth, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getDailyWeatherHistory } from './apis/weather';
import { collection, query, orderBy, limit, getDocs, doc, updateDoc } from 'firebase/firestore';

/**
 * Get entries that don't have environment context (recent only)
 */
export const getEntriesWithoutEnvironment = async (maxEntries = 200, daysBack = 7) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const entriesRef = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries');
  const q = query(entriesRef, orderBy('createdAt', 'desc'), limit(maxEntries));
  const snapshot = await getDocs(q);

  const entriesWithoutEnv = [];
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const createdAt = data.createdAt?.toDate?.() || new Date(data.createdAt);

    // Only backfill recent entries (API limitation)
    if (!data.environmentContext && createdAt >= cutoffDate) {
      entriesWithoutEnv.push({
        id: docSnap.id,
        createdAt,
        content: data.content?.substring(0, 50) + '...'
      });
    }
  });

  return entriesWithoutEnv;
};

/**
 * Backfill environment data for recent entries
 */
export const backfillEnvironmentData = async (onProgress, signal) => {
  // Similar structure to healthBackfill
  // Uses getDailyWeatherHistory to fetch historical weather
  // ...
};
```

#### 0b. Remove Entry Limit / Increase for Export

**File**: `src/App.jsx` (line 441)

```javascript
// BEFORE
const q = query(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'), orderBy('createdAt', 'desc'), limit(100));

// AFTER - No limit for export, or higher limit
const q = query(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'), orderBy('createdAt', 'desc'), limit(1000));
```

Or create a separate function for export that fetches all entries without limit.

#### 0c. Include Health + Environment in Export

**File**: `src/components/screens/TherapistExportScreen.jsx`

**Modify `generateJSON` (lines 142-165)**:

```javascript
const generateJSON = () => {
  const selectedList = filteredEntries.filter(e => selectedEntries.has(e.id));
  const exportData = {
    exportDate: new Date().toISOString(),
    entryCount: selectedList.length,
    entries: selectedList.map(e => ({
      date: e.createdAt.toISOString(),
      title: e.title,
      text: e.text,
      mood_score: e.analysis?.mood_score,
      entry_type: e.entry_type,
      tags: e.tags,
      cbt_breakdown: e.analysis?.cbt_breakdown,
      // NEW: Include health context
      healthContext: e.healthContext ? {
        sleep: e.healthContext.sleep,
        heart: e.healthContext.heart,
        recovery: e.healthContext.recovery,
        strain: e.healthContext.strain,
        activity: e.healthContext.activity
      } : null,
      // NEW: Include environment context
      environmentContext: e.environmentContext ? {
        weather: e.environmentContext.weather,
        weatherLabel: e.environmentContext.weatherLabel,
        temperature: e.environmentContext.temperature,
        daySummary: e.environmentContext.daySummary,
        lightContext: e.environmentContext.lightContext,
        daylightHours: e.environmentContext.daylightHours
      } : null
    }))
  };
  // ... rest unchanged
};
```

**Modify `generatePDF` to include health/environment summary**:

```javascript
// After mood score, add health/environment summary
if (entry.healthContext?.sleep?.totalHours) {
  doc.text(`Sleep: ${entry.healthContext.sleep.totalHours.toFixed(1)}h`, margin, yPos);
  yPos += 4;
}
if (entry.healthContext?.heart?.hrv) {
  doc.text(`HRV: ${entry.healthContext.heart.hrv}ms`, margin, yPos);
  yPos += 4;
}
if (entry.environmentContext?.weatherLabel) {
  doc.text(`Weather: ${entry.environmentContext.weatherLabel}, ${entry.environmentContext.temperature || '?'}°`, margin, yPos);
  yPos += 4;
}
```

---

### Phase 0d: Entry Card UI - Health & Environment Badges
**Goal**: Show key health/environment info on entry cards (simple, non-intrusive)

**File**: `src/components/entries/EntryCard.jsx`

Add a small context bar below the entry text showing key metrics:

```jsx
// Add after the entry text display, before the tags

{/* Health & Environment Context Bar */}
{(entry.healthContext || entry.environmentContext) && (
  <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-warm-100">
    {/* Sleep Badge */}
    {entry.healthContext?.sleep?.totalHours && (
      <div className="flex items-center gap-1 text-xs text-warm-500 bg-warm-50 px-2 py-1 rounded-full">
        <BedDouble size={12} />
        <span>{entry.healthContext.sleep.totalHours.toFixed(1)}h</span>
        {entry.healthContext.sleep.score && (
          <span className={`font-medium ${
            entry.healthContext.sleep.score >= 80 ? 'text-green-600' :
            entry.healthContext.sleep.score >= 60 ? 'text-warm-600' :
            'text-orange-600'
          }`}>
            ({entry.healthContext.sleep.score})
          </span>
        )}
      </div>
    )}

    {/* HRV Badge */}
    {entry.healthContext?.heart?.hrv && (
      <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
        entry.healthContext.heart.hrvTrend === 'improving' ? 'bg-green-50 text-green-600' :
        entry.healthContext.heart.hrvTrend === 'declining' ? 'bg-orange-50 text-orange-600' :
        'bg-warm-50 text-warm-500'
      }`}>
        <Activity size={12} />
        <span>HRV {entry.healthContext.heart.hrv}ms</span>
      </div>
    )}

    {/* Recovery Badge (Whoop) */}
    {entry.healthContext?.recovery?.score && (
      <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${
        entry.healthContext.recovery.score >= 67 ? 'bg-green-50 text-green-600' :
        entry.healthContext.recovery.score >= 34 ? 'bg-yellow-50 text-yellow-600' :
        'bg-red-50 text-red-600'
      }`}>
        <span>Recovery {entry.healthContext.recovery.score}%</span>
      </div>
    )}

    {/* Weather Badge */}
    {entry.environmentContext?.weatherLabel && (
      <div className="flex items-center gap-1 text-xs text-warm-500 bg-warm-50 px-2 py-1 rounded-full">
        {(() => {
          const WeatherIcon = getWeatherIcon(entry.environmentContext.weather, entry.environmentContext.isDay);
          return <WeatherIcon size={12} />;
        })()}
        <span>{entry.environmentContext.weatherLabel}</span>
        {entry.environmentContext.temperature && (
          <span>{Math.round(entry.environmentContext.temperature)}°</span>
        )}
      </div>
    )}

    {/* Low Sunshine Warning */}
    {entry.environmentContext?.daySummary?.isLowSunshine && (
      <div className="flex items-center gap-1 text-xs text-orange-500 bg-orange-50 px-2 py-1 rounded-full">
        <Cloud size={12} />
        <span>Low sunshine</span>
      </div>
    )}
  </div>
)}
```

**Visual Result**:
```
┌──────────────────────────────────────────────────────┐
│ 📝 Morning reflection                    Jan 14, 2026│
│                                                      │
│ Had a rough night, woke up feeling groggy...         │
│                                                      │
│ ───────────────────────────────────────────────────  │
│ 🛏 5.2h (62)  ❤️ HRV 35ms  ☁️ Partly Cloudy 52°      │
│                                                      │
│ #work #stress                                        │
└──────────────────────────────────────────────────────┘
```

---

### Phase 1: Context Formatters (Foundation)
**Goal**: Create consistent, AI-readable health AND environment summaries

**New File**: `src/services/health/healthFormatter.js`
**New File**: `src/services/environment/environmentFormatter.js`

```javascript
/**
 * Format health context for AI consumption
 * Produces human-readable summary with key signals
 */
export const formatHealthForAI = (healthContext) => {
  if (!healthContext) return null;

  const parts = [];

  // Sleep summary
  if (healthContext.sleep?.totalHours) {
    const quality = healthContext.sleep.quality ||
                    (healthContext.sleep.score >= 80 ? 'excellent' :
                     healthContext.sleep.score >= 60 ? 'good' :
                     healthContext.sleep.score >= 40 ? 'fair' : 'poor');
    parts.push(`Sleep: ${healthContext.sleep.totalHours.toFixed(1)}h (${quality})`);
    if (healthContext.sleep.score) {
      parts.push(`score: ${healthContext.sleep.score}/100`);
    }
  }

  // HRV/Stress indicators
  if (healthContext.heart?.hrv) {
    const status = healthContext.heart.hrvTrend ||
                   (healthContext.heart.hrv >= 50 ? 'good recovery' :
                    healthContext.heart.hrv >= 30 ? 'normal' : 'elevated stress');
    parts.push(`HRV: ${healthContext.heart.hrv}ms (${status})`);
  }

  if (healthContext.heart?.restingRate) {
    parts.push(`RHR: ${healthContext.heart.restingRate}bpm`);
  }

  // Recovery (Whoop)
  if (healthContext.recovery?.score) {
    parts.push(`Recovery: ${healthContext.recovery.score}%`);
  }

  // Strain (Whoop)
  if (healthContext.strain?.score) {
    parts.push(`Strain: ${healthContext.strain.score.toFixed(1)}`);
  }

  // Activity
  if (healthContext.activity?.stepsToday) {
    parts.push(`Steps: ${healthContext.activity.stepsToday.toLocaleString()}`);
  }

  if (healthContext.activity?.hasWorkout && healthContext.activity?.workouts?.length) {
    const workout = healthContext.activity.workouts[0];
    const type = workout.type || workout.activityType || 'exercise';
    const duration = workout.duration || workout.durationMinutes;
    if (duration) {
      parts.push(`Workout: ${type} (${Math.round(duration)}min)`);
    }
  }

  return parts.length > 0 ? `[Health: ${parts.join(' | ')}]` : null;
};

/**
 * Format health data for detailed analysis (more verbose)
 */
export const formatHealthDetailed = (healthContext) => {
  if (!healthContext) return null;

  const sections = [];

  if (healthContext.sleep) {
    const s = healthContext.sleep;
    sections.push(`SLEEP: ${s.totalHours?.toFixed(1) || '?'}h total, ` +
                  `quality: ${s.quality || 'unknown'}, ` +
                  `score: ${s.score || '?'}/100` +
                  (s.stages ? `, deep: ${s.stages.deep?.toFixed(1) || '?'}h, ` +
                             `REM: ${s.stages.rem?.toFixed(1) || '?'}h` : ''));
  }

  if (healthContext.heart) {
    const h = healthContext.heart;
    sections.push(`HEART: HRV ${h.hrv || '?'}ms (${h.hrvTrend || 'unknown trend'}), ` +
                  `RHR ${h.restingRate || '?'}bpm` +
                  (h.stressIndicator ? `, stress: ${h.stressIndicator}` : ''));
  }

  if (healthContext.recovery) {
    sections.push(`RECOVERY: ${healthContext.recovery.score}% ` +
                  `(${healthContext.recovery.status || 'unknown'})`);
  }

  if (healthContext.activity) {
    const a = healthContext.activity;
    sections.push(`ACTIVITY: ${a.stepsToday?.toLocaleString() || '?'} steps, ` +
                  `${a.totalExerciseMinutes || 0}min exercise` +
                  (a.hasWorkout ? `, workout: ${a.workouts?.[0]?.type || 'yes'}` : ''));
  }

  return sections.join('\n');
};

/**
 * Extract key health signals for pattern detection
 */
export const extractHealthSignals = (healthContext) => {
  if (!healthContext) return null;

  return {
    sleepHours: healthContext.sleep?.totalHours || null,
    sleepScore: healthContext.sleep?.score || null,
    sleepQuality: healthContext.sleep?.quality || null,
    hrv: healthContext.heart?.hrv || null,
    hrvTrend: healthContext.heart?.hrvTrend || null,
    rhr: healthContext.heart?.restingRate || null,
    stressLevel: healthContext.heart?.stressIndicator || null,
    recoveryScore: healthContext.recovery?.score || null,
    strainScore: healthContext.strain?.score || null,
    steps: healthContext.activity?.stepsToday || null,
    exerciseMinutes: healthContext.activity?.totalExerciseMinutes || null,
    hadWorkout: healthContext.activity?.hasWorkout || false,
    workoutType: healthContext.activity?.workouts?.[0]?.type || null
  };
};
```

**Environment Formatter** (`src/services/environment/environmentFormatter.js`):

```javascript
/**
 * Format environment context for AI consumption
 * Produces human-readable summary with weather and light conditions
 */
export const formatEnvironmentForAI = (environmentContext) => {
  if (!environmentContext) return null;

  const parts = [];

  // Weather condition
  if (environmentContext.weatherLabel) {
    parts.push(environmentContext.weatherLabel);
  }

  // Temperature
  if (environmentContext.temperature != null) {
    const unit = environmentContext.temperatureUnit || '°F';
    parts.push(`${Math.round(environmentContext.temperature)}${unit}`);
  }

  // Day summary (if available - more useful for patterns)
  if (environmentContext.daySummary) {
    const ds = environmentContext.daySummary;
    if (ds.sunshinePercent != null) {
      if (ds.sunshinePercent < 30) {
        parts.push('low sunshine');
      } else if (ds.sunshinePercent > 70) {
        parts.push('high sunshine');
      }
    }
  }

  // Light context
  if (environmentContext.lightContext === 'dark' || environmentContext.isAfterDark) {
    parts.push('after dark');
  } else if (environmentContext.lightContext === 'fading') {
    parts.push('fading light');
  } else if (environmentContext.lightContext === 'low_light') {
    parts.push('overcast/dim');
  }

  // Daylight remaining (if relevant)
  if (environmentContext.daylightRemaining != null &&
      environmentContext.daylightRemaining < 2 &&
      environmentContext.daylightRemaining > 0) {
    parts.push(`${environmentContext.daylightRemaining.toFixed(1)}h daylight left`);
  }

  return parts.length > 0 ? `[Environment: ${parts.join(', ')}]` : null;
};

/**
 * Format environment data for detailed analysis
 */
export const formatEnvironmentDetailed = (environmentContext) => {
  if (!environmentContext) return null;

  const sections = [];

  // Current conditions
  if (environmentContext.weatherLabel || environmentContext.temperature != null) {
    const temp = environmentContext.temperature != null
      ? `${Math.round(environmentContext.temperature)}${environmentContext.temperatureUnit || '°F'}`
      : '?';
    sections.push(`WEATHER: ${environmentContext.weatherLabel || 'unknown'}, ${temp}`);
  }

  // Day summary
  if (environmentContext.daySummary) {
    const ds = environmentContext.daySummary;
    sections.push(`DAY: High ${ds.tempHigh || '?'}°, Low ${ds.tempLow || '?'}°, ` +
                  `${ds.sunshinePercent || '?'}% sunshine (${ds.sunshineMinutes || '?'} min)`);
  }

  // Light conditions
  if (environmentContext.daylightHours || environmentContext.lightContext) {
    sections.push(`LIGHT: ${environmentContext.lightContext || 'unknown'}, ` +
                  `${environmentContext.daylightHours?.toFixed(1) || '?'}h total daylight` +
                  (environmentContext.daylightRemaining != null
                    ? `, ${environmentContext.daylightRemaining.toFixed(1)}h remaining`
                    : ''));
  }

  return sections.join('\n');
};

/**
 * Extract key environment signals for pattern detection
 */
export const extractEnvironmentSignals = (environmentContext) => {
  if (!environmentContext) return null;

  return {
    weather: environmentContext.weather || null,
    weatherLabel: environmentContext.weatherLabel || null,
    temperature: environmentContext.temperature || null,
    cloudCover: environmentContext.cloudCover || null,
    isDay: environmentContext.isDay ?? true,
    sunshinePercent: environmentContext.daySummary?.sunshinePercent || null,
    sunshineMinutes: environmentContext.daySummary?.sunshineMinutes || null,
    isLowSunshine: environmentContext.daySummary?.isLowSunshine || false,
    lightContext: environmentContext.lightContext || null,
    isAfterDark: environmentContext.isAfterDark || false,
    daylightHours: environmentContext.daylightHours || null,
    daylightRemaining: environmentContext.daylightRemaining || null
  };
};
```

---

### Phase 2: AI Chat Integration
**Goal**: Chat can discuss health AND environment data

**File**: `src/services/analysis/index.js`

**Change `askJournalAI` (lines 414-433)**:

```javascript
import { formatHealthForAI } from '../health/healthFormatter';
import { formatEnvironmentForAI } from '../environment/environmentFormatter';

export const askJournalAI = async (entries, question, questionEmbedding = null) => {
  const relevantEntries = await getSmartChatContext(entries, question, questionEmbedding);

  const context = relevantEntries.map(e => {
    const date = e.createdAt instanceof Date ? e.createdAt : e.createdAt?.toDate?.() || new Date();
    const tags = e.tags?.filter(t => t.startsWith('@')).join(', ') || '';
    // NEW: Include health AND environment context
    const healthInfo = formatHealthForAI(e.healthContext) || '';
    const envInfo = formatEnvironmentForAI(e.environmentContext) || '';
    const contextLine = [healthInfo, envInfo].filter(Boolean).join(' ');
    return `[${date.toLocaleDateString()}] ${contextLine}\n[${e.title}] ${tags ? `{${tags}} ` : ''}${e.text}`;
  }).join('\n\n');

  try {
    const result = await askJournalAIFn({
      question,
      entriesContext: context
    });
    return result.data.response;
  } catch (e) {
    console.error('askJournalAI error:', e);
    return null;
  }
};
```

**File**: `functions/index.js` (line ~1168)

**Update system prompt**:

```javascript
const systemPrompt = `You are a helpful journal assistant with access to the user's personal entries, health/biometric data, AND environmental context.

CONTEXT FROM JOURNAL ENTRIES:
${entriesContext || 'No entries available'}

INSTRUCTIONS:
- Answer based on the journal entries, health data, and environment data provided
- Reference specific dates when relevant
- Notice patterns across entries (recurring people, places, goals, situations)
- Tags starting with @ indicate: @person:name, @place:location, @goal:intention, @situation:ongoing_context

HEALTH DATA (in [Health: ...] brackets):
- Sleep: hours and quality/score
- HRV: heart rate variability in ms (higher = better recovery, lower = stress)
- RHR: resting heart rate
- Recovery/Strain: Whoop scores if connected
- Steps and workouts

ENVIRONMENT DATA (in [Environment: ...] brackets):
- Weather conditions (sunny, cloudy, rainy, etc.)
- Temperature
- Light context (daylight, after dark, low sunshine, fading light)
- Sunshine levels (low sunshine days can affect mood)

PATTERN RECOGNITION:
- Notice when health data correlates with mood or content
- Notice when weather/light correlates with mood or energy
- Example: "I notice you felt tired on days when your sleep score was below 60"
- Example: "Your mood seems higher on sunny days with good sleep"
- Example: "Low sunshine days appear to affect your energy levels"

- Use ### headers and * bullets for formatting
- Be warm and personal - this is someone's private journal`;
```

---

### Phase 3: Insight Generation Integration
**Goal**: Insights reference health AND environment patterns

**File**: `src/services/analysis/index.js`

**Change `generateInsight` (lines 201-236)**:

```javascript
import { formatHealthForAI } from '../health/healthFormatter';
import { formatEnvironmentForAI } from '../environment/environmentFormatter';

export const generateInsight = async (current, relevantHistory, recentHistory, allEntries = [], pendingPrompts = []) => {
  // ... existing setup code ...

  // Build history context WITH health AND environment data
  const historyContext = uniqueHistory.map(e => {
    const entryDate = e.createdAt instanceof Date ? e.createdAt : e.createdAt.toDate();
    const daysAgo = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
    const tags = e.tags?.filter(t => t.startsWith('@')).join(', ') || '';
    const moodInfo = e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined
      ? ` [mood: ${e.analysis.mood_score.toFixed(1)}]` : '';
    // NEW: Include health AND environment context
    const healthInfo = formatHealthForAI(e.healthContext) || '';
    const envInfo = formatEnvironmentForAI(e.environmentContext) || '';
    const contextLine = [healthInfo, envInfo].filter(Boolean).join(' ');
    return `[${entryDate.toLocaleDateString()} - ${daysAgo} days ago]${moodInfo} ${contextLine}\n${tags ? `{${tags}} ` : ''}${e.text}`;
  }).join('\n\n');

  // ... rest of function unchanged ...
};
```

---

### Phase 4: Day Summary Integration
**Goal**: Daily summaries mention health AND environment factors

**File**: `src/services/analysis/index.js`

**Change `generateDaySummary` (lines 340-408)**:

```javascript
import { formatHealthForAI, formatHealthDetailed } from '../health/healthFormatter';
import { formatEnvironmentForAI, formatEnvironmentDetailed } from '../environment/environmentFormatter';

export const generateDaySummary = async (dayEntries) => {
  if (!dayEntries || dayEntries.length === 0) return null;

  // Build context with health AND environment data
  const entriesContext = dayEntries.map(e => {
    const time = e.effectiveDate || e.createdAt;
    const d = time?.toDate?.() || new Date(time);
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const moodStr = e.analysis?.mood_score !== undefined
      ? ` [mood: ${(e.analysis.mood_score * 100).toFixed(0)}%]`
      : '';
    const themes = e.analysis?.themes?.join(', ') || '';
    // NEW: Include health AND environment context
    const healthInfo = formatHealthForAI(e.healthContext) || '';
    const envInfo = formatEnvironmentForAI(e.environmentContext) || '';
    const contextLine = [healthInfo, envInfo].filter(Boolean).join(' ');
    return `[${timeStr}]${moodStr} ${contextLine}\n${themes ? `{${themes}}` : ''}\n${e.text || e.contextualInsight?.briefSummary || 'Voice entry'}`;
  }).join('\n\n---\n\n');

  // Get aggregate context for the day
  const dayHealth = dayEntries.find(e => e.healthContext)?.healthContext;
  const dayEnv = dayEntries.find(e => e.environmentContext)?.environmentContext;
  const healthSummary = formatHealthDetailed(dayHealth);
  const envSummary = formatEnvironmentDetailed(dayEnv);

  // ... existing mood calculation ...

  try {
    const result = await askJournalAIFn({
      question: `Summarize this day's journal entries. What were the main themes? What contributed positively or negatively to the mood? Consider how the health/biometric data AND environmental conditions might relate to the emotional content.

${healthSummary ? `TODAY'S HEALTH DATA:\n${healthSummary}\n\n` : ''}${envSummary ? `TODAY'S ENVIRONMENT:\n${envSummary}\n\n` : ''}Average mood score: ${avgMood !== null ? (avgMood * 100).toFixed(0) + '%' : 'unknown'}

Entries:
${entriesContext}

Keep it concise (2-3 sentences). Write in plain conversational prose, no markdown.`,
      entriesContext: ''
    });
    // ... rest unchanged
  }
};
```

---

### Phase 5: Reflection Prompts Integration
**Goal**: Daily reflection prompts consider health AND environment state

**File**: `src/services/prompts/index.js` (or wherever reflection prompts are generated)

Add context-aware prompt generation:

```javascript
import { extractHealthSignals } from '../health/healthFormatter';
import { extractEnvironmentSignals } from '../environment/environmentFormatter';

/**
 * Generate context-aware reflection prompts based on health AND environment
 */
export const generateContextAwarePrompts = (healthContext, environmentContext, recentMood) => {
  const health = extractHealthSignals(healthContext);
  const env = extractEnvironmentSignals(environmentContext);

  const prompts = [];

  // === HEALTH-BASED PROMPTS ===

  // Sleep-based prompts
  if (health?.sleepHours && health.sleepHours < 6) {
    prompts.push({
      type: 'health_reflection',
      prompt: "You got less than 6 hours of sleep last night. How is that affecting your energy and mood today?",
      trigger: 'low_sleep'
    });
  }

  // HRV-based prompts
  if (health?.hrvTrend === 'declining' || health?.stressLevel === 'elevated') {
    prompts.push({
      type: 'health_reflection',
      prompt: "Your body is showing signs of elevated stress. What's weighing on your mind right now?",
      trigger: 'elevated_stress'
    });
  }

  // Recovery-based prompts (Whoop)
  if (health?.recoveryScore && health.recoveryScore < 34) {
    prompts.push({
      type: 'health_reflection',
      prompt: "Your recovery score is low today. What might you do to take it easy and recharge?",
      trigger: 'low_recovery'
    });
  }

  // Workout prompts
  if (health?.hadWorkout) {
    prompts.push({
      type: 'health_reflection',
      prompt: `How did your ${health.workoutType || 'workout'} make you feel today?`,
      trigger: 'post_workout'
    });
  }

  // High strain prompts
  if (health?.strainScore && health.strainScore > 15) {
    prompts.push({
      type: 'health_reflection',
      prompt: "You've had a high-strain day. What pushed you today, and how are you feeling about it?",
      trigger: 'high_strain'
    });
  }

  // === ENVIRONMENT-BASED PROMPTS ===

  // Low sunshine prompts (SAD-related)
  if (env?.isLowSunshine || (env?.sunshinePercent != null && env.sunshinePercent < 30)) {
    prompts.push({
      type: 'environment_reflection',
      prompt: "It's been a low-sunshine day. How is the lack of natural light affecting your mood?",
      trigger: 'low_sunshine'
    });
  }

  // After dark prompts
  if (env?.isAfterDark && env?.lightContext === 'dark') {
    prompts.push({
      type: 'environment_reflection',
      prompt: "You're journaling after dark. How was your day? Any thoughts as the day winds down?",
      trigger: 'after_dark'
    });
  }

  // Beautiful weather prompts
  if (env?.weatherLabel && /sunny|clear/i.test(env.weatherLabel) && env?.sunshinePercent > 70) {
    prompts.push({
      type: 'environment_reflection',
      prompt: "It's a beautiful sunny day! Did you get outside at all? How did that feel?",
      trigger: 'nice_weather'
    });
  }

  // Rainy day prompts
  if (env?.weatherLabel && /rain|storm/i.test(env.weatherLabel)) {
    prompts.push({
      type: 'environment_reflection',
      prompt: "It's a rainy day. Some find these cozy, others gloomy. How's the weather affecting you?",
      trigger: 'rainy_weather'
    });
  }

  // Fading light prompts
  if (env?.lightContext === 'fading' && env?.daylightRemaining != null && env.daylightRemaining < 1) {
    prompts.push({
      type: 'environment_reflection',
      prompt: "The sun is setting soon. Did you make the most of the daylight today?",
      trigger: 'fading_light'
    });
  }

  return prompts;
};
```

---

### Phase 6: Context-Mood Correlations
**Goal**: Detect patterns between health, environment, and mood

**New File**: `src/services/health/healthCorrelations.js`
**New File**: `src/services/environment/environmentCorrelations.js`

```javascript
// src/services/health/healthCorrelations.js

import { extractHealthSignals } from './healthFormatter';

/**
 * Compute correlations between health metrics and mood
 */
export const computeHealthMoodCorrelations = (entries) => {
  const dataPoints = entries
    .filter(e => e.analysis?.mood_score != null && e.healthContext)
    .map(e => ({
      mood: e.analysis.mood_score,
      ...extractHealthSignals(e.healthContext)
    }));

  if (dataPoints.length < 7) return null;

  const correlations = {};

  // Sleep-Mood correlation
  const sleepData = dataPoints.filter(d => d.sleepHours != null);
  if (sleepData.length >= 5) {
    const goodSleepMood = average(sleepData.filter(d => d.sleepHours >= 7).map(d => d.mood));
    const poorSleepMood = average(sleepData.filter(d => d.sleepHours < 6).map(d => d.mood));

    if (goodSleepMood - poorSleepMood > 0.15) {
      correlations.sleepMood = {
        insight: `Mood is ${Math.round((goodSleepMood - poorSleepMood) * 100)}% higher on days with 7+ hours of sleep`,
        strength: goodSleepMood - poorSleepMood > 0.25 ? 'strong' : 'moderate'
      };
    }
  }

  // HRV-Mood correlation
  const hrvData = dataPoints.filter(d => d.hrv != null);
  if (hrvData.length >= 5) {
    const medianHRV = median(hrvData.map(d => d.hrv));
    const highHRVMood = average(hrvData.filter(d => d.hrv >= medianHRV).map(d => d.mood));
    const lowHRVMood = average(hrvData.filter(d => d.hrv < medianHRV).map(d => d.mood));

    if (highHRVMood - lowHRVMood > 0.1) {
      correlations.hrvMood = {
        insight: `Higher HRV (better recovery) correlates with ${Math.round((highHRVMood - lowHRVMood) * 100)}% better mood`,
        strength: highHRVMood - lowHRVMood > 0.2 ? 'strong' : 'moderate'
      };
    }
  }

  // Exercise-Mood correlation
  const exerciseData = dataPoints.filter(d => d.hadWorkout != null);
  if (exerciseData.length >= 5) {
    const workoutMood = average(exerciseData.filter(d => d.hadWorkout).map(d => d.mood));
    const noWorkoutMood = average(exerciseData.filter(d => !d.hadWorkout).map(d => d.mood));

    if (workoutMood - noWorkoutMood > 0.1) {
      correlations.exerciseMood = {
        insight: `Mood averages ${Math.round((workoutMood - noWorkoutMood) * 100)}% higher on workout days`,
        strength: workoutMood - noWorkoutMood > 0.2 ? 'strong' : 'moderate'
      };
    }
  }

  // Recovery-Mood correlation (Whoop)
  const recoveryData = dataPoints.filter(d => d.recoveryScore != null);
  if (recoveryData.length >= 5) {
    const highRecoveryMood = average(recoveryData.filter(d => d.recoveryScore >= 67).map(d => d.mood));
    const lowRecoveryMood = average(recoveryData.filter(d => d.recoveryScore < 34).map(d => d.mood));

    if (highRecoveryMood - lowRecoveryMood > 0.15) {
      correlations.recoveryMood = {
        insight: `Green recovery days have ${Math.round((highRecoveryMood - lowRecoveryMood) * 100)}% higher mood than red days`,
        strength: 'strong'
      };
    }
  }

  return Object.keys(correlations).length > 0 ? correlations : null;
};
```

```javascript
// src/services/environment/environmentCorrelations.js

import { extractEnvironmentSignals } from './environmentFormatter';

/**
 * Compute correlations between environment and mood
 */
export const computeEnvironmentMoodCorrelations = (entries) => {
  const dataPoints = entries
    .filter(e => e.analysis?.mood_score != null && e.environmentContext)
    .map(e => ({
      mood: e.analysis.mood_score,
      ...extractEnvironmentSignals(e.environmentContext)
    }));

  if (dataPoints.length < 7) return null;

  const correlations = {};

  // Sunshine-Mood correlation
  const sunshineData = dataPoints.filter(d => d.sunshinePercent != null);
  if (sunshineData.length >= 5) {
    const highSunshineMood = average(sunshineData.filter(d => d.sunshinePercent >= 60).map(d => d.mood));
    const lowSunshineMood = average(sunshineData.filter(d => d.sunshinePercent < 30).map(d => d.mood));

    if (highSunshineMood - lowSunshineMood > 0.1) {
      correlations.sunshineMood = {
        insight: `Mood is ${Math.round((highSunshineMood - lowSunshineMood) * 100)}% higher on sunny days vs overcast days`,
        strength: highSunshineMood - lowSunshineMood > 0.2 ? 'strong' : 'moderate'
      };
    }
  }

  // Weather condition correlation
  const weatherData = dataPoints.filter(d => d.weather != null);
  if (weatherData.length >= 5) {
    const sunnyMood = average(weatherData.filter(d => /sunny|clear/i.test(d.weatherLabel || '')).map(d => d.mood));
    const cloudyMood = average(weatherData.filter(d => /cloud|overcast/i.test(d.weatherLabel || '')).map(d => d.mood));
    const rainyMood = average(weatherData.filter(d => /rain|storm/i.test(d.weatherLabel || '')).map(d => d.mood));

    if (sunnyMood - cloudyMood > 0.1 || sunnyMood - rainyMood > 0.15) {
      correlations.weatherMood = {
        insight: `Sunny days average ${Math.round(sunnyMood * 100)}% mood vs ${Math.round(cloudyMood * 100)}% on cloudy days`,
        strength: sunnyMood - cloudyMood > 0.2 ? 'strong' : 'moderate'
      };
    }
  }

  // Daylight hours correlation
  const daylightData = dataPoints.filter(d => d.daylightHours != null);
  if (daylightData.length >= 10) {
    const longDayMood = average(daylightData.filter(d => d.daylightHours >= 12).map(d => d.mood));
    const shortDayMood = average(daylightData.filter(d => d.daylightHours < 10).map(d => d.mood));

    if (longDayMood - shortDayMood > 0.1) {
      correlations.daylightMood = {
        insight: `Mood tends to be ${Math.round((longDayMood - shortDayMood) * 100)}% higher during longer daylight periods`,
        strength: longDayMood - shortDayMood > 0.2 ? 'strong' : 'moderate',
        note: 'Consider light therapy or outdoor time during shorter days'
      };
    }
  }

  // Time of day (light context) correlation
  const lightData = dataPoints.filter(d => d.lightContext != null);
  if (lightData.length >= 5) {
    const daylightMood = average(lightData.filter(d => d.lightContext === 'daylight').map(d => d.mood));
    const darkMood = average(lightData.filter(d => d.isAfterDark).map(d => d.mood));

    if (Math.abs(daylightMood - darkMood) > 0.1) {
      correlations.lightContextMood = {
        insight: daylightMood > darkMood
          ? `Entries made during daylight average ${Math.round((daylightMood - darkMood) * 100)}% higher mood`
          : `Evening entries tend to have ${Math.round((darkMood - daylightMood) * 100)}% higher mood (you may be a night person!)`,
        strength: Math.abs(daylightMood - darkMood) > 0.2 ? 'strong' : 'moderate'
      };
    }
  }

  return Object.keys(correlations).length > 0 ? correlations : null;
};
```

**Helper functions (shared)**:
```javascript
const average = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const median = (arr) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
```

---

### Phase 7: Nexus 2.0 Integration
**Goal**: Feed health data into the deep analysis engine

The Nexus 2.0 spec already defines how to use health data in Layers 1-4. Key integration points:

**Layer 1 (Pattern Detection)** - Already uses `healthContext`:
- `src/services/nexus/layer1/patternDetector.js` extracts biometric-narrative correlations
- Uses `extractHealthSignals()` from Phase 1

**Layer 2 (Temporal Reasoner)** - Personal baselines:
- `src/services/nexus/layer2/baselineManager.js` computes what's normal for THIS user
- "HRV 35ms" means nothing without knowing user's typical range

**Layer 3 (Causal Synthesizer)** - Deep insights:
- Cross-references narrative content with biometric signatures
- "Career waiting entries correlate with RHR +4bpm and HRV -8ms"

**Layer 4 (Intervention Optimizer)** - Recommendations:
- "Sterling walks → +12ms HRV recovery within 24h"
- "Prioritize walk tonight for optimal recovery"

---

## Files Summary

### New Files (5)
```
src/services/health/
├── healthFormatter.js         # Format health for AI (Phase 1)
└── healthCorrelations.js      # Health-mood correlations (Phase 6)

src/services/environment/
├── environmentFormatter.js    # Format environment for AI (Phase 1)
└── environmentCorrelations.js # Environment-mood correlations (Phase 6)

src/services/prompts/
└── contextPrompts.js          # Context-aware reflection prompts (Phase 5)
```

### Modified Files (4)
```
src/services/analysis/index.js    # askJournalAI, generateInsight, generateDaySummary
functions/index.js                # askJournalAI system prompt
src/services/prompts/index.js     # Add context-aware prompts
```

### Nexus 2.0 Files (already spec'd)
```
src/services/nexus/layer1/patternDetector.js   # Uses healthFormatter + environmentFormatter
src/services/nexus/layer2/baselineManager.js   # Personal health + environment baselines
src/services/nexus/layer3/synthesizer.js       # Causal insights (health + weather + mood)
src/services/nexus/layer4/interventionTracker.js # Context-based interventions
```

---

## Implementation Order

| Phase | What | Effort | Impact |
|-------|------|--------|--------|
| **1. Health Formatter** | Foundation for all else | Low | Critical |
| **2. AI Chat** | "How does sleep affect my mood?" works | Low | High |
| **3. Insight Generation** | Insights mention health | Low | High |
| **4. Day Summary** | Daily summaries include health | Low | Medium |
| **5. Reflection Prompts** | Health-aware journaling prompts | Medium | Medium |
| **6. Correlations** | Detect sleep-mood, HRV-mood patterns | Medium | High |
| **7. Nexus 2.0** | Deep causal analysis | High | Very High |

**Recommendation**: Ship Phases 1-4 immediately (all low effort, high impact). Then Phase 5-6. Then Nexus 2.0.

---

## Expected Outcomes

### After Phase 1-4 (Immediate)

**Entry context now looks like**:
```
[1/14/2026] [Health: Sleep: 5.2h (poor) score: 62/100 | HRV: 35ms (elevated stress)]
[Environment: Partly Cloudy, 52°F, low sunshine]
[Morning reflection] {@person:spencer} Had a rough night...
```

**User asks**: "How does my sleep affect my mood?"

**AI responds**:
> Looking at your entries, I see a clear pattern. On January 14th when you got 5.2 hours of poor sleep (score 62/100), you wrote about feeling "exhausted" and your mood was 45%. But on January 13th with 7.8 hours of good sleep (score 84/100), you described feeling "energized" with 78% mood. Your HRV also shows better recovery (52ms vs 35ms) on well-rested days.

**User asks**: "Do I feel better on sunny days?"

**AI responds**:
> Yes, there's a noticeable pattern. On sunny days with 70%+ sunshine, your mood averages around 72%. On overcast/low sunshine days, it drops to about 58%. You also tend to journal more about feeling "tired" or "blah" when there's been less natural light. Have you considered getting outside during lunch on cloudy days, or trying a light therapy lamp?

### After Phase 5-6 (Short-term)

**Health prompt**: "Your recovery score is low today (28%). What might you do to take it easy and recharge?"

**Environment prompt**: "It's been a low-sunshine day. How is the lack of natural light affecting your mood?"

**Correlation insights**:
- "Your mood averages 22% higher on workout days"
- "Mood is 18% higher on sunny days vs overcast days"
- "Entries made during daylight average 15% higher mood"

### After Phase 7 / Nexus 2.0 (Full)

**Example 1: Career-Pet Recovery Correlation**
> "Michael, I've noticed an interesting pattern. While you describe yourself as 'patient' regarding Anthropic, your Whoop data shows your RHR has trended 4bpm higher during these waiting periods—a sign of subconscious performance anxiety.
>
> However, on days you mention Sterling (specifically the 'grooming' and 'walking' entries), your HRV recovers by 12ms within 24 hours. Additionally, these recovery effects are strongest when combined with sunny weather—your Sterling walks on sunny days show 40% better mood recovery than on overcast days.
>
> **The Nexus**: Caring for Sterling is your most effective physical 'off-switch' for career-related tension, especially when you get outside in natural light.
>
> **Suggested action**: Today is partly cloudy with 2 hours of daylight remaining. Prioritize Sterling's long walk now to maximize both the HRV recovery and light exposure benefits."

---

**Example 2: The "Spencer Recovery" Correlation (Relational Biometrics)**

*Context*: In your journal, you mentioned staying at Spencer's was "great" but you woke up "groggy and gross".

> "Michael, I've identified what I'm calling the **Spencer Paradox** in your data.
>
> You consistently report higher relationship satisfaction and intimacy on nights spent at Spencer's (your entries show 85% positive sentiment when mentioning these stays). However, your Whoop data tells a different story:
>
> - **Sleep Consistency** drops by 22% on Spencer nights
> - **Deep Sleep** averages 30 minutes less than at home
> - **Next-day HRV** is 15% lower
> - **Recovery scores** average 58% vs 72% at home
>
> The 'groggy and gross' feeling isn't just in your head—it's a measurable physiological impact. This pattern suggests the environment change (different bed, room temperature, or late-night conversations) is affecting your sleep architecture.
>
> **The Nexus**: You're making a subconscious trade-off: emotional connection for physiological recovery. This isn't wrong—but it's worth being conscious of.
>
> **Suggested action**: On days after Spencer stays, your data shows you perform better with a later start. If possible, avoid scheduling demanding morning tasks. Consider bringing your own pillow, or having an earlier 'wind-down' time together."

---

**Example 3: Weather-Mood-Productivity Pattern**
> "I've noticed your 'work' category entries have very different mood patterns based on weather:
>
> - **Sunny days (70%+ sunshine)**: Work entries average 68% mood, you mention 'productive' 3x more often
> - **Overcast days (<30% sunshine)**: Work entries average 52% mood, 'struggling' appears 4x more often
>
> Interestingly, this pattern is stronger for you than your exercise-mood correlation (which only shows a 12% difference).
>
> **The Nexus**: Light exposure appears to be your primary mood lever—more than sleep or exercise.
>
> **Suggested action**: On forecast cloudy days, consider a 15-minute outdoor walk before deep work, or position yourself near a window. Your entries from days with morning light exposure show 15% better afternoon mood scores."
