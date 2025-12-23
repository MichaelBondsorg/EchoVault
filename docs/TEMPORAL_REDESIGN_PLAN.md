# Temporal Reasoning Redesign: Implementation Plan

## Executive Summary

Replace the current "effective date" model (which moves entries to different days) with a **signal extraction model** where entries stay on their recording day, and temporal facts/feelings are extracted as separate **signals** attributed to their actual target days.

---

## Core Concept

### Current Model (Problems)
```
Entry → effectiveDate → lives on ONE day
"I'm nervous about my interview tomorrow" → backdates to tomorrow? Or stays today?
```

### New Model (Solution)
```
Entry → recordedAt (immutable) → stays on recording day
       ↓
Signals extracted:
  - feeling: "nervous" → TODAY (when felt)
  - event: "interview" → TOMORROW (when happening)
```

---

## Phase 1: Data Model Changes

### 1.1 New Signal Schema

Create a new `signals` subcollection under each user:

```javascript
// Firestore: users/{userId}/signals/{signalId}
// This is the SINGLE SOURCE OF TRUTH for all signals (no redundant arrays on Entry)
signal = {
  id: string,                    // Auto-generated
  entryId: string,               // Reference to source entry (for wipe-and-replace on edit)
  userId: string,                // For querying
  extractionVersion: number,     // Matches entry.signalExtractionVersion (for race condition handling)

  // Temporal
  targetDate: Timestamp,         // The day this signal applies to
  recordedAt: Timestamp,         // When the entry was created (for audit)

  // Signal content (4 types with different scoring weights)
  type: 'feeling' | 'event' | 'plan' | 'reflection',
  // - feeling: Emotions felt NOW (high weight, defaults to TODAY)
  // - event: Things that happened (medium weight)
  // - plan: Future scheduled items (ZERO weight - neutral facts)
  // - reflection: General evaluations of past ("Yesterday was great") - high weight
  content: string,               // "Doctor appointment", "nervous", etc.
  sentiment: 'positive' | 'negative' | 'neutral' | 'anxious' | 'excited' | 'hopeful' | 'dreading',
  originalPhrase: string,        // The exact phrase from entry

  // Confidence & verification
  confidence: number,            // 0-1, from AI
  status: 'active' | 'verified' | 'dismissed',  // Soft-delete via status (for learning/undo)

  // For recurring events: each occurrence is a SEPARATE document
  // "Gym every Monday" → 4 distinct signal docs with different targetDates
  isRecurringInstance: boolean,  // True if generated from recurring pattern
  recurringPattern: string | null,  // "every_monday" (for grouping/display)
  occurrenceIndex: number | null,   // 1, 2, 3, 4... (for ordering)

  // Metadata
  createdAt: Timestamp,
  updatedAt: Timestamp
}

// Firestore: users/{userId}/day_summaries/{YYYY-MM-DD}
// Aggregated view for efficient heatmap/calendar queries (30 reads vs hundreds)
day_summary = {
  date: string,                  // "2024-01-15"
  signalCount: number,
  avgSentiment: number,          // -1 to 1 scale
  hasEvents: boolean,
  hasPlans: boolean,
  hasFeelings: boolean,
  entryCount: number,
  breakdown: {
    positive: number,
    negative: number,
    neutral: number
  },
  updatedAt: Timestamp
}
```

### 1.2 Entry Schema Changes

```javascript
// Modify entry schema
// NOTE: Signals are stored ONLY in the signals collection (single source of truth)
// NO pendingSignals array on Entry - query signals collection instead
entry = {
  // KEEP (unchanged)
  id: string,
  text: string,
  createdAt: Timestamp,          // When recorded
  analysis: { ... },             // AI analysis results (includes mood_score)
  tags: [...],
  entry_type: string,

  // DEPRECATE (but keep for backwards compat)
  effectiveDate: Timestamp,      // Keep for migration, treat as recordedAt for old entries
  temporalContext: { ... },      // Keep for reference, no longer drives behavior
  futureMentions: [...],         // Migrate to signals collection

  // NEW
  signalExtractionVersion: number,  // Increments on each edit (for race condition handling)
  // To get pending signals: query signals collection where entryId == this.id
}
```

### 1.3 Migration Strategy

