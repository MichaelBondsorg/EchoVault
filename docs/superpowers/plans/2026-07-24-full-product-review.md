# Engram Full Product & Development Review (Michael's brief, adopted verbatim as owner direction 2026-07-24)

> **For agentic workers:** execute via superpowers:subagent-driven-development. Phase A first (A1 PRIV-01/PRIV-02, A2 REP-01/INS-01, A3 CAP-01/CAP-02, A4 SEC-01, A5 A11Y-01/02), per the brief's own capacity guidance: A1+A2 lead; A3's native background upload is sequenced last in Phase A (device matrix is Michael-dependent; flag stays off). MOD-02 (small) rides along. Phases B-D follow in later sessions. The brief below is unedited and its acceptance gates are binding. Execution model identical to R4 (main, green batches, implementers never git, adversarial review per task, full gate before push).
> Controller wave plan: W1 = PRIV-01 ∥ INS-01 ∥ REP-01 (disjoint trees). W2 = SEC-01 ∥ A11Y-01 ∥ MOD-02. W3 = A11Y-02 ∥ CAP-02 ∥ PRIV-02. W4 = QA-01 console-strictness + docs + whole-phase review. CAP-01 = its own follow-on batch (large; server+Swift+TS contract), landing dark behind the existing flag pending Michael's device matrix.

---
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

## Highest-priority engineering findings

### P0 — PRIV-01: sensitive local state is not consistently account-scoped

**User impact**: On a shared device or after sign-out/sign-in, one user can inherit another user's cached health state, location, voice transcript, or personalized prompt state.

**Evidence**
- `src/services/health/platformHealth.js` uses global Preferences keys for the health context cache and permission status and retains a full health summary for up to 24 hours.
- `src/services/environment/environmentService.js` uses a global location cache containing latitude, longitude, accuracy, and timestamp.
- `src/hooks/useVoiceRelay.js` stores full transcripts under `voice_transcript_${sessionId}` without a user namespace, expiry, or observed removal.
- `src/components/zen/AppLayout.jsx`, `src/components/zen/widgets/PromptWidget.jsx`, and `src/services/prompts/activePrompts.js` store personalized prompt dismissals/questions in global category keys.
- `src/services/memory/sessionBuffer.js` defines a global buffer containing raw entry text and analysis. No current production write call was found, but active chat/RAG paths still read the legacy key. Treat it as latent legacy sensitive state.
- `src/services/storage/clearOwnerCaches.js` clears owner-suffixed Preferences and legacy WHOOP data, but not the active global health, location, transcript, or prompt keys.
- Logout in `src/App.jsx` resets in-memory stores and calls `clearOwnerCaches(uid)`; it does not clean all of the keys above.

**Required fix**
1. Create one typed local-storage registry. Every key must declare: owner scope (`user`, `device`, or intentionally anonymous); sensitivity; retention/expiry; sign-out behavior; migration behavior for legacy unowned values.
2. Move health, location, voice transcript, and personalized prompt keys to `ownerStorageKey(uid, ...)`.
3. Delete, rather than claim, unowned sensitive legacy values.
4. Quarantine or delete the legacy global session buffer and make any future buffer API require an owner ID.
5. Preserve genuinely device-wide UI preferences only when explicitly intentional.
6. Add a two-account contract test covering every registered sensitive key.

**Acceptance**
- User A writes every sensitive storage category, signs out, and User B signs in. User B cannot read, infer, or cause upload of User A's values.
- Sign-out removes ephemeral sensitive values for User A.
- Expired transcript and location values are removed, not merely ignored.
- New sensitive Preferences keys cannot be added without an ownership declaration and test.

### P0 — REP-01: reports can attribute global/current data to a historical period

**Evidence**
- `functions/src/reports/generator.js` correctly reads entries by report period, but reads current global analytics snapshots and spreads them into the report context.
- No writer guarantees the referenced `moodAvg`, `categoryStats`, or `topTheme` fields are scoped to the requested report window.
- `readVerifiedClaims` reads active verified, non-superseded claims without a period argument or source-window filter; `narrative.js` labels those claims "What held up this period."
- Report metadata still records legacy Nexus insight IDs.

