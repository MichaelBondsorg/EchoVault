# Voice API Security & Guided Sessions Architecture Plan

## Executive Summary

This document outlines the architecture for:
1. **Secure Voice API Reconnection** - WebSocket relay server protecting API keys
2. **Voice-to-Entry Saving** - User-controlled and guided session modes
3. **Guided Journal Sessions** - AI-guided conversations using RAG and best practices

---

## Current State Analysis

### What Exists
- ✅ `VoiceRecorder.jsx` - Audio capture via Web Audio API
- ✅ `RealtimeConversation.jsx` - UI shell for voice conversations (disabled)
- ✅ `transcription.js` - Whisper API via Cloud Functions (secure)
- ✅ Robust entry analysis pipeline (CBT/ACT/Celebration frameworks)
- ✅ Hybrid RAG system with vector + recency + entity matching
- ✅ Signal extraction for temporal awareness
- ✅ Firebase Auth + Cloud Functions security model

### Why Voice Is Disabled
```
"Voice conversations temporarily unavailable.
A secure server relay is required for API key protection."
```
OpenAI's Realtime API requires WebSocket connection with API key in headers - exposing this client-side is a critical security vulnerability.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                      │
│  ┌─────────────┐    ┌──────────────────┐    ┌─────────────────────────┐ │
│  │VoiceRecorder│───▶│GuidedSession.jsx │───▶│RealtimeConversation.jsx│ │
│  └─────────────┘    └──────────────────┘    └───────────┬─────────────┘ │
│                                                         │               │
│                              Firebase Auth Token        │               │
└─────────────────────────────────────────────────────────┼───────────────┘
                                                          │
                                                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        SECURE RELAY SERVER                              │
│                      (Cloud Run / Dedicated)                            │
│  ┌────────────────┐    ┌─────────────────┐    ┌────────────────────┐   │
│  │ Auth Validator │───▶│ Session Manager │───▶│ OpenAI Realtime    │   │
│  │ (Firebase JWT) │    │ (Per-User State)│    │ WebSocket Proxy    │   │
│  └────────────────┘    └────────┬────────┘    └────────────────────┘   │
│                                 │                                       │
│                    ┌────────────┴────────────┐                         │
│                    ▼                         ▼                         │
│           ┌──────────────┐          ┌──────────────────┐               │
│           │ Transcript   │          │ RAG Context      │               │
│           │ Accumulator  │          │ Injector         │               │
│           └──────────────┘          └──────────────────┘               │
└─────────────────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     FIREBASE CLOUD FUNCTIONS                            │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────────────┐ │
│  │saveVoiceEntry  │  │getSessionContext│  │ Existing Analysis        │ │
│  │                │  │(RAG retrieval)  │  │ Pipeline                 │ │
│  └────────────────┘  └─────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Milestone 1: Secure WebSocket Relay Server

### Option Analysis

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **Cloud Run** | Scales to zero, managed, WebSocket support | Cold starts (~2-5s) | ✅ Best for production |
| **Cloud Functions** | Already in use | No WebSocket support | ❌ Not viable |
| **Dedicated VPS** | Full control, no cold starts | Always-on cost, maintenance | For high-volume later |
| **Firebase Realtime DB relay** | Real-time, managed | Hacky, not designed for this | ❌ Not recommended |

### Recommended: Cloud Run WebSocket Relay

#### Server Implementation (`/relay-server/`)

```
relay-server/
├── Dockerfile
├── package.json
├── src/
│   ├── index.ts              # Express + WebSocket server
│   ├── auth/
│   │   └── firebase.ts       # Firebase Admin SDK auth
│   ├── relay/
│   │   ├── sessionManager.ts # Per-user session state
│   │   ├── openaiProxy.ts    # OpenAI Realtime WebSocket proxy
│   │   └── transcriptBuffer.ts
│   ├── context/
│   │   └── ragInjector.ts    # Inject RAG context into system prompt
│   └── config/
│       └── secrets.ts        # Secret Manager integration
```

#### Key Security Features

1. **Authentication Flow**
   ```typescript
   // Client connects with Firebase ID token
   ws://relay.echovault.app/voice?token={firebaseIdToken}

   // Server validates before proxying
   const decodedToken = await admin.auth().verifyIdToken(token);
   const userId = decodedToken.uid;
   ```

2. **API Key Protection**
   - OpenAI API key stored in Google Secret Manager
   - Never transmitted to client
   - Server-to-OpenAI connection only

3. **Session Isolation**
   - One OpenAI session per user
   - Transcript buffer per session
   - Automatic cleanup on disconnect

