# EchoVault Entry Processing Pipeline

## System Process Overview

EchoVault is a mental health journaling platform with sophisticated entry processing. This document provides comprehensive documentation of the entry processing pipeline, starting with a high-level overview of all system processes.

---

## All System Processes Summary

### Entry Processing Pipeline (7 Phases)

| Phase | Name | Location | Purpose |
|-------|------|----------|---------|
| 1 | Entry Capture | Client-side | Text/voice input capture and initial processing |
| 2 | Context Enrichment | Client-side (parallel) | Health, environment, and temporal context gathering |
| 3 | Safety Screening | Client-side | Regex-based crisis keyword detection |
| 4 | Local Analysis | Client-side (native only) | VADER sentiment scoring (~22ms) |
| 5 | Persistence | Firestore | Save entry with `analysisStatus: 'pending'` |
| 6 | Server-Side Processing | Cloud Functions | Embeddings, classification, therapeutic analysis |
| 7 | Signal Extraction | Cloud Functions | Extract feelings, plans, and insights |

### Background Processes

| Process | Schedule | Purpose |
|---------|----------|---------|
| Entry Post-Processing | After entry save | Refresh caches, invalidate patterns |
| Memory Extraction | Firestore trigger | Build knowledge graph of people/events |
| Memory Decay | Scheduled | Archive stale data after 6 months |
| Burnout Risk Monitoring | Firestore trigger | Compute risk scores, trigger shelter mode |

### Nexus Insight Engine (4 Layers)

| Layer | Components | Purpose |
|-------|------------|---------|
| Layer 1 | patternDetector, threadManager, somaticExtractor | Pattern detection |
| Layer 2 | stateDetector, baselineManager | State detection |
| Layer 3 | synthesizer, crossThreadDetector, beliefDissonance, counterfactual | Cross-thread analysis |
| Layer 4 | interventionTracker, recommendationEngine | Recommendations |

### Voice Relay Server (Cloud Run)

| Mode | API | Latency | Use Case |
|------|-----|---------|----------|
| Realtime | OpenAI Realtime API | <100ms | Live conversations |
| Standard | Whisper + GPT-4o + TTS | ~2-3s | Turn-based fallback |
| Guided | Structured prompts | Variable | Therapeutic exercises |

### Scheduled Tasks

| Task | Schedule | Purpose |
|------|----------|---------|
| Daily Pattern Refresh | 03:00 AM Pacific | Refresh insight indices |
| Weekly Digest Generation | Monday 06:00 AM Eastern | Generate weekly summaries |
| Memory Decay | Periodic | Clean stale memory data |
| Background Sync | Every 1 minute | Sync offline entries |

### Firestore Triggers

| Trigger | Event | Actions |
|---------|-------|---------|
| onEntryCreate | Entry created | Embeddings, memory extraction, burnout check |
| onEntryUpdate | Entry updated | Pattern index refresh |
| onSignalWrite | Signal written | State validation, history logging |

### Offline/Sync System

| Component | Storage | Purpose |
|-----------|---------|---------|
| Offline Store | IndexedDB | Local persistence for pending entries |
| Offline Manager | Memory + IndexedDB | Queue management and sync |
| Sync Orchestrator | Memory | Debouncing, conflict resolution |

### Health Integration

| Source | Platform | Data Types |
|--------|----------|------------|
| HealthKit | iOS | Sleep, HRV, activity, workouts |
| Google Fit | Android | Sleep, activity, heart rate |
| Whoop | All | Recovery, strain, sleep, HRV |

### Anticipatory Events System

| Component | Purpose |
|-----------|---------|
| Future Event Monitor | Detect upcoming events in entries |
| Morning Check-ins | Pre-event anxiety assessment |
| Evening Reflections | Post-event outcome comparison |

---

## Data Flow Summary

```
User Input (Text/Voice)
    │
    ▼
[Phase 1-5: Client-side capture → context enrichment → safety → local analysis → persistence]
    │
    ▼
Firestore Save → Triggers 3 simultaneous Cloud Functions
    ├─ onEntryCreate (embedding generation)
    ├─ onEntryCreateMemoryExtraction (memory building)
    └─ onEntryCreateBurnoutCheck (risk assessment)
    │
    ▼
Client-side async calls
    ├─ analyzeJournalEntry() → Title, framework, insights
    ├─ processEntrySignals() → Goal/pattern/insight extraction
    └─ runEntryPostProcessing() → Cache invalidation
    │
    ▼
Nexus Orchestrator (on-demand or scheduled)
    ├─ Layer 1: Pattern detection
    ├─ Layer 2: State detection
    ├─ Layer 3: Cross-thread insights
    └─ Layer 4: Recommendations
    │
    ▼
UI Update with enriched entry + insights + signals
```

