# Engram full product and development review

**Date:** 2026-07-23  
**Repository snapshot:** `main` at `8d48fa9`  
**Audience:** Product, design, and engineering  
**Status:** Engineer-ready review and prioritization brief  
**Explicit exclusions:** AI Moment Picker; capture-only on-device private mode

## Executive decision

Engram has a stronger technical foundation than the current product surface suggests. The capture path is deliberately recoverable, the verified-claim architecture is unusually rigorous, and the repository has broad automated coverage. The main risk is not a lack of features. It is that several generations of features, storage conventions, and insight paths coexist without one consistent product contract.

The recommended sequence is:

1. Close the privacy, report-integrity, insight-cutover, capture-backgrounding, security, and accessibility gaps in this review.
2. Roll out one coherent intelligence stack rather than independently exposing more widgets.
3. Add a **Correction Inbox / Teach Engram** as the next major feature. It is the best way to improve task, open-loop, entity, and insight quality without pretending model upgrades alone will solve false positives.
4. Follow with an **Insight Change Log**, **Counterevidence View**, and **Calm Weekly Review**. These extend the evidence architecture already built and make it understandable to users.
5. Defer broad multimedia, sharing, and new ambient-AI surfaces until the existing trust and learning loop is measured.

### Release recommendation

| Release context | Recommendation | Conditions |
|---|---|---|
| Internal development and dogfooding | **Go with known caveats** | Keep default-off intelligence features behind flags and make the privacy limitations visible to testers. |
| Broader beta or multi-account use | **No-go today** | First fix account-scoped local data, report-period attribution, Home/Insights feed consistency, and transport/browser security. |
| `insightClaims` promotion | **Conditional** | Replace or suppress the legacy Home Nexus widget; verify all proactive and report surfaces use an explicit current/history contract. |
| `intentExtraction` / tasks / open loops promotion | **Conditional** | Add end-to-end model evaluation and correction telemetry; do not rely only on deterministic activation-policy fixtures. |
| Native background upload promotion | **No-go today** | The server and Swift vertical slice exist, but the JavaScript application does not invoke it. The flag currently cannot deliver its named behavior. |
| Building another large intelligence subsystem | **Hold** | Establish product metrics and complete the trust/consistency work first. |

## What was reviewed

The review covered the active application and the default-off feature inventory:

- Text and voice capture, durable drafts, recovery, processing, background behavior, and quick actions.
- Entry analysis, classification, temporal context, tone, entity extraction, intent extraction, and embeddings.
- Tasks, open loops, goals/signals, Context Spaces, and entities.
- Ask Journal, retrieval, realtime voice, and conversational context.
- Basic Insights, legacy Nexus, verified claims, receipts, budgets, feedback, and rebuild behavior.
- Reflection recipes, Session Prep, Gentle Revisit, Personal Experiments, reports, and health/environment correlations.
- Safety detection, safety planning, decompression, authentication, MFA, export, notifications, and premium gates.
- Feature flags, model registry, operational documentation, local storage, Firestore access, accessibility, bundle shape, and test posture.

The review deliberately distinguishes:

- **Implemented:** meaningful application code exists.
- **Integrated:** the user-visible path actually invokes that code.
- **Enabled:** production configuration exposes the feature.
- **Validated:** the relevant automated and physical-device evidence exists.

Those states are not interchangeable.

## Validation performed

| Check | Result | Important qualification |
|---|---|---|
| Unit/component tests | **Pass — 246 files, 3,710 tests** | Several suites intentionally emit console errors. A passing run can therefore hide an unexpected error unless CI fails on unapproved console output. |
| Type checking | **Pass** | `npm run typecheck` |
| Production build | **Pass** | Build reports chunks over 500 KB and mixed static/dynamic imports. |
| Dependency audit | **Pass — 0 production vulnerabilities** | `npm audit --omit=dev` |
| Firestore rules locally | **Not run** | The local environment has no Java runtime, so the Firebase emulator could not start. Project documentation records a green CI rules suite; this run did not independently reproduce it. |
| Physical-device capture matrix | **Not performed in this review** | Auto-lock, manual lock, background upload, interruption, and force-quit claims remain conditional until the device matrix is executed. |

Build observations:

- Total `dist` output is approximately 4.5 MB.
- The main JavaScript bundle is approximately 1.02 MB.
- The Firebase vendor chunk is approximately 514 KB.
- CSS output is approximately 1.25 MB.
- `functions/index.js`, `src/App.jsx`, and `src/pages/InsightsPage.jsx` have become high-risk integration monoliths.

## Product and implementation inventory

The table below is the useful operational view, not merely a list of files.

