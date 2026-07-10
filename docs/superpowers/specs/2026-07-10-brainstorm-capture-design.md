# Brainstorm-First Capture: Transcription Upgrade + iOS Instant Capture

**Date:** 2026-07-10
**Status:** Approved direction, pending spec review
**Decisions locked:** Gemini 2.5 Flash for fused transcription · auto-save with edit-later (no review gate) · iOS-only widget work for now

## 1. Goal & Positioning

Reposition Engram from "mental-health journal you open to reflect" to "frictionless brain-dump tool that happens to understand you." The user should be able to blurt a thought from the lock screen in one tap. Mental-health features (mood, insights, safety, guided sessions) remain, but as a layer *over* captured entries rather than the front door.

Scope guardrail (validated by market research): optimize for 1–5 minute personal rambles. Do **not** chase meeting transcription, speaker diarization, or long-recording features — that is Otter's territory; AudioPen-style brain-dumping is the analogue that wins here.

Non-negotiable invariant from the research: **reliability is the category's defining trust factor.** Lost recordings (Whisper Memos, Voicenotes) are the most damaging verified failure mode in this market. Raw audio must reach durable local storage the moment recording starts and must never depend on a successful cloud round-trip.

## 2. Phase 1 — Transcription pipeline (web + Cloud Functions only, no native work)

### 2.1 Current state (what we're replacing)

- Recording: `MediaRecorder` webm/opus at **16 kbps** (`VoiceRecorder.jsx`, `EntryBar.jsx`) — too low; hurts STT accuracy at the source.
- Transcription: Cloud Function `transcribeAudio` (`functions/index.js:1088`) / `transcribeWithTone` (`:1310`) → OpenAI `whisper-1`.
- "Cleanup": regex filler-strip (`functions/index.js:1168`, `:1391`) that deletes every "like/so/well/actually/basically" — destructive to meaning. Removed entirely.
- Tone: a *second* model call sending audio to Gemini (`gemini-2.0-flash-exp`) for `{moodScore, energy, emotions, confidence, summary}`.
- Durability: audio backed up as base64 in `localStorage` (`echov_audio_backup_*`, 10 MB cap) — fragile.

### 2.2 New pipeline: one fused Gemini call

Replace Whisper + regex + separate tone call with **a single Gemini 2.5 Flash multimodal request** (audio inline) returning structured JSON:

```json
{
  "transcript": "cleaned transcript — light cleanup only",
  "toneAnalysis": { "moodScore": 0, "energy": "", "emotions": [], "confidence": 0, "summary": "" }
}
```