---

# Phase 1: Entry Capture

Phase 1 handles all aspects of capturing user input, whether text or voice, and preparing it for processing through the pipeline.

## Overview

Entry capture supports two input modalities:
- **Text Input**: Direct text entry via textarea component
- **Voice Input**: Audio recording with real-time transcription and tone analysis

```
┌─────────────────────────────────────────────────────────────────┐
│                        ENTRY CAPTURE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   TEXT PATH                      VOICE PATH                      │
│   ─────────                      ──────────                      │
│   TextInput.jsx                  VoiceRecorder.jsx               │
│        │                              │                          │
│        │                              ▼                          │
│        │                    WebSocket Connection                 │
│        │                    (Voice Relay Server)                 │
│        │                              │                          │
│        │                    ┌─────────┴─────────┐                │
│        │                    │                   │                │
│        │              Realtime Mode      Standard Mode           │
│        │              (OpenAI API)       (Whisper+TTS)           │
│        │                    │                   │                │
│        │                    └─────────┬─────────┘                │
│        │                              │                          │
│        │                        Transcription                    │
│        │                              │                          │
│        │                    Voice Tone Analysis                  │
│        │                        (Gemini)                         │
│        │                              │                          │
│        └──────────────┬───────────────┘                          │
│                       │                                          │
│                       ▼                                          │
│              Entry Object Creation                               │
│                       │                                          │
│                       ▼                                          │
│                 To Phase 2                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Text Input Capture

### 1.1 UI Component

**Location**: `src/components/input/TextInput.jsx`

The TextInput component provides a fixed bottom modal with a controlled textarea for text entry.

```jsx
// Component structure (Lines 15-21)
<textarea
  value={val}
  onChange={e => setVal(e.target.value)}
  autoFocus
  className="h-32 border-warm-200 focus:ring-2 focus:ring-primary-500"
/>
```

**Key Features**:
- Fixed bottom modal with animated entry/exit (Framer Motion)
- 32-line textarea with 3px padding
- Auto-focused on mount
- Disabled submit when empty or processing

### 1.2 Form State Management

**Location**: `src/App.jsx` (Lines 1222-1271)

**Main Entry Point**: `saveEntry(textInput, voiceTone = null)`

**Processing Flow**:

1. **Crisis Detection** (Lines 1233-1238):
   ```javascript
   const hasCrisis = checkCrisisKeywords(textInput);
   if (hasCrisis) {
     setPendingEntry({ text: textInput, safety: true });
     openCrisisModal();
     return;
   }
   ```

2. **Temporal Context Detection** (Lines 1240-1255):
   ```javascript
   const temporalResult = await Promise.race([
     detectTemporalContext(textInput),
     new Promise((_, reject) => setTimeout(() => reject('timeout'), 45000))
   ]);
   // Returns: { detected, effectiveDate, reference, confidence, reasoning }
   ```

3. **Reply Context Handling** (Lines 707-718):
   ```javascript
   if (replyContext) {
     finalText = `[Replying to: "${replyContext}"]\n\n${textInput}`;
   }
   ```

### 1.3 Text Validation

**Location**: `src/services/analysis/entryProcessor.js` (Lines 57-59)

**Validation Rules**:
- **Minimum**: Non-empty text required (`textToAnalyze.trim().length > 0`)
- **Maximum**: No hard limit; constrained by Cloud Function timeouts

**Special Formatting**:
- Reply prefix: `[Replying to: "..."]` prepended with double newline
- Filler word removal (from transcriptions): `um, uh, like, you know, so, well, actually, basically, literally`

### 1.4 Base Entry Object

**Location**: `src/App.jsx` (Lines 715-726)

```javascript
const baseEntry = {
  text: finalText,
  transcriptionText: entryData.transcriptionText || null,
  healthContext: entryData.healthContext || null,
  environmentContext: entryData.environmentContext || null,
  voiceTone: entryData.voiceTone || null,
  createdAt: new Date().toISOString(),
  effectiveDate: effectiveDate.toISOString(),
  platform: Capacitor.getPlatform()
};
```

---

## 2. Voice Input Capture

### 2.1 Voice Recording Component

**Location**: `src/components/input/VoiceRecorder.jsx`

**Audio Capture Configuration** (Lines 39-46):

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    sampleRate: 24000,        // 24kHz (OpenAI Realtime standard)
    channelCount: 1,          // Mono audio
    echoCancellation: true,   // AEC enabled
    noiseSuppression: true,   // NS enabled
  },
});

const mime = MediaRecorder.isTypeSupported("audio/webm")
  ? "audio/webm"
  : "audio/mp4";

const recorder = new MediaRecorder(stream, {
  mimeType: mime,
  audioBitsPerSecond: 16000  // 16 kbps
});
```