| Area | Current development state | Default / rollout state | Review judgment |
|---|---|---|---|
| Durable text capture | Implemented and integrated | Core | Strong; owner-scoped drafts and recovery exist. |
| Durable voice capture | Implemented and integrated | Core | Strong custody design; the native-to-WebView base64 handoff is now the main efficiency limit. |
| Web audio chunk persistence | Implemented and integrated | Default on | Good recovery mechanism; retain until native path has equivalent validated custody. |
| Core-first save | Implemented and integrated | Default on | Good latency/quality tradeoff: save the usable entry before secondary enrichments. |
| Server analysis orchestrator | Implemented | Default off | Needs production timing and failure data before promotion. |
| Native background upload | Server and Swift vertical slice exist | Default off | **Not integrated into the JavaScript capture path.** Turning on the flag alone has no effect. |
| Tasks and intent suggestions | Implemented | Existing tasks are live; new intent pipeline default off | Structural activation is thoughtful, but model-label precision is not yet proven end to end. |
| Open loops | Implemented | Default off | Same precision caveat as tasks; should not be promoted as another automatic detector without correction UX. |
| Context Spaces | Implemented | Default off | Good strict-scoping design; coherent candidate for controlled rollout. |
| Voice chapters | Implemented | Default off | Useful if it reduces navigation cost; needs observed usage, not just generation quality. |
| Reflection recipes | Implemented | Default off | Reasonable guided-reflection surface; avoid over-prompting. |
| Session Prep | Implemented | Default off | High-value, bounded use case; should eventually support a redaction preview. |
| Gentle Revisit | Implemented with hardening | Default off | Safety and cadence work are careful; launch only after the signed validation memo and device/product QA. |
| Personal Experiments | Implemented with statistical hardening | Default off | Methodology is unusually disciplined; preserve “co-movement, not causation” positioning. |
| Legacy Nexus insights | Implemented and still consumed | Existing surface | Must be retired from proactive surfaces after verified-claim cutover. |
| Verified claims | Implemented | Default off in source; production status must be verified | Strong evidence, lineage, verification, and exclusion architecture. Home and report consumers are not fully cut over. |
| Insight receipts and budgets | Implemented | Default off | Trust-building controls; receipts should be available wherever a claim is shown, not treated as a separate optional product. |
| Insight rebuild | Implemented in current plan/build | Rollout-specific | Preserve history and statistical ledger; never present rebuild as deletion of the journal. |
| Ask Journal | Implemented | Core | Useful foundation; needs source links, better scoping, and clearer “why this answer” behavior. |
| HealthKit / Google Fit / WHOOP | Implemented in varying paths | Platform/integration dependent | Valuable context; local cache ownership, logging, consent copy, and third-party location behavior need correction. |
| Periodic reports | Implemented | Core/eligible surfaces | Narrative quality can be undermined by global analytics and claims presented as if period-specific. |
| Safety flows | Implemented | Core | Keep deterministic crisis handling independent from generative insight systems. |
| Reports/export/PDF | Implemented | Core | Runtime CDN dependency and report-period integrity need hardening. |
| Auth/MFA/native Google bridge | Implemented | Core | Functionally broad but has too many fallback paths and ambiguous success states. |

## Highest-priority engineering findings

### P0 — PRIV-01: sensitive local state is not consistently account-scoped

**User impact**

On a shared device or after sign-out/sign-in, one user can inherit another user's cached health state, location, voice transcript, or personalized prompt state. Even if the UI does not intentionally expose all of it, unowned sensitive state violates the product's trust model.

**Evidence**

- `src/services/health/platformHealth.js` uses global Preferences keys for the health context cache and permission status and retains a full health summary for up to 24 hours.
- `src/services/environment/environmentService.js` uses a global location cache containing latitude, longitude, accuracy, and timestamp.
- `src/hooks/useVoiceRelay.js` stores full transcripts under `voice_transcript_${sessionId}` without a user namespace, expiry, or observed removal.
- `src/components/zen/AppLayout.jsx`, `src/components/zen/widgets/PromptWidget.jsx`, and `src/services/prompts/activePrompts.js` store personalized prompt dismissals/questions in global category keys.
- `src/services/memory/sessionBuffer.js` defines a global buffer containing raw entry text and analysis. No current production write call was found, but active chat/RAG paths still read the legacy key. Treat it as latent legacy sensitive state, not as an actively written feature.
- `src/services/storage/clearOwnerCaches.js` clears owner-suffixed Preferences and legacy WHOOP data, but not the active global health, location, transcript, or prompt keys.
- Logout in `src/App.jsx` resets in-memory stores and calls `clearOwnerCaches(uid)`; it does not clean all of the keys above.

**Required fix**

1. Create one typed local-storage registry. Every key must declare:
   - owner scope: `user`, `device`, or intentionally anonymous;
   - sensitivity;
   - retention/expiry;
   - sign-out behavior;
   - migration behavior for legacy unowned values.
2. Move health, location, voice transcript, and personalized prompt keys to `ownerStorageKey(uid, ...)`.
3. Delete, rather than claim, unowned sensitive legacy values. There is no safe way to prove their owner after an upgrade.
4. Quarantine or delete the legacy global session buffer and make any future buffer API require an owner ID.
5. Preserve genuinely device-wide UI preferences only when explicitly intentional.
6. Add a two-account contract test covering every registered sensitive key.

**Acceptance**

- User A writes every sensitive storage category, signs out, and User B signs in.
- User B cannot read, infer, or cause upload of User A's values.
- Sign-out removes ephemeral sensitive values for User A.
- Expired transcript and location values are removed, not merely ignored.
- New sensitive Preferences keys cannot be added without an ownership declaration and test.

### P0 — REP-01: reports can attribute global/current data to a historical period

**User impact**

A weekly or monthly report can say that a current theme, mood average, or verified pattern “held up this period” even when the underlying value covers a different window. This is a factual integrity problem, not a copy issue.

**Evidence**

- `functions/src/reports/generator.js` correctly reads entries by report period.
- The same generator reads current global analytics snapshots and spreads them into the report context.
- No writer was found that guarantees the referenced `moodAvg`, `categoryStats`, or `topTheme` fields are scoped to the requested report window.
- `readVerifiedClaims` reads active verified, non-superseded claims without a period argument or source-window filter.
- `functions/src/reports/narrative.js` labels those claims “What held up this period.”
- Report metadata still records legacy Nexus insight IDs, creating a second inconsistency during the claims cutover.

