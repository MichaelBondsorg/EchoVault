# Trustworthy capture — rollout runbook

Operational reference for the Trustworthy Capture Sprint
(`docs/superpowers/plans/2026-07-20-trustworthy-capture-and-intelligence.md`).
Covers flags, telemetry, retention, rollback, and incident ownership for
everything the sprint shipped: fail-closed AI consent, owner-scoped local
caches, core-first save, the persistent operation state machine, capture
durability (web + native), and the native background-upload vertical slice.

See also `docs/quality/device-validation-matrix.md` for the physical-device
checklist and `src/__tests__/validationMatrix.test.js` for the automated
validation-matrix tests this runbook complements.

## Flags

All flags live in the single Firestore doc `config/flags`
(`artifacts` root, NOT owner-scoped — one doc for the whole app). Clients
read it once at startup via `initFlags()` and cache it in module state
(`src/config/flags.js`); functions read it per-invocation with a 60s
in-memory cache (`functions/src/shared/flags.js`). **No app/functions deploy
is required to flip any of these** — editing the Firestore doc takes effect
on the next client `initFlags()` call (next launch/reload) and within 60s
server-side. `firestore.rules` restricts `config/flags` to authenticated
read-only for clients; only the Admin SDK/Firebase console can write it.

| Flag | Default | What it gates | Turning it OFF restores | Where consumed |
|---|---|---|---|---|
| `coreFirstSave` | `true` | Persisting the core journal entry FIRST (before any optional enrichment), with enrichment moved to an async post-save `updateDoc` (`enrichmentRunner.js`). | The legacy inline pre-save enrichment path in `App.jsx` (health/location/weather awaited before the entry write). | `src/App.jsx:1330,1791` |
| `serverAnalysisOrchestrator` | `false` | Skipping the client-side classify/analyze/insight/context chain after save, because the server `onEntryCreatedAnalysis` trigger owns it end-to-end. | The client-owned analysis chain (`runAnalysisChain` in `postSavePipeline`'s caller) — safe fallback if the server orchestrator misbehaves. | `src/services/entries/postSavePipeline.js:34` |
| `nativeBackgroundUpload` | `false` | The native background-upload vertical slice: signed-URL PUT from `BackgroundUploader.swift`, server-side `onCaptureAudioUploaded` transcription + entry creation. **Fail-safe when off**: any object that somehow lands in `capture-uploads/**` is deleted without transcription (`onAudioUploaded.js` step 1). | The existing foreground base64 transcription pipeline (`transcribeEntryFn` et al.) — capture still works, just without background continuation. | Server: `functions/index.js` (`issueCaptureUploadTicket` callable, gates before signing), `functions/src/capture/onAudioUploaded.js` (`NATIVE_BACKGROUND_UPLOAD_FLAG`). **Client wiring status: incomplete** — see Known gaps below. |
| `webChunkPersistence` | `true` | Web `MediaRecorder` chunks writing incrementally to IndexedDB (`webChunkStore.js`) as they arrive, instead of only living in a RAM closure until Stop. Additive durability; default-on. | The RAM-only chunk array — a tab crash/reload mid-recording loses the in-progress web recording. | `src/components/dashboard/EntryBar.jsx:88,179` |
| `intentExtraction` | `false` | Async server-side intent extraction (PRD 0B, `functions/src/intents/extractIntents.js`) feeding the policy-qualified `TasksWidget`. Not part of this sprint's capture-durability surface. | The legacy `extracted_tasks` local-analysis path. | Batch 7 (I1–I4) — not yet implemented as of this runbook's writing. |
| `model.gemini35flash` | `false` | Flips `classify`/`analyze` from the preview `gemini-3-flash-preview` default to GA `gemini-3.5-flash`. | The preview model default. | Model registry (`functions/src/models/registry.js`) — **not yet implemented**; see § Model registry flip procedure below. |
| `model.embeddingV2Read` | `false` | Reading `embeddingV2` (gemini-embedding-2) instead of the legacy `embedding` field at retrieval sites, once dual-write backfill (M3) has run. | Legacy `embedding` field reads. | Retrieval read sites (RAG/askJournal) — **not yet implemented**; see embedding v2 cutover note below. |
| `model.fusedTranscription35` | `false` | Shadow/cutover testing of fused transcription on `gemini-3.5-flash` instead of the current `gemini-2.5-flash` default. | The `gemini-2.5-flash` fused-transcription default. | Transcription call sites — **not yet implemented** (fused transcription is currently a hardcoded model string, per the plan's Ground Truth section; the registry work in Batch 6/M1 replaces it). |

**Local dev override:** any flag can be forced client-side without touching
Firestore via `localStorage['engram:flag:' + name] = 'true' | 'false'`
(`readLocalOverride` in `flags.js`) — takes precedence over the fetched doc,
useful for testing a flag flip before committing to the shared doc.

**Unknown flag names throw in DEV** (`getFlag` in `flags.js`) so a typo is
caught immediately in development, and silently return `false` in PROD so a
bad flag lookup never breaks a production build.

## Stage telemetry reference

Non-content structured progress events for the capture pipeline. Never
carries journal text, transcripts, or prompts — only identifiers, durations,
byte counts, and error codes (see `META_WHITELIST` in both copies below,
which are asserted to stay in sync via code comment cross-reference).

- **Client ring buffer**: `src/services/telemetry/captureTelemetry.js`.
  Appends to an owner-scoped Capacitor Preferences ring buffer
  (`capture_stages::{uid}`, capped at 200 entries, oldest dropped first).
  Also logs `console.info('[capture-stage]', stage, opId)` on every call —
  useful for local device console debugging (see device matrix's "How to
  run this" step 4). Read via `getRecentStages(uid, limit)`.
- **Server structured logs**: `functions/src/telemetry/stageLog.js`'s
  `logStage(operationId, stage, meta)` emits one JSON line per event:
  `{"type":"stage","opId":...,"stage":...,"at":...,...whitelisted meta}`.
  Queryable in Cloud Logging.

### Cloud Logging query examples

All capture-stage log lines:
```
jsonPayload.type="stage"
```

A specific operation's full timeline (chronological — sort by timestamp
ascending in the Logs Explorer):
```
jsonPayload.type="stage"
jsonPayload.opId="<operation-id>"
```

Every op that surfaced `needs_attention` in the last 24h (candidates for a
support/incident sweep):
```
jsonPayload.type="stage"
jsonPayload.stage="needs_attention"
timestamp>="2026-07-19T00:00:00Z"
```

Errors by error code (bucket incidents by cause, e.g. after a provider
outage):
```
jsonPayload.type="stage"
jsonPayload.errorCode="network_error"
```

Background-upload retention sweeper activity (uses the server-only `count`
whitelist field):
```
jsonPayload.type="stage"
jsonPayload.opId=NULL
jsonPayload.count>0
```
(the sweeper logs with `operationId: null` — see `sweepCaptureUploads` in
`functions/src/capture/onAudioUploaded.js`.)

Whitelisted meta fields (client + server shared):
`durationMs`, `bytes`, `engine`, `retryCount`, `errorCode`, `platform`,
`queueDepth`. Server-only additions: `modelId`, `uidHash`, `uid`, `count`.
Anything else (a stray `text`/`transcript` key) is silently dropped before
it's ever logged or persisted — this is enforced in code, not just by
convention.

## Raw-audio retention policy

Two distinct raw-audio surfaces, two distinct retention windows:

1. **Client audio vault** (`src/services/audio/audioVault.js`) — the
   durable local copy every recording gets before transcription is
   attempted. Retention: **7 days** (`RETENTION_DAYS`), swept by
   `cleanupExpired(ownerUid)`. This is the "previous durable copy" half of
   the sprint's core durability invariant (either the native draft or the
   vault recording exists at every destructive boundary) — it is NOT
   deleted on transcription success; it ages out on its own schedule so a
   user can still recover/replay recent audio even after a successful save.
2. **`capture-uploads` Cloud Storage bucket** (native background-upload
   path only, flag `nativeBackgroundUpload`) — raw `.m4a` files uploaded via
   signed URL for server-side transcription. Retention:
   **delete-on-transcript-success** (`onAudioUploaded.js`'s
   `processCaptureAudioObject` calls `safeDelete()` immediately after the
   entry is created), with a **24-hour sweeper** (`sweepCaptureUploads`,
   `RETENTION_MAX_AGE_MS = 24 * 60 * 60 * 1000`) as the backstop for
   anything left behind by a transcription failure, an exception, or a
   feature-flag-off / consent-denied deletion path. This bucket never
   accumulates raw audio older than 24h under any code path.

Neither surface stores journal text/transcripts as a retention concern —
those live only in Firestore, subject to the app's normal data-deletion
flows (`deleteAccount` callable), not this runbook.

## Rollback checklist

Before rolling back ANY change in this sprint's surface (flag flip, code
revert, or both):

