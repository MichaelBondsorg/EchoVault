# EchoVault Entry Processing Pipeline

**Audience**: Product Managers, Technical Leads, New Engineers
**Purpose**: Understand what happens from the moment a user hits "Save" until their entry is fully processed
**Last Updated**: January 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Meet Our Example Entry](#meet-our-example-entry)
3. [The User's Perspective](#the-users-perspective)
4. [Phase 1: Entry Capture](#phase-1-entry-capture)
5. [Phase 2: Context Enrichment](#phase-2-context-enrichment)
6. [Phase 3: Safety Screening](#phase-3-safety-screening)
7. [Phase 4: Local Analysis](#phase-4-local-analysis)
8. [Phase 5: Persistence](#phase-5-persistence)
9. [Phase 6: Server-Side Processing](#phase-6-server-side-processing)
10. [Phase 7: Signal Extraction](#phase-7-signal-extraction)
11. [The Complete Picture: Our Example Entry Fully Processed](#the-complete-picture-our-example-entry-fully-processed)
12. [Complete Data Flow Diagram](#complete-data-flow-diagram)
13. [Timing & Performance](#timing--performance)
14. [Error Handling & Degradation](#error-handling--degradation)
15. [Product Decisions Embedded in the Pipeline](#product-decisions-embedded-in-the-pipeline)

---

## Overview

When a user submits a journal entry in EchoVault, a sophisticated multi-phase pipeline transforms their raw thoughts into enriched, analyzed, and actionable data. This pipeline is designed around three core principles:

1. **Responsiveness**: The user should never wait. The UI returns control immediately.
2. **Resilience**: If any enrichment fails, the entry still saves. Nothing blocks the core journaling experience.
3. **Privacy-First**: Sensitive data (location, health) is captured with user permission and processed with minimal precision where possible.

The pipeline has two distinct execution contexts:
- **Client-side** (runs on the user's device): Context capture, safety checks, local analysis
- **Server-side** (runs in Firebase Cloud Functions): Deep AI analysis, embedding generation, signal extraction

---

## Meet Our Example Entry

To make this document concrete, we'll follow a single journal entry through every phase of processing. This is a real-world example that exercises most of the pipeline's capabilities.

### The Entry

**Date**: December 3rd, 2025, 10:23 PM
**Platform**: iOS
**User**: Has Whoop connected, location permissions granted
**Location**: Austin, Texas

**Entry Text**:
> "Okay, Sunny's snoring next to me and Mocha's decided my head is a good place to nap. It's late and I should be sleeping but my mind won't stop racing. David and Carol invited us to Game Night this Saturday and part of me wants to go—I haven't seen them in weeks—but another part of me is dreading it. What if I'm too tired? What if I say something awkward? I've been feeling so disconnected lately. Maybe I should just stay home with my furry weirdos. At least they don't judge me for being quiet."

This entry is interesting because it contains:
- **Entities**: Sunny (pet), Mocha (pet), David (person), Carol (person)
- **Future event**: Game Night on Saturday
- **Mixed emotions**: Wanting connection but fearing social interaction
- **Potential therapeutic relevance**: Social anxiety, avoidance patterns
- **Health context**: Late night, poor sleep indicated by racing thoughts

Let's see what happens when this user taps "Save."

---

## The User's Perspective

From the user's point of view, the experience is simple:

1. They write their late-night thoughts about the pets and Game Night
2. They tap "Save"
3. The entry appears in their journal immediately
4. Within seconds, the entry updates with a title like *"Wrestling with Social Anxiety"*
5. Therapeutic insights appear acknowledging their ambivalence about Game Night

What they don't see is the orchestrated dance of seven processing phases happening in parallel and sequence behind that simple interaction.

---

## Phase 1: Entry Capture

### What Happens

The journey begins when the user provides content through one of two input modes:

**Text Entry** (Our example)
- User types directly into the journal input field
- Text is captured as-is with no preprocessing
- Our user typed 84 words about Sunny, Mocha, and Game Night

**Voice Entry**
- User speaks into the microphone
- Audio streams to the Voice Relay Server (Cloud Run)
- OpenAI Whisper transcribes speech to text in real-time
- User sees transcript building as they speak
- When they finish, the relay server also runs **Voice Tone Analysis**

### Voice Tone Analysis (Voice Entries Only)

If our user had *spoken* this entry instead of typing it, we would have captured additional emotional signals from their voice—not just what was said, but *how* it was said.

**How it works:**
```
Raw audio (PCM 24kHz) → Convert to WAV → Send to Gemini with multimodal prompt
```

**What we analyze:**
- Voice characteristics: tone, pace, pitch variations, pauses
- Energy level: low, medium, or high
- Detected emotions: anxious, hopeful, tired, excited, etc.
- Confidence score: how certain the AI is about its analysis

**Product Decision**: We only use voice tone to influence the entry's mood score if confidence is ≥60%. Below that threshold, we rely solely on text analysis. This prevents unreliable audio (background noise, short recordings) from skewing the emotional assessment.

**Example output (if our entry were voice):**
```javascript
voiceTone: {
  moodScore: 0.38,
  energy: 'low',
  emotions: ['tired', 'anxious', 'conflicted'],
  confidence: 0.74,
  summary: "User sounds tired and uncertain, with hints of anxiety when discussing the social event"
}
```

### Key Technical Details

| Aspect | Implementation |
|--------|----------------|
| Voice relay | WebSocket connection to Cloud Run service |
| Transcription model | OpenAI Whisper-1 |
| Voice analysis model | Gemini (multimodal) |
| Minimum audio for analysis | 1 second (48,000 bytes at 24kHz 16-bit mono) |

---

## Phase 2: Context Enrichment

Once we have the entry text, we enrich it with contextual data from multiple sources. This happens **in parallel** to maximize speed.

### 2.1 Health Context

**Source**: Apple HealthKit, Google Fit, Whoop API
**Code**: `src/services/health/healthDataService.js`

Our user has Whoop connected, so we capture their physiological state at the moment of journaling.

**What we capture for our example:**

| Category | Our User's Data | Why It Matters |
|----------|-----------------|----------------|
| **Sleep** | 5.2 hours last night, "poor" quality, 12% deep sleep | Explains why they're up late with racing thoughts |
| **Heart** | HRV: 42ms, RHR: 68 bpm | HRV of 42 indicates moderate stress |
| **Recovery** | Score: 34% (Red zone) | Body is in depleted state—social event may feel more taxing |
| **Activity** | 4,800 steps, 30 min yoga | Some activity but not enough to offset poor recovery |

**Stress Indicator Calculation:**
```javascript
if (hrv >= 50) return 'low';       // Good recovery
if (hrv >= 30) return 'moderate';  // Our user: HRV 42 → moderate
return 'high';                      // Elevated stress
```

For our user with HRV of 42, `stressIndicator: 'moderate'`.

**What gets stored:**
```javascript
healthContext: {
  sleep: {
    sleepLastNight: 5.2,
    sleepScore: 58,
    sleepQuality: 'poor',
    sleepStages: { deep: 38, rem: 62, light: 195, awake: 17 }  // minutes
  },
  heart: {
    restingRate: 68,
    hrv: 42,
    stressIndicator: 'moderate'
  },
  recovery: {
    score: 34,
    status: 'red'
  },
  strain: {
    score: 8.2
  },
  activity: {
    stepsToday: 4800,
    totalExerciseMinutes: 30,
    hasWorkout: true,
    workouts: [{ type: 'yoga', duration: 30, source: 'whoop' }]
  },
  queriedAt: "2025-12-03T22:23:00Z"
}
```

**Product Decision**: Health context is entirely optional. If the user hadn't connected Whoop, or if the API call failed, the entry would save normally. We never block journaling for health data.

**Data Source Priority**: When multiple sources are connected (e.g., both Whoop and HealthKit), we merge intelligently:
- Sleep scores → Whoop preferred (more sophisticated algorithm)
- Steps → HealthKit preferred (Whoop doesn't track steps natively)
- Workouts → Merged from all sources

### 2.2 Environment Context

**Source**: Device GPS + Open-Meteo API
**Code**: `src/services/environment/environmentService.js`

Our user is in Austin, Texas at 10:23 PM. We capture weather and light conditions.

**What we capture for our example:**

| Data Point | Our User's Data | Purpose |
|------------|-----------------|---------|
| Location | 30.27, -97.74 (rounded) | Used for weather lookup |
| Current weather | Clear | Condition at moment of entry |
| Temperature | 52°F | Cooler December evening |
| Day summary | High 68°F, Low 48°F, 82% sunshine | The day was pleasant |
| Light context | 'dark' | Well after sunset (5:32 PM) |
| Sun times | Sunrise 7:12 AM, Sunset 5:32 PM | 10.3 hours daylight |

**Privacy Protection**: Location coordinates are rounded to 2 decimal places before storage, giving approximately 1.1km precision. This is sufficient for weather lookup but doesn't reveal the user's exact address.

```javascript
latitude: Math.round(30.2672 * 100) / 100   // 30.27
longitude: Math.round(-97.7431 * 100) / 100  // -97.74
```

**What gets stored:**
```javascript
environmentContext: {
  location: {
    latitude: 30.27,
    longitude: -97.74,
    cached: false
  },
  weather: 'clear',
  weatherLabel: 'Clear sky',
  temperature: 52,
  temperatureUnit: '°F',
  cloudCover: 8,
  isDay: false,
  daySummary: {
    condition: 'partly_cloudy',
    conditionLabel: 'Partly cloudy',
    tempHigh: 68,
    tempLow: 48,
    sunshineMinutes: 507,
    sunshinePercent: 82,
    isLowSunshine: false
  },
  sunsetTime: "17:32",
  sunriseTime: "07:12",
  daylightHours: 10.3,
  isAfterDark: true,
  lightContext: 'dark',
  daylightRemaining: null,  // Already dark
  capturedAt: "2025-12-03T22:23:00Z"
}
```

**Product Decision**: We capture both point-in-time weather (conditions right now) AND day summary weather (the whole day's conditions). For our user journaling at 10pm, knowing the day was 82% sunny matters more than knowing it's currently dark.

**Important**: There is no "location type" field (home, work, etc.) in the environment context. Location is raw coordinates only. Semantic place types exist only in the Entity system for places the user mentions in entries.

### 2.3 Temporal Context Detection

**Source**: Entry text analysis
**Code**: `src/services/temporal/index.js`

We scan the entry text for references to other days. Our user mentioned "this Saturday."

**How it works:**

First, a quick regex pre-screen checks for temporal indicators:
```javascript
const TEMPORAL_PATTERNS = [
  /\byesterday\b/i,
  /\btomorrow\b/i,
  /\bthis saturday\b/i,     // ← Matches our entry!
  /\bdreading\b/i,          // ← Also matches!
  // ... 40+ patterns
];
```

Our entry matches "this Saturday" and "dreading," so we proceed to AI extraction.

**What we detect for our example:**

No past references are found, so `effectiveDate` stays as `createdAt` (December 3rd).

But we DO find a future mention:

```javascript
futureMentions: [{
  targetDate: "2025-12-06T19:00:00Z",  // Saturday
  event: "Game Night with David and Carol",
  sentiment: "anxious",
  phrase: "David and Carol invited us to Game Night this Saturday",
  confidence: 0.87,
  isRecurring: false,
  recurringPattern: null
}]
```

**Product Decision**: Future mentions are tracked to enable proactive prompts. On Sunday, December 7th, we can ask: "You mentioned being anxious about Game Night with David and Carol. How did it go?" This creates a sense that EchoVault remembers and cares.

---

## Phase 3: Safety Screening

**Source**: Regex pattern matching
**Code**: `src/config/constants.js`

Before saving, every entry passes through safety screening. This is a critical mental health safeguard.

### Two-Tier Detection

**Tier 1: Crisis Keywords** (Immediate intervention)
```javascript
const CRISIS_KEYWORDS = /suicide|kill myself|hurt myself|end my life|want to die|better off dead|no reason to live|end it all|don't want to wake up|better off without me/i;
```

**Tier 2: Warning Indicators** (Softer check-in)
```javascript
const WARNING_INDICATORS = /hopeless|worthless|no point|can't go on|trapped|burden|no way out|give up|falling apart/i;
```

### Our Example Entry

Our user's entry is scanned:

> "...I've been feeling so disconnected lately..."

Neither crisis keywords nor warning indicators match. The entry proceeds without safety flags.

**What if it had matched?**

If our user had written "I feel like a burden to everyone," the WARNING_INDICATORS pattern would match:
- Entry flagged with `has_warning_indicators: true`
- User sees a gentle check-in modal
- Resources offered but not forced
- Entry still saves

**Product Decision**: Safety screening uses simple regex, not AI, for two reasons:
1. **Speed**: No network latency—screening is instant
2. **Reliability**: Regex doesn't hallucinate or miss obvious keywords

The patterns are intentionally specific to avoid false positives. "I'm dying of laughter" won't trigger crisis mode, but "I want to die" will.

---

## Phase 4: Local Analysis

**Availability**: Native platforms only (iOS, Android)
**Code**: `src/services/analysis/localSentiment.js`

Our user is on iOS, so we run lightweight sentiment analysis on-device before the entry leaves the phone.

### How It Works

We use a VADER-style lexicon approach—no AI, no network calls:

1. **Tokenize** the text into words
2. **Check context phrases** for compound expressions
3. **Scan for emojis** and their sentiment contribution
4. **For each word:**
   - Look up sentiment score in lexicon
   - Check for negators ("not happy" flips the sentiment)
   - Check for intensifiers ("very happy" amplifies the sentiment)
5. **Calculate weighted average** of all sentiment signals

### Our Example Entry Analysis

Key words detected and their sentiment contributions:

| Word/Phrase | Base Score | Modifiers | Final Score |
|-------------|------------|-----------|-------------|
| "snoring" | 0.45 | — | 0.45 (slightly negative connotation) |
| "won't stop racing" | 0.35 | — | 0.35 (anxious) |
| "want to go" | 0.60 | — | 0.60 (positive desire) |
| "dreading" | 0.25 | — | 0.25 (negative) |
| "too tired" | 0.35 | — | 0.35 (negative) |
| "awkward" | 0.30 | — | 0.30 (negative) |
| "disconnected" | 0.28 | — | 0.28 (negative) |
| "don't judge" | 0.50 | negator | 0.50 (neutral-positive) |

**Output for our entry:**
```javascript
localAnalysis: {
  entry_type: 'reflection',
  mood_score: 0.38,              // Leans negative but not severely
  classification_confidence: 0.82,
  sentiment_confidence: 0.71,
  extracted_tasks: [],
  analyzed_at: "2025-12-03T22:23:00Z",
  analysis_time_ms: 22
}
```

**Performance**: 22ms. Well under our 30ms target.

**Product Decision**: Local analysis exists purely for perceived performance. Our user sees a mood indicator immediately—before the server even knows about this entry. This is replaced by richer server analysis within seconds, but the instant feedback makes the app feel responsive.

---

## Phase 5: Persistence

**Code**: `src/App.jsx:853-956`

With all context gathered, we save the entry to Firestore. This is the point of no return—the entry is now durable.

### What Gets Saved for Our Example

```javascript
const entryData = {
  // Core
  id: "ev_20251203_x92j",
  text: "Okay, Sunny's snoring next to me and Mocha's decided my head is a good place to nap...",
  category: 'personal',
  userId: 'usr_9921',
  createdAt: Timestamp.fromDate(new Date("2025-12-03T22:23:00Z")),
  effectiveDate: Timestamp.fromDate(new Date("2025-12-03T22:23:00Z")),
  analysisStatus: 'pending',
  signalExtractionVersion: 1,

  // Health (from Whoop)
  healthContext: {
    sleep: { sleepLastNight: 5.2, sleepQuality: 'poor', ... },
    heart: { hrv: 42, restingRate: 68, stressIndicator: 'moderate' },
    recovery: { score: 34, status: 'red' },
    activity: { stepsToday: 4800, hasWorkout: true, ... }
  },

  // Environment (Austin, TX at 10:23 PM)
  environmentContext: {
    location: { latitude: 30.27, longitude: -97.74, cached: false },
    weather: 'clear',
    temperature: 52,
    lightContext: 'dark',
    daySummary: { tempHigh: 68, tempLow: 48, sunshinePercent: 82 },
    ...
  },

  // Local analysis (from iOS device)
  localAnalysis: {
    entry_type: 'reflection',
    mood_score: 0.38,
    classification_confidence: 0.82,
    ...
  },
  hasLocalAnalysis: true,

  // Temporal (Game Night on Saturday)
  futureMentions: [{
    targetDate: Timestamp.fromDate(new Date("2025-12-06T19:00:00Z")),
    event: "Game Night with David and Carol",
    sentiment: "anxious",
    ...
  }]

  // No safety flags (entry passed screening)
};
```

### Firestore Path

```
firestore://artifacts/echo-vault-v5-fresh/users/usr_9921/entries/ev_20251203_x92j
```

**At this moment:**
- Our user's entry is visible in their journal
- It shows with local analysis (mood indicator, entry type)
- The UI has returned control—they can start a new entry
- Background processing has just begun

**Product Decision**: We save with `analysisStatus: 'pending'` immediately. The entry is visible in the user's journal right away, even though deep analysis hasn't completed. This "optimistic UI" pattern prioritizes responsiveness over completeness.

---

## Phase 6: Server-Side Processing

Once the entry is saved, multiple server-side processes kick off. Some are triggered automatically, others are called by the client.

### 6.1 Embedding Generation

**Trigger**: Firestore `onEntryCreate` trigger
**Code**: `functions/index.js:914-950`

Our entry gets converted into a 768-dimensional vector for semantic search.

**How it works:**
```
Entry text → Gemini text-embedding-004 → 768 float array → Stored on entry
```

This embedding will later enable queries like "find entries where I talked about social anxiety" or "show me entries similar to this one."

### 6.2 Entry Classification

**Trigger**: Client calls `analyzeJournalEntryFn`
**Code**: `functions/index.js:296-382`

Before deep analysis, we classify what kind of entry this is:

| Type | Description | Example |
|------|-------------|---------|
| `task` | Primarily logistics/planning | "Need to call dentist, pick up groceries" |
| `mixed` | Tasks + emotional content | "Feeling overwhelmed. Need to finish report by Friday" |
| `reflection` | Emotional processing, insights | Our example—processing feelings about Game Night |
| `vent` | Emotional release, frustration | "Can't believe my boss said that. So frustrated" |

**Our entry is classified as `reflection`**—it's primarily emotional processing about social anxiety and connection, not a task list or pure venting.

### 6.3 Deep Therapeutic Analysis

**Trigger**: Client calls `analyzeJournalEntryFn`
**Code**: `functions/index.js:387-610`

This is the heart of EchoVault's intelligence. Gemini analyzes our entry and produces:

**Framework Routing:**

Our entry shows classic signs of **cognitive fusion** (treating anxious thoughts as facts) and **avoidance** (considering staying home to avoid discomfort). This routes to the **ACT (Acceptance and Commitment Therapy)** framework.

| Framework | When Selected | What It Provides |
|-----------|---------------|------------------|
| **CBT** | Negative thought patterns detected | Identifies cognitive distortions, offers perspective reframe |
| **ACT** | User "fused" with difficult thoughts | ← **Our entry routes here** |
| **Celebration** | Positive entry, achievement | Affirmation, prompts to savor the moment |
| **General** | Neutral or mixed content | Light validation without heavy intervention |

**Mood-Based Response Calibration:**

Our entry's mood score is 0.35 (server analysis), which falls in the 0.2-0.4 range:

| Mood Score | Response Strategy |
|------------|-------------------|
| 0.6+ | Light touch—validation only |
| 0.4-0.6 | Medium—add perspective if helpful |
| **0.2-0.4** | **Full response—behavioral suggestions** ← Our entry |
| <0.2 | Full response + always include coping action |

**Analysis Output for Our Entry:**

```javascript
analysis: {
  mood_score: 0.35,
  framework: 'act',
  title: "Wrestling with Social Anxiety",
  tags: ['social-anxiety', 'connection', 'avoidance', 'self-compassion'],

  act_analysis: {
    acknowledgment: "It's really hard to feel torn between wanting connection and fearing it won't go well. That inner conflict is exhausting, especially when you're already tired.",

    fusion_thought: "If I go to Game Night, I'll be too tired and say something awkward",

    defusion_technique: "labeling",

    defusion_phrase: "I notice I'm having the thought that I'll be too tired and awkward at Game Night.",

    values_context: "Connection",

    committed_action: "Text David or Carol tomorrow just to say you're looking forward to Saturday—no pressure to be 'on,' just a small step toward the people you care about."
  }
}
```

**Product Decision**: We deliberately avoid over-therapizing. Our entry gets ACT treatment because it genuinely shows fusion and avoidance. A simple "Had a nice day with my pets" would get Celebration or General framework instead.

### 6.4 Entity Resolution

**Trigger**: Part of `analyzeJournalEntryFn` if user has entities
**Code**: `functions/index.js:850-882`

Our user has existing entities in their knowledge base. We check if any names in this entry should be linked:

**Entities detected:**
- "Sunny" → Matches entity `{ name: "Sunny", entityType: "pet", relationship: "pet" }`
- "Mocha" → Matches entity `{ name: "Mocha", entityType: "pet", relationship: "pet" }`
- "David" → Matches entity `{ name: "David", entityType: "person", relationship: "friend" }`
- "Carol" → Matches entity `{ name: "Carol", entityType: "person", relationship: "friend" }`

If our user had written "david and carol" in lowercase, the system would correct it:

```javascript
entityResolution: {
  originalText: "david and carol invited us...",
  correctedText: "David and Carol invited us...",
  corrections: [
    { original: "david", corrected: "David", entityId: "ent_david_001" },
    { original: "carol", corrected: "Carol", entityId: "ent_carol_002" }
  ]
}
```

---

## Phase 7: Signal Extraction

**Trigger**: Client calls `processEntrySignals` after save
**Code**: `src/services/signals/signalExtractor.js`

The final phase extracts actionable "signals" from our entry—goals, insights, patterns that the system should track over time.

### Signals Extracted from Our Entry

**1. Feeling Signal**
```javascript
{
  type: 'feeling',
  content: 'anxious about social event',
  sentiment: 'negative',
  targetDate: '2025-12-03',   // TODAY - the anxiety is felt now
  weight: 0.8,                // High weight - affects mood tracking
  sourcePhrase: "part of me is dreading it"
}
```

**2. Plan Signal**
```javascript
{
  type: 'plan',
  content: 'Game Night with David and Carol',
  sentiment: 'neutral',       // Plans are facts, not feelings
  targetDate: '2025-12-06',   // SATURDAY - when event occurs
  weight: 0.0,                // Zero weight - doesn't affect mood
  sourcePhrase: "Game Night this Saturday"
}
```

**3. Insight Signal**
```javascript
{
  type: 'insight',
  content: 'User shows pattern of social avoidance when tired',
  state: 'pending',
  relatedPatterns: ['sleep-social-correlation'],
  sourcePhrase: "I've been feeling so disconnected lately"
}
```

### Critical Rule: Feelings vs Plans

When our user writes "I'm dreading Game Night this Saturday," this produces TWO signals:

1. **Feeling: anxious** → Anchored to **TODAY** (December 3rd) because the dread is felt now
2. **Plan: Game Night** → Anchored to **SATURDAY** (December 6th) because that's when it occurs

This distinction matters for accurate mood tracking. The anxiety affects December 3rd's emotional state, not December 6th's.

### Signal Lifecycle

The insight signal we extracted will follow this lifecycle:

```
pending → (user confirms it resonates) → verified → (user takes action) → actioned
   ↓
(user dismisses) → dismissed
```

---

## The Complete Picture: Our Example Entry Fully Processed

After all seven phases, our user's entry about Sunny, Mocha, and Game Night has been transformed from 84 words of text into a rich data object with **60+ data points**:

```javascript
{
  // ═══════════════════════════════════════════════════════════════════
  // CORE (from Phase 1 & 5)
  // ═══════════════════════════════════════════════════════════════════
  id: "ev_20251203_x92j",
  text: "Okay, Sunny's snoring next to me...",
  category: "personal",
  userId: "usr_9921",
  createdAt: "2025-12-03T22:23:00Z",
  effectiveDate: "2025-12-03T22:23:00Z",
  analysisStatus: "complete",
  signalExtractionVersion: 1,
  embedding: [0.023, -0.156, 0.089, ...],  // 768 dimensions

  // ═══════════════════════════════════════════════════════════════════
  // HEALTH CONTEXT (from Phase 2.1 - Whoop)
  // ═══════════════════════════════════════════════════════════════════
  healthContext: {
    sleep: {
      sleepLastNight: 5.2,
      sleepScore: 58,
      sleepQuality: "poor",
      sleepStages: { deep: 38, rem: 62, light: 195, awake: 17 }
    },
    heart: {
      restingRate: 68,
      hrv: 42,
      stressIndicator: "moderate"
    },
    recovery: { score: 34, status: "red" },
    strain: { score: 8.2 },
    activity: {
      stepsToday: 4800,
      totalExerciseMinutes: 30,
      hasWorkout: true,
      workouts: [{ type: "yoga", duration: 30, source: "whoop" }]
    },
    queriedAt: "2025-12-03T22:23:00Z"
  },

  // ═══════════════════════════════════════════════════════════════════
  // ENVIRONMENT CONTEXT (from Phase 2.2 - Austin, TX)
  // ═══════════════════════════════════════════════════════════════════
  environmentContext: {
    location: { latitude: 30.27, longitude: -97.74, cached: false },
    weather: "clear",
    weatherLabel: "Clear sky",
    temperature: 52,
    temperatureUnit: "°F",
    cloudCover: 8,
    isDay: false,
    daySummary: {
      condition: "partly_cloudy",
      conditionLabel: "Partly cloudy",
      tempHigh: 68,
      tempLow: 48,
      sunshineMinutes: 507,
      sunshinePercent: 82,
      isLowSunshine: false
    },
    sunsetTime: "17:32",
    sunriseTime: "07:12",
    daylightHours: 10.3,
    isAfterDark: true,
    lightContext: "dark",
    daylightRemaining: null,
    capturedAt: "2025-12-03T22:23:00Z"
  },

  // ═══════════════════════════════════════════════════════════════════
  // TEMPORAL CONTEXT (from Phase 2.3)
  // ═══════════════════════════════════════════════════════════════════
  futureMentions: [{
    targetDate: "2025-12-06T19:00:00Z",
    event: "Game Night with David and Carol",
    sentiment: "anxious",
    phrase: "David and Carol invited us to Game Night this Saturday",
    confidence: 0.87,
    isRecurring: false,
    recurringPattern: null
  }],

  // ═══════════════════════════════════════════════════════════════════
  // LOCAL ANALYSIS (from Phase 4 - iOS device)
  // ═══════════════════════════════════════════════════════════════════
  localAnalysis: {
    entry_type: "reflection",
    mood_score: 0.38,
    classification_confidence: 0.82,
    sentiment_confidence: 0.71,
    extracted_tasks: [],
    analyzed_at: "2025-12-03T22:23:00Z",
    analysis_time_ms: 22
  },
  hasLocalAnalysis: true,

  // ═══════════════════════════════════════════════════════════════════
  // SERVER ANALYSIS (from Phase 6)
  // ═══════════════════════════════════════════════════════════════════
  entry_type: "reflection",
  title: "Wrestling with Social Anxiety",

  analysis: {
    mood_score: 0.35,
    framework: "act",
    tags: ["social-anxiety", "connection", "avoidance", "self-compassion"],

    act_analysis: {
      acknowledgment: "It's really hard to feel torn between wanting connection and fearing it won't go well. That inner conflict is exhausting, especially when you're already tired.",
      fusion_thought: "If I go to Game Night, I'll be too tired and say something awkward",
      defusion_technique: "labeling",
      defusion_phrase: "I notice I'm having the thought that I'll be too tired and awkward at Game Night.",
      values_context: "Connection",
      committed_action: "Text David or Carol tomorrow just to say you're looking forward to Saturday—no pressure to be 'on,' just a small step toward the people you care about."
    }
  },

  classification: {
    entry_type: "reflection",
    confidence: 0.89,
    extracted_tasks: []
  },

  entityResolution: {
    originalText: "...David and Carol invited us...",
    correctedText: "...David and Carol invited us...",  // Already correct
    corrections: []
  }
}
```

**Additionally, in the `signal_states` collection:**
- Feeling signal (anxious, Dec 3)
- Plan signal (Game Night, Dec 6)
- Insight signal (social avoidance pattern, pending)

---

## Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER: "Okay, Sunny's snoring next to me and Mocha's decided..."           │
│  [Taps Save on iOS at 10:23 PM in Austin, TX]                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: CAPTURE                                                            │
│                                                                              │
│  Text entry captured: 84 words about pets and Game Night anxiety            │
│  (If voice: would also get tone analysis → tired, anxious, conflicted)      │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: CONTEXT ENRICHMENT (Parallel, ~400ms)                              │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐           │
│  │  Health (Whoop)  │  │ Environment (GPS)│  │ Temporal Detection│          │
│  │                  │  │                  │  │                  │           │
│  │ Sleep: 5.2h poor │  │ Austin, TX       │  │ "this Saturday"  │           │
│  │ HRV: 42 moderate │  │ Clear, 52°F      │  │ → Game Night     │           │
│  │ Recovery: 34% red│  │ Dark (10:23 PM)  │  │   Dec 6, anxious │           │
│  │ Steps: 4,800     │  │ Day: 82% sunny   │  │                  │           │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: SAFETY SCREENING (<5ms)                                            │
│                                                                              │
│  "disconnected" scanned → No crisis keywords → No warning indicators        │
│  ✓ Entry passes safety check                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: LOCAL ANALYSIS (iOS only, 22ms)                                    │
│                                                                              │
│  VADER lexicon: "dreading" -0.25, "disconnected" -0.22, "want to go" +0.10  │
│  → entry_type: reflection, mood_score: 0.38                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: PERSISTENCE (~200ms)                                               │
│                                                                              │
│  Save to: artifacts/echo-vault-v5-fresh/users/usr_9921/entries/ev_xxx       │
│  analysisStatus: 'pending'                                                  │
│                                                                              │
│  ✓ Entry visible in journal immediately                                     │
│  ✓ User sees local mood indicator (0.38)                                    │
│  ✓ UI returns control to user                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 6: SERVER PROCESSING (Background, ~3s)                                │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐           │
│  │    Embedding     │  │  Classification  │  │  Deep Analysis   │           │
│  │                  │  │                  │  │                  │           │
│  │ 768-dim vector   │  │ → reflection     │  │ Framework: ACT   │           │
│  │ for semantic     │  │   (conf: 0.89)   │  │ Mood: 0.35       │           │
│  │ search           │  │                  │  │ Title: "Wrestling│           │
│  │                  │  │                  │  │  with Social     │           │
│  │                  │  │                  │  │  Anxiety"        │           │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘           │
│                                                                              │
│  Entity Resolution: Sunny, Mocha, David, Carol → linked to existing entities│
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 7: SIGNAL EXTRACTION (Background, ~2s)                                │
│                                                                              │
│  Signals extracted:                                                         │
│  • Feeling: anxious → anchored to Dec 3 (today)                             │
│  • Plan: Game Night → anchored to Dec 6 (Saturday)                          │
│  • Insight: social avoidance pattern → state: pending                       │
│                                                                              │
│  Saved to: users/usr_9921/signal_states/                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────┐
                        │        COMPLETE          │
                        │                          │
                        │  Entry enriched with:    │
                        │  • 60+ data points       │
                        │  • Health correlation    │
                        │  • Weather correlation   │
                        │  • ACT therapeutic       │
                        │    guidance              │
                        │  • Future event tracking │
                        │  • 3 actionable signals  │
                        └──────────────────────────┘
```

---

## Timing & Performance

### Our Example Entry Timeline

| Phase | Duration | Blocking? | What Happened |
|-------|----------|-----------|---------------|
| Phase 1: Capture | 0ms | Yes | Text captured |
| Phase 2: Context | 420ms | Yes | Whoop, weather, temporal in parallel |
| Phase 3: Safety | 3ms | Yes | Regex scan, no flags |
| Phase 4: Local Analysis | 22ms | Yes | VADER → mood 0.38 |
| Phase 5: Persistence | 180ms | Yes | Saved to Firestore |
| Phase 6: Server Analysis | 3,200ms | **No** | Gemini → ACT framework |
| Phase 7: Signal Extraction | 1,800ms | **No** | 3 signals extracted |

**Total blocking time**: 625ms (user waits this long)
**Total processing time**: 5,625ms (happens in background)

### What Our User Experienced

```
0ms        - Taps Save
625ms      - Entry appears in journal with mood indicator (0.38)
3,800ms    - Title updates to "Wrestling with Social Anxiety"
4,200ms    - ACT insights appear (defusion technique, committed action)
5,600ms    - Future event banner: "Game Night Saturday—we'll follow up!"
```

---

## Error Handling & Degradation

The pipeline is designed to degrade gracefully. Let's see what would happen to our example entry if things went wrong:

| Component Fails | Impact on Our Entry | User Experience |
|-----------------|---------------------|-----------------|
| Whoop API timeout | No health context stored | Entry saves without sleep/HRV data |
| Open-Meteo down | No environment context | Entry saves without weather |
| Location denied | No weather or coordinates | Entry saves normally |
| Local analysis crash | No instant mood indicator | Entry saves, awaits server (slower) |
| Gemini overloaded | No title or ACT insights | Entry shows with raw text only |
| Signal extraction fails | No future event tracking | Entry saves, no Game Night follow-up |

**The only truly blocking failure is if Firestore is down**—then the entry cannot be saved at all. But that's infrastructure-level failure, not application logic.

---

## Product Decisions Embedded in the Pipeline

### 1. No User-Reported Mood Sliders

**Decision**: Mood is entirely AI-derived from text and voice analysis.
**Rationale**:
- Our user didn't have to rate their mood 1-10—that would add friction
- The AI detected mood 0.35 from language ("dreading," "disconnected")
- Users in distress often underreport; AI catches signals they might hide

### 2. Privacy-First Location Handling

**Decision**: Round GPS to ~1km precision, never store addresses.
**Rationale**:
- We know our user is in Austin—sufficient for weather lookup
- We don't know their exact street address
- No "location type" inference (home/work)—that's too invasive

### 3. Optimistic UI with Background Processing

**Decision**: Save immediately, show analysis progressively.
**Rationale**:
- Our user saw their entry in 625ms
- They didn't wait 5+ seconds for Gemini
- The act of writing is therapeutic; don't interrupt it

### 4. Local Analysis for Perceived Performance

**Decision**: Run lightweight on-device analysis for instant feedback.
**Rationale**:
- Our user saw mood indicator at 625ms
- Server analysis updated it at 3,800ms
- 3 seconds is noticeable; 625ms feels instant

### 5. Regex for Safety, AI for Everything Else

**Decision**: Crisis detection uses regex, not AI.
**Rationale**:
- Our user's entry was scanned in 3ms
- No waiting for network to determine if someone is in crisis
- "I've been feeling so disconnected" correctly didn't trigger crisis mode

### 6. Feelings Anchored to Today, Plans Anchored to Event Date

**Decision**: "Dreading Game Night this Saturday" creates two signals with different dates.
**Rationale**:
- The dread (Dec 3) and the event (Dec 6) are different concerns
- Dec 3 mood tracking captures the anxiety
- Dec 6 follow-up asks "how did it go?"

### 7. Framework-Specific Therapeutic Responses

**Decision**: Route to CBT, ACT, or Celebration based on entry content.
**Rationale**:
- Our entry showed fusion ("I'll be too tired and awkward") → ACT
- A different entry might show distortions ("Everyone will judge me") → CBT
- A positive entry ("Game Night was great!") → Celebration

---

## Appendix: Key Files Reference

| Phase | Primary Files |
|-------|---------------|
| Voice capture | `src/hooks/useVoiceRelay.js`, `relay-server/src/` |
| Health context | `src/services/health/healthDataService.js` |
| Environment context | `src/services/environment/environmentService.js` |
| Temporal detection | `src/services/temporal/index.js` |
| Safety screening | `src/config/constants.js` |
| Local analysis | `src/services/analysis/localSentiment.js` |
| Entry save | `src/App.jsx` (doSaveEntry function) |
| Server analysis | `functions/index.js` |
| Signal extraction | `src/services/signals/signalExtractor.js` |
| Voice tone analysis | `relay-server/src/analysis/voiceTone.ts` |

---

*This document reflects the codebase as of January 2026. For schema-level field details, see `ENTRY_DATA_SCHEMA.md`.*