**Recording State Machine**:
| State | Type | Purpose |
|-------|------|---------|
| `rec` | boolean | Recording active flag |
| `secs` | number | Elapsed seconds counter |
| `timer` | ref | Interval for clock updates (1000ms) |

### 2.2 Audio Format & Quality

**Supported Formats**:
| Format | Priority | Codec |
|--------|----------|-------|
| `audio/webm` | Primary | Opus |
| `audio/mp4` | Fallback | AAC |
| `audio/wav` | Fallback | PCM |

**Quality Settings**:
| Parameter | Value | Notes |
|-----------|-------|-------|
| Sample Rate | 24,000 Hz | OpenAI Realtime standard |
| Channels | 1 (mono) | Speech optimized |
| Bitrate | 16 kbps | Compressed |
| Bit Depth | 16-bit | When converted to PCM |

### 2.3 Voice Activity Detection (VAD)

**Location**: `relay-server/src/relay/realtimeProxy.ts` (Lines 63-68)

**OpenAI Realtime VAD Configuration**:

```typescript
turn_detection: {
  type: 'server_vad',           // Server-side VAD
  threshold: 0.5,               // Sensitivity (0-1)
  prefix_padding_ms: 300,       // Pre-speech capture
  silence_duration_ms: 500,     // End-of-turn silence
}
```

**VAD Behavior**:
- Automatically detects speech start
- Captures 300ms before actual speech onset
- Ends turn after 500ms of silence
- No manual turn management required

**Speech Events** (Lines 126-132):
```typescript
case 'input_audio_buffer.speech_started':
  // User started speaking
  break;

case 'input_audio_buffer.speech_stopped':
  // User stopped speaking - trigger response
  break;
```

### 2.4 Audio Streaming Implementation

**Chunk-Based Recording** (VoiceRecorder.jsx Lines 128-129):

```javascript
recorder.start(1000);  // 1-second timeslice
```

**Per-Chunk Handler** (Lines 49-54):

```javascript
recorder.ondataavailable = e => {
  if (e.data && e.data.size > 0) {
    chunks.push(e.data);
    console.log('[VoiceRecorder] Chunk received:', e.data.size, 'bytes');
  }
};
```

**WebSocket Streaming** (useVoiceRelay.js Lines 298-325):

```javascript
// ScriptProcessor for real-time audio
const processor = audioContext.createScriptProcessor(4096, 1, 1);

processor.onaudioprocess = (event) => {
  const inputData = event.inputBuffer.getChannelData(0);

  // Convert Float32 to Int16 PCM
  const pcmData = new Int16Array(inputData.length);
  for (let i = 0; i < inputData.length; i++) {
    pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
  }

  // Encode and send
  const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
  wsRef.current.send(JSON.stringify({
    type: 'audio_chunk',
    data: base64,
  }));
};
```

### 2.5 Buffer Management

**Buffer Architecture**:

| Buffer | Location | Purpose | Limit |
|--------|----------|---------|-------|
| Audio Context | Client | ScriptProcessor chunks | 4096 samples |
| Session Audio | Relay Server | Current turn audio | 50MB max |
| Full Session | Relay Server | All audio for tone analysis | 50MB max |
| Transcript | Client | Accumulated transcript | localStorage |

**Session Manager Buffers** (sessionManager.ts Lines 151-152):

```typescript
interface SessionState {
  audioBuffer: Buffer[];        // Current turn
  fullSessionAudio: Buffer[];   // All audio for analysis
}
```

**Transcript Persistence** (useVoiceRelay.js Lines 172-179):

