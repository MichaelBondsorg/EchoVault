# EchoVault Phase 1 Implementation Plan

## Overview

This document outlines the implementation plan for Phase 1 improvements to EchoVault, focusing on two major features:

1. **AI Companion with Persistent Memory** - Transform the stateless chat into a companion that truly knows the user
2. **Advanced Pattern Detection** - Find multi-factor, non-obvious correlations

---

## Table of Contents

- [Current State Analysis](#current-state-analysis)
- [Feature 1: AI Companion with Persistent Memory](#feature-1-ai-companion-with-persistent-memory)
- [Feature 2: Advanced Pattern Detection](#feature-2-advanced-pattern-detection)
- [Implementation Timeline](#implementation-timeline)
- [Files to Create/Modify](#files-to-createmodify)

---

## Current State Analysis

### Current Architecture
- Users create journal entries (text/voice) analyzed for mood (0-1), entities, and therapeutic framework
- Entries have embeddings (1536-dim vectors) for semantic search
- Pattern detection computes single-factor correlations (activity-mood, temporal, triggers, absence warnings)
- RAG-based chat allows journal queries with semantic + entity matching

### Current Limitations
1. **Chat has no persistent memory** - each session starts fresh
2. **Pattern detection is statistical** - single-factor correlations only
3. **RAG retrieval capped at 10 entries** - limiting context depth
4. **No understanding of relationships, life events, or preferences over time**

### The 10-Entry Limit (Current Locations)

| Location | Line | Current Limit | Recommendation |
|----------|------|---------------|----------------|
| `Chat.jsx` | 182 | Top 10 similar entries | Increase to 20-30 with smart truncation |
| `analysis/index.js` | 218 | 10 for entity analysis | Keep (background task) |
| `analysis/index.js` | 260 | 10 for smart context | Increase to 25 |
| `rag/index.js` | topK param | Default 10 | Make dynamic based on query complexity |

---

## Feature 1: AI Companion with Persistent Memory

### Goal
Transform the current chat into a **persistent AI companion** that truly knows the user, combining:
- Long-term memory architecture
- Unified chat/voice interface
- Enhanced RAG (removing the 10-entry limit where appropriate)
- Guided entries & mindfulness exercises

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    UNIFIED CONVERSATION LAYER                    │
├─────────────────────────────────────────────────────────────────┤
│  UnifiedChat.jsx (replaces Chat.jsx + RealtimeConversation.jsx) │
│  ├── Text Input Mode                                            │
│  ├── Voice Input Mode (push-to-talk / continuous)               │
│  ├── Guided Session Mode                                        │
│  └── Mindfulness Exercise Mode                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MEMORY ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────┤
│  Memory Graph (Firestore)                                       │
│  ├── People: { name, relationship, sentiment, lastMentioned }   │
│  ├── Places: { name, type, emotionalValence, frequency }        │
│  ├── Events: { description, date, significance, emotions }      │
│  ├── Goals: { existing goal system, enhanced }                  │
│  ├── Preferences: { communicationStyle, topics, triggers }      │
│  ├── Themes: { recurring life themes, growth areas }            │
│  └── Conversations: { summaries, key moments, follow-ups }      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ENHANCED RAG SYSTEM                           │
├─────────────────────────────────────────────────────────────────┤
│  Tiered Retrieval:                                              │
│  ├── Tier 1: Memory Graph (always included, ~500 tokens)        │
│  ├── Tier 2: Recent entries (last 7 days, up to 10)             │
│  ├── Tier 3: Semantically similar (up to 20, smart truncated)   │
│  └── Tier 4: Entity-matched deep history (up to 10)             │
│                                                                 │
│  Dynamic Context Budget: 8000 tokens max                        │
│  Smart Truncation: Summarize older entries vs full text         │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model: Memory Graph

```javascript
// Firestore: artifacts/{appId}/users/{userId}/memory/

// Core memory document
memory/core {
  lastUpdated: Timestamp,
  version: number,

  // Communication preferences learned over time
  preferences: {
    communicationStyle: "warm" | "direct" | "analytical",
    preferredName: string | null,
    avoidTopics: string[], // User has dismissed insights about these
    respondWellTo: string[], // "validation", "practical_advice", "questions"
  },

  // Key life themes identified
  themes: [
    {
      id: string,
      theme: "career_transition",
      firstDetected: Timestamp,
      mentions: number,
      sentiment: "struggling" | "growing" | "resolved",
      relatedEntries: string[] // entry IDs
    }
  ],

  // Conversation continuity
  conversationState: {
    lastTopic: string,
    pendingFollowUps: [
      { question: string, context: string, askedAt: Timestamp }
    ],
    recentInsights: string[], // What companion has shared recently
  }
}

// People the user mentions
memory/people/{personId} {
  name: string,
  aliases: string[], // "mom", "mother", "Sarah"
  relationship: string, // "mother", "coworker", "friend"

  sentiment: {
    overall: number, // -1 to 1
    recent: number,  // Last 30 days
    trend: "improving" | "declining" | "stable"
  },

  topics: [
    { topic: string, sentiment: number, frequency: number }
  ],

  lastMentioned: Timestamp,
  mentionCount: number,
  significantMoments: [
    { date: Timestamp, summary: string, entryId: string }
  ]
}

// Significant life events
memory/events/{eventId} {
  description: string,
  date: Timestamp,
  type: "milestone" | "challenge" | "loss" | "achievement" | "change",
  emotionalImpact: number, // 1-10
  resolved: boolean,

  // For recurring events
  recurring: boolean,
  recurrencePattern: string, // "annual", "monthly"
  nextOccurrence: Timestamp,

  relatedPeople: string[],
  relatedGoals: string[],
  followUpQuestions: string[]
}

// Conversation summaries
memory/conversations/{conversationId} {
  date: Timestamp,
  mode: "chat" | "voice" | "guided",
  sessionType: string, // "morning_checkin", "free_chat", etc.

  summary: string,
  keyTopics: string[],
  emotionalArc: { start: number, end: number },

  // For companion continuity
  insightsShared: string[],
  questionsAsked: string[],
  userBreakthroughs: string[],
  followUpNeeded: string[]
}
```

### Implementation: Memory Extraction Service

```javascript
// New file: src/services/memory/memoryExtraction.js

export const extractMemoryFromEntry = async (entry, existingMemory) => {
  const prompt = `
    Analyze this journal entry and extract memory-worthy information.

    ENTRY: ${entry.text}
    DATE: ${entry.effectiveDate}
    EXISTING PEOPLE: ${JSON.stringify(existingMemory.people)}
    EXISTING THEMES: ${JSON.stringify(existingMemory.themes)}

    Extract:
    1. NEW_PEOPLE: People mentioned (name, relationship, sentiment)
    2. PEOPLE_UPDATES: Updates to existing people (new topics, sentiment shifts)
    3. EVENTS: Significant events (past, present, or future)
    4. THEME_UPDATES: Recurring themes detected or updated
    5. FOLLOW_UPS: Questions the companion should ask later

    Return JSON only.
  `;

  const result = await executePrompt({ prompt, model: 'gemini-flash' });
  return parseMemoryExtraction(result);
};

export const updateMemoryGraph = async (userId, extraction) => {
  const batch = writeBatch(db);

  // Update people
  for (const person of extraction.newPeople) {
    const personRef = doc(db, getMemoryPath(userId), 'people', generateId());
    batch.set(personRef, {
      ...person,
      firstMentioned: serverTimestamp(),
      lastMentioned: serverTimestamp(),
      mentionCount: 1
    });
  }

  // Update existing people
  for (const update of extraction.peopleUpdates) {
    const personRef = doc(db, getMemoryPath(userId), 'people', update.id);
    batch.update(personRef, {
      lastMentioned: serverTimestamp(),
      mentionCount: increment(1),
      ...update.changes
    });
  }

  // Add events
  for (const event of extraction.events) {
    const eventRef = doc(db, getMemoryPath(userId), 'events', generateId());
    batch.set(eventRef, {
      ...event,
      createdAt: serverTimestamp()
    });
  }

  await batch.commit();
};
```

### Implementation: Enhanced RAG with Memory

```javascript
// Updated: src/services/rag/index.js

export const getCompanionContext = async ({
  userId,
  query,
  queryEmbedding,
  entries,
  category,
  maxTokens = 8000
}) => {
  const tokenBudget = { used: 0, max: maxTokens };
  const context = { memory: null, recent: [], similar: [], entityMatched: [] };

  // Tier 1: Memory Graph (always included, ~500 tokens)
  const memory = await getMemoryGraph(userId);
  context.memory = formatMemoryForContext(memory);
  tokenBudget.used += estimateTokens(context.memory);

  // Tier 2: Recent entries (last 7 days)
  const recentEntries = entries
    .filter(e => daysSince(e.effectiveDate) <= 7)
    .sort((a, b) => b.effectiveDate - a.effectiveDate)
    .slice(0, 10);

  context.recent = recentEntries.map(e => ({
    ...e,
    text: truncateToTokens(e.text, 300) // Smart truncation
  }));
  tokenBudget.used += estimateTokens(context.recent);

  // Tier 3: Semantically similar (dynamic limit based on remaining budget)
  const remainingBudget = tokenBudget.max - tokenBudget.used;
  const similarLimit = Math.min(30, Math.floor(remainingBudget / 400));

  const similarEntries = entries
    .filter(e => e.embedding && !recentEntries.includes(e))
    .map(e => ({ ...e, similarity: cosineSimilarity(queryEmbedding, e.embedding) }))
    .filter(e => e.similarity > 0.25) // Lower threshold for more coverage
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, similarLimit);

  context.similar = similarEntries.map(e => ({
    ...e,
    text: e.similarity > 0.5 ? e.text : summarizeEntry(e) // Full text for high similarity
  }));

  // Tier 4: Entity-matched from query
  const queryEntities = extractQueryEntities(query);
  if (queryEntities.length > 0) {
    const entityMatched = await findByEntity(entries, queryEntities, 10);
    context.entityMatched = entityMatched.filter(
      e => !recentEntries.includes(e) && !similarEntries.includes(e)
    );
  }

  return context;
};
```

### Implementation: Unified Chat Component

```javascript
// New file: src/components/chat/UnifiedConversation.jsx

const UnifiedConversation = ({ entries, category, onSaveEntry }) => {
  const [mode, setMode] = useState('chat'); // 'chat' | 'voice' | 'guided' | 'mindfulness'
  const [inputMode, setInputMode] = useState('text'); // 'text' | 'voice'
  const [memory, setMemory] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [guidedSession, setGuidedSession] = useState(null);

  // Load memory on mount
  useEffect(() => {
    loadMemoryGraph(userId).then(setMemory);
  }, [userId]);

  // Companion personality based on learned preferences
  const getCompanionSystemPrompt = () => {
    const style = memory?.preferences?.communicationStyle || 'warm';
    const name = memory?.preferences?.preferredName;
    const pendingFollowUps = memory?.conversationState?.pendingFollowUps || [];

    return `You are a supportive companion who has known ${name || 'this person'} through their journaling journey.

COMMUNICATION STYLE: ${style}
${style === 'warm' ? 'Be empathetic, validating, and gentle.' : ''}
${style === 'direct' ? 'Be clear, concise, and action-oriented.' : ''}
${style === 'analytical' ? 'Be thoughtful, pattern-focused, and insightful.' : ''}

MEMORY CONTEXT:
${formatMemoryForPrompt(memory)}

PENDING FOLLOW-UPS (ask naturally when relevant):
${pendingFollowUps.map(f => `- ${f.question} (context: ${f.context})`).join('\n')}

GUIDELINES:
- Reference past conversations and entries naturally
- Remember important people, events, and themes
- Notice patterns but present them as gentle observations
- Ask follow-up questions to show you remember and care
- Never be preachy or lecture - be a supportive companion`;
  };

  const handleSendMessage = async (message) => {
    // Get enhanced context
    const queryEmbedding = await generateEmbedding(message);
    const context = await getCompanionContext({
      userId,
      query: message,
      queryEmbedding,
      entries,
      category
    });

    // Build messages with memory
    const systemPrompt = getCompanionSystemPrompt();
    const contextPrompt = formatContextForChat(context);

    // Send to AI
    const response = await askJournalAI({
      systemPrompt,
      context: contextPrompt,
      conversationHistory,
      message
    });

    // Update conversation history
    setConversationHistory(prev => [
      ...prev,
      { role: 'user', content: message },
      { role: 'assistant', content: response }
    ]);

    // Extract and save any memory updates from this conversation
    await processConversationForMemory(message, response);
  };

  // Mode-specific rendering
  return (
    <div className="unified-conversation">
      <ModeSelector mode={mode} onModeChange={setMode} />

      {mode === 'chat' && (
        <ChatInterface
          history={conversationHistory}
          onSend={handleSendMessage}
          inputMode={inputMode}
          onInputModeChange={setInputMode}
          memory={memory}
        />
      )}

      {mode === 'voice' && (
        <VoiceInterface
          history={conversationHistory}
          onSend={handleSendMessage}
          memory={memory}
        />
      )}

      {mode === 'guided' && (
        <GuidedSessionInterface
          session={guidedSession}
          onSelectSession={setGuidedSession}
          memory={memory}
          onComplete={handleGuidedComplete}
        />
      )}

      {mode === 'mindfulness' && (
        <MindfulnessInterface
          memory={memory}
          onComplete={handleMindfulnessComplete}
        />
      )}
    </div>
  );
};
```

### Guided Sessions & Mindfulness

```javascript
// New file: src/services/guided/sessions.js

export const GUIDED_SESSIONS = {
  morning_checkin: {
    id: 'morning_checkin',
    name: 'Morning Check-in',
    duration: '5 min',
    icon: 'sunrise',
    timeOfDay: ['morning'],
    prompts: [
      { type: 'open', question: 'How are you feeling this morning?' },
      { type: 'scale', question: 'Energy level?', min: 1, max: 10 },
      { type: 'open', question: 'What\'s on your mind for today?' },
      { type: 'intention', question: 'What\'s one intention for today?' }
    ],
    memoryAware: true
  },

  evening_reflection: {
    id: 'evening_reflection',
    name: 'Evening Reflection',
    duration: '8 min',
    icon: 'moon',
    timeOfDay: ['evening', 'night'],
    prompts: [
      { type: 'open', question: 'How did today go?' },
      { type: 'gratitude', question: 'What are you grateful for today?' },
      { type: 'learning', question: 'What did you learn about yourself?' },
      { type: 'open', question: 'Anything you want to let go of before sleep?' }
    ],
    memoryAware: true
  },

  guided_entry: {
    id: 'guided_entry',
    name: 'Guided Journal Entry',
    duration: '10 min',
    icon: 'pen-tool',
    description: 'Let me help you explore what\'s on your mind',
    prompts: [
      { type: 'open', question: 'What would you like to journal about?' },
      { type: 'dynamic' }, // AI generates follow-up based on response
      { type: 'dynamic' },
      { type: 'dynamic' },
      { type: 'summary', question: 'Let me reflect back what I heard...' }
    ],
    memoryAware: true,
    savesAsEntry: true
  },

  memory_exploration: {
    id: 'memory_exploration',
    name: 'Explore Your Journey',
    duration: '10 min',
    icon: 'compass',
    description: 'Reflect on patterns and growth in your journal',
    prompts: [
      { type: 'memory_query', question: 'What would you like to explore from your journal?' },
      { type: 'pattern_share' },
      { type: 'reflection', question: 'How does that resonate with you?' },
      { type: 'insight_offer' }
    ],
    memoryAware: true
  }
};

export const MINDFULNESS_EXERCISES = {
  box_breathing: {
    id: 'box_breathing',
    name: 'Box Breathing',
    duration: '4 min',
    icon: 'square',
    description: 'Calm your nervous system with rhythmic breathing',
    steps: [
      { action: 'inhale', duration: 4, instruction: 'Breathe in slowly...' },
      { action: 'hold', duration: 4, instruction: 'Hold gently...' },
      { action: 'exhale', duration: 4, instruction: 'Release slowly...' },
      { action: 'hold', duration: 4, instruction: 'Rest empty...' }
    ],
    cycles: 6,
    audioGuided: true,
    hapticFeedback: true
  },

  grounding_54321: {
    id: 'grounding_54321',
    name: '5-4-3-2-1 Grounding',
    duration: '5 min',
    icon: 'hand',
    description: 'Connect to the present moment through your senses',
    steps: [
      { sense: 'see', count: 5, prompt: 'Name 5 things you can see...' },
      { sense: 'touch', count: 4, prompt: 'Name 4 things you can touch...' },
      { sense: 'hear', count: 3, prompt: 'Name 3 things you can hear...' },
      { sense: 'smell', count: 2, prompt: 'Name 2 things you can smell...' },
      { sense: 'taste', count: 1, prompt: 'Name 1 thing you can taste...' }
    ],
    interactive: true,
    voiceEnabled: true
  },

  body_scan: {
    id: 'body_scan',
    name: 'Body Scan',
    duration: '8 min',
    icon: 'user',
    description: 'Release tension by scanning through your body',
    regions: ['feet', 'legs', 'hips', 'stomach', 'chest', 'hands', 'arms', 'shoulders', 'neck', 'face', 'head'],
    promptPerRegion: true,
    audioGuided: true
  },

  loving_kindness: {
    id: 'loving_kindness',
    name: 'Loving Kindness',
    duration: '7 min',
    icon: 'heart',
    description: 'Cultivate compassion for yourself and others',
    memoryAware: true, // Will include actual people from memory graph
    targets: ['self', 'loved_one', 'neutral_person', 'difficult_person', 'all_beings'],
    phrases: [
      'May you be happy',
      'May you be healthy',
      'May you be safe',
      'May you live with ease'
    ]
  }
};
```

---

## Feature 2: Advanced Pattern Detection

### Goal
Enhance pattern detection to find non-obvious, multi-factor correlations that the current statistical approach misses.

### Current vs. Enhanced

| Current | Enhanced |
|---------|----------|
| Single-factor correlations (yoga → good mood) | Multi-factor (yoga + morning + alone → peak mood) |
| Statistical averages | ML-based anomaly detection |
| Predefined pattern types | Discovered pattern types |
| 7-day windows | Adaptive windows (7-90 days) |
| Entity-mood correlation | Cross-domain correlation (people → activities → time) |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                ADVANCED PATTERN ENGINE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: Feature Extraction                                    │
│  ├── Temporal features (time, day, week, month, season)         │
│  ├── Entity features (people, places, activities)               │
│  ├── Contextual features (weather, health, sleep)               │
│  ├── Linguistic features (self-talk categories)                 │
│  └── Sequential features (what preceded what)                   │
│                                                                 │
│  Layer 2: Pattern Mining                                        │
│  ├── Association rule mining (if A and B then C)                │
│  ├── Sequence pattern mining (A → B → mood drop)                │
│  ├── Anomaly detection (unusual entries/moods)                  │
│  ├── Cluster analysis (entry type groupings)                    │
│  └── Causal inference (what CAUSES mood changes)                │
│                                                                 │
│  Layer 3: Insight Generation                                    │
│  ├── Natural language explanation                               │
│  ├── Confidence scoring                                         │
│  ├── Actionability assessment                                   │
│  └── Novelty detection (avoid repeating known insights)         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### New Pattern Types

```javascript
// New file: src/services/patterns/advanced/patternTypes.js

export const ADVANCED_PATTERN_TYPES = {
  // MULTI-FACTOR TRIGGERS
  compound_trigger: {
    id: 'compound_trigger',
    name: 'Compound Trigger',
    description: 'Multiple factors that together affect mood',
    example: 'Work stress + poor sleep + no exercise = significant mood drop',
    minDataPoints: 15,
    computation: 'association_rules'
  },

  // SEQUENCE PATTERNS
  mood_cascade: {
    id: 'mood_cascade',
    name: 'Mood Cascade',
    description: 'A sequence of events that leads to mood changes',
    example: 'Conflict with Sarah → isolation → rumination → low mood',
    minDataPoints: 10,
    computation: 'sequence_mining'
  },

  // PROTECTIVE PATTERNS
  mood_buffer: {
    id: 'mood_buffer',
    name: 'Mood Buffer',
    description: 'Activities that protect against mood drops',
    example: 'Exercise after work stress prevents evening mood dip',
    minDataPoints: 12,
    computation: 'conditional_probability'
  },

  // RELATIONSHIP PATTERNS
  relationship_dynamics: {
    id: 'relationship_dynamics',
    name: 'Relationship Dynamics',
    description: 'How different people affect your emotional state',
    example: 'Conversations with Mom are supportive but sometimes triggering when discussing career',
    minDataPoints: 8,
    computation: 'entity_sentiment_breakdown'
  },

  // NARRATIVE PATTERNS
  recurring_narrative: {
    id: 'recurring_narrative',
    name: 'Recurring Story',
    description: 'A story you tell yourself repeatedly',
    example: 'The "I\'m not good enough" narrative appears in work, relationships, and self-reflection',
    minDataPoints: 20,
    computation: 'semantic_clustering'
  },

  // TEMPORAL PATTERNS
  lagged_effect: {
    id: 'lagged_effect',
    name: 'Delayed Effect',
    description: 'Something that affects mood days later',
    example: 'Weekend social events correlate with higher mood on Tuesday',
    minDataPoints: 20,
    computation: 'lagged_correlation'
  },

  // RECOVERY PATTERNS
  recovery_signature: {
    id: 'recovery_signature',
    name: 'Recovery Signature',
    description: 'Your personal pattern of bouncing back',
    example: 'After low periods, you typically recover through journaling → exercise → social connection',
    minDataPoints: 3, // Need at least 3 recovery cycles
    computation: 'recovery_sequence_analysis'
  },

  // ANOMALY PATTERNS
  unusual_entry: {
    id: 'unusual_entry',
    name: 'Unusual Entry',
    description: 'An entry that stands out from your patterns',
    example: 'This entry has unusually negative language compared to your baseline',
    minDataPoints: 30, // Need baseline
    computation: 'anomaly_detection'
  }
};
```

### Feature Extraction

```javascript
// New file: src/services/patterns/advanced/featureExtraction.js

export const extractFeatures = (entry, allEntries, context) => {
  return {
    // Temporal features
    temporal: {
      dayOfWeek: new Date(entry.effectiveDate).getDay(),
      hourOfDay: new Date(entry.effectiveDate).getHours(),
      isWeekend: [0, 6].includes(new Date(entry.effectiveDate).getDay()),
      weekOfYear: getWeekOfYear(entry.effectiveDate),
      monthOfYear: new Date(entry.effectiveDate).getMonth(),
      daysFromMonthStart: new Date(entry.effectiveDate).getDate(),
      season: getSeason(entry.effectiveDate),
      isHolidayPeriod: isNearHoliday(entry.effectiveDate)
    },

    // Entity features
    entities: {
      people: extractEntitiesByType(entry.tags, '@person'),
      places: extractEntitiesByType(entry.tags, '@place'),
      activities: extractEntitiesByType(entry.tags, '@activity'),
      topics: extractEntitiesByType(entry.tags, '@topic'),
      personCount: countEntitiesByType(entry.tags, '@person'),
      isAlone: countEntitiesByType(entry.tags, '@person') === 0,
      isNewPlace: isFirstMention(entry, '@place', allEntries),
      isNewPerson: isFirstMention(entry, '@person', allEntries)
    },

    // Contextual features
    context: {
      weather: entry.environmentContext?.weather,
      temperature: entry.environmentContext?.temperature,
      isLowLight: entry.environmentContext?.isLowSunshine,
      sleepHours: entry.healthContext?.sleepLastNight,
      sleepQuality: entry.healthContext?.sleepQuality,
      hadWorkout: entry.healthContext?.hasWorkout,
      stressIndicator: entry.healthContext?.stressIndicator,
      daylightHours: entry.environmentContext?.sunTimes?.daylightHours
    },

    // Linguistic features
    linguistic: {
      wordCount: entry.text.split(/\s+/).length,
      sentenceCount: entry.text.split(/[.!?]+/).length,
      avgSentenceLength: entry.text.split(/\s+/).length / entry.text.split(/[.!?]+/).length,
      questionCount: (entry.text.match(/\?/g) || []).length,
      exclamationCount: (entry.text.match(/!/g) || []).length,
      selfReferenceCount: countSelfReferences(entry.text),
      negativeWords: countNegativeWords(entry.text),
      positiveWords: countPositiveWords(entry.text),
      obligationWords: countObligationWords(entry.text),
      uncertaintyWords: countUncertaintyWords(entry.text)
    },

    // Sequential features (relative to previous entries)
    sequential: {
      daysSinceLastEntry: getDaysSinceLastEntry(entry, allEntries),
      moodDeltaFromPrevious: getMoodDelta(entry, allEntries),
      isMoodShift: Math.abs(getMoodDelta(entry, allEntries)) > 0.2,
      entriesThisWeek: countEntriesInWindow(entry, allEntries, 7),
      avgMoodLast3Days: getAvgMoodInWindow(entry, allEntries, 3),
      previousEntryMood: getPreviousEntryMood(entry, allEntries),
      previousDayActivities: getPreviousDayActivities(entry, allEntries)
    },

    // Target variable
    target: {
      moodScore: entry.analysis?.mood_score,
      entryType: entry.analysis?.entry_type
    }
  };
};
```

### Association Rule Mining

```javascript
// New file: src/services/patterns/advanced/associationRules.js

export const mineAssociationRules = (entries, minSupport = 0.1, minConfidence = 0.6) => {
  // Convert entries to transactions
  const transactions = entries.map(entry => {
    const features = extractFeatures(entry);
    return {
      id: entry.id,
      mood: entry.analysis?.mood_score,
      items: new Set([
        `day:${features.temporal.dayOfWeek}`,
        `weekend:${features.temporal.isWeekend}`,
        `alone:${features.entities.isAlone}`,
        `sleep:${categorizeSleep(features.context.sleepHours)}`,
        `workout:${features.context.hadWorkout}`,
        `weather:${features.context.weather}`,
        ...features.entities.people.map(p => `person:${p}`),
        ...features.entities.activities.map(a => `activity:${a}`),
        ...features.entities.topics.map(t => `topic:${t}`)
      ])
    };
  });

  // Find frequent itemsets
  const frequentItemsets = findFrequentItemsets(transactions, minSupport);

  // Generate association rules for mood outcomes
  const rules = [];

  for (const itemset of frequentItemsets) {
    if (itemset.size < 2) continue;

    const itemArray = Array.from(itemset);
    const antecedent = new Set(itemArray);

    const matchingTransactions = transactions.filter(t =>
      isSubset(antecedent, t.items)
    );

    const avgMood = average(matchingTransactions.map(t => t.mood));
    const baselineMood = average(transactions.map(t => t.mood));
    const moodDelta = avgMood - baselineMood;

    if (Math.abs(moodDelta) > 0.15 && matchingTransactions.length >= 5) {
      rules.push({
        antecedent: itemArray,
        consequent: moodDelta > 0 ? 'mood_boost' : 'mood_drop',
        support: matchingTransactions.length / transactions.length,
        confidence: Math.abs(moodDelta),
        moodDelta,
        avgMood,
        count: matchingTransactions.length,
        explanation: generateRuleExplanation(itemArray, moodDelta)
      });
    }
  }

  return rules.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));
};

const generateRuleExplanation = (items, moodDelta) => {
  const direction = moodDelta > 0 ? 'higher' : 'lower';
  const percentage = Math.round(Math.abs(moodDelta) * 100);

  const conditions = items.map(item => {
    const [type, value] = item.split(':');
    switch (type) {
      case 'day': return `on ${getDayName(parseInt(value))}s`;
      case 'weekend': return value === 'true' ? 'on weekends' : 'on weekdays';
      case 'alone': return value === 'true' ? 'when alone' : 'with others';
      case 'sleep': return `after ${value} sleep`;
      case 'workout': return value === 'true' ? 'on workout days' : 'on rest days';
      case 'person': return `when with ${value}`;
      case 'activity': return `during ${value}`;
      case 'topic': return `when discussing ${value}`;
      default: return item;
    }
  });

  return `Your mood is ${percentage}% ${direction} ${conditions.join(' + ')}`;
};
```

### Sequence Pattern Mining

```javascript
// New file: src/services/patterns/advanced/sequencePatterns.js

export const mineSequencePatterns = (entries, windowDays = 3) => {
  const sequences = [];

  const sortedEntries = [...entries].sort((a, b) =>
    new Date(a.effectiveDate) - new Date(b.effectiveDate)
  );

  for (let i = windowDays; i < sortedEntries.length; i++) {
    const currentEntry = sortedEntries[i];
    const currentMood = currentEntry.analysis?.mood_score;

    if (currentMood === undefined) continue;

    const previousMood = sortedEntries[i - 1]?.analysis?.mood_score;
    const moodDrop = previousMood - currentMood;

    if (moodDrop > 0.2) {
      const sequence = [];
      for (let j = i - windowDays; j < i; j++) {
        const entry = sortedEntries[j];
        sequence.push({
          dayOffset: j - i,
          entities: entry.tags || [],
          mood: entry.analysis?.mood_score,
          entryType: entry.analysis?.entry_type,
          topics: extractTopics(entry.tags)
        });
      }

      sequences.push({
        sequence,
        outcome: { mood: currentMood, drop: moodDrop },
        endEntryId: currentEntry.id
      });
    }
  }

  const clusteredSequences = clusterSequences(sequences);

  return clusteredSequences.map(cluster => ({
    type: 'mood_cascade',
    pattern: extractCommonPattern(cluster),
    occurrences: cluster.length,
    avgMoodDrop: average(cluster.map(s => s.outcome.drop)),
    confidence: cluster.length / sequences.length,
    explanation: generateSequenceExplanation(cluster)
  }));
};
```

### Recovery Pattern Analysis

```javascript
// New file: src/services/patterns/advanced/recoveryPatterns.js

export const analyzeRecoveryPatterns = (entries) => {
  const lowPeriods = findLowPeriods(entries);

  const recoverySequences = lowPeriods.map(period => {
    const recoveryEntries = findRecoveryEntries(entries, period.endDate);

    return {
      lowPeriod: period,
      recoveryDuration: daysBetween(period.endDate, recoveryEntries.slice(-1)[0]?.effectiveDate),
      recoveryPath: recoveryEntries.map(e => ({
        date: e.effectiveDate,
        mood: e.analysis?.mood_score,
        activities: extractEntitiesByType(e.tags, '@activity'),
        topics: extractEntitiesByType(e.tags, '@topic'),
        coping: extractCopingMentions(e.text)
      })),
      whatHelped: extractHelpfulFactors(recoveryEntries)
    };
  });

  const commonFactors = findCommonRecoveryFactors(recoverySequences);

  return {
    type: 'recovery_signature',
    totalRecoveries: recoverySequences.length,
    avgRecoveryDays: average(recoverySequences.map(r => r.recoveryDuration)),
    commonFactors,
    yourPattern: generateRecoveryNarrative(commonFactors),
    insight: `When you're struggling, ${commonFactors.slice(0, 3).join(', ')} tend to help you recover`
  };
};

const extractHelpfulFactors = (recoveryEntries) => {
  const factors = [];

  for (const entry of recoveryEntries) {
    const moodImprovement = entry.moodDeltaFromPrevious > 0.1;

    if (moodImprovement) {
      factors.push(...(entry.tags || []).filter(t =>
        t.startsWith('@activity') || t.startsWith('@person')
      ));

      const copingMentions = extractCopingMentions(entry.text);
      factors.push(...copingMentions);
    }
  }

  const factorCounts = {};
  for (const factor of factors) {
    factorCounts[factor] = (factorCounts[factor] || 0) + 1;
  }

  return Object.entries(factorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([factor]) => factor);
};
```

### Anomaly Detection

```javascript
// New file: src/services/patterns/advanced/anomalyDetection.js

export const detectAnomalies = (entries) => {
  const anomalies = [];

  const features = entries.map(e => extractFeatures(e));
  const baselines = calculateBaselines(features);

  for (const entry of entries) {
    const entryFeatures = extractFeatures(entry);
    const anomalyScores = {};

    // Mood anomaly
    const moodZ = (entryFeatures.target.moodScore - baselines.mood.mean) / baselines.mood.std;
    if (Math.abs(moodZ) > 2) {
      anomalyScores.mood = moodZ;
    }

    // Length anomaly
    const lengthZ = (entryFeatures.linguistic.wordCount - baselines.wordCount.mean) / baselines.wordCount.std;
    if (Math.abs(lengthZ) > 2) {
      anomalyScores.length = lengthZ;
    }

    // Sentiment anomaly (mood vs language mismatch)
    const sentimentRatio = entryFeatures.linguistic.negativeWords /
                          (entryFeatures.linguistic.positiveWords + 1);
    const expectedSentiment = 1 - entryFeatures.target.moodScore;
    if (Math.abs(sentimentRatio - expectedSentiment) > 0.5) {
      anomalyScores.sentimentMismatch = sentimentRatio - expectedSentiment;
    }

    if (Object.keys(anomalyScores).length > 0) {
      anomalies.push({
        entryId: entry.id,
        date: entry.effectiveDate,
        scores: anomalyScores,
        type: determineAnomalyType(anomalyScores),
        explanation: generateAnomalyExplanation(anomalyScores, baselines)
      });
    }
  }

  return anomalies;
};
```

---

## Implementation Timeline

### Week 1-2: Memory Foundation
- [ ] Create memory graph Firestore schema
- [ ] Implement memory extraction service
- [ ] Add Cloud Function trigger for memory extraction
- [ ] Build memory CRUD operations

### Week 2-3: Enhanced RAG
- [ ] Implement tiered retrieval system
- [ ] Add token budget management
- [ ] Build smart truncation/summarization
- [ ] Update Chat.jsx to use new RAG

### Week 3-4: Unified Conversation
- [ ] Create UnifiedConversation component
- [ ] Implement mode switching (chat/voice/guided/mindfulness)
- [ ] Build companion system prompt with memory
- [ ] Add conversation memory extraction

### Week 4-5: Guided Sessions & Mindfulness
- [ ] Implement guided session definitions
- [ ] Build guided session UI flow
- [ ] Create mindfulness exercise components
- [ ] Add breathing exercise with animations/haptics

### Week 5-6: Advanced Pattern Foundation
- [ ] Implement feature extraction
- [ ] Build association rule mining
- [ ] Create sequence pattern mining
- [ ] Add recovery pattern analysis

### Week 6-7: Pattern Integration
- [ ] Integrate advanced patterns with existing system
- [ ] Build insight generator
- [ ] Add anomaly detection
- [ ] Create Cloud Function for heavy computation

### Week 7-8: Testing & Polish
- [ ] End-to-end testing
- [ ] Performance optimization
- [ ] UI polish
- [ ] Documentation

---

## Files to Create/Modify

### Feature 1: AI Companion with Memory

| File | Action | Description |
|------|--------|-------------|
| `src/services/memory/memoryExtraction.js` | Create | Memory extraction from entries |
| `src/services/memory/memoryGraph.js` | Create | Memory CRUD operations |
| `src/services/memory/index.js` | Create | Memory service exports |
| `src/services/rag/index.js` | Modify | Add tiered retrieval with memory |
| `src/services/guided/sessions.js` | Create | Session definitions |
| `src/services/guided/mindfulness.js` | Create | Mindfulness exercise definitions |
| `src/components/chat/UnifiedConversation.jsx` | Create | New unified chat component |
| `src/components/chat/ChatInterface.jsx` | Create | Text chat sub-component |
| `src/components/chat/VoiceInterface.jsx` | Create | Voice chat sub-component |
| `src/components/mindfulness/MindfulnessInterface.jsx` | Create | Mindfulness UI |
| `src/components/mindfulness/BreathingExercise.jsx` | Create | Breathing exercises |
| `src/components/mindfulness/GroundingExercise.jsx` | Create | 5-4-3-2-1 grounding |
| `src/components/mindfulness/ExercisePicker.jsx` | Create | Exercise selection UI |
| `src/components/chat/Chat.jsx` | Deprecate | Replace with UnifiedConversation |
| `src/components/chat/RealtimeConversation.jsx` | Deprecate | Merge into UnifiedConversation |
| `functions/index.js` | Modify | Add memory extraction Cloud Function |

### Feature 2: Advanced Pattern Detection

| File | Action | Description |
|------|--------|-------------|
| `src/services/patterns/advanced/patternTypes.js` | Create | New pattern type definitions |
| `src/services/patterns/advanced/featureExtraction.js` | Create | Rich feature extraction |
| `src/services/patterns/advanced/associationRules.js` | Create | Multi-factor pattern mining |
| `src/services/patterns/advanced/sequencePatterns.js` | Create | Sequence/cascade detection |
| `src/services/patterns/advanced/anomalyDetection.js` | Create | Anomaly identification |
| `src/services/patterns/advanced/recoveryPatterns.js` | Create | Recovery analysis |
| `src/services/patterns/advanced/insightGenerator.js` | Create | Advanced insight creation |
| `src/services/patterns/advanced/index.js` | Create | Service exports |
| `src/services/patterns/index.js` | Modify | Integrate advanced patterns |
| `functions/index.js` | Modify | Add Cloud Function for heavy computation |

---

## Technical Considerations

### Performance
- Memory extraction should be async (Cloud Function) to not block entry save
- Pattern computation should run server-side for entries > 100
- Consider caching memory graph in localStorage for faster load

### Privacy
- Memory graph contains sensitive info (names, relationships)
- Consider encryption at rest for memory documents
- Allow users to delete specific memories

### Safety
- Memory should not store crisis-related content long-term
- Ensure companion doesn't reference painful events inappropriately
- Add safeguards for follow-up questions about sensitive topics

### Testing
- Unit tests for feature extraction
- Integration tests for memory extraction accuracy
- End-to-end tests for conversation continuity