4. **Rate Limiting**
   - Per-user connection limits
   - Concurrent session prevention
   - Audio duration limits

5. **Token Refresh Handling**
   ```typescript
   // Firebase ID tokens expire after 1 hour
   // Client must refresh before connecting to long sessions

   // Client-side: Refresh token before WebSocket connection
   const connectToRelay = async () => {
     // Force token refresh if close to expiry
     const token = await auth.currentUser.getIdToken(true);
     const ws = new WebSocket(`wss://relay.echovault.app/voice?token=${token}`);

     // Handle mid-session token refresh
     const refreshInterval = setInterval(async () => {
       const newToken = await auth.currentUser.getIdToken(true);
       ws.send(JSON.stringify({ type: 'token_refresh', token: newToken }));
     }, 50 * 60 * 1000);  // Refresh at 50 minutes

     return { ws, cleanup: () => clearInterval(refreshInterval) };
   };
   ```

#### Relay Protocol

```typescript
// Client → Relay messages
interface ClientMessage {
  type: 'audio_chunk' | 'end_turn' | 'end_session' | 'save_entry';
  data?: string;  // base64 audio for audio_chunk
  saveOptions?: {
    asGuidedSession: boolean;
    sessionType?: GuidedSessionType;
  };
}

// Relay → Client messages
interface RelayMessage {
  type: 'audio_response' | 'transcript_delta' | 'session_saved' | 'error';
  data?: string;
  transcript?: string;
  entryId?: string;
}
```

### Deployment

```yaml
# cloudbuild.yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'gcr.io/$PROJECT_ID/voice-relay', './relay-server']
  - name: 'gcr.io/cloud-builders/gcloud'
    args:
      - 'run'
      - 'deploy'
      - 'voice-relay'
      - '--image=gcr.io/$PROJECT_ID/voice-relay'
      - '--platform=managed'
      - '--allow-unauthenticated'  # Auth handled in app
      - '--min-instances=0'
      - '--max-instances=10'
      - '--timeout=900'  # 15 min max session
      - '--memory=512Mi'
      - '--set-secrets=OPENAI_API_KEY=openai-api-key:latest'
```

---

## Milestone 2: Voice Conversation Modes

### Mode 1: Free Conversation (User-Controlled Save)

```
┌────────────────────────────────────────────────────────┐
│                  FREE CONVERSATION                      │
│                                                        │
│  User speaks naturally with AI                         │
│  ↓                                                     │
│  Conversation continues until user ends                │
│  ↓                                                     │
│  "Would you like to save this as a journal entry?"     │
│  ↓                                                     │
│  [Yes, save] [No, discard] [Edit first]               │
│                                                        │
│  If saved:                                             │
│  - Full transcript → Entry text                        │
│  - AI summarizes key points                            │
│  - Standard analysis pipeline runs                     │
└────────────────────────────────────────────────────────┘
```

### Mode 2: Guided Session (Auto-Save)

```
┌────────────────────────────────────────────────────────┐
│                  GUIDED SESSION                         │
│                                                        │
│  User selects session type                             │
│  ↓                                                     │
│  RAG context loaded (recent entries, patterns, goals)  │
│  ↓                                                     │
│  AI guides through structured prompts                  │
│  ↓                                                     │
│  Session completes with summary                        │
│  ↓                                                     │
│  Automatically saved as structured entry               │
│  - session_type: 'guided_morning_checkin'              │
│  - structured_responses: {...}                         │
│  - ai_summary: "..."                                   │
└────────────────────────────────────────────────────────┘
```

### Entry Schema Extension

```typescript
interface VoiceEntry extends Entry {
  source: 'voice_free' | 'voice_guided' | 'text';

  // For voice entries
  voiceMetadata?: {
    duration: number;           // seconds
    wordCount: number;
    sessionType?: GuidedSessionType;
    rawTranscript: string;      // Full conversation
    processedText: string;      // Cleaned/summarized for display
  };

  // For guided sessions
  guidedSession?: {
    type: GuidedSessionType;
    completedPrompts: string[];
    structuredResponses: Record<string, string>;
    sessionSummary: string;
  };
}
```

---

## Milestone 3: Guided Session Framework

### Session Types

```typescript
type GuidedSessionType =
  | 'morning_checkin'      // Start the day with intention
  | 'evening_reflection'   // Process the day
  | 'gratitude_practice'   // Three good things
  | 'goal_setting'         // Define and plan goals
  | 'emotional_processing' // CBT/ACT guided
  | 'stress_release'       // Anxiety/stress processing
  | 'weekly_review'        // Week in review
  | 'celebration'          // Acknowledge wins
  | 'situation_processing' // Work through specific situation
  | 'custom';              // User-defined
