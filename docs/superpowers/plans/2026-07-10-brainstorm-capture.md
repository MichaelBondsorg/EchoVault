# Brainstorm-First Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Engram into a frictionless brain-dump capture tool: fused Gemini transcription (Phase 1), one-tap iOS instant capture via widgets/Siri (Phase 2), capture-first home + recording polish (Phase 3).

**Architecture:** Phase 1 adds a new Cloud Function `transcribeEntry` (one Gemini audio-in call returning cleaned transcript + tone, Whisper fallback, same response contract as today's `transcribeWithTone` so the client change is a flagged one-liner) plus a durable audio vault (Capacitor Filesystem) replacing the fragile localStorage backup. Phase 2 adds a `capture` deep link driven through `uiStore`, a static SwiftUI WidgetKit extension (home + lock screen) whose tap deep-links into auto-recording, and App Shortcuts/Siri. Phase 3 makes capture the front door (Bento quick-capture widget, neutral copy), then Live Activity + Control Center behind an explicit background-recording go/no-go.

**Tech Stack:** React 18 + Vite, Capacitor 8, Firebase Cloud Functions (Node 20, ESM), Vitest, SwiftUI/WidgetKit/AppIntents, Gemini 2.5 Flash + OpenAI Whisper.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-10-brainstorm-capture-design.md`. Decisions locked: Gemini 2.5 Flash · auto-save-then-edit (no review modal) · iOS-only widgets.
- **`main` auto-deploys** (hosting + functions via GitHub Actions). All work on feature branches → PR → merge. Do NOT push directly to main mid-phase.
- **Start AFTER open PRs #143 (hotfix, first), #142, #144 are merged**; branch each phase from fresh `main`. Phase branches: `feat/fused-transcription`, `feat/instant-capture-ios`, `feat/capture-first-reframe`.
- **Rollback:** Phase 1 ships behind `USE_FUSED_TRANSCRIPTION` in `src/config/ai.js`; flipping it to `false` restores the Whisper path with no redeploy of functions.
- **Never log transcript/audio content** (PII) — lengths and error messages only (existing convention).
- **Do not touch** `src/services/safety/`, `functions/src/safety/`, or safety keywords in `src/config/constants.js`.
- **functions/ is ESM** (`"type": "module"`); functions unit tests run from the ROOT vitest config and each new test file must be added to the `include` list in `vitest.config.js`.
- **Verify the Gemini model alias live before relying on it** (Task 2 has the exact step). Never assume `gemini-2.5-flash` resolves; adjust the constant to what the API actually lists.
- Test commands: `npm test` (root, runs everything), `npx vitest run <file>` for one file.

---

# PHASE 1 — Fused transcription + durability (branch `feat/fused-transcription`)

### Task 1: Fused transcription module (pure helpers, functions side)

**Files:**
- Create: `functions/src/transcription/fusedTranscription.js`
- Test: `functions/src/transcription/__tests__/fusedTranscription.test.js`
- Modify: `vitest.config.js` (add test file to `include` array, after line ~47)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `GEMINI_TRANSCRIBE_MODEL` (string const), `TRANSCRIPTION_PROMPT` (string const), `buildGeminiRequestBody(base64: string, mimeType: string) => object`, `parseFusedResponse(geminiJson: object) => { transcript: string, toneAnalysis: object|null } | null` (null = unparseable → caller falls back to Whisper). Task 2 imports all four.

- [ ] **Step 1: Write the failing tests**

```javascript
// functions/src/transcription/__tests__/fusedTranscription.test.js
import { describe, it, expect } from 'vitest';
import {
  TRANSCRIPTION_PROMPT,
  buildGeminiRequestBody,
  parseFusedResponse
} from '../fusedTranscription.js';

const wrap = (text) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe('buildGeminiRequestBody', () => {
  it('inlines audio and the prompt, requests JSON output', () => {
    const body = buildGeminiRequestBody('QUJD', 'audio/webm');
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: 'audio/webm', data: 'QUJD' });
    expect(body.contents[0].parts[1].text).toBe(TRANSCRIPTION_PROMPT);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });
});

describe('parseFusedResponse', () => {
  it('parses a clean JSON response', () => {
    const result = parseFusedResponse(wrap(JSON.stringify({
      transcript: 'I had a solid idea about the widget today.',
      toneAnalysis: { moodScore: 0.8, energy: 'high', emotions: ['excited'], confidence: 0.9, summary: 'Upbeat and energized.' }
    })));
    expect(result.transcript).toBe('I had a solid idea about the widget today.');
    expect(result.toneAnalysis.energy).toBe('high');
  });

  it('extracts JSON wrapped in markdown fences or prose', () => {
    const result = parseFusedResponse(wrap('```json\n{"transcript":"hello","toneAnalysis":null}\n```'));
    expect(result.transcript).toBe('hello');
    expect(result.toneAnalysis).toBeNull();
  });

  it('clamps tone values and defaults invalid energy to medium', () => {
    const result = parseFusedResponse(wrap(JSON.stringify({
      transcript: 'x',
      toneAnalysis: { moodScore: 7, energy: 'frantic', emotions: ['a','b','c','d','e','f','g'], confidence: -2, summary: '' }
    })));
    expect(result.toneAnalysis.moodScore).toBe(1);
    expect(result.toneAnalysis.confidence).toBe(0);
    expect(result.toneAnalysis.energy).toBe('medium');
    expect(result.toneAnalysis.emotions).toHaveLength(5);
    expect(result.toneAnalysis.summary).toBe('Unable to determine emotional state');
  });

  it('returns empty transcript + null tone for the no-speech contract', () => {
    const result = parseFusedResponse(wrap('{"transcript":"","toneAnalysis":null}'));
    expect(result).toEqual({ transcript: '', toneAnalysis: null });
  });

  it('returns null for garbage / missing candidates (fallback signal)', () => {
    expect(parseFusedResponse(wrap('sorry, I cannot'))).toBeNull();
    expect(parseFusedResponse({})).toBeNull();
    expect(parseFusedResponse(wrap('{"nope": true}'))).toBeNull();
  });

  it('does NOT contain the destructive filler regex behavior (like/so/actually preserved)', () => {
    const result = parseFusedResponse(wrap(JSON.stringify({
      transcript: 'I actually like this, so well done.', toneAnalysis: null
    })));
    expect(result.transcript).toBe('I actually like this, so well done.');
  });
});
```

- [ ] **Step 2: Add the file to vitest include and run to verify failure**

In `vitest.config.js`, append to the `include` array:
```javascript
      'functions/src/transcription/__tests__/fusedTranscription.test.js',
```
Run: `npx vitest run functions/src/transcription/__tests__/fusedTranscription.test.js`
Expected: FAIL — cannot resolve `../fusedTranscription.js`.

- [ ] **Step 3: Write the implementation**

```javascript
// functions/src/transcription/fusedTranscription.js
/**
 * Fused transcription: one Gemini audio-in call that transcribes with light
 * cleanup AND analyzes voice tone. Replaces Whisper + destructive filler
 * regex + separate Gemini tone call. Cleanup philosophy ported from Cosmo:
 * the model hears the audio, removes disfluencies, never restructures.
 */

// Verify against the live models list before changing (see plan Task 2 Step 1).
export const GEMINI_TRANSCRIBE_MODEL = 'gemini-2.5-flash';

export const TRANSCRIPTION_PROMPT = `Transcribe this audio with light cleanup:

- Remove filler words (um, uh, like, you know, basically, sort of) ONLY when used as fillers
- Remove false starts and self-corrections
- Keep the natural flow but make it readable, with normal punctuation and paragraph breaks for topic shifts

Do NOT try to:
- Restructure into bullet points
- Fix proper nouns you don't recognize
- Summarize or condense meaning

Separately, analyze the speaker's emotional tone from the voice itself (pace, pitch, pauses, energy).

Return JSON only, exactly this shape:
{
  "transcript": "<cleaned transcript as natural sentences>",
  "toneAnalysis": {
    "moodScore": <number 0-1, 0 = very negative/distressed, 1 = very positive/joyful>,
    "energy": "<low|medium|high>",
    "emotions": ["<emotion1>", "<emotion2>"],
    "confidence": <number 0-1 indicating analysis confidence>,
    "summary": "<one sentence describing their emotional state>"
  }
}

If there is no intelligible speech, return {"transcript": "", "toneAnalysis": null}.`;