- [ ] **Rollback never deletes durable assets.** Flipping a flag off changes
      which CODE PATH runs going forward; it does not retroactively delete
      the client audio vault, `capture_ops` records, or entries already
      written. Verify: `audioVault.deleteRecording`/`clearOwner` and
      `operationStore`'s write paths are only ever called from explicit
      user actions (Discard) or the vault's own 7-day/24h age-based sweeps —
      never from a flag-read branch. Grep `getFlag(` sites under
      `src/services/audio/`, `src/services/capture/` before any rollback to
      confirm none gate a delete.
- [ ] **Rollback never re-enables revoked consent.** `revokeAiConsent`
      (`src/services/consent/consentService.js`) is fail-closed by design:
      the local marker flips synchronously and a failed/rejected callable
      NEVER re-enables it (see the module's own doc comment and
      `consentService.test.js`'s "never re-enables local state after a
      rejected callable" test). Server-side, `revokeAiProcessing`
      (`functions/index.js:525`) writes an authoritative
      `{aiProcessing:false}` doc and `assertAiConsent`
      (`functions/src/consent/consentGate.js`) fails CLOSED on any read
      error — an outage or a rollback of unrelated code can only ever
      deny AI processing more aggressively, never silently restore it. A
      grant requires an explicit, separate user action
      (`grantAiConsent`/`grantAiProcessing`) — there is no code path where
      rolling back a deploy grants consent as a side effect.
- [ ] Confirm the rollback target's `npm test` / `npm run build` /
      (functions) suites were green at that commit — do not roll back to a
      known-red commit under incident pressure.
- [ ] After rollback, spot-check `docs/quality/device-validation-matrix.md`
      rows relevant to whatever changed, on a physical device, before
      declaring the incident closed.

## Incident ownership

**Michael** owns all incidents in this surface (solo-developer project —
see root `CLAUDE.md`). There is no on-call rotation; treat any
`needs_attention` spike, consent-gate failure, or capture data-loss report
as a P0 requiring Michael's direct attention. Use the Cloud Logging queries
above to scope an incident's blast radius (single op vs. systemic) before
deciding whether a flag flip (fast, no deploy) or a code rollback (slower,
needs a green gate) is the right response.

## Embedding v2 cutover steps

Dual-index migration to `gemini-embedding-2` (M3). The v1 space
(`text-embedding-004`) stays live throughout; the two spaces are never mixed
(`scoreSameSpace` in `functions/src/ai/embeddingV2.js` throws if a v2 query
vector is scored against a v1 doc vector, or vice versa).

1. **Enable dual-write.** Set `model.embeddingWriteV2: true` in the
   `config/flags` doc (default off). Within the 60s flag TTL, `onEntryCreate`
   starts writing `embeddingV2` + `embeddingMeta` ({model, dim, taskType,
   createdAt}) alongside the legacy `embedding` field. v2 vectors cache under
   `sha256(uid+':v2:'+text)[:24]` — a distinct keyspace from v1. The write is
   fail-open: a v2 failure never blocks the v1 vector.
2. **Backfill existing entries.** Run the admin script (never CI):
   `GOOGLE_APPLICATION_CREDENTIALS=… GEMINI_API_KEY=… NODE_PATH=functions/node_modules
   node scripts/backfill-embeddings-v2.js --dry-run` first to preview counts,
   then without `--dry-run`. It is batched (50, 200ms/batch), resumable
   (checkpoint doc `migration_state/embeddingsV2`; `--restart` to ignore it),
   per-user consent-gated (skips `settings/consent.aiProcessing === false`),
   and idempotent (skips entries that already have `embeddingV2`).
3. **Verify counts** before flipping reads: confirm the bulk of entries now
   carry `embeddingV2` (checkpoint `updated`/`skipped`, or a Firestore query).
4. **Flip reads.** Set `model.embeddingV2Read: true`. The rule: when the query
   AND the docs both have v2 vectors, score in the v2 space EXCLUSIVELY; else
   fall back to v1. **Caveat:** `functions/` only *writes* embeddings — the RAG
   scoring consumers are client-side (`src/services/rag/*`,
   `src/services/ai/embeddings.js`) and still read the v1 `embedding` field.
   Switching those consumers to `scoreSameSpace({vector,space})` is a follow-up
   outside M3's file ownership; until it lands, flipping the read flag has no
   client-visible effect.
5. **(Later) retire v1.** Once every entry has v2 and the read path is v2-only,
   drop the `embedding` field + the `text-embedding-004` path and the
   `embedding` workload default.

## Model registry flip procedure

The server-owned registry (`functions/src/models/registry.js`, M1) is the
single source of truth for AI model ids. `getModel(db, workload)` resolves a
`config/flags` field `model.<workload>` (string override) over
`MODEL_DEFAULTS`, cached 60s via `getServerFlag`; `getModelSync(workload)` is
the defaults-only accessor for sync call sites.

**To change a model with NO deploy:** set the `model.<workload>` field in the
`config/flags` Firestore doc to the new model id (Admin SDK / console only).
Takes effect within the 60s flag cache TTL. Example — flip classification and
analysis from the preview model to `gemini-2.5-flash` by setting
`model.classify` and `model.analyze` to `gemini-2.5-flash` (this is the
intended path for the classify/analyze bump; no code change).

Workload → default (as of M2):

| Workload | Default | Notes |
|---|---|---|
| classify / analyze / insight / entityResolution | `gemini-3-flash-preview` | bump via `model.classify` / `model.analyze` |
| chat | `gpt-4o-mini` | |
| chatFallback | `gpt-4o` | |
| embedding | `text-embedding-004` | legacy v1 space |
| embeddingV2 | `gemini-embedding-2` | dual-index (flag-gated) |
| transcriptionFallback | `whisper-1` | |
| fusedTranscription | `gemini-2.5-flash` | |
| tone / digest / temporal | `gemini-3.5-flash` | replaced shut-down Gemini 2.0 paths |
| realtimeNA | `gpt-realtime-2.1` | owned by relay env `REALTIME_MODEL`, not this registry |

**Relay-server models** (`REALTIME_MODEL`, `WHISPER_MODEL`, `CHAT_MODEL`,
`TTS_MODEL`, `TONE_MODEL`) are env vars, not `config/flags` keys — changing one
needs a Cloud Run env/redeploy, not a flag flip.

## Known gaps (accurate as of this runbook's writing)

- **`nativeBackgroundUpload` client wiring is incomplete.** The server side
  (`issueCaptureUploadTicket` callable, `onCaptureAudioUploaded` trigger,
  `captureUploadsRetention` sweeper) and the Swift side
  (`ios/App/App/Capture/BackgroundUploader.swift`) exist, but no client JS
  call site requests an upload ticket or invokes `BackgroundUploader` yet —
  `prepareDurableRecording.js` and the capture pipeline have no
  `getFlag('nativeBackgroundUpload')` branch. **Flipping this flag on today
  has no effect**: nothing client-side triggers the background-upload path,
  so device-validation-matrix rows 5 and 6 cannot be exercised until that
  wiring lands. This is a FINDING for whoever picks up the remainder of
  Task B5 (or a follow-up task), not something this runbook's author
  (task D34) was scoped to fix — flagged here so it isn't mistaken for an
  already-shipped, flag-gated capability.
- **Model registry (M1–M4) has landed.** `functions/src/models/registry.js`
  now owns every AI model id; the `model.<workload>` keys in `config/flags`
  are read by `getModel`, and the shut-down Gemini 2.0 digest/tone paths plus
  the deprecated realtime preview have been retired (see "Model registry flip
  procedure" and "Embedding v2 cutover steps" above). The intent system
  (I1–I4) remains a future batch — its `FLAG_DEFAULTS` rows are still
  forward-declared, not currently actionable.