```javascript
localStorage.setItem(`voice_transcript_${sessionId}`, JSON.stringify({
  content: localTranscriptRef.current,
  sequenceId: sequenceIdRef.current,
}));
```

---

## 3. Voice Relay Server Integration

### 3.1 Server Architecture

**Location**: `relay-server/src/index.ts`

**Deployment**: Google Cloud Run

**Endpoints**:
| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `/voice` | WebSocket | Real-time voice conversations |
| `/health` | HTTP GET | Health check for load balancer |

### 3.2 WebSocket Connection Setup

**Client-Side Connection** (useVoiceRelay.js Lines 60-90):

```javascript
const connect = async (sessionType = 'free', requestedMode = 'realtime') => {
  const token = await user.getIdToken(true);
  const wsUrl = `${VOICE_RELAY_URL}?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'start_session',
      mode: requestedMode,
      sessionType,
    }));
  };
};
```

**Server-Side Handler** (index.ts Lines 280-315):

```typescript
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  const authResult = await verifyToken(token);
  if (!authResult.success) {
    ws.close(4002, 'Invalid authentication');
    return;
  }

  const userId = authResult.userId;
  authenticatedConnections.set(ws, userId);
});
```

### 3.3 Server Configuration

**Location**: `relay-server/src/config/index.ts`

```typescript
export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  realtimeModel: 'gpt-4o-realtime-preview-2024-12-17',
  realtimeVoice: 'alloy',
  maxSessionDurationMs: 15 * 60 * 1000,     // 15 minutes
  sessionTimeoutMs: 5 * 60 * 1000,          // 5 min inactivity
} as const;
```

### 3.4 Authentication Flow

**Token Lifecycle**:

```
┌─────────────┐    getIdToken()    ┌─────────────┐
│   Client    │ ─────────────────► │  Firebase   │
└─────────────┘                    └─────────────┘
       │                                  │
       │ token in query string            │
       ▼                                  │
┌─────────────┐   verifyIdToken()  ┌─────────────┐
│   Relay     │ ◄──────────────────│  Firebase   │
│   Server    │                    │   Admin     │
└─────────────┘                    └─────────────┘
```

**Token Verification** (auth/firebase.ts Lines 40-55):

```typescript
export const verifyToken = async (token: string): Promise<AuthResult> => {
  try {
    const decodedToken = await auth.verifyIdToken(token);
    return { success: true, userId: decodedToken.uid };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
```

**Token Refresh** (useVoiceRelay.js Lines 103-115):

```javascript
// Refresh every 50 minutes (tokens expire at 60 min)
tokenRefreshIntervalRef.current = setInterval(async () => {
  const newToken = await auth.currentUser?.getIdToken(true);
  if (newToken && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'token_refresh',
      token: newToken,
    }));
  }
}, 50 * 60 * 1000);
```

### 3.5 Message Protocol

**Client → Server Messages**:

| Type | Fields | Purpose |
|------|--------|---------|
| `start_session` | mode, sessionType | Initialize session |
| `audio_chunk` | data (base64) | Send audio data |
| `end_turn` | - | Signal end of user turn |
| `end_session` | saveOptions | Close and optionally save |
| `token_refresh` | token | Refresh authentication |
| `restore_transcript` | content, sequenceId | Reconnection recovery |

**Server → Client Messages**:

| Type | Fields | Purpose |
|------|--------|---------|
| `session_ready` | sessionId, mode | Session initialized |
| `transcript_delta` | delta, speaker, timestamp, sequenceId | Incremental transcript |
| `audio_response` | data, transcript | Audio playback data |
| `guided_prompt` | prompt, promptIndex, totalPrompts | Guided session prompt |
| `session_analysis` | voiceTone, suggestedTitle, suggestedTags, transcript | Analysis results |
| `session_saved` | entryId, success | Entry saved confirmation |
| `error` | code, message, recoverable | Error notification |
| `usage_limit` | limitType, suggestion | Usage limit reached |

### 3.6 Error Handling & Reconnection

**WebSocket Close Codes**:

| Code | Meaning | Action |
|------|---------|--------|
| 4001 | Auth required | Prompt sign in |
| 4002 | Session expired | Retry connection |
| 1000 | Normal close | No action |

**Transcript Recovery** (useVoiceRelay.js Lines 411-427):

```javascript
const tryRestoreSession = useCallback(() => {
  const stored = localStorage.getItem(`voice_transcript_${sessionId}`);
  if (stored) {
    const { content, sequenceId } = JSON.parse(stored);
    wsRef.current.send(JSON.stringify({
      type: 'restore_transcript',
      content,
      sequenceId,
    }));
  }
});
```

**Message Validation** (index.ts Lines 353-369):

```typescript
const parseResult = ClientMessageSchema.safeParse(rawMessage);
if (!parseResult.success) {
  sendToClient(ws, {
    type: 'error',
    code: 'INVALID_MESSAGE',
    message: 'Invalid message format',
    recoverable: true,
  });
  return;
}
```

---

## 4. OpenAI Whisper Transcription

### 4.1 Cloud Function Configuration

**Location**: `functions/index.js` (Lines 1026-1110)

```javascript
export const transcribeAudio = onCall({
  secrets: [openaiApiKey],
  cors: true,
  maxInstances: 5,
  timeoutSeconds: 540,   // 9 minutes max
  memory: '1GiB'
}, async (request) => { ... });
```

### 4.2 API Integration

**Endpoint**: `https://api.openai.com/v1/audio/transcriptions`