```javascript
// Migration script (can be run incrementally)
async function migrateEntryToSignals(entry, userId) {
  if (entry.signalExtractionVersion >= 1) return; // Already migrated

  // Convert effectiveDate to a past-event signal if backdated
  if (entry.effectiveDate && entry.effectiveDate !== entry.createdAt) {
    await createSignal({
      entryId: entry.id,
      userId,
      targetDate: entry.effectiveDate,
      recordedAt: entry.createdAt,
      type: 'event',
      content: 'Entry content',  // Or extract from text
      sentiment: moodScoreToSentiment(entry.analysis?.mood_score),
      confidence: entry.temporalContext?.confidence || 0.7,
      confirmed: true,  // Treat existing data as confirmed
    });
  }

  // Convert futureMentions to signals
  for (const mention of entry.futureMentions || []) {
    await createSignal({
      entryId: entry.id,
      userId,
      targetDate: mention.targetDate,
      recordedAt: entry.createdAt,
      type: 'plan',
      content: mention.event,
      sentiment: mention.sentiment,
      confidence: mention.confidence,
      confirmed: true,
    });
  }

  // Mark as migrated
  await updateEntry(entry.id, { signalExtractionVersion: 1 });
}
```

---

## Phase 2: AI Extraction Changes

### 2.1 New Prompt Structure

Replace current `detectTemporalContext` with `extractSignals`:

```javascript
// src/services/temporal/signalExtractor.js

const EXTRACTION_PROMPT = `
Analyze this journal entry and extract temporal signals.
The user recorded this entry NOW on {currentDate} ({timeOfDay}).

ENTRY:
"{text}"

Extract ALL signals - these are facts, feelings, or plans tied to specific days.

Return JSON:
{
  "signals": [
    {
      "type": "feeling" | "event" | "plan",
      "content": "brief description",
      "target_day": "today" | "yesterday" | "tomorrow" | "two_days_ago" | "next_monday" | etc.,
      "sentiment": "positive" | "negative" | "neutral" | "anxious" | "excited" | "hopeful" | "dreading",
      "original_phrase": "exact quote from entry",
      "confidence": 0.0-1.0
    }
  ],
  "reasoning": "brief explanation"
}

RULES:
1. FEELINGS live on the day they are FELT (usually today)
   - "I'm nervous about tomorrow" → feeling:nervous on TODAY
   - "Yesterday I felt overwhelmed" → feeling:overwhelmed on YESTERDAY (explicitly stated)

2. EVENTS/FACTS live on the day they HAPPENED/HAPPEN
   - "Yesterday I went to the hairdresser" → event:hairdresser on YESTERDAY
   - "I have a doctor appointment tomorrow" → plan:doctor_appointment on TOMORROW

3. When ambiguous, FEELINGS default to TODAY, EVENTS default to TODAY
   - "It was a hard day" → feeling:hard_day on TODAY (unless clearly about past)

4. SUMMARY STATEMENTS about past days are EVENTS on that day
   - "Yesterday was great" → event:great_day on YESTERDAY (not a current feeling)

5. Extract MULTIPLE signals if the entry mentions multiple days
   - "Yesterday was rough but I'm excited about my interview tomorrow"
     → event:rough_day on YESTERDAY + feeling:excited on TODAY + plan:interview on TOMORROW

EXAMPLES:
Entry: "I'm so stressed about my presentation tomorrow"
→ feeling:stressed on TODAY, plan:presentation on TOMORROW

Entry: "Had a great workout yesterday, feeling energized"
→ event:great_workout on YESTERDAY, feeling:energized on TODAY

Entry: "Last week was exhausting. This week feels better already"
→ event:exhausting_week on LAST_WEEK, feeling:better on TODAY
`;
```

### 2.2 Signal Extractor Function

```javascript
// src/services/temporal/signalExtractor.js

export const extractSignals = async (text, currentDate = new Date()) => {
  // Quick pre-screen
  if (!hasTemporalIndicators(text) && !hasEmotionalContent(text)) {
    return {
      signals: [{
        type: 'feeling',
        content: 'journal entry',
        targetDay: 'today',
        targetDate: currentDate,
        sentiment: 'neutral',
        confidence: 0.5,
        originalPhrase: text.slice(0, 50),
      }],
      hasTemporalContent: false
    };
  }

  const prompt = buildPrompt(text, currentDate);
  const result = await callGemini(prompt);

  // Parse and validate
  const signals = result.signals.map(sig => ({
    ...sig,
    targetDate: calculateTargetDate(sig.target_day, currentDate),
  })).filter(sig => sig.targetDate !== null && sig.confidence >= 0.4);

  return {
    signals,
    hasTemporalContent: signals.some(s => s.target_day !== 'today'),
    reasoning: result.reasoning
  };
};
```

---

## Phase 3: Day Score Calculation

### 3.1 New Score Aggregation

Replace entry-based scoring with signal-based scoring:

```javascript
// src/services/scoring/dayScore.js

export const calculateDayScore = async (userId, targetDate) => {
  // 1. Get all signals for this day
  const signals = await getSignalsForDay(userId, targetDate);

  // 2. Get mood scores from entries recorded on this day (for baseline)
  const recordedEntries = await getEntriesRecordedOn(userId, targetDate);
  const entryMoodScores = recordedEntries
    .filter(e => e.entry_type !== 'task')
    .map(e => e.analysis?.mood_score)
    .filter(Boolean);

  // 3. Convert signals to score contributions
  const signalScores = signals
    .filter(s => !s.dismissed)
    .map(s => sentimentToScore(s.sentiment, s.type));

  // 4. Weighted average
  // Entry mood scores are primary (direct measurement)
  // Signals adjust the score (±0.1 per signal)
  const baseScore = entryMoodScores.length > 0
    ? average(entryMoodScores)
    : 0.5; // Neutral default

  const signalAdjustment = signalScores.reduce((sum, s) => sum + s, 0);
  const adjustedScore = clamp(baseScore + signalAdjustment, 0, 1);

  return {
    score: adjustedScore,
    baseScore,
    signalAdjustment,
    signalCount: signals.length,
    entryCount: recordedEntries.length,
  };
};

const sentimentToScore = (sentiment, type) => {
  const weights = {
    feeling: 0.15,  // Feelings have moderate impact
    event: 0.1,     // Events have less emotional weight
    plan: 0.05,     // Plans are future-oriented, less impact on past score
  };

  const sentimentValues = {
    positive: 1,
    excited: 0.8,
    hopeful: 0.6,
    neutral: 0,
    anxious: -0.3,
    negative: -0.5,
    dreading: -0.7,
  };

  return weights[type] * (sentimentValues[sentiment] || 0);
};
```

### 3.2 MoodHeatmap Update

```javascript
// src/components/entries/MoodHeatmap.jsx

const getDayData = async (d, entries, signals) => {
  // Get signals for this day
  const daySignals = signals.filter(s => isSameDay(s.targetDate, d));

  // Get entries RECORDED on this day (not effective date)
  const recordedEntries = entries.filter(e =>
    isSameDay(e.createdAt, d)
  );

  // Get entries that MENTION this day (via signals)
  const mentionedInEntries = signals
    .filter(s => isSameDay(s.targetDate, d))
    .map(s => s.entryId);

  // Calculate mood from entries + signal adjustments
  const { score } = calculateDayScore(recordedEntries, daySignals);

  return {
    avgMood: score,
    hasEntries: recordedEntries.length > 0,
    hasSignals: daySignals.length > 0,
    signalCount: daySignals.length,
    // ... rest of data
  };
};
```

---

## Phase 4: UX - The "Detected Strip"

### 4.1 Component Design

```jsx
// src/components/entries/DetectedStrip.jsx

const DetectedStrip = ({ signals, onConfirm, onDismiss, onEdit }) => {
  const groupedByDay = groupSignalsByTargetDay(signals);

  return (
    <motion.div className="detected-strip">
      <div className="strip-header">
        <Sparkles size={14} />
        <span>Detected in your entry</span>
      </div>

      {Object.entries(groupedByDay).map(([day, daySignals]) => (
        <div key={day} className="day-group">
          <span className="day-label">{formatDayLabel(day)}</span>

          {daySignals.map(signal => (
            <div key={signal.id} className="signal-chip">
              <span className="signal-icon">{getSignalIcon(signal.type)}</span>
              <span className="signal-content">{signal.content}</span>
              <span className="signal-sentiment">{getSentimentEmoji(signal.sentiment)}</span>

              <button onClick={() => onEdit(signal)} className="edit-btn">
                <Pencil size={12} />
              </button>
              <button onClick={() => onDismiss(signal.id)} className="dismiss-btn">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ))}

      <div className="strip-actions">
        <button onClick={onConfirm} className="confirm-all">
          Looks right
        </button>
      </div>
    </motion.div>
  );
};

// Example rendered output:
// ┌─────────────────────────────────────────────────┐
// │ ✨ Detected in your entry                       │
// │                                                 │
// │ Yesterday                                       │
// │   📅 Hairdresser  ✓ positive    [✏️] [✕]       │
// │                                                 │
// │ Tomorrow                                        │
// │   📋 Doctor appt  😰 anxious    [✏️] [✕]       │
// │                                                 │
// │ Today                                           │
// │   💭 Nervous      😰 anxious    [✏️] [✕]       │
// │                                                 │
// │                         [Looks right ✓]        │
// └─────────────────────────────────────────────────┘
```

### 4.2 Integration with Save Flow (Non-Blocking)

The key insight: **Save immediately, extract in parallel, auto-accept if ignored.**

