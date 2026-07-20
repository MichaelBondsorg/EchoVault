# Trustworthy Capture Sprint + Trustworthy Intelligence Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Engram entry becomes durable before optional work begins; no screen sleep, AI/network failure, or account switch can cause data loss, cross-user exposure, or silently degraded insights. Then lay the PRD R0 foundations (model hygiene + intent system).

**Architecture:** Server-authoritative consent read on every AI job; durable owner-scoped capture artifacts with a persisted operation state machine; core entry persisted before all optional enrichment (which moves to async post-save with capture-time provenance); a server-owned model registry replacing hardcoded/retired model strings; versioned derived data. Risky new paths ship behind default-off feature flags because pushes to main auto-deploy to prod.

**Tech Stack:** React 18 + Vite 5 (mixed JS/TS), Capacitor 8 (iOS Swift capture plugin), Firebase (Firestore + Cloud Functions Node 22 + Hosting), Cloud Run relay (TS), Vitest 3 (root) / 4 (relay).

**Source specs:** `Engram_Trustworthy_Capture_Sprint_Plan.docx` + `Engram_Trustworthy_Intelligence_PRD.docx` (both 2026-07-20; extracted texts in session scratchpad). Exploration reports (4 agents, commit f9fe637) are summarized in "Ground truth" below.

## Global Constraints

- Pushes to `main` auto-deploy: hosting always; functions/rules on `functions/**` or `firestore.rules` path changes; relay on `relay-server/**`. **Never push a batch that isn't fully green** (`npm test`, `npm run test:rules`, `npm run build`, plus `relay-server: npm test && npm run typecheck && npm run build` when touched).
- No optimization ships unless security, UX, capture durability, and downstream insight-parity tests pass (sprint release principle).
- Missing optional context stays `null` — never a synthetic zero/false/neutral value.
- Raw transcript / raw audio / capture timestamps are immutable; corrections are separate fields; derived data carries versions.
- No lower-quality model swaps; model changes only via the server registry behind flags with rollback.
- New pipeline behavior that changes capture flow ships behind feature flags (default off) until validated on hardware.
- Consent: no client-writable *entry* field may grant AI access; the single authoritative record is `artifacts/{APP}/users/{uid}/settings/consent` (owner-writable, shape-validated by rules; missing doc = legacy default-on for now, revoked = deny, read failure = deny for that job).
- All local caches/artifacts keyed by authenticated owner UID (ADR-0001).
- Operational logs: identifiers, lengths, timings, model versions, error codes — never journal text, transcripts, prompts, or audio.

## Ground truth (from exploration, commit f9fe637)

- `App.jsx:1665-1826` `handleAudioWrapper`: vault save before transcription exists but non-blocking (`audioVault.saveRecording` returns null, caller ignores). `doSaveEntry` (`:898`) awaits health (`:1033`), location (`:1052`), weather (`:1069`) then `addDoc` (`:1205`); `saveEntry` (`:1552`) awaits a 45s-timeout Gemini temporal call (`:1577`) pre-save. Post-save async IIFEs: signals `:1252`, nexus `:1281`, server classify/analyze/insight chain `:1298` → `updateDoc` `:1435` (client-owned promise chain — dies on suspension).
- `captureReducer.ts` full state machine exists but in-memory only; `stored→processing→saved` never dispatched; `CaptureService` recreated per recording (`EntryBar.jsx:93`).
- iOS: drafts persisted pre-record with sidecars (`CaptureDraftStore`), interruption → `needsReview`; audio crosses WebView as base64 (`CapturePlugin.swift:49,84`); no background URLSession.
- Web: MediaRecorder chunks RAM-only (`EntryBar.jsx:123`); no typed-draft autosave; web vault = localStorage 10MB cap.
- Consent: callables check auth+quota only (`functions/index.js:915,927` et al.); triggers trust `entry.aiProcessingConsent` (`:2229,2836`); `settings/consent` written by client (`App.jsx:273`) but read by no function. Revocation (`App.jsx:266-280`) = local flip + one setDoc; no outbox, no queued-job cancel. `firestore.rules:88` blocks only `settings/subscription` from client writes.
- Relay URL fallback `ws://localhost:8080/voice` in `useVoiceRelay.js:5` + `whoop.js:18`; CI hosting build omits `VITE_VOICE_RELAY_URL` (`firebase-hosting.yml:69-75,103-109`).
- WHOOP client cache global keys (`whoop_cached_summary`, `whoop.js:245`), not cleared on logout (`resetAllStores` only resets zustand). `embedding_cache` top-level collection cross-user with 100-char text preview (`functions/index.js:1039-1072`).
- Models in prod: `gemini-3-flash-preview` (classify/analyze), `text-embedding-004` (**past listed shutdown 2026-01-14**), `gemini-2.0-flash` digest (**shut down 2026-06-01**), `gemini-2.0-flash-exp` tone paths, `gemini-2.5-flash` fused transcription, relay `gpt-4o-realtime-preview-2024-12-17`/`gpt-4o`/`whisper-1`/`tts-1`. Verified live (2026-07-20): `gemini-3.5-flash` GA, `gemini-embedding-2` GA, `gpt-realtime-2.1` GA, `gpt-5.6-terra` limited preview.
- Idempotency: `onEntryAnalyzed` dedup'd; `onEntryCreate`/memory/burnout triggers not; watchdog `pendingEntryCleanup` no lease.
- Enrichment fabrications: `hasWorkout: || false` (`healthDataService.js:309,343`; `entryHealthEnrichment.js:126`), `isDay: ?? true` (`environmentService.js:218`). Strict `HealthObservation` schema in `src/domain/health/healthContext.ts` unused.
- Classification duplicated: native local rule-based pre-save + server Gemini post-save. `futureMentions` write-only (no consumer). Nexus derived data unversioned; edits don't recompute. No feature-flag system. Root typecheck not in CI; functions tests cherry-picked by explicit path list in `vitest.config.js:36-51` (3 test files run nowhere).
- No entry `timezone` field; no model/prompt version on analysis/insights.

