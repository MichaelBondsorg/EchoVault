# R1 Follow-Through Implementation Plan — Open Loops, Task Repair UX, Context Spaces v1, Insight Budget

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PRD R1 — useful follow-through without random tasks or nagging: Open Loops with an in-app due surface, one-tap task repair (Captured row, suggestion tray), Context Spaces v1 as enforced retrieval scopes, and Insight Budget (fewer, novel, confident insights) — all behind default-off flags.

**Architecture:** Everything builds on the shipped 0B intent system (`functions/src/intents/*`, `src/services/intents/intentClient.js`). Open Loops are `kind: 'open_loop'` intents (already extracted + persisted, never surfaced). Task repair extends client-mutable intent keys + a new suggested-state subscriber. Context Spaces add a `spaceId` field on entries plus filters at every retrieval seam (client-side retrieval is authoritative for Ask Journal — the callable receives pre-assembled context). Insight Budget is a client-side gate over the Nexus insight surfaces backed by a `settings/insightBudget` doc.

**Tech Stack:** React 18 + Vite 5, Firebase (Firestore + Functions Node 22), Vitest 3, cloud design system (`src/components/cloud/`), Capacitor 8.

**Source spec:** `Engram_Trustworthy_Intelligence_PRD.docx` §5.1 (Open Loops), §3 (intent system/post-save UX), §5.3 (Context Spaces), §5.9 (Insight Budget), §7 (shared objects), §8 (gates). Foundations plan: `2026-07-20-trustworthy-capture-and-intelligence.md`.

## Product decisions (made by Michael, 2026-07-20)

1. **Task auto-activation:** policy-qualified explicit tasks auto-activate by default with a non-blocking "Captured" row + Undo. No onboarding gate.
2. **Space default for new captures:** unscoped; once a user explicitly selects a Space the capture pill remembers the last explicit selection (owner-scoped). New users can ignore Spaces entirely.