```

### Session Definition Structure

```typescript
interface GuidedSessionDefinition {
  id: GuidedSessionType;
  name: string;
  description: string;
  icon: string;
  estimatedMinutes: number;

  // When to suggest this session
  suggestWhen: {
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
    moodThreshold?: { below?: number; above?: number };
    patterns?: string[];  // e.g., ['low_streak', 'high_stress']
    dayOfWeek?: number[];
  };

  // RAG context to load
  contextNeeds: {
    recentEntries: number;      // Last N entries
    relevantGoals: boolean;
    openSituations: boolean;
    recurringPatterns: boolean;
    specificEntities?: string[]; // e.g., ['@goal:*', '@situation:*']
  };

  // Session flow
  prompts: GuidedPrompt[];

  // How to process the result
  outputProcessing: {
    summaryPrompt: string;
    extractSignals: boolean;
    therapeuticFramework?: 'cbt' | 'act' | 'general';
  };
}

interface GuidedPrompt {
  id: string;
  type: 'open' | 'rating' | 'choice' | 'reflection';
  prompt: string;

  // Dynamic prompt generation
  contextInjection?: {
    includeRecentMood?: boolean;
    includeOpenGoals?: boolean;
    includeYesterdayHighlight?: boolean;
    customRagQuery?: string;
  };

  // Conditional flow
  skipIf?: (responses: Record<string, any>, context: SessionContext) => boolean;
  followUp?: {
    condition: (response: string) => boolean;
    prompt: string;
  };
}
```

### Example: Morning Check-in Session

```typescript
const morningCheckin: GuidedSessionDefinition = {
  id: 'morning_checkin',
  name: 'Morning Check-in',
  description: 'Start your day with clarity and intention',
  icon: 'sunrise',
  estimatedMinutes: 5,

  suggestWhen: {
    timeOfDay: 'morning',
  },

  contextNeeds: {
    recentEntries: 3,
    relevantGoals: true,
    openSituations: true,
    recurringPatterns: false,
  },

  prompts: [
    {
      id: 'sleep_quality',
      type: 'open',
      prompt: "Good morning! How did you sleep last night, and how are you feeling as you start the day?",
    },
    {
      id: 'yesterday_followup',
      type: 'reflection',
      prompt: "Yesterday you mentioned {yesterdayHighlight}. How are you feeling about that today?",
      contextInjection: {
        includeYesterdayHighlight: true,
      },
      skipIf: (_, ctx) => !ctx.yesterdayHighlight,
    },
    {
      id: 'todays_intention',
      type: 'open',
      prompt: "What's one thing you'd like to focus on or accomplish today?",
      followUp: {
        condition: (response) => response.toLowerCase().includes('anxious') ||
                                  response.toLowerCase().includes('worried'),
        prompt: "I hear some concern in that. What's one small step you could take to feel more prepared?",
      },
    },
    {
      id: 'goal_checkin',
      type: 'reflection',
      prompt: "You've been working on {activeGoal}. Any thoughts on that today?",
      contextInjection: {
        includeOpenGoals: true,
      },
      skipIf: (_, ctx) => !ctx.activeGoals?.length,
    },
    {
      id: 'closing',
      type: 'open',
      prompt: "Anything else on your mind before we wrap up?",
    },
  ],

  outputProcessing: {
    summaryPrompt: `Summarize this morning check-in in 2-3 sentences,
                    highlighting the user's mood, intention for the day,
                    and any concerns or goals mentioned.`,
    extractSignals: true,
    therapeuticFramework: 'general',
  },
};
```

### Session Library (Best Practices)

```
/src/services/guided-sessions/
├── index.ts                    # Session manager
├── definitions/
│   ├── morning-checkin.ts
│   ├── evening-reflection.ts
│   ├── gratitude-practice.ts
│   ├── goal-setting.ts
│   ├── emotional-processing.ts
│   ├── stress-release.ts
│   ├── weekly-review.ts
│   ├── celebration.ts
│   └── situation-processing.ts
├── engine/
│   ├── sessionRunner.ts        # Orchestrates session flow
│   ├── promptRenderer.ts       # Injects RAG context into prompts
│   └── responseProcessor.ts    # Extracts structure from responses
└── suggestions/
    └── sessionSuggester.ts     # Recommends sessions based on context
```

---

## Milestone 4: RAG-Informed Conversations

### Context Injection Points

```typescript
interface ConversationContext {
  // Pre-loaded at session start
  recentEntries: Entry[];           // Last 5-10 entries
  relevantEntries: Entry[];         // RAG-retrieved based on time/patterns
  activeGoals: string[];            // Open @goal:* tags
  openSituations: string[];         // Ongoing @situation:* tags
  recentPatterns: Pattern[];        // Detected patterns
  moodTrajectory: MoodTrajectory;   // Recent mood trend