**Request Format** (Lines 1049-1073):

```javascript
const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
const formBody = Buffer.concat([
  Buffer.from(`--${boundary}\r\n`),
  Buffer.from(`Content-Disposition: form-data; name="file"; filename="audio.${fileExt}"\r\n`),
  Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`),
  buffer,
  Buffer.from(`\r\n--${boundary}\r\n`),
  Buffer.from(`Content-Disposition: form-data; name="model"\r\n\r\n`),
  Buffer.from(`whisper-1\r\n`),
  Buffer.from(`--${boundary}--\r\n`)
]);

const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`
  },
  body: formBody
});
```

### 4.3 Transcription Settings

| Setting | Value | Notes |
|---------|-------|-------|
| Model | `whisper-1` | Latest Whisper model |
| Language | Auto-detect | 96+ languages supported |
| Temperature | Default | No override |
| Prompt | None | No context prompt |

### 4.4 Output Processing

**Filler Word Removal** (Lines 1088-1099):

```javascript
const fillerWords = /\b(um|uh|uhm|like|you know|so|well|actually|basically|literally)\b/gi;
transcript = transcript.replace(fillerWords, ' ').replace(/\s+/g, ' ').trim();
```

### 4.5 Retry Logic

**Location**: `src/services/transcription/transcription.js` (Lines 11-25)

**Retryable Errors**:
- Network errors
- Timeout errors
- Connection failures
- `UNAVAILABLE` status
- `DEADLINE_EXCEEDED` status

**Backoff Strategy**:

```javascript
for (let attempt = 0; attempt <= maxRetries; attempt++) {
  if (attempt > 0) {
    const backoffMs = Math.pow(2, attempt) * 1000;  // 2s, 4s, 8s
    await sleep(backoffMs);
  }
  // ... attempt transcription
}
```

### 4.6 Error Codes

| HTTP Status | Error Code | Meaning |
|-------------|------------|---------|
| 429 | `API_RATE_LIMIT` | Rate limited |
| 401 | `API_AUTH_ERROR` | Invalid API key |
| 400 | `API_BAD_REQUEST` | Malformed request |
| Other | `API_ERROR` | Generic error |

---

## 5. Voice Tone Analysis (Gemini)

### 5.1 Purpose

Voice tone analysis extracts emotional metadata from audio to enrich journal entries with mood and energy data beyond what text alone provides.

### 5.2 Audio Preprocessing

**Location**: `relay-server/src/analysis/voiceTone.ts` (Lines 23-59)

**PCM to WAV Conversion**:

```typescript
const pcmToBase64 = (pcmBuffer: Buffer): string => {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;

  // WAV header (44 bytes)
  const wav = Buffer.alloc(44 + pcmBuffer.length);

  // RIFF header
  wav.write('RIFF', 0);
  wav.writeUInt32LE(fileSize - 8, 4);
  wav.write('WAVE', 8);

  // fmt subchunk (PCM format)
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);

  // data subchunk
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);

  pcmBuffer.copy(wav, 44);
  return wav.toString('base64');
};
```

### 5.3 Gemini API Request

**Location**: `functions/index.js` (Lines 1295-1330)