**Required fix**

1. Derive period statistics deterministically from the period-scoped entry set.
2. Define one explicit claim/report rule:
   - include a claim only when its evidence/receipt window overlaps the report period under a documented threshold; or
   - snapshot period-qualified claims when the report is generated; or
   - place non-period-qualified claims in a separately labeled “Current verified insight” section.
3. Remove legacy Nexus IDs from claims-mode report metadata.
4. Add cross-period fixtures in which current global state intentionally disagrees with the requested report period.

**Acceptance**

- A January fixture cannot appear in a February-only report unless the UI labels it as current context rather than February evidence.
- Mood, category, theme, and source counts reconcile exactly to the report entry set.
- Re-generating a historical report does not silently replace period evidence with today's state.

### P0 — INS-01: the verified-claim cutover is incomplete across surfaces

**User impact**

The Insights page can show the new verified feed while Home still generates and displays legacy Nexus insights. Users can see duplicate, conflicting, or differently worded “truths” depending on where they look.

**Evidence**

- `src/pages/InsightsPage.jsx` suppresses `useNexusInsights` and renders `ClaimFeed` when `insightClaims` is enabled.
- `src/components/zen/widgets/NexusInsightsWidget.jsx` still invokes `useNexusInsights` without checking `insightClaims`.
- The existing capture/rebuild plan correctly separates active Nexus items from audit history, but it does not by itself replace the Home widget.

**Required fix**

Choose one product contract:

- build a compact Home widget backed by the verified claims query; or
- hide the legacy Home widget whenever `insightClaims` is enabled.

Then search and test every proactive consumer: Home, Insights, reports, prompts, notifications, Session Prep, and any “relevant insight” helper. `legacyVersion: true` and history records must never reach a proactive surface.

**Acceptance**

- With `insightClaims=true`, zero current UI queries or generates Nexus for proactive display.
- The same claim has the same title, state, confidence language, and receipt entry points on Home and Insights.
- History remains available only through an explicitly labeled history/audit affordance.

### P0 — CAP-01: the background-upload flag does not currently provide background upload

**User impact**

The product cannot honestly promise that post-recording upload continues through lock/background based on the feature flag. Existing custody makes recovery likely, but the user may have to reopen the app to resume processing.

**Evidence**

- The native capture coordinator records AAC to disk and writes a sidecar before recording starts.
- Native background audio mode and interruption handling are present.
- Server endpoints and a Swift background-upload vertical slice exist.
- The TypeScript plugin surface and `src/App.jsx` capture path do not call native `enqueueUpload`.
- The trustworthy-capture runbook explicitly says flipping the flag has no effect.
- The current stop path base64-encodes the entire native audio file and returns it through the WebView before calling cloud functions.

**Required fix**

1. Extend the TypeScript/native plugin contract with the existing enqueue operation.
2. Obtain a short-lived signed upload URL for the owner/capture operation.
3. Let native `URLSession` upload the on-disk file in the background.
4. Persist the remote operation ID and transition state before yielding control.
5. Let the server trigger the same fused transcription/analysis path after upload.
6. Keep the current durable operation resume path as fallback until device evidence proves the new path.
7. Never run a lower-quality transcription path merely to appear faster.

**Why this is the best speed improvement**

It removes base64's roughly 33% size expansion and avoids a full-file copy through the WebView. It also improves screen-lock reliability without changing the transcription model or the downstream analysis contract.

**Acceptance**

- Record, stop, immediately lock the phone, and receive a saved entry without reopening the foreground app.
- Background upload is idempotent under duplicate callbacks and app relaunch.
- A failed upload remains recoverable from the native file and owner-scoped operation state.
- The server validates owner, object path, size, content type, expiry, and operation ID.
- Physical tests cover auto-lock, manual lock, backgrounding, interruption, offline stop, network restoration, and force quit.

### P1 — PRIV-02: sensitive values are logged and privacy copy overpromises

**Evidence**

- `src/services/health/healthDataService.js` logs a full health summary.
- `src/services/health/healthKit.js` logs full sleep stages.
- The iOS health usage description says, “We never share this data,” while health context can be included in cloud analysis and reports.
- Environment code comments claim location is processed locally and not shared with third parties, but exact coordinates are sent to weather/sun APIs before the result is rounded.
- The location constant implies a 30-minute policy while the cache reader accepts values up to 24 hours old.

**Required fix**

- Log availability, counts, duration, and error class only—never health values or journal content.
- Replace absolute promises with accurate consent language describing on-device access and any optional cloud processing.
- Explicitly disclose weather/sun providers and minimize coordinates before third-party requests where the API permits it.
- Align named constants, actual expiry, permission-denied behavior, and product copy.

### P1 — SEC-01: transport and browser hardening are below the sensitivity of the product

**Evidence**

- iOS `Info.plist` allows arbitrary network loads and arbitrary web-content loads.
- `src/App.jsx` and `src/utils/pdf.js` independently inject jsPDF 2.5.1 from cdnjs at runtime without subresource integrity.
- Firebase Hosting does not define a Content Security Policy or the usual browser security headers.

**Required fix**