(Title/tags stay with the existing `analyzeJournalEntry` pipeline, which already classifies and titles entries downstream — duplicating them in the transcription call would risk conflicts for no gain. This also keeps the response contract identical to today's `transcribeWithTone`, making the client switch a flagged one-liner.)

Cleanup instructions ported **verbatim in spirit from Cosmo** (`chief-of-staff/ui/backend/src/services/gemini.ts` `TRANSCRIPTION_PROMPT`), which is the proven piece:

> Transcribe this audio with light cleanup:
> - Remove filler words (um, uh, like, you know, basically, sort of)
> - Remove false starts and self-corrections
> - Keep the natural flow but make it readable
>
> Do NOT: restructure into bullet points, fix proper nouns you don't recognize, summarize or condense meaning.

The key property: the cleanup model *hears the audio*, so disfluency removal is far more accurate than any text-only pass — and it costs ~$0.002/min (Flash audio-in $1.00/1M tokens, ~32 tokens/audio-sec), vs. Whisper's $0.006/min for a worse result.

Implementation notes:
- New/updated callable in `functions/index.js` (or extracted module under `functions/src/`): `transcribeEntry` accepting `{ audio, mimeType }`, calling Gemini with `responseMimeType: application/json` + response schema. Existing daily quota (`DAILY_QUOTA.transcribe`) applies unchanged.
- **Verify the exact live model alias at implementation time** (list-models call or a smoke request) before wiring — do not assume `gemini-2.5-flash` is the current id in the account (per prior model-rename lesson). Config in `src/config/ai.js` updated to match reality, not aspiration.
- **Fallback:** on Gemini failure/empty transcript, retry once, then fall back to the existing Whisper path (kept, minus the regex). Client retry/backoff in `src/services/ai/transcription.js` stays.
- Premium gating unchanged: tone/insights remain behind `voice.insights` where currently gated; the fused call simply omits/ignores the tone block for free-tier processing if that's how gating works today (implementation detail — follow current gate placement).

### 2.3 Recording quality

Raise `audioBitsPerSecond` from 16000 to **32000** (opus voice sweet spot; still ~240 KB/min). Keep webm/opus with mp4 fallback as today.

### 2.4 Durability (the trust fix)

- On record start, stream/timeslice chunks to **Capacitor Filesystem** (native) instead of accumulating only in memory; on web, keep in-memory + IndexedDB backup. Replace the `localStorage` base64 backup (`echov_audio_backup_*`) with file-based storage — no 10 MB cliff.
- Failed uploads enqueue into the existing offline queue machinery (`offlineManager` / `syncOrchestrator`) with the audio file path, drained on reconnect.
- Raw audio file is retained until the entry (transcript) is confirmed persisted to Firestore; entry stores a `hasRawAudio` flag while local audio exists so "view/replay original" is possible. (Retention window: until successful sync + N days, configurable; default 7.)
- Delete the dormant, never-registered `public/sw-audio.js` (superseded by this design) or explicitly wire it — decision: **delete**, one mechanism only.

### 2.5 Post-capture UX (decision: auto-save)

- Recording stops → entry is created **immediately** in a `processing` state (visible in feed with a subtle spinner) → fused call returns → entry updates in place with cleaned transcript, title, tags, tone.
- No review modal. Editing happens by tapping the entry. An "original" affordance shows the verbatim-ish state: keep the pre-edit transcript revision, and while raw audio is retained locally, allow replay.
- If transcription ultimately fails after retries + fallback: entry remains as an "audio saved — transcription pending" card with a manual retry button. **Audio is never lost because the transcript failed.**

## 3. Phase 2 — iOS instant capture (native work)

Target: **one tap from lock screen or home screen to actively recording.**

### 3.1 Deep link fast path

- Add `engram://capture?mode=voice` (and `mode=text`) handling to the existing deep-link listener (`src/App.jsx:349–387`, currently OAuth-only). Route straight to the Entry Modal with `EntryBar` in embedded mode — its auto-start behavior (`shouldAutoStartVoice`) already begins recording on mount.
- Cold-start budget: capture route must short-circuit non-essential startup work (dashboard data fetches, insights) — capture screen first, hydrate the rest behind it.

### 3.2 WidgetKit extension

- New widget extension target in `ios/App` (SwiftUI — WidgetKit cannot host a webview). Surfaces:
  - **Home screen widget**: big record button (+ optional small "streak/last entry" text), `Button(intent:)` on iOS 17+.
  - **Lock screen accessory widget** (circular/rectangular): mic glyph, one tap.
- The record action is an **App Intent that opens the app** into `engram://capture?mode=voice`. Apple's docs confirm audio-related intents execute in the app process — recording purely inside the widget extension is not a supported pattern, so 1-tap-to-app-recording is the ceiling, and it matches what AudioPen/Voicenotes ship.
- The Phase 2 widget is **static** (a capture button with a `widgetURL` deep link), so it needs **no App Group and no data-bridge plugin**. App Group (`group.com.echovault.engram`) + a bridge plugin (`capacitor-widget-bridge` or `@capgo/capacitor-widget-kit`) come only when the widget shows dynamic data (entry counts, streaks) — explicitly deferred.

### 3.3 Near-free additions once the App Intent exists

- **App Shortcuts / Siri**: "Hey Siri, add a note in Engram."
- **Action Button** support (it just invokes the shortcut/intent).
- Deferred to Phase 3: Live Activity during recording (stop button), Control Center control (iOS 18).

Android (widget + Quick Settings tile with `requestAddTileService()`) is researched and viable but **explicitly deferred** — iOS only for now.

## 4. Phase 3 — The reframe + polish

- **Capture-first home**: the app opens to (or one swipe from) a big record affordance; the Bento dashboard, insights, prompts, and guided sessions become destinations, not the front door. Copy audit: replace therapy-forward framing ("sanctuary") with neutral capture language on entry surfaces; wellness language stays inside the insights/support areas.
- **Safety stays fully intact**: crisis detection (`src/services/safety/`, `functions/src/safety/crisisKeywords.js`) runs on entry text and is unaffected by any of this. Safety Plan / Crisis Resources / Therapist Export screens remain, reachable from settings/support rather than primary nav.
- Live Activity while recording (stop/pause from lock screen), Control Center control, and richer widget states.
- Optional later: AudioPen-style restyle actions on an entry ("tighten", "structure", "expand") as explicit, reversible transforms — never applied by default.

## 5. Error handling summary

| Failure | Behavior |
|---|---|
| Gemini call fails/empty | 1 retry → Whisper fallback → "transcription pending" entry with manual retry; audio retained |
| Offline at capture | Entry saved locally with audio file; queued via offline queue; transcribed on sync |
| App killed mid-recording | Timesliced chunks already on Filesystem; on next launch offer "recover recording" |
| Oversized recording | No hard cap; chunked upload; quota errors surface as pending-transcription, not data loss |

## 6. Testing

- Unit: fused-call response parsing (schema violations, empty transcript, partial JSON), fallback chain, offline queue with audio file paths (vitest, existing setup).
- Function tests: `transcribeEntry` happy path + Gemini error → Whisper fallback (mock fetch).
- Manual/device: cold-start deep link timing, widget tap → recording latency, kill-mid-recording recovery, airplane-mode capture → sync.
- Rollout: Phase 1 behind a config flag with Whisper path as instant rollback; TestFlight dogfood before default-on.

## 7. Out of scope

Meeting transcription/diarization · Android capture surfaces (deferred, researched) · removing any mental-health/safety feature · streaming/live transcript display (batch fused call is the right fit for 1–5 min memos; revisit only if latency proves annoying in dogfood).