  // Dynamic during conversation
  mentionedEntities: string[];      // Entities mentioned this session
  emotionalState: string;           // Detected from voice/content
}
```

### System Prompt Template

```typescript
const buildSystemPrompt = (context: ConversationContext, sessionType?: GuidedSessionType): string => {
  return `You are a supportive journaling companion helping the user reflect on their thoughts and experiences.

## User Context

### Recent Mood
${context.moodTrajectory.description}
${context.moodTrajectory.trend === 'declining' ?
  'Note: User\'s mood has been declining. Be especially supportive.' : ''}

### Active Goals
${context.activeGoals.length > 0 ?
  context.activeGoals.map(g => `- ${g}`).join('\n') :
  'No active goals mentioned recently.'}

### Open Situations
${context.openSituations.length > 0 ?
  context.openSituations.map(s => `- ${s}`).join('\n') :
  'No ongoing situations.'}

### Recent Entries Summary
${context.recentEntries.slice(0, 3).map(e =>
  `- ${e.effectiveDate}: ${e.title} (mood: ${e.analysis?.mood_score?.toFixed(1) || 'unknown'})`
).join('\n')}

### Relevant Past Context
${context.relevantEntries.map(e =>
  `- ${e.effectiveDate}: "${e.text.substring(0, 100)}..."`
).join('\n')}

## Guidelines
- Reference past entries naturally: "You mentioned last week that..."
- Follow up on open situations: "How did that meeting go?"
- Acknowledge patterns: "I notice you often feel this way on Mondays"
- Be warm but not sycophantic
- ${sessionType ? `This is a ${sessionType} session. Follow the structured flow.` :
                  'This is a free conversation. Let the user guide the direction.'}

## CRITICAL: Voice-Specific Instructions
- Keep responses SHORT: 2-3 sentences maximum unless asked for more
- Do NOT use markdown formatting (no bullets, no headers, no **bold**)
- Do NOT use lists - speak in flowing sentences
- Speak conversationally, as if talking to a friend
- Use contractions (don't, I'm, you're) - avoid formal language
- Pause naturally between thoughts using commas and periods
- Ask ONE question at a time, then wait for response
- Avoid jargon and clinical terms unless the user uses them first
`;
};
```

### RAG via Function Calling (Recommended Approach)

**Problem with Manual Injection**: Firestore + Vector Search takes 200-500ms. Synchronous RAG queries during conversation cause noticeable lag.

**Solution**: Let the model decide when it needs memory via OpenAI Function Calling.

```typescript
// Define the get_memory tool for OpenAI
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_memory',
      description: 'Retrieve relevant past journal entries when the user references something from their history. Use this when they mention past events, people, goals, or say things like "remember when" or "like last time".',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search for in past entries',
          },
          date_hint: {
            type: 'string',
            description: 'Approximate date reference if mentioned (e.g., "last Tuesday", "two weeks ago")',
          },
          entity_type: {
            type: 'string',
            enum: ['person', 'goal', 'situation', 'event', 'place', 'any'],
            description: 'Type of entity to search for',
          },
        },
        required: ['query'],
      },
    },
  },
];

// Handle tool calls in the Relay Server
const handleToolCall = async (toolCall: ToolCall, userId: string): Promise<string> => {
  if (toolCall.function.name === 'get_memory') {
    const args = JSON.parse(toolCall.function.arguments);

    const results = await hybridRagSearch({
      userId,
      query: args.query,
      entityFilter: args.entity_type !== 'any' ? `@${args.entity_type}:*` : undefined,
      dateHint: args.date_hint,
      limit: 3,
    });

    if (results.length === 0) {
      return 'No relevant entries found.';
    }

    return results.map(e =>
      `[${e.effectiveDate}] ${e.title}: "${e.text.substring(0, 200)}..."`
    ).join('\n\n');
  }

  return 'Unknown tool';
};
```

**Flow**:
```
User: "I'm feeling like I did last Tuesday."
  ↓
Model recognizes need for memory
  ↓
Model calls: get_memory(query: "how user felt", date_hint: "last Tuesday")
  ↓
Relay pauses audio output
  ↓
Relay queries Vector DB (200-500ms)
  ↓
Returns: "[2024-01-16] Rough day: 'Had that fight with mom...'"
  ↓