```javascript
// In App.jsx - refactored to use processEntrySignals service

const saveEntry = async (textInput) => {
  const now = new Date();

  // 1. Save entry IMMEDIATELY (fast path - user sees success)
  const entry = await saveEntryToFirestore({
    text: textInput,
    createdAt: now,
    recordedAt: now,  // NEW: immutable recording date
    signalExtractionVersion: 1,
  });

  // Show immediate success feedback
  setEntrySaved(true);

  // 2. Extract signals IN PARALLEL (non-blocking)
  setExtractionStatus('analyzing');  // Shows "Analyzing timeline..." loader

  const { signals, hasTemporalContent } = await processEntrySignals(entry, textInput);

  // 3. If signals with temporal content, show Detected Strip (toast-style)
  if (signals.length > 0 && hasTemporalContent) {
    setDetectedSignals(signals);
    setShowDetectedStrip(true);  // Toast/banner pops in

    // Auto-accept high-confidence signals after 10 seconds if user ignores
    setTimeout(() => {
      if (showDetectedStrip) {
        autoAcceptHighConfidenceSignals(entry.id, signals);
      }
    }, 10000);
  } else {
    // Simple entry - auto-confirm immediately
    await confirmSignals(entry.id, signals);
  }

  setExtractionStatus('complete');
};

// Separate service function (keeps App.jsx clean)
// src/services/signals/processEntrySignals.js
export const processEntrySignals = async (entry, text, extractionVersion) => {
  const { signals, hasTemporalContent, reasoning } = await extractSignals(text);

  // Check if entry was edited while we were processing (race condition guard)
  const currentEntry = await getEntry(entry.id);
  if (currentEntry.signalExtractionVersion !== extractionVersion) {
    console.log('Entry was edited during extraction, discarding stale results');
    return { signals: [], hasTemporalContent: false, stale: true };
  }

  // Save signals to Firestore with extraction version
  await saveSignalsToFirestore(signals, entry.id, entry.userId, extractionVersion);

  // NOTE: day_summaries are updated by Cloud Function trigger (not here)
  // This ensures aggregation integrity even if client crashes

  return { signals, hasTemporalContent };
};

const autoAcceptHighConfidenceSignals = async (entryId, signals) => {
  const highConfidence = signals.filter(s => s.confidence >= 0.7);
  const lowConfidence = signals.filter(s => s.confidence < 0.7);

  // Auto-verify high confidence
  await batchUpdateSignalStatus(highConfidence, 'verified');

  // Keep low confidence as 'active' (visible on entry card for later review)
  setShowDetectedStrip(false);
};
```

### 4.3 Entry Edit Handling (Wipe and Replace)

When a user edits entry text, signals must stay synchronized:

```javascript
// src/services/signals/index.js

export const handleEntryEdit = async (entryId, newText, userId) => {
  // 1. Delete all existing signals for this entry
  await deleteSignalsForEntry(entryId, userId);

  // 2. Re-extract from new text
  const { signals, hasTemporalContent } = await extractSignals(newText);

  // 3. Save fresh signals
  await saveSignalsToFirestore(signals, entryId, userId);

  // 4. Update affected day_summaries
  await rebuildDaySummariesForEntry(entryId, userId);

  return { signals, hasTemporalContent };
};

// Called from App.jsx handleEntryUpdate
const handleEntryUpdate = async (entryId, newText, newTags) => {
  // Update entry text/tags
  await updateEntryInFirestore(entryId, { text: newText, tags: newTags });

  // Wipe and replace signals
  const { signals, hasTemporalContent } = await handleEntryEdit(entryId, newText, user.uid);

  // Optionally show DetectedStrip again if temporal content found
  if (hasTemporalContent) {
    setDetectedSignals(signals);
    setShowDetectedStrip(true);
  }
};
```

---

## Phase 5: Follow-up System

### 5.1 Morning Check-ins

```javascript
// src/services/followup/morningCheckin.js

export const getMorningCheckins = async (userId) => {
  const today = new Date();

  // Get signals with targetDate = today and type = 'plan'
  const todayPlans = await getSignalsForDay(userId, today, { type: 'plan' });

  // Get recurring signals for today's day of week
  const recurringToday = await getRecurringSignalsForDayOfWeek(userId, today.getDay());

  // Build check-in prompts
  return [...todayPlans, ...recurringToday].map(signal => ({
    signalId: signal.id,
    prompt: buildCheckinPrompt(signal),
    originalEntry: signal.entryId,
    sentiment: signal.sentiment,
  }));
};

const buildCheckinPrompt = (signal) => {
  const sentimentPrompts = {
    anxious: `How are you feeling about your ${signal.content} today?`,
    excited: `Today's the day for ${signal.content}! How's it going?`,
    dreading: `You mentioned ${signal.content} coming up. How are you holding up?`,
    neutral: `You have ${signal.content} today. How's it going?`,
  };

  return sentimentPrompts[signal.sentiment] || sentimentPrompts.neutral;
};
```

### 5.2 Evening Reflection

```javascript
// src/services/followup/eveningReflection.js