**Endpoint**: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent`

**Request Structure**:

```javascript
{
  contents: [{
    parts: [
      { inline_data: { mime_type: mimeType, data: base64Audio } },
      { text: tonePrompt }
    ]
  }]
}
```

**Analysis Prompt** (Lines 1297-1313):

```javascript
const tonePrompt = `Analyze the emotional tone and mood from this voice recording. Focus on:
1. The speaker's emotional state based on voice characteristics (tone, pace, pitch variations, pauses)
2. Energy level (low/medium/high)
3. Specific emotions you can detect

The transcript of what they said: "${transcript}"

Respond in this exact JSON format only, no other text:
{
  "moodScore": <number 0-1, where 0 is very negative/distressed and 1 is very positive/joyful>,
  "energy": "<low|medium|high>",
  "emotions": ["<emotion1>", "<emotion2>"],
  "confidence": <number 0-1 indicating analysis confidence>,
  "summary": "<brief 1-sentence description of their emotional state>"
}`;
```

### 5.4 Response Schema

**VoiceToneAnalysis Interface**:

```typescript
interface VoiceToneAnalysis {
  moodScore: number;           // 0-1 scale (0 = negative, 1 = positive)
  energy: 'low' | 'medium' | 'high';
  emotions: string[];          // Up to 5 detected emotions
  confidence: number;          // 0-1 analysis confidence
  summary: string;             // One-sentence description
}
```

### 5.5 Response Parsing

**Location**: `functions/index.js` (Lines 1328-1344)

```javascript
const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

const jsonMatch = responseText.match(/\{[\s\S]*\}/);
if (jsonMatch) {
  const parsed = JSON.parse(jsonMatch[0]);
  toneAnalysis = {
    moodScore: Math.max(0, Math.min(1, parsed.moodScore)),
    energy: ['low', 'medium', 'high'].includes(parsed.energy) ? parsed.energy : 'medium',
    emotions: Array.isArray(parsed.emotions) ? parsed.emotions.slice(0, 5) : [],
    confidence: Math.max(0, Math.min(1, parsed.confidence)),
    summary: parsed.summary || 'Unable to determine emotional state'
  };
}
```

### 5.6 Minimum Audio Requirements

```javascript
const minAudioSize = 4000;  // ~2 seconds minimum
if (buffer.length >= minAudioSize) {
  // Proceed with tone analysis
}
```

### 5.7 Graceful Degradation

Voice tone analysis is **non-critical**. If it fails:
- Transcription still succeeds
- Entry is saved without tone data
- No user-facing error

```javascript
try {
  toneAnalysis = await analyzeVoiceTone(audio);
} catch (toneError) {
  console.warn('Voice tone analysis failed (non-critical):', toneError.message);
  // Continue without tone analysis
}
```

---

## 6. Platform-Specific Implementation

### 6.1 Platform Detection

**Location**: `src/App.jsx` (Lines 729-730)

```javascript
const platform = Capacitor.getPlatform();
const isNative = platform === 'ios' || platform === 'android';
```

### 6.2 iOS Implementation

**Directory**: `ios/` (Capacitor wrapper)

**iOS-Specific Features**:

| Feature | Implementation |
|---------|----------------|
| Audio Recording | Native MediaRecorder via Capacitor |
| Local Analysis | VADER sentiment on-device |
| Offline Support | IndexedDB + queue sync |
| Wake Lock | Screen stays on during recording |
| Background Processing | Service Worker for transcription |

**Audio Configuration**:
- 24kHz sample rate
- Echo cancellation via iOS AVAudioSession
- Noise suppression via iOS

### 6.3 Android Implementation

**Directory**: `android/` (Capacitor wrapper)

**Android-Specific Features**:

| Feature | Implementation |
|---------|----------------|
| Audio Recording | Native MediaRecorder via Capacitor |
| Local Analysis | VADER sentiment on-device |
| Offline Support | IndexedDB + queue sync |
| Health Data | Google Fit API (vs HealthKit on iOS) |

### 6.4 Web Implementation

**Directory**: `src/` (React SPA)

**Web-Specific Characteristics**:

| Feature | Behavior |
|---------|----------|
| Local Analysis | Skipped (server-only) |
| Offline Support | Not available |
| Voice Relay | Full WebSocket support |
| Storage | Cloud only (no IndexedDB queue) |

**Browser Requirements**:
- WebSocket API
- getUserMedia API
- AudioContext API
- Modern browser (Chrome 80+, Firefox 75+, Safari 14+)

### 6.5 Platform Comparison

| Aspect | iOS/Android | Web |
|--------|-------------|-----|
| Local Analysis | Yes (~22ms) | No |
| Offline Support | Yes (IndexedDB) | No |
| Voice Relay | WebSocket | WebSocket |
| Storage | Local + Cloud | Cloud only |
| Background Processing | Service Worker | N/A |
| Network Fallback | Offline queue | None |
| Health Data | HealthKit/Google Fit | Cached from native |

### 6.6 Processing Mode Selection

**Location**: `src/services/analysis/entryProcessor.js` (Lines 40-82)

```javascript
if (!navigator.onLine) {
  // OFFLINE MODE: Local analysis only, queue for sync
  return processOffline(entry);
} else if (isNative) {
  // HYBRID MODE: Local analysis + server analysis in parallel
  return processHybrid(entry);
} else {
  // SERVER MODE: Send directly to cloud
  return processServer(entry);
}
```

---

## 7. Entry Capture Flow Summary

### 7.1 Text Entry Flow

```
1. User types in TextInput component
2. Text validated (non-empty)
3. Crisis keywords checked (regex)
4. Temporal context detected (45s timeout)
5. Warning indicators checked
6. Base entry object created
7. Local analysis (iOS/Android only)
8. Saved to Firestore with analysisStatus: 'pending'
9. → Proceeds to Phase 2 (Context Enrichment)
```

### 7.2 Voice Entry Flow

```
1. User taps record → VoiceRecorder starts
2. Browser requests microphone (24kHz, mono, AEC+NS)
3. MediaRecorder captures audio chunks (1s timeslice)
4. Client connects to WebSocket relay server
5. Firebase token verified on relay server
6. Session mode selected (realtime/standard/guided)
7. User speaks → VAD detects speech automatically
8. Audio streamed to OpenAI Realtime API (or buffered for Standard)
9. Transcript returned via WebSocket
10. On end_session:
    a. Whisper transcription completes
    b. Gemini tone analysis (optional)
    c. Entry object created with transcript + tone
