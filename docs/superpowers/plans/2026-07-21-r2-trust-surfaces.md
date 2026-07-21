# R2 Trust Surfaces Implementation Plan — Receipts, Control Center, Voice Chapters, Recipes, Session Prep, Gentle Revisit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PRD R2 — "Reflect with Control": every visible insight and report claim is inspectable and correctable (Insight Receipts, Control Center, dependency-aware recompute), plus the reflection workflows (Voice Chapters, Custom Reflection Recipes, Session Prep, Gentle Revisit) — all behind default-off flags — and close out the R1 deferred-seam backlog first.

**Architecture:** Receipts are attached where generation happens (client-side for Nexus insights — one cached doc `nexus/insights`; server-side for reports via the existing-but-empty `section.entryRefs`). Corrections flow through a new `source_exclusions` collection consumed at every generation seam, with staleness fanned out through the existing `markInsightsStale` + cache invalidation. Voice Chapters ride the durable capture layer (native `CaptureDraft` sidecar / web IDB meta) into the fused-transcription call, landing as metadata-only `transcription.chapters` (char offsets, `sourceSpan` pattern). Recipes/Session Prep are a new `reflections` artifact collection over the existing scope-filtered Ask Journal seams. Gentle Revisit is a server-side heuristic selection job (no LLM) writing a `revisit_queue`, suppressed by a `revisit_exclusions` list mirroring `insight_exclusions`.

**Tech Stack:** React 18 + Vite 5, Firebase (Firestore + Functions Node 22), Vitest 3, cloud design system (`src/components/cloud/`), Capacitor 8, relay-server (TS/Cloud Run). No new npm dependencies.

**Source spec:** `Engram_Trustworthy_Intelligence_PRD.docx` §5.2 (Control Center), §5.5 (Voice Chapters), §5.6 (Recipes), §5.7 (Gentle Revisit), §5.8 (Session Prep), §6 (shared objects), §8 (gates), §9 (2A/2B sequencing). Prior plans: `2026-07-20-trustworthy-capture-and-intelligence.md` (roadmap §), `2026-07-20-r1-follow-through.md` (R2 handoffs).

## Proposed product decisions (defaults chosen so work can proceed — MICHAEL: veto/ratify each)