## Execution model

Work directly on `main` (user's standing instruction). Group tasks into **push batches**; each batch ends with the full green gate + commit(s) + push. Implementer subagents are assigned by file-conflict boundary; `App.jsx` is the serialization hotspot — only one active agent may edit it at a time. iOS Swift changes compile-checked only via review (no Xcode here); anything needing device validation ships default-off and is listed in the final "Michael: device steps" report.

Batches:
- **Batch 1 (WS-A security, P0)** — Tasks A1–A5. Functions + rules + CI + client caches. Ship first.
- **Batch 2 (WS-D foundations needed by everything)** — Tasks D1–D2 (flags + stage telemetry). Small, unblocks flagged work.
- **Batch 3 (WS-C core-first save)** — Tasks C1–C4. App.jsx restructure + server orchestrator.
- **Batch 4 (WS-B durability)** — Tasks B1–B5. Operation store, vault hardening, web drafts, stale-draft review, native background upload (flagged).
- **Batch 5 (WS-D validation + docs)** — Tasks D3–D4. Validation-matrix tests, runbook.
- **Batch 6 (PRD 0A model hygiene)** — Tasks M1–M4. Registry, retired-model migrations, embedding v2.
- **Batch 7 (PRD 0B intent foundation)** — Tasks I1–I4. Taxonomy/schema/policy/evaluator + async extraction + widget cutover.
- **R1–R3 features get their own plan docs** once foundations land (see Roadmap at end).

---

### Task A1: Server-authoritative consent gate on every AI job

**Files:**
- Create: `functions/src/consent/consentGate.js`
- Create: `functions/src/consent/__tests__/consentGate.test.js`
- Modify: `functions/index.js` (callables `analyzeJournalEntry:907`, `generateEmbedding:1077`, `transcribeAudio:1110`, `executePrompt:1211`, `askJournalAI:1255`, `transcribeWithTone:1332`, `transcribeEntry:1504`; triggers `onEntryCreate:2193` AI paths, `pendingEntryCleanup:2270`, `onEntryCreateMemoryExtraction:2823`, `onEntryCreateBurnoutCheck:3395`, `generateWeeklyDigests:4237`)
- Modify: `firestore.rules:82-89` (shape-validate `settings/consent`)
- Modify: `functions/src/__tests__/firestoreRules.test.js` (consent doc shape cases)
- Modify: `vitest.config.js:36-51` (add new test file to include list — and while there, add the 3 orphaned functions test files)

**Interfaces:**
- Produces: `async assertAiConsent(db, uid, { entrySnapshot } = {}) -> { allowed: boolean, source: 'settings'|'legacy-default'|'entry-snapshot', checkedAt }`; throws `HttpsError('failed-precondition', 'ai-consent-revoked')` when denied. Policy: consent doc `{ aiProcessing: false }` → deny; `{ aiProcessing: true }` → allow; doc missing → legacy default-on UNLESS `entrySnapshot?.aiProcessingConsent === false`; **Firestore read error → deny (fail closed)**.
- Produces: `readConsent(db, uid)` used by A2's revocation callable.

- [ ] Write failing tests: consent doc false → throws; true → allows; missing doc + entry false → deny; missing doc + no entry → allow with `source:'legacy-default'`; simulated Firestore error → deny. Mock Firestore like existing `functions/src/**/__tests__` patterns.
- [ ] Implement `consentGate.js`. Read path: `artifacts/${APP_COLLECTION_ID}/users/${uid}/settings/consent` (import APP_COLLECTION_ID from `functions/src/shared/constants.js`).
- [ ] Wire into every listed callable immediately after auth check, and into every AI trigger/scheduled job before provider calls (watchdog: per-entry check; digest: per-user check). Triggers pass `entrySnapshot` for legacy fallback.
- [ ] Rules: `settings/consent` write requires `request.resource.data.aiProcessing is bool` and only keys in `['aiProcessing','grantedAt','revokedAt','updatedAt','policyVersion']`. Add rules tests (owner can write valid shape, cannot write junk keys/types, cross-user denied).
- [ ] Run root tests + rules tests. Commit `security: server-authoritative AI consent gate on all AI jobs`.

### Task A2: Fail-closed consent revocation

**Files:**
- Create: `src/services/consent/consentService.js`, `src/services/consent/__tests__/consentService.test.js`
- Create: `functions` callable `revokeAiProcessing` in `functions/index.js` (+ test in `functions/src/consent/__tests__/`)
- Modify: `src/App.jsx:222-280` (grant/revoke handlers delegate to consentService)

**Interfaces:**
- Produces (client): `grantAiConsent(uid)`, `revokeAiConsent(uid)` — revoke order: (1) set localStorage declined marker + in-memory state OFF synchronously; (2) append `{type:'consent-revoke', uid, at}` to an owner-scoped Preferences outbox; (3) flush outbox → calls `revokeAiProcessing` callable; retry with backoff on launch/online/foreground until acked, marker survives app restarts. A failed settings write can never leave AI enabled locally.
- Produces (server): `revokeAiProcessing` callable — writes consent doc `{aiProcessing:false, revokedAt: serverTimestamp}`, then cancels queued work: query owner entries `analysisStatus == 'pending'` → batch update to `analysisStatus:'disabled'`. Returns `{cancelled: n}`. (Transient cloud audio: none exists server-side today — noted in runbook; B5 adds retention for its new upload bucket.)

- [ ] TDD client service (mock Preferences + callable): revoke flips local first even when callable rejects; outbox drains on retry; grant clears marker and writes consent doc via callable or direct setDoc.
- [ ] TDD server callable (mock firestore): writes doc, disables pending entries, consent gate honors it.
- [ ] Rewire App.jsx handlers; keep existing UI (PrivacyCenter/AiConsentModal) contracts.
- [ ] Full green gate. Commit `security: fail-closed AI consent revocation with retryable outbox and queued-job cancel`.

### Task A3: Production relay endpoint validation

**Files:**
- Create: `scripts/check-bundle-endpoints.js`
- Modify: `src/hooks/useVoiceRelay.js:5`, `src/services/health/whoop.js:18` → shared `src/config/relay.js` (create)
- Modify: `.github/workflows/firebase-hosting.yml` (add `VITE_VOICE_RELAY_URL` secret to both build steps + postbuild check step)
- Modify: `package.json` scripts: `"build": "vite build && node scripts/check-bundle-endpoints.js"`
- Test: `src/config/__tests__/relay.test.js`

**Interfaces:**
- Produces: `getRelayWsUrl()` — returns `import.meta.env.VITE_VOICE_RELAY_URL`; in `import.meta.env.PROD` with missing/`ws://`/localhost value → returns `null` (voice features disable gracefully, log via existing patterns); DEV keeps `ws://localhost:8080/voice` fallback. `getRelayHttpUrl()` derives https from wss.
- Produces: `check-bundle-endpoints.js` — scans `dist/**/*.js` for `ws://` or `localhost:8080`; exits 1 with file list if found. Runs in every build (local + CI).

- [ ] TDD relay.js (vitest env stubs). Update both consumers; `useVoiceRelay` and whoop handle `null` (feature-off state, no throw).
- [ ] Add CI env + `Verify production bundle endpoints` step after build in both hosting jobs. NOTE for Michael in final report: add `VITE_VOICE_RELAY_URL` GitHub secret before next push lands — plan includes it in the same batch so CI must have it. (If secret can't be added from here via `gh secret set`, try `gh secret set VITE_VOICE_RELAY_URL` with the value from `.env` — it is a URL, not a credential.)
- [ ] Green gate incl. a local `npm run build` proving the check passes. Commit `security: fail CI when production bundle contains localhost/ws relay endpoints`.

### Task A4: Owner-scoped WHOOP cache + logout cache clearing

**Files:**
- Modify: `src/services/health/whoop.js` (keys → `whoop_cached_summary::${uid}`, `whoop_link_status::${uid}`; all read/write/remove take uid; migration: delete legacy global keys on first read)
- Create: `src/services/storage/clearOwnerCaches.js` — clears owner-scoped Preferences keys + legacy globals on logout/account-switch; called from `App.jsx:2579-2585` logout alongside `resetAllStores()`
- Test: extend `src/services/health/__tests__/whoop.contract.test.js` + new `clearOwnerCaches.test.js` with a two-account fixture: user A writes cache, logout, user B reads → null.

- [ ] TDD; wire; green gate. Commit `security: owner-scope WHOOP caches and clear caches on logout`.

### Task A5: Owner-scope embedding cache + idempotent triggers

**Files:**
- Modify: `functions/index.js:1039-1072` — `embedding_cache` key becomes `sha256(uid + ':' + text)[:24]`, drop the `preview` field entirely; doc gains `{ownerUid, embeddingModel, createdAt}`.
- Modify: `functions/index.js` triggers: memory extraction + burnout check get dedup guards (write `processing.memoryExtractedAt` / `processing.burnoutCheckedAt` marker on the entry via transaction check-and-set before running; skip when present). Watchdog `pendingEntryCleanup` gets a lease: transaction sets `analysisLease = {at, by}` if absent/expired(>5min) before processing an entry.
- Test: `functions/src/__tests__/triggerIdempotency.test.js` (new; add to vitest include).

- [ ] TDD guards with mocked firestore transactions; green gate. Commit `reliability: idempotent AI triggers, leased watchdog, owner-scoped embedding cache`.

**Batch 1 gate:** root tests + rules + build + push. Acceptance: no client-writable entry field grants AI access; revocation fail-closed & cancels queued work; CI rejects localhost bundles; two-account fixtures show zero cache leakage.

---

### Task D1: Feature flag service (client + functions)

**Files:**
- Create: `src/config/flags.js` + `src/config/__tests__/flags.test.js`
- Create: `functions/src/shared/flags.js` + test
- Modify: `firestore.rules` — add read-only (client) `config/flags` top-level doc rule; writes admin-only.

**Interfaces:**
- Produces (client): `getFlag(name, defaultValue)` — reads compiled defaults from `FLAG_DEFAULTS` map, overridden by Firestore doc `config/flags` (one `getDoc` cached per session with `onSnapshot` optional later), overridden by `localStorage['engram:flag:'+name]` for dev. Sync accessor after `initFlags()` preload.
- Produces (server): `await getServerFlag(db, name, defaultValue)` reading same doc (60s in-memory cache).
- Flags introduced by this plan (all default **false** unless noted): `serverAnalysisOrchestrator`, `coreFirstSave` (default **true** once C1 tests pass — it is a bugfix-class change), `nativeBackgroundUpload`, `webChunkPersistence` (default true — additive), `model.gemini35flash`, `model.embeddingV2Read`, `model.fusedTranscription35`, `intentExtraction`.

- [ ] TDD both; rules test for `config/flags` (client read yes, write no); green gate. Commit `infra: feature flag service backed by config/flags`.

### Task D2: Stage telemetry (non-content)

**Files:**
- Create: `src/services/telemetry/captureTelemetry.js` + test
- Create: `functions/src/telemetry/stageLog.js` + test
- Modify: call sites added in later tasks (C1/C2/B2/B5 wire stages as they build).

**Interfaces:**
- Produces (client): `recordStage(operationId, stage, meta={})` — appends `{opId, stage, at, platform, ...meta}` (NO content fields; meta whitelist: durations, byte sizes, engine, retryCount, errorCode) to an owner-scoped ring buffer (last 200, Preferences) and `console.info('[capture-stage]', ...)`. `getRecentStages()` powers CaptureReliabilityCenter debugging.
- Produces (server): `logStage(operationId, stage, meta)` → single structured `console.log(JSON.stringify({type:'stage', opId, stage, ...meta}))` for Cloud Logging dashboards. Stages: `local_ready, uploading, uploaded, transcribe_start, transcribe_end, entry_saved, enrich_start, enrich_end, analysis_start, analysis_end, needs_attention, retry, cold_start`.

- [ ] TDD (whitelist strips unknown keys — test that a `text` key is dropped); green gate. Commit `observability: stage telemetry for capture pipeline (non-content)`.

**Batch 2 gate:** green + push (small batch, safe).

---

### Task C1: Core-first save — persist entry before all optional enrichment

**Files:**
- Modify: `src/App.jsx` `doSaveEntry:898-1250` and `saveEntry:1552-1620`
- Create: `src/services/entries/enrichmentRunner.js` + `__tests__/enrichmentRunner.test.js`
- Modify: `src/services/health/healthDataService.js:309,343` and `src/services/environment/environmentService.js:218` (null-not-fabricated: `hasWorkout: ... ?? null`, `isDay: ... ?? null`; audit consumers render null safely)
- Test: `src/services/entries/__tests__/coreFirstSave.test.js` (extract the pure entry-data builder to make it testable: create `src/services/entries/buildCoreEntry.js`)

**Interfaces:**
- Produces: `buildCoreEntry({text, category, user, transcription, consentSnapshot, captureContext, safety})` → the exact `entryData` object persisted first: text, category, `analysisStatus`, `aiProcessingConsent`, `userId`, `createdAt`, `effectiveDate`, **`capturedAt` (ISO), `captureTimezone` (IANA via `Intl.DateTimeFormat().resolvedOptions().timeZone`)**, `createdOnPlatform`, `transcription{rawTranscript, cleanedTranscript, schemaVersion, correctedByUser:false}`, `signalExtractionVersion`, `entryInputVersion: 1`, `enrichment: {status:'pending', requestedAt}`, safety fields, `operationId` when present. NO health/location/environment/temporal/localAnalysis blocking fields.
- Produces: `runPostSaveEnrichment({entryRef, entryData, services})` — fire-and-forget after `addDoc`; gathers health/location/weather **against `capturedAt` + capture-time coarse location snapshot** (location captured at handoff BEFORE save via cached/point-in-time `getCurrentLocation({timeoutMs: 2000, cached: true})` — if not resolved in 2s, save proceeds and enrichment retries fresh but derives weather vs `capturedAt`); single `updateDoc` per completed enrichment group with `enrichment.status:'complete'|'partial'` + per-field `null` + reason when unavailable; each write stamps `enrichedAt`, `enrichmentVersion: 1`.
- Behavior flag: `coreFirstSave` — when false, legacy ordering. Wrapper picks path at `doSaveEntry` top.

- [ ] TDD `buildCoreEntry` (includes: timezone present; no enrichment fields; consent snapshot honored; missing optional stays absent not fabricated).
- [ ] TDD `enrichmentRunner` with mocked services: entry write happens before any enrichment resolves (assert call order); failed health leaves `healthContext: null` + `enrichment.reasons.health = errorCode`; weather derived with `capturedAt` argument.
- [ ] Restructure `doSaveEntry` online path: capture context snapshot → `buildCoreEntry` → `addDoc` → dismiss UI/reset state → `runPostSaveEnrichment`. Offline path already queues; give queued entries the same core shape.
- [ ] Move `performLocalAnalysis` (native) into post-save enrichment (it feeds provisional title/type via updateDoc; no longer blocks).
- [ ] Fix `hasWorkout`/`isDay` fabrications + adjust any UI reading them (`?? null` renders as absent).
- [ ] Green gate. Commit `capture: persist core entry before optional enrichment (flag: coreFirstSave)`.

### Task C2: Temporal detection moves post-save; preserve futureMentions contract

**Files:**
- Modify: `src/App.jsx:1552-1620` (`saveEntry` drops the blocking `detectTemporalContext` await)
- Modify: `src/services/entries/enrichmentRunner.js` (temporal added as enrichment step; on result, `updateDoc` `temporalContext` + `futureMentions` exactly as today's field shapes — consumers migrate in PRD 0B)
- Test: extend `enrichmentRunner.test.js`

- [ ] TDD: save resolves with no temporal service called yet; temporal failure → fields absent, no fabrication, entry intact.
- [ ] Green gate. Commit `capture: temporal/future-mention extraction runs after durable save`.

### Task C3: Server analysis orchestrator (single classification authority)

**Files:**
- Create: `functions/src/analysis/orchestrator.js` + `__tests__/orchestrator.test.js`
- Modify: `functions/index.js` — new `onDocumentCreated` trigger `onEntryCreatedAnalysis` (guard: flag `serverAnalysisOrchestrator` + consent gate + dedup marker `processing.analysisStartedAt` transaction check-and-set + `entryInputVersion` capture)
- Modify: `src/App.jsx:1298-1470` — when flag on, client skips its classify/analyze/insight IIFE chain entirely (UI listens to entry doc snapshots for `analysisStatus` transitions, which `EntryInsightsPopup` flow already tolerates via pending states); when off, legacy chain.
- Test: orchestration unit tests with mocked model calls.

**Interfaces:**
- Produces (server): `runEntryAnalysis({db, entryRef, entry, apiKeys})` — sequence: classify once → parallel [analyze, generateInsight, extractEnhancedContext, signals] → single final `updateDoc` including `analysisStatus:'complete'`, `analysis`, `entry_type`, `extracted_tasks`, `contextualInsight`, plus **provenance `analysisMeta: {modelId, promptVersion: 1, orchestratorVersion: 1, inputVersion, completedAt}`**; before publishing, transaction re-reads `entryInputVersion` — stale (entry edited during analysis) → discard + re-enqueue once. Stage telemetry via `logStage`.
- Client keeps rule-based `performLocalAnalysis` only as provisional native display (never overwrites server results; server updateDoc wins).

- [ ] TDD orchestrator: classify called exactly once; stale-version discard; failure path marks `analysisStatus:'failed'` + no fabricated mood; consent-revoked-mid-flight → abort before provider call (gate re-check between stages).
- [ ] Green gate. Commit `analysis: server-owned single-pass analysis orchestrator (flag: serverAnalysisOrchestrator)`.

### Task C4: Versioned derived data + correction invalidation

**Files:**
- Modify: `src/App.jsx:791-830` `handleEntryUpdate` — meaningful text edit: bump `entryInputVersion` (exists as of C1), set `analysisStatus:'pending'`, `enrichment.status:'stale'` → server orchestrator re-runs (trigger `onEntryUpdate` extension in `functions/index.js:2458`: when `entryInputVersion` increased and flag on → re-run analysis with dedup marker keyed by version).
- Modify: `functions/index.js` nexus-adjacent writes: derived docs written by functions gain `{derivedFromInputVersion, derivationVersion}` fields where they're created (threads/patterns additions minimal: stamp only, full recompute semantics deferred to Insight Control Center in R2 — note in roadmap).
- Test: `functions/src/analysis/__tests__/correctionInvalidation.test.js`.

- [ ] TDD: edit → exactly one recomputation at new version; old-version publish blocked; raw `transcription.rawTranscript` never modified by the re-run.
- [ ] Green gate. Commit `analysis: user corrections invalidate and idempotently recompute derived analysis`.

**Batch 3 gate:** full green + push. Acceptance: regression corpus fixtures show identical entry fields available to consumers (tests assert field-shape parity between legacy and coreFirstSave paths); entry dismissal no longer awaits enrichment; missing context stays null.

---

### Task B1: Vault failure blocks transcription; draft survives until durable handoff

**Files:**
- Modify: `src/App.jsx:1695-1720` (`handleAudioWrapper`): `recordingId == null` → do NOT transcribe; record stage `needs_attention`; keep native draft (skip the draft-delete at `:1704-1708`); surface existing PendingAudioBanner retry path with a new "couldn't secure a local copy" message; web fallback: attempt one immediate IndexedDB retry (B3 store) before giving up.
- Modify: `src/services/audio/audioVault.js` — `saveRecording` returns `{id} | {error: code}` (keep null-compat shim for other callers) so caller can distinguish quota vs io failure.
- Test: extend `src/services/audio/__tests__/audioVault.test.js` + new `src/__tests__/handleAudioDurability.test.jsx`-style unit around an extracted `prepareDurableRecording()` helper (extract from App.jsx for testability: `src/services/capture/prepareDurableRecording.js`).

- [ ] TDD helper: vault failure → `{blocked: true}` and native draft NOT deleted; success → draft deleted only after vault confirm.
- [ ] Green gate. Commit `capture: audio-vault failure blocks transcription; native draft kept until durable handoff`.

### Task B2: Persistent operation state machine

**Files:**
- Create: `src/services/capture/operationStore.ts` + `__tests__/operationStore.test.ts`
- Modify: `src/services/capture/prepareDurableRecording.js` + `src/App.jsx` `handleAudioWrapper` — create op at `local_ready` (opId = crypto.randomUUID()), advance `uploading → transcribing → entry_saved → enriching → complete | needs_attention`; op record persisted owner-scoped in Preferences `capture_ops::${uid}`; entry doc gets `operationId`; transcription callable payload gains `operationId` (server logs it; C3 orchestrator stamps it).
- Modify: launch recovery `src/App.jsx:411-421` — `resumeIncompleteOperations()`: ops stuck pre-`entry_saved` with vault audio → re-run pipeline with `existingRecordingId` + same opId; before creating an entry, query `entries where operationId == opId` → if exists, skip create (idempotent duplicate-delivery guard); ops stuck post-`entry_saved` → re-kick enrichment.
- Test: duplicate-delivery test — resume with an entry already carrying the opId creates no second entry.

**Interfaces:**
- Produces: `createOperation(uid, {recordingId}) -> op`, `advance(uid, opId, stage, meta?)`, `listIncomplete(uid)`, `completeOperation(uid, opId)`, `markNeedsAttention(uid, opId, errorCode)`. Records: `{opId, ownerUid, stage, recordingId, entryId?, createdAt, updatedAt, attempts, lastError?}` (no content).
- Consumes: `captureReducer` stage names aligned (map reducer's `stored/processing/saved` events onto op advances so the existing reducer finally drives real state).

- [ ] TDD store (persistence round-trip, owner scoping, attempts cap 5 → needs_attention).
- [ ] Wire pipeline + launch resume; stage telemetry at each advance.
- [ ] Green gate. Commit `capture: persistent operation state machine with idempotent launch resume`.

### Task B3: Web durability — IndexedDB chunk persistence + vault backend + typed-draft autosave

**Files:**
- Create: `src/services/capture/webChunkStore.js` (IndexedDB via raw API, no new dep; db `engram-capture`, store `chunks` keyed `[owner, recordingDraftId, seq]`) + tests (fake-indexeddb? No new deps — use a minimal in-memory IDB stub in `src/test/mocks/` consistent with existing mock patterns)
- Modify: `src/components/dashboard/EntryBar.jsx:116-220` — `ondataavailable` writes each chunk to webChunkStore (flag `webChunkPersistence`); `onstop` assembles from store; launch recovery adopts orphaned chunk sets into audioVault as orphans then clears chunks.
- Modify: `src/services/audio/audioVault.js` web backend: blobs > localStorage threshold go to IndexedDB store `vault` (same db), index stays in localStorage; raises web cap beyond 10MB.
- Modify: `EntryBar.jsx:23` typed-draft autosave: debounced 500ms write to `entry_draft::${uid}` (Preferences), restore on mount, clear on successful save; same for `QuickLogModal` note field.
- Tests for chunk recovery + draft restore.

- [ ] TDD store + recovery adoption + autosave restore; green gate. Commit `capture: incremental web recording persistence and typed-draft autosave`.

### Task B4: Stale native draft recovery → needsReview surfaced without auto-submit

**Files:**
- Modify: `src/services/capture/nativeCaptureAdapter.ts:13-31` — stale `recording`-status drafts (non-empty, older than 30s, no active session) convert to `needsReview` (call plugin `updateDraftStatus` — add method to `CapturePlugin.swift` + `CaptureDraftStore.swift`), derive duration from file where sidecar lacks it (`AVURLAsset` duration in plugin `readDraft`).
- Modify: `src/components/capture/CaptureReliabilityCenter.jsx` — needsReview section: play-context (duration, date), actions Transcribe / Discard; never auto-submits.
- Modify: `ios/App/App/Capture/CaptureDraftStore.swift`, `CapturePlugin.swift` (new `updateDraftStatus`, duration derivation).
- Tests: adapter unit test with mocked plugin.

- [ ] TDD adapter conversion logic; implement Swift additions (compile-reviewed; device test listed for Michael); green gate. Commit `capture: stale native recordings recovered to needsReview without auto-submit`.

### Task B5: Native background binary upload vertical slice (flag: nativeBackgroundUpload, default OFF)

**Files:**
- Create: `functions/index.js` callable `issueCaptureUploadTicket` — auth + consent gate → returns V4 signed PUT URL to `gs://<default-bucket>/capture-uploads/{uid}/{opId}.m4a` (15-min expiry, content-type bound) + storage object path. Requires `firebase-admin` storage (already available).
- Create: `functions/src/capture/onAudioUploaded.js` — Cloud Storage `onObjectFinalized` for `capture-uploads/**`: parse uid/opId from path, verify ownership metadata, consent gate, fused transcription from GCS bytes, **create core entry server-side idempotently** (same `operationId` query guard as B2), delete raw object on transcript success; scheduled `captureUploadsRetention` deletes objects >24h.
- Create: `ios/App/App/Capture/BackgroundUploader.swift` — `URLSession(configuration: .background(withIdentifier: "engram.capture.upload"))`, upload task from draft file to signed URL, completion handler in `AppDelegate.swift` (`handleEventsForBackgroundURLSession`), reports status through `CapturePlugin` events.
- Modify: `src/services/capture/prepareDurableRecording.js` + pipeline: when flag on + native: request ticket at `local_ready`, hand file path + URL to `BackgroundUploader`, op advances via plugin events (`uploading → uploaded`), server owns the rest; UI shows "uploaded and processing" truthful state from op record + entry snapshot listener.
- Tests: functions unit tests (ticket auth/consent/path shape; onAudioUploaded idempotency + deletion), adapter tests for event handling. Swift compile-reviewed only.

- [ ] TDD functions pieces; implement Swift; wire flag-gated client path; green gate (flag off in prod). Commit `capture: native background upload + server-owned transcription commit (flag off)`.

**Batch 4 gate:** full green + push. Acceptance: at every destructive boundary either previous or next durable copy exists (tests assert draft/vault/op invariants); duplicate delivery produces one entry.

---

### Task D3: Validation matrix automated tests

**Files:**
- Create: `src/__tests__/validationMatrix.test.js` (or split per area) covering the automatable rows: consent revoked while queued (A2), account switch cache isolation (A4), health/location/weather unavailable → nulls (C1), duplicate trigger/retry → one entry (B2/C3), user edits transcript → raw immutable + recompute (C4), network loss during upload → vault intact + resume without re-record (B2 resume path with mocked failures).
- Create: `docs/quality/device-validation-matrix.md` — the physical-device rows (auto-lock while recording, manual lock after stop, background during transcription, force-quit recovery) as a checklist for Michael with expected outcomes from the sprint spec.

- [ ] Write tests against the real modules (mocked platform boundaries); all pass; commit `qa: automated validation matrix for capture trust invariants`.

### Task D4: Rollout runbook + docs

**Files:**
- Create: `docs/quality/trustworthy-capture-runbook.md` — flags and their rollback (each flag → what turning it off restores), stage-telemetry queries for Cloud Logging, raw-audio retention policy (B5 bucket 24h + delete-on-success), incident ownership, "rollback never deletes durable assets / never re-enables revoked consent" checklist.
- Modify: `CLAUDE.md` — brief pointers to flags + runbook.

- [ ] Write; commit `docs: trustworthy capture rollout runbook`. **Batch 5 gate:** green + push.

---

### Task M1: Server-owned model registry

**Files:**
- Create: `functions/src/models/registry.js` + `__tests__/registry.test.js`
- Modify: `functions/index.js:67-71`, `functions/src/shared/constants.js:15-19`, `functions/src/shared/gemini.js:16,48`, `functions/src/shared/openai.js:76,118`, `functions/src/transcription/fusedTranscription.js:9`, `functions/index.js:1010,1154,1377,1441,4412` — all model strings resolve through `getModel(workload)`.
- Modify: `relay-server/src/config/index.ts:27-37` — models overridable via env vars with current values as defaults (relay has no Firestore registry; env-based).
- Modify: `src/config/ai.js` — remove client model registry entries; client sends workload names only (verify browser helper `src/services/ai/gemini.js:1-53` already ignores model args — keep signature, drop dead config).

**Interfaces:**
- Produces: `getModel(workload)` for workloads: `classify, analyze, chat, chatFallback, embedding, embeddingV2, transcriptionFallback, fusedTranscription, tone, digest, temporal, entityResolution, insight`. Values come from `FLAG-able` overrides in `config/flags` doc (`model.*` keys) with hardcoded current-production defaults — so a bad model flips back by editing one Firestore doc, no deploy.
- Every provider call site records `modelId` into its output provenance where a provenance field exists (C3's `analysisMeta`, embeddings' `embeddingModel`).

- [ ] TDD registry (default resolution, flag override, unknown workload throws); replace call sites; green gate. Commit `models: server-owned model registry for all AI workloads`.

### Task M2: Retire dead models (P0 — currently broken paths)

**Files/changes (via registry defaults):**
- `digest`: `gemini-2.0-flash` → `gemini-3.5-flash` (path likely dead since 2026-06-01).
- `tone` (legacy transcribeWithTone + relay tone): `gemini-2.0-flash-exp` → `gemini-3.5-flash`; verify request shape compatible (responseMimeType JSON supported).
- `temporal`: → `gemini-3.5-flash`.
- `classify`/`analyze`: `gemini-3-flash-preview` → default stays preview, flag `model.gemini35flash` flips to `gemini-3.5-flash`; enable flag in prod doc after batch validates (registry makes this a data change).
- Relay realtime: `gpt-4o-realtime-preview-2024-12-17` → `gpt-realtime-2.1` via env default (deprecated preview; test relay suite; interruption behavior noted for Michael's manual voice test).
- Relay chat `gpt-4o`: keep (deprecated-but-working); add env override hook; `gpt-5.6-terra` NOT adopted (limited preview) — logged in roadmap.
- Fused transcription: stays `gemini-2.5-flash` default; `model.fusedTranscription35` flag ready for shadow test (shutdown 2026-10-16 noted in runbook).

- [ ] Update defaults + tests asserting no retired model string (`gemini-2.0-flash`, `gemini-2.0-flash-exp`, `text-embedding-004` after M3) remains in functions/relay source; green gate incl. relay suite. Commit `models: retire shut-down Gemini 2.0 paths; realtime → gpt-realtime-2.1`.

### Task M3: Embedding migration → gemini-embedding-2 (versioned dual field + backfill)

**Files:**
- Modify: `functions/index.js:997-1072` `generateEmbeddingInternal` — new embeddings write `{embeddingV2: vector, embeddingMeta: {model: 'gemini-embedding-2', dim, taskType, createdAt}}` alongside legacy `embedding` field left untouched; cache docs carry model id (already from A5).
- Create: `scripts/backfill-embeddings-v2.js` (batched, resumable via checkpoint doc, consent-gated per user, rate-limited) — run manually/documented, not in CI.
- Modify: retrieval read sites (grep `\.embedding` consumers in functions RAG/askJournal paths) — read `embeddingV2` when flag `model.embeddingV2Read` on AND doc has it, else legacy; **never mix vector spaces in one similarity computation** — comparison set filtered to the same field/version as the query vector.
- Test: `functions/src/__tests__/embeddingMigration.test.js` — same-space guarantee (query with v2 never scored against v1 vectors), meta stamping.

- [ ] TDD; implement; document cutover steps (backfill → verify counts → flip read flag → later remove v1) in runbook; green gate. Commit `models: gemini-embedding-2 dual-index migration with same-space retrieval guard`.

### Task M4: CI hardening for the new surface

**Files:**
- Modify: `vitest.config.js` — replace cherry-picked functions test list with glob `functions/src/**/__tests__/**/*.test.js` minus the emulator-bound rules test (explicit exclude), so new functions tests can't silently not run.
- Modify: `.github/workflows/firebase-hosting.yml` + `deploy-functions.yml` — add `npm run typecheck` (root) step.
- Fix whatever typecheck surfaces in the TS islands (they were written recently; expected small).

- [ ] Green gate incl. typecheck; commit `ci: glob functions tests, gate root typecheck`. **Batch 6 gate:** green + push.

---

### Task I1: Intent schema + shared objects (PRD 0B)

**Files:**
- Create: `functions/src/intents/intentSchema.js` (+ test) — validators/constructors for the Intent object: `{id, ownerId, entryId, kind: task|open_loop|event|goal_habit|reflection|external_action|conditional|completed, state: active|suggested|abstain|dismissed, sourceSpan:{start,end,text}, attributes:{agency, concrete, unfinished, temporalFit, negated, quoted, conditional, goalLanguage}, confidence, activationReason, targetAt|null, authorization:{notifications:false}, versions:{extraction:1, model, prompt:1, schema:1}, createdAt}`; stored at `artifacts/{APP}/users/{uid}/intents/{id}`.
- Modify: `firestore.rules` — `intents` owner read/update-state-only (client may change `state` to `dismissed`/`active-from-suggested` + user-decision fields; cannot create/forge extraction fields — validate immutable keys unchanged), plus `user_decisions` collection owner-writable append.
- Test: rules tests for both collections.

- [ ] TDD schema validators + rules; green gate. Commit `intents: shared intent schema, storage, and rules`.

### Task I2: Activation policy engine (pure, server-side)

**Files:**
- Create: `functions/src/intents/activationPolicy.js` + `__tests__/activationPolicy.test.js`

**Interfaces:**
- Produces: `decideActivation(candidate) -> {state: 'active'|'suggested'|'abstain', reason}` — pure function; ACTIVE requires ALL validated attributes: user agency + concrete action/explicit follow-up + unfinished + temporal fit + none of {negation, quotation, conditionality, recurring-goal language, other-owned, completed}; explicit command/list-item formatting qualifies; **model confidence alone never activates** (assert: candidate with confidence 0.99 but agency=false → abstain/suggested). SUGGESTED for plausible-but-ambiguous; ABSTAIN otherwise.
- The PRD's 10 hard-negative cases are the core test fixtures (emotional need, ongoing aspiration, quoted speech, other's obligation, conditional, completed, narrative "I need to say this", future fact w/o follow-up, recurring event, negation/sarcasm artifacts) — every one must NOT be active.

- [ ] TDD with all hard negatives + positive cases ("call the dentist tomorrow" explicit → active; "Ask me Friday how the interview went" → active open_loop with targetAt). Commit `intents: activation policy engine — confidence alone never activates`.

### Task I3: Async server extraction + evaluation harness

**Files:**
- Create: `functions/src/intents/extractIntents.js` (+ test) — Gemini structured-output call (registry workload `intentExtraction` → `gemini-3.5-flash`, strict JSON schema with explicit `abstain` + evidence spans), invoked from C3 orchestrator when flag `intentExtraction` on; writes versioned Intent docs via I1 constructors + I2 policy; idempotent per (entryId, extraction version).
- Create: `functions/src/intents/__evals__/` — labeled fixture set: seed 60 examples now (all 10 hard-negative categories × voice/text variants + positives), `runEval.js` script reporting Active-precision/recall per state; wired as a vitest test asserting **zero hard-negative activations** (the 97%-precision gate on 500 examples is a growth target documented in the eval README — labeling more examples is human work).
- Modify: legacy compat — orchestrator keeps writing `extracted_tasks` (derived: active task intents only) so nothing breaks; `futureMentions` continue via C2 until R1 migrates consumers.

- [ ] TDD extraction normalization (mock model), policy integration, idempotency; eval suite green; green gate. Commit `intents: async server intent extraction with hard-negative eval suite (flag: intentExtraction)`.

### Task I4: TasksWidget reads active intents only

**Files:**
- Modify: `src/components/zen/widgets/TasksWidget.jsx` — when flag on: subscribe to `intents` where `kind=='task' && state=='active'`, render with Undo/"Not a task" (writes `state:'dismissed'` + `user_decisions` append); completed toggle updates intent state. When flag off: legacy `extracted_tasks` path.
- Create: `src/services/intents/intentClient.js` (+ test) — typed reads/updates used by widget.
- Test: widget test with both flag states.

- [ ] TDD; green gate. Commit `intents: TasksWidget reads policy-qualified active intents (flagged)`. **Batch 7 gate:** green + push.

---

## Self-review notes (spec coverage)

- Sprint WS-A → A1–A5. WS-B → B1–B5. WS-C → C1–C4. WS-D → D1–D4. Insight-integrity contract: immutable source layer (C1/C4), explicit missingness (C1), temporal accuracy (C1 capturedAt/timezone/enrichedAt), readiness gating (enrichment.status; correlation consumers = R2 scope), idempotent counts (A5/B2/C3), consent lineage (consent snapshot + analysisMeta), correction loop (C4).
- Sprint stretch items (verbose_json→json, wake-lock repair, duplicate location elimination) deliberately deferred — gates first, per plan §7.
- PRD 0A → M1–M4 (registry, retirements, embedding v2, CI). Realtime migrated; terra/whisper-challenger deferred pending benchmarks per PRD. PRD 0B → I1–I4.
- PRD R1 (Open Loops UX, Context Spaces, Insight Budget), R2 (Control Center receipts/recompute, Voice Chapters, Recipes, Gentle Revisit, Session Prep), R3 (Experiments): follow-on plan docs after Batch 7 — they depend on intents (I1-4), receipts groundwork (C3 provenance), and embedding v2 (M3).

## Roadmap after this plan

1. `2026-07-xx-r1-follow-through.md` — Open Loops (extends intent schema `open_loop` lifecycle + in-app due surface, max 3, no notification without explicit authorization event), Context Spaces v1 (server-enforced scope field + retrieval filters + embedding-index compat from M3), Insight Budget.
2. `2026-07-xx-r2-trust-surfaces.md` — Insight Receipts (extends `analysisMeta` to full source-ref receipts), Control Center, dependency-aware recompute (extends C4 stamps), Voice Chapters (marker timestamps in CaptureDraftStore sidecars — groundwork exists), Recipes, Gentle Revisit, Session Prep.
3. `2026-07-xx-r3-personal-experiments.md` — after data-method review questions (PRD open questions) are answered by Michael.

## Human (Michael) checklist — accumulate during execution, report at end

- Add GitHub secret `VITE_VOICE_RELAY_URL` (value in local `.env`).
- Device matrix: `docs/quality/device-validation-matrix.md` (auto-lock/manual-lock/background/force-quit on physical iPhone).
- Xcode: add new Swift files (BackgroundUploader) to target; build & TestFlight.
- Flip flags in `config/flags` Firestore doc when validated: `coreFirstSave` (on by default already), `serverAnalysisOrchestrator`, `intentExtraction`, `model.gemini35flash`, then `nativeBackgroundUpload` after device test.
- Run `scripts/backfill-embeddings-v2.js`, then flip `model.embeddingV2Read`.
- Manual voice-relay session test after `gpt-realtime-2.1` deploy (interruption handling).
- PRD open questions that block R1+ design choices (task auto-activation onboarding default; Space default for new capture).