export function buildGeminiRequestBody(base64, mimeType) {
  return {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: TRANSCRIPTION_PROMPT }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2
    }
  };
}

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

export function parseFusedResponse(geminiJson) {
  const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (typeof parsed.transcript !== 'string') return null;

  const transcript = parsed.transcript.trim();

  let toneAnalysis = null;
  const t = parsed.toneAnalysis;
  if (t && typeof t === 'object') {
    toneAnalysis = {
      moodScore: clamp01(t.moodScore),
      energy: ['low', 'medium', 'high'].includes(t.energy) ? t.energy : 'medium',
      emotions: Array.isArray(t.emotions) ? t.emotions.slice(0, 5) : [],
      confidence: clamp01(t.confidence),
      summary: (typeof t.summary === 'string' && t.summary.trim()) || 'Unable to determine emotional state'
    };
  }

  return { transcript, toneAnalysis };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run functions/src/transcription/__tests__/fusedTranscription.test.js`
Expected: PASS (7 tests). Also run `npm test` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add functions/src/transcription/ vitest.config.js
git commit -m "feat(functions): fused Gemini transcription helpers (prompt, request builder, parser)"
```

---

### Task 2: `transcribeEntry` Cloud Function with Whisper fallback

**Files:**
- Modify: `functions/index.js` (add import near line 21; add new export after `transcribeWithTone`, i.e. after line ~1474)

**Interfaces:**
- Consumes: Task 1's `GEMINI_TRANSCRIBE_MODEL`, `buildGeminiRequestBody`, `parseFusedResponse`; existing `transcribeWithWhisper` from `functions/src/shared/openai.js`; existing `enforceDailyQuota`, `DAILY_QUOTA` (defined at `functions/index.js:53`), `openaiApiKey`, `geminiApiKey`, `TRANSCRIBE_TIMEOUT_MS`, `onCall`, `HttpsError`.
- Produces: callable `transcribeEntry` — request `{ base64, mimeType }`, response `{ transcript, toneAnalysis, engine: 'gemini'|'whisper' }` or `{ error: 'API_RATE_LIMIT'|'API_AUTH_ERROR'|'API_BAD_REQUEST'|'API_ERROR'|'API_NO_CONTENT'|'API_EXCEPTION' }`. Task 3 calls it.

- [ ] **Step 1: Verify the live Gemini model alias (do not skip)**

```bash
GEMINI_KEY=$(firebase functions:secrets:access GEMINI_API_KEY --project echo-vault-app)
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_KEY" | grep -o '"name": "models/gemini-2.5[^"]*"' | sort -u
```
Expected: a line containing `models/gemini-2.5-flash`. If the exact alias differs (e.g. only a dated variant exists), update `GEMINI_TRANSCRIBE_MODEL` in `functions/src/transcription/fusedTranscription.js` to the listed alias and note it in the commit message.

- [ ] **Step 2: Add the import and the function**

Near line 21 of `functions/index.js` (with the other `./src/` imports):
```javascript
import { GEMINI_TRANSCRIBE_MODEL, buildGeminiRequestBody, parseFusedResponse } from './src/transcription/fusedTranscription.js';
import { transcribeWithWhisper } from './src/shared/openai.js';
```

After the closing of `transcribeWithTone` (line ~1474):
```javascript
/**
 * Cloud Function: Fused transcription — one Gemini audio-in call returns a
 * lightly-cleaned transcript + voice tone. Falls back to Whisper (raw, no
 * filler-stripping) if Gemini fails. Same response contract as
 * transcribeWithTone so the client can switch via config flag.
 */
export const transcribeEntry = onCall(
  {
    secrets: [openaiApiKey, geminiApiKey],
    cors: true,
    maxInstances: 5,
    timeoutSeconds: 540,
    memory: '1GiB'
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    const { base64, mimeType } = request.data;

    if (!base64 || !mimeType) {
      throw new HttpsError('invalid-argument', 'Audio data and mimeType are required');
    }

    const gemKey = geminiApiKey.value();
    const oaiKey = openaiApiKey.value();

    await enforceDailyQuota(userId, { key: 'transcribe', limit: DAILY_QUOTA.transcribe });

    // 1. Primary: fused Gemini call (transcript + tone in one pass)
    if (gemKey) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TRANSCRIBE_MODEL}:generateContent?key=${gemKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildGeminiRequestBody(base64, mimeType)),
            signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
          }
        );

        if (geminiRes.status === 429) return { error: 'API_RATE_LIMIT' };

        if (geminiRes.ok) {
          const parsed = parseFusedResponse(await geminiRes.json());
          if (parsed && parsed.transcript) {
            return { transcript: parsed.transcript, toneAnalysis: parsed.toneAnalysis, engine: 'gemini' };
          }
          if (parsed && parsed.transcript === '') {
            return { error: 'API_NO_CONTENT' }; // model heard no speech
          }
          console.warn('[transcribeEntry] unparseable Gemini response, falling back to Whisper', { userId });
        } else {
          console.warn('[transcribeEntry] Gemini HTTP error, falling back to Whisper', { userId, status: geminiRes.status });
        }
      } catch (geminiError) {
        console.warn('[transcribeEntry] Gemini call failed, falling back to Whisper', { userId, err: geminiError?.message });
      }
    }

    // 2. Fallback: Whisper raw transcript (NO filler-word regex — it corrupts meaning)
    if (!oaiKey) {
      return { error: 'API_ERROR' };
    }
    try {
      const buffer = Buffer.from(base64, 'base64');
      const fileExt = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';
      const whisperResult = await transcribeWithWhisper(oaiKey, buffer, { filename: `audio.${fileExt}` });
      const transcript = whisperResult?.text?.trim();
      if (!transcript) return { error: 'API_NO_CONTENT' };
      return { transcript, toneAnalysis: null, engine: 'whisper' };
    } catch (error) {
      console.error('[transcribeEntry] both engines failed', {
        userId, audioBytes: base64?.length, mimeType, err: error?.message
      });
      return { error: 'API_EXCEPTION' };
    }
  }
);
```

- [ ] **Step 3: Sanity checks**

Run: `node --check functions/index.js` — expected: no output (syntax OK).
Run: `npm test` — expected: full suite green (no test touches index.js directly; the logic lives in Task 1's tested module).
Open `functions/src/shared/openai.js` and confirm `transcribeWithWhisper(apiKey, audioBuffer, options)` returns an object with a `.text` field (it uses `verbose_json`). If it returns null-on-error only, the code above already handles it.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js functions/src/transcription/fusedTranscription.js
git commit -m "feat(functions): transcribeEntry callable — fused Gemini transcription with Whisper fallback"
```

---

### Task 3: Client callable + service + config flag

**Files:**
- Modify: `src/config/firebase.js` (after line 66)
- Modify: `src/config/ai.js`
- Modify: `src/services/ai/transcription.js`
- Modify: `src/services/ai/index.js` (export the new function — check the existing export list and add `transcribeEntryFused`)
- Test: `src/services/ai/__tests__/transcription.test.js` (new)

**Interfaces:**
- Consumes: callable `transcribeEntry` (Task 2).
- Produces: `transcribeEntryFused(base64: string, mimeType: string, maxRetries?: number) => Promise<{transcript, toneAnalysis}|string>` (string = error code, same contract as `transcribeAudioWithTone`); `USE_FUSED_TRANSCRIPTION: boolean` from `src/config/ai.js`. Task 4 consumes both in App.jsx.

- [ ] **Step 1: Write the failing test**

```javascript
// src/services/ai/__tests__/transcription.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTranscribeEntryFn = vi.fn();

vi.mock('../../../config', () => ({
  transcribeAudioFn: vi.fn(),
  transcribeWithToneFn: vi.fn(),
  transcribeEntryFn: (...args) => mockTranscribeEntryFn(...args)
}));

import { transcribeEntryFused } from '../transcription';

describe('transcribeEntryFused', () => {
  beforeEach(() => mockTranscribeEntryFn.mockReset());

  it('returns transcript + tone on success', async () => {
    mockTranscribeEntryFn.mockResolvedValue({
      data: { transcript: 'hello world', toneAnalysis: { moodScore: 0.5 }, engine: 'gemini' }
    });
    const result = await transcribeEntryFused('QUJD', 'audio/webm');
    expect(result).toEqual({ transcript: 'hello world', toneAnalysis: { moodScore: 0.5 } });
    expect(mockTranscribeEntryFn).toHaveBeenCalledWith({ base64: 'QUJD', mimeType: 'audio/webm' });
  });

  it('returns non-retryable error codes immediately without retrying', async () => {
    mockTranscribeEntryFn.mockResolvedValue({ data: { error: 'API_RATE_LIMIT' } });
    const result = await transcribeEntryFused('QUJD', 'audio/webm');
    expect(result).toBe('API_RATE_LIMIT');
    expect(mockTranscribeEntryFn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors then gives up with API_EXCEPTION', async () => {
    mockTranscribeEntryFn.mockRejectedValue(Object.assign(new Error('network down'), { code: 'unavailable' }));
    const result = await transcribeEntryFused('QUJD', 'audio/webm', 1); // 1 retry to keep test fast
    expect(result).toBe('API_EXCEPTION');
    expect(mockTranscribeEntryFn).toHaveBeenCalledTimes(2);
  }, 15000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/services/ai/__tests__/transcription.test.js`
Expected: FAIL — `transcribeEntryFused` is not exported.

- [ ] **Step 3: Implement**

`src/config/firebase.js`, after line 66:
```javascript
export const transcribeEntryFn = httpsCallable(functions, 'transcribeEntry', { timeout: 540000 }); // 9 min - fused Gemini transcription + tone
```

`src/config/ai.js` — update transcription block and add the flag:
```javascript
  transcription: {
    primary: 'gemini-2.5-flash',   // fused transcript+tone via transcribeEntry
    fallback: 'whisper-1'          // server-side fallback inside transcribeEntry
  }
};

// Kill switch: false restores the legacy whisper-1 + separate tone pipeline
// (transcribeWithTone) with no server redeploy.
export const USE_FUSED_TRANSCRIPTION = true;
```

`src/services/ai/transcription.js` — update the import at line 1 and append:
```javascript
import { transcribeAudioFn, transcribeWithToneFn, transcribeEntryFn } from '../../config';
```
```javascript
/**
 * Fused transcription via Cloud Function (Gemini audio-in: transcript + tone
 * in one call, Whisper fallback server-side). Same return contract as
 * transcribeAudioWithTone: {transcript, toneAnalysis} or an error-code string.
 */
export const transcribeEntryFused = async (base64, mimeType, maxRetries = 3) => {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.log(`Fused transcription retry ${attempt}/${maxRetries} after ${backoffMs}ms`);
        await sleep(backoffMs);
      }

      const result = await transcribeEntryFn({ base64, mimeType });

      if (result.data?.error) {
        const errorCode = result.data.error;
        if (errorCode === 'API_RATE_LIMIT' || errorCode === 'API_AUTH_ERROR' || errorCode === 'API_BAD_REQUEST') {
          return errorCode;
        }
        lastError = new Error(errorCode);
        continue;
      }

      const { transcript, toneAnalysis } = result.data || {};
      if (!transcript) {
        lastError = new Error('API_NO_CONTENT');
        continue;
      }

      console.log('Fused transcription result:', {
        transcriptLength: transcript.length,
        engine: result.data?.engine,
        hasToneAnalysis: !!toneAnalysis
      });
      return { transcript, toneAnalysis: toneAnalysis || null };
    } catch (e) {
      console.error(`Fused transcription exception (attempt ${attempt + 1}):`, e);
      lastError = e;
      if (!isRetryableError(e)) break;
    }
  }

  console.error('All fused transcription attempts failed:', lastError);
  return 'API_EXCEPTION';
};
```

`src/services/ai/index.js`: add `transcribeEntryFused` to the re-exports from `./transcription` (match the existing export style in that file).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/services/ai/__tests__/transcription.test.js` — expected: PASS (3 tests).
Note: if the `vi.mock('../../../config', ...)` path fails to intercept, check what `src/services/ai/transcription.js` resolves (`../../config` → `src/config/index.js` or `src/config.js`) and mock that exact resolved specifier.
Run: `npm test` — full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/config/firebase.js src/config/ai.js src/services/ai/
git commit -m "feat: client path for fused transcription behind USE_FUSED_TRANSCRIPTION flag"
```

---

### Task 4: Wire App.jsx to the fused path + raise recording bitrate

**Files:**
- Modify: `src/App.jsx` (import at line 39; call site at line 1505)
- Modify: `src/components/input/VoiceRecorder.jsx:46`
- Modify: `src/components/dashboard/EntryBar.jsx:89`

**Interfaces:**
- Consumes: `transcribeEntryFused`, `USE_FUSED_TRANSCRIPTION` (Task 3).
- Produces: no new interfaces; behavior change only.

- [ ] **Step 1: Switch the transcription call (flagged)**

`src/App.jsx` line 39 — extend the import:
```javascript
import { generateEmbedding, findRelevantMemories, transcribeAudioWithTone, transcribeEntryFused } from './services/ai';
```
Add next to the other config imports (top of file, wherever `./config/ai` or similar is imported — if `ai.js` isn't imported yet, add):
```javascript
import { USE_FUSED_TRANSCRIPTION } from './config/ai';
```
Line 1505, replace:
```javascript
      const result = await transcribeAudioWithTone(base64, mime);
```
with:
```javascript
      const result = USE_FUSED_TRANSCRIPTION
        ? await transcribeEntryFused(base64, mime)
        : await transcribeAudioWithTone(base64, mime);
```
The surrounding error handling is contract-identical, so nothing else changes.

- [ ] **Step 2: Raise the bitrate in both recorders**

`src/components/input/VoiceRecorder.jsx:46` and `src/components/dashboard/EntryBar.jsx:89` — change `audioBitsPerSecond: 16000` to:
```javascript
audioBitsPerSecond: 32000
```

- [ ] **Step 3: Verify build + esbuild-global gotcha**

Run: `npm run build`
Expected: clean build. (This repo has shipped a white-screen from an undefined global in App.jsx before — the build passing is necessary but ALSO run `npm run dev`, load the app, and confirm no console errors on the home screen.)

- [ ] **Step 4: End-to-end manual verification (deploy functions to do this properly)**

Push the branch and open a PR — CI does NOT deploy functions from branches, so for a live test either run `cd functions && npm run deploy` manually (deploys `transcribeEntry` alongside existing functions; additive, safe) or merge the phase PR and test on prod web.
Record a voice entry containing: "So I was like, um, thinking that actually we should, uh, ship the widget."
Expected: transcript keeps "So I was thinking that actually we should ship the widget"-style meaning (no missing "actually/like/so" where they carry meaning), has punctuation, entry saves automatically with tone populated. Check function logs: `firebase functions:log --only transcribeEntry` shows `engine: gemini` (in the client console log).
Flip test: set `USE_FUSED_TRANSCRIPTION = false`, confirm the legacy path still works, set back to `true`.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/input/VoiceRecorder.jsx src/components/dashboard/EntryBar.jsx
git commit -m "feat: use fused transcription in entry flow; raise voice bitrate 16k->32kbps"
```

---

### Task 5: Durable audio vault (replaces localStorage backup)

**Files:**
- Create: `src/services/audio/audioVault.js`
- Create: `src/test/mocks/filesystem.js`
- Test: `src/services/audio/__tests__/audioVault.test.js`
- Modify: `vitest.config.js` (alias `@capacitor/filesystem` → the new mock)
- Modify: `src/App.jsx` (backup block lines 1487–1500; success cleanup line 1565; error branches 1528, 1559)
- Modify: `package.json` (new dependency)

**Interfaces:**
- Consumes: `@capacitor/filesystem` (new dep), `localStorage` (web fallback).
- Produces: `audioVault.saveRecording(base64, mime) => Promise<string|null>` (id; null if storage failed — never throws), `audioVault.getRecording(id) => Promise<{base64, mime, createdAt, entryId}|null>`, `audioVault.linkEntry(id, entryId) => Promise<void>`, `audioVault.deleteRecording(id) => Promise<void>`, `audioVault.listOrphans() => Promise<Array<{id, createdAt}>>` (saved but never linked to an entry), `audioVault.cleanupExpired() => Promise<number>` (deletes recordings older than 7 days). Task 6 and Phase 2+ consume these.

- [ ] **Step 1: Install the plugin**

```bash
npm install @capacitor/filesystem
npx cap sync ios
```
Expected: plugin appears in `ios/App/CapApp-SPM` package list.

- [ ] **Step 2: Write the mock and the failing tests**

```javascript
// src/test/mocks/filesystem.js — in-memory Filesystem for vitest
const store = new Map();

export const Directory = { Data: 'DATA' };
export const Encoding = { UTF8: 'utf8' };

export const Filesystem = {
  async writeFile({ path, data }) { store.set(path, data); return { uri: `mem://${path}` }; },
  async readFile({ path }) {
    if (!store.has(path)) throw new Error('File does not exist');
    return { data: store.get(path) };
  },
  async deleteFile({ path }) { store.delete(path); },
  async readdir({ path }) {
    const files = [...store.keys()]
      .filter(p => p.startsWith(path + '/'))
      .map(p => ({ name: p.slice(path.length + 1), type: 'file' }));
    return { files };
  },
  async mkdir() { /* no-op */ },
  __reset() { store.clear(); }
};
```

```javascript
// src/services/audio/__tests__/audioVault.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';

// Force the native code path so the Filesystem mock is exercised
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true }
}));