**Required fix**
1. Derive period statistics deterministically from the period-scoped entry set.
2. Define one explicit claim/report rule: include a claim only when its evidence/receipt window overlaps the report period under a documented threshold; or snapshot period-qualified claims at generation; or place non-period-qualified claims in a separately labeled "Current verified insight" section.
3. Remove legacy Nexus IDs from claims-mode report metadata.
4. Add cross-period fixtures in which current global state intentionally disagrees with the requested report period.

**Acceptance**
- A January fixture cannot appear in a February-only report unless labeled as current context.
- Mood, category, theme, and source counts reconcile exactly to the report entry set.
- Re-generating a historical report does not silently replace period evidence with today's state.

### P0 — INS-01: the verified-claim cutover is incomplete across surfaces

**Evidence**
- `src/pages/InsightsPage.jsx` suppresses `useNexusInsights` and renders `ClaimFeed` when `insightClaims` is enabled.
- `src/components/zen/widgets/NexusInsightsWidget.jsx` still invokes `useNexusInsights` without checking `insightClaims`.

**Required fix**: Choose one product contract — a compact Home widget backed by the verified claims query, or hide the legacy Home widget whenever `insightClaims` is enabled. Then search and test every proactive consumer: Home, Insights, reports, prompts, notifications, Session Prep, and any "relevant insight" helper. `legacyVersion: true` and history records must never reach a proactive surface.

**Acceptance**
- With `insightClaims=true`, zero current UI queries or generates Nexus for proactive display.
- The same claim has the same title, state, confidence language, and receipt entry points on Home and Insights.
- History remains available only through an explicitly labeled history/audit affordance.

### P0 — CAP-01: the background-upload flag does not currently provide background upload

**Evidence**: native capture coordinator records AAC to disk + sidecar; native background audio mode exists; server endpoints + Swift background-upload vertical slice exist; but the TS plugin surface and `src/App.jsx` capture path do not call native `enqueueUpload`; the runbook says flipping the flag has no effect; the current stop path base64-encodes the whole file through the WebView.

**Required fix**
1. Extend the TypeScript/native plugin contract with the existing enqueue operation.
2. Obtain a short-lived signed upload URL for the owner/capture operation.
3. Let native `URLSession` upload the on-disk file in the background.
4. Persist the remote operation ID and transition state before yielding control.
5. Let the server trigger the same fused transcription/analysis path after upload.
6. Keep the current durable operation resume path as fallback until device evidence proves the new path.
7. Never run a lower-quality transcription path merely to appear faster.

**Acceptance**
- Record, stop, immediately lock the phone, and receive a saved entry without reopening the foreground app.
- Background upload is idempotent under duplicate callbacks and app relaunch.
- A failed upload remains recoverable from the native file and owner-scoped operation state.
- The server validates owner, object path, size, content type, expiry, and operation ID.
- Physical tests cover auto-lock, manual lock, backgrounding, interruption, offline stop, network restoration, and force quit.

### P1 — PRIV-02: sensitive values are logged and privacy copy overpromises

**Evidence**: `healthDataService.js` logs a full health summary; `healthKit.js` logs full sleep stages; the iOS health usage description says "We never share this data" while health context can reach cloud analysis and reports; environment comments claim local-only processing but exact coordinates are sent to weather/sun APIs before rounding; the location constant implies 30 minutes while the cache reader accepts 24 hours.

**Required fix**: log availability/counts/duration/error class only — never health values or journal content; replace absolute promises with accurate consent language; disclose weather/sun providers and minimize coordinates before third-party requests where the API permits; align constants, expiry, permission-denied behavior, and copy.

### P1 — SEC-01: transport and browser hardening below product sensitivity

**Evidence**: iOS `Info.plist` allows arbitrary network + web-content loads; `src/App.jsx` and `src/utils/pdf.js` inject jsPDF 2.5.1 from cdnjs at runtime without SRI; Firebase Hosting defines no CSP or standard security headers.