1. **Retire `generateWeeklyDigests`.** The server weekly digest writes `digests/weekly` which has NO firestore.rules read block — clients literally cannot read it; it is invisible, costs Gemini calls weekly, and weekly reports cover the same ground with a user-visible surface. v1: remove the export (manual `firebase functions:delete generateWeeklyDigests` on the Michael checklist).
2. **Voice Chapters v1 is transcript-anchored; no audio playback or audio deep-links.** Raw audio is ephemeral by design (7-day vault; native background path deletes immediately post-transcription) and no audio player exists anywhere. Markers persist `startMs` so a future durable-audio feature can add playback without re-capturing anything. Ask-Journal→chapter deep links deferred (no entry-level deep-link infra exists).
3. **Scheduled reports stay all-spaces, now labeled.** Reports/digest gain an explicit `scope: 'all_spaces'` label + receipts rather than per-space scheduled generation (cost multiplier, tiny user base). Scoped reviews arrive via Recipes (on-demand, scope-explicit).
4. **Nexus receipts are client-generated** (where Nexus generation lives today). Server-authoritative receipts wait until/unless Nexus generation moves server-side (not R2).
5. **Session Prep = a specialized recipe template + export composition** reusing the existing client-side jsPDF `TherapistExportScreen` pathway (foreground-only by construction).
6. **Voice-relay scope**: the relay respects the scope active in UnifiedConversation at session start; voice sessions default to All spaces (today's behavior) when unscoped.
7. **Chapters are foreground-capture only in v1.** The background Shortcuts path gets a signed `x-goog-meta-chapters` header slot later; groundwork noted, not built.
8. **Gentle Revisit ships flag-off and stays internal** until Michael reviews the safety memo (Task 19). Non-negotiable exclusions: `safety_flagged`, `has_warning_indicators`, user suppressions. PRD gate: "Safety research and suppression rules must pass before Gentle Revisit can be enabled outside internal testing."

## Global Constraints

- Pushes to `main` auto-deploy (hosting always; functions/rules on path changes; **relay-server/** changes trigger canary deploy**). Never push a non-green batch: `npm test`, `npm run typecheck`, `npm run build` locally; `npm run test:rules` runs in CI (no local Java) and blocks deploy. Implementers NEVER push.
- New behavior ships behind default-off flags: `insightReceipts`, `voiceChapters`, `reflectionRecipes`, `sessionPrep`, `gentleRevisit`. Existing masters still apply (`intentExtraction`, `contextSpaces`).
- No guilt copy, streaks, anniversary-celebration framing, or "you haven't reflected" language anywhere. Absence of a card is a correct state.
- Raw source history immutable: chapters/receipts/artifacts/exclusions NEVER mutate entry `text`, `rawTranscript`, `createdAt`, `effectiveDate`, or audio. Chapter edits touch ONLY `transcription.chapters` (+ `audioDurationMs` at create). `entryCorrectionFields.js` invariants hold.
- Capture stays sacred: marking a chapter never interrupts or blocks recording; chapters failure never blocks entry save (fall back to chapterless).
- Receipts/artifacts live in the user's own docs and may contain short excerpts; operational logs still never contain journal text.
- No new npm dependencies. New UI uses `src/components/cloud/` primitives; full-screen overlays follow the `PrivacyCenter.jsx` template. Copy is inline English literals.
- Server jobs follow WS-A invariants: idempotency markers, lease where applicable, `isAiAllowed` fail-closed before any provider call (Gentle Revisit v1 makes NO provider calls — documented).
- `user_decisions`/exclusion records are append-only or reversible-by-design; destructive actions require explicit confirmation.

## Ground truth (from 5 exploration agents @ cba66f0)

**Insights/receipts:** Nexus insights = ONE client-written doc `artifacts/{APP}/users/{uid}/nexus/insights` `{active[], history[] (50), generatedAt, expiresAt(+24h), stale}` (`orchestrator.js:213-215,940-946`); `markInsightsStale` (:949-958). Insight objects heterogeneous: `{id, type, title, summary, body, priority, evidence:{narrative[], statistical:{sampleSize,...}}}` — **no source entryIds** (BasicInsights correlations DO carry `entryIds`). `isDuplicateInsight(newInsight, existing, threshold=0.6)` (:1062). `fetchRecentEntries(userId, days=30, scope=null)` (:268) — R1 scope seam, all callers pass null. `useNexusInsights` pipeline: feedbackLearning suppression → confidence≥0.5 → insightBudget gate (`applyInsightBudget` + `recordShownInsights`, flag `insightBudget`). Server `analysisMeta` = `{modelId, promptVersion:1, orchestratorVersion:1, inputVersion, completedAt}` + `context_version:1` (`functions/src/analysis/orchestrator.js:255-263`, flag `serverAnalysisOrchestrator` default OFF). `publishFinal` discards stale inputVersion writes (:99-119). C4 stamp exists ONLY on `goal_update.derivedFromInputVersion` (:316); `derivationVersion` exists nowhere; `enrichment.status:'stale'` written (`entryCorrectionFields.js:85`) but has ZERO consumers. `ProvenanceDisclosure.jsx` (EntryCard:884) is the only "Why am I seeing this?" UI and reads fields the server never writes (inert Method line). Model registry: `functions/src/models/registry.js` `getModel(db, workload)` per-workload; prompt/orchestrator/context versions are hardcoded consts. `insight_exclusions` shape `{patternType, context{}, reason, permanent, excludedAt, expiresAt}` + `isPatternExcluded` (`signalLifecycle.js:341-430`); server consumer `fetchActiveExclusions` (`functions/index.js:1621`). Feedback: `recordFeedbackAndLearn(userId, feedback:'accurate'|'inaccurate', citedEntries)` → `insightLearning/{patternType}` (suppression at ≥3 feedback &lt;0.4 accuracy, 30d); `recordInsightEngagement(userId, insight, 'explored'|'dismissed')` → `insight_engagement_events`.
**Capture/chapters:** Native sidecar `CaptureDraft` `{id, ownerHash, fileName, mime, createdAt, durationMilliseconds, status: recording|stored|interrupted|needsReview}` (`ios/App/App/Capture/CaptureState.swift:3-13`); `CaptureDraftStore.swift` atomic partial update pattern = `updateStatus` (L72-80); interruption handler `CaptureCoordinator.swift:122-133`. Plugin methods (`CapturePlugin.swift:9-18`): requestPermission/start/stop/listDrafts/readDraft/deleteDraft/updateDraftStatus/enqueueUpload; `stop` returns `{draftId, assetId, mime, durationMs, base64}`. Web: `EntryBar.jsx` mode machine (`mode` useState :99; `startRecording` :239-410; `recordingSeconds` 1s counter :102/259; chunk persistence flag `webChunkPersistence` → IDB `appendChunk` :287-298); IDB db `engram-capture` stores `chunks`/`meta` (keyPath `['ownerUid','draftId']`)/`vault` (`idbCaptureDb.js:45-70`). Durable pipeline: `handleAudioWrapper` (`App.jsx:1957-2260`): `prepareDurableRecording` vaults BEFORE network → operationStore op → `transcribeEntryFused(base64, mime, 3, properNouns)` :2081 → `saveEntry` → `linkEntry(uid, recordingId, 'saved')` (sentinel, not real entry id). Retry via `PendingAudioBanner` → `handleAudioWrapper({existingRecordingId})`. Fused transcription (`fusedTranscription.js`): gemini-2.5-flash, prompt returns `{rawTranscript, transcript, toneAnalysis}` — NO timestamps requested; Whisper fallback raw-only. Callable `transcribeEntry` (`functions/index.js:1019-1136`) request `{base64, mimeType, properNouns, operationId}`. Entry doc has NO audioDuration/audioPath. EntryCard renders `entry.text.split(/\n\n+/)` paragraphs (:795-799); no player. Char-range precedent: intent `sourceSpan{start,end,text}` (`intentSchema.js:102-114`). Upload ticket signs `x-goog-meta-captured-at`/`capture-timezone` (`uploadTicket.js:38-113`); Swift `enqueueUpload` passes headers through (`BackgroundUploader.swift:74-91`); `onAudioUploaded.js:194-204` reads `meta['captured-at'|'capture-timezone'|'space-id']`.
**Reports/export:** Weekly digest `generateWeeklyDigests` (`functions/index.js:4046`, monday 06:00) → `digests/weekly` `{narrative, lookAhead, highlightedPatterns, mood, entryCount, weekOf, generatedAt, version}` — **no rules block → client-unreadable**; entry fetch scope-blind (:4137-4157). Reports: schedulers (`reports/scheduler.js:82-108`), thresholds (`periodUtils.js:8`), `generateReport` (`generator.js:25`) → doc `reports/{cadence-YYYY-MM-DD}` `{cadence, periodStart/End, status, sections[], metadata, notificationSent, retryCount}`; **section shape `{id, title, narrative, chartData, entities[], entryRefs[]}` — `entryRefs` always written `[]`** (`narrative.js:41-66`); scope-blind reads: `scheduler.js:27-31`, `generator.js:219-227` (+ readAnalytics/readNexusData/readSignalData/readHealthData). Premium narrative `narrative.js:100` uses `callGeminiWithRetry` with DEFAULT model (not `getModel`). PDF export `pdfExport.js:328` → strips crisis-flagged ids **collected from `section.entryRefs`** (currently vacuous because empty!), Storage + 24h signed URL. Client therapist export = `TherapistExportScreen.jsx` (client-side jsPDF, date-range + per-entry selection, `showExport` gate `App.jsx:3189`). `diagnosticExport.js` exists. **No docs/view route exists** (already remediated). Ask Journal chat mode does NOT use the callable — `UnifiedConversation.handleSendMessage` :325 → `getCompanionContext({..., scope: effectiveScope})` → client `callOpenAI`; the `askJournalAI` service fn (`analysis/index.js:454`, scope-aware :305-307) → `askJournalAIFn` callable (stateless, receives `entriesContext` string). **Q&amp;A is not persisted anywhere.** `getCompanionContext` context items already carry `{id, date, similarity}` — natural receipt raw material. Cloud primitives: Drawer/Dialog/Card/CardRow/Chip/SectionLabel/Tabs; overlay template `PrivacyCenter.jsx`; `SpaceManager.jsx` modeled on it. Settings rules pattern `firestore.rules:108-156` (consent/insightBudget/spacePrefs shape clauses).
**Safety/revisit:** Persisted entry flags: `safety_flagged`, `safety_user_response`, `has_warning_indicators` (`buildCoreEntry.js:150-159`; snake_case). Crisis-deferred save: `App.jsx:1838-1853` (`checkCrisisKeywords` → `setPendingEntry` → NOT saved yet); server recomputes authoritative `safety_flagged` (`functions/src/safety/crisisKeywords.js`). `checkLongitudinalRisk(recentEntries)` exists (`services/safety/index.js`; 14d window, min 5 entries). `shouldCelebrateNewStreak` gates on camelCase closure flags (`services/dashboard/index.js:518-522`). No "on this day"/anniversary surface exists. Notification doc `settings/notifications` `{enabled, journalRemindersEnabled, timezone, reminderHour, deliveryWindowStart/End, lastReminderSentAt}`; `@capacitor/push-notifications` NOT in package.json; iOS `aps-environment` missing → in-app only confirmed. Scheduled per-user sweep analog: `journalReminder` (`functions/index.js:2135`). Widget registration = 3 edits: `useDashboardLayout.js` `WIDGET_DEFINITIONS`(+optional `DEFAULT_DASHBOARD_LAYOUT`), `widgets/index.js` `WIDGET_COMPONENTS`, component file; layout doc `preferences/dashboard`; `filterEntriesByScope` strict (`scopeFilter.js:29-30`).
**Carry-over sites:** (1) offline spaceId dropped by `queueEntry` whitelist `offlineManager.js:43-69` + callers `App.jsx:1073,1493,1793` + `entryProcessor.js:65-73,80,126` (online path passes it at `App.jsx:1421-1439`). (2) WidgetDrawer no flag filter (`WidgetDrawer.jsx:193-251`; `availableWidgets` `useDashboardLayout.js:126-130`); saved layout replaces wholesale, no merge (:150-162); `open_loops` missing from `WIDGET_ICONS`. (3) Budget day-boundary: `useNexusInsights.js:267-269` inline `Date.now()`, `shownLog`/mode read once per mount (:66-88); `isSameCalendarDay` (`insightBudget.js:80-88,217-222`). (4) `subscribeUpcomingOpenLoops` bakes `now` at subscribe (`intentClient.js:121-130`); `refreshNonce` re-keys DUE effect only (`OpenLoopsWidget.jsx:161-189` — upcoming effect deps miss `refreshNonce`). (5) space-id header: reader wired (`onAudioUploaded.js:194-204`) but NO `SPACE_ID_HEADER` in `uploadTicket.js` and wrapper `functions/index.js:1159` drops it; Swift passes headers through already. (6) `companionContext.js` Tier1 memory-graph (:182-189) + Tier2 session-buffer (:194-204) bypass scope; relay `searchEntries` (`relay-server/src/auth/firebase.ts:397-441`) + `promptBuilder.ts` scope-blind (no spaceId anywhere in relay-server). (7) `targetAt` accepts any non-empty string (`intentSchema.js:198-199`); `validateIsoOrNull` (:116-122) equally weak. (8) Scope-picker triplicated: `EntryBar.jsx:29-76`, `EntryCard.jsx:49-77`, `UnifiedConversation.jsx:1116-1144`. (9) Nested `aria-modal` dialogs in `SpaceManager.jsx:155-159` + `:273-279`. (10) futureMentions writer `enrichmentRunner.js:135-144` (+ legacy `App.jsx:1706-1707`); dead reader chain `prompts/index.js:21-60,412-417,610` (`generateDashboardPrompts` has no importer); incidental: `signals/migration.js:68-69` (keep), `utils/entries.js:42`. (11) `modals/DailySummaryModal.jsx` still on colorMap + legacy palette, not in MIGRATED list.
**Memory-corrections:** the "daily 06:45 AI digest / actionExecutor body_format" items are Cosmo (chief-of-staff), NOT Engram. Engram has only the weekly digest above.

## Execution model

Work directly on `main`. Push batches, each ending with the full green gate + push. One implementer per file-conflict boundary; `App.jsx`/`AppLayout.jsx`/`EntryCard.jsx` serialized. Batches:

- **Batch R2-1 (Tasks 1–6):** R1 carry-over fixes + scope seams. No new flags; scope fixes activate only under existing `contextSpaces`. Touches relay-server (canary deploy on push).
- **Batch R2-2 (Tasks 7–9):** flags, rules, receipts foundation (Nexus + reports), digest retirement.
- **Batch R2-3 (Tasks 10–12):** source exclusions + recompute, ReceiptSheet, Control Center.
- **Batch R2-4 (Tasks 13–15):** Voice Chapters (web+native capture → transcription → EntryCard UI).
- **Batch R2-5 (Tasks 16–17):** Reflection Recipes engine + UI.
- **Batch R2-6 (Task 18):** Session Prep.
- **Batch R2-7 (Tasks 19–20):** Gentle Revisit (safety memo → server job → widget/controls).
- **Batch R2-8 (Task 21):** validation matrix, runbook, docs, status.

---

### Task 1: Offline queueEntry preserves spaceId

**Files:**
- Modify: `src/services/offline/offlineManager.js:43-69`, `src/services/entries/entryProcessor.js:65-73`
- Modify: `src/App.jsx:1073,1493,1793` (thread `captureSpaceId` into all three queueEntry payloads)
- Test: `src/services/offline/__tests__/offlineManager.test.js`, extend entryProcessor tests

**Interfaces:**
- `queueEntry(entryData)` whitelist gains `spaceId: entryData.spaceId` — conditional like the other optional keys (no null-stuffing: include only when non-null).
- `entryProcessor` `baseEntry` gains conditional `spaceId` from its input options.
- Sync-side re-save already honors it via `buildCoreEntry` conditional (`buildCoreEntry.js:106-111`) — add an integration-style test: queue with spaceId → synced payload contains `spaceId`; queue without → field absent (never `null`).

- [ ] Failing tests: queued record carries spaceId when provided; absent otherwise; all three App.jsx offline paths forward `captureSpaceId`; entryProcessor passthrough.
- [ ] Implement; green. Commit `spaces: offline queue preserves selected spaceId (pre-flag-on blocker)`.

### Task 2: Loop/budget freshness + targetAt canonicalization

**Files:**
- Modify: `src/components/zen/widgets/OpenLoopsWidget.jsx:185-189` (add `refreshNonce` to upcoming effect deps)
- Modify: `src/hooks/useNexusInsights.js` (day-boundary re-evaluation)
- Modify: `functions/src/intents/intentSchema.js` (`validateIsoOrNull` + `targetAt`)
- Tests: `OpenLoopsWidget.test.jsx`, `useNexusInsights` budget tests, `intentSchema.test.js`

**Interfaces:**
- OpenLoopsWidget: upcoming subscription re-subscribes on the same `refreshNonce` (visibilitychange + 5-min interval) the due list already uses — a loop crossing `targetAt` while mounted migrates upcoming→due without remount.
- useNexusInsights: add `const [nowTick, setNowTick] = useState(Date.now())` updated by the same visibility/interval pattern (extract a tiny shared `useFreshnessTick(intervalMs=300000)` hook in `src/hooks/useFreshnessTick.js`, reused by both widget and hook); `budgetedInsights` memo deps include `nowTick`; pass `now: nowTick`.
- intentSchema: `validateIsoOrNull(value, field)` now requires `!Number.isNaN(Date.parse(value))` AND round-trip shape `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/` prefix; `targetAt` validated through it. Applies to NEW writes only (extractor/build path); existing docs untouched; extractor catch: invalid model-produced targetAt → abstain for open_loop kind (a loop with an unparseable due time must not enter the due query), plain `targetAt:null` for others.

- [ ] Failing tests: upcoming list refreshes past boundary on nonce bump; budget dayCount resets across simulated midnight with nowTick advance; schema rejects `"tomorrow"`, accepts `"2026-07-22T09:00:00.000Z"`, open_loop with junk targetAt abstains.
- [ ] Implement; green. Commit `fix: loop/budget freshness ticks + ISO-strict targetAt`.

### Task 3: Widget drawer flag-gating + saved-layout merge

**Files:**
- Modify: `src/hooks/useDashboardLayout.js`, `src/components/zen/WidgetDrawer.jsx:7-17`
- Tests: `src/hooks/__tests__/useDashboardLayout.test.js` (extend)

**Interfaces:**
- `WIDGET_DEFINITIONS[id]` gains optional `flags: string[]` (`open_loops` → `['openLoops','intentExtraction']`; future `revisit` → `['gentleRevisit']`).
- `availableWidgets` filters `id => (WIDGET_DEFINITIONS[id].flags ?? []).every(getFlag) && !currentLayoutIds.includes(id)`.
- Merge: on snapshot with saved layout, `mergedLayout = [...saved, ...DEFAULT_DASHBOARD_LAYOUT.filter(d => !savedIds.has(d.id) && !userRemovedIds.has(d.id))]`. Track removals: `removeWidget` appends id to a `removedDefaults: string[]` field persisted on `preferences/dashboard` so a deliberately-removed default never resurrects. Merge is in-memory only (no write-back on load).
- Add `open_loops` to `WIDGET_ICONS`.

- [ ] Failing tests: flag-off widget absent from availableWidgets; saved-layout user sees newly-shipped default widget appended; removedDefaults suppresses resurrection; no Firestore write on load.
- [ ] Implement; green. Commit `dashboard: flag-gated widget drawer + non-destructive default-layout merge`.

### Task 4: Shared SpacePicker + SpaceManager a11y

**Files:**
- Create: `src/components/spaces/SpacePicker.jsx` + `__tests__/SpacePicker.test.jsx`
- Modify: `src/components/dashboard/EntryBar.jsx:29-76`, `src/components/entries/EntryCard.jsx:38-79`, `src/components/chat/UnifiedConversation.jsx:1116-1144` (consume shared component)
- Modify: `src/components/spaces/SpaceManager.jsx:155-159,273-279`

**Interfaces:**
- `<SpacePicker spaces selectedSpaceId onSelect defaultLabel="No space"|"All spaces" align='left'|'right' />` — extracts the triplicated `role="listbox"` popover (uses `useDismissablePopover` internally); selection contract stays `(spaceIdOrNull) => void`; visual classes unchanged (`min-w-[140px] rounded-xl border border-border bg-card p-1 shadow-soft-lg`).
- SpaceManager: while archive sheet is open, outer dialog gets `aria-hidden="true"` + `inert` and only the sheet keeps `aria-modal`; Escape closes inner first, then outer; focus returns to the archive trigger.

- [ ] Failing tests: three call sites render identical option lists via the shared component with their distinct default labels; selection callbacks unchanged (assert exact payloads); only one `aria-modal="true"` node present when archive sheet open; Escape order.
- [ ] Implement; green. Commit `spaces: shared SpacePicker + SpaceManager modal a11y`.

### Task 5: Close scope-blind seams — companionContext Tier1/2, relay, space-id upload header

**Files:**
- Modify: `src/services/rag/companionContext.js:177-204`
- Modify: `relay-server/src/auth/firebase.ts:397-441`, `relay-server/src/relay/realtimeProxy.ts:220-262`, `relay-server/src/relay/standardPipeline.ts:292-371`, `relay-server/src/context/promptBuilder.ts`, plus the client session-init sender (`src/hooks/useVoiceRelay.js` — locate the session/config message)
- Modify: `functions/src/capture/uploadTicket.js`, `functions/index.js:1150-1169`, client ticket caller (`src/services/capture/` upload path — `nativeCaptureAdapter.ts`/`captureService.ts`)
- Tests: `companionContext` tests, relay-server tests (`relay-server/` suite), `uploadTicket` tests, `onAudioUploaded` test extension

**Interfaces:**
- companionContext: when `scope` non-null — Tier 2 `buffer.recentEntry` included only if `recentEntry.spaceId === scope.spaceId` (strict, unscoped excluded); Tier 1 memory-graph section OMITTED entirely (entity graph is cross-space-derived; strict-scope precedent from R1) with a one-line context note `"(Long-term memory omitted: scoped conversation)"`. Null scope: byte-identical legacy output (test).
- Relay: client includes `spaceId: string|null` in the session-init message; relay threads it to `searchEntries(uid, {spaceId})` → adds `.where('spaceId','==',spaceId)` when set (composite index `(spaceId, createdAt DESC)` exists from R1) and to `promptBuilder` recentEntries query the same way. Null → today's queries byte-identical.
- Upload ticket: `SPACE_ID_HEADER = 'x-goog-meta-space-id'`; `issueCaptureUploadTicketCore` gains optional `spaceId` (string, 1–40 chars, `/^[A-Za-z0-9_-]+$/`) → signed into `extensionHeaders` + echoed in `requiredHeaders`; callable wrapper destructures + forwards `spaceId`; client ticket caller passes `captureSpaceId` when `getFlag('contextSpaces')`. Swift passes headers through unchanged (no Swift edit). `onAudioUploaded` reader already consumes `meta['space-id']`.

- [ ] Failing tests: scoped context omits Tier1 + cross-space Tier2 (adversarial: Personal recentEntry never in Work-scoped context); null-scope identity; relay query gains where-clause only when spaceId set; ticket signs + requires the header only when spaceId provided; invalid spaceId rejected.
- [ ] Implement; green (run relay suite: `cd relay-server && npm test`). Commit `spaces: scope-aware companion Tier1/2, voice relay, background-upload space-id header`.

### Task 6: futureMentions removal + DailySummaryModal Cloud migration

**Files:**
- Modify: `src/services/entries/enrichmentRunner.js:135-144`, `src/App.jsx:1706-1707`, `src/services/prompts/index.js` (delete `extractTodayFollowUps` + `generateDashboardPrompts` dead chain), `src/utils/entries.js:42`
- Keep untouched: `src/services/signals/migration.js` (one-time migration), `src/services/temporal/index.js` (producer stays; output no longer persisted)
- Modify: `src/components/modals/DailySummaryModal.jsx` (colorMap → cloud tokens, legacy palette classes → Cloud equivalents; add to MIGRATED list in `src/utils/__tests__/cloudMigration.test.js`)

- [ ] Failing tests: enrichmentRunner output contains no `futureMentions` key; prompts module exports unchanged minus removed fns (grep-import test); DailySummaryModal passes cloudMigration ratchet as MIGRATED.
- [ ] Implement; green. Commit `cleanup: retire futureMentions persistence + migrate DailySummaryModal to Cloud`. **Batch R2-1 gate:** full local green (incl. relay suite) → push. Watch CI (hosting + functions + relay canary).

---

### Task 7: R2 flags, rules, collections

**Files:**
- Modify: `src/config/flags.js` + `src/config/__tests__/flags.test.js`, `functions/src/shared/flags.js` mirror if present
- Modify: `firestore.rules`, `functions/src/__tests__/firestoreRules.test.js`
- Modify: `firestore.indexes.json` (only if a new composite proves necessary — expected: none; document check)

**Interfaces:**
- Flags added to `FLAG_DEFAULTS`, all `false`: `insightReceipts`, `voiceChapters`, `reflectionRecipes`, `sessionPrep`, `gentleRevisit`.
- New rules blocks (all under `users/{userId}`, owner-scoped):
  - `match /source_exclusions/{id}`: owner read/create/delete; create shape `keys().hasOnly(['entryId','appliesTo','reason','permanent','createdAt'])`, `entryId is string`, `appliesTo is string` (`'all'` or a patternType), `reason in ['wrong_source','excluded_by_user']`, `permanent == true`. No update (delete = restore).
  - `match /recipes/{id}`: owner CRUD; shape `hasOnly(['name','questions','scope','timeRangeDays','cadence','state','definitionVersion','createdAt','updatedAt'])`, `name.size() <= 60`, `questions is list && questions.size() <= 5`, `state in ['active','archived']`, `cadence in ['manual']`.
  - `match /reflections/{id}`: owner CRUD; shape `hasOnly(['kind','recipeId','definitionVersion','scope','period','title','blocks','status','createdAt','updatedAt'])`, `kind in ['recipe_run','session_brief']`, `status in ['draft','final']`.
  - `match /revisit_exclusions/{id}`: owner read/create/delete; shape `hasOnly(['dimension','value','reason','permanent','createdAt','expiresAt'])`, `dimension in ['entry','date','person','tag','space','family']`, `reason in ['never_show','less_like_this','hidden_dim']`.
  - `match /revisit_queue/{id}`: owner read/delete; update `affectedKeys().hasOnly(['status','updatedAt'])` + `status in ['shown','dismissed']`; NO client create (server writes).
  - `settings` clause additions: `revisitPrefs` → `hasOnly(['enabled','optInAt','updatedAt'])`, `enabled is bool`.
- Rules tests: shape acceptance/rejection per collection, cross-user denial, revisit_queue client-create denial, status-only update.

- [ ] Failing rules tests → rules; flags test exact-object. Green locally (rules in CI). Commit `infra: R2 flags + rules (source exclusions, recipes, reflections, revisit)`.

### Task 8: Insight Receipts on Nexus + Basic insights

**Files:**
- Create: `src/services/insights/receipts.js` + `__tests__/receipts.test.js`
- Modify: `src/services/nexus/orchestrator.js` (generators thread entryIds; `applyReceiptDefaults` before save), `src/services/basicInsights/*` correlations (normalize existing `entryIds` into receipt), `src/hooks/useNexusInsights.js` (no pipeline change; passthrough field)
- Test: extend orchestrator tests

**Interfaces:**
- `buildReceipt({sources, scope, timeWindow, sampleSize, missingness, generator})` → 
  ```js
  { sources: [{entryId, date /*ISO*/, excerpt /*≤120 chars|null*/}],
    scope,                    // {spaceId}|null — 'all spaces' when null
    timeWindow: {start, end}, // ISO
    sampleSize, missingness,  // e.g. '12 of 30 days have entries'|null
    versions: { generator, computationVersion: 1, generatedAt /*ISO*/,
                model: null, promptVersion: null }, // model/prompt filled only for LLM-produced insights
  }
  ```
- `applyReceiptDefaults(insight, {windowEntries, scope})` — pure; if `insight.receipt` missing, attaches a window-level receipt (sources = up to 10 most-recent windowEntries refs, sampleSize = windowEntries.length). Invariant test: **after `generateInsights`, EVERY insight in `active` has a truthy `receipt`** (PRD: 100% of visible insights).
- Generators with real source sets thread them: `detectSimplePatterns`/`computeEntityMoodCorrelations`/intervention + calibration paths pass the exact entry lists they computed over → `buildReceipt` with real `sources` (cap 20, most recent first) and per-generator `versions.generator` (e.g. `'entity_correlation'`).
- Excerpt rule: first 120 chars of `entry.text` single-line; excerpts live only in the user's own `nexus/insights` doc (never in logs).
- Basic insights: correlations already produce `entryIds` — wrap into the same receipt shape at the point they're surfaced on InsightsPage.
- Budget interplay: `recordShownInsights` continues to store `{id, theme, title, shownAt}` only (no receipt) — unchanged.

- [ ] TDD: buildReceipt validation; applyReceiptDefaults fallback; every-insight-has-receipt invariant; entity/pattern insights carry the exact computed entryIds; scope stamped when `fetchRecentEntries` called with scope.
- [ ] Green. Commit `insights: receipts attached at generation (flag-independent data, surfaced under insightReceipts)`.

### Task 9: Report receipts + scope labels; digest retirement

**Files:**
- Modify: `functions/src/reports/generator.js` (readEntries exclusions + entryRefs), `functions/src/reports/narrative.js` (populate `entryRefs`, model via registry), `functions/src/reports/scheduler.js` (no change beyond comment), `functions/src/reports/pdfExport.js` (verify crisis-strip now real)
- Delete: `generateWeeklyDigests` + `generateUserWeeklyDigest` + digest prompt/helpers from `functions/index.js:4046-4330` region (leave `digests/weekly` data in place, inert)
- Tests: `functions/src/reports/__tests__/*` extensions

**Interfaces:**
- `readEntries` filters out entries whose ids appear in `source_exclusions` (one collection read per report run; `appliesTo=='all'` only).
- Every section's `entryRefs` = ids of the entries actually fed to that section's builder (weekly template: per-section subsets where determinable, else the period's full id list — documented per section). `metadata` gains `{scope:'all_spaces', model: <getModel(db,'insight')-resolved id>, promptVersion: 1, sourceEntryCount}`.
- `generatePremiumNarrative` model call goes through `getModel(db, 'insight')` (registry) instead of the default-model helper.
- pdfExport: no interface change — add a test proving a crisis-flagged entry id present in `entryRefs` is stripped from the export (previously vacuous).
- Digest removal: exports deleted; Michael checklist gains `firebase functions:delete generateWeeklyDigests` (CI deploy does not auto-delete).

- [ ] TDD: excluded source absent from readEntries result; entryRefs non-empty and accurate on a fixture report; metadata fields; crisis-strip real; registry-resolved model id used.
- [ ] Green. Commit `reports: real entryRefs receipts + scope label + registry model; retire invisible weekly digest`. **Batch R2-2 gate:** green → push (functions+rules deploy; WATCH rules CI).

---

### Task 10: Source exclusions service + dependency-aware recompute

**Files:**
- Create: `src/services/insights/sourceExclusions.js` + `__tests__/sourceExclusions.test.js`
- Create: `src/services/insights/recompute.js` + `__tests__/recompute.test.js`
- Modify: `src/services/nexus/orchestrator.js` `fetchRecentEntries` (drop excluded ids), `src/components/entries/EntryCard.jsx` space-change handler (invalidate caches)

**Interfaces:**
- `excludeSource(db, uid, {entryId, appliesTo='all', reason})` → addDoc + `onSourcesChanged(db, uid)`; `restoreSource(db, uid, exclusionId)` → deleteDoc + `onSourcesChanged`; `listSourceExclusions(db, uid)`; `getExcludedEntryIds(db, uid)` → Set (cached per call).
- `onSourcesChanged(db, uid)` (in recompute.js) — fans out staleness: `markInsightsStale(uid)` + delete today's `dashboardCache/{date}_{category}` docs + `invalidateWeeklyDigest` equivalents. PRD acceptance "stale within 10 seconds" — all three are immediate awaited writes.
- `fetchRecentEntries` filters `!excludedIds.has(e.id)` after scope filter (both compose); `generateInsights` reads exclusions once at start.
- Entry space-change (EntryCard scope re-assign, R1) additionally calls `onSourcesChanged` (space move changes what scoped artifacts should contain).
- Version preservation: regenerate keeps `history` (existing 50-cap) — test that prior insights survive a regenerate for audit (PRD acceptance).

- [ ] TDD: exclude → stale flag set + caches invalidated (mock timers, ≤10s); regenerated insights (fixture entries) never cite an excluded entryId in any `receipt.sources` NOR use it in stats (adversarial: excluded entry's mood flips a correlation — assert output unaffected); restore → next generation includes it; space-change invalidation.
- [ ] Green. Commit `insights: source exclusions with immediate staleness + exclusion-honoring regeneration`.

### Task 11: ReceiptSheet — "Why am I seeing this?"

**Files:**
- Create: `src/components/insights/ReceiptSheet.jsx` + `__tests__/ReceiptSheet.test.jsx`
- Modify: `src/components/zen/widgets/NexusInsightsWidget.jsx`, `src/pages/InsightsPage.jsx` (entry points on each insight card, flag `insightReceipts`)

**Interfaces:**
- `<ReceiptSheet insight entriesById onClose onExcludeSource onFeedback />` — cloud `Drawer`. Sections: claim (title+summary), confidence band (plain language: "strong/moderate/tentative" from confidence value, no numerics-only), Space label (`receipt.scope` → name or "All spaces"), time window, sample size + missingness line BEFORE the narrative section (PRD order), sources list (date + excerpt, tap loads full entry text inline via entriesById/fetch), alternatives line when `evidence.narrative` offers one.
- Distinct actions (PRD P0): **Not true** → `recordFeedbackAndLearn(uid,'inaccurate',citedEntries)`; **Not useful** → `recordInsightEngagement(uid, insight,'dismissed')` (budget-family ranking already consumes engagement/learning); **Wrong source** (per source row) → `excludeSource({entryId, appliesTo: patternTypeOf(insight), reason:'wrong_source'})`; **Exclude source** (per source row) → confirm dialog → `excludeSource({entryId, appliesTo:'all', reason:'excluded_by_user'})`. Both exclusion paths surface "This will recompute affected insights" copy and call through Task 10 (staleness immediate).
- Two-taps acceptance: insight card → "Why am I seeing this?" → source visible. Widget + page both mount the trigger under `getFlag('insightReceipts')`.

- [ ] TDD: renders every receipt field; missingness precedes narrative; each action calls the exact service with exact payloads; exclude requires confirm; flag off → no trigger rendered; no numeric-jargon copy (assert absence of "model", "token").
- [ ] Green. Commit `insights: ReceiptSheet — why-am-I-seeing-this with distinct repair actions (flag: insightReceipts)`.

### Task 12: Insight Control Center screen

**Files:**
- Create: `src/components/insights/InsightControlCenter.jsx` + `__tests__/InsightControlCenter.test.jsx`
- Modify: `src/components/zen/AppLayout.jsx` + `src/pages/SettingsPage.jsx` (nav row "Insight Control Center" in AI & Privacy group, flag `insightReceipts`, wired like `onOpenPrivacy`)

**Interfaces:**
- Full-screen overlay (PrivacyCenter template), props `{uid, onClose}`. Sections (cloud-sheet groups):
  1. **Excluded sources** — `listSourceExclusions` rows (entry date + excerpt via fetch, reason) + Restore (reversible, PRD P0).
  2. **Muted insight families** — `getSuppressedPatterns()` + pattern exclusions (`getActiveExclusions`) rows + "Show again" (`liftSuppression` / `removeExclusion`).
  3. **Recompute** — staleness status line (from `nexus/insights.stale`), "Recompute now" → `regenerateInsights` (existing hook path), last-generated timestamp, and a plain preview line "Recomputing uses your current exclusions (N sources excluded)".
  4. **Withheld this week** (P1, cheap here): count line derived from budget — `applyInsightBudget` already computes caps; show "N insights withheld by your Balanced budget" with mode link to Settings. No per-candidate explanations in v1.
- No raw journal text beyond source excerpts already permitted; destructive actions (none — all reversible) n/a.

- [ ] TDD: all four sections render from mocked services; restore/lift call-through payloads; recompute button triggers regenerate; flag-off → nav row absent.
- [ ] Green. Commit `insights: Control Center — exclusions, muted families, recompute (flag: insightReceipts)`. **Batch R2-3 gate:** green → push (hosting only — verify no functions paths touched).

---

### Task 13: Chapter markers — durable capture (web + native foreground)

**Files:**
- Modify: `src/services/capture/webChunkStore.js` (+ `idbCaptureDb.js` meta usage), `src/components/dashboard/EntryBar.jsx`, `src/services/audio/audioVault.js` (index `markers`), `src/services/capture/prepareDurableRecording.js`, `src/services/capture/operationStore.ts` (op `markers`), `src/App.jsx` `handleAudioWrapper` (thread through), `src/components/shared/PendingAudioBanner.jsx` (retry passes markers)
- Modify (native): `ios/App/App/Capture/CaptureState.swift` (`markers: [Marker]?`, `struct Marker: Codable { let tMs: Int }`), `CaptureDraftStore.swift` (`addMarker(id:ownerHash:tMs:)` — atomic rewrite mirroring `updateStatus` L72-80), `CaptureCoordinator.swift` (`markChapter()` reads `recorder.currentTime`), `CapturePlugin.swift` (new `markChapter` method; `stop` result gains `markers`), `src/services/capture/nativeCaptureAdapter.ts` + `captureService.ts` (surface `markChapter`, return markers on stop)
- Tests: webChunkStore/audioVault/operationStore tests; EntryBar interaction test; Swift changes statically verified (no new files → no pbxproj edit) + device step on Michael checklist

**Interfaces:**
- Web: `appendMarker(ownerUid, draftId, tMs)` writes into the IDB `meta` record `{markers: number[]}` at tap time (durable before stop — survives tab kill with `webChunkPersistence`); `EntryBar` shows a "Chapter" pill-button in recording mode (flag `voiceChapters`), tap → `appendMarker` with `tMs = (Date.now() - recordingStartedAtRef)`, haptic-free subtle count badge ("Ch 2"), NEVER pauses recording.
- Native: `Capture.markChapter({draftId})` → coordinator `recorder.currentTime*1000` → sidecar `markers` append (atomic; survives interruption handler because it's on disk at tap time); `stop()` result adds `markers: [{tMs}]`.
- Pipeline: `handleAudioWrapper(base64, mime, {markers, durationMs, ...})`; `prepareDurableRecording` persists `markers`+`durationMs` onto the vault index entry; `operationStore` op record gains optional `markers`/`durationMs`; banner retry re-reads them from the vault index (test: retry after simulated kill preserves markers).

- [ ] TDD web-side: marker durable at tap; stop passes markers+duration; retry path preserves; flag off → no button.
- [ ] Implement Swift (existing files only) + JS; green. Commit `chapters: durable marker capture — web IDB + native sidecar (flag: voiceChapters)`.

### Task 14: Chapters through transcription

**Files:**
- Modify: `functions/src/transcription/fusedTranscription.js`, `functions/index.js:1019-1136` (`transcribeEntry` request/response), `src/services/ai/transcription.js` (`transcribeEntryFused` passes markers/duration), `src/App.jsx` (entry save: `transcription.chapters` + `audioDurationMs`), `src/services/entries/buildCoreEntry.js` (accept optional `chapters`/`audioDurationMs`, conditional)
- Tests: `fusedTranscription` prompt/parse tests, `buildCoreEntry` test, `transcribeEntry` contract test

**Interfaces:**
- Request: `{base64, mimeType, properNouns, operationId, markers: [{tMs}] = [], durationMs = null}`.
- When `markers.length > 0`, prompt appends: the marker timestamps + instruction to return `chapters: [{startMs, title (2–4 words), text}]` with exactly `markers.length + 1` chapters (start-of-audio implicit first boundary), where concatenating `chapters[].text` reproduces the cleaned transcript. Gemini hears the audio, so segmentation at spoken positions is reliable without word-level timestamps.
- `parseFusedResponse` validates: chapter count correct AND whitespace-normalized `chapters.map(c=>c.text).join(' ')` equals normalized `transcript` → else `chapters: null` (transcription still succeeds; NEVER blocks save). Whisper fallback: always `chapters: null`.
- Response: `{rawTranscript, transcript, toneAnalysis, engine, chapters}`.
- Client: computes char offsets by sequential `indexOf` walk over `cleanedTranscript` → entry fields (conditional, no null-stuffing):
  ```js
  transcription.chapters = [{id:'ch_0', index, startMs, title, charStart, charEnd}]
  audioDurationMs
  ```
  Raw transcript/`text` untouched (invariant test). `entryCorrectionFields.js` invariant extended: meaningful-edit fields still never touch `transcription.*`.

- [ ] TDD: prompt contains markers only when present; parse accepts valid, rejects mismatched joins → null; offsets computed correctly incl. duplicate-paragraph text; entry save with/without chapters; save proceeds when chapters null.
- [ ] Green. Commit `chapters: fused transcription returns marker-aligned chapters; entry stores metadata only`.

### Task 15: Chapters UI on EntryCard

**Files:**
- Modify: `src/components/entries/EntryCard.jsx:795-799` (chaptered body render), + a small `src/components/entries/ChapterHeader.jsx`
- Tests: EntryCard chapter tests

**Interfaces:**
- When `getFlag('voiceChapters') && entry.transcription?.chapters?.length`: body renders per-chapter sections — `ChapterHeader` (title + `mm:ss` from startMs, cloud SectionLabel style) above each chapter's text slice (`text.slice(charStart, charEnd)`); else legacy paragraph render byte-identical.
- Per-chapter actions (overflow menu, 44px targets): **Rename** (inline input → updateDoc `{'transcription.chapters': next}`), **Merge with previous** (removes boundary: previous chapter's charEnd/title absorb; array shrinks), **Remove marker** (same as merge for interior; first chapter → drop header only). ALL writes touch only `transcription.chapters` (payload-exactness test); removing never deletes text/audio (PRD acceptance).
- Chapters degrade gracefully after text edit: if `charEnd > text.length` (edited entry), render falls back to unchaptered + a quiet "Chapters no longer match edited text" line; no crash (test).

- [ ] TDD: chaptered render slices exactly; actions produce exact updateDoc payloads; flag off/absent → legacy render; edited-text fallback.
- [ ] Green. Commit `chapters: EntryCard chapter sections — rename/merge/remove, metadata-only (flag: voiceChapters)`. **Batch R2-4 gate:** green → push. MICHAEL: Xcode build + device sanity for markChapter (existing files only).

---

### Task 16: Reflection artifacts + recipe engine

**Files:**
- Create: `src/services/reflections/recipeService.js`, `src/services/reflections/runRecipe.js`, `src/services/reflections/starterRecipes.js` + `__tests__/` for each
- Modify: `src/services/analysis/index.js` `getSmartChatContext` — additive `{returnIds}` option returning `{context, entryIds}`

**Interfaces:**
- Recipe doc (`recipes/{id}`, rules Task 7): `{name, questions: string[], scope: {spaceId}|null, timeRangeDays: 7|30|90|365, cadence:'manual', state:'active'|'archived', definitionVersion: 1++, createdAt, updatedAt}`. `createRecipe/updateRecipe (bumps definitionVersion)/archiveRecipe/subscribeRecipes(db, uid, cb, onError)`.
- `STARTER_RECIPES` (exact defs): **Monthly review** `['What changed for me this month?','What patterns kept showing up?','What do I want to carry into next month?']` timeRangeDays 30; **Goal progress** `['What progress did I make on the goals I mentioned?','Where did I get stuck, and what helped?']` 30; **Relationship check-in** `['How have my important relationships felt lately?','What moments with people stood out?']` 30; **Session preparation** `['What changed since my last session?','Which moments do I want to bring up?','What patterns came up, and what am I unsure about?','What open questions do I want to ask?']` 30.
- `previewRecipe(recipe, entries, exclusions)` — pure: `{entryCount, start, end, spaceName|'All spaces'}` (PRD: preview exactly what will be used before first run).
- `runRecipe(db, uid, recipe, {entries, embeddings})` → filters: `filterEntriesByScope` → date range → drop `getExcludedEntryIds` → per question: `askJournalAI(filtered, q, qEmbedding, recipe.scope)` with `getSmartChatContext(...,{returnIds:true})` → block `{id, type:'ai', question, text, sources: entryIds, editedByUser:false}` → writes `reflections/{id}`:
  ```js
  { kind:'recipe_run', recipeId, definitionVersion, scope, period:{start,end},
    title: `${recipe.name} — ${monthYear}`, blocks, status:'draft', createdAt, updatedAt }
  ```
- Editing invariants (service-level helpers `updateBlock/addUserBlock/removeBlock/reorderBlocks`): editing an AI block sets `editedByUser:true` (keeps `sources`); user blocks `type:'user', sources:[]`. Recipe edits never mutate prior reflections (PRD acceptance — test); recipe archive keeps reflections.
- Insight Budget/safety gates: recipe runs are user-initiated pulls (like Ask Journal), NOT proactive home insights — budget does not cap them; consent enforced server-side by `askJournalAI` callable (existing `assertAiConsent`).

- [ ] TDD: preview counts; run produces per-question blocks with real source ids; excluded/off-scope entries never in sources (adversarial); definitionVersion bump; prior-run immutability; block edit semantics.
- [ ] Green. Commit `reflections: recipe engine — scoped, receipt-carrying, editable runs (flag: reflectionRecipes)`.

### Task 17: Recipes UI

**Files:**
- Create: `src/components/reflections/RecipesScreen.jsx`, `src/components/reflections/ReflectionDraft.jsx` + tests
- Modify: `src/components/zen/AppLayout.jsx` + `src/pages/SettingsPage.jsx` (nav row "Reflection Recipes", flag `reflectionRecipes`)

**Interfaces:**
- `RecipesScreen` (PrivacyCenter template): starter-seed CTA when empty (writes STARTER_RECIPES), list (run/edit/archive), run → preview dialog (`previewRecipe` output + "Run" confirm) → progress state → opens `ReflectionDraft`.
- `ReflectionDraft`: renders blocks; AI blocks show a source-count chip → tapping opens the Task 11 `ReceiptSheet`-style source list (reuse a `SourceList` subcomponent extracted from ReceiptSheet); edit-in-place (sets editedByUser, visual "edited" tag), add-note (user block), remove, reorder; past runs listed per recipe; "AI-generated" vs "Your note" labels persistent (PRD trace-or-labeled acceptance).
- No export from recipes in v1 (Session Prep owns export).

- [ ] TDD: seed/list/run flow; preview gate before first run; draft editing semantics + labels; source chip opens list with correct entries; flag-off → nav absent.
- [ ] Green. Commit `reflections: Recipes screen + editable draft with source receipts`. **Batch R2-5 gate:** green → push.

---

### Task 18: Session Prep

**Files:**
- Create: `src/components/reflections/SessionPrepScreen.jsx` + test, `src/services/reflections/sessionPrep.js` + test
- Modify: `src/components/zen/AppLayout.jsx` + `src/pages/SettingsPage.jsx` (nav row "Session prep", flag `sessionPrep`), reuse `src/utils/pdf` loadJsPDF

**Interfaces:**
- Flow: choose since-date (explicit date field, default 14d back, stored on artifact — never inferred), scope (SpacePicker, default All), optional topics free-text → `buildSessionBrief(db, uid, {sinceDate, scope, topics, entries})` runs the Session-preparation starter questions (+ topics appended as an extra question when provided) via `runRecipe` internals → `reflections` doc `kind:'session_brief'` with sections as blocks: Changes since, Moments to bring up, Patterns (with caveats — missingness line auto-added from sample size), Open questions, My goals (user block, empty for user to fill).
- `regenerateSection(db, uid, briefId, blockId, ctx)` — re-runs ONE block's question; if target block `editedByUser`, requires explicit confirm; other blocks untouched (payload test).
- Export: "Export" → confirmation sheet with full content preview (foreground, explicit — PRD) → `composeSessionPrepPdf(brief, entriesById)` client-side jsPDF: sections with per-claim source dates as footnotes, "AI-generated" / "Your note" labels preserved in the doc + a metadata footer line; NEVER includes: `safety_flagged`/`has_warning_indicators` markers or labels, excluded-source entries, hidden content (test with adversarial fixture); removing a block before export removes its citations (test).
- Brief stays a private `reflections` doc until export; no share/background path.

- [ ] TDD: since-date/scope stored; sections generated with sources; regenerate-section isolation; export exclusions + label preservation + removed-claim citation removal; confirm-gated export.
- [ ] Green. Commit `reflections: Session Prep — evidence-backed editable brief + safe explicit export (flag: sessionPrep)`. **Batch R2-6 gate:** green → push.

---

### Task 19: Gentle Revisit — safety memo + server selection job

**Files:**
- Create: `docs/quality/gentle-revisit-safety.md`
- Create: `functions/src/revisit/selectRevisits.js` + `functions/src/revisit/__tests__/selectRevisits.test.js`; export scheduled fn from `functions/index.js`
- Create: `src/services/revisit/revisitService.js` + tests (prefs, exclusions client API)

**Interfaces:**
- **Safety memo** (BLOCKS flag-flip, not code): documents exclusion rules + rationale + the PRD open question (grief/trauma/crisis scenarios); lists the automated fixture set; explicit sign-off line for Michael. Rules codified in v1 selection (all non-negotiable):
  1. `safety_flagged == true` → never (100% fixture gate).
  2. `has_warning_indicators == true` → never.
  3. Entry created within ±3 days of ANY safety-flagged entry (crisis-window adjacency) → never.
  4. `analysis.mood_score < 0.4` or missing → never in v1 (conservative floor; positive mood is necessary-not-sufficient — all other rules still apply per PRD).
  5. Any `revisit_exclusions` match (entry/date/person/tag/space/family dims) → never.
  6. User not opted in (`settings/revisitPrefs.enabled !== true`) or server flag `gentleRevisit` off → job skips user entirely.
- `selectRevisitCandidate({entries, exclusions, recentQueue, now})` — PURE function (unit-testable): candidates 30–400 days old, applies rules 1–5, dedups vs last-60-day queue entryIds, prefers entries with entities/themes and mood ≥0.5, variety by month; returns one candidate or null (null is correct — no padding).
- Scheduled `gentleRevisitDaily` (`'every day 08:00'`, tz `America/Los_Angeles`, journalReminder iteration pattern): per opted-in user → idempotency marker `revisit.selectedFor{YYYY-MM-DD}` on the prefs doc (claimProcessingMarker pattern) → reads ≤200 candidate entries → writes ≤1 `revisit_queue` doc `{entryId, spaceId|null, selectedAt, dueDate:'YYYY-MM-DD', status:'queued', reason: 'A calm moment from {Month Year}' /* plain, non-clinical */}`. **No provider calls → no consent gate needed (documented in-code + memo); if a future version adds LLM framing, `isAiAllowed` becomes mandatory.**
- Client `revisitService`: `setRevisitEnabled(db,uid,bool)` (disable also deletes all `status=='queued'` docs — PRD: immediate cancel), `subscribeTodayRevisit`, `markShown/dismissRevisit`, `addRevisitExclusion(db,uid,{dimension,value,reason,permanent})`, `listRevisitExclusions`, `removeRevisitExclusion`.

- [ ] TDD (pure selector): each rule as its own test incl. safety-fixture 100% exclusion, adjacency window, dedup, null-when-nothing-qualifies; scheduled fn: skips non-opted-in, marker idempotency, ≤1/day; disable deletes queue.
- [ ] Green. Commit `revisit: safety-gated server selection (flag: gentleRevisit, OFF pending safety memo sign-off)`.

### Task 20: Gentle Revisit widget + controls

**Files:**
- Create: `src/components/zen/widgets/RevisitWidget.jsx` + test
- Create: `src/components/revisit/RevisitControls.jsx` + test
- Modify: `src/hooks/useDashboardLayout.js` (`WIDGET_DEFINITIONS.revisit`, `flags:['gentleRevisit']`, NOT in DEFAULT layout), `src/components/zen/widgets/index.js`, `WidgetDrawer` icons, `src/pages/SettingsPage.jsx` ("Gentle Revisit" row → opt-in toggle + Manage)

**Interfaces:**
- `RevisitWidget`: renders null unless `getFlag('gentleRevisit') && prefs.enabled && today's queued doc`. Card copy: `reason` line + Space chip + date ("A memory from March 2026") — **entry text NOT shown until "Show"** (preview-without-content, PRD). Actions: **Show** (reveal entry text inline, `markShown`), **Not now** (`dismissRevisit` — no exclusion), **Never show this entry** (confirm → `addRevisitExclusion({dimension:'entry', value:entryId, permanent:true})` + dismiss), **Less like this** (`{dimension:'family', value: topThemeOrEntity, permanent:false /*90d*/}` + dismiss — no explanation asked), **Manage** (opens RevisitControls). No streak/anniversary/guilt copy (assert-absence test).
- `RevisitControls` (PrivacyCenter template, also reachable from Settings): opt-in/out toggle (out → queue cleared), hidden dimensions manager (add hide-by Space/person/tag/date rows → `revisit_exclusions` with `reason:'hidden_dim'`), exclusion list with remove (restore).
- Onboarding: first toggle-on shows a one-time explainer sheet (what it does, what's excluded, how to stop) — the "explicit onboarding choice" (PRD P0 default-off).

- [ ] TDD: null states (flag/pref/queue); preview hides text pre-Show; each action's exact payload; disable clears; hide-dims write correct docs; copy assertions.
- [ ] Green. Commit `revisit: opt-in widget + controls, preview-first, suppression-backed`. **Batch R2-7 gate:** green → push. Flag stays OFF until memo sign-off.

---

### Task 21: Validation matrix, runbook, docs, status

**Files:**
- Modify: `src/__tests__/validationMatrix.test.js` — new R2 rows: (a) every generated Nexus insight carries a receipt; (b) excluded source never appears in regenerated insight sources/stats nor report readEntries; (c) Work-scoped companion context contains no Personal/unscoped Tier-2 entry and omits Tier-1; (d) offline-queued entry preserves spaceId through sync re-save; (e) revisit safety fixtures (incl. adjacency + low-mood) excluded 100%; (f) session-prep export contains no safety labels and drops removed-claim citations; (g) chapter metadata edits leave `text`/`rawTranscript`/`createdAt` byte-identical; (h) budget day-cap honored across a simulated midnight with live tick.
- Modify: `docs/quality/trustworthy-capture-runbook.md` — "R2 flags" section: each flag → exact rollback (off restores prior behavior), digest retirement note + manual delete command, relay scope note, chapters device-validation pointers.
- Modify: `CLAUDE.md` (one-paragraph R2 pointer: flags, key files, receipts invariant), `PROJECT_STATUS.md` (Active Work, decisions incl. the 8 proposed decisions once ratified, digest retirement in Recent Decisions).

- [ ] All rows green; docs written; status updated.
- [ ] Green. Commit `qa+docs: R2 validation rows, runbook flags/rollback, status`. **Batch R2-8 gate:** full green → push.

---

## Self-review notes (spec coverage)

- PRD §5.2 Control Center P0: receipts on every visible insight (T8 invariant + T9 reports) ✓; corrections/exclusions reversible + auditable (T10 delete-to-restore, append-style docs; history preserved) ✓; missingness before narrative (T11 layout) ✓; correction never rewrites sources (exclusion docs separate; entry text untouched) ✓; four distinct actions (T11) ✓. Acceptance: two taps to sources (T11) ✓; stale ≤10s (T10 immediate awaits) ✓; prior versions preserved (history cap test) ✓; no cross-space receipt leak (receipts built from already-scope-filtered inputs; T5 closes remaining seams) ✓. P1 activity log deferred.
- PRD §5.5 Voice Chapters P0: markers durable at tap (T13 IDB/sidecar) ✓; metadata never mutates raw + survives backgrounding/retry (T13 vault/op threading; T14 invariants) ✓; one-tap flow unchanged, controls optional (T13 flag-gated button) ✓; per-chapter correction — v1 = rename/merge/remove (text correction per chapter deferred with rationale: entry text edit flow already exists; chapter-scoped text editing adds an editing seam not needed for navigation value) — **partial, disclosed**. Acceptance: screen-lock preserves (at-tap persistence) ✓; retranscription same boundaries (markers durable; only retry-path retranscription exists) ✓; remove ≠ delete ✓; Ask-Journal chapter deep-link — DEFERRED (no entry deep-link infra; proposed decision 2) — disclosed.
- PRD §5.6 Recipes P0: starter templates (T16 exact texts) ✓; preview before first run (T16/T17) ✓; versioned definitions + reproducible prior outputs (definitionVersion + immutability tests) ✓; same provenance/scope/safety gates (scope filter + exclusions + server consent; budget n/a for pull surfaces — rationale documented) ✓. Acceptance: edit-not-mutate ✓; no auto-generation (manual cadence only in v1) ✓; trace-or-labeled ✓; delete keeps artifacts ✓.
- PRD §5.7 Gentle Revisit P0: default off + explicit onboarding (T20) ✓; safety-flagged excluded by default + positive-mood-is-not-safety (T19 rules 1–4) ✓; five controls (T20) ✓; no streaks/anniversary framing (copy tests) ✓; server-side selection respecting Spaces (T19 job + space hide-dim) ✓. Acceptance: hidden never returns via other path (single selection seam + exclusions checked in the pure selector) ✓; safety fixtures 100% (T19+T21e) ✓; no OS notification preview (in-app only, no notification code) ✓; off cancels queue (T19/T20) ✓.
- PRD §5.8 Session Prep P0: reuse export pathway + editable composition + receipts (T18 via recipes + jsPDF) ✓; user-vs-AI distinction preserved incl. export (T17/T18 labels) ✓; no safety flags/diagnoses/hidden entries in export (T18 tests) ✓; regenerate-section preserves edits (T18) ✓; explicit since-date + scope stored (T18) ✓. Acceptance: one-page default (jsPDF compose targets single page; length check in test) ✓; foreground-only export (client-side + confirm) ✓; removed claim removes citation ✓; regeneration honors exclusions (runRecipe drops excluded ids) ✓.
- Dependency-aware recompute: v1 = exclusion/space-change → immediate staleness fan-out + exclusion-honoring regeneration + preserved history (T10). Full dependency INDEX (per-artifact source graphs) deliberately not built — single-doc Nexus cache + on-demand reports make a graph premature; disclosed as scope decision. `enrichment.status:'stale'` stays inert (entry re-enrichment is a different pipeline; noted).
- R1 handoffs covered: offline spaceId (T1), widget drawer/merge (T3), budget drift + upcoming staleness (T2), space-id ticket wiring (T5), memory-graph/session-buffer/voice-relay scope (T5), targetAt (T2), scope-picker dedup + aria-modal (T4), digest/reports scoping + receipts (T9), futureMentions (T6), DailySummaryModal (T6).
- Type consistency: `receipt` shape identical T8/T11/T16; `source_exclusions` fields identical T7/T10/T11; `reflections` blocks identical T16/T17/T18; `revisit_exclusions` dims identical T7/T19/T20; `markers [{tMs}]` identical T13/T14; flag names identical T7/all consumers.
- Placeholder scan: no TBDs; every task lists exact files, signatures, and test intents.

## Human (Michael) checklist — accumulate during execution

- **Ratify/veto the 8 proposed product decisions** (top of doc) — especially digest retirement (1), chapters-without-audio (2), and reports-stay-all-spaces (3).
- After Batch R2-2 deploy: run `firebase functions:delete generateWeeklyDigests` once (CI won't auto-delete).
- After Batch R2-4: Xcode build + on-device markChapter sanity (existing Swift files only — no pbxproj change expected).
- **Gentle Revisit: read + sign off `docs/quality/gentle-revisit-safety.md` before EVER flipping `gentleRevisit`** (PRD safety gate). The flag also gates the server job.
- Flag flip order when ready: `insightReceipts` → `voiceChapters` → `reflectionRecipes` → `sessionPrep` → (after memo) `gentleRevisit`. Each independently rollback-able (runbook section).
- R1 pre-flag-on items still open from last plan: manual cold-start last-space check before `contextSpaces` (T1 closes the offline blocker).