Model resumes with context: "Ah, that was the day you had the difficult conversation with your mom..."
```

**Benefits**:
- No synchronous lag during normal conversation
- Model decides when context is needed (smarter than keyword matching)
- Cleaner architecture - no manual injection loops
- Works with both Realtime API and Standard mode

### Prefetching Strategy

Still prefetch common context at session start to minimize tool calls:

```typescript
const prefetchSessionContext = async (userId: string, sessionType: GuidedSessionType) => {
  const [recentEntries, activeGoals, openSituations, moodTrajectory] = await Promise.all([
    getRecentEntries(userId, 5),
    getActiveGoals(userId),
    getOpenSituations(userId),
    getMoodTrajectory(userId),
  ]);

  return {
    recentEntries,
    activeGoals,
    openSituations,
    moodTrajectory,
    // Include in system prompt - model has this without needing tool calls
  };
};
```

---

## Milestone 5: UI/UX Implementation

### New Components

```
/src/components/voice/
├── VoiceSessionLauncher.jsx      # Entry point - choose mode
├── GuidedSessionPicker.jsx       # Grid of session types
├── VoiceConversation.jsx         # Updated RealtimeConversation
├── SessionProgress.jsx           # Progress through guided prompts
├── TranscriptPreview.jsx         # Live transcript display
├── SaveEntryModal.jsx            # Post-session save options
└── VoiceSessionHistory.jsx       # Past voice sessions
```

### Voice Session Launcher

```jsx
const VoiceSessionLauncher = () => {
  const [mode, setMode] = useState<'select' | 'free' | 'guided'>(null);
  const { suggestedSessions } = useSuggestedSessions();

  return (
    <div className="voice-launcher">
      <h2>Start a Voice Session</h2>

      <div className="mode-selection">
        <button onClick={() => setMode('free')}>
          <MessageCircle />
          <span>Free Conversation</span>
          <small>Talk openly, save if you want</small>
        </button>

        <button onClick={() => setMode('guided')}>
          <Compass />
          <span>Guided Session</span>
          <small>Structured reflection</small>
        </button>
      </div>

      {suggestedSessions.length > 0 && (
        <div className="suggestions">
          <h3>Suggested for you</h3>
          {suggestedSessions.map(session => (
            <SessionCard
              key={session.id}
              session={session}
              onSelect={() => startGuidedSession(session.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
```

### Guided Session Flow

```jsx
const GuidedSession = ({ sessionType }) => {
  const { definition, context, currentPrompt, advance, responses } =
    useGuidedSession(sessionType);
  const { isConnected, speak, transcript } = useVoiceRelay();

  // Auto-advance when user finishes speaking
  useEffect(() => {
    if (transcript.userFinished && currentPrompt) {
      responses[currentPrompt.id] = transcript.lastUtterance;
      advance();
    }
  }, [transcript.userFinished]);

  return (
    <div className="guided-session">
      <SessionProgress
        current={currentPrompt?.id}
        total={definition.prompts.length}
      />

      <div className="current-prompt">
        <p>{renderPrompt(currentPrompt, context)}</p>
      </div>

      <TranscriptPreview transcript={transcript} />

      <VoiceControls
        onEnd={() => saveGuidedEntry(responses)}
      />
    </div>
  );
};
```

---

## Milestone 6: Entry Processing Pipeline Updates

### Voice Entry Processing

```typescript
const processVoiceEntry = async (
  transcript: string,
  userId: string,
  options: {
    source: 'voice_free' | 'voice_guided';
    sessionType?: GuidedSessionType;
    structuredResponses?: Record<string, string>;
    duration: number;
  }
): Promise<Entry> => {

  // 1. Clean transcript (remove filler words, false starts)
  const cleanedTranscript = await cleanTranscript(transcript);

  // 2. For guided sessions, use structured responses
  // For free conversations, summarize the conversation
  const entryText = options.source === 'voice_guided'
    ? await summarizeGuidedSession(options.structuredResponses, options.sessionType)
    : await summarizeFreeConversation(cleanedTranscript);

  // 3. Run through standard analysis pipeline
  const analysis = await analyzeEntry(entryText, userId);

  // 4. Generate embedding
  const embedding = await generateEmbedding(entryText);

  // 5. Extract signals
  const signals = await extractSignals(entryText, analysis);

  // 6. Build entry object
  const entry: VoiceEntry = {
    id: generateId(),
    text: entryText,
    source: options.source,
    voiceMetadata: {
      duration: options.duration,
      wordCount: transcript.split(/\s+/).length,
      sessionType: options.sessionType,
      rawTranscript: transcript,
      processedText: entryText,
    },
    guidedSession: options.source === 'voice_guided' ? {
      type: options.sessionType,
      structuredResponses: options.structuredResponses,
      sessionSummary: entryText,
    } : undefined,
    analysis,
    embedding,
    createdAt: new Date(),
    effectiveDate: new Date(),
    // ... other standard fields
  };

  // 7. Save entry and signals
  await saveEntry(userId, entry);
  await saveSignals(userId, entry.id, signals);

  return entry;
};
```

---

## Implementation Phases

### Phase 1: Secure Relay Server (Week 1-2)
- [ ] Set up Cloud Run project
- [ ] Implement WebSocket server with Firebase Auth
- [ ] Create OpenAI Realtime API proxy
- [ ] Implement transcript buffering
- [ ] Deploy and test connectivity
- [ ] Update client to connect to relay

### Phase 2: Basic Voice Reconnection (Week 2-3)
- [ ] Update `RealtimeConversation.jsx` to use relay
- [ ] Implement free conversation mode
- [ ] Add post-conversation save dialog
- [ ] Process voice transcripts as entries
- [ ] Test end-to-end flow

### Phase 3: Guided Session Framework (Week 3-4)
- [ ] Create session definition schema
- [ ] Implement 3 core sessions:
  - Morning Check-in
  - Evening Reflection
  - Gratitude Practice
- [ ] Build session runner engine
- [ ] Create `GuidedSessionPicker` UI
- [ ] Implement session progress tracking

### Phase 4: RAG Integration (Week 4-5)
- [ ] Create `getSessionContext` Cloud Function
- [ ] Implement dynamic prompt rendering with context
- [ ] Add real-time entity detection during conversation
- [ ] Build context injection into system prompts
- [ ] Test RAG-informed responses

### Phase 5: Full Session Library (Week 5-6)
- [ ] Implement remaining session types:
  - Goal Setting
  - Emotional Processing (CBT/ACT)
  - Stress Release
  - Weekly Review
  - Celebration
  - Situation Processing
- [ ] Add session suggestion algorithm
- [ ] Build session history view
- [ ] Polish UI/UX

### Phase 6: Testing & Refinement (Week 6-7)
- [ ] End-to-end testing
- [ ] Voice quality optimization
- [ ] Latency optimization
- [ ] Error handling and edge cases
- [ ] User feedback integration

---

## Resilience & State Management

### The State Problem

**Risk**: Cloud Run instances can scale down or be replaced during deployments. In-memory session state (transcript buffer, context) would be lost.

**Scenario**: User talks for 10 minutes. Network drops at minute 9. They reconnect to a different instance. Buffer is gone.

### Solution: Hybrid State with Client Persistence

#### Phase 1 (MVP): In-Memory + Client Backup

```typescript
// Relay Server: Stream transcript deltas to client in real-time
const onTranscriptUpdate = (delta: string) => {
  session.transcriptBuffer += delta;

  // CRITICAL: Send delta to client for local persistence
  ws.send(JSON.stringify({
    type: 'transcript_delta',
    delta,
    timestamp: Date.now(),
    sequenceId: session.sequenceId++,
  }));
};
```

```typescript
// Client: Persist transcript locally as backup
const useTranscriptPersistence = (sessionId: string) => {
  const [transcript, setTranscript] = useState('');

  const handleDelta = (delta: string, sequenceId: number) => {
    setTranscript(prev => prev + delta);

    // Persist to IndexedDB/AsyncStorage
    await localDB.transcripts.put({
      sessionId,
      content: transcript + delta,
      sequenceId,
      updatedAt: Date.now(),
    });
  };

  // On reconnect, send local transcript to server
  const handleReconnect = async (ws: WebSocket) => {
    const local = await localDB.transcripts.get(sessionId);
    if (local) {
      ws.send(JSON.stringify({
        type: 'restore_transcript',
        content: local.content,
        sequenceId: local.sequenceId,
      }));
    }
  };

  return { transcript, handleDelta, handleReconnect };
};
```

#### Phase 2 (Production): Redis State Store

```typescript
// Add Redis for cross-instance state sharing
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });

interface SessionState {
  userId: string;
  transcript: string;
  context: ConversationContext;
  sequenceId: number;
  lastActivity: number;
  mode: ProcessingMode;
}

const sessionStore = {
  async save(sessionId: string, state: SessionState) {
    await redis.setEx(
      `session:${sessionId}`,
      900,  // 15 min TTL
      JSON.stringify(state)
    );
  },

  async get(sessionId: string): Promise<SessionState | null> {
    const data = await redis.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  },

  async delete(sessionId: string) {
    await redis.del(`session:${sessionId}`);
  },
};
```

**Result**: If Cloud Run instance dies, user reconnects, new instance pulls state from Redis. If Redis is unavailable, fall back to client's local transcript.

### Data Loss Prevention Checklist

- [ ] Transcript streamed to client in real-time via `transcript_delta`
- [ ] Client persists transcript to IndexedDB/AsyncStorage
- [ ] Client can restore session from local backup on reconnect
- [ ] Phase 2: Redis stores session state across instances
- [ ] Sequence IDs prevent duplicate/out-of-order processing
- [ ] 15-minute session TTL auto-cleans abandoned sessions

---

## Security Checklist

- [ ] API keys never leave server
- [ ] Firebase Auth validated on every WebSocket connection
- [ ] Session isolation between users
- [ ] Rate limiting per user
- [ ] Audio data encrypted in transit (WSS)
- [ ] Transcripts encrypted at rest
- [ ] Session timeout after inactivity
- [ ] Audit logging for voice sessions
- [ ] CORS properly configured
- [ ] No PII in logs
- [ ] Usage limits enforced (daily cost cap)

---

## Cost Considerations & Hybrid Protocol

### The Cost Reality

| API | Input Cost | Output Cost | Total/min | Use Case |
|-----|------------|-------------|-----------|----------|
| **OpenAI Realtime** | ~$0.06/min | ~$0.24/min | **~$0.30/min** | Interactive conversation |
| **Whisper + GPT-4o + TTS** | $0.006/min | ~$0.02/response | **~$0.03/min** | Dictation/reflection |

**Critical Insight**: A 10-minute Morning Check-in via Realtime API costs $3-5. The same session via Standard Pipeline costs ~$0.30.

### Hybrid Protocol Architecture

The Relay Server MUST support two modes, selected by `sessionType`:

```typescript
type ProcessingMode = 'realtime' | 'standard';

const getProcessingMode = (sessionType: GuidedSessionType | 'free'): ProcessingMode => {
  // Use Realtime API only when interactivity matters
  const realtimeSessions: GuidedSessionType[] = [
    'emotional_processing',  // Needs back-and-forth for CBT/ACT
    'situation_processing',  // Exploratory conversation
    'stress_release',        // Real-time support needed
  ];

  if (sessionType === 'free') return 'realtime';  // User chose conversation
  return realtimeSessions.includes(sessionType) ? 'realtime' : 'standard';
};
```

### Standard Pipeline Flow (Default for Guided Sessions)

```
┌─────────────────────────────────────────────────────────────────┐
│                    STANDARD MODE (Cost-Optimized)               │
│                                                                 │
│  Client records audio locally (chunked)                         │
│  ↓                                                              │
│  Send to Relay → Buffer complete utterance                      │
│  ↓                                                              │
│  Whisper API transcription ($0.006/min)                         │
│  ↓                                                              │
│  GPT-4o generates response (with RAG context)                   │
│  ↓                                                              │
│  TTS generates audio response                                   │
│  ↓                                                              │
│  Stream audio back to client                                    │
│                                                                 │
│  Latency: 2-4 seconds per turn (acceptable for guided prompts)  │
│  Cost: ~10x cheaper than Realtime                               │
└─────────────────────────────────────────────────────────────────┘
```

### Realtime Mode Flow (For True Conversations)

```
┌─────────────────────────────────────────────────────────────────┐
│                    REALTIME MODE (Interactive)                  │
│                                                                 │
│  Full duplex WebSocket to OpenAI Realtime API                   │
│  ↓                                                              │
│  Sub-second response latency                                    │
│  ↓                                                              │
│  Natural interruption support                                   │
│  ↓                                                              │
│  True conversational feel                                       │
│                                                                 │
│  Latency: <500ms                                                │
│  Cost: ~$0.30/min                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Cost Controls (CRITICAL)

```typescript
interface UsageLimits {
  maxSessionDuration: 900,        // 15 min hard limit
  maxDailyRealtimeMinutes: 10,    // ~$3/day max for Realtime
  maxDailyStandardMinutes: 60,    // ~$1.80/day max for Standard
  maxDailyCostUSD: 5.00,          // Absolute daily cap
}

// Track in Firestore per user
interface UserUsage {
  date: string;
  realtimeMinutes: number;
  standardMinutes: number;
  estimatedCostUSD: number;
}

// Enforce in Relay Server
const checkUsageLimits = async (userId: string, mode: ProcessingMode): Promise<boolean> => {
  const usage = await getUsage(userId);

  if (usage.estimatedCostUSD >= limits.maxDailyCostUSD) {
    return false;  // Downgrade to text-only
  }

  if (mode === 'realtime' && usage.realtimeMinutes >= limits.maxDailyRealtimeMinutes) {
    return false;  // Suggest Standard mode instead
  }

  return true;
};
```

### Component Costs

| Component | Estimated Cost |
|-----------|---------------|
| Cloud Run (WebSocket relay) | ~$5-20/mo based on usage |
| OpenAI Realtime API | ~$0.30/min (use sparingly) |
| OpenAI Whisper | ~$0.006/min (default) |
| OpenAI GPT-4o | ~$0.01-0.03/response |
| OpenAI TTS | ~$0.015/1K chars |
| Firestore reads/writes | Existing quota |
| Redis (Memorystore) | ~$25/mo for smallest instance |

**Recommendation**: Default to Standard mode. Realtime only for explicitly interactive sessions.

---

## Success Metrics

1. **Security**: Zero API key exposures
2. **Reliability**: <1% session failure rate
3. **Latency**: <500ms voice response time
4. **Adoption**: 30% of entries from voice within 3 months
5. **Completion**: 80%+ guided session completion rate
6. **Quality**: Voice entries have comparable analysis depth to text

---

## Open Questions

1. **Offline Support**: Should we support offline voice recording with deferred processing?
2. **Voice Profiles**: Should the AI voice/personality be customizable?
3. **Multi-language**: Support transcription in other languages?
4. **Session Sharing**: Allow sharing guided session templates?
5. **Therapist Mode**: Professional-guided sessions for therapy use cases?

---

## Implementation Notes & Best Practices

### Relay Server Setup

**Skip Docker for MVP** - Use source deployment:
```bash
# Deploy directly from source (Google builds container automatically)
cd relay-server
gcloud run deploy voice-relay \
  --source . \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 900 \
  --memory 512Mi \
  --set-secrets OPENAI_API_KEY=openai-api-key:latest
```

### WebSocket Library Choice

Use `ws` over `socket.io` for the relay:
- Lighter weight (~50KB vs ~300KB)
- Direct WebSocket protocol (better for proxying to OpenAI)
- No Socket.IO overhead/fallbacks needed

```typescript
// relay-server/package.json
{
  "dependencies": {
    "ws": "^8.16.0",
    "express": "^4.18.2",
    "firebase-admin": "^12.0.0"
  }
}
```

### Schema Validation with Zod

Use Zod for GuidedSessionDefinition validation:

```typescript
import { z } from 'zod';

const GuidedPromptSchema = z.object({
  id: z.string(),
  type: z.enum(['open', 'rating', 'choice', 'reflection']),
  prompt: z.string(),
  contextInjection: z.object({
    includeRecentMood: z.boolean().optional(),
    includeOpenGoals: z.boolean().optional(),
    includeYesterdayHighlight: z.boolean().optional(),
    customRagQuery: z.string().optional(),
  }).optional(),
});

const GuidedSessionDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  estimatedMinutes: z.number().positive(),
  prompts: z.array(GuidedPromptSchema).min(1),
  outputProcessing: z.object({
    summaryPrompt: z.string(),
    extractSignals: z.boolean(),
    therapeuticFramework: z.enum(['cbt', 'act', 'general']).optional(),
  }),
});

// Validate session definitions at build time
export const validateSessionDefinition = (def: unknown) => {
  return GuidedSessionDefinitionSchema.parse(def);
};
```

### Environment Configuration

```bash
# .env.local (client)
VITE_VOICE_RELAY_URL=wss://voice-relay-xxxxx-uc.a.run.app

# Cloud Run secrets
gcloud secrets create openai-api-key --data-file=./openai-key.txt
gcloud secrets create firebase-service-account --data-file=./firebase-sa.json
```

### Testing Strategy

1. **Unit Tests**: Session definitions, prompt rendering, transcript cleaning
2. **Integration Tests**: Relay auth flow, OpenAI proxy, Firestore operations
3. **E2E Tests**: Full voice session flow with mock audio
4. **Load Tests**: Concurrent WebSocket connections, session limits

```typescript
// Example: Test session definition validity
describe('GuidedSessionDefinitions', () => {
  const definitions = [morningCheckin, eveningReflection, gratitudePractice];

  definitions.forEach(def => {
    it(`${def.id} should have valid schema`, () => {
      expect(() => validateSessionDefinition(def)).not.toThrow();
    });

    it(`${def.id} should have at least one prompt`, () => {
      expect(def.prompts.length).toBeGreaterThan(0);
    });
  });
});
```

---

## Next Steps

1. Review and approve this architecture
2. Set up Cloud Run project and secrets
3. Begin Phase 1 implementation
4. Create tracking issues for each phase
