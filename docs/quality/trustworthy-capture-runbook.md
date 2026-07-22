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
- **Known, DELIBERATELY NOT fixed in this task (M4):**
  `src/services/nexus/layer1/threadManager.js`'s thread-dedup/thread-name
  embeddings are explicitly PINNED to v1 (plan task M2's documented
  decision — thread vectors are a separate v1-space store, migration was an
  explicit non-goal). Since v1 is now permanently dead, thread-similarity
  matching (`findSimilarThread`/`findEvolutionCandidates`) is **silently
  degraded** — it still calls the v1-only path, which now always fails, so
  thread dedup effectively stops matching. This is a pre-existing gap
  (inherited from M2's pin decision, not introduced by M4) that this task
  was explicitly scoped NOT to fix. Flagged here as an open follow-up:
  migrating thread embeddings to v2 (or degrading gracefully instead of
  silently) needs its own task.

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
