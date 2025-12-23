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
signal = {
  id: string,                    // Auto-generated
  entryId: string,               // Reference to source entry
  userId: string,                // For querying

  // Temporal
  targetDate: Timestamp,         // The day this signal applies to
  recordedAt: Timestamp,         // When the entry was created (for audit)

  // Signal content
  type: 'event' | 'feeling' | 'plan',
  content: string,               // "Doctor appointment", "nervous", etc.
  sentiment: 'positive' | 'negative' | 'neutral' | 'anxious' | 'excited',
  originalPhrase: string,        // The exact phrase from entry

  // Confidence & verification
  confidence: number,            // 0-1, from AI
  confirmed: boolean,            // User verified via Detected strip
  dismissed: boolean,            // User dismissed this signal

  // For recurring
  isRecurring: boolean,
  recurringPattern: string | null,  // "every_monday", etc.

  // Metadata
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### 1.2 Entry Schema Changes

```javascript
// Modify entry schema
entry = {
  // KEEP (unchanged)
  id: string,
  text: string,
  createdAt: Timestamp,          // When recorded
  analysis: { ... },             // AI analysis results
  tags: [...],
  entry_type: string,

  // DEPRECATE (but keep for backwards compat)
  effectiveDate: Timestamp,      // Keep for migration, treat as recordedAt for old entries
  temporalContext: { ... },      // Keep for reference, no longer drives behavior
  futureMentions: [...],         // Migrate to signals collection

  // NEW
  signalExtractionVersion: number,  // Track if signals were extracted (v1 = new system)
  pendingSignals: [...],           // Signals awaiting user confirmation (for Detected strip)
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

### 4.2 Integration with Save Flow

```javascript
// In App.jsx saveEntry flow

const saveEntry = async (textInput) => {
  // 1. Extract signals
  const { signals, hasTemporalContent } = await extractSignals(textInput);

  // 2. Save entry with recording timestamp (always today)
  const entry = await saveEntryToFirestore({
    text: textInput,
    createdAt: now,
    recordedAt: now,  // NEW: immutable recording date
    // NO effectiveDate manipulation
    pendingSignals: signals,  // Awaiting confirmation
    signalExtractionVersion: 1,
  });

  // 3. If signals detected, show Detected Strip
  if (signals.length > 0 && hasTemporalContent) {
    setPendingSignals(signals);
    setShowDetectedStrip(true);
  } else {
    // Auto-confirm simple entries
    await confirmSignals(entry.id, signals);
  }
};

const handleConfirmSignals = async () => {
  await confirmSignals(currentEntryId, pendingSignals);
  setShowDetectedStrip(false);
  setPendingSignals([]);
};

const handleDismissSignal = async (signalId) => {
  setPendingSignals(prev => prev.map(s =>
    s.id === signalId ? { ...s, dismissed: true } : s
  ));
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

### 6.2 Timeline View Updates

```javascript
// JournalScreen.jsx - show both timelines

// Recording timeline (what was written when)
const recordingTimeline = entries.sort((a, b) =>
  b.recordedAt - a.recordedAt
);

// Life timeline (what happened when) - optional view
const lifeTimeline = await buildLifeTimeline(signals);
// Groups by targetDate, shows events/feelings per day
```

---

## Implementation Order

### Milestone 1: Foundation (No Breaking Changes)
1. [ ] Add signals collection schema to Firestore rules
2. [ ] Create signalExtractor.js with new AI prompt
3. [ ] Create signals service (CRUD operations)
4. [ ] Add signalExtractionVersion to entry schema

### Milestone 2: Parallel System (Both systems run)
5. [ ] Modify saveEntry to also extract and store signals
6. [ ] Build DetectedStrip component
7. [ ] Integrate DetectedStrip into save flow
8. [ ] Keep effectiveDate working for backwards compat

### Milestone 3: Score Migration
9. [ ] Create dayScore service with signal-based calculation
10. [ ] Update MoodHeatmap to use new scoring
11. [ ] Update useDashboardMode

### Milestone 4: Follow-up System
12. [ ] Build morning check-in service
13. [ ] Build evening reflection prompts
14. [ ] Integrate check-ins into dashboard

### Milestone 5: Migration & Cleanup
15. [ ] Create migration script for existing entries
16. [ ] Run migration (can be incremental)
17. [ ] Deprecate effectiveDate in new entries
18. [ ] Remove confirmation modal (replaced by DetectedStrip)

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/services/temporal/index.js` | Keep for backwards compat, add signalExtractor.js |
| `src/services/temporal/signalExtractor.js` | NEW - core extraction logic |
| `src/services/signals/index.js` | NEW - signal CRUD operations |
| `src/services/scoring/dayScore.js` | NEW - signal-based day scoring |
| `src/App.jsx` | Modify saveEntry flow, remove temporal modal |
| `src/components/entries/DetectedStrip.jsx` | NEW - confirmation UI |
| `src/components/entries/MoodHeatmap.jsx` | Use new scoring |
| `src/hooks/useDashboardMode.js` | Use recordedAt, signal-based mood |
| `firestore.rules` | Add signals collection rules |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| AI extraction is less accurate than single-date detection | Detected Strip lets users correct; default to today when uncertain |
| Migration breaks existing data | Keep effectiveDate for old entries, gradual migration |
| Performance (more Firestore reads) | Use composite indexes, cache signals per day |
| Complex entries with many signals | Limit to 5 signals per entry, merge similar ones |
| User confusion about two timelines | Default to recording timeline, life timeline is optional |

---

## Success Metrics

1. **Reduction in temporal-related bugs** - No more "can't save entry" issues
2. **Multi-day entries work correctly** - "Yesterday was X, tomorrow is Y" creates signals on both days
3. **Future anxieties tracked properly** - "Nervous about tomorrow" → check-in appears tomorrow
4. **Day scores more accurate** - Retroactive mentions improve past day scores
5. **User transparency** - Detected Strip shows exactly what was understood

---

## Open Questions for Review

1. **Signal persistence**: Should dismissed signals be soft-deleted or hard-deleted?
2. **Edit history**: When user edits a signal, store original or replace?
3. **Recurring limits**: Currently 7-day horizon - increase?
4. **Life timeline view**: Build as separate screen or inline in journal?
5. **Signal types**: Is feeling/event/plan sufficient or need more granularity?