**Required fix**: remove broad ATS allowances (exact justified exceptions only); bundle and pin jsPDF; add Content-Security-Policy (incl. frame-ancestors), Referrer-Policy, Permissions-Policy, X-Content-Type-Options, explicit frame policy; externalize/hash inline boot/theme code so CSP avoids broad unsafe-inline; add header/ATS checks to release validation.

### P1 — MOD-01: model configuration is current but not production-governed

Current inventory (verified): classification/analysis/entity/insight writer+verifier on `gemini-3-flash-preview`; tone/digest/temporal/intent on `gemini-3.5-flash`; fused transcription `gemini-2.5-flash` (registry default; production override currently `gemini-3.5-flash` via flag); embeddings `gemini-embedding-2` (v2); chat `gpt-4o-mini`/`gpt-4o`; fallback `whisper-1`; realtime `gpt-realtime-2.1`. Governance actions: benchmark preview-ID workloads against stable Flash on Engram golden data before migration; keep writer/verifier independently versioned; benchmark `gpt-4o-mini-transcribe` vs whisper-1 for fallback; pin exact snapshots per workload with instant rollback; verify deployed relay env vars; retire the v1 embedding path explicitly once the v2 window closes.

### P1 — MOD-02: one transcription fallback bypasses the model registry

The fused `transcribeEntry` fallback calls `transcribeWithWhisper` without passing the model resolved from `model.transcriptionFallback` (helper's own `whisper-1` default wins even if the registry is changed). Also: hardcoded `gemini-2.0-flash` arguments in prompt/temporal client calls are IGNORED by the two-arg wrapper — misleading audit artifacts. Fix: pass the resolved fallback model + test a non-default override; delete ignored hardcoded model arguments; add a runtime model manifest to observability (workload, resolved ID, prompt/schema version, latency, success/fallback, cost units — never content).

### P1 — INT-01: task/open-loop precision gated at policy layer, not full model path

Fixtures test candidate structure against the deterministic activation policy; users experience raw language → model label → policy → UI. Required: consented end-to-end corpus (negation, hypotheticals, quoted speech, instructions-to-others, completed actions, self-correction, brainstorming, recurring worries, "I should"); evaluate model+policy; shadow-run before activation; keep automatic activation to explicit patterns until observed precision clears the gate; suggestion queue for the rest; content-free correction taxonomy feeding golden-eval refresh.

### P1 — INT-02: task/open-loop user actions can fail silently

`IntentSuggestionTray` removes suggestions optimistically without awaiting/handling mutation failure; `CapturedToast` similar; intent update + decision-log append are separate writes. Fix: one batch/transaction or idempotent server mutation; await, quiet failure state, restore on failure; record model/policy version + content-free reason; repeat-safe actions.

### P1 — A11Y-01: viewport and color tokens fail the accessibility promise

`index.html` disables user zoom (`maximum-scale=1, user-scalable=no`); `--text-muted` ≈3.64:1 on white / 3.36:1 on main light bg; `--text-faint` ≈2.27:1; dark faint ≈3.09:1; used hundreds of times incl. 10–13px. Fix: restore pinch zoom; normal-text tokens ≥4.5:1; split decorative/placeholder/disabled/readable-secondary tokens; automated contrast checks + 200% text screenshot tests.

### P1 — A11Y-02: high-value controls pointer-only or too small

Entry textarea placeholder-as-label; story/insight cards as clickable divs without button semantics/keyboard/aria-expanded; task/open-loop controls 16–24px hover-only. Fix: native buttons/inputs; programmatic labels, aria-expanded/controls; visible focus; ≥44×44 CSS px targets; VoiceOver rotor, dynamic type, keyboard-only, reduced-motion testing on capture/Home/Insights/tasks/loops.

### P1 — CAP-02: wake-lock state and processing copy do not match durable custody

`useWakeLock` single `isLocked` for desired+current state (loses reacquire info); video fallback may miss user-gesture requirement; lock starts after recording stops, not for the whole web session; copy says keep app open though recording is already secured; dead legacy background-audio hook still invoked. Fix: track `shouldStayAwake` separately; reacquire on visibility while operation active; gesture-start the fallback; lock at recording start for web; remove dead hook + quarantine unowned legacy audio keys; copy → "Your recording is saved. Processing may pause and resume if you leave."; no background-completion promise until CAP-01 passes the device matrix.

### P2 — PERF-01: core shell ships too much code

Main bundle ~1.02MB, Firebase chunk ~514KB, CSS ~1.25MB; default-off features in the initial graph via static imports; App.jsx/functions/index.js/InsightsPage.jsx are integration monoliths. Fix: capture-first performance budget with device-measured cold-launch/capture-ready/post-stop/saved-entry metrics; lazy-load reports/experiments/deep insights/visualizations/PDF/flag-off routes; split functions by domain; extract state machines; deliberate WOFF2/subset strategy; CI bundle-budget gate.

### P2 — QA-01: green tests contain avoidable blind spots

Validation passes while suites emit expected console errors; account-switch matrix misses the newly identified global keys; device matrix implies flag coverage that can't be exercised. Fix: fail on unexpected console.error/warn (per-test allowlist); generate account-switch tests from the storage registry; mark device rows "blocked by integration"; require rules emulator in CI with published artifact; contract tests enumerating flag-on/off consumers at every cutover.

### P2 — OPS-01: flags describe code availability, not product readiness

Fix: one generated feature manifest connecting source default, deployed value, cohort, dependencies, announcement state, product metric, rollback trigger, physical validation status; every promotion an experiment (owner, metric, cohort, duration, rollback); roll out coherent stacks; delete flags + legacy paths after rollback windows. (`insightClaims` lacks announcement metadata; PROJECT_STATUS.md too long/manual to be the runtime source.)

### P2 — AUTH-01: native Google auth has too many success paths

Native bridge + hardcoded function URL + REST fallback + custom-token exchange + polling + restart alert. Fix: one explicit state machine; one configured endpoint source; success only on Firebase SDK authenticated-user emission; observable/testable fallback selection; remove obsolete paths after one stable release.

## Prioritized delivery plan

### Phase A — Trust and release blockers

| Workstream | Scope | Acceptance gate |
|---|---|---|
| A1. Storage isolation | PRIV-01 and PRIV-02 | Two-account matrix green; no sensitive value logging; accurate privacy copy. |
| A2. Insight/report integrity | REP-01 and INS-01 | One claims-mode feed contract; period fixtures green; no legacy proactive items. |
| A3. Capture background path | CAP-01 and CAP-02 | Physical-device matrix green; recovery and duplicate tests green; honest UX copy. |
| A4. Security baseline | SEC-01 | No broad ATS allowance, no runtime PDF CDN, headers/CSP verified. |
| A5. Critical accessibility | A11Y-01 plus capture/insight semantics from A11Y-02 | Pinch zoom, 200% text, contrast, VoiceOver, and 44 px controls pass. |

If capacity-constrained, ship A1 + A2 first, keep background-upload and external rollout disabled, and make A3–A5 the next release gate rather than weakening acceptance criteria.

### Phase B — Quality learning loop
1. End-to-end intent evaluation corpus and shadow mode. 2. Correction Inbox vertical slice for tasks/open loops/entities. 3. Atomic correction mutations and downstream invalidation. 4. Runtime model manifest and per-workload evaluation harness. 5. Product-quality dashboard.

### Phase C — Trustworthy insight experience
1. Insight Change Log. 2. Supporting/counterevidence receipts. 3. Coverage and Blind-Spots Map. 4. Calm Weekly Review. 5. Source-linked Ask Journal.

### Phase D — Reach and richer input
1. Home/Lock Screen capture widget. 2. User-controlled Threads and personal glossary. 3. Scoped Session Share Package. 4. Multimedia/share sheet after its privacy design.

## Recommended new features (summaries — full rationale in the source brief)
1. **Correction Inbox / Teach Engram** — build next (Phase B). One calm queue for intent/entity/source/insight corrections with downstream recompute; content-free correction taxonomy; no guilt mechanics.
2. **Insight Change Log** — after feed cutover; new/strengthened/weakened/retired + data-through date + prior-version link.
3. **Supporting and Counterevidence View** — with receipts; supporting days, non-supporting comparable days, missingness, confounds, what-would-change-this.
4. **Calm Weekly Review** — 5–10 min optional ritual; changed insights, small correction queue, accepted tasks, experiment check-ins; no streaks.
5. **Coverage and Blind-Spots Map** — before increasing insight frequency; journal/comparable days, health coverage, scope, missingness, sensitive-day exclusions; no failure framing.
6. **Source-linked Ask Journal** — links to exact entries; scope filters; direct-recall vs synthesis vs inference; "not enough evidence" first-class.
7. **Home/Lock Screen quick capture widget** — after reliability gate; one-tap voice/text into the trusted capture state.
8. **User-controlled Threads** — pin/merge/rename/archive/split; user owns final structure.
9. **Personal Glossary and Entity Aliases** — pair with Correction Inbox; never silently rewrite old entries.
10. **Scoped Session Share Package** — export-first with redaction preview.
11. **Multimedia attachments** — later P3, after owner-scoped storage/encryption/metadata design.
12. **Optional edit-before-save transcript** — small experiment; save-now default.

## Consolidate/pause/remove
Retire legacy Nexus proactive paths post-rollout; unify feedback in the Correction Inbox; reduce Home by default; pause low-evidence surfaces (auto Stories, Goals widgets, social insights, burnout widgets, gap prompts) absent metrics; no streaks/shame prompts; delete dead hooks, stale model args, expired flags, legacy storage paths post-migration.

## Definition of done for any intelligence feature
User understands what was inferred and from which sources; sensitive/excluded sources fail closed; explicit time range + data-through; graceful abstention; correctable/dismissible/undoable; corrections reach every downstream consumer; auditable history that never reappears as current truth; owner-scoped locally and remotely; accessible (VoiceOver, keyboard, 200%, zoom, reduced motion, compact viewports); observable latency/model/prompt-version/fallback/failure without content; flag-on/off/migration/rollback/account-switch/offline/duplicate-callback tested; product metric + rollback threshold exist.

## Sprint-ready issue list

| ID | Priority | Issue | Owner |
|---|---:|---|---|
| PRIV-01 | P0 | Account-scope all sensitive local state + registry/migration | Platform |
| REP-01 | P0 | Make report analytics and claims period-honest | Insights/backend |
| INS-01 | P0 | Complete claims cutover on Home + all proactive consumers | Insights/frontend |
| CAP-01 | P0 | Wire signed direct native background upload end to end | iOS/backend |
| PRIV-02 | P1 | Remove health logs; correct health/location privacy copy | Platform/product |
| SEC-01 | P1 | ATS, CSP/headers, bundled PDF dependency | Platform/security |
| MOD-01 | P1 | Stable-model benchmark + deployment manifest | AI platform |
| MOD-02 | P1 | Fix transcription fallback registry bypass | Backend |
| INT-01 | P1 | Raw-text end-to-end intent evaluation + shadow gate | AI/product |
| INT-02 | P1 | Make suggestion actions atomic and failure-visible | Frontend/backend |
| A11Y-01 | P1 | Restore zoom; repair contrast token system | Design/frontend |
| A11Y-02 | P1 | Fix semantics, labels, focus, touch targets | Frontend |
| CAP-02 | P1 | Correct wake-lock state machine + processing copy | Frontend |
| PERF-01 | P2 | Capture-first bundle split + domain extraction | Frontend/backend |
| QA-01 | P2 | Strict console, generated storage matrix, honest device gates | QA/platform |
| OPS-01 | P2 | Generated feature rollout manifest + KPI/rollback contract | Product/platform |
| AUTH-01 | P2 | Consolidate native Google auth state machine | Platform |

## Final product judgment
Engram should not compete by generating the largest number of interpretations. Its defensible product is a private, durable memory system that can show its work, change its mind, and learn from correction. The next release should make the architecture consistent across accounts, surfaces, time windows, and background states. The next major feature should then give users one place to teach the system when it is wrong.