11. → Proceeds to Phase 2 (Context Enrichment)
```

### 7.3 Key Technical Specifications

| Specification | Value |
|---------------|-------|
| Audio Sample Rate | 24,000 Hz |
| Audio Channels | 1 (mono) |
| Audio Bitrate | 16 kbps |
| VAD Threshold | 0.5 |
| VAD Silence Duration | 500ms |
| VAD Prefix Padding | 300ms |
| Max Session Duration | 15 minutes |
| Token Refresh Interval | 50 minutes |
| Transcription Timeout | 540 seconds |
| Min Audio for Tone Analysis | ~2 seconds |

---

## Appendix A: File Reference

| File | Purpose |
|------|---------|
| `src/components/input/TextInput.jsx` | Text input UI component |
| `src/components/input/VoiceRecorder.jsx` | Voice recording UI component |
| `src/hooks/useVoiceRelay.js` | WebSocket connection management |
| `src/services/transcription/transcription.js` | Client-side transcription service |
| `src/services/analysis/entryProcessor.js` | Entry processing orchestration |
| `src/App.jsx` | Main app with saveEntry function |
| `relay-server/src/index.ts` | Voice relay server entry point |
| `relay-server/src/relay/realtimeProxy.ts` | OpenAI Realtime API proxy |
| `relay-server/src/relay/standardPipeline.ts` | Standard (Whisper+TTS) pipeline |
| `relay-server/src/relay/sessionManager.ts` | Session state management |
| `relay-server/src/analysis/voiceTone.ts` | Gemini voice tone analysis |
| `relay-server/src/auth/firebase.ts` | Token verification |
| `functions/index.js` | Cloud Functions (transcription, analysis) |

---

## Appendix B: Error Codes Reference

| Code | Source | Meaning |
|------|--------|---------|
| `API_RATE_LIMIT` | Whisper | OpenAI rate limited |
| `API_AUTH_ERROR` | Whisper | Invalid API key |
| `API_BAD_REQUEST` | Whisper | Malformed audio |
| `API_NO_CONTENT` | Whisper | Empty transcription |
| `API_EXCEPTION` | Whisper | Unhandled error |
| `INVALID_MESSAGE` | Relay | Bad WebSocket message |
| `4001` | WebSocket | Auth required |
| `4002` | WebSocket | Session expired |