import { audioVault } from '../audioVault';

describe('audioVault', () => {
  beforeEach(() => {
    Filesystem.__reset();
    localStorage.clear();
  });

  it('saves and retrieves a recording', async () => {
    const id = await audioVault.saveRecording('QUJDREVG', 'audio/webm');
    expect(id).toBeTruthy();
    const rec = await audioVault.getRecording(id);
    expect(rec.base64).toBe('QUJDREVG');
    expect(rec.mime).toBe('audio/webm');
    expect(rec.entryId).toBeNull();
  });

  it('linkEntry marks a recording as non-orphaned', async () => {
    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    expect(await audioVault.listOrphans()).toHaveLength(1);
    await audioVault.linkEntry(id, 'entry-123');
    expect(await audioVault.listOrphans()).toHaveLength(0);
    expect((await audioVault.getRecording(id)).entryId).toBe('entry-123');
  });

  it('deleteRecording removes audio and metadata', async () => {
    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    await audioVault.deleteRecording(id);
    expect(await audioVault.getRecording(id)).toBeNull();
    expect(await audioVault.listOrphans()).toHaveLength(0);
  });

  it('cleanupExpired deletes recordings older than 7 days but keeps fresh ones', async () => {
    const oldId = await audioVault.saveRecording('T0xE', 'audio/webm');
    // Backdate via the metadata index
    const index = JSON.parse(localStorage.getItem('engram_audio_vault_index'));
    index[oldId].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('engram_audio_vault_index', JSON.stringify(index));
    const freshId = await audioVault.saveRecording('RlJFU0g=', 'audio/webm');

    const deleted = await audioVault.cleanupExpired();
    expect(deleted).toBe(1);
    expect(await audioVault.getRecording(oldId)).toBeNull();
    expect(await audioVault.getRecording(freshId)).not.toBeNull();
  });

  it('never throws when storage fails — returns null id', async () => {
    const spy = vi.spyOn(Filesystem, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    expect(id).toBeNull();
    spy.mockRestore();
  });
});
```

Add to `vitest.config.js` resolve.alias:
```javascript
      '@capacitor/filesystem': path.resolve(__dirname, './src/test/mocks/filesystem.js'),
```
Run: `npx vitest run src/services/audio/__tests__/audioVault.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the vault**

```javascript
// src/services/audio/audioVault.js
/**
 * Durable local storage for voice recordings. The #1 trust failure in
 * voice-capture apps is losing recordings — audio lands here the moment
 * recording stops and is retained for RETENTION_DAYS after the entry saves,
 * never gated on a cloud round-trip.
 *
 * Native: audio files via Capacitor Filesystem (Data directory).
 * Web: base64 in localStorage (secondary platform; 10MB guard).
 * Metadata index (both platforms): localStorage JSON map id -> {createdAt, mime, entryId}.
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

const INDEX_KEY = 'engram_audio_vault_index';
const DIR = 'audio-vault';
const RETENTION_DAYS = 7;
const WEB_MAX_BYTES = 10 * 1024 * 1024;

const isNative = () => Capacitor.isNativePlatform();
const filePath = (id) => `${DIR}/${id}.b64`;
const webKey = (id) => `engram_audio_vault_${id}`;

const readIndex = () => {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || {}; } catch { return {}; }
};
const writeIndex = (index) => {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); } catch (e) {
    console.warn('[audioVault] could not persist index:', e.message);
  }
};

export const audioVault = {
  /** Returns the recording id, or null if storage failed (never throws). */
  async saveRecording(base64, mime) {
    const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      if (isNative()) {
        await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(() => {});
        await Filesystem.writeFile({ path: filePath(id), directory: Directory.Data, data: base64 });
      } else {
        if (base64.length > WEB_MAX_BYTES) {
          console.warn('[audioVault] recording too large for web storage:', base64.length);
          return null;
        }
        localStorage.setItem(webKey(id), base64);
      }
      const index = readIndex();
      index[id] = { createdAt: Date.now(), mime, entryId: null };
      writeIndex(index);
      return id;
    } catch (e) {
      console.warn('[audioVault] saveRecording failed:', e.message);
      return null;
    }
  },

  async getRecording(id) {
    const meta = readIndex()[id];
    if (!meta) return null;
    try {
      let base64;
      if (isNative()) {
        base64 = (await Filesystem.readFile({ path: filePath(id), directory: Directory.Data })).data;
      } else {
        base64 = localStorage.getItem(webKey(id));
      }
      if (!base64) return null;
      return { base64, mime: meta.mime, createdAt: meta.createdAt, entryId: meta.entryId };
    } catch {
      return null;
    }
  },

  async linkEntry(id, entryId) {
    const index = readIndex();
    if (index[id]) {
      index[id].entryId = entryId;
      writeIndex(index);
    }
  },

  async deleteRecording(id) {
    try {
      if (isNative()) {
        await Filesystem.deleteFile({ path: filePath(id), directory: Directory.Data }).catch(() => {});
      } else {
        localStorage.removeItem(webKey(id));
      }
    } finally {
      const index = readIndex();
      delete index[id];
      writeIndex(index);
    }
  },

  /** Recordings that never got linked to a saved entry (transcription failed / app died). */
  async listOrphans() {
    const index = readIndex();
    return Object.entries(index)
      .filter(([, meta]) => !meta.entryId)
      .map(([id, meta]) => ({ id, createdAt: meta.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  /** Delete recordings older than RETENTION_DAYS. Returns count deleted. */
  async cleanupExpired() {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const index = readIndex();
    let deleted = 0;
    for (const [id, meta] of Object.entries(index)) {
      if (meta.createdAt < cutoff) {
        await this.deleteRecording(id);
        deleted++;
      }
    }
    return deleted;
  }
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/services/audio/__tests__/audioVault.test.js` — expected: PASS (5 tests). Then `npm test` — full suite green.

- [ ] **Step 5: Swap App.jsx onto the vault**

In `src/App.jsx`, replace the backup block (lines 1487–1500, the `audioBackupKey`/localStorage block) with:
```javascript
    // Durable local backup BEFORE any network call — recordings must never
    // depend on a successful cloud round-trip.
    const { audioVault } = await import('./services/audio/audioVault');
    const recordingId = await audioVault.saveRecording(base64, mime);
    console.log('[Transcription] Audio saved to vault:', recordingId);
```
Replace the two `localStorage.removeItem(audioBackupKey)` cleanup calls in the error branches (lines ~1528 and ~1559) with nothing (the vault retains failed-transcription audio as an orphan — that is the point), and replace the success-path cleanup (line ~1565):
```javascript
      // Keep the raw audio for RETENTION_DAYS (replay/original); link it to the entry.
      // saveEntry currently doesn't return the entry id — link with a sentinel so
      // the recording is not treated as an orphan. (Replay UI is deferred; see plan notes.)
      if (recordingId) await audioVault.linkEntry(recordingId, 'saved');
```
Add to the existing app-start cleanup effect (near line 323, where `echov_audio_backup_` keys are purged) a vault sweep:
```javascript
    import('./services/audio/audioVault').then(({ audioVault }) =>
      audioVault.cleanupExpired().then(n => n && console.log(`[audioVault] cleaned ${n} expired recording(s)`))
    );
```

- [ ] **Step 6: Orphan recovery banner**

Create `src/components/shared/PendingAudioBanner.jsx`:
```javascript
import { useEffect, useState } from 'react';
import { audioVault } from '../../services/audio/audioVault';

/**
 * Shows when unsaved recordings exist (transcription failed or app died
 * mid-flight). Retry re-runs the normal transcription+save pipeline.
 */
const PendingAudioBanner = ({ onRetry }) => {
  const [orphans, setOrphans] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    audioVault.listOrphans().then(setOrphans);
  }, []);

  if (orphans.length === 0) return null;

  const retryAll = async () => {
    setBusy(true);
    for (const { id } of orphans) {
      const rec = await audioVault.getRecording(id);
      if (rec) {
        const ok = await onRetry(rec.base64, rec.mime);
        if (ok) await audioVault.linkEntry(id, 'saved');
      }
    }
    setOrphans(await audioVault.listOrphans());
    setBusy(false);
  };

  return (
    <div className="mx-4 my-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-sm text-amber-800 dark:text-amber-200">
        {orphans.length} unsaved recording{orphans.length > 1 ? 's' : ''} — audio is safe on this device.
      </p>
      <button
        onClick={retryAll}
        disabled={busy}
        className="text-sm font-medium text-amber-900 dark:text-amber-100 underline disabled:opacity-50"
      >
        {busy ? 'Retrying…' : 'Retry now'}
      </button>
    </div>
  );
};

export default PendingAudioBanner;
```
Wire it in `src/App.jsx` inside the `<AppLayout>` children (near the modals block at line ~2397):
```jsx
      <PendingAudioBanner onRetry={async (base64, mime) => {
        try { await handleAudio(base64, mime); return true; } catch { return false; }
      }} />
```
(Use the actual name of the audio wrapper function around line 1460 — it is the function whose body starts at the logging block at line 1470; pass exactly that.)

- [ ] **Step 7: Verify, then commit**

Run: `npm test && npm run build` — green.
Manual: in dev, record an entry with Wi-Fi off → expect the banner after failure; turn Wi-Fi on → Retry → entry appears, banner clears.
```bash
git add src/services/audio/ src/test/mocks/filesystem.js src/components/shared/PendingAudioBanner.jsx src/App.jsx vitest.config.js package.json package-lock.json
git commit -m "feat: durable audio vault (Capacitor Filesystem) with orphan recovery, replaces localStorage backup"
```

---

### Task 6: Remove dead audio machinery + Phase 1 PR

**Files:**
- Delete: `public/sw-audio.js`
- Modify: `PROJECT_STATUS.md`

- [ ] **Step 1: Delete the dormant service worker**

```bash
grep -rn "sw-audio" src/ public/ index.html functions/ || echo "no references"
git rm public/sw-audio.js
```
Expected: "no references" (it was never registered). If any reference appears, remove it too.

- [ ] **Step 2: Update PROJECT_STATUS.md**

Add to the decision log:
```markdown
| 2026-07-10 | Fused Gemini transcription (transcribeEntry) replaces whisper+regex+tone 3-hop; flag USE_FUSED_TRANSCRIPTION | Better cleanup (model hears audio), 1 call, ~3x cheaper | Gemini quality regressions or pricing change |
| 2026-07-10 | Raw audio kept 7 days in local vault, never gated on cloud | Lost recordings are the #1 trust killer in voice apps | Storage pressure complaints |
```
Update Active Work with Phase 1 status.

- [ ] **Step 3: Full verification + PR**

```bash
npm test && npm run build
git add PROJECT_STATUS.md
git commit -m "chore: remove dormant sw-audio.js; log Phase 1 decisions"
git push -u origin feat/fused-transcription
gh pr create --title "Phase 1: fused Gemini transcription + durable audio vault" --body "Implements Phase 1 of docs/superpowers/specs/2026-07-10-brainstorm-capture-design.md ..."
```
After merge: CI deploys functions + hosting. Re-run the Task 4 Step 4 manual verification on prod web, then dogfood on TestFlight before Phase 2.

---

# PHASE 2 — iOS instant capture (branch `feat/instant-capture-ios`)

### Task 7: Capture deep link through uiStore

**Files:**
- Create: `src/utils/deepLinks.js`
- Test: `src/utils/__tests__/deepLinks.test.js`
- Modify: `src/stores/uiStore.js` (add captureRequest state — read the store first, follow its exact `create()` shape)
- Test: `src/stores/__tests__/uiStore.capture.test.js`
- Modify: `src/App.jsx:349-387` (deep-link handler)
- Modify: `src/components/zen/AppLayout.jsx` (react to captureRequest)

**Interfaces:**
- Consumes: existing `AppLayout` internal state `setEntryMode(mode)` + `setShowEntryModal(true)` (lines 92/91), existing `EntryBar` auto-start behavior (`embedded` + `preferredMode='voice'`).
- Produces: `parseCaptureLink(urlString) => {mode:'voice'|'text'}|null`; uiStore `captureRequest: {mode, ts}|null`, `requestCapture(mode?)`, `clearCaptureRequest()`. Consumed by Tasks 8–10 and Phase 3's QuickCapture widget.

- [ ] **Step 1: Write failing tests**

```javascript
// src/utils/__tests__/deepLinks.test.js
import { describe, it, expect } from 'vitest';
import { parseCaptureLink } from '../deepLinks';

describe('parseCaptureLink', () => {
  it('parses voice capture links', () => {
    expect(parseCaptureLink('engram://capture?mode=voice')).toEqual({ mode: 'voice' });
  });
  it('parses text mode', () => {
    expect(parseCaptureLink('engram://capture?mode=text')).toEqual({ mode: 'text' });
  });
  it('defaults missing/unknown mode to voice', () => {
    expect(parseCaptureLink('engram://capture')).toEqual({ mode: 'voice' });
    expect(parseCaptureLink('engram://capture?mode=banana')).toEqual({ mode: 'voice' });
  });
  it('returns null for non-capture links (OAuth callbacks untouched)', () => {
    expect(parseCaptureLink('engram://auth-success?provider=whoop')).toBeNull();
    expect(parseCaptureLink('https://example.com/capture')).toBeNull();
    expect(parseCaptureLink('not a url')).toBeNull();
  });
});
```

```javascript
// src/stores/__tests__/uiStore.capture.test.js
import { describe, it, expect } from 'vitest';
import { useUiStore } from '../uiStore';

describe('uiStore capture request', () => {
  it('requestCapture sets mode and a timestamp; clear resets', () => {
    useUiStore.getState().requestCapture('voice');
    const req = useUiStore.getState().captureRequest;
    expect(req.mode).toBe('voice');
    expect(typeof req.ts).toBe('number');
    useUiStore.getState().clearCaptureRequest();
    expect(useUiStore.getState().captureRequest).toBeNull();
  });
  it('defaults to voice', () => {
    useUiStore.getState().requestCapture();
    expect(useUiStore.getState().captureRequest.mode).toBe('voice');
  });
});
```
Run both: expected FAIL (missing exports).

- [ ] **Step 2: Implement**

```javascript
// src/utils/deepLinks.js
/** Parse an engram:// capture deep link. Returns {mode} or null if not a capture link. */
export function parseCaptureLink(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'engram:' || url.host !== 'capture') return null;
    const mode = url.searchParams.get('mode');
    return { mode: mode === 'text' ? 'text' : 'voice' };
  } catch {
    return null;
  }
}
```

`src/stores/uiStore.js` — inside the existing `create((set) => ({ ... }))`, add:
```javascript
  // OS-level quick capture (deep links, widgets, Siri) — AppLayout reacts to this
  captureRequest: null,
  requestCapture: (mode = 'voice') => set({ captureRequest: { mode, ts: Date.now() } }),
  clearCaptureRequest: () => set({ captureRequest: null }),
```

`src/App.jsx` deep-link handler — at the top of `handleDeepLink` (line ~352), before the OAuth branches:
```javascript
        const capture = parseCaptureLink(event.url);
        if (capture) {
          console.log('[Engram] Capture deep link:', capture.mode);
          useUiStore.getState().requestCapture(capture.mode);
          return;
        }
```
with imports `import { parseCaptureLink } from './utils/deepLinks';` and `import { useUiStore } from './stores';` (check `src/stores/index.js` exports `useUiStore`; if not, import from `./stores/uiStore`).

`src/components/zen/AppLayout.jsx` — add near the other state (line ~92):
```javascript
  const captureRequest = useUiStore((s) => s.captureRequest);
  const clearCaptureRequest = useUiStore((s) => s.clearCaptureRequest);

  useEffect(() => {
    if (!captureRequest) return;
    setEntryMode(captureRequest.mode);
    setShowEntryModal(true);
    clearCaptureRequest();
  }, [captureRequest, clearCaptureRequest]);
```
(with the matching `useUiStore` import; `EntryBar` is already rendered `embedded` with `preferredMode={entryMode}` at line ~477, so voice auto-starts.)

- [ ] **Step 3: Run tests + build**

Run: `npx vitest run src/utils/__tests__/deepLinks.test.js src/stores/__tests__/uiStore.capture.test.js` — PASS. `npm test && npm run build` — green.

- [ ] **Step 4: Commit**

```bash
git add src/utils/deepLinks.js src/utils/__tests__/ src/stores/ src/App.jsx src/components/zen/AppLayout.jsx
git commit -m "feat: engram://capture deep link opens auto-recording via uiStore"
```

---

### Task 8: Cold-start launch URL handling

**Files:**
- Modify: `src/App.jsx` (deep-link effect, lines 349–387)

**Interfaces:**
- Consumes: `CapacitorApp.getLaunchUrl()`, Task 7's handler.
- Produces: cold-start (app not running) widget taps route into capture.

- [ ] **Step 1: Handle the launch URL**

The `appUrlOpen` listener only fires for warm/background opens. In the same `useEffect`, after registering the listener (line ~382), add:
```javascript
    // Cold start: if the app was launched via a deep link, appUrlOpen never fires.
    CapacitorApp.getLaunchUrl().then((result) => {
      if (result?.url) handleDeepLink({ url: result.url });
    }).catch(() => {});
```

- [ ] **Step 2: Device verification (needs Task 9's widget or Safari)**

On a device/simulator build (`npm run cap:ios`), from Safari open `engram://capture?mode=voice` with the app killed.
Expected: app launches → entry modal opens → recording auto-starts (mic indicator on). Time it: target under ~3s from tap to recording on a warm device; note the actual number in the PR description (spec's cold-start budget — if it's badly over, file a follow-up to defer dashboard hydration, don't blind-refactor now).

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: handle capture deep link on cold start via getLaunchUrl"
```

---

### Task 9: iOS WidgetKit extension (home + lock screen)

**Files:**
- Create (via Xcode): widget extension target `EngramWidget` in `ios/App/App.xcodeproj`
- Create: `ios/App/EngramWidget/EngramWidget.swift`
- Modify (Xcode-managed): `ios/App/App.xcodeproj/project.pbxproj`

**Interfaces:**
- Consumes: `engram://capture?mode=voice` deep link (Tasks 7–8).
- Produces: home-screen (`systemSmall`) and lock-screen (`accessoryCircular`, `accessoryRectangular`) widgets; tapping opens the app into recording. No App Group / data bridge needed — the widget is static (defer dynamic content to Phase 3).

- [ ] **Step 1: Create the target in Xcode**

```bash
npm run cap:ios   # builds web assets and opens Xcode
```
In Xcode: File → New → Target… → **Widget Extension**. Product Name: `EngramWidget`. UNCHECK "Include Live Activity" and "Include Configuration App Intent" (static widget). Activate the scheme when prompted. Set the widget target's iOS Deployment Target to match the app target (check the App target's setting and mirror it; must be ≥ 16.0 for lock-screen accessory families). Confirm bundle id is `com.echovault.engram.EngramWidget` and Signing uses the same team (automatic signing).

- [ ] **Step 2: Replace the template with the capture widget**

Delete the generated template Swift file(s) in the `EngramWidget` group, add `EngramWidget.swift`:
```swift
import WidgetKit
import SwiftUI

struct CaptureEntry: TimelineEntry {
    let date: Date
}

struct CaptureProvider: TimelineProvider {
    func placeholder(in context: Context) -> CaptureEntry { CaptureEntry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (CaptureEntry) -> Void) {
        completion(CaptureEntry(date: .now))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<CaptureEntry>) -> Void) {
        completion(Timeline(entries: [CaptureEntry(date: .now)], policy: .never))
    }
}

struct EngramCaptureWidgetView: View {
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "mic.fill")
                    .font(.title2)
            }
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Image(systemName: "mic.fill")
                VStack(alignment: .leading) {
                    Text("Brain dump").font(.headline)
                    Text("Tap to talk").font(.caption2).opacity(0.7)
                }
            }
        default: // systemSmall
            VStack(spacing: 10) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 34, weight: .semibold))
                Text("Brain dump")
                    .font(.subheadline.weight(.medium))
            }
        }
    }
}

struct EngramCaptureWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "EngramCapture", provider: CaptureProvider()) { _ in
            EngramCaptureWidgetView()
                .widgetURL(URL(string: "engram://capture?mode=voice"))
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Quick Capture")
        .description("One tap to start a brain dump.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct EngramWidgetBundle: WidgetBundle {
    var body: some Widget {
        EngramCaptureWidget()
    }
}
```

- [ ] **Step 3: Build + device verification**

Build the `App` scheme in Xcode onto a device (widgets are flaky in simulator; device preferred).
Expected: app installs; long-press home screen → add "Quick Capture" (Engram) widget; tap → app opens → recording auto-starts. Lock screen → customize → add the circular Engram widget below the clock → tap from lock screen → Face ID → recording. Verify both cold start (app killed) and warm.

- [ ] **Step 4: Commit**

```bash
git add ios/App
git commit -m "feat(ios): WidgetKit quick-capture widget (home + lock screen) deep-linking into recording"
```
Note for the PR: TestFlight/fastlane builds now include a second target; automatic signing should mint the widget profile — verify `cd ios && fastlane beta` succeeds before merging.

---

### Task 10: Siri / App Shortcuts (+ Action Button)

**Files:**
- Create: `ios/App/App/CaptureIntents.swift` (main app target membership ONLY for now)

**Interfaces:**
- Consumes: `engram://capture?mode=voice` deep link.
- Produces: `StartBrainDumpIntent` (AppIntent, `openAppWhenRun = true`) + `EngramShortcuts` (AppShortcutsProvider) — "Hey Siri, start a brain dump". Users can bind the Action Button to the shortcut via Settings. Task 13 (Control Center) reuses this intent.

- [ ] **Step 1: Add the intents file (in Xcode, to the App target)**

```swift
import AppIntents
import UIKit

struct StartBrainDumpIntent: AppIntent {
    static var title: LocalizedStringResource = "Start a Brain Dump"
    static var description = IntentDescription("Opens Engram and starts recording immediately.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        // Route through the same deep-link path the widget uses so behavior stays identical.
        if let url = URL(string: "engram://capture?mode=voice") {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

struct EngramShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartBrainDumpIntent(),
            phrases: [
                "Start a brain dump in \(.applicationName)",
                "Add a note in \(.applicationName)",
                "New thought in \(.applicationName)"
            ],
            shortTitle: "Brain Dump",
            systemImageName: "mic.fill"
        )
    }
}
```

- [ ] **Step 2: Device verification**

Build to device. In the Shortcuts app, confirm "Brain Dump" appears under Engram. Say "Hey Siri, start a brain dump in Engram" → app opens recording. Settings → Action Button → Shortcut → pick "Brain Dump" (if the device has one) → verify.
Gotcha to check: `UIApplication.shared.open` of the app's own scheme must fire Capacitor's `appUrlOpen`. If recording does NOT start, replace the `open(url)` body with posting through NotificationCenter to the Capacitor bridge:
```swift
NotificationCenter.default.post(name: Notification.Name.capacitorOpenURL, object: nil, userInfo: ["url": url])
```
and re-verify (one of the two reliably delivers the URL to the webview; keep whichever works and delete the other).

- [ ] **Step 3: Commit + Phase 2 PR**

```bash
git add ios/App
git commit -m "feat(ios): Siri app shortcut + Action Button support for instant capture"
git push -u origin feat/instant-capture-ios
gh pr create --title "Phase 2: iOS instant capture — widget, lock screen, Siri" --body "..."
```
Update `PROJECT_STATUS.md` Active Work + decision log (widget is static/deep-link, no App Group yet — revisit when widget shows dynamic data) in this PR.

---

# PHASE 3 — Capture-first reframe + polish (branch `feat/capture-first-reframe`)

### Task 11: Quick Capture bento widget + neutral capture copy

**Files:**
- Create: `src/components/zen/widgets/QuickCaptureWidget.jsx`
- Modify: `src/hooks/useDashboardLayout.js` (WIDGET_DEFINITIONS + default layout)
- Modify: `src/pages/HomePage.jsx:127` (copy)
- Test: `src/components/zen/widgets/__tests__/QuickCaptureWidget.test.jsx`

**Interfaces:**
- Consumes: uiStore `requestCapture` (Task 7).
- Produces: a Bento widget users get by default at the top of Home; tap → recording.

- [ ] **Step 1: Read the existing widget shape FIRST**

Open `src/hooks/useDashboardLayout.js` and one existing widget (e.g. `src/components/health/HealthInsightsWidget.jsx`). Note: the exact keys of a `WIDGET_DEFINITIONS` entry (id, title, component, size, etc.) and how defaults are seeded. The registration snippet in Step 3 MUST be adapted to that exact shape.

- [ ] **Step 2: Write the failing test**

```javascript
// src/components/zen/widgets/__tests__/QuickCaptureWidget.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import QuickCaptureWidget from '../QuickCaptureWidget';
import { useUiStore } from '../../../../stores/uiStore';

describe('QuickCaptureWidget', () => {
  it('requests voice capture on tap', () => {
    render(<QuickCaptureWidget />);
    fireEvent.click(screen.getByRole('button', { name: /brain dump/i }));
    expect(useUiStore.getState().captureRequest?.mode).toBe('voice');
  });
});
```
(If `@testing-library/react` is not in devDependencies, check how existing component tests render — follow that pattern instead; if there are no component tests, `npm install -D @testing-library/react` first.)
Run: expected FAIL (missing component).

- [ ] **Step 3: Implement**

```javascript
// src/components/zen/widgets/QuickCaptureWidget.jsx
import { Mic } from 'lucide-react';
import { useUiStore } from '../../../stores/uiStore';

/** Bento widget: the front door for brainstorm dumping. One tap → recording. */
const QuickCaptureWidget = () => {
  const requestCapture = useUiStore((s) => s.requestCapture);

  return (
    <button
      onClick={() => requestCapture('voice')}
      aria-label="Brain dump"
      className="w-full h-full min-h-[120px] rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white
                 flex flex-col items-center justify-center gap-2 active:scale-[0.98] transition-transform"
    >
      <Mic size={32} />
      <span className="font-medium">Brain dump</span>
      <span className="text-xs opacity-80">Tap and just talk</span>
    </button>
  );
};

export default QuickCaptureWidget;
```
(Check that `lucide-react` is the icon lib used elsewhere — `grep -rn "lucide-react" src/ | head -1`; if the codebase uses something else, match it.)

Register in `src/hooks/useDashboardLayout.js` following the exact shape found in Step 1, with id `quick-capture`, and put `quick-capture` FIRST in the default layout array so new/reset users get it at the top.

`src/pages/HomePage.jsx:127`: change `"Welcome to your sanctuary"` to `"What's on your mind?"`. Then sweep the other capture-surface copy only:
```bash
grep -rn "sanctuary\|therapeutic\|healing journey" src/pages/HomePage.jsx src/components/dashboard/EntryBar.jsx src/components/zen/AppLayout.jsx src/components/input/VoiceRecorder.jsx
```
Neutralize any hits on these four files only (wellness copy elsewhere — insights, guided sessions, safety — stays; the full brand-voice scrub is a separately tracked effort).

- [ ] **Step 4: Test, verify, commit**

Run: `npx vitest run src/components/zen/widgets/__tests__/QuickCaptureWidget.test.jsx && npm test && npm run build` — green.
Manual: reset dashboard layout (or fresh profile) → Quick Capture card is first; tap → recording starts.
```bash
git add src/components/zen/widgets/ src/hooks/useDashboardLayout.js src/pages/HomePage.jsx
git commit -m "feat: Quick Capture bento widget as default front door; neutral capture copy"
```

---

### Task 12: Background-recording go/no-go check (gates Task 13)

**Files:**
- Modify: `ios/App/App/Info.plist` (only if GO)

- [ ] **Step 1: Test current behavior on device**

Build to device. Start a recording, lock the phone, keep talking 30s, unlock, stop.
Expected observations to record in PROJECT_STATUS.md: does MediaRecorder deliver audio for the locked period (play back / check blob size ≈ 4KB/s × duration at 32kbps)?

- [ ] **Step 2: If audio stops at lock: try enabling background audio**

Add to `ios/App/App/Info.plist`:
```xml
	<key>UIBackgroundModes</key>
	<array>
		<string>audio</string>
	</array>
```
Rebuild, repeat Step 1.

- [ ] **Step 3: Decision gate**

- **GO** (locked-screen recording works reliably): proceed to Task 13 (Live Activity is truthful).
- **NO-GO** (recording dies on lock even with background audio): SKIP Task 13 entirely, remove the Info.plist change if it didn't help, and log in PROJECT_STATUS.md: "Live Activity deferred — WKWebView MediaRecorder does not survive lock; needs a native recorder module first." Proceed to Task 14.

Commit whichever outcome:
```bash
git add ios/App/App/Info.plist PROJECT_STATUS.md
git commit -m "chore(ios): background-recording go/no-go result"
```

---

### Task 13: Live Activity while recording (ONLY if Task 12 = GO)

**Files:**
- Create: `ios/App/App/RecordingActivityAttributes.swift` (target membership: BOTH App and EngramWidget)
- Create: `ios/App/App/RecordingActivityPlugin.swift` + `ios/App/App/RecordingActivityPlugin.m` (App target)
- Create: `ios/App/EngramWidget/RecordingLiveActivity.swift` (EngramWidget target)
- Modify: `ios/App/App/Info.plist` (`NSSupportsLiveActivities`)
- Create: `src/services/audio/recordingActivity.js`
- Modify: `src/components/dashboard/EntryBar.jsx` (start/stop hooks)

**Interfaces:**
- Consumes: EntryBar's recording lifecycle (recorder start at line ~175, stop handler).
- Produces: lock-screen Live Activity with elapsed time + Stop button; Stop ends recording in the webview via plugin event `stopRequested`.

- [ ] **Step 1: Shared attributes**

```swift
// RecordingActivityAttributes.swift (both targets)
import ActivityKit

struct RecordingActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var startedAt: Date
    }
}
```

- [ ] **Step 2: Info.plist**

```xml
	<key>NSSupportsLiveActivities</key>
	<true/>
```

- [ ] **Step 3: The Capacitor plugin (start/stop from JS, stop-request back to JS)**

```swift
// RecordingActivityPlugin.swift (App target)
import Capacitor
import ActivityKit

@objc(RecordingActivityPlugin)
public class RecordingActivityPlugin: CAPPlugin {
    private var activity: Any?

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(onStopRequested),
            name: Notification.Name("EngramStopRecording"), object: nil
        )
    }

    @objc private func onStopRequested() {
        notifyListeners("stopRequested", data: [:])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(["started": false]); return }
        let attributes = RecordingActivityAttributes()
        let state = RecordingActivityAttributes.ContentState(startedAt: Date())
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil)
            )
            call.resolve(["started": true])
        } catch {
            call.resolve(["started": false])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        Task {
            if let activity = activity as? Activity<RecordingActivityAttributes> {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            self.activity = nil
            call.resolve()
        }
    }
}
```
```objc
// RecordingActivityPlugin.m (App target) — Capacitor ObjC registration
#import <Capacitor/Capacitor.h>
CAP_PLUGIN(RecordingActivityPlugin, "RecordingActivity",
  CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
```

- [ ] **Step 4: The Live Activity UI + stop intent (widget target)**

```swift
// RecordingLiveActivity.swift (EngramWidget target)
import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents

struct StopRecordingIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop Recording"
    func perform() async throws -> some IntentResult {
        // LiveActivityIntent runs in the APP process — hand off to the plugin.
        NotificationCenter.default.post(name: Notification.Name("EngramStopRecording"), object: nil)
        return .result()
    }
}

struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            HStack {
                Image(systemName: "waveform").foregroundStyle(.red)
                Text("Recording")
                Text(context.state.startedAt, style: .timer).monospacedDigit()
                Spacer()
                Button(intent: StopRecordingIntent()) {
                    Image(systemName: "stop.fill")
                }
                .buttonStyle(.borderedProminent).tint(.red)
            }
            .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Image(systemName: "waveform").foregroundStyle(.red) }
                DynamicIslandExpandedRegion(.center) { Text(context.state.startedAt, style: .timer) }
                DynamicIslandExpandedRegion(.trailing) {
                    Button(intent: StopRecordingIntent()) { Image(systemName: "stop.fill") }.tint(.red)
                }
            } compactLeading: {
                Image(systemName: "waveform").foregroundStyle(.red)
            } compactTrailing: {
                Text(context.state.startedAt, style: .timer).monospacedDigit().frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "waveform").foregroundStyle(.red)
            }
        }
    }
}
```
Add `RecordingLiveActivity()` to the `EngramWidgetBundle` body in `EngramWidget.swift`.

- [ ] **Step 5: JS bridge + EntryBar hooks**

```javascript
// src/services/audio/recordingActivity.js
import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

const RecordingActivity = registerPlugin('RecordingActivity');

/** No-ops off iOS-native. onStopRequested fires when the Live Activity stop button is tapped. */
export const recordingActivity = {
  async start() {
    if (Capacitor.getPlatform() !== 'ios') return;
    try { await RecordingActivity.start(); } catch (e) { console.warn('[recordingActivity] start failed', e); }
  },
  async stop() {
    if (Capacitor.getPlatform() !== 'ios') return;
    try { await RecordingActivity.stop(); } catch (e) { console.warn('[recordingActivity] stop failed', e); }
  },
  onStopRequested(handler) {
    if (Capacitor.getPlatform() !== 'ios') return { remove: () => {} };
    return RecordingActivity.addListener('stopRequested', handler);
  }
};
```
In `src/components/dashboard/EntryBar.jsx`: after `recorder.start(1000)` (line ~175) call `recordingActivity.start()`; in the stop-recording handler call `recordingActivity.stop()`; register `recordingActivity.onStopRequested(() => stopRecording())` in a mount effect (use the component's actual stop function name — find it near the `recorder.stop()` call) and remove the listener on unmount. Add the import at the top.

- [ ] **Step 6: Device verification + commit**

Build to device. Start recording → Live Activity appears on lock screen with running timer → tap Stop on the Live Activity → recording stops, transcription runs, Activity dismisses.
```bash
git add ios/App src/services/audio/recordingActivity.js src/components/dashboard/EntryBar.jsx
git commit -m "feat(ios): Live Activity with stop button during recording"
```

---

### Task 14: Control Center control (iOS 18)

**Files:**
- Modify: `ios/App/App/CaptureIntents.swift` (change target membership of `StartBrainDumpIntent` to BOTH App and EngramWidget — in Xcode's File Inspector)
- Create: `ios/App/EngramWidget/EngramCaptureControl.swift` (EngramWidget target)

**Interfaces:**
- Consumes: `StartBrainDumpIntent` (Task 10; `openAppWhenRun = true` means the system launches the app when run from the control).
- Produces: a Control Center button (iOS 18+) that opens the app into recording.

- [ ] **Step 1: Implement**

```swift
// EngramCaptureControl.swift
import WidgetKit
import SwiftUI
import AppIntents

@available(iOS 18.0, *)
struct EngramCaptureControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "EngramCaptureControl") {
            ControlWidgetButton(action: StartBrainDumpIntent()) {
                Label("Brain Dump", systemImage: "mic.fill")
            }
        }
        .displayName("Engram Brain Dump")
        .description("Start recording a thought.")
    }
}
```
Add to `EngramWidgetBundle`:
```swift
        if #available(iOS 18.0, *) {
            EngramCaptureControl()
        }
```
Note: `UIApplication.shared.open` is unavailable in extension processes — but with `openAppWhenRun = true` the system opens the app BEFORE `perform()` executes in the app process, so the intent works from the control. If the compiler complains about UIKit in the extension, guard the `open(url)` call with `#if canImport(UIKit) && !EXTENSION` or split perform behavior; verify on device that tapping the control launches into recording.

- [ ] **Step 2: Device verification + commit**

iOS 18 device: Control Center → add control → "Engram Brain Dump" → tap → app opens recording. Optionally set it as a Lock Screen quick action (replacing flashlight/camera).
```bash
git add ios/App
git commit -m "feat(ios): Control Center quick-capture control (iOS 18)"
```

---

### Task 15: Announce + wrap up

**Files:**
- Modify: `src/components/shared/WhatsNewModal.jsx`
- Modify: `PROJECT_STATUS.md`

- [ ] **Step 1: What's New**

In `WhatsNewModal.jsx`: bump `FEATURE_VERSION` (e.g. `'2.1.0'` → `'2.2.0'`) and replace the feature list content with: better voice transcription, lock-screen/home-screen quick capture widget, "Hey Siri, start a brain dump", quick-capture home card, (if shipped) lock-screen recording controls.

- [ ] **Step 2: PROJECT_STATUS.md**

Update Active Work; add decision rows (capture-first home default, Live Activity go/no-go outcome, Control Center added). Note deferred items: Android capture surfaces, App-Group dynamic widget data, replay-original UI on entries, restyle actions ("tighten/structure/expand").

- [ ] **Step 3: Final verification + PR**

```bash
npm test && npm run build
git add src/components/shared/WhatsNewModal.jsx PROJECT_STATUS.md
git commit -m "chore: What's New for brainstorm-capture release; status updates"
git push -u origin feat/capture-first-reframe
gh pr create --title "Phase 3: capture-first home, Live Activity, Control Center" --body "..."
```
After merge: TestFlight build (`cd ios && fastlane beta`), dogfood the full loop: lock screen tap → talk → auto-saved clean entry.

---

## Deferred (explicitly NOT in this plan)

- Android widget / Quick Settings tile (researched, viable; do when Android users matter)
- App Group + dynamic widget content (entry counts, streaks) via `capacitor-widget-bridge`
- Replay-original audio player on entry detail (vault retains audio + `linkEntry` makes it possible)
- Restyle actions on entries ("tighten", "structure", "expand")
- Streaming/live transcript display
- AssemblyAI/Deepgram as a third transcription engine