Derived decisions (this plan):
- **Ask Journal scope default:** users with no Spaces → All (today's behavior, zero UI change). Users with ≥1 Space → default to last-used capture Space, "All spaces" is an explicit selector choice.
- **Scoped retrieval is strict:** a query scoped to Space X includes ONLY entries with `spaceId == X` (unscoped entries excluded). "All"/no-scope = no filter (legacy behavior).
- **Server recent-context scoping:** orchestrator recent-context filters to the analyzed entry's `spaceId` when set; unscoped entries keep legacy unfiltered context.
- **Digest/reports stay cross-space in R1** (documented limitation; they get receipts + scope treatment in R2). Automated scope-leak gates cover interactive retrieval paths.
- **Open Loops v1 is in-app only.** No notifications of any kind (no local-notification infra exists; iOS lacks push entitlement). `authorization.notifications` stays false everywhere; the field is future groundwork.

## Global Constraints

- Pushes to `main` auto-deploy (hosting always; functions/rules on path changes). **Never push a non-green batch**: `npm test`, `npm run typecheck`, `npm run build` locally; `npm run test:rules` runs in CI (no local Java) and blocks deploy — flag rules-heavy batches accordingly.
- New behavior ships behind default-off flags: `openLoops`, `contextSpaces`, `insightBudget` (all client + server where relevant). `intentExtraction` remains the master gate for intent-driven UI.
- Model confidence alone never activates an intent; no guilt copy, streaks, escalating reminders, or "overdue" language anywhere in R1 UI.
- Raw source history immutable: `sourceSpan`, entry text/timestamps never mutated by repair actions. User edits live in separate client-mutable keys.
- Client may only mutate intent keys listed in `CLIENT_MUTABLE_KEYS` (schema + rules stay mirrored).
- No new npm dependencies. New UI uses `src/components/cloud/` primitives (`Chip`, `Card`, `Drawer`, `SectionLabel`) — NOT legacy `src/components/ui/`. Copy is inline English literals.
- "Category" (work/personal, `uiStore`) is a different axis from Context Spaces — never overload it.
- Max 3 due loops on the home surface; "No new insight" = absence of a card, never an empty-state nag.
- Operational logs: no journal text/transcripts. `user_decisions` are append-only.

## Ground truth (from 4 exploration agents, HEAD ff2b452)

- **Intent doc** (`functions/src/intents/intentSchema.js`): `{id, ownerId, entryId, kind, state, sourceSpan{start,end,text}, attributes{10 booleans}, confidence, activationReason, targetAt|null, authorization{notifications:false}, inputVersion, versions{extraction,model,prompt,schema}, createdAt, updatedAt, decidedBy}` at `artifacts/{APP}/users/{uid}/intents/{id}`. Kinds incl. `open_loop`; states `active|suggested|abstain|dismissed|completed_state|superseded`. `CLIENT_MUTABLE_KEYS = ['state','updatedAt','authorization']`; transitions: `→dismissed` always, `suggested→active`, `active→completed_state`, `from==to`. Deterministic ids `sha1(entryId:spanStart:kind).slice(0,20)`; orphan reap retires audited stale docs to `superseded`, deletes unaudited; dedup marker `processing.intentsExtractedForVersion`.
- **Extraction** (`extractIntents.js`): invoked from orchestrator (`orchestrator.js:219-235`) behind server flag `intentExtraction`; open_loops ARE written with `targetAt` but filtered out of legacy `extracted_tasks` (task-only) and out of `subscribeActiveTaskIntents` (kind=='task'). **Resurrection risk: re-extraction at a new `inputVersion` rewrites the same deterministic id and could overwrite a dismissed state — must be fixed in this plan (Task 1).**
- **intentClient** (`src/services/intents/intentClient.js`): `subscribeActiveTaskIntents(db,uid,cb,onError)` (kind==task, state==active, orderBy createdAt desc, limit 20), `keepIntent` (defined, unconsumed), `dismissIntent(db,uid,id,reasonCode)`, `completeIntent`, private `appendDecision`. Rules: intents update `hasOnly(['state','updatedAt','authorization'])` + transition check; `user_decisions` create-only, `action in ['kept','dismissed','not_a_task','completed']`, `reversible==true`.
- **Temporal**: `futureMentions` written post-save by `enrichmentRunner.js` (shape `{targetDate: Timestamp, event, sentiment, phrase, confidence, isRecurring, recurringPattern}`) but has NO live consumers (dashboard-prompt reader is dead code). Open Loops replace this flow; futureMentions keep being written (harmless) until removed in R2.
- **Notifications**: FCM push for a generic hourly `journalReminder` only; NO LocalNotifications pkg; iOS missing `aps-environment` entitlement + `remote-notification` background mode. `settings/notifications` doc has `{enabled, journalRemindersEnabled, timezone, reminderHour, lastReminderSentAt}`.
- **Ask Journal retrieval is client-side**: `askJournalAI` callable (`functions/index.js:766`) receives an `entriesContext` string. Retrieval seams: `getSmartChatContext` (`src/services/analysis/index.js:296`, callers `:433`), `getCompanionContext` (`src/services/rag/companionContext.js:148`, existing category filter at `:167-170`), prompt services (`contextPrompts.js:407-408`, `prompts/index.js:475-479`), nexus `fetchRecentEntries` (`src/services/nexus/orchestrator.js:259-272`). Server seams: orchestrator `buildRecentContext` (`functions/src/analysis/orchestrator.js:54-75`), digest (`functions/index.js:4070`), reports (`functions/src/reports/scheduler.js:28`).
- **embeddingV2** written (flag `model.embeddingWriteV2`) but unread; `scoreSameSpace` (`functions/src/ai/embeddingV2.js:102`) throws on cross-space comparison. Client similarity still uses v1 `e.embedding`. (v2 read cutover stays a separate flag flip — NOT bundled into R1.)
- **Entry create sites** for `spaceId`: client `buildCoreEntry` (`src/services/entries/buildCoreEntry.js:96`, conditional like `category`); server `buildBackgroundCoreEntry` (`functions/src/capture/onAudioUploaded.js:59-85`, via GCS custom metadata like `captured-at`).
- **UI**: live design system `src/components/cloud/` (`Chip` = pill w/ `selected` variant). Capture = `EntryBar.jsx` (mode machine; prompt-banner slot at 413-417 is the pill precedent; draft autosave via `draftAutosave.js` keyed `(prefix, ownerUid)`). Home = `HomePage.jsx` → `BentoGrid` + registry `src/components/zen/widgets/index.js` (`WIDGET_COMPONENTS`, default layout in `useDashboardLayout.js:90` = hero→prompt→stats→heatmap→recent). Entry card = `src/components/entries/EntryCard.jsx` (suggestion tray inserts after body ~:697, before `ProvenanceDisclosure` :779; `extracted_tasks` block :700-778 is the structural precedent; `DetectedStrip.jsx` is the confirm/dismiss pattern but uses legacy palette). Ask Journal = `UnifiedConversation.jsx` (header 990-1038 for scope chip; context via `getCompanionContext`, `category` prop + `filteredEntries` from `AppLayout.jsx:496`). Settings = `SettingsPage.jsx` ("AI & Privacy" items ~183-221) using cloud primitives; `PrivacyCenter.jsx` (53-line overlay) is the full-screen manager template, wired via AppLayout like `onOpenPrivacy`.
- **Insight surfaces**: home = `NexusInsightsWidget` (top-2 via `useNexusInsights`); page = `InsightsPage.jsx`; per-entry popup = `EntryInsightsPopup` (exempt from budget — it's post-save reflection, not a proactive surface). Nexus dedup exists: `isDuplicateInsight` (`nexus/orchestrator.js:1048`, Jaccard + theme). Feedback suppression via `insightLearning` + `feedbackLearning.js`. Settings docs pattern: `artifacts/{APP}/users/{uid}/settings/{id}`; rules `firestore.rules:94-113` allow owner writes except `subscription`/`consent` — new settings docs need explicit shape clauses only if we want them.
- **Eval suite** (`functions/src/intents/__evals__/`): fixtures `{id, category, hardNegative, expectedState, text, candidate{kind, attributes(true-only), confidence, targetAt?, explicitCommand?}}`; test asserts ≥60 fixtures, ≥30 hard negatives, zero active misfires, precision/recall 1.0.

## Execution model

Work directly on `main`. Push batches, each ending with the full green gate + push. One agent per file-conflict boundary; `App.jsx`/`AppLayout.jsx` serialized. Batches:

- **Batch R1-1 (Tasks 1–3):** intent schema/rules extensions, dismissal-preservation fix, flags, spaces + settings rules, indexes. Server-heavy; rules verified in CI.
- **Batch R1-2 (Tasks 4–7):** Open Loops + task repair UX (client): intentClient extensions, OpenLoopsWidget, EntryCard suggestion tray, Captured row.
- **Batch R1-3 (Tasks 8–11):** Context Spaces v1: spaces service, capture pill + entry re-scoping, retrieval filters (client + server), Ask Journal scope UI + Space management screen.
- **Batch R1-4 (Tasks 12–14):** Insight Budget + eval additions + scope-leak validation tests + runbook/docs.

---

### Task 1: Intent schema extensions + dismissal preservation (server)

**Files:**
- Modify: `functions/src/intents/intentSchema.js`
- Modify: `functions/src/intents/extractIntents.js`
- Modify: `functions/src/intents/__tests__/intentSchema.test.js`, `functions/src/intents/__tests__/extractIntents.test.js`

**Interfaces:**
- `CLIENT_MUTABLE_KEYS` becomes `['state','updatedAt','authorization','snoozedUntil','outcome','userText']`.
  - `snoozedUntil`: ISO string | null — client sets to defer a due loop (state stays `active`).
  - `outcome`: `{closedAt: ISO, kind: 'answered'|'closed', answerEntryId: string|null}` | null — set when closing a loop; never touches the source entry.
  - `userText`: string | null — display override for repair/edit; `sourceSpan` stays immutable evidence.
- `DECISION_ACTIONS` becomes `['kept','dismissed','not_a_task','completed','snoozed','answered','closed']`.
- `buildIntent` gains optional params `snoozedUntil=null, outcome=null, userText=null` (all validated: snoozedUntil ISO-or-null; outcome shape-or-null; userText string-or-null).
- `isClientTransitionAllowed` unchanged (existing transitions cover keep/dismiss/complete/snooze-in-place).
- **Dismissal preservation** in `extractIntents.js`: before writing a candidate, if a doc with the same deterministic id exists with `state in ('dismissed','completed_state')` OR has any `user_decisions` referencing it with action `not_a_task`/`dismissed`, the extractor MUST NOT overwrite `state`/user fields — it only bumps `inputVersion`/`updatedAt` (merge) so the reaper never treats it as stale. A dismissed loop/task can only return if the user explicitly restores it.

- [ ] Write failing tests: schema accepts/validates the 3 new keys + new decision actions; extraction re-run at new inputVersion over an existing `dismissed` doc preserves `state:'dismissed'` and user keys; reap does not delete/supersede the preserved doc; active docs still update normally.
- [ ] Implement schema + extractor changes (read existing intent docs for the entry once — the reap query already fetches `where entryId==` — reuse that read for the preservation check; no extra round-trips).
- [ ] Root suite green. Commit `intents: client-mutable snooze/outcome/userText; dismissals survive re-extraction`.

### Task 2: Rules + indexes for R1 collections

**Files:**
- Modify: `firestore.rules` (intents update keys; user_decisions actions; new `spaces` collection; `settings/insightBudget` + `settings/spacePrefs` shape)
- Modify: `firestore.indexes.json`
- Modify: `functions/src/__tests__/firestoreRules.test.js`

**Interfaces:**
- Intents update rule: `affectedKeys().hasOnly(['state','updatedAt','authorization','snoozedUntil','outcome','userText'])` + existing transition check.
- `user_decisions` create rule: `action in ['kept','dismissed','not_a_task','completed','snoozed','answered','closed']`.
- New `match /spaces/{spaceId}`: owner read/create/update with `keys().hasOnly(['name','state','createdAt','updatedAt'])`, `name is string && name.size() <= 40`, `state in ['active','archived']`. **No client delete** (deletion flow archives or moves via Task 8's client service using update; hard delete is not offered in v1 — "Space deletion" = archive + optional bulk move, so journal content can never be silently deleted).
- `settings/insightBudget` write clause: `data.keys().hasOnly(['mode','updatedAt']) && data.mode in ['quiet','balanced','exploratory']`.
- `settings/spacePrefs` write clause: `data.keys().hasOnly(['lastCaptureSpaceId','updatedAt'])` (`lastCaptureSpaceId` string or null).
- Indexes: intents `(kind ASC, state ASC, targetAt ASC)` for the due-loop query; intents `(entryId ASC, state ASC)` for the per-entry suggestion tray; entries `(spaceId ASC, createdAt DESC)` for server scoped queries.

- [ ] Extend rules tests: client can set snooze/outcome/userText on own intent within allowed transitions; cannot touch `sourceSpan`/`attributes`/`confidence`; new decision actions accepted, junk rejected; spaces shape enforced, cross-user denied, client delete denied; both settings docs shape-validated.
- [ ] Update rules + indexes. Root suite green locally (rules suite runs in CI). Commit `rules: R1 intents repair keys, spaces, insight-budget + space-prefs settings, indexes`.

### Task 3: R1 feature flags

**Files:**
- Modify: `src/config/flags.js`, `functions/src/shared/flags.js` defaults if mirrored there, `src/config/__tests__/flags.test.js`

- [ ] Add `openLoops: false`, `contextSpaces: false`, `insightBudget: false` to `FLAG_DEFAULTS`; test defaults. Commit `infra: R1 feature flags (openLoops, contextSpaces, insightBudget)`. **Batch R1-1 gate:** `npm test` + `npm run typecheck` + `npm run build` green → push (CI runs rules suite and blocks deploy on failure).

---

### Task 4: intentClient extensions for loops + suggestions

**Files:**
- Modify: `src/services/intents/intentClient.js`, `src/services/intents/__tests__/intentClient.test.js`

**Interfaces (all follow existing `subscribeActiveTaskIntents` / `appendDecision` patterns):**
- `subscribeDueOpenLoops(db, uid, cb, onError)` — query `kind=='open_loop' && state=='active' && targetAt <= now` orderBy `targetAt asc` limit 20; cb receives docs with client-side filter dropping `snoozedUntil > now`. (`now` = ISO at subscribe time; widget resubscribes on mount/foreground.)
- `subscribeUpcomingOpenLoops(db, uid, cb, onError)` — same but `targetAt > now`, orderBy asc, limit 20 (full-queue view).
- `subscribeSuggestedIntentsForEntry(db, uid, entryId, cb, onError)` — query `entryId==X && state=='suggested'` (no orderBy; tiny result set).
- `snoozeLoop(db, uid, id, untilIso)` — `updateDoc {snoozedUntil: untilIso, updatedAt}` + decision `snoozed`.
- `answerLoop(db, uid, id, answerEntryId=null)` — `updateDoc {state:'completed_state', outcome:{closedAt, kind:'answered', answerEntryId}, updatedAt}` + decision `answered`.
- `closeLoop(db, uid, id)` — same with `kind:'closed'`, decision `closed`.
- `setIntentUserText(db, uid, id, text)` — `updateDoc {userText, updatedAt}` (no decision).
- `restoreIntent(db, uid, id)` — `updateDoc {state:'active', updatedAt}` + decision `kept` (explicit user restore of a dismissed item; allowed by `→dismissed`? NO — transition `dismissed→active` is NOT allowed by rules. Restore v1 = re-keep from the suggestion tray only for `suggested`; dismissed items stay dismissed. Do NOT implement restoreIntent — omit it and keep dismissal final in v1, matching "decision retained".)

- [ ] TDD each helper with mocked Firestore (mirror existing test file's mock pattern); assert exact query constraints and written payloads; assert `answerLoop` writes never touch the source entry.
- [ ] Green. Commit `intents: client subscriptions + lifecycle helpers for open loops and suggestions`.

### Task 5: OpenLoopsWidget (due surface, max 3)

**Files:**
- Create: `src/components/zen/widgets/OpenLoopsWidget.jsx`, `src/components/zen/widgets/__tests__/OpenLoopsWidget.test.jsx`
- Modify: `src/components/zen/widgets/index.js` (register `openloops`), `src/hooks/useDashboardLayout.js` (add to `DEFAULT_DASHBOARD_LAYOUT` after `prompt` — but ONLY rendered when flags on; widget returns null when `!getFlag('openLoops') || !getFlag('intentExtraction')`)

**Interfaces:**
- Mirrors TasksWidget structure: GlassCard `2x1`, subscribes via `subscribeDueOpenLoops`. Shows max 3 due loops (`.slice(0,3)`), each row: display text (`userText || sourceSpan.text`), due phrasing ("since Friday" — plain, no guilt copy), actions: **Answer** (opens EntryComposer via existing capture flow with a `loopContext` prefill prop; on entry save calls `answerLoop(..., savedEntryId)`), **Snooze** (menu: tonight/tomorrow/next week → `snoozeLoop`), **Close** (`closeLoop`), **Dismiss** X (`dismissIntent`, aria "Don't revisit").
- Footer "+N upcoming" when `subscribeUpcomingOpenLoops` has items → expands inline list (read-only rows + dismiss).
- Empty state: renders nothing (returns null) when no due loops — absence is correct, no placeholder card.

- [ ] TDD: renders max 3; snooze hides row; flag-off renders null; answer wires savedEntryId through; no "overdue"/guilt strings (assert copy).
- [ ] For the Answer→capture wiring: add optional `initialContext` prop threading through `EntryComposer` (small, isolated edit) so the composer opens with a quiet one-line context chip ("Following up: {loop text}"); the entry itself saves normally.
- [ ] Green. Commit `loops: OpenLoopsWidget — due surface (max 3), answer/snooze/close, in-app only`.

### Task 6: EntryCard suggestion tray ("Possible task" / "Revisit this?")

**Files:**
- Create: `src/components/entries/IntentSuggestionTray.jsx` + `__tests__/IntentSuggestionTray.test.jsx`
- Modify: `src/components/entries/EntryCard.jsx` (mount after body text ~:697, before `ProvenanceDisclosure`)

**Interfaces:**
- `<IntentSuggestionTray entryId={entry.id} />` — gates on `getFlag('intentExtraction')` (tray shows for both task + loop suggestions regardless of `openLoops` flag; loop suggestions additionally gated on `openLoops`). Subscribes `subscribeSuggestedIntentsForEntry`. Per suggestion, compact row using cloud `Chip` + text: label "Possible task" (kind task) / "Revisit this?" (kind open_loop), display text, actions: **Keep** (`keepIntent` → suggested→active), **Edit** (inline text input → `setIntentUserText` then `keepIntent`), **No thanks** (`dismissIntent`). Renders null when empty. Never appears in widgets/reports — this component is the ONLY suggested-state surface.

- [ ] TDD: rows per state/kind; Keep/Edit/No-thanks call the right helpers; null when no suggestions or flag off.
- [ ] Green. Commit `intents: per-entry suggestion tray — suggested state surfaces only on the source entry`.

### Task 7: "Captured" row (post-save confirmation with Undo)

**Files:**
- Create: `src/components/capture/CapturedToast.jsx` + `__tests__/CapturedToast.test.jsx`
- Modify: `src/components/zen/AppLayout.jsx` (mount near `CompanionNudge`)

**Interfaces:**
- Listens (when `intentExtraction` flag on) to newest intents `where state=='active'`, orderBy `createdAt desc`, limit 5, via a thin `subscribeRecentActiveIntents(db, uid, cb, onError)` added to intentClient (same pattern as others; include in Task 4's file if convenient — keep one commit per task regardless).
- Shows a non-modal bottom row (cloud Card, auto-dismiss 6s) only for intents with `createdAt` after component mount (session-new): "Captured: {text}" + **Undo** (`dismissIntent`) + **Edit** (inline → `setIntentUserText`). One at a time; queue if multiple. Never a modal; never blocks capture.
- Session-seen ids kept in a ref to avoid re-showing on snapshot refires.

- [ ] TDD: only session-new intents toast; Undo dismisses; auto-dismiss; flag-off renders null.
- [ ] Green. Commit `intents: non-blocking Captured row with Undo/Edit`. **Batch R1-2 gate:** full local green → push.

---

### Task 8: Spaces service (client CRUD + starter spaces + prefs)

**Files:**
- Create: `src/services/spaces/spacesService.js` + `__tests__/spacesService.test.js`

**Interfaces:**
- Collection `artifacts/{APP}/users/{uid}/spaces/{spaceId}` (auto-id docs `{name, state:'active'|'archived', createdAt, updatedAt}`).
- `subscribeSpaces(db, uid, cb, onError)` — active spaces, orderBy name.
- `createSpace(db, uid, name)` / `renameSpace(db, uid, id, name)` / `archiveSpace(db, uid, id)`.
- `seedStarterSpaces(db, uid)` — creates Personal/Work/Family/Health ONLY when the user first opens Space management AND has zero spaces (never automatic on login).
- `reassignEntriesSpace(db, uid, fromSpaceId, toSpaceIdOrNull, {batchSize=200})` — batched `updateDoc` over `entries where spaceId==from`, sets `spaceId: to` (null = Keep unscoped). Used by archive flow: UI offers **Move entries** / **Keep unscoped** / **Cancel**; journal content is never deleted. Asserts entry `createdAt/effectiveDate/transcription` untouched (only `spaceId` in the update payload).
- `getLastCaptureSpaceId(db, uid)` / `setLastCaptureSpaceId(db, uid, spaceIdOrNull)` — `settings/spacePrefs` doc.

- [ ] TDD all helpers (mocked Firestore); reassign test asserts payload is exactly `{spaceId, updatedAt}`.
- [ ] Green. Commit `spaces: client service — CRUD, starter seed, archive flow with entry reassignment`.

### Task 9: spaceId on entries + capture pill + entry re-scoping

**Files:**
- Modify: `src/services/entries/buildCoreEntry.js` (+ its test) — conditional `spaceId` next to `category` (`:96`): included only when a non-null spaceId is passed.
- Modify: `src/App.jsx` — thread `captureSpaceId` state (initialized from `getLastCaptureSpaceId` when `contextSpaces` flag on) into `doSaveEntry`/`buildCoreEntry` calls and `EntryBar`/`EntryComposer` props.
- Modify: `src/components/dashboard/EntryBar.jsx` — Space pill (cloud `Chip`) in the typing-mode header region (next to the prompt banner slot ~:413) and recording/idle header: shows current Space name or nothing when unscoped; tap → small popover listing active spaces + "No space"; explicit selection calls `setLastCaptureSpaceId`. Flag-gated: `getFlag('contextSpaces')` else renders nothing.
- Modify: `src/components/entries/EntryCard.jsx` — Space chip in header row 2 (tags row ~:398): displays entry's Space; tap → same popover → `updateDoc {spaceId}` on the entry. Changing Space never alters `createdAt/effectiveDate/transcription` (assert in test).
- Modify: `functions/src/capture/onAudioUploaded.js` (+ test) — accept optional `space-id` GCS custom metadata → `spaceId` on the background core entry (same conditional pattern as `captured-at`); client ticket path passes it when flag on.
- Tests: extend `buildCoreEntry.test.js`, EntryBar/EntryCard tests, onAudioUploaded test.

- [ ] TDD buildCoreEntry conditional; UI tests for pill render/selection/persistence; card re-scope payload exactness; background metadata passthrough.
- [ ] Green. Commit `spaces: spaceId on entries — capture pill, card re-scoping, background-upload passthrough (flag: contextSpaces)`.

### Task 10: Retrieval scope filters (client + server)

**Files:**
- Create: `src/services/spaces/scopeFilter.js` + test — `filterEntriesByScope(entries, scope)` where `scope = {spaceId: string} | null`; null → identity; spaceId → strict `e.spaceId === spaceId`.
- Modify: `src/services/analysis/index.js` — `askJournalAI(entries, question, questionEmbedding, scope=null)` and `getSmartChatContext(..., scope)` apply `filterEntriesByScope` FIRST (before semantic/tag/recent selection).
- Modify: `src/services/rag/companionContext.js:167-170` — `filteredEntries` applies scope after the category filter (both compose).
- Modify: `src/services/prompts/contextPrompts.js:407-408` + `src/services/prompts/index.js:475-479` — same compose.
- Modify: `src/services/nexus/orchestrator.js` `fetchRecentEntries` — accepts optional scope; `useNexusInsights` passes null in R1 (nexus stays all-spaces until R2 receipts; documented).
- Modify: `functions/src/analysis/orchestrator.js` `buildRecentContext` — when the analyzed entry has `spaceId` AND server flag `contextSpaces` on: `col.where('spaceId','==',entry.spaceId).orderBy('createdAt','desc').limit(15)`; else legacy query. (Index from Task 2.)
- Tests: scope-filter unit tests + one adversarial test per seam: a Work-scoped call over a mixed corpus never returns/embeds a Personal-space or unscoped entry (assert candidate ids), and null scope preserves legacy behavior byte-for-byte.

- [ ] TDD scopeFilter; wire each seam with its adversarial test; extend orchestrator test for the scoped recent-context branch.
- [ ] Green. Commit `spaces: strict scope filters at every retrieval seam (flag: contextSpaces)`.

### Task 11: Ask Journal scope UI + Space management screen

**Files:**
- Modify: `src/components/chat/UnifiedConversation.jsx` — scope chip in the header (~:1013 area): shows active scope ("Work" / "All spaces"); tap → selector (active spaces + "All spaces" explicit row). Default per plan decisions: no spaces → All (chip hidden entirely); has spaces → last capture Space. Selected scope threads into `getCompanionContext`/`getSmartChatContext` calls as `scope`. Persistent label satisfies "every answer visibly states its Space".
- Create: `src/components/spaces/SpaceManager.jsx` (+ test) — full-screen overlay modeled on `PrivacyCenter.jsx`: list active spaces (rename inline), "New space", archive flow with the 3-option sheet (Move entries → picker / Keep unscoped / Cancel) calling `reassignEntriesSpace`, starter-seed CTA when empty (`seedStarterSpaces`).
- Modify: `src/components/zen/AppLayout.jsx` + `src/pages/SettingsPage.jsx` — "Context Spaces" nav row (flag-gated) in the App group wiring `showSpaceManager` like `onOpenPrivacy`.

- [ ] TDD SpaceManager flows (archive never deletes entries; cancel is a no-op); UnifiedConversation scope-chip tests (hidden without spaces; explicit All row; scope passed to context calls).
- [ ] Green. Commit `spaces: Ask Journal scope selector + Space management screen`. **Batch R1-3 gate:** full local green → push.

---

### Task 12: Insight Budget service + gates

**Files:**
- Create: `src/services/insights/insightBudget.js` + `__tests__/insightBudget.test.js`
- Modify: `src/hooks/useNexusInsights.js` (apply gate), `src/services/nexus/orchestrator.js` (pass insight history to the dedup window)

**Interfaces:**
- `getBudgetConfig(mode)` → `{maxHomePerDay, maxHomePerWeek}`: quiet `{1, 4}`, balanced `{2, 8}`, exploratory `{4, 20}`. Plain-language mode copy lives in Task 13's UI, not here.
- `readBudgetMode(db, uid)` / `setBudgetMode(db, uid, mode)` — `settings/insightBudget` doc; missing doc → `'balanced'`.
- `applyInsightBudget(insights, {mode, shownLog, now})` — pure: (1) drops near-duplicates vs a 90-day `shownLog` using the existing `isDuplicateInsight` similarity (import from nexus orchestrator; threshold unchanged); (2) sorts by evidence/confidence fields already present on nexus insights (confidence desc, then recency); (3) caps to remaining day/week allowance computed from `shownLog`. NEVER pads: if zero qualify, returns `[]` (widget renders nothing — absence of a card).
- `recordShownInsights(db, uid, insights)` — appends `{id, theme, title, shownAt}` (no content bodies) to `settings/insightBudget` doc's `shownLog` array (pruned to 90 days, cap 200 entries).
- `useNexusInsights` — when `insightBudget` flag on: pipe cached/generated insights through `applyInsightBudget` and record what's shown; flag off → unchanged. Dismissed-family suppression already exists via `insightLearning` and continues to apply before the budget (order: feedback suppression → dedup → cap).

- [ ] TDD: caps enforced per mode; empty result when nothing qualifies even with quota available (never lowers gates to fill); 90-day near-dup suppression; flag-off passthrough; shownLog pruning.
- [ ] Green. Commit `insights: budget gate — Quiet/Balanced/Exploratory caps + 90-day novelty (flag: insightBudget)`.

### Task 13: Insight Budget settings UI

**Files:**
- Modify: `src/pages/SettingsPage.jsx` — "Insight frequency" row in the AI & Privacy group (flag-gated): 3-way cloud `Chip selected` segment — Quiet ("Only the clearest, rarest insights"), Balanced ("A few well-supported insights — the default"), Exploratory ("More ideas, including tentative ones"). Writes via `setBudgetMode`. No model/token language.
- Test: settings interaction test.

- [ ] TDD; green. Commit `insights: budget mode selector in Settings`.

### Task 14: Eval additions, validation tests, docs

**Files:**
- Modify: `functions/src/intents/__evals__/fixtures.json` — add open-loop-focused fixtures: "Ask me tomorrow how the meeting went" (expected active open_loop, targetAt), "I have a meeting tomorrow" (abstain — already present as hard negative; verify), "Remind me to check how Sam's surgery went" (active open_loop), "I'm nervous about the interview Friday" (suggested open_loop at most), snoozed/quoted/conditional loop negatives. Keep zero-active-misfire + precision 1.0 assertions passing.
- Modify: `src/__tests__/validationMatrix.test.js` — add R1 rows: dismissed loop does not reappear after re-extraction (uses Task 1 modules); Work-scoped question retrieves zero Personal candidates (scopeFilter + smartChatContext); Space change alters only `spaceId`; budget cap never exceeded across a simulated day; closing a loop leaves source entry untouched.
- Modify: `docs/quality/trustworthy-capture-runbook.md` — R1 flags rollback section (each flag → off restores exactly today's behavior), new indexes note, spaces archive-flow support notes.
- Modify: `CLAUDE.md` — one-paragraph R1 pointer (flags, key files). `PROJECT_STATUS.md` — Active Work + decisions (auto-activate; unscoped+remember-last; in-app-only loops; digest cross-space limitation).

- [ ] Fixtures + tests green (eval invariants intact); docs written.
- [ ] Green. Commit `qa+docs: R1 eval fixtures, validation rows, runbook/status updates`. **Batch R1-4 gate:** full local green → push.

---

## Self-review notes (spec coverage)

- PRD §5.1 Open Loops P0: separate kind in schema (0B done) ✓; source/evidence/target/state/activationReason/authorization fields (0B) ✓; never notify from suggested — v1 never notifies at all ✓; max 3 due on home (Task 5) ✓; Delete/Exclude without deleting source (dismiss/close, Tasks 4–5) ✓. Acceptance: meeting-tomorrow no-loop (eval) ✓; ask-me-tomorrow one editable loop (eval + tray) ✓; dismissed never reappears via reprocessing (Task 1) ✓; closing adds outcome without touching entry (Task 4 test) ✓. P1 (waiting-for-someone loops, preference learning) deferred.
- PRD §3 post-save UX: Captured row + Undo (Task 7) ✓; Possible task/Revisit tray with Keep/Edit/No thanks (Task 6) ✓; silence when nothing clear (all surfaces render null) ✓.
- PRD §5.3 Context Spaces P0: starter + user spaces (Task 8) ✓; enforce filters before retrieval/prompt construction (Task 10 — server-side where retrieval is server-side; Ask Journal retrieval is architecturally client-side, filter applied at the single context-assembly seam; documented) ✓; active scope shown persistently (Task 11) ✓; deletion flow Move/Keep-unscoped/Cancel without deleting content (Tasks 2+8+11, archive-based) ✓; Space change invalidating embeddings — N/A in v1 (vectors don't encode space; filter is at query time; noted in runbook) ✓ with rationale. Acceptance: Work-scoped never retrieves Personal (Task 10+14 adversarial tests) ✓; answers state their Space (Task 11) ✓; Space change preserves createdAt/effectiveDate/raw (Tasks 8–9 tests) ✓; new users unaffected (defaults + flags) ✓. Report generation scope deferred to R2 (documented limitation).
- PRD §5.9 Insight Budget P0: three modes plain-language (Task 13) ✓; rank by evidence/confidence/novelty/feedback (Task 12; relevance ranking beyond confidence deferred to R2 receipts) ✓; hard ceilings + semantic dedup (Task 12) ✓; never lower gates for quota (test) ✓; dismissed families reduce ranking (existing insightLearning, ordered before budget) ✓. 90-day near-dup window ✓. Topic budgets / withheld-explanations = P1 deferred (Control Center, R2).
- Type consistency: `snoozedUntil/outcome/userText` names identical across schema (Task 1), rules (Task 2), client (Task 4), tests. `scope = {spaceId}|null` consistent across Tasks 10–11. Decision actions consistent Tasks 1/2/4.
- Placeholder scan: no TBDs; every task lists exact files, signatures, and test intents.

## Human (Michael) checklist — accumulate during execution

- Flip flags in `config/flags` when ready to try: `intentExtraction` (prerequisite), then `openLoops`, `contextSpaces`, `insightBudget`.
- Deploy composite indexes: `firebase deploy --only firestore:indexes` runs via CI on push? (indexes deploy with rules workflow — verify first push logs; if not, run once manually.)
- Open Loops notifications (future): requires iOS `aps-environment` entitlement + `remote-notification` background mode + a follow-up notification template — R2+ scope, explicit per-loop authorization UI required first.
- R2 kickoff decisions: Gentle Revisit safety filters research; digest/report Space treatment + receipts.