- Remove broad App Transport Security allowances. Add only exact, justified exceptions.
- Bundle and pin jsPDF through the application dependency graph.
- Add at minimum:
  - `Content-Security-Policy`, including `frame-ancestors`;
  - `Referrer-Policy`;
  - `Permissions-Policy`;
  - `X-Content-Type-Options`;
  - an explicit frame policy.
- Externalize or hash the small inline boot/theme code so the CSP does not require broad `unsafe-inline`.
- Add header and ATS checks to release validation.

### P1 — MOD-01: model configuration is newer than expected, but not production-governed consistently

Engram is **not using Gemini 3 Pro**. That is good: `gemini-3-pro-preview` has been shut down. The repository currently identifies:

| Workload | Configured model |
|---|---|
| Classification, analysis, entity extraction, insight writer/verifier | `gemini-3-flash-preview` |
| Tone, digest, temporal, intent, writer workloads | `gemini-3.5-flash` |
| Fused voice transcription + analysis | `gemini-2.5-flash` |
| Embeddings v1 / v2 | `text-embedding-004` / `gemini-embedding-2` |
| Cloud chat / fallback | `gpt-4o-mini` / `gpt-4o` |
| Fallback transcription | `whisper-1` |
| Realtime voice | `gpt-realtime-2.1` |

The model inventory is current enough to avoid an emergency “upscale everything” migration. The priority is governance:

1. Preview Gemini IDs can be deprecated quickly. Benchmark the affected classification, analysis, insight, and verifier workloads against stable Gemini 3.5/3.6 Flash, using Engram's golden data, before migration.
2. Keep the writer and verifier independently versioned. Moving both to the same model/snapshot weakens independent checking.
3. Keep Gemini 2.5 Flash for fused transcription until real Engram audio proves another model improves word error rate and latency without degrading tone/structure.
4. Benchmark `gpt-4o-mini-transcribe` against Whisper-1 for the fallback path; OpenAI positions it as more accurate than original Whisper.
5. Benchmark the relay's GPT-4o chat path against a current model, but do not make a costlier model the default without task-specific evidence.
6. Pin exact model snapshots/IDs per workload and retain instant rollback.
7. Verify deployed relay environment variables; repository defaults are not proof of production runtime state.
8. Retire the v1 embedding path explicitly once the v2 backfill and rollback window are complete.

Official model references:

- [Google Gemini model catalog](https://ai.google.dev/gemini-api/docs/models?hl=en)
- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [GPT-4o mini Transcribe](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe)

### P1 — MOD-02: one transcription fallback bypasses the model registry

**Evidence**

The fused `transcribeEntry` fallback calls `transcribeWithWhisper` without passing the model resolved from `model.transcriptionFallback`. The helper therefore uses its own `whisper-1` default even if the registry is changed. Other legacy callables resolve the registry correctly.

There are also hardcoded `gemini-2.0-flash` arguments in prompt/temporal client calls, but the called wrapper accepts only two arguments, so those strings are ignored. They are misleading audit artifacts rather than active overrides.

**Required fix**

- Pass the resolved fallback model explicitly and test a non-default override.
- Delete ignored hardcoded model arguments.
- Add a runtime model manifest to observability: workload, resolved ID, prompt/schema version, latency, success/fallback, and cost units—never journal content.

### P1 — INT-01: task/open-loop precision is gated at the policy layer, not the full model path

**What is good**

- Candidate activation is deterministic.
- Confidence alone cannot activate a candidate.
- Hard blockers exist.
- Evidence spans are required.
- Dismissal state is preserved.
- The current fixture gate requires high precision and zero hard-negative activations.

**What is missing**

The fixtures primarily test candidate structure against the deterministic activation policy. Users experience the entire path:

`raw journal language → model label/attributes → policy → UI`

A model that labels a quoted request, passing thought, sarcasm, completed action, or self-correction as a task can still manufacture a structurally valid false positive.

**Required fix**

1. Add a consented/deidentified end-to-end corpus of raw text and representative voice transcripts.
2. Include negation, hypotheticals, quoted speech, instructions to another person, completed actions, self-correction, brainstorming, recurring worries, and “I should” language.
3. Evaluate model plus policy, not policy alone.
4. Shadow-run before activation and measure precision by intent kind.
5. Keep automatic activation to explicit “remind me,” TODO/checklist, and clear future commitment patterns until observed precision clears the gate.
6. Leave less explicit but qualified candidates in a suggestion queue.
7. Route user edits/rejections into a content-free error taxonomy and recurring golden-eval refresh.

Newer models may improve labeling, but the correction and evaluation loop is the lasting solution.

### P1 — INT-02: task/open-loop user actions can fail silently

**Evidence**

- `IntentSuggestionTray` removes suggestions optimistically without awaiting or handling the mutation failure.
- `CapturedToast` has similar fire-and-forget behavior.
- The intent update and decision-log append are separate writes rather than one atomic operation.

**Required fix**

- Use one batch/transaction or an idempotent server mutation.
- Await completion, show a quiet failure state, and restore the item when a mutation fails.
- Record model/policy version and a non-content correction reason.
- Make every action repeat-safe.

### P1 — A11Y-01: the global viewport and color tokens fail the accessibility promise

**Evidence**

- `index.html` disables user zoom with `maximum-scale=1, user-scalable=no`.
- `--text-muted` is approximately 3.64:1 on white and 3.36:1 on the main light background.
- `--text-faint` is approximately 2.27:1 on white.
- The dark faint token is approximately 3.09:1 on the dark background.
- These tokens are used hundreds of times, including at 10–13 px.

**Required fix**

- Restore pinch zoom.
- Raise normal-text token contrast to at least 4.5:1.
- Split decorative, placeholder, disabled-control, and readable-secondary-text tokens rather than using one faint color for all purposes.
- Add automated contrast checks for token/background pairs and screenshot tests at 200% text size.

### P1 — A11Y-02: several high-value controls are pointer-only or too small

Examples:

- The entry textarea relies on a placeholder instead of an accessible label.
- Story and insight cards use clickable `div`/motion containers without button semantics, keyboard handling, or `aria-expanded`.
- Task checkbox/dismiss actions and open-loop controls have 16–24 px targets and hover-only affordances.

**Required fix**

- Use native buttons/inputs wherever possible.
- Add programmatic labels, `aria-expanded`, and `aria-controls`.
- Provide visible focus and `focus-within` behavior.
- Make primary touch targets at least 44×44 CSS pixels without necessarily enlarging the icon.
- Test VoiceOver rotor order, dynamic type, keyboard-only use, and reduced motion on capture, Home, Insights, tasks, and open loops.

### P1 — CAP-02: wake-lock state and processing copy do not match durable custody

**Evidence**

- `useWakeLock` uses one `isLocked` state for both desired and current lock state. On release, it loses the information needed to reliably reacquire on visibility.
- The video fallback condition is difficult to reason about and may miss the user-gesture requirement.
- The wake lock begins after recording stops, not for the whole web recording session.
- User copy says to keep the app open even though the recording has already been secured and can be resumed.
- An older background-audio hook is still invoked but is not the authority for the current durable capture path.

**Required fix**

- Track `shouldStayAwake` separately from the current wake-lock handle.
- Reacquire when the document becomes visible while the capture operation is still active.
- Start any video fallback in a user gesture.
- For web capture, request the lock at recording start and keep chunk persistence authoritative.
- Remove the dead legacy hook and delete/quarantine unowned legacy audio keys.
- Change copy to: **“Your recording is saved. Processing may pause and resume if you leave.”**
- Do not promise completion in the background until CAP-01 passes the device matrix.

### P2 — PERF-01: the core shell ships too much code and too many integration responsibilities

**Evidence**

- The main bundle, Firebase bundle, and CSS are large for a capture-first mobile experience.
- Default-off features remain in the initial graph because many are statically imported.
- `App.jsx`, `functions/index.js`, and `InsightsPage.jsx` own many unrelated state machines and integrations.

**Required fix**

- Define a capture-first performance budget and measure cold launch, capture-ready time, post-stop UI time, and saved-entry time on representative devices.
- Lazy-load reports, experiments, deep insights, visualizations, PDF generation, and flag-off feature routes.
- Keep the capture composer, authentication shell, durable operation store, and minimum journal list in the first-load graph.
- Split cloud functions by bounded domain and centralize validation/auth wrappers.
- Extract capture, auth, insights, and report orchestration state machines from UI monoliths.
- Convert fonts to a deliberate WOFF2/subset strategy if the current CSS payload is font-driven.
- Fail CI on significant bundle-budget regressions.

### P2 — QA-01: green tests contain avoidable blind spots

**Evidence**

- Validation passes while some suites emit expected Firestore/dismissal errors.
- The account-switch matrix does not cover the newly identified global health, location, transcript, prompt, and session keys.
- The physical-device matrix includes background-flag expectations that cannot currently be exercised through the JavaScript app.

**Required fix**

- Fail on unexpected `console.error`/`console.warn`; explicitly allow only the error asserted by each test.
- Generate account-switch tests from the storage registry.
- Mark device rows `blocked by integration` rather than implying flag coverage.
- Require the rules emulator in CI and publish the exact test count/artifact.
- Add contract tests at every feature cutover so flag-on and flag-off consumers are enumerated.

### P2 — OPS-01: feature flags describe code availability more clearly than product readiness

Most recent intelligence features are default off. That is prudent, but the repository lacks one generated view connecting:

- source default;
- deployed remote value;
- eligible cohort;
- dependencies;
- announcement/onboarding state;
- product metric;
- rollback trigger;
- physical validation status.

`insightClaims` also lacks the announcement metadata present for several earlier flags. `PROJECT_STATUS.md` is too long and manual to be the reliable runtime source.

**Required fix**

- Create one generated feature manifest and release dashboard.
- Treat every flag promotion as an experiment with owner, metric, cohort, duration, and rollback.
- Roll out coherent stacks—for example verified claims + receipts + claims-backed Home—rather than isolated internals.
- Delete flags and legacy paths after the rollback window.

### P2 — AUTH-01: native Google authentication has too many success paths

The current app combines a native bridge, a hardcoded function URL, manual REST fallback, custom-token exchange, polling, and a restart alert if SDK auth state does not converge. This is difficult to test and can tell the user “success” before the application is actually authenticated.

**Required fix**

- Model native authentication as one explicit state machine.
- Use one configured endpoint source.
- Consider the operation successful only when the Firebase SDK emits the authenticated user.
- Make fallback selection observable and testable; remove obsolete paths after one stable release.

## Capture speed and screen-sleep assessment

### What the app can honestly claim today

| Moment | Native iOS | Web/PWA | Current confidence |
|---|---|---|---|
| While recording | AAC is written to app-private disk; background audio mode exists | Chunks are persisted to IndexedDB when enabled | Strong design, but device/browser matrix still required. |
| When recording stops | Draft sidecar/file exists before the cloud call | Persisted chunks and durable operation exist | Strong custody design. |
| While transcription runs | App requests a wake lock; operation can resume after relaunch | Wake lock plus persisted operation/chunks | Recovery is strong; uninterrupted background completion is not yet guaranteed. |
| Screen locks after stop | Existing upload/processing may pause; reopening should resume | Browser-dependent; should resume from persisted custody | Do not claim full continuation yet. |
| App is force-quit | Native file and operation state should permit recovery | Persisted chunks/operation should permit recovery | Validate physically before release claim. |
| Native background-upload flag on | Swift/server pieces exist, but app does not invoke them | Not applicable | **Not functional end to end.** |

### Speed work that preserves quality

Recommended order:

1. **Instrument the current pipeline.** Record local finalize, WebView transfer, upload, function cold start, model time, Firestore commit, and secondary-enrichment time.
2. **Wire direct native background file upload.** This removes base64 expansion/copying and improves sleep behavior without changing models.
3. **Keep core-first save.** Do not make temporal context, embeddings, intent extraction, or insight refresh block the saved entry.
4. **Evaluate warm capacity for `transcribeEntry`.** It currently has no `minInstances`. Only pay for one warm instance if p95 cold-start data shows meaningful user benefit.
5. **Benchmark models per workload.** Use word error rate, diarization/punctuation needs, entity preservation, tone stability, latency, failure rate, and cost.
6. **Stream status, not lower-quality partial truth.** A precise stage indicator can improve perceived speed without duplicating model calls.
7. **Avoid parallel “race two models” strategies.** They raise cost, privacy exposure, and inconsistency while complicating downstream provenance.

Recommended capture metrics:

- tap-to-record-ready p50/p95;
- stop-to-local-custody p50/p95;
- stop-to-transcript p50/p95;
- stop-to-visible-saved-entry p50/p95;
- resume success after lock/background/force-quit;
- duplicate-entry rate;
- unrecovered-capture rate;
- correction rate for transcript and extracted intents.

## Insights-engine assessment

### What is genuinely strong

- Evidence is deterministic rather than generated from prose alone.
- Claims carry lineage and supersession rather than being destructively overwritten.
- Source exclusions fail closed.
- Statistical testing and multiple-testing history are preserved.
- Writer/verifier separation exists.
- Causal language has explicit gates.
- Rebuild is designed to preserve entries, feedback, exclusions, and history.
- Experiments and Gentle Revisit have unusually careful methodological/safety documentation.

### What will most improve user-perceived insight quality

Model upgrades alone rank below the following:

1. **One current feed contract.** Remove legacy/current duplication across every surface.
2. **Correction propagation.** When a user says a task, entity, source, or interpretation is wrong, recompute or invalidate downstream conclusions.
3. **Counterevidence visibility.** Show why the claim is not universal.
4. **Time-window honesty.** Label the data-through date and never present global claims as period-specific.
5. **Novelty and usefulness budgets.** Suppress paraphrases even when the model can title them differently.
6. **Change over time.** Tell the user what strengthened, weakened, or retired rather than issuing another static card.
7. **Coverage explanations.** “Not enough comparable days” is more trustworthy than manufacturing an insight.
8. **Action only with consent.** An insight may suggest a reflection, experiment, or explicit task; it should not silently create obligations.

### Recommended insight-quality metrics

- verified-claim acceptance / useful rate;
- “not true,” “already knew,” “too vague,” “too sensitive,” and “wrong source” rates;
- semantic duplicate rate within 30/90 days;
- source-open rate;
- reflection/action follow-through;
- claim strengthened/weakened/retired rate;
- unsupported period-attribution defects;
- correction-to-downstream-update latency;
- abstention rate and later validation rate.

Do not collapse these into one engagement score. A provocative but wrong insight can attract clicks.

## Recommended new features

The strongest ideas reuse Engram's existing evidence, lineage, retrieval, and action foundations. They do not require making the system more invasive.

### 1. Correction Inbox / Teach Engram

**Recommendation:** Build next.

**Problem**

Corrections are currently scattered: users can dismiss a suggestion, edit some objects, or give insight feedback, but there is no coherent place to review what Engram inferred or ensure a correction reaches downstream analysis.

**Experience**

A calm, optional inbox contains only items that need judgment:

- “Is this a task or just a thought?”
- “Are Spencer and Spence the same person?”
- “Was this actually an open loop?”
- “Did this source support the insight?”
- “This entry says the action was already completed. Update it?”

Users can accept, edit, reject, merge, or mark sensitive. The system briefly explains the effect: “This removes the task and rechecks two related insights.”

**Why it matters**

- Directly attacks random-task and random-open-loop behavior.
- Improves user control now and evaluation quality later.
- Makes model migrations safer.
- Can unify existing intent suggestions, entity corrections, and claim feedback instead of adding another unrelated widget.

**Guardrails**

- No guilt badges, unread-count pressure, or forced review.
- Never train externally on content without separate explicit consent.
- Store a content-free correction taxonomy by default.
- Recompute only affected downstream artifacts and preserve history.

**Cheap test**

Prototype one queue combining current intent suggestions and entity aliases. Measure completion, rejection reasons, and recurrence of corrected mistakes.

### 2. Insight Change Log

**Recommendation:** Build after feed cutover.

**Experience**

Each verified insight can show:

- New, strengthened, weakened, unchanged, or retired.
- “Data through July 23.”
- What evidence changed.
- Which wording or scope changed.
- A link to the prior version.

A weekly summary shows only material changes, not every recomputation.

**Why it fits**

Claim lineage and supersession already exist. The feature makes backend rigor visible and reduces the feeling that insights arbitrarily disappear or duplicate.

**Guardrails**

- Never imply that “weakened” means the user's experience is invalid.
- Do not notify on every state transition.
- Preserve a stable user-authored name if the user renamed the insight.

### 3. Supporting and Counterevidence View

**Recommendation:** Build with receipts, not as a separate engine.

**Experience**

An expanded claim shows:

- days/entries that support the pattern;
- comparable days that do not;
- missing or incomparable days;
- confounds already considered;
- “what would change this conclusion.”

Use plain language first, with statistical detail available on demand.

**Why it fits**

The evidence bundle and experiment methodology already support the concept. It turns confidence from a decorative percentage into something inspectable.

### 4. Calm Weekly Review

**Recommendation:** High-value P2.

This is not another generated report. It is a 5–10 minute optional review of:

- one or two materially changed verified insights;
- a small correction queue;
- tasks/open loops the user explicitly accepted;
- active experiment check-ins;
- items the user snoozed for this week.

Users can skip the week, hide a section, or change cadence. There are no streaks or guilt copy.

**Why it fits**

Engram currently has many valuable surfaces but no single low-pressure synthesis ritual. This can replace dashboard sprawl rather than add to it.

### 5. Coverage and Blind-Spots Map

**Recommendation:** Build before increasing insight frequency.

**Experience**

Show the minimum information needed to explain insight availability:

- journal days and comparable days;
- health/context coverage when connected;
- which Space is in scope;
- missingness that prevented a conclusion;
- explicit sensitive-day exclusions.

Examples:

- “There are only three comparable workdays, so Engram is waiting.”
- “Sleep is available on 8 of 14 days.”
- “This Space is kept separate from general insights.”

**Guardrails**

- No “you failed to journal” framing.
- No pressure to disclose more.
- Never reveal the existence of hidden Space content outside that Space.

### 6. Source-linked Ask Journal

**Recommendation:** Improve the existing feature before adding a new chatbot surface.

**Experience**

- Every substantive answer links to exact source entries and dates.
- Users can scope by date, Space, person, project/entity, entry type, and health-context availability.
- Saved searches can be rerun without becoming unsolicited notifications.
- Answers distinguish direct recall, synthesis, and inference.
- “I don't have enough evidence” is a first-class result.

**Why it fits**

Retrieval already exists. The gap is verifiability and control. Rosebud's Ask experience also makes related entries directly reachable, which is a useful baseline: [Ask Rosebud](https://help.rosebud.app/tools-for-growth/ask-rosebud).

### 7. Home and Lock Screen Quick Capture Widget

**Recommendation:** High-value capture improvement after the reliability gate.

The application already has App Intents / shortcut plumbing. A WidgetKit extension can provide:

- one-tap voice capture;
- one-tap text capture;
- an optional selected Space;
- visible recovery state when a prior capture is pending.

It should open directly into the trusted capture state, not attempt hidden ambient recording. Apple Journal already establishes Home/Lock Screen entry widgets as a familiar system pattern: [Add Journal widgets on iPhone](https://support.apple.com/en-au/guide/iphone/iph70107aec2/26/ios/26).

### 8. User-controlled Threads

**Recommendation:** Later P2.

Let users pin, merge, rename, archive, or split a recurring story/project/person thread. Engram can suggest a merge, but the user owns the final structure.

This is preferable to generating more fixed categories because it improves retrieval, Session Prep, and insight scoping simultaneously.

### 9. Personal Glossary and Entity Aliases

**Recommendation:** Pair with the Correction Inbox.

Allow users to define:

- aliases and nicknames;
- pronouns and relationship labels;
- projects/organizations;
- words the transcript routinely mishears.

The UI must distinguish future interpretation from an optional explicit historical retrofit. Do not silently rewrite old entries.

### 10. Scoped Session Share Package

**Recommendation:** Later, export-first.

From Session Prep, let the user build a reviewable package containing selected summaries, source excerpts, tasks, and questions. Include a redaction preview and exclude hidden Spaces/sensitive days by default.

Start with a local PDF/document export. Consider expiring links only after access control, revocation, and audit behavior are designed.

### 11. Multimedia attachments and share sheet

**Recommendation:** Later P3.

Photos, files, OCR, and a system share sheet are competitive baselines—Day One, for example, emphasizes rich media, search, cross-platform access, and end-to-end encryption: [Day One features](https://dayoneapp.com/features/).

For Engram, this expands the privacy/storage/search surface substantially. It should follow:

- owner-scoped local storage;
- attachment encryption and retention design;
- malware/file-type handling;
- metadata stripping;
- evidence/source semantics;
- export and account-deletion coverage.

### 12. Optional edit-before-save transcript

**Recommendation:** Small experiment only.

After local custody, offer “Save now” by default and a secondary “Review transcript” path. Do not force editing before the entry exists. Measure whether corrections improve downstream entities/intents enough to justify added time.

## Features to consolidate, pause, or remove

Good product development includes subtraction.

1. **Retire legacy Nexus proactive paths** after verified-claim rollout and the rollback window.
2. **Unify feedback** from tasks, open loops, entities, and insights in the Correction Inbox rather than maintaining separate micro-patterns.
3. **Reduce Home by default.** A capture entry point, one useful current item, and optional weekly review are more coherent than every implemented subsystem receiving a widget.
4. **Pause low-evidence surfaces** such as automatically generated Stories, Goals, Social Insights, burnout widgets, or gap prompts if product metrics cannot show repeated user value.
5. **Do not use streaks or shame-based missing-data prompts.**
6. **Delete dead capture hooks, stale model arguments, expired flags, and legacy storage paths** once migrations are complete.

## Prioritized delivery plan

### Phase A — Trust and release blockers

These items should land before a broad beta or additional intelligence rollout.

| Workstream | Scope | Acceptance gate |
|---|---|---|
| A1. Storage isolation | PRIV-01 and PRIV-02 | Two-account matrix green; no sensitive value logging; accurate privacy copy. |
| A2. Insight/report integrity | REP-01 and INS-01 | One claims-mode feed contract; period fixtures green; no legacy proactive items. |
| A3. Capture background path | CAP-01 and CAP-02 | Physical-device matrix green; recovery and duplicate tests green; honest UX copy. |
| A4. Security baseline | SEC-01 | No broad ATS allowance, no runtime PDF CDN, headers/CSP verified. |
| A5. Critical accessibility | A11Y-01 plus capture/insight semantics from A11Y-02 | Pinch zoom, 200% text, contrast, VoiceOver, and 44 px controls pass. |

This is likely more than one engineer should promise in a two-week sprint. If the sprint is capacity-constrained, ship A1 + A2 first, keep background-upload and external rollout disabled, and make A3–A5 the next release gate rather than weakening acceptance criteria.

### Phase B — Quality learning loop

1. End-to-end intent evaluation corpus and shadow mode.
2. Correction Inbox vertical slice for tasks/open loops/entities.
3. Atomic correction mutations and downstream invalidation.
4. Runtime model manifest and per-workload evaluation harness.
5. Product-quality dashboard with correction, duplicate, abstention, and capture metrics.

### Phase C — Trustworthy insight experience

1. Insight Change Log.
2. Supporting/counterevidence receipts.
3. Coverage and Blind-Spots Map.
4. Calm Weekly Review.
5. Source-linked Ask Journal.

### Phase D — Reach and richer input

1. Home/Lock Screen capture widget.
2. User-controlled Threads and personal glossary.
3. Scoped Session Share Package.
4. Multimedia/share sheet after its privacy design.

## Definition of done for any intelligence feature

A feature is not done when the model returns valid JSON. It is done when:

- The user can understand what was inferred and from which sources.
- Sensitive and excluded sources fail closed.
- Time range and data-through date are explicit.
- The feature can abstain gracefully.
- A user can correct, dismiss, hide, or undo it.
- A correction reaches every affected downstream consumer.
- History/provenance remain auditable without reappearing as current truth.
- The feature is owner-scoped locally and remotely.
- Accessibility works with VoiceOver, keyboard, 200% text, zoom, reduced motion, and compact viewports.
- Latency, model ID, prompt/schema version, fallback, and failure are observable without logging content.
- Flag-on, flag-off, migration, rollback, account-switch, offline, and duplicate-callback paths are tested.
- A product metric and rollback threshold exist.

## Sprint-ready issue list

| ID | Priority | Issue | Suggested owner |
|---|---:|---|---|
| PRIV-01 | P0 | Account-scope all sensitive local state and add registry/migration | Platform |
| REP-01 | P0 | Make report analytics and claims period-honest | Insights/backend |
| INS-01 | P0 | Complete claims cutover on Home and all proactive consumers | Insights/frontend |
| CAP-01 | P0 | Wire signed direct native background upload end to end | iOS/backend |
| PRIV-02 | P1 | Remove health logs and correct health/location privacy copy | Platform/product |
| SEC-01 | P1 | ATS, CSP/headers, and bundled PDF dependency | Platform/security |
| MOD-01 | P1 | Stable-model benchmark and deployment manifest | AI platform |
| MOD-02 | P1 | Fix transcription fallback registry bypass | Backend |
| INT-01 | P1 | Add raw-text end-to-end intent evaluation and shadow gate | AI/product |
| INT-02 | P1 | Make suggestion actions atomic and failure-visible | Frontend/backend |
| A11Y-01 | P1 | Restore zoom and repair contrast token system | Design/frontend |
| A11Y-02 | P1 | Fix semantics, labels, focus, and touch targets | Frontend |
| CAP-02 | P1 | Correct wake-lock state machine and processing copy | Frontend |
| PERF-01 | P2 | Capture-first bundle split and domain extraction | Frontend/backend |
| QA-01 | P2 | Strict console, generated storage matrix, honest device gates | QA/platform |
| OPS-01 | P2 | Generated feature rollout manifest and KPI/rollback contract | Product/platform |
| AUTH-01 | P2 | Consolidate native Google authentication state machine | Platform |

## Final product judgment

Engram should not compete by generating the largest number of interpretations. Its defensible product is a private, durable memory system that can show its work, change its mind, and learn from correction.

The present architecture is close to supporting that position. The next release should make the architecture consistent across accounts, surfaces, time windows, and background states. The next major feature should then give users one place to teach the system when it is wrong. That combination will improve perceived intelligence more reliably than moving every workload to a larger model or adding another automatic insight card.

