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
| `model.<workload>` (string) | (unset) | **Authoritative model lever.** A string value in `config/flags` for a key like `model.classify`, `model.analyze`, `model.insight`, `model.embedding`, `model.embeddingV2`, `model.fusedTranscription`, `model.tone`, `model.digest`, `model.transcriptionFallback` overrides that workload's default. | Removing the key → the compiled `MODEL_DEFAULTS`. | `functions/src/models/registry.js` `getModel(db, workload)` — LIVE at every threaded call site (see § Model registry flip procedure for the real/inventory-only breakdown). |
| `model.gemini35flash` (bool) | `false` | **Vestigial.** Predates the registry; NO code reads it. To move classify/analyze to `gemini-3.5-flash`, set the string keys `model.classify` / `model.analyze` instead. | n/a | Not consumed anywhere — follow-up: remove from client `FLAG_DEFAULTS`. |
| `model.fusedTranscription35` (bool) | `false` | **Vestigial.** The registry string key `model.fusedTranscription` WINS. NO code reads this boolean. | n/a | Not consumed — follow-up: remove from client `FLAG_DEFAULTS`. |
| `model.embeddingWriteV2` (bool) | `false` | Dual-writes a gemini-embedding-2 `embeddingV2` vector + `embeddingMeta` alongside the legacy `embedding` field, generated INDEPENDENTLY of the v1 attempt (embeddings migration M4). | No v2 writes — new entries then get NO vector at all, since v1 is retired (see v1-retirement note below); this flag is effectively **required ON** for new entries to be retrievable at all. | `functions/src/models/registry.js` (`MODEL_FLAG_DEFAULTS`) → read in `generateEmbeddingInternal`. LIVE (server write path). |
| `model.embeddingV2Read` (bool) | `false` | Makes client retrieval read `embeddingV2` (same-space, via `scoreEntryInBestSpace`) instead of/alongside the legacy `embedding` field. **Post-M4 this flag is REQUIRED for any semantic retrieval** — see the v1-retirement note below. | Client `generateQueryEmbeddings` requests v1 ONLY, which — now that v1 is retired upstream — always resolves to `null`, so retrieval degrades to keyword-only. This is exactly pre-migration prod behavior, faithfully reproduced (not a new regression). | LIVE both sides as of embeddings migration task M2 (`src/services/ai/embeddingSpaces.js`'s `scoreEntryInBestSpace`, wired through `src/services/ai/embeddings.js`, `src/services/rag/*`, `src/services/analysis/index.js` `getSmartChatContext`, `src/components/chat/Chat.jsx`). |

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

Dual-index migration to `gemini-embedding-2` (plan tasks M1/M2). The v1 space
(`text-embedding-004`) was originally meant to stay live throughout — see the
**v1-retirement note** immediately below, which supersedes step 5 here: v1 is
now permanently dead upstream, not a "later" cleanup. The two spaces are
never mixed regardless (`scoreSameSpace` server-side / `scoreEntryInBestSpace`
client-side both refuse a cross-space comparison).

1. **Enable dual-write.** Set `model.embeddingWriteV2: true` in the
   `config/flags` doc (default off). Within the 60s flag TTL, `onEntryCreate`
   starts writing `embeddingV2` + `embeddingMeta` ({model, dim, taskType,
   createdAt}) alongside the legacy `embedding` field — the two are generated
   INDEPENDENTLY (M4), so a v1 failure (the permanent case post-retirement)
   never prevents the v2 write. v2 vectors cache under
   `sha256(uid+':v2:'+text)[:24]` — a distinct keyspace from v1.
2. **Backfill existing entries.** Run the admin script (never CI):
   `GOOGLE_APPLICATION_CREDENTIALS=… GEMINI_API_KEY=… NODE_PATH=functions/node_modules
   node scripts/backfill-embeddings-v2.js --dry-run` first to preview counts,
   then without `--dry-run`. It is batched (50, 200ms/batch), resumable
   (checkpoint doc `migration_state/embeddingsV2`; `--restart` to ignore it),
   per-user consent-gated (skips `settings/consent.aiProcessing === false`),
   and idempotent (skips entries that already have `embeddingV2`). **Gap mode
   (M4):** add `--include-missing-v1` to additionally target entries with
   text but NEITHER vector (created after v1's retirement but before Step 0
   was fixed to write v2 independently) — writes `embeddingV2` only, never
   fabricates `embedding`. Gap mode uses its own checkpoint doc
   (`migration_state/embeddingsV2gap`) so it never races the default mode's
   `migration_state/embeddingsV2` checkpoint.
3. **Verify counts** before flipping reads: confirm the bulk of entries now
   carry `embeddingV2` (checkpoint `updated`/`skipped`, or a Firestore query).
4. **Flip reads.** Set `model.embeddingV2Read: true`. LIVE both sides as of
   plan task M2: the client (`src/services/ai/embeddings.js`
   `generateQueryEmbeddings`, `src/services/ai/embeddingSpaces.js`
   `scoreEntryInBestSpace`, wired through every RAG/chat/context retrieval
   seam) scores an entry in v2 when both the query and the entry have a v2
   vector, else falls back to v1 — **except that fallback is now moot for new
   queries, since v1 is permanently dead** (see v1-retirement note). This
   flag is therefore not merely "flip when ready" anymore — it is **required
   ON** for any semantic retrieval to function post-retirement.
5. ~~**(Later) retire v1.**~~ **Superseded — v1 was retired upstream by
   Google, unscheduled, on/before 2026-07-22.** See the note immediately
   below. The `embedding` field/`text-embedding-004` code path is being kept
   as a best-effort legacy path (not deleted), not proactively dropped.

### v1-retirement note (embeddings migration M4, dated 2026-07-22)

**Verified live 2026-07-22:** Google retired `text-embedding-004`. The v1
`embedContent` endpoint now returns 404 ("not found for API version
v1beta") on every call, unconditionally — this is not a rate limit or a
transient outage, and there is no known restoration date. Consequences,
confirmed by direct code reading before the fix:

- **Server:** `generateEmbeddingInternal`'s v1 fetch threw before the v2
  block was ever reached, so **every new entry got zero vectors** — Step 0
  (`onEntryCreate`) silently produced nothing. Fixed (M4): v1 and v2 are now
  generated INDEPENDENTLY; v1 failure is caught, logged once (structured),
  and resolves `embedding: null` without blocking the (already flag-gated,
  already fail-open) v2 attempt.
- **Client:** `generateQueryEmbeddings` used to null out its ENTIRE result
  the moment the v1 call failed, even when v2 succeeded — so with
  `model.embeddingV2Read` ON, every semantic query degraded to keyword-only
  despite full v2 entry coverage. Fixed (M4): the function now returns
  whichever space(s) actually succeeded (`{v1,v2}`, `{v2}`, or `{v1}`); it
  returns `null` only when BOTH fail. A v1 failure is logged at `warn`, not
  `error` (v1 is known-dead — screaming on every single query is alarm
  fatigue for a permanent, expected condition).
- **Net effect:** `embedding`/v1 is now a **frozen legacy field** — best-
  effort only, never removed outright (in case Google ever restores/aliases
  the model), but not something new code should depend on. **New entries are
  effectively v2-only.** `model.embeddingV2Read: true` is now REQUIRED for
  semantic retrieval to work at all; with it OFF, every user gets
  keyword-only retrieval (see the flag table above) — this reproduces
  exactly today's pre-migration prod behavior, not a new regression, but it
  means the flag is no longer optional for anyone who wants semantic search.
- **Backfill gap:** any entry created in the window between the retirement
  and this fix landing has NEITHER vector. Use
  `scripts/backfill-embeddings-v2.js --include-missing-v1` (step 2 above) to
  close that gap with v2-only writes.
- **RESOLVED (plan task M5, 2026-07-22).**
  `src/services/nexus/layer1/threadManager.js`'s thread-dedup/thread-name
  embeddings were explicitly PINNED to v1 by M2 (thread vectors were a
  separate v1-space store, migration an explicit non-goal at the time).
  Since v1 was permanently retired, that pin left thread-similarity matching
  (`findSimilarThread`/`findEvolutionCandidates`) silently degraded — it
  called a v1-only path that always failed, so thread dedup stopped
  matching in prod with no visible error. Task M5 moved thread vectors to
  v2 space: new threads embed via the unconditional `generateEmbeddingV2`
  (`src/services/ai/embeddings.js`, no flag check — thread vectors have no
  working v1 fallback to gate a rollback to) and store the result on
  `thread.embeddingV2`; the legacy `thread.embedding` field is never
  overwritten or reused. `findSimilarThread`/`findEvolutionCandidates` now
  compare `thread.embeddingV2`-vs-`embeddingV2` exclusively — a thread that
  only has the legacy v1 `embedding` field is treated as having no
  comparable vector (same "no semantic match" exclusion that already
  existed for a thread with no embedding at all), never cross-space
  compared. No backfill script: `getActiveThreads` only ever compares
  against the 10 most-recently-updated active/evolved threads per user
  (`MAX_ACTIVE_THREADS`), so a legacy v1-only thread simply ages out of that
  window as new threads are created, or gets resolved through normal use —
  it does not need to be deleted or migrated to stop mattering. Full
  rationale: `src/services/nexus/layer1/threadManager.js`'s file-level doc
  comment and `.superpowers/sdd/task-m5-report.md`.

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

**Which `model.<workload>` keys are LIVE vs inventory-only.** During an
incident, only flip a lever that has a runtime consumer — the others are
recorded for inventory completeness but reading/writing them does nothing.

| Workload | Default | Flag lever LIVE? | Consumer |
|---|---|---|---|
| classify | `gemini-3-flash-preview` | ✅ | orchestrator + `analyzeJournalEntry` + watchdog + reprocess (threaded `{modelId}` into `classifyEntry`/`extractEnhancedContext`) |
| analyze | `gemini-3-flash-preview` | ✅ | orchestrator + callable + watchdog (`analyzeEntry`); stamped into `analysisMeta.modelId` |
| insight | `gemini-3-flash-preview` | ✅ | orchestrator + callable (`generateInsight`) |
| embedding | `text-embedding-004` | ✅ (best-effort/legacy — see v1-retirement note above) | `generateEmbeddingInternal` (`getModel(db,'embedding')`) — legacy v1 space; retired upstream by Google 2026-07-22, expected to fail every call |
| embeddingV2 | `gemini-embedding-2` | ✅ | `generateEmbeddingInternal` when `model.embeddingWriteV2` on |
| fusedTranscription | `gemini-2.5-flash` | ✅ | `transcribeEntry` callable + server trigger (`runFusedTranscription({modelId})`) |
| tone | `gemini-3.5-flash` | ✅ | `transcribeAudio` tone call (`getModel(db,'tone')`) |
| digest | `gemini-3.5-flash` | ✅ | weekly digest narrative (`getModel(db,'digest')`) |
| transcriptionFallback | `whisper-1` | ✅ | Whisper multipart in `transcribeAudio` (`getModel(db,'transcriptionFallback')`) |
| insightWriter | `gemini-3.5-flash` | ✅ | `writeClaimWording` callable's writer role (`claimWriter.js`) — see "R4 Phase 2" section below for the writer/verifier model-independence invariant and the `flip-flag.mjs` `STRING_ALLOWED` caveat |
| insightVerifier | `gemini-3-flash-preview` | ✅ | `writeClaimWording` callable's verifier role (`claimVerifier.js`) — MUST stay a different model than `insightWriter` |
| chat / chatFallback | `gpt-4o-mini` / `gpt-4o` | ❌ inventory-only | `callOpenAI` uses `getModelSync('chat')` (default only); `chatFallback` is an `AI_CONFIG` field with no call site |
| temporal | `gemini-3.5-flash` | ❌ inventory-only | temporal detection routes through the generic `executePrompt` callable, which uses the `analyze` default; there is no `model.temporal` consumer. The client `src/services/temporal` passes a `gemini-2.0-flash` arg that the 2-arg client `callGemini` IGNORES (dead) |
| entityResolution | `gemini-3-flash-preview` | ❌ inventory-only | entity resolution is string-similarity matching, not an LLM call — no model is used |
| realtimeNA | `gpt-realtime-2.1` | ❌ N/A here | owned by relay env `REALTIME_MODEL`, not this registry |

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
  (I1–I4) has now landed behind the `intentExtraction` flag (default off) —
  see "Intent system (precision-first tasks)" below.

## Intent system (precision-first tasks)

The precision-first intent system (PRD 0B, plan I1–I4) replaces broad
phrase-matching task extraction. It is dark by default behind two server flags.

**Flags:**

| Flag | Default | Effect |
|------|---------|--------|
| `intentExtraction` | `false` | When ON, the post-save orchestrator runs async intent extraction; the intent system OWNS `entry.extracted_tasks` (policy-qualified ACTIVE task intents only) and the TasksWidget reads from `subscribeActiveTaskIntents`. Extraction failure never fails the analysis publish. Both a client (`src/config/flags.js`) and server (`getServerFlag`) read this key. |
| `intentAbstainAudit` | `false` | **Server-side only** (read via `getServerFlag` in `functions/src/intents/extractIntents.js`; NOT a client flag). When OFF, abstain candidates are not persisted — only `active`/`suggested` intents are written. Turning it ON enables the full decision audit trail (every candidate persisted as an intent doc) for eval/debugging, at the cost of **unbounded growth of the `intents` subcollection** until a TTL/retention policy exists. Leave OFF in production until retention lands. |

**Model:** workload `intentExtraction` → default `gemini-3.5-flash` (registry),
overridable via `config/flags` key `model.intentExtraction`.

**Orphan reap:** editing an entry re-extracts at a new `entryInputVersion`; each
intent stores the `inputVersion` it was extracted at, and a re-extraction
deletes every older-version intent for that entry in the same batch (so a
shifted-span task can never linger as a phantom). A stale intent that a
`user_decisions` doc references is retired to `state:'superseded'` instead of
being deleted.

**Composite index (MANUAL — do NOT deploy indexes from firebase.json):**
The active-task subscription query (`intents` where `kind==task`,
`state==active`, `orderBy createdAt desc`) needs a composite index. It is
recorded in `firestore.indexes.json` for source-control accuracy and is
already provisioned in prod. `firebase.json` deliberately does NOT wire
`firestore.indexes` (a deploy can DELETE unlisted prod indexes). To (re)create
it manually:

```
gcloud firestore indexes composite create \
  --project=echo-vault-app \
  --collection-group=intents \
  --field-config field-path=kind,order=ascending \
  --field-config field-path=state,order=ascending \
  --field-config field-path=createdAt,order=descending
```

**Growth gate:** the eval fixture set
(`functions/src/intents/__evals__/fixtures.json`) is a 67-example starter that
locks the contract (zero hard-negatives active, active precision 1.0). Before
`intentExtraction` defaults ON in prod, grow it to ≥500 real (consented,
de-identified) examples at ≥97% active precision. See that dir's `README.md`.

## R1 flags (Open Loops / Context Spaces / Insight Budget)

The R1 plan (`docs/superpowers/plans/2026-07-20-r1-follow-through.md`,
batches R1-1..R1-4) shipped three more client flags, all **default OFF**,
independent of each other and of `intentExtraction` above (though Open Loops
has no effect unless `intentExtraction` is also on, since loops are a kind of
intent). Same mechanism as the rest of this table: `config/flags` doc, no
deploy required, `src/config/flags.js` `FLAG_DEFAULTS`.

| Flag | Default | What it gates | Turning it OFF restores |
|---|---|---|---|
| `openLoops` | `false` | `OpenLoopsWidget` (home surface: due/upcoming open-loop intents, max 3 due, answer/snooze/close) and `IntentSuggestionTray` on `EntryCard` (suggested-intent keep/edit/no-thanks tray). | No open-loop surfaces render at all — extraction (if `intentExtraction` is on) still writes `open_loop` intent docs server-side, they are simply never shown. Nothing is deleted; flipping back on immediately re-surfaces the same due/suggested loops. |
| `contextSpaces` | `false` | Space-scoped capture (capture pill + card space chip), `SpaceManager` (Settings), the Ask Journal scope chip, and the strict `filterEntriesByScope` gate at all 7 retrieval seams (client `getSmartChatContext`/`askJournalAI`/both `generateDaySummary` functions/`companionContext`/`prompts` index/nexus `fetchRecentEntries`; server `buildRecentContext`, flag-gated separately server-side). | All-spaces (legacy) retrieval everywhere — every seam's `scope` argument is only ever non-null when a caller explicitly passes one, and no UI surface passes one while this flag is off. Existing `spaceId` fields on entries are untouched; they simply stop being read as a filter. |
| `insightBudget` | `false` | The daily/weekly cap + 90-day near-dup suppression in `applyInsightBudget` (`src/services/insights/insightBudget.js`) gating Nexus proactive home insights, and the mode selector (quiet/balanced/exploratory) in Settings. | Unbounded insight surfacing — every confidence/provenance-gated insight the orchestrator produces is shown, as before this flag existed. `settings/insightBudget` (mode + shownLog) is untouched; flipping back on resumes gating from the existing shownLog rather than a blank slate. |

**Composite indexes added for R1** (recorded in `firestore.indexes.json`;
`firebase.json` deliberately does not wire `firestore.indexes` — see the
model-registry index note above for why. Create manually if a fresh
environment needs them):

```
# Due/upcoming open-loop queries (subscribeDueOpenLoops / subscribeUpcomingOpenLoops)
gcloud firestore indexes composite create \
  --project=echo-vault-app --collection-group=intents \
  --field-config field-path=kind,order=ascending \
  --field-config field-path=state,order=ascending \
  --field-config field-path=targetAt,order=ascending

# Suggestion tray per entry (subscribeSuggestedIntentsForEntry)
gcloud firestore indexes composite create \
  --project=echo-vault-app --collection-group=intents \
  --field-config field-path=entryId,order=ascending \
  --field-config field-path=state,order=ascending

# Space-scoped entry queries (reassignEntriesSpace and any future space-filtered list view)
gcloud firestore indexes composite create \
  --project=echo-vault-app --collection-group=entries \
  --field-config field-path=spaceId,order=ascending \
  --field-config field-path=createdAt,order=descending
```

**Spaces archive-flow support notes.** `archiveSpace` never deletes a space
doc (`firestore.rules` forbids delete on `spaces`) — it only flips
`state: 'archived'`. The archive UI (`SpaceManager.jsx`) always routes
through a 3-option sheet before archiving: **Move entries** (pick another
active space → `reassignEntriesSpace(from, to)` then `archiveSpace(from)`),
**Keep unscoped** (`reassignEntriesSpace(from, null)` then
`archiveSpace(from)`), or **Cancel** (closes the sheet, no service call at
all). `reassignEntriesSpace` only ever writes `{spaceId, updatedAt}` onto
each moved entry, in batches of 200 — journal content (`text`, `createdAt`,
`effectiveDate`, `transcription`, etc.) is never touched by any archive-flow
path (see `src/__tests__/validationMatrix.test.js` Matrix row "Reassigning a
space only ever touches spaceId + updatedAt"). Archived spaces stay
selectable in historical data (existing entries keep their `spaceId` even
after the space is archived) but drop out of `subscribeSpaces` (which
filters `state == 'active'`) and out of new-capture space pickers.

**Known gap: offline `queueEntry` drops the selected `spaceId`.**
`src/services/offline/offlineManager.js`'s `queueEntry` builds its stored
payload from an explicit field whitelist that does not include `spaceId` —
an entry captured while offline with a space selected loses that selection
once it syncs (the synced entry lands unscoped). This is a **pre-existing
gap, not new R1 breakage** (Context Spaces predates offline queueing having
any space awareness at all), but it means space assignment is not fully
durable across the offline path yet. **Must be fixed before `contextSpaces`
defaults ON for users who journal offline** — add `spaceId` to the
whitelist in `queueEntry` (and confirm the sync path forwards it through to
the eventual online entry create) as a prerequisite, not a follow-up.

**Known gap: no client sends `space-id` GCS metadata yet.**
`functions/src/capture/onAudioUploaded.js` (background-upload finalize
handler) already defensively reads a `space-id` custom object metadata key
off the uploaded GCS object and threads it through to
`buildBackgroundCoreEntry` as `spaceId` — but nothing upstream can actually
populate that key today. `functions/src/capture/uploadTicket.js`
(`issueCaptureUploadTicketCore`, the `issueCaptureUploadTicket` callable)
only accepts and V4-signs `capturedAt` / `captureTimezone` as optional
`x-goog-meta-*` extension headers; it has no `spaceId` parameter at all, so
there is no signed header for a client to even send. On top of that, no
client (web or native) currently calls `issueCaptureUploadTicket` in the
first place — the native background-upload vertical slice's client half
isn't wired up yet. Until both the ticket function gains a signed
`space-id` header and a client sends it, every background-uploaded voice
entry lands **unscoped** regardless of the capture pill's selection at
record time. Lower risk than it sounds today because `nativeBackgroundUpload`
(the flag gating the background-upload vertical slice itself) is **also
default OFF** — but both gaps must be closed together before either flag
defaults on for a user who journals with Context Spaces active.

**Clarifying: only Ask Journal passes a scope in R1.** The strict
`filterEntriesByScope` gate is wired at all 7 retrieval seams listed above
(client `getSmartChatContext`/`askJournalAI`/both `generateDaySummary`
functions/`companionContext`/`prompts` index/nexus `fetchRecentEntries`;
server `buildRecentContext`), so every seam is capable of scoping and none
of them can leak across an explicit scope boundary if one is ever passed.
In R1, however, **Ask Journal is the only caller that actually passes a
non-null scope** — day summaries, dashboard prompts, and the nexus insight
pipeline all accept a `scope` argument but have no UI surface wired to
supply one yet. Those surfaces therefore remain cross-space (unscoped) in
practice through R1, by design, not by omission; wiring a scoped caller
into each is R2 work (see the digest/report limitation below, which is the
same shape of gap for a different set of surfaces).

**Digest/report cross-space limitation.** The weekly digest and any
generated report remain **cross-space** (unscoped, all-entries) through R1 —
`filterEntriesByScope` was applied at the 7 interactive retrieval seams
listed above, but digest/report generation was explicitly out of scope for
this pass. A Work-space user will still see Personal-space content
summarized in their digest until R2's receipts/space-treatment work lands
(see `PROJECT_STATUS.md` Active Work).

## R2 flags (Insight Receipts / Control Center / Voice Chapters / Recipes / Session Prep / Gentle Revisit)

The R2 plan (`docs/superpowers/plans/2026-07-21-r2-trust-surfaces.md`, batches
R2-1..R2-8) shipped five more client flags — `insightReceipts`,
`voiceChapters`, `reflectionRecipes`, `sessionPrep`, `gentleRevisit` — all
**default OFF** and independent of each other and of every flag above. Same
mechanism as the rest of this doc: `config/flags` Firestore doc, no deploy
required, `src/config/flags.js` `FLAG_DEFAULTS`. Every consumer listed below
calls `getFlag(name)` inline inside its render/effect body (not once at
module load and cached) — verified by reading each call site — so a flip
takes effect on the next app load with no redeploy and no stale in-memory
state to work around **for the flag itself**.

**Caveat (final R2 review, Important 1): `reflectionRecipes` is not
flag-flip-only.** `subscribeRecipes` (`src/services/reflections/recipeService.js`)
needs the Firestore composite index `(recipes: state ASC, name ASC)` — now
recorded in `firestore.indexes.json` for source-control accuracy, matching
the intents/R1 indexes' precedent above (`firebase.json` deliberately does
NOT wire `firestore.indexes`, so no CI deploy — functions or otherwise —
ever provisions it; see the model-registry index note earlier in this doc
for why). Until this specific index is provisioned via the Admin
Console/`gcloud` (below), `subscribeRecipes` fails with a Firestore
"query requires an index" error the moment `reflectionRecipes` is flipped
on and a user has more than zero recipes — i.e. flipping this flag alone is
**not** sufficient the way it is for every other R2 flag in this table.
Provision it manually before flipping `reflectionRecipes` on anywhere real
users will hit it:

```
gcloud firestore indexes composite create \
  --project=echo-vault-app --collection-group=recipes \
  --field-config field-path=state,order=ascending \
  --field-config field-path=name,order=ascending
```

**PROVISIONED 2026-07-22** (agent-run, Michael-sanctioned — `PROJECT_STATUS.md`
Active Work checklist item (7)) and verified **READY** in production.

**The same manual-provisioning requirement applies to the following R2/GR1
composite indexes** recorded in `firestore.indexes.json` (nothing deploys
them either):

1. `source_exclusions (entryId ASC, appliesTo ASC)` — backs `excludeSource`'s
   duplicate-check query (`src/services/insights/sourceExclusions.js`).
   Without it, the first "Exclude source" / "Wrong source" tap under
   `insightReceipts` throws a query-requires-an-index error. Provision
   before flipping `insightReceipts`:

   ```
   gcloud firestore indexes composite create \
     --project=echo-vault-app --collection-group=source_exclusions \
     --field-config field-path=entryId,order=ascending \
     --field-config field-path=appliesTo,order=ascending
   ```

2. `entries (safety_flagged ASC, createdAt ASC)` — backs the rule-3
   crisis-window-adjacency anchor query in
   `functions/src/revisit/selectRevisits.js`. **Safety-relevant failure
   mode:** the daily sweep's per-user try/catch treats a missing-index
   error as a per-user failure and skips — fail-closed (nothing unsafe is
   ever selected) but SILENT: the sweep selects nothing for anyone,
   indefinitely, with no user-facing signal. Provision before
   `gentleRevisit` is enabled anywhere, including internal testing:

   ```
   gcloud firestore indexes composite create \
     --project=echo-vault-app --collection-group=entries \
     --field-config field-path=safety_flagged,order=ascending \
     --field-config field-path=createdAt,order=ascending
   ```

3. **(GR1, Michael's direct safety review — 4th index.)** `entries
   (has_warning_indicators ASC, createdAt ASC)` — backs the new
   warning-indicator anchor-backfill query GR1 added alongside the
   safety_flagged one above (mirrors it exactly: same 200-cap far-edge
   problem, same fix, same failure mode — a missing index fails this user
   closed, silently, no selection, no user-facing signal). Also required
   before rule 3's now-widened adjacency (flagged OR warning-indicator
   anchors, GR1) can see the full warning-indicator anchor set.

   ```
   gcloud firestore indexes composite create \
     --project=echo-vault-app --collection-group=entries \
     --field-config field-path=has_warning_indicators,order=ascending \
     --field-config field-path=createdAt,order=ascending
   ```

   **PROVISIONED 2026-07-22 by the controller** (same command as above) —
   spot-check it shows **READY** in the Firebase console/`gcloud firestore
   indexes composite list` before `gentleRevisit` is ever flipped on, same
   verification step already applied to indexes 1/2 above and the
   `reflectionRecipes` index earlier in this section.

All three indexes in this list, plus the `reflectionRecipes` index above,
were provisioned and verified **READY** in production on 2026-07-22
(`PROJECT_STATUS.md` Active Work checklist items (7)/(10)) — no index work
remains before `gentleRevisit` is flipped on, PROVIDED the safety memo
sign-off gate below (still unchecked) is also satisfied.

| Flag | Default | What it enables | Turning it OFF restores | Verification |
|---|---|---|---|---|
| `insightReceipts` | `false` | The "Why am I seeing this?" `ReceiptSheet` (`src/components/insights/ReceiptSheet.jsx`) on Nexus insight cards (`NexusInsightsWidget.jsx`, `InsightsPage.jsx`), the `InsightControlCenter` screen (excluded sources, muted families, recompute, budget-withheld count) and its Settings/AppLayout nav row. Underlying data (`src/services/insights/receipts.js`, `sourceExclusions.js`, `recompute.js`) is flag-**independent** — receipts are attached to every insight at generation time regardless of this flag. | Nexus/Basic insight cards render exactly as they did pre-R2: no "Why am I seeing this?" trigger, no Control Center nav row. Receipt data keeps being computed and persisted in the background (harmless, invisible) so re-enabling needs no backfill. Source exclusions already created stay in effect either way (`getExcludedEntryIds` is read unconditionally by `generateInsights`/report `readEntries`, not flag-gated). | `src/__tests__/validationMatrix.test.js` rows (a)/(b); `src/services/nexus/__tests__/orchestrator.receipts.test.js`, `orchestrator.exclusions.test.js`; `src/components/insights/__tests__/ReceiptSheet.test.jsx`, `InsightControlCenter.test.jsx`. |
| `voiceChapters` | `false` | The in-recording "Chapter" marker button (`EntryBar.jsx`), marker capture through `src/services/capture/chapterMarkers.js` + the native sidecar, marker-aligned chapter segmentation in `functions/src/transcription/fusedTranscription.js` (`computeChapterBoundaries`), and the chaptered EntryCard render (per-chapter `ChapterHeader.jsx` + rename/merge/remove actions). | Recording UI drops the Chapter button (no new markers get created, so no new entry ever carries `transcription.chapters`); EntryCard falls back to the legacy flat-paragraph body render byte-for-byte, even for entries that already have saved chapter metadata from when the flag was on — that metadata is untouched in Firestore, simply not rendered, so re-enabling immediately restores the chaptered view with no data loss. | `src/__tests__/validationMatrix.test.js` row (g); `src/components/entries/__tests__/EntryCard.test.jsx` ("legacy render is byte-identical" + "chapter action payload exactness" blocks); `functions/src/transcription/__tests__/fusedTranscription.test.js`. |
| `reflectionRecipes` | `false` | The "Reflection Recipes" nav row (Settings/AppLayout) and `RecipesScreen`/`ReflectionDraft` (`src/components/reflections/`), backed by `src/services/reflections/{recipeService,runRecipe,starterRecipes}.js`. **Index dependency (final R2 review, Important 1):** `recipeService.js`'s `subscribeRecipes` queries `where('state','==','active') + orderBy('name','asc')`, which needs the composite index `(recipes: state ASC, name ASC)` now recorded in `firestore.indexes.json`. Unlike the flag mechanism itself, this index is **not** live until it's provisioned — see the caveat below the flag table. | Nav row disappears; no way to create/run/edit recipes from the UI. Existing `recipes/*` and `reflections/*` docs (recipe runs already generated) are untouched in Firestore — they simply become unreachable until the flag flips back on, at which point they reappear exactly as left. | `src/services/reflections/__tests__/{recipeService,runRecipe,runRecipeAdversarialRetrieval,starterRecipes}.test.js`; `src/components/reflections/__tests__/{RecipesScreen,ReflectionDraft}.test.jsx`. |
| `sessionPrep` | `false` | The "Session prep" nav row and `SessionPrepScreen` (`src/services/reflections/sessionPrep.js` — since-date/scope brief generation, regenerate-section, the safety-reviewed `composeSessionPrepPdf` export). | Nav row disappears; no way to generate or export a session brief. Existing `reflections/*` docs of `kind:'session_brief'` are untouched, same as above. | `src/__tests__/validationMatrix.test.js` row (f); `src/services/reflections/__tests__/sessionPrep.test.js`; `src/components/reflections/__tests__/SessionPrepScreen.test.jsx`. |
| `gentleRevisit` | `false` | **Client:** `RevisitWidget` (home surface) + `RevisitControls` (opt-in toggle, hidden-dimension manager) and the "Gentle Revisit" Settings row, backed by `src/services/revisit/revisitService.js`. **Server:** the entire `gentleRevisitDaily` scheduled sweep (`functions/src/revisit/selectRevisits.js`) — `runGentleRevisitDaily` reads the server-side flag via `getServerFlag(db, 'gentleRevisit', false)` as its very first check and returns `{processed:0, selected:0, skipped:0}` for **every** user, before even looking at any user's `revisitPrefs.enabled`, if the flag is off. **GR1 (Michael's direct safety review) hardening, all inside the same flag gate:** a per-user current-state gate (recent 14-day safety signal or sustained low mood pauses selection for that user that day), legacy entries fail closed (a pre-existing entry missing explicit `safety_flagged`/`has_warning_indicators` is re-screened from its text before it can ever be selected — a screen miss or unavailable text excludes it), the mood floor retuned 0.4→0.6, a warning-indicator anchor-backfill query mirroring the existing flagged one (needs the 4th composite index below), and a weekly cadence (a user is skipped unless their last live queued/shown selection is more than 7 days old). | **Client:** widget/controls disappear entirely, even if a `revisit_queue` doc already exists for today (it simply isn't rendered — nothing is deleted by the flag itself; only the user's own opt-out toggle inside `RevisitControls` deletes queued docs). Independently of the flag, the client-side current-state gate (GR1) can also suppress an already-queued card when the widget's own loaded `entries` show a live signal — defense in depth, not flag-gated. **Server:** no new `revisit_queue` docs get written for anyone, for any user, regardless of their individual opt-in state — the daily sweep is a complete no-op while the flag is off. Re-enabling resumes selection from the next scheduled run (subject to the new weekly-cadence/current-state gates above); nothing needs replaying. | `src/__tests__/validationMatrix.test.js` row (e); `functions/src/revisit/__tests__/selectRevisits.test.js`; `src/components/zen/widgets/__tests__/RevisitWidget.test.jsx`, `src/components/revisit/__tests__/RevisitControls.test.jsx`. **Extra gate, non-negotiable:** read and sign off `docs/quality/gentle-revisit-safety.md` before this flag is EVER flipped on outside internal testing — it documents the current, GR1-amended rule set, the automated fixture set, and the PRD's open question on grief/trauma/crisis scenarios (still unresolved after GR1). **Cadence (GR1):** even once signed off and enabled, an individual user only receives at most one live (queued/shown) revisit_queue selection per rolling 7 days, on top of the existing daily-scheduled/per-day-idempotent job cadence. |

**Digest retirement (R2 Task 9).** `generateWeeklyDigests` /
`generateUserWeeklyDigest` and their prompt/helper code were deleted from
`functions/index.js` — the weekly digest wrote `digests/weekly`, a doc with
**no `firestore.rules` read block**, making it permanently client-unreadable;
it cost a Gemini call per user per week for a surface nobody could ever see,
and weekly reports (`functions/src/reports/`) already cover the same ground
with a user-visible, receipt-carrying surface. The exports are gone from the
codebase, but **Cloud Functions does not un-deploy a function just because
its source was removed** — the stale `generateWeeklyDigests` function keeps
running in production (and keeps blocking every subsequent `firebase deploy
--only functions` with a "function no longer exists in source" prompt, which
CI cannot answer non-interactively) until it is explicitly deleted. This is a
**one-time manual step, not yet done as of this writing** — it blocks ALL
functions deploys until run:

```
firebase functions:delete generateWeeklyDigests --region us-central1 --force
```

The `digests/weekly` documents already written are left in place (inert,
unreadable, harmless) — this command only removes the Cloud Function, not
historical data.

**Voice-relay scope note.** The relay does not read `contextSpaces` scope
per-message — `useVoiceRelay.js`'s `connect(sessionType, mode, spaceId)`
sends the Context Space active in `UnifiedConversation` **once, at session
start**, and the relay stores it on that connection's `sessionState.spaceId`
for the life of the session (`relay-server/src/relay/realtimeProxy.ts` +
`standardPipeline.ts`, both threading it into `searchMemory(userId, args,
spaceId)`). Switching Spaces mid-conversation does not retroactively rescope
an already-open voice session; the user has to start a new one. `spaceId:
null` (unscoped) is the default and produces byte-identical queries to
pre-R2 behavior.

**Chapters device-validation pointer.** `voiceChapters`' native half (the
`CaptureDraft` sidecar marker append, `Capture.markChapter()`, and the
Swift-side `stop()` result carrying `markers`) is exercised only by an Xcode
build + physical-device sanity check — see
`docs/quality/device-validation-matrix.md`. This is on the human checklist
(`PROJECT_STATUS.md` Active Work); it has not yet been run as of this
writing, so `voiceChapters` should not default on for native users until it
has.

## R3 flag (Personal Experiments)

The R3 plan (`docs/superpowers/plans/2026-07-22-r3-personal-experiments.md`,
batches R3-1..R3-4) shipped one more client flag — `personalExperiments`,
**default OFF**, independent of every flag above. Same mechanism as the rest
of this doc: `config/flags` Firestore doc, no deploy required,
`src/config/flags.js` `FLAG_DEFAULTS`.

**DATA-METHOD SIGN-OFF GATE (non-negotiable, gentleRevisit's twin):**
`docs/quality/experiments-data-method.md` must be read and signed off by
Michael (the checkbox under that doc's "Sign-off" heading) **BEFORE
`personalExperiments` is EVER flipped on, including for internal testing.**
This mirrors `gentleRevisit`'s safety-memo gate exactly: the flag mechanism
alone is not sufficient permission to enable this surface, because the memo
is where the actual statistical-design judgment call lives (minimum paired
observations, coverage floor, median-split-and-bootstrap vs. Pearson,
outlier handling) — code enforces whatever the memo says, but only a human
can decide the memo says the right thing for a mental-health app's users. An
agent must never check that box on Michael's behalf.

| Flag | Default | What it enables | Turning it OFF restores | Verification |
|---|---|---|---|---|
| `personalExperiments` | `false` | The "Experiments" nav row (Settings/AppLayout, double-gated `personalExperiments` — RecipesScreen mount precedent) and `ExperimentsScreen`/`ExperimentResultView` (`src/components/experiments/`): create a 14/28-day observational experiment from a template catalog (`src/services/experiments/templates.js`) or a free-text question screened by `questionGate.js`, an explicit Start that freezes the analysis plan, a running/paused card with data-coverage-not-streak copy, and a result view (estimate + CI, plain-language non-causal narrative, observation inspector with exclude/rerun). **ALL data storage and computation is client-side** — no scheduled Cloud Function, no server trigger, no LLM/provider call anywhere in the pipeline (decision 4: `computeResult.js`'s pure `computeExperimentResult` runs in the browser/app from the user's own already-loaded entries; the result narrative is template-composed fixed strings with slotted numbers, never model-generated). **No new composite index needed** — verified by grepping `src/services/experiments/*.js` for `where(`: zero hits. `subscribeExperiments` (`experimentsService.js`) is a plain `collection(...).orderBy('createdAt', 'desc')` subscribe with no `where()` clause, which Firestore's automatic single-field indexing covers without any manual `gcloud firestore indexes composite create` step — unlike the three R2 indexes below, which DO require one. **Michael review hardening (EX1/EX2), all inside the same flag gate:** the estimate carries `nHigh`/`nLow`/`splitThreshold`/`exposureContrast`/`stability` and enforces group-size/imbalance/exposure-contrast/split-stability guards before returning `ok`; the outcome series is normalized to a frozen 0-100 `mood_0_100` unit (never the raw 0-1 `mood_score`); day-series pairing/coverage use the user's device-local IANA timezone (frozen onto `analysisPlan.timezone` at create) with day 1 = the first FULL local day after `startAt`; a completed result's original computation is immutable (`result.original`), a post-result exclusion writes `result.adjusted` + an appended, reasoned `result.exclusionHistory`, and the UI always labels an adjusted result "Modified after seeing the result." | Nav row disappears; no way to create, view, or run an experiment. Existing `experiments/*` docs (any created while the flag was on, e.g. during internal testing) are untouched in Firestore — they simply become unreachable from the UI until the flag flips back on, at which point `subscribeExperiments` immediately re-surfaces them exactly as left, including any already-computed `result` (original AND any adjusted recomputation/history, all preserved as written). The client-side auto-completion effect (see below) also stops running while the flag is off, so an experiment whose `endAt` elapses during that window simply waits — it auto-completes on the next render after the flag (and screen) is live again, not lost. | `src/__tests__/validationMatrix.test.js` R3 rows (a)-(g) + Hardening rows (h5)-(h8); `src/services/experiments/__tests__/{questionGate,estimator,computeResult,experimentsService,templates,preflight}.test.js`; `src/components/experiments/__tests__/{ExperimentsScreen,ExperimentResultView}.test.jsx`. **Extra gate, non-negotiable:** read and sign off the UPDATED `docs/quality/experiments-data-method.md` before this flag is EVER flipped on outside internal testing — see above and `PROJECT_STATUS.md` checklist item (8). |

**Plan-freeze enforcement, both layers.** `question`/`analysisPlan`/
`template`/`scope`/`createdAt` are immutable on an `/experiments/{id}` doc
once created — enforced in `firestore.rules`
(`experimentUpdateAllowed`/`experimentTransitionAllowed`: those five keys
are simply absent from the update `affectedKeys` allow-list, so no client
write can ever touch them post-create, running or not) AND, independently,
client-side in `experimentsService.js` (no function past `createExperiment`
accepts or writes any of those five fields at all — see R3 validation
matrix row (b), which pins this structurally rather than by probing the
rules). The rules half rides the same CI-only path as every other rules
suite in this repo (`functions/src/__tests__/firestoreRules.test.js`,
excluded from local `npm test`, runs only via `firebase emulators:exec` in
CI) — it is not re-executed by the client-side row above; the two layers are
deliberately redundant, not substitutes for each other.

**Insufficiency is a first-class result state, not a placeholder.** Below
either spec threshold (`MIN_PAIRED_OBSERVATIONS = 10` paired days,
`COVERAGE_FLOOR = 0.5` per-variable coverage — both defined once in
`src/services/experiments/estimator.js` and imported everywhere else that
needs them, never re-hardcoded), `computeExperimentResult` returns
`status: 'insufficient'` with NO `estimate`/`narrative.summary` keys at
all (true key absence, not `undefined` — payload-exactness) — the UI renders
only the fixed insufficiency copy, nothing estimate-shaped. Both `ok` and
`insufficient` results carry a receipt (`versions.generator:
'experiment_v1'`), matching the R2 receipt invariant's posture that every
computed result is inspectable regardless of outcome.

**Safety: flagged entries count in stats, never in citations.** An entry
with `safety_flagged`/`has_warning_indicators` set still contributes its
data point to the estimate (excluding it would bias the mood estimate away
from exactly the days that matter most) but is filtered out of
`receipt.sources` entirely — id and excerpt both — matching Session Prep
export's posture from R2. **Michael review hardening (EX2, item 5):** the
result additionally discloses the COUNT of contributing sensitive days
(`result.sensitiveObservationCount`, present on both `ok` and `insufficient`
results) — "N sensitive days contributed to the statistics; details are
hidden" — and the observation table renders those specific rows as
"Sensitive day — details hidden" instead of omitting them outright. See R3
validation matrix row (g) and Hardening row (h5) (mood normalization
end-to-end).

**Execution-time decisions made during the build (not in the original 8
plan decisions — see `PROJECT_STATUS.md` Recent Decisions for the full
rationale of each):** (i) `paused -> completed` is a legal transition
(`firestore.rules`' `experimentTransitionAllowed`) alongside `running ->
completed`, since v1's variables are all passive/computed-from-existing-data
— pausing never blocks the underlying data from continuing to exist; (ii)
`ExperimentsScreen.jsx` auto-completes an elapsed `running`/`paused`
experiment on view (client-side, best-effort, `completingRef`-guarded
against duplicate writes, covered by
`ExperimentsScreen.test.jsx`'s "auto-completion" describe block) — a
deliberate design choice this task made since decision #4 commits to
"no scheduled function," so completion has to happen somewhere client-side;
(iii) a result's non-causal-wording caveats (`confounders`,
`whatThisDoesNotProve`) are snapshotted onto `analysisPlan` at create time
(`experimentsService.buildAnalysisPlan`), not re-looked-up from the template
catalog at result time — so a later wording edit to the catalog (or a
template's removal) can never silently change or blank out the safety text
an already-`completed` result shows.

## R4 (Insight Integrity — Phase 0 containment)

Plan: `docs/superpowers/plans/2026-07-22-r4-insight-integrity.md`. Source:
Michael's external deep review ("DR") of the legacy Nexus/basicInsights
engines, adopted as owner direction. Unlike R1-R3, **R4 Phase 0 ships no new
user-facing flag** — it repairs statistically-broken legacy engines that
were already live (behind the existing, already-shipped Nexus/basicInsights
surfaces), sweeps privacy literals out of pattern-detection triggers, and
adds an internal risky-claim suppression seam. Batches R4-0a (T1-T4,
disjoint file trees, parallel) + R4-0b (T5, T6) — full task-by-task detail:
`.superpowers/sdd/task-{1,1b,2,3,4,5,6}-report.md`.

**Scope of Phase 0** (Phases 1-2, canonical claim store + verified
synthesis, are planned in detail when reached — see the plan's own
outline): a versioned entry-schema adapter
(`src/services/insights/entryAdapter.js`) fixing five basicInsights engines'
field-location bugs and a live `.toLowerCase()`-on-an-object crash, plus
complement-baseline (non-overlapping exposed-vs-not, not an all-entries
average) and unique-day-gating floors; personal/brand literals stripped from
Nexus Layer 1 pattern-detection triggers (`patternDetector.js`'s
`GENERIC_TRIGGERS`, curated + lint-tested); the internal 0-1 `Mood01`
convention applied consistently through orchestrator/counterfactual/
beliefDissonance/synthesizer (previously comparing native 0-1 values against
0-100-scale literals — always-true or always-false bugs, not real gates);
reports (`functions/src/reports/generator.js`) reading the real singleton
`nexus/insights` doc and the real `analysis.mood_score` field instead of a
phantom by-type collection query and a camelCase field the app never
writes; and user feedback/dismissals becoming durably consumed inputs (next
bullet).

**Cutover semantics (ratified decision 2 — "legacy artifact cutover, not
migration").** There is no data-migration script and no bulk rewrite.
`generatorVersion` (`src/services/insights/generatorVersion.js`, currently
`2` — version 1 is implicit: nothing before R4 ever stamped this field, so
its absence on an existing doc/insight means "written by a pre-R4 engine")
is stamped on every insight a generation actually produces. **Regeneration
is entirely client-side, on-demand** — there is no server-side backfill job
and no scheduled trigger for this; it happens exactly when a generation
would already have run anyway: Nexus's existing 24h TTL / manual refresh /
`updateInsightsForNewEntry`, or basicInsights' existing TTL/entries-changed
staleness check. Concretely:
- **Nexus** (`src/services/nexus/orchestrator.js`'s `saveInsights`): on the
  first post-deploy generation for a given user, any previous `active`
  insight lacking `generatorVersion` (or stamped with an older one) is
  **archived into `history` with a `legacyVersion: true` mark** instead of
  being silently dropped when `active` is wholesale-replaced (pre-existing
  behavior, unchanged) — nothing is ever deleted. Every newly generated
  `active` insight is stamped with the current `generatorVersion`. In
  steady state (every generation after the first) there is nothing left to
  archive, so this is a true one-time cutover per user, not an ongoing cost.
  Footnote (T6 review): "archived" ≠ "retained forever" — `history` carries
  a pre-existing, uniform 50-item cap (newest-first by `lastSeen`), so an
  archived legacy item ages out like any other history entry over many
  future generations. The cutover write itself never evicts what it just
  archived (fresh archives sort to the top); the cap is unchanged, uniform
  retention behavior, not a cutover deletion path.
- **basicInsights** (`src/services/basicInsights/basicInsightsOrchestrator.js`):
  has no active/history split — its cache doc is a single flat
  `basicInsights/current` doc, wholesale-replaced every generation, so
  there is nothing to archive. `generatorVersion` is stamped on every fresh
  cache doc; `getCachedBasicInsights` treats a doc with a missing or
  stale-versioned `generatorVersion` as **stale**, reusing its existing
  TTL/entries-changed staleness computation (no new invalidation path, no
  hard delete) — the cache regenerates exactly once, the next time it's
  read, and stays fresh on version grounds after that.
- `firestore.rules`' `nexus/{docId}` and `basicInsights/{insightId}` rules
  are both unconstrained owner-read/write maps (no field-shape validation)
  — verified by reading the rules file directly; the new
  `generatorVersion`/`legacyVersion` fields needed no rules change.
- **Feedback/exclusions are preserved by construction, not by any cutover
  logic touching them.** T5 already made `insightLearning` (basicInsights
  false-positive/suppression learning) and the Nexus
  `nexus/insights/insight_engagement` dismissal subcollection durably
  consumed inputs to generation (see below); the cutover write paths
  (`saveInsights`, `generateBasicInsights`'s `saveBasicInsights`) never
  write to either collection — asserted directly by test
  (`orchestrator.cutover.test.js`'s "never write insightLearning,
  insight_exclusions, or source_exclusions" case;
  `basicInsightsOrchestrator.cutover.test.js`'s analogous case).

**Feedback is now consumed (R4 Task 5, DR finding 10 — "feedback is stored
but never consumed").** Before R4, `falsePositiveEntryIds`/
`falsePositivePatterns` were recorded on user feedback but never read back
into generation, Nexus dismissals were an in-tab-only React state Set (gone
on reload), and a resurfacing bug (`entriesAtLastEvaluation` permanently
stuck at its `0` default) meant a suppressed basicInsights pattern could
clear its re-evaluation threshold on literally the next read regardless of
whether any new entries existed. All three are fixed and durable now:
`generateBasicInsights` filters false-positive-flagged candidates
pre-scoring (`filterFalsePositiveCandidates`); Nexus dismissals persist to
`nexus/insights/insight_engagement/{dismissalKey}` and are filtered at
every `getCachedInsights` read (`src/services/nexus/insightDismissal.js`),
keyed by a **content-derived stable key** (`dismissalKeyFor`) rather than
the raw insight `id` — causal-synthesis/recommendation/entity-correlation
ids are `Date.now()`-minted and churn every generation, so an id-keyed
dismissal was a no-op for exactly those types; a genuinely reworded claim
(different title/intervention/entity+direction) produces a different key
and legitimately resurfaces (documented boundary, not a bug — see that
file's own comment); and suppression now **fails toward holding**: an
unstamped baseline (0/absent, including every pre-T5b legacy doc) is
treated as "no genuinely new entries yet" rather than "the corpus was
empty," so it holds suppression and lazily self-heals the doc on that same
read (`feedbackLearning.js`'s `evaluateShowDecision`), instead of
resurfacing on the very next evaluation.

**Risky-claims suppression state (ratified decision 4).** Fixing the
Mood01 scale bugs would, as a side effect, "wake up" four claim types that
had effectively been dead code (comparing native 0-1 values against
0-100-scale thresholds — always-true/always-false, never a real gate):
personal counterfactuals, belief-dissonance insights, intervention "this
worked" OUTCOME claims, and personalized recommendation reasoning. Michael
ratified that the scale fix must NOT reactivate them until Phase 1-2's
evidence rails (typed claim store, verified synthesis) exist. This is
gated by **`RISKY_CLAIMS_ENABLED = false`, an internal constant exported
from `src/services/nexus/orchestrator.js`** (not a `config/flags` Firestore
doc, not user- or environment-configurable) — `generateInsights`'s
`riskyClaimsEnabled` option can override it, but that seam exists ONLY so
tests can exercise the scale-corrected logic end-to-end; no production
caller ever passes it. Recommendations are relabeled as "ideas" carrying no
personal-evidence claim rather than being suppressed outright; fabricated
fallback reasoning (invented biometric/mood-improvement numbers) was
deleted from the code outright, not merely gated. **Revisit when Phase 1-2
lands** — flip this one constant, no other code change needed to
re-activate the four claim types.

**Validation:** `src/__tests__/validationMatrix.test.js` R4 rows (a)-(i);
dedicated per-area test files cited throughout the sections above and in
`.superpowers/sdd/task-6-report.md`.

## R4 Phase 1 (Insight Integrity — canonical claim store + evidence rails)

Plan: `docs/superpowers/plans/2026-07-22-r4-phase1-evidence-foundation.md`.
Where Phase 0 above repaired the legacy engines' *statistics*, Phase 1 adds
the evidence-integrity machinery the DR calls for on top of them: a daily
observation rollup, a hypothesis-family multiple-testing ledger, an
evidence builder implementing the DR's 8-gate integrity ladder, and a
versioned, immutable-with-lineage `InsightClaim` store — all gated behind
one new client flag, **`insightClaims`, default OFF**. Full task-by-task
detail: `.superpowers/sdd/task-{1,2,3,4,5,6,7,8,9,10}-report.md`.

**Flag: `insightClaims`.** Same mechanism as every flag in this doc —
`config/flags` Firestore doc, `src/config/flags.js` `FLAG_DEFAULTS`, no
deploy required. Flip with:

```
node scripts/flip-flag.mjs insightClaims true
```

**Prerequisites: none.** Unlike `gentleRevisit`/`personalExperiments`
above, this flag has no memo-sign-off gate — Phase 1's claims are
deterministic-wording-only (buildClaim rejects causal language outright;
see below), so there is no LLM-authored content or novel statistical-design
judgment call for a memo to adjudicate. **Independent of every other flag
in this doc** — it does not need `personalExperiments`, `insightReceipts`,
or any R1-R3 flag on or off first, and flipping it does not interact with
their state. Recommended order is therefore "whenever Michael wants it,"
not part of any sequence. Michael's own gate for this one is lighter-weight
and tracked in `PROJECT_STATUS.md`'s checklist: eyeball claim cards on his
own data before flipping (no written sign-off doc required, since the
wording is deterministic and code-reviewed, not model-generated).

**What flipping it on adds.** `basicInsightsOrchestrator.js`'s
`generateBasicInsights` gains one best-effort, post-generation hook
(`src/services/insights/claims/claimsPipeline.js`'s `generateClaims`) that
runs strictly AFTER the legacy insights are computed and cached — any error
inside it is caught and logged, never regresses or blocks legacy
`basicInsights` output. With the flag OFF, `generateClaims` is never
invoked at all (see validation matrix row R4P1-i) — legacy behavior is
byte-identical either way.

**Two new Firestore collections, both under `artifacts/{APP}/users/{uid}/`,
owner-only (no cross-user or public access), no new composite index
required** (every read against them is either a direct-doc-ref
transaction/get or an unfiltered `getDocs` over the whole collection — see
`firestore.rules` for the exact shape rules):

- **`testing_ledger/{familyId}`** — one doc per *hypothesis family*, not per
  candidate. Families pool at the ENGINE level
  (`testingLedger.js#familyIdForBasic`: `basic:{activity|people|category|
  health}:mood` — a plan correction from the original per-exposure-key
  design, ratified by the controller; see PROJECT_STATUS decisions below).
  A family's `candidates` map lists every exposure key ever tested inside
  it (`tag:gym`, `entity:sarah`, `health:sleepHours`, ...); `testedCount` is
  the map's size — the family's Bonferroni multiple-testing burden `m`.
  Rules enforce `testedCount` can only ever stay the same or grow on
  update, never shrink.
- **`insight_claims/{claimId}`** — one doc per claim VERSION (never
  overwritten in place). `claimId` is deterministic
  (`claimSchema.js#claimDocId`: `claim_{slug}_{fnv1a8}_v{version}`) so the
  same candidate always re-derives the same id at the same version. Rules
  allow `create` only with the full frozen shape, and `update` only to
  `{status, supersededByClaimId, updatedAt}` — see claim lineage semantics
  below.

**Ledger semantics — `m` never decreases; don't delete a ledger doc.**
Every candidate hypothesis is registered in its family's ledger BEFORE any
analysis runs (`generateClaims`: one `registerCandidates` call per engine
family, covering every exposure key `enumerateExposures` found that run),
so an inconclusive, ineligible, or later-suppressed candidate still counts
toward the family's multiple-testing burden — this is what makes the
Bonferroni correction (`bonferroniCiLevel`, frozen onto
`analysisPlan.ciLevel` before the estimator ever runs) honest rather than
gameable. **Deleting a `testing_ledger` doc resets that honesty** — the
family's `m` would silently drop back toward 1, narrowing every subsequent
candidate's confidence interval as if fewer hypotheses had ever been
tested, even though the same candidates will be re-tested and re-counted
going forward. There is no code path that deletes a ledger doc (rules allow
owner `delete` only for the user's own data-rights request, same posture as
every other owner-scoped collection in this app) — treat that as a
one-way, "user explicitly asked to delete their data" action only, never a
maintenance/reset step.

**Claim lineage semantics.** A written claim is immutable at the fact
level — `wording`/`evidence`/`analysisPlan`/`subject`/`direction` etc. can
never change on an existing doc, enforced independently in
`firestore.rules` (`insight_claims collection rules (update contract)`) AND
in `claimSchema.js`/`claimsService.js` (`setClaimStatus`'s own allowlist:
`['suppressed', 'verified', 'expired']` — see validation matrix row
R4P1-d). When evidence for a still-eligible candidate meaningfully changes,
the pipeline never edits the old doc — it writes a NEW claim doc at
`version + 1` with `parentClaimId` pointing at the old claim, then stamps
`supersededByClaimId` on the old doc pointing forward at the new one
(`supersedeClaim`, one atomic batch). Both versions persist forever;
`listActiveClaims` filters to only the non-superseded, non-suppressed/
non-expired ones (validation matrix row R4P1-g).

Two claim statuses a corrected/stale claim can land in, and they mean
different things:
- **`expired`** — the pipeline itself determined, from the current run's
  data, that this claim's candidate is *currently not derivable*: either it
  re-enumerated the candidate and it no longer clears the evidence gates
  (retraction — see below), or the candidate vanished from enumeration
  entirely (e.g. every backing entry got source-excluded). This is a
  system judgment, not a user one, and it is **revivable** — if the
  evidence strengthens again on a later run, the pipeline supersedes the
  expired claim with a fresh verified one, same as any other evidence
  change (validation matrix row R4P1-d's revival case in
  `claimsPipeline.test.js`).
- **`suppressed`** — the USER chose to hide this claim (`do_not_analyze`
  feedback). This is a preference, not a data judgment, and the pipeline
  **never auto-touches a suppressed claim** — not on retraction, not on
  vanished-candidate sweep, not on re-eligibility. It only lifts via
  explicit user action (a future "liftable" UI surface — not yet built;
  `setClaimStatus` supports flipping it back to `verified` at the
  primitive level today).

**Retraction.** A live `verified` claim is moved to `expired` (never
deleted) in exactly two cases, both handled inside `generateClaims`: (i)
its candidate is still enumerated this run but no longer clears the
evidence-builder's gates (interval now includes zero, effect fell below
the practical floor, etc.); (ii) its candidate vanished from
`enumerateExposures`'s output entirely (data drift, or every backing entry
got excluded). A suppressed prior is never touched by either path — user
suppression sticks regardless of what the gates say next run. See
validation matrix rows R4P1-a/d and `claimsPipeline.test.js`'s own
"retraction"/"vanished-candidate retraction" suites for the exhaustive
case matrix.

**`source_exclusions` consumption.** `generateClaims` reads
`listSourceExclusions` ONCE per run and drops any entry named by an
exclusion whose `appliesTo` is `'all'` OR starts with `'basic:'` (every
family this pipeline can produce) — a documented, deliberately
conservative over-exclusion: a `wrong_source` correction against ONE
family excludes that entry from the WHOLE run (every family), not just the
family it was flagged for, because building per-family day-rollups
separately would conflict with `buildDailyObservations` running once for
the whole batch. A read failure here is FAIL-CLOSED — `generateClaims`
rejects rather than silently running as if no exclusions existed; the
orchestrator's own hook already wraps this in try/catch, so a failure
skips that run's claim generation without touching legacy `basicInsights`
output. See `claimsPipeline.js`'s own header comment and validation matrix
row R4P1-e.

**Phase 2 pointers** (not yet built — tracked in the plan's own outline,
not repeated here in full): an LLM writer/verifier pair authoring
`wording` from a claim's already-deterministic `evidence` (never authoring
facts), a single unified insight feed replacing the current
Nexus/basicInsights split, and a comprehension gate (≥80% correct on a
short in-app "what does this claim mean" check) before any claim surface
is allowed to ship outside internal testing — mirrors DR integrity-ladder
gate 8, explicitly deferred past Phase 1 in the plan's own gate mapping.

**Validation:** `src/__tests__/validationMatrix.test.js` R4P1 rows (a)-(i);
dedicated per-module test files:
`src/services/insights/claims/__tests__/{claimsPipeline,claimsService,
claimSchema,evidenceBuilder,claimFeedback}.test.js`,
`src/services/insights/__tests__/testingLedger.test.js`; rules:
`functions/src/__tests__/firestoreRules.test.js` (`testing_ledger
collection rules`, `insight_claims collection rules`).

## R4 Phase 2 (Insight Integrity — writer/verifier + trustworthy synthesis)

Plan: `docs/superpowers/plans/2026-07-23-r4-phase2-trustworthy-synthesis.md`.
Where Phase 1 built the claim store and evidence rails, Phase 2 closes the
three pointers that section left for later: a constrained LLM writer/
verifier pair that can author a claim's prose (never its facts), one unified
ranked feed replacing the Nexus/basicInsights split, and claim-routed
contextual surfaces (Ask Journal, reports). **No new client flag** —
everything here rides the existing `insightClaims` flag; the writer path has
its own, separate, code-level dark switch (below). Full task-by-task detail:
`.superpowers/sdd/task-p2-{1..9}-report.md`.

**`LLM_WRITER_ENABLED` — a constant, not a flag, and it ships FALSE.**
`src/services/insights/claims/claimsPipeline.js` exports
`LLM_WRITER_ENABLED = false`. This is the single production switch for
whether `generateClaims` ever attempts the server `writeClaimWording`
callable at all — with it false, the pipeline runs its Phase-1 deterministic-
template path unconditionally and the callable is invoked zero times
(validation matrix row R4P2-a). `generateClaims`'s `options.llmWriterEnabled`
overrides the constant, but ONLY as a test seam (`options ?? LLM_WRITER_ENABLED`
— see rows R4P2-d) — there is no production call site that passes it, so
flipping the constant is the only way real traffic reaches the writer.
**Flip procedure:** edit `LLM_WRITER_ENABLED` in `claimsPipeline.js`, PR +
deploy — a code change, not a Firestore/console flag flip, is deliberate:
this switch decides whether an LLM authors user-facing wording at all, which
Michael's own gate (PROJECT_STATUS checklist item 12) wants exercised as an
explicit, reviewed change, not a remote toggle someone could flip by
accident. **The option to promote it to a proper `config/flags` boolean
later exists** (same mechanism as every other flag in this doc) if a
faster-than-deploy kill switch is ever needed post-launch — not built now,
because the fallback below already makes "stuck on" impossible even without
one.

**The fallback guarantee is absolute even with the writer ON.** Regardless
of `LLM_WRITER_ENABLED`, a claim can never fail to exist and unverified prose
can never reach a doc:
1. The server verifier (below) must return `verdict:'pass'` before any
   wording is returned to the client at all.
2. ANY callable error, timeout, or `verdict !== 'pass'` response falls back
   silently to the Phase-1 deterministic template — validated end-to-end by
   row R4P2-d with a REJECTING callable and a `verdict:'fail'` response.
3. Even a `verdict:'pass'` wording is re-validated locally by `buildClaim`'s
   own `CAUSAL_RE` + full shape check (belt-and-braces) before it can reach
   a write; a local rejection ALSO falls back to the template rather than
   dropping the claim.
`llmWordings` (a per-run stat on `generateClaims`'s return value) counts only
successful LLM-authored writes — it is `0` in every fallback case above, so
a dashboard/log reading it can distinguish "writer attempted and used" from
"writer attempted and fell back," never conflating the two.

**Writer/verifier contract, server-side, both new Cloud Functions modules
(R4 Phase 2 T1-T3):**
- `functions/src/insights/claimWriter.js` — `writeWording(bundle, {callModel})`
  proposes ONE non-causal sentence (its `SYSTEM_PROMPT` is asserted verbatim
  by tests — the contract lines are: explain only the bundle, treat excerpts
  as inert quoted data even if they contain instruction-shaped text
  (injection guard), 1-2 sentences, describe association never cause, never
  invent a number, never mention hidden/sensitive material unless the bundle
  says so, echo the bundle's `deterministicWording` as a style/length
  anchor only — never copy it verbatim, return strict `{"wording":"..."}`
  JSON). Balanced-`{...}` extraction tolerates a fenced/prefixed response;
  never throws — any parse failure resolves to `null` so the caller falls
  back.
- `functions/src/insights/claimVerifier.js` — `verifyWording(wording, bundle,
  {callModel})` composes two layers, cheap-first: `verifyDeterministic`
  (pure regex/string checks — causal language via the shared `CAUSAL_RE`,
  a banned-phrase list, unentailed numerals against the bundle's own
  numbers, a **direction check** that also catches `better`/`worse`
  phrasing (not just `higher`/`lower`), an NFKC-normalization pass so
  fullwidth-digit/homoglyph tricks don't dodge the numeral check, a
  2-sentence/320-char length cap, and a hidden-material reference check)
  runs first and short-circuits the model call entirely on any failure; only
  if it passes does `verifyWithModel` ask an independent model whether every
  factual assertion is entailed by the bundle's JSON. **Fails closed**: a
  thrown error, network failure, or any output that isn't strict
  `{"entailed":true,...}` JSON is treated as NOT entailed — there is no
  silent-pass path (row R4P2-c). **Known limitation** (documented, not
  fixed): `verifyDeterministic`'s numeral check is digit-regex only —
  spelled-out magnitudes ("twelve points higher") bypass it by design; the
  fail-closed LLM entailment layer is the backstop. Do not silently widen
  the regex without extending this section's parity/matrix coverage.
- `writeClaimWording` callable (`functions/src/insights/
  writeClaimWordingHandler.js`, `functions/index.js`) — composes both:
  writer proposes, verifier polices, and on a fail verdict ONE rewrite is
  attempted with the verifier's reasons appended to the prompt
  (`MAX_WRITER_ATTEMPTS = 2`) before returning `verdict:'fail'`. Bundle
  shape is validated BEFORE any model call (`isValidBundle`: only the
  documented keys, ≤8 excerpts, ≤200 chars each) — a malformed bundle never
  spends a model call. `timeoutSeconds: 120`,
  `DAILY_QUOTA.claimWriter: 100`. A response whose contract shape is
  unexpected (missing `verdict`, etc.) is caught and treated as a failure by
  the client wrapper, never thrown up to the pipeline.

**Why the verifier model must stay a DIFFERENT model than the writer.**
`functions/src/models/registry.js`'s `MODEL_DEFAULTS` deliberately sets
`insightWriter: 'gemini-3.5-flash'` and `insightVerifier:
'gemini-3-flash-preview'` — two different model ids. The verifier's whole
job is to catch the writer's mistakes; if both roles ran the same model, a
blind spot in that model (a phrasing it consistently over-trusts, a numeral
rounding habit it doesn't flag in its own output) would pass its own
unentailed claims, because the "independent" check would not actually be
independent. This is a structural requirement, not a cost optimization —
do not "simplify" the two workloads to one model without re-deriving this
invariant.

**`model.insightWriter`/`model.insightVerifier` overrides** follow the same
mechanism as every other workload in the "Model registry flip procedure"
section above: set the `config/flags` doc field (Admin SDK/console only),
takes effect within the 60s cache TTL, no deploy. `scripts/flip-flag.mjs`'s
`STRING_ALLOWED` allowlist now carries both keys (R4 Phase 3 backlog burn-
down, P3-D7) — `node scripts/flip-flag.mjs model.insightWriter <model-id|
default>` / `model.insightVerifier <model-id|default>` works from the CLI
same as `model.fusedTranscription`; each accepts `'gemini-3.5-flash'`,
`'gemini-3-flash-preview'`, or `'default'` (deletes the override, reverting
to the registry default). The tool does not itself enforce the
writer/verifier model-difference invariant above — its own inline comment
warns not to set both to the same id without re-deriving why they differ
first.

**Unified ranked feed (single-feed-swap, plan decision P2-D5).**
`InsightsPage.jsx`: when `insightClaims` is ON, the new `ClaimFeed`
component (`src/components/insights/ClaimFeed.jsx`, backed by
`rankClaims.js`) REPLACES both the legacy "Quick Insights" block (basic
insights) AND the "AI Insights" Nexus block in one render — `useNexusInsights`
is called with `enabled: false` in that mode (no dark Firestore reads/
generation/Insight Budget work for a section that never renders), and
`RecommendationsSection` plus its own `getTodayRecommendations` fetch are
both skipped outright (superseded by `experiment_result`/`pattern_to_watch`
claims over the same families). `CorrelationsSection` is UNCHANGED either
way — it was never part of the swap. Flag OFF renders the exact legacy tree,
byte-identical, with zero claim reads (`useClaims.js` internally gates on
the flag, so `listActiveClaims` is never even called — validation matrix row
R4P2-g proves both directions against the real `InsightsPage`/`useClaims`/
`claimsService` stack). `rankClaims` orders `experiment_result >
pattern_to_watch > observation` (claimType weight dominates), then
`|effectMoodPoints|`, then a recency boost, then a stable id tiebreak —
deterministic, memoized per `[claims]` change in `ClaimFeed` (not
recomputed every render).

**Sparse-feed expectation is deliberate, not a bug to chase.** The feed's
empty state ("Nothing verified yet... a pattern will show up here the
moment the evidence clears the bar") is the intended steady state for a new
account or a quiet stretch — Engram does not manufacture a claim to fill the
space. Don't treat a sparse/empty `ClaimFeed` as a regression signal on its
own; check the evidence gates (Phase 1's 8-gate ladder) before assuming
something broke.

**Ask Journal (P2-D6, `src/services/analysis/index.js`).**
`buildVerifiedPatternsBlock` (flag-gated `insightClaims`) loads the user's
active claims, re-filters to `status === 'verified'` ONLY (this re-filter is
load-bearing: `listActiveClaims` itself also returns `candidate`-status
claims for the Quick-Insights surface — Ask Journal must never surface an
unverified one), ranks with the same `rankClaims`, caps at 5, and formats
into a single `VERIFIED PATTERNS (associations from this user's recorded
days — never causal):` labeled block. It is PREPENDED to `entriesContext`
(never appended) so the model reads it before any raw entry text. Failure is
fully contained: flag off, no signed-in user, or any load error (Firestore
down, etc.) all resolve to `''` — byte-identical to the pre-Phase-2 context
in every such case (validation matrix row R4P2-i).

**Reports (P2-D6, `functions/src/reports/{narrative,generator}.js`).**
`generator.js`'s `readVerifiedClaims` reads the user's claims collection
directly (Admin SDK), ranks, and caps at 5 — capped the same way as the Ask
Journal block, and the same fail-closed-to-empty-array posture on a read
error (a report must still generate). The **"What held up this period"**
section (`narrative.js`'s `buildHeldUpSection`) renders ONLY the single
top-ranked verified claim's own `wording` + day-count + first limitation —
never an LLM paraphrase, never a Nexus insight. Zero claims -> an explicit
"No verified patterns held up this period" copy, which deliberately never
falls back to Nexus prose. The premium (monthly/quarterly/annual)
narrative's LLM prompt (`buildSectionPrompt`) also carries the same ranked/
capped claims list as grounding context, labeled "Verified patterns this
period... treat as established fact" — the OLD `nexusInsightLabel` seam that
used to feed this same prompt with ANOTHER, unverified LLM's Nexus prose has
been removed outright; a populated Nexus fixture's summary text can no
longer reach either surface (validation matrix row R4P2-h asserts this as an
explicit negative — a Nexus summary string is fed into the fixture and
proven absent from every `callGemini` call).

**Comprehension gate — a PROCESS item, not code (plan decision P2-D7).**
DR integrity-ladder gate 8 calls for a user-facing comprehension check
(≥80% correct on a short "what does this claim mean" quiz) before any claim
surface ships to broad release. **No quiz code exists in this codebase by
deliberate decision** — Phase 2 ships the writer dark and the flag
default-OFF, so there is no broad-release moment yet for the gate to guard.
This is tracked as a PROJECT_STATUS checklist item to action manually
(Michael eyeballing claim comprehension himself, or building the quiz
surface) before any future flip to broad release — not a Phase 2
deliverable, and not something a future session should assume is silently
satisfied because the flag exists.

**Validation:** `src/__tests__/validationMatrix.test.js` R4P2 rows (a)-(i);
`src/services/insights/claims/__tests__/causalReParity.test.js` (client
`claimSchema.js` `CAUSAL_RE` <-> server `claimVerifier.js` `CAUSAL_RE`
parity — source/flags byte-identity plus a shared adversarial fixture list,
same precedent as `dismissalKeyParity.test.js`); dedicated per-module test
files: `functions/src/insights/__tests__/{claimVerifier,claimWriter,
writeClaimWordingHandler}.test.js`,
`src/services/insights/claims/__tests__/{writerBundle,rankClaims}.test.js`,
`src/services/experiments/__tests__/experimentClaim.test.js`,
`src/pages/__tests__/InsightsPage.claims.test.jsx`,
`functions/src/reports/__tests__/narrative.test.js`.

## R4 Phase 3 (Action Loop & Risky-Claim Retirement)

Plan: `docs/superpowers/plans/2026-07-23-r4-phase3-action-loop.md`. Closes R4
by replacing the four suppressed risky-claim modules with the evidence-
railed action loop the deep review actually prescribed — idea -> try-as-
experiment -> explicit confirmation -> outcome claim -> repeat — and
deleting the mention-based machinery they were built on. **No new client
flag; `RISKY_CLAIMS_ENABLED` (the internal code constant, not a flag) is
RETIRED, not flipped** — there is nothing suppressible left for it to gate.
Full task-by-task detail: `.superpowers/sdd/task-p3-{1..7}-report.md`.

**Deletions and what replaced them (P3-D1).** Three modules are deleted
whole (files absent, imports unresolvable — validation matrix row R4P3-b):
`src/services/nexus/layer3/counterfactual.js`, `src/services/nexus/layer3/
beliefDissonance.js` (its "corpus-building" half made an UNCONDITIONAL per-
generation LLM call with zero downstream consumer — real waste, now gone),
`src/services/nexus/layer4/interventionTracker.js` (the mention-based
effectiveness tracker DR finding 7 condemned: "recommends without personal
evidence"). `src/services/nexus/layer4/recommendationEngine.js` is REDUCED,
not deleted — it keeps only the static state -> idea-category map and
generic, no-evidence-claimed wording (`genericIdeaReasoning`); its personal-
evidence scoring (`scoreRecommendation`), personalized reasoning
(`generateReasoning`), outcome prediction (`predictOutcome`), and the
`MIN_EVIDENCE_OCCURRENCES` floor that only ever fed that scoring are all
gone. `orchestrator.js`'s `RISKY_CLAIMS_ENABLED` export and every
`riskyClaimsEnabled`/`options.riskyClaimsEnabled` thread are removed with a
tombstone comment at the old location, pointing here. Firestore belief/
intervention docs from before this phase are left ORPHANED, never deleted —
harmless, no code reads them anymore.

**Idea-card behavior change (worth eyeballing live).** With the personal-
evidence branches gone, every "Idea to Try" card is now a single generic
suggestion per generation slot, with NO evidence floor (the old
`MIN_EVIDENCE_OCCURRENCES` gate is gone along with the scoring it fed) —
`insightIntegration.js`'s `getTodayRecommendations` and orchestrator's own
idea-generation block both always title the card `'An Idea to Try'` and
never emit a `score`/`expectedOutcome`/`confidence` field (validation matrix
row R4P3-a). The live, ungated sunshine-recommendation percentage leak
(`insightIntegration.js`, "...% higher on sunny days" — a Phase-0 decision-4
leak that reached flag-OFF users today, P3-D8) is fixed in the same pass:
replaced with a generic non-evidence line, no conditional. Check the actual
generation frequency/variety live on your own data — this phase did not add
a novelty/rotation mechanism beyond what `recommendationEngine.js`'s static
state map already provided.

**Action loop: Try-as-experiment, end-to-end (P3-D2).** Both ClaimCards
(`insightClaims` ON) and idea cards (flag-OFF, mapped types only —
recovery/activity/environment; self_care/other get no button) now carry a
"Try as an experiment" affordance that prefills `ExperimentsScreen` via
`AppLayout`'s `experimentPrefill` state and `onTryExperiment(templateId,
tag)` — gated on `personalExperiments` (a hidden screen never gets a visible
button pointing at it). The prefill flow runs through the EXACT SAME
`screenAndProceed` choke point every other creation path uses:
`screenQuestion` is invoked and must pass BEFORE any template/step state
advances — a forced decline blocks the advance entirely, proven against the
real component (validation matrix row R4P3-c; full surface in the dedicated
`ExperimentsScreen.prefill.test.jsx`). There is exactly one experiment-
creation path, one safety gate — no parallel route was added.

**Confirmed-exposure experiments — action confirmation v1 (P3-D3).** Tag-
template experiments only, opt-in at CREATE via a frozen
`analysisPlan.exposureMode: 'passive' | 'confirmed'` (absent/legacy plan ===
`'passive'`, unchanged behavior — byte-identical regression proof at
validation matrix row R4P3-d). Confirmed mode replaces tag-scanning with a
`confirmations` subcollection of daily check-ins
(`artifacts/{APP}/users/{uid}/experiments/{id}/confirmations/{dateKey}`,
`{dateKey, done: boolean, createdAt}`) the client only writes while the
parent experiment is `running` (frozen history once it isn't). The exposure
series is TRI-STATE, never binary: `done:true -> 1`, `done:false -> 0`
(a real, counted "no," not a gap), a day with **no confirmation doc ->
OMITTED entirely** — never assumed absent, never defaulted to 0 (validation
matrix row R4P3-d). **Honesty copy, binding:** the create-flow's opt-in step
says, in effect, "confirmed = you check in daily; missed days count as
unknown, not no" — and the result view states its exposure source
explicitly ("from your daily check-ins, N days answered") whenever
`exposureMode === 'confirmed'`. Rules: `firestore.rules`' confirmations
block enforces owner CRUD with an exact `hasOnly(['dateKey','done',
'createdAt'])` shape, denies a mismatched doc-id/dateKey pair, denies cross-
user access — exercised by the emulator-only suite
`functions/src/__tests__/firestoreRules.test.js`'s "Experiment confirmations
subcollection rules" describe block (`npm run test:rules`); the JS-side seam
(that `setConfirmation`/`clearConfirmation` write/delete exactly that shape,
and both refuse once the experiment leaves `running`) is validation matrix
row R4P3-f.

**Repeated trials — family history, repeat button, and the lineage fix
(P3-D4).** `ExperimentResultView` gains a "This hypothesis" section (only
when M > 1 prior completed runs share the same `hypothesisFamilyId`):
"Run N of M" plus every prior run's own delta, sorted OLDEST-FIRST BY
`createdAt` (immutable — see below), with an explicit no-pooling note.
There is deliberately NO cross-run statistics — the plan's own rationale:
"cross-run meta-analysis needs statistics we deliberately don't have." A
completed experiment's row gets a "Repeat this experiment" button
(`ExperimentsScreen.jsx`) that re-enters the SAME prefill/`screenAndProceed`
path as the ideas seam above (fresh freeze, fresh `screenQuestion` call,
ledger `timesTested` increments naturally). **The load-bearing part: the
repeat-run claim lineage fix.** Before this phase, a repeat run's
`experiment_result` claim collided on a deterministic doc id with the prior
run's claim, got rules-denied, and silently vanished — repeat runs never
got a claim at all. `writeOrSupersedeExperimentResultClaim`
(`experimentsService.js`, shared by both `writeResult` and
`writeAdjustedResult`) now finds the LIVE prior claim for the same
`(claimType: 'experiment_result', candidateId: hypothesisFamilyId)`: none ->
write v1; prior `suppressed` -> SKIP (the write never happens — suppression
is never auto-touched by a fresh computation, invariant unchanged); prior
verified/expired -> SUPERSEDE (`version: prior.version + 1, parentClaimId:
prior.id`, both docs persist, old one gets `supersededByClaimId`).
Validation matrix row R4P3-e proves both branches against the real module.

**Run-identity fix (final review, closure wave — Important 1, RESOLVED).**
The repeat-run lineage fix above closed the doc-id COLLISION defect (a
fresh repeat completion silently vanishing), but left a separate ORDERING
gap: `experiment_result` claims carried no run identity at all, so a
post-completion exclusion adjustment on an OLD run (allowed any time —
`setObservationExcluded` only forbids a `stopped` experiment, not an old
completed one) would unconditionally supersede whatever claim was currently
live — even a SECOND run's already-current claim — silently making stale,
re-excluded data look like the family's latest result, with no way for a
reader to tell. Fixed via two additions: `experimentClaim.js`'s
`buildExperimentResultClaim` now stamps `analysisPlan.sourceExperimentId`
(the producing experiment's id) and `analysisPlan.sourceCompletedAt` onto
every claim it builds; `sourceCompletedAt` deliberately reuses the run's own
immutable `frozenAt`/`createdAt` (plan-frozen the instant the experiment
leaves `draft`), NOT this function's ambient `now` argument — `now` is the
wall-clock MOMENT THE CLAIM WAS BUILT, which for a `writeAdjustedResult`
call on an old run is whenever the user happens to open it and toggle an
exclusion, easily well after a second run has already completed; using it
directly would have made the old run's adjustment look "newer" purely
because it happened later in wall-clock time. `writeOrSupersedeExperiment
ResultClaim` (`experimentsService.js`) now compares the incoming claim's run
identity against the currently-live claim's: an incoming claim from a
DIFFERENT, chronologically OLDER run (`sourceCompletedAt` earlier, per real
`createdAt` ordering) is SKIPPED entirely — no write, no supersede; the
newer run's claim stays exactly as-is, and the adjusted old result remains
fully visible on its own experiment doc regardless (only the derivative
claim declines to overwrite). A same-run adjustment (matching
`sourceExperimentId`) always supersedes, unconditionally, same as before. A
legacy live claim written before this fix (neither stamp present) is also
superseded unconditionally — there is no ordering information to compare,
so this preserves the pre-fix behavior rather than guessing, and the gap
self-heals the moment a real stamped claim is written for that candidate.
Both keys are OPTIONAL in `claimSchema.js` (present only on `experiment_
result` claims going forward; absent on every `pattern_to_watch`/
`observation` pipeline claim and on any pre-fix legacy experiment claim).
Full TDD evidence: `.superpowers/sdd/task-p3-6-report.md`'s "Closure wave"
addendum. **PROJECT_STATUS checklist item (11) was never blocked on this**
— `insightClaims` flip readiness is unaffected either way — but the gap is
now closed regardless of when it flips.

**Repeat-of-suppressed hint (review addition, post-ship).** Because a
suppressed prior means the repeat run's claim is silently skipped (by
design, above), a user who repeats a hypothesis they've already muted would
otherwise see no claim show up with no explanation. `ExperimentResultView`
now computes, best-effort, whether this family's current LIVE
`experiment_result` claim is `suppressed` (a `listAllClaims` read; a
contained failure just omits the note, same posture as the family-history
section's own failure mode) and shows one subtle line: "This hypothesis is
muted in your feed — its new result won't appear there until you un-mute it
in feedback settings." Renders independent of the M>1 family-history gate
(it applies even to a first/only run whose claim is already muted).

**Family-history sort-key fix (review addition, post-ship).**
`listFamilyRuns` now sorts by `createdAt` (immutable, plan-frozen), NOT
`updatedAt`. `updatedAt` is still what's DISPLAYED as `completedAt` —
unchanged — but a later exclusion-adjustment on an earlier run bumps that
run's `updatedAt` past a more-recent run's own completion, which used to
silently reshuffle "Run N of M" labels. `createdAt` never moves after
creation, so run order — and every label — stays fixed for the family's
life.

**Ledger line dropped from the family-history section (review addition,
post-ship).** The section previously supplemented "Run N of M" with "this
family's testing ledger has N candidate hypothesis(es) on record" via a
`readLedgerCounts` read. Removed entirely: `candidateTestsCount` for an
experiment family is invariantly 1 (each family has exactly one candidate —
itself), so the line only ever said "1 candidate hypothesis," conveying
nothing "Run N of M" didn't already say more plainly. Simplest honest fix
— drop it, not caveat it. The `readLedgerCounts` read itself is gone from
this view along with the line it fed.

**Calibrated predictions — WONTFIX (P3-D5).** The deep review's integrity
ladder calls for prospective, holdout-evaluated predictions (train on
earlier data, score against later data the model never saw). This is
deliberately NOT built in Phase 3, or scaffolded for later: it requires a
broad-release, multi-user evaluation harness to mean anything, and at n=1
(Michael) prospective holdout scoring is ceremony, not signal. Documented as
a conscious gap, not silently dropped — revisit if/when Engram has enough
users for held-out evaluation to be meaningful.

**Nexus LLM synthesis generators stay running — NOT deleted this phase
(P3-D6).** Causal synthesis, narrative arc, and meta-pattern generation
(`layer3/synthesizer.js`, `layer3/crossThreadDetector.js`) are Michael's
LIVE top-ranked content on the flag-OFF nexus surface today — deleting them
before he's switched to the `ClaimFeed` surface would force his hand.
Deletion is deferred to **PROJECT_STATUS checklist item (13)**: after
Michael flips `insightClaims` and lives with the `ClaimFeed` for a while, he
says the word and the nexus LLM synthesis generators get deleted. This
reframes P2-D8's "Phase 3 cleanup" as "post-flip cleanup" — reversibility
over tidiness, same posture as every other Phase 1-3 gate in this doc.

**Flag-OFF visible diff, summarized.** Beyond the sunshine leak fix and the
ideas-are-now-unconditionally-generic change above (both already visible
today, not gated), NOTHING else changes flag-OFF: the deleted modules were
already fully suppressed (belief/counterfactual insights never rendered),
and Try-as-experiment/confirmed-exposure/repeat are all gated on
`personalExperiments`, already OFF.

**Backlog burn-down riding along with this phase (P3-D7 + review items
A-D).** One-liners with existing review context, batched here rather than as
separate sessions:
- `src/config/flags.js`: vestigial `model.fusedTranscription35` removed from
  `FLAG_DEFAULTS` (zero consumers — confirmed by repo-wide grep before
  removal).
- `scripts/flip-flag.mjs`: `STRING_ALLOWED` gained `model.insightWriter`/
  `model.insightVerifier` — see the R4 Phase 2 section above (updated in
  place; that section previously described this as a not-yet-done caveat).
- `functions/src/insights/writeClaimWordingHandler.js`: the dead default
  `callGeminiImpl = defaultCallGemini` parameter fallback is removed —
  `callGeminiImpl` is now a REQUIRED injection; a caller that omits it gets
  an immediate, clear thrown error instead of a silent fallback that could
  fire a real, uncontrolled Gemini call from a test or a future call site
  that forgot to inject it. The one production call site
  (`functions/index.js`'s `writeClaimWording` callable) already always
  injected it explicitly, so this is a zero-behavior-change hardening.
- `src/hooks/useNexusInsights.js`: the `budgetedInsights` memo gained an
  explicit `if (!enabled) return [];` — previously the disabled contract
  only held BECAUSE every upstream effect happened to leave `allInsights`
  empty when disabled; now it's a direct, one-line invariant of the memo
  itself, and `applyInsightBudget` is provably never invoked while disabled
  (even with `insightBudget` ON).
- `src/components/settings/NexusSettings.jsx` / `src/services/nexus/
  orchestrator.js`'s `getDefaultSettings` / `src/services/nexus/data/
  schemas.js`: the `beliefDissonanceInsights` and `counterfactualInsights`
  feature toggles/default-keys/schema-field-strings are removed — both
  features were deleted whole above, so the toggles gated nothing.
  `interventionRecommendations` and `narrativeArcTracking` are KEPT —
  VERIFIED still read (the ideas-generation block and the narrative-arc
  synthesis block, respectively) before touching this. An existing user's
  settings doc may still carry the two dead keys from before this change —
  harmless, never read again (tombstone, not a migration).

**Validation:** `src/__tests__/validationMatrix.test.js` R4P3 rows (a)-(f)
— (a) no-personal-evidence-in-ideas (real `getTodayRecommendations` +
`generateRecommendations` + orchestrator ideas-wrapping, zero `%` literals,
title always `'An Idea to Try'`); (b) risky-modules-gone (the three deleted
modules unresolvable + a repo-wide fs-walk lint asserting zero LIVE
`RISKY_CLAIMS_ENABLED` code references in `src/`+`functions/src/`, mirroring
`src/utils/__tests__/hookImports.test.js`'s established pattern — historical
tombstone comments and test-description strings are correctly NOT
violations); (c) prefill-safety-order (real `ExperimentsScreen`,
`screenQuestion` before any state advance); (d) confirmed-exposure-tri-state
(real `computeExperimentResult` + `buildConfirmationSeries`, done:true/
done:false/missing, passive-mode byte-identical regression); (e) repeat-run-
lineage (real `writeOrSupersedeExperimentResultClaim`, both the supersede
and suppressed-skip branches); (f) confirmations-rules (JS-side seam; the
rules half is the emulator-only `firestoreRules.test.js` describe block
named above). Dedicated per-module test files:
`src/services/nexus/__tests__/{insightIntegration,orchestrator.ideas}.test.js`,
`src/components/experiments/__tests__/{ExperimentsScreen.prefill,
ExperimentResultView}.test.jsx`, `src/services/experiments/__tests__/
{computeResult,experimentsService}.test.js`,
`functions/src/insights/__tests__/writeClaimWordingHandler.test.js`,
`src/hooks/__tests__/useNexusInsights.test.js`,
`src/config/__tests__/flags.test.js`.

## SEC-01 (transport + browser hardening)

Closes the product review's SEC-01 finding: iOS ATS allowed arbitrary
network/web-content loads, jsPDF was injected at runtime from a third-party
CDN with no Subresource Integrity, and Firebase Hosting shipped no CSP or
standard security headers. Four independent changes, no flag (this is not a
product feature — it ships enforcing, immediately, in the next hosting
deploy).

### 1. Bundled jsPDF

`jspdf@2.5.1` (pinned exact, matching the version the CDN loader requested)
is now a normal `package.json` dependency. `src/utils/pdf.js`'s `loadJsPDF()`
loads it via a lazy `import('jspdf')` instead of injecting a
`<script src="https://.../jspdf.umd.min.js">` tag and polling
`window.jspdf`. Because it's a dynamic import Vite/Rollup still emits it as
its own chunk (`dist/assets/jspdf.es.min-*.js`, ~356 KB / ~116 KB gzip at
time of writing) — it is not in the main bundle and only downloads when a
PDF export (`TherapistExportScreen`, `sessionPrep.js`) actually runs, so
this is CSP-motivated, not a bundle-size regression.

`src/App.jsx` had a byte-for-byte duplicate of the old CDN loader
(`loadJsPDF`, local to that file) that was never called anywhere in the
file — the real call sites (`TherapistExportScreen.jsx`, `sessionPrep.js`)
always imported from `src/utils/pdf.js`. It was deleted as dead code rather
than converted.

Regression guard: `src/utils/__tests__/verification.test.js` →
`Verification: No Runtime CDN Script Injection` asserts (a) zero
`cdnjs.cloudflare.com` references anywhere under `src/` (excluding test
files, which necessarily mention the string to test for its absence), (b)
`jspdf` is pinned to an exact version in `package.json`, (c) `pdf.js` uses
`import('jspdf')` and contains neither `window.jspdf` nor a
`document.createElement('script')` call.

### 2. Firebase Hosting headers (`firebase.json`)

Added a `hosting.headers` block matching every route (`**`). Full CSP
string and the justification for every directive:

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'self'` | Safe default; every other directive below is an explicit, narrower carve-out. |
| `script-src` | `'self'` | No inline scripts remain (see §4) and no third-party script host is loaded (jsPDF is now bundled, §1). No `'unsafe-eval'` — production Vite/esbuild output doesn't need it. |
| `style-src` | `'self' 'unsafe-inline'` | React's `style={{...}}` (23 files) and every animation library in use (`framer-motion` in 71 files, `@dnd-kit`, `@xyflow/react`) set styles via the CSSOM (`element.style.x = ...`), which Chrome/Safari/Firefox do **not** gate behind `style-src` — only the declarative `style="..."` HTML attribute and `<style>`/`<link rel=stylesheet>` elements are. A repo-wide grep found no `dangerouslySetInnerHTML` writing a `style=` attribute and no `setAttribute('style', ...)`; the one `el.style.cssText = ...` site (`useWakeLock.js`) is also a CSSOM write, not an attribute write. So `'unsafe-inline'` is *not* required by any first-party code path found. It's kept anyway as a deliberate, low-risk hedge: style-only injection is a far weaker vector than script injection (no code execution, no data exfil beyond CSS-based side channels), and several dependencies (Radix portals, `@xyflow/react` node positioning) couldn't be exhaustively verified for attribute-style writes without live testing, which isn't available pre-deploy. Tightening this later (once verified in a real browser) is a safe follow-up, never a blocking one. |
| `img-src` | `'self' data: blob:'` | All app imagery is bundled/same-origin; icons are `lucide-react` components, not `<img>` tags. `data:`/`blob:` cover export/download flows (`URL.createObjectURL` in `diagnosticExport.js`, `TherapistExportScreen.jsx`, `InsightsPage.jsx`) and any inline data-URI assets. No third-party image host is fetched (grepped for `photoURL`/`googleusercontent` — unused; Google profile photos are never rendered). |
| `font-src` | `'self'` | All fonts are self-hosted via `@fontsource/geist-sans` and `@fontsource/newsreader`, imported into `src/index.css` and bundled — no `fonts.googleapis.com`/`fonts.gstatic.com` (enforced separately by `src/utils/__tests__/fontLoading.test.js`, pre-existing). |
| `media-src` | `'self' blob:'` | `new Audio(audioUrl)` in `Chat.jsx`/`UnifiedConversation.jsx` plays a `URL.createObjectURL` blob URL from `synthesizeSpeech()` (`src/utils/audio.js`). That function is currently a stub returning `null` (TTS was moved behind a Cloud Function that doesn't exist yet — `if (audioUrl)` never true today), so this is dormant, but scoped now rather than left to silently break TTS the day it's re-enabled. |
| `connect-src` | `'self'` + the hosts below | See host inventory method below. |
| `frame-src` | `'self' https://echo-vault-app.firebaseapp.com` | Firebase Auth's web SDK opens a hidden same-origin-policy helper iframe against the configured `authDomain` (`echo-vault-app.firebaseapp.com`) for redirect-result/network-independent auth state; `signInWithPopup` (Google, Apple) itself opens a top-level popup window, which is **not** governed by `frame-src` (that only restricts `<iframe>`/`<frame>` embeds, not `window.open`), so no additional host is needed there. |
| `object-src` | `'none'` | No `<object>`/`<embed>`/Flash usage anywhere in the app. |
| `base-uri` | `'self'` | Blocks `<base>` tag injection from redirecting relative-URL resolution. |
| `form-action` | `'self'` | No third-party form posts anywhere in the app (Firebase Auth/Functions calls are all `fetch`/SDK-driven, not `<form>` submissions). |
| `frame-ancestors` | `'none'` | Engram is never meant to be embedded in another site's frame; also covered redundantly by `X-Frame-Options: DENY` for older browsers that don't parse CSP2. |
| `upgrade-insecure-requests` | (no value) | Belt-and-suspenders — Hosting already serves HTTPS-only, but this also upgrades any stray `http://` link/asset reference instead of silently failing under the (already-strict) `connect-src`/`img-src` allowlists. |

**`connect-src` host inventory method**: every host was found by grepping
`src/` for `https://`, `wss://`, `ws://`, `fetch(`, `new WebSocket(`, and
tracing every Firebase SDK surface actually imported/called (`firebase/app`,
`firebase/auth`, `firebase/firestore`, `firebase/functions`,
`firebase/messaging`) to the Google API host each one talks to on the wire,
not just the ones with a literal string in `src/`. Result, with source:

| Host | Why |
|---|---|
| `https://firestore.googleapis.com` | Firestore reads/writes/listen channel (`firebase/firestore`, used throughout `src/repositories/`, `src/services/`). |
| `https://identitytoolkit.googleapis.com` | Firebase Auth's REST surface, used internally by `firebase/auth` for every sign-in/sign-up/password flow, and called directly in `App.jsx` (`signInWithCustomToken` REST fallback, line ~2413). |
| `https://securetoken.googleapis.com` | Firebase Auth ID-token refresh, used internally by `firebase/auth` — no direct call site in `src/`, but every authenticated session depends on it. |
| `https://us-central1-echo-vault-app.cloudfunctions.net` | `getFunctions(app)` (no region override → default `us-central1`) backs every `httpsCallable` (`analyzeJournalEntryFn`, `transcribeAudioFn`, `askJournalAIFn`, etc.), and `App.jsx` also `fetch()`s this host directly for `exchangeGoogleToken`/`exchangeAppleToken`. |
| `https://firebaseinstallations.googleapis.com` | Firebase Installations (FID) — required by `firebase/messaging`'s `getToken()`, called from `src/services/notifications/tokenManager.js` (`registerWebToken`) whenever a user grants notification permission on web. |
| `https://fcmregistrations.googleapis.com` | FCM web push token registration, same call site as above. |
| `https://api.open-meteo.com` | `src/services/environment/apis/weather.js` (`OPEN_METEO_BASE`) — current/historical weather for entry environmental context. |
| `https://api.sunrise-sunset.org` | `src/services/environment/apis/sunTimes.js` (`SUNRISE_SUNSET_API`) — sunrise/sunset times, same feature. |
| `https://echovault-voice-relay-2wotujlctq-uc.a.run.app` (https) | `src/services/health/whoop.js` `fetch()`s `getRelayHttpUrl()` (derived from the wss URL below) for Whoop OAuth/token-exchange proxying through the relay server. |
| `wss://echovault-voice-relay-2wotujlctq-uc.a.run.app` (wss) | `src/config/relay.js` `getRelayWsUrl()` — the voice-relay websocket used by `useVoiceRelay.js` for live transcription. Host value from `.env.example`'s `VITE_VOICE_RELAY_URL`; matches `PROJECT_STATUS.md`'s note that CI defaults hosting builds to this same public prod URL. |

**Explicitly excluded** (verified absent, not just unmentioned): Firebase
Storage (`firebasestorage.googleapis.com`) — `storageBucket` is configured
in `firebaseConfig` but `firebase/storage`/`getStorage()` is never imported
anywhere in `src/`, so no client-side Storage traffic exists to allow.
`accounts.google.com`/`www.gstatic.com/recaptcha` — `RecaptchaVerifier` is
imported in `App.jsx`/`config/firebase.js` but never instantiated (`new
RecaptchaVerifier(...)` has zero call sites); phone-based MFA is not wired
up (only TOTP, which needs no reCAPTCHA). **If phone MFA is completed
later, this CSP will need `frame-src`/`script-src` additions for
`www.google.com`/`www.gstatic.com` before it works** — flagged as a residual
risk below.

### 3. iOS ATS (`ios/App/App/Info.plist`)

Removed `NSAllowsArbitraryLoads` and `NSAllowsArbitraryLoadsInWebContent`.
No per-domain ATS exceptions were added because every host the app talks to
(the full `connect-src` inventory above) is HTTPS/WSS and none needed a TLS
downgrade or non-standard cert exception. `NSAllowsLocalNetworking` was
kept — it only permits requests to literal local/link-local addresses under
standard ATS TLS rules, and doesn't reintroduce arbitrary remote-host
access. `capacitor.config.ts`'s `server.cleartext`/`server.url` (the
Capacitor live-reload dev-server settings) are both commented out in the
committed config, so there was no cleartext dev-server exception to scope —
if a developer uncomments them locally for live reload, that's a local
Info.plist/build concern, not something this shipped config should carve an
exception for.

### 4. Inline boot/theme script → externalized

`index.html`'s inline `<script>` (sets `data-accent` and the `dark` class
on `<html>` from `localStorage`/`matchMedia`, before first paint, to avoid
a flash of the wrong theme) is now `public/boot-theme.js`, loaded via a
plain blocking `<script src="/boot-theme.js">` in the same position
(non-`async`/`defer`/`module`, so it still runs before `#root` — verified
by `src/utils/__tests__/verification.test.js` and
`src/utils/__tests__/darkMode.test.js`). **Chose externalization over a
`sha256-` CSP hash** because a hash is a maintenance trap: the moment
anyone edits this script without also recomputing and updating the hash in
`firebase.json`, the deployed app white-screens (CSP silently blocks the
now-mismatched inline script, and this file's only job is applying the
theme class before React mounts — a broken boot script looks like a
launch-time crash, not an obvious CSP violation, unless someone thinks to
check DevTools). Externalizing needs zero `firebase.json` changes ever
again for this script and keeps `script-src` at a flat `'self'`.

### 5. Release-validation script

`scripts/check-security-headers.mjs` — curls a deployed Hosting URL
(defaults to `https://echo-vault-app.web.app/`, accepts an override as
`argv[2]`) and asserts `Content-Security-Policy` (checks for key directive
fragments, not a byte-exact match, so it doesn't need editing every time
a host is added/removed), `Referrer-Policy`, `Permissions-Policy`,
`X-Content-Type-Options`, and `X-Frame-Options` are all present with
acceptable values. **Not wired into CI** — deliberately: it's only
meaningful against an already-deployed URL, which by definition CI has
already finished with, and there's no deployed-URL secret CI would need
that isn't just the public prod URL anyway. Run it by hand right after
`firebase deploy --only hosting`:

```bash
node scripts/check-security-headers.mjs
```

### Residual risk / what this doesn't prove

- **CSP correctness can't be fully proven pre-deploy.** Static analysis
  (grepping `src/` for hosts, tracing SDK surfaces to their known
  endpoints) is thorough but not equivalent to loading the deployed app in
  a real browser and watching the DevTools console for CSP violation
  reports. Run `scripts/check-security-headers.mjs` for header *presence*
  immediately post-deploy, then manually exercise: sign-in (Google + Apple
  popup), entry save/analyze, voice recording + relay connection, weather/
  environment context, PDF export (Session Prep + Therapist Export), push
  notification permission grant, and dark-mode toggle — the surfaces this
  CSP's `connect-src`/`frame-src`/`media-src` carve-outs were built for.
  Any DevTools "Refused to connect/load" error means a host was missed.
- **Phone-based MFA is unaccounted for.** `RecaptchaVerifier` exists in the
  codebase but is never instantiated; if phone MFA ships later, this CSP
  will need `script-src`/`frame-src` additions for reCAPTCHA
  (`www.google.com`, `www.gstatic.com`) before it works, and that will
  fail closed (broken MFA sign-in), not open.
- **`style-src 'unsafe-inline'` is a deliberate hedge, not a proven
  requirement.** First-party code doesn't need it (verified by CSSOM vs.
  attribute analysis above); it's kept because third-party UI dependencies
  (`@radix-ui/*`, `@xyflow/react`, `@dnd-kit/*`) weren't exhaustively
  verified in a live browser. Tightening it to drop `'unsafe-inline'` is a
  safe, low-priority follow-up once verified against real traffic — never
  worth blocking this rollout on.
- **The relay host is a literal string, not a config-driven value**, in
  both the CSP and this table. If `VITE_VOICE_RELAY_URL`/the Cloud Run
  service URL ever changes, `firebase.json`'s `connect-src` needs a manual
  update — there's no automated check tying the two together (the existing
  `scripts/check-bundle-endpoints.js` only guards against a *forbidden*
  (`ws://`/localhost) endpoint leaking into the bundle, not against the
  CSP drifting from whatever legitimate endpoint is configured).
- **Self-review**: the highest-risk directive here is `connect-src`,
  because an omitted host fails closed (a feature silently breaks) rather
  than open (a security hole) — the safer failure mode, but still a
  real regression risk for Michael's first post-deploy session. The
  `firebase.json` change was scoped to `**` (every route) rather than
  excluding `/boot-theme.js`/static assets, which is simpler and correct
  (headers apply per-response, not per-file-type, and none of the headers
  added are script/asset-type-specific).