export const getEveningReflectionPrompts = async (userId) => {
  const today = new Date();

  // Get plans that were for today
  const todayPlans = await getSignalsForDay(userId, today, { type: 'plan' });

  // Find any that weren't followed up on
  const unfollowedPlans = todayPlans.filter(p => !p.followedUp);

  return unfollowedPlans.map(signal => ({
    signalId: signal.id,
    prompt: `How did ${signal.content} go?`,
    allowSkip: true,
  }));
};
```

---

## Phase 6: Dashboard Changes

### 6.1 Update useDashboardMode

```javascript
// The todayEntries filtering changes
const todayEntries = entries.filter(e =>
  isSameDay(e.recordedAt || e.createdAt, today)  // Use recordedAt, not effectiveDate
);

// But mood calculation uses signals
const { score: todayScore } = await calculateDayScore(userId, today);
```

### 6.2 JournalScreen Calendar Integration

Instead of building a separate "Life Timeline" view, integrate signals into the existing Calendar mode:

```javascript
// JournalScreen.jsx - Calendar view shows signals alongside entries

const JournalCalendarView = ({ entries, signals, selectedDate }) => {
  // Get entries RECORDED on selected date
  const recordedEntries = entries.filter(e =>
    isSameDay(e.recordedAt || e.createdAt, selectedDate)
  );

  // Get signals TARGETING this date (from any entry)
  const dateSignals = signals.filter(s =>
    isSameDay(s.targetDate, selectedDate) && s.status !== 'dismissed'
  );

  // Group signals by source: "mentioned in entries from other days"
  const externalSignals = dateSignals.filter(s =>
    !recordedEntries.some(e => e.id === s.entryId)
  );

  return (
    <div>
      {/* Today's actual entries */}
      {recordedEntries.map(entry => (
        <EntryCard key={entry.id} entry={entry} />
      ))}

      {/* Signals from other days that point to this day */}
      {externalSignals.length > 0 && (
        <div className="external-signals">
          <h4>Also mentioned for this day:</h4>
          {externalSignals.map(signal => (
            <SignalChip
              key={signal.id}
              signal={signal}
              showSource={true}  // "From entry on Dec 20th"
            />
          ))}
        </div>
      )}

      {/* Future plans for this day (if viewing future date) */}
      {isFuture(selectedDate) && dateSignals.filter(s => s.type === 'plan').length > 0 && (
        <div className="upcoming-plans">
          <h4>Planned for this day:</h4>
          {dateSignals.filter(s => s.type === 'plan').map(signal => (
            <PlanCard key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
};
```

### 6.3 MoodHeatmap with Day Summaries (Optimized Reads)

```javascript
// MoodHeatmap.jsx - uses day_summaries for efficient rendering

const MoodHeatmap = ({ userId }) => {
  const [daySummaries, setDaySummaries] = useState({});

  useEffect(() => {
    // Single query for 30 days of summaries (30 reads, not 30 * N signals)
    const loadSummaries = async () => {
      const last30Days = getLast30DayStrings();
      const summaries = await getDaySummaries(userId, last30Days);
      setDaySummaries(summaries);
    };
    loadSummaries();
  }, [userId]);

  const getDayData = (d) => {
    const dateStr = formatDateKey(d);  // "2024-01-15"
    const summary = daySummaries[dateStr];

    if (!summary) {
      return { avgMood: null, hasEntries: false, hasSignals: false };
    }

    return {
      avgMood: summary.avgSentiment,  // Pre-computed
      hasEntries: summary.entryCount > 0,
      hasSignals: summary.signalCount > 0,
      signalCount: summary.signalCount,
      breakdown: summary.breakdown,
    };
  };

  // ... rest of component
};
```

---

## Phase 7: Cloud Function & Infrastructure

### 7.1 Day Summary Aggregation (Cloud Function)

**Critical for data integrity.** Client-side aggregation is fragile - if the app crashes after saving signals but before updating summaries, the heatmap becomes permanently out of sync.

```javascript
// functions/src/signals.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

/**
 * Trigger: Fires whenever a signal is created, updated, or deleted
 * Action: Recalculates day_summary for the affected targetDate
 */
exports.onSignalChange = functions.firestore
  .document('users/{userId}/signals/{signalId}')
  .onWrite(async (change, context) => {
    const { userId } = context.params;

    // Get the targetDate from before/after (handle deletes)
    const beforeData = change.before.exists ? change.before.data() : null;
    const afterData = change.after.exists ? change.after.data() : null;

    const affectedDates = new Set();
    if (beforeData?.targetDate) {
      affectedDates.add(formatDateKey(beforeData.targetDate.toDate()));
    }
    if (afterData?.targetDate) {
      affectedDates.add(formatDateKey(afterData.targetDate.toDate()));
    }

    // Recalculate summary for each affected date
    for (const dateKey of affectedDates) {
      await recalculateDaySummary(userId, dateKey);
    }
  });

async function recalculateDaySummary(userId, dateKey) {
  const db = admin.firestore();

  // Query all active signals for this date
  const signalsSnap = await db
    .collection(`users/${userId}/signals`)
    .where('targetDate', '>=', startOfDay(dateKey))
    .where('targetDate', '<', endOfDay(dateKey))
    .where('status', '!=', 'dismissed')
    .get();

  const signals = signalsSnap.docs.map(d => d.data());

  // Calculate aggregates
  const summary = {
    date: dateKey,
    signalCount: signals.length,
    avgSentiment: calculateAvgSentiment(signals),
    hasEvents: signals.some(s => s.type === 'event'),
    hasPlans: signals.some(s => s.type === 'plan'),
    hasFeelings: signals.some(s => s.type === 'feeling'),
    breakdown: {
      positive: signals.filter(s => ['positive', 'excited'].includes(s.sentiment)).length,
      negative: signals.filter(s => ['negative', 'anxious', 'dreading'].includes(s.sentiment)).length,
      neutral: signals.filter(s => s.sentiment === 'neutral').length,
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  // Also count entries recorded on this date
  const entriesSnap = await db
    .collection(`users/${userId}/entries`)
    .where('recordedAt', '>=', startOfDay(dateKey))
    .where('recordedAt', '<', endOfDay(dateKey))
    .get();
  summary.entryCount = entriesSnap.size;

  // Write summary (upsert)
  await db.doc(`users/${userId}/day_summaries/${dateKey}`).set(summary, { merge: true });
}
```

### 7.2 Recurring Signal Generation

When the extractor detects a recurring pattern, generate **N discrete signal documents** instead of relying on frontend logic:

```javascript
// src/services/signals/recurringGenerator.js

const MAX_RECURRING_OCCURRENCES = 4;  // Generate up to 4 instances

export const generateRecurringSignals = (pattern, baseSignal, currentDate) => {
  const signals = [];
  const occurrenceDates = calculateOccurrences(pattern, currentDate, MAX_RECURRING_OCCURRENCES);

  occurrenceDates.forEach((targetDate, index) => {
    signals.push({
      ...baseSignal,
      targetDate,
      isRecurringInstance: true,
      recurringPattern: pattern,
      occurrenceIndex: index + 1,
      // Each gets its own ID - they're independent documents
    });
  });

  return signals;
};

// Example:
// User says: "I have gym every Monday"
// Current date: Monday Dec 23
// Result: 4 signal documents created:
//   { targetDate: Dec 30, content: "Gym", isRecurringInstance: true, occurrenceIndex: 1 }
//   { targetDate: Jan 6,  content: "Gym", isRecurringInstance: true, occurrenceIndex: 2 }
//   { targetDate: Jan 13, content: "Gym", isRecurringInstance: true, occurrenceIndex: 3 }
//   { targetDate: Jan 20, content: "Gym", isRecurringInstance: true, occurrenceIndex: 4 }

// Why this is better than a single "recurring" flag:
// - Query is simple: where('targetDate', '==', nextMonday)
// - No complex recurrence expansion logic on frontend
// - Each instance can be individually dismissed/verified
// - Display is straightforward: just show signals for the date
```

### 7.3 Race Condition Handling (Extraction Versioning)

When a user rapidly edits an entry, multiple extractions may run concurrently. The version check ensures only the latest extraction's signals are saved:

```javascript
// src/services/signals/index.js

export const saveSignalsWithVersionCheck = async (signals, entryId, userId, version) => {
  const db = getFirestore();
  const batch = writeBatch(db);

  // First, delete any existing signals for this entry with older versions
  const existingSnap = await getDocs(
    query(
      collection(db, `users/${userId}/signals`),
      where('entryId', '==', entryId),
      where('extractionVersion', '<', version)
    )
  );

  existingSnap.forEach(doc => {
    batch.delete(doc.ref);
  });

  // Then add new signals with current version
  for (const signal of signals) {
    const signalRef = doc(collection(db, `users/${userId}/signals`));
    batch.set(signalRef, {
      ...signal,
      id: signalRef.id,
      entryId,
      userId,
      extractionVersion: version,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
};

// Timeline of rapid edit scenario:
// T0: User saves V1 → extractionVersion: 1 → extraction starts
// T1: User edits to V2 → extractionVersion: 2 → extraction starts
// T2: V1 extraction finishes → tries to save with version 1
//     → Entry now has version 2 → DISCARD (stale)
// T3: V2 extraction finishes → saves with version 2 → SUCCESS
```

---

## Implementation Order

### Milestone 1: Foundation (No Breaking Changes) ✅ COMPLETE
1. [x] Add signals + day_summaries collection schema to Firestore rules
2. [x] Create signalExtractor.js with new AI prompt (4 types: feeling/event/plan/reflection)
3. [x] Create signals service (CRUD with version check, `in ['active', 'verified']` queries)
4. [x] Create recurringGenerator.js for multi-instance generation (4 occurrences)
5. [x] Add signalExtractionVersion to entry schema
6. [x] Deploy Cloud Function for day_summary aggregation (dynamic weighting: entry 60% + signal 40%)
7. [x] Add text diff check - only re-extract when text meaningfully changes
8. [x] Remove auto-accept - all signals require explicit user confirmation

### Milestone 2: Parallel System (Both systems run)
7. [ ] Modify saveEntry to extract and store signals (non-blocking)
8. [ ] Build DetectedStrip component (toast/banner style)
9. [ ] Integrate DetectedStrip into save flow
10. [ ] Add race condition handling (extraction versioning)
11. [ ] Keep effectiveDate working for backwards compat

### Milestone 3: Score Migration
12. [ ] Create dayScore service with signal-based calculation
13. [ ] Update MoodHeatmap to use day_summaries (efficient reads)
14. [ ] Update useDashboardMode

### Milestone 4: Follow-up System
15. [ ] Build morning check-in service
16. [ ] Build evening reflection prompts
17. [ ] Integrate check-ins into dashboard

### Milestone 5: Migration & Cleanup
18. [ ] Create migration script for existing entries
19. [ ] Run migration (can be incremental)
20. [ ] Deprecate effectiveDate in new entries
21. [ ] Remove confirmation modal (replaced by DetectedStrip)

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/services/temporal/index.js` | **DEPRECATE** - stop returning effectiveDate, keep for pattern matching only |
| `src/services/temporal/signalExtractor.js` | **NEW** - core extraction logic, returns Array<Signal> |
| `src/services/signals/index.js` | **NEW** - signal CRUD with version check, wipe-and-replace |
| `src/services/signals/processEntrySignals.js` | **NEW** - orchestrates extraction + save (no client-side aggregation) |
| `src/services/signals/recurringGenerator.js` | **NEW** - generates N discrete signal docs for recurring patterns |
| `src/services/scoring/dayScore.js` | **NEW** - signal-based day scoring (entry mood + signal adjustments) |
| `src/App.jsx` | Extract signal logic to service, remove temporal modal, add DetectedStrip |
| `src/components/entries/DetectedStrip.jsx` | **NEW** - toast/banner confirmation UI |
| `src/components/entries/SignalChip.jsx` | **NEW** - reusable signal display chip |
| `src/components/entries/MoodHeatmap.jsx` | Use day_summaries for efficient reads |
| `src/components/screens/JournalScreen.jsx` | Calendar view shows signals for selected date |
| `src/hooks/useDashboardMode.js` | Use recordedAt, signal-based mood |
| `firestore.rules` | Add signals + day_summaries collection rules |
| `functions/src/signals.js` | **NEW** - Cloud Function for day_summary aggregation (**required**) |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| AI extraction is less accurate than single-date detection | Detected Strip lets users correct; auto-accept high confidence; default to today when uncertain |
| Migration breaks existing data | Keep effectiveDate for old entries, gradual migration, backwards compat |
| Performance (more Firestore reads) | **day_summaries** collection - 30 reads for heatmap, not hundreds |
| Complex entries with many signals | Limit to 5 signals per entry, merge similar ones |
| User closes app before confirming signals | Auto-accept high-confidence after 10s timeout; show unconfirmed on EntryCard |
| Entry edits desync signals | Wipe-and-replace strategy - delete old signals, re-extract fresh |
| Extraction latency blocks save | Save entry first (immediate feedback), extract in parallel (non-blocking) |

---

## Success Metrics

1. **Reduction in temporal-related bugs** - No more "can't save entry" issues
2. **Multi-day entries work correctly** - "Yesterday was X, tomorrow is Y" creates signals on both days
3. **Future anxieties tracked properly** - "Nervous about tomorrow" → check-in appears tomorrow
4. **Day scores more accurate** - Retroactive mentions improve past day scores
5. **User transparency** - Detected Strip shows exactly what was understood
6. **Mobile reliability** - No hidden modals blocking saves

---

## Resolved Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Signal persistence | **Soft-delete** with `status: 'dismissed'` | Training data for AI improvement; enables undo; query with `where('status', 'in', ['active', 'verified'])` |
| Life timeline view | **Integrate into JournalScreen Calendar** | No separate view; clicking a day shows entries + signals for that day |
| Detected Strip timing | **Immediate toast/banner** after save | Closes cognitive loop ("system heard me"); fallback on EntryCard if missed |
| Recurring horizon | **4 occurrences** for recurring patterns | Prevents infinite generation for "every Monday"; generate N discrete signal docs |
| Entry mood vs signals | **Keep both** | Entry `mood_score` = how user felt when speaking; signal `sentiment` = emotional context of the fact. They measure different things. |
| Entry edit handling | **Wipe and replace with diff check** | Only re-extract if text meaningfully changed (>2 words different). Prevents losing confirmations on typo fixes. |
| Signal storage | **Single source of truth** in signals collection | No `pendingSignals` array on Entry; query signals by entryId. Eliminates sync issues. |
| Aggregation | **Cloud Function trigger** on signal write | Guarantees day_summary integrity even if client crashes. Not optional. |
| Recurring storage | **N discrete signal documents** | Generate 4 separate docs for "gym every Monday". Simplifies querying, each dismissable independently. |
| Race conditions | **Extraction versioning** | Signal.extractionVersion must match entry.signalExtractionVersion. Stale results discarded. |
| Auto-acceptance | **REMOVED - All signals require explicit confirmation** | Voice transcription can produce confident-but-wrong extractions. Auto-accept creates "ghost facts" users don't remember approving. |
| Day scoring | **Dynamic weighting** | Entry 60% + Signal 40% when entries exist; Signal 100% when only forward-referenced signals. Plans always weight 0. |
| Firestore queries | **Use `in` instead of `!=`** | `where('status', 'in', ['active', 'verified'])` is Firestore-friendly with range queries. |

---

## Firestore Rules Addition

```javascript
// firestore.rules
match /users/{userId}/signals/{signalId} {
  allow read, write: if request.auth.uid == userId;
}

match /users/{userId}/day_summaries/{dateId} {
  allow read: if request.auth.uid == userId;
  allow write: if request.auth.uid == userId || request.auth.token.admin == true;  // Allow Cloud Function writes
}
```

---

## The "Prism" Distinction (Entry Mood vs Signal Sentiment)

This is a key architectural insight worth highlighting:

| Concept | Measures | Example |
|---------|----------|---------|
| **Entry mood_score** | "How I felt when speaking" (recording context) | "I'm so relieved the project is over!" → High positive mood |
| **Signal sentiment** | "How I feel about this fact" (life context) | Signal: "Project was stressful" → Negative sentiment |

**Why both matter:**
- You might be *happy* (entry mood) that you finally quit a *toxic job* (negative event signal)
- Averaging them = "neutral" which is **wrong**
- Keeping both lets the system say: "You often sound relieved when discussing difficult life changes"

```javascript
// Dynamic day scoring (implemented in functions/index.js)
async function recalculateDaySummary(userId, dateKey) {
  const signals = await getSignalsForDate(userId, dateKey);
  const entries = await getEntriesRecordedOn(userId, dateKey);

  // Scoring signals exclude plans (weight 0)
  const scoringSignals = signals.filter(s => s.type !== 'plan');
  const signalSentiment = calculateAvgSentiment(scoringSignals);  // 0-1 scale
  const entryMood = calculateAvgEntryMood(entries);  // 0-1 scale

  // Dynamic weighting
  let dayScore;
  if (entryMood !== null && signalSentiment !== null) {
    dayScore = (entryMood * 0.6) + (signalSentiment * 0.4);  // Blended
  } else if (entryMood !== null) {
    dayScore = entryMood;  // Entries only
  } else if (signalSentiment !== null) {
    dayScore = signalSentiment;  // Forward-referenced day (signals only)
  }

  // Save summary with both raw scores and combined dayScore
  await saveDaySummary(userId, dateKey, {
    signalSentiment, entryMood, dayScore, scoreSource: ...
  });
}
```

---

## Critical Refinement: Separating Feelings from Plans

A key insight that emerged during implementation:

**"I'm excited about tomorrow" produces TWO signals:**
1. `feeling:excited` → TODAY (the emotion is felt NOW)
2. `plan:event` → TOMORROW (the fact is scheduled THEN)

This is critical because:
- If we only create a plan signal on tomorrow, today's emotional state is lost
- The user's excitement TODAY matters for today's score
- Tomorrow shouldn't get a positive score bump just from having a scheduled event

**Extraction Prompt Rules:**
```
CRITICAL: When emotions are expressed ABOUT future events, create TWO signals:
- One feeling signal for TODAY (when the emotion is felt)
- One plan signal for the TARGET day (when the event happens)

Example: "I'm nervous about my interview tomorrow"
→ feeling:nervous → TODAY (the nervousness is felt now)
→ plan:interview → TOMORROW (the event happens then)

The plan signal gets NEUTRAL sentiment and ZERO weight in scoring.
Plans are facts, not feelings.
```

**Why Plans Have Weight 0:**
- Plans are neutral facts about scheduled items
- Their emotional impact is captured by the *current* feeling signal
- This prevents "filling in" future days with assumed emotions
