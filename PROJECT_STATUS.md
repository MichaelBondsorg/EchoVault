# Engram Project Status

> **Last Updated:** 2026-07-22 (R3 — Personal Experiments — shipped flag-gated OFF; Michael's review hardening pass — GR1/GR2/EX1/EX2 — also complete, flag-gated OFF)
> **Updated By:** Claude (via conversation with Michael)

---

## Current Phase

**Pre-launch.** 2 users (Michael + 1). Validating core value proposition before broader release.

**North Star:** Make insights so good users think "holy shit, I didn't realize that about myself."

---

## Active Work

| Item | Status | Notes |
|------|--------|-------|
| **Trustworthy Capture Sprint + Intelligence PRD** | 🔄 In Progress | Plan: `docs/superpowers/plans/2026-07-20-trustworthy-capture-and-intelligence.md`. Batch 1 (WS-A security) DONE: server-authoritative fail-closed AI consent on all AI jobs, revocation cancels queued work, owner-scoped WHOOP/embedding caches, CI bundle-endpoint guard, trigger idempotency + watchdog lease. Intent system (PRD 0B, I1-I4) DONE behind `intentExtraction` (default off). **R1 (batches R1-1..R1-4) DONE** — plan: `docs/superpowers/plans/2026-07-20-r1-follow-through.md` — all default OFF: Open Loops (`openLoops` — `OpenLoopsWidget` max-3-due, answer/snooze/close, `IntentSuggestionTray`, in-app only, no notifications), Context Spaces (`contextSpaces` — `spacesService`, `SpaceManager`, strict `scopeFilter` enforced at 7 retrieval seams), Insight Budget (`insightBudget` — quiet/balanced/exploratory caps + 90-day dedup). Eval fixture set grown to 67 (task 14). **R2 (batches R2-1..R2-8) DONE, flag-gated OFF** — plan: `docs/superpowers/plans/2026-07-21-r2-trust-surfaces.md` — Insight Receipts + Control Center (`insightReceipts`: every proactive insight carries a receipt at generation time, reversible source exclusions with ≤10s staleness fan-out), Voice Chapters (`voiceChapters`: metadata-only `transcription.chapters`, rename/merge/remove, raw text/audio never mutated), Reflection Recipes (`reflectionRecipes`: versioned, scope+exclusion-honoring, editable runs), Session Prep (`sessionPrep`: since-date/scope-explicit brief + safety-reviewed jsPDF export), Gentle Revisit (`gentleRevisit`: server-side no-LLM selection job, six non-negotiable safety rules, stays internal until the safety memo below is signed). R1's offline `spaceId` gap is now closed (R2 Task 1). Digest retired (`generateWeeklyDigests` deleted from source — was writing an unreadable doc); reports deliberately stay all-spaces (ratified decision, ships receipts + a `scope:'all_spaces'` label instead of per-space scheduling). See runbook's "R2 flags" section; full row/mutation-check detail in `.superpowers/sdd/task-21-report.md`. **Michael's outstanding checklist (blocks flipping any R2 flag on):** (1) veto window on the 8 ratified R2 product decisions below (Recent Decisions, 2026-07-21); (2) **DONE 2026-07-22:** Michael ran the digest delete; the functions workflow re-run succeeded — `gentleRevisitDaily` is deployed, `generateWeeklyDigests` is gone, all deploy workflows healthy, functions fully current with main (rules were already live: the rules RELEASE step preceded the old failure, CI emulator suite 187/187); (3) on-device `markChapter` sanity check (`docs/quality/device-validation-matrix.md`) before `voiceChapters` reaches native users — the Xcode-build half is DONE (2026-07-22: simulator Debug build BUILD SUCCEEDED under Xcode 26.2 with all four Capture/*.swift files confirmed in the App target, so Task 13's Swift compiles clean; only the physical-device mic tap remains); (4) **SIGNED 2026-07-22** (both boxes: main sign-off + scope-adjacency confirmation — Michael's explicit in-session "approved", recorded in the memo with attribution): `docs/quality/gentle-revisit-safety.md` — the flag also gates the server sweep, but the memo is a separate, non-negotiable PRD gate. **REVISED 2026-07-22 (GR1 hardening) — Michael must read the UPDATED memo; any prior read does not carry forward:** new rule 0 (legacy fail-closed re-screen), new rule 7 (current-state gate: 14-day recent safety-signal/sustained-low-mood pause, both server and client), new rule 9 (weekly cadence), amended rule 3 (adjacency widened to warning-indicator entries, not just flagged ones) and rule 4 (floor 0.4→0.6, `PREFERRED_MOOD` 0.6→0.7), the "100% safety-fixture exclusion gate" claim renamed to "100% coverage of the stated exclusion rules" with an explicit non-clinical-sufficiency caveat, and a new section acknowledging the AI-Moment-Picker scope adjacency (deterministic selection isn't a lower-stakes surface). The open grief/trauma/crisis question is unchanged — still unresolved; (5) flag-flip order when ready: `insightReceipts` → `voiceChapters` → `reflectionRecipes` → `sessionPrep` → (only after the memo) `gentleRevisit` — each is independently rollback-able (runbook); (6) R1 leftover, still open: manual cold-start last-space check before `contextSpaces` defaults on; (7) ~~provision the three R2 composite indexes~~ **DONE 2026-07-22 (agent-run, Michael-sanctioned):** all three created via `gcloud firestore indexes composite create --project=echo-vault-app` — `source_exclusions(entryId,appliesTo)`, `entries(safety_flagged,createdAt)`, `recipes(state,name)` — all three verified **READY** in production (2026-07-22) — no index work remains before any flag flip on the original three. **GR1 hardening added a 4th composite index** — `entries(has_warning_indicators,createdAt)`, backing the new warning-indicator anchor query — **ALREADY PROVISIONED 2026-07-22 by the controller via `gcloud`** (same command pattern as the other three, now in the runbook); spot-check that it shows **READY** in production before `gentleRevisit` is ever flipped on, same verification step as items (7)'s original three. **R3 (batches R3-1..R3-4) DONE, flag-gated OFF** — plan: `docs/superpowers/plans/2026-07-22-r3-personal-experiments.md` — Personal Experiments (`personalExperiments`: 14/28-day observational experiments over a template-catalog variable pair, `src/services/experiments/`, entirely client-side — no scheduled function, no LLM call anywhere in the pipeline; plan-freeze enforced in both `firestore.rules` and `experimentsService.js`; insufficiency below spec thresholds is a first-class no-estimate result state; every result carries a receipt; unsafe/medical/crisis questions declined via `questionGate.js`, fail-closed on ambiguity). See runbook's "R3 flag" section; full row/mutation-check detail in `.superpowers/sdd/task-7-report.md`. **Michael's outstanding checklist additions for R3 (accumulates onto the R2 list above, does not replace it):** (8) **SIGNED 2026-07-22** (both boxes: main sign-off + exploratory-limitation Product Acceptance — same in-session "approved", recorded with attribution): `docs/quality/experiments-data-method.md` — the same non-negotiable memo-gate pattern as item (4)'s Gentle Revisit memo, this time for the data-method/statistical-design choices (min paired observations, coverage floor, median-split-and-bootstrap, non-causal wording). **REVISED 2026-07-22 (EX1/EX2 hardening) — Michael must read the UPDATED spec; any prior read does not carry forward:** added the group-size/imbalance/exposure-contrast guards, the binary split mode, the per-resample split with its documented resample-fallback policy, leave-one-day-out stability diagnostics, and a small-effect (<5 display points) threshold; corrected the bootstrap's "no distributional assumption" claim to an honest assumptions list with a serial-correlation caveat and moving-block-bootstrap noted as future work; added a "coverage measures completeness, not representativeness" MNAR caveat; replaced the CI-spans-zero fixed copy; and (EX2) added 0-100 mood normalization with a frozen `outcome.unit`, local-calendar-day pairing with the partial-start-day rule, the immutable-original-result + reasoned-exclusion-history contract, missing-tags-counted-as-unknown, the sensitive-day count disclosure, and co-movement template copy; (9) veto window on the 8 ratified R3 product decisions below (Recent Decisions, 2026-07-22), plus the 3 execution-time decisions made during the build; (10) **no new manual composite index needed for `personalExperiments`** — unlike the three R2 indexes in item (7), `subscribeExperiments` is a plain `collection(...).orderBy('createdAt','desc')` subscribe with zero `where()` clauses anywhere in `src/services/experiments/*.js` (verified by grep), which Firestore's automatic single-field indexing already covers — nothing to provision before this flag flips. **Hardening pass (2026-07-22) DONE, flag-gated OFF (unchanged) — Michael's direct expert review of both features.** Plan: `docs/superpowers/plans/2026-07-22-michael-review-hardening.md`. 4 tasks implemented and adversarially reviewed on main: GR1 `0899698` (Gentle Revisit server hardening + safety memo rewrite), GR2 `ec3bb08` (opt-in exclusions step before first enable), EX1 `25c3e45` (estimator statistical hardening + spec), EX2 `7ba13cd`+`f805fd1` (experiments pipeline + UI hardening). Headline changes: Gentle Revisit gains a current-state gate (14-day recent safety-signal/sustained-low-mood pause, enforced both server- and client-side), legacy entries fail closed (re-screened from text, never defaulted safe), mood floor 0.4→0.6, a weekly selection cadence, and a pre-enable exclusions step; Experiments gains group-size/imbalance/exposure-contrast guards, a binary split mode for 0/1-coded exposure, a per-resample split with a documented fallback policy, leave-one-day-out stability diagnostics, 0-100 mood-scale normalization (fixing a launch-blocker where real 0-1 `mood_score` data would have displayed as "0.35 points" instead of "35 points"), local-calendar-day pairing with a partial-start-day rule, an immutable original result with reasoned exclusion history, missing-tags-counted-as-unknown (never "absent"), a sensitive-day contributing-count disclosure, and co-movement (non-causal) template copy. Both safety memos were revised and re-gated — see checklist items (4)/(8) below, now updated for the headline doc changes. Validation matrix gained rows (h1)-(h8) exercising every invariant above against the real hardened modules (`.superpowers/sdd/task-qah-report.md`). Next: work both checklists, then flip flags one at a time. **R4 Phase 0 (Insight Integrity — deep-review adoption) COMPLETE 2026-07-22, no new flag.** Plan: `docs/superpowers/plans/2026-07-22-r4-insight-integrity.md`, adopting Michael's external deep review of the legacy Nexus/basicInsights engines as owner direction. Batches R4-0a (T1-T4, parallel) + R4-0b (T5, T6): a versioned entry-schema adapter fixing five basicInsights engines' field-location bugs + a live crash (`entryAdapter.js`), complement-baseline (non-overlapping exposed-vs-not) + unique-day-gating floors, personal/brand literals stripped from Nexus pattern-detection triggers (curated + lint-tested `GENERIC_TRIGGERS`), the internal 0-1 `Mood01` convention applied consistently (previously always-true/always-false scale-mismatch bugs in counterfactual/beliefDissonance/synthesizer), reports reading the real singleton `nexus/insights` doc + real `mood_score` field, and user feedback/dismissals becoming durable, consumed inputs (false-positive filtering, content-keyed Nexus dismissals surviving id churn, suppression fails toward holding for unstamped legacy docs). **Versioned cutover, not data migration** (ratified decision 2): `generatorVersion` (currently 2) stamped on every new generation; a user's first post-deploy Nexus generation archives any pre-R4 `active` insight into `history` with `legacyVersion: true` (nothing deleted); basicInsights' cache doc is invalidated-once on version mismatch via its existing staleness check; regeneration is entirely client-side/on-demand (no backfill job). Four claim types the Mood01 fix would otherwise reactivate (personal counterfactuals, belief dissonance, intervention outcomes, personalized recommendations) stay suppressed/relabeled behind an internal `RISKY_CLAIMS_ENABLED = false` constant (not a flag) until Phase 1-2's evidence rails land. Validation matrix gained R4 rows (a)-(i). See runbook's "R4" section; full detail `.superpowers/sdd/task-{1,1b,2,3,4,5,6}-report.md`. **One disclosure correction to T1's own report:** its "no display-scale changes" claim (`baselineMood`/`activityMood`/`categoryMood` fields kept their meaning) is accurate for activity/category/health-extended/themes, but `peopleCorrelations.js`'s equivalent `baselineMood`/`entityMood` fields were dropped entirely in the same rewrite (verified: pre-R4 `peopleCorrelations.js` wrote both, current version writes neither) — harmless (grepped `src/components`+`src/pages`: zero UI reads of either field, on any engine) but the T1 report's framing understated it as "unchanged" rather than "removed, safely." Phases 1-2 (canonical claim store, verified synthesis) remain outlined-not-started. |
| **Phase 1: Fused Transcription + Durable Audio Vault** | ✅ Complete | Merged as PR #145; superseded by Cloud capture release #149. |
| **Nexus 2.0 Insights Engine** | ✅ Complete | All 4 layers implemented (pattern detection, baselines, LLM synthesis, interventions) |
| **Multi-Provider Authentication** | ✅ Complete | Google, Apple (iOS only), Email/Password with MFA support |
| **App Store Readiness** | ✅ Complete | Crashlytics, Fastlane, testing, accessibility, performance optimization |
| **Architecture: App.jsx → Zustand** | ✅ Complete | All 39 useState calls migrated to 5 Zustand stores. 0% → 100% adoption. |
| **Hearthside Visual Overhaul** | ✅ Complete | Custom therapeutic palette, dark mode, typography hierarchy (18 sections, 737 tests) |
| Health & Environment Insights UI | ✅ Complete | Correlation insights, context prompts, recommendations, environment backfill |
| Entity Management (Milestone 1.5) | ✅ Complete | Entity resolution for voice transcription + migration from older entries |
| HealthKit Integration (Expanded) | ✅ Complete | Sleep stages, smart merge with Whoop, health backfill feature |
| Whoop Integration | ✅ Complete | OAuth working, cloud sync, recovery/strain/sleep data |

---

## Roadmap / Future Work

| Item | Priority | Plan Document | Notes |
|------|----------|---------------|-------|
| **Architecture: Remove Compatibility Wrappers** | Low | N/A | Gradually update components to use store actions directly (e.g., `showInsightsPanel()` instead of `setShowInsights(true)`). |
| **Architecture: Component Extraction** | Medium | `.claude/plans/eventual-floating-rabin.md` | Now that state is in Zustand, child components can be extracted from App.jsx with direct store imports. |
| **Architecture: Cloud Functions Split** | Medium | `.claude/plans/eventual-floating-rabin.md` | Move functions from `functions/index.js` to domain modules. Shared utilities already extracted. |
| **Architecture: TypeScript Migration** | Low | `.claude/plans/eventual-floating-rabin.md` | Convert critical paths (.js → .ts). Foundation ready with `src/types/` definitions. |
| **App Rename: Engram → Engram** | Medium | `docs/ENGRAM-RENAME-PLAN.md` | Name reserved in App Store Connect. 9-phase implementation plan ready. Requires domain setup (theengram.app), OAuth console updates. |

---

## Current Priorities (Ordered)

1. **Get 10 external users** — Need real feedback beyond Michael
2. **Collect feedback** — Instrument what insights get engagement
3. **Iterate** — Based on what users actually respond to
4. **App Store submission** — Submit to iOS App Store and Google Play

---

## Recent Decisions

| Date | Decision | Why | Revisit If |
|------|----------|-----|------------|
| 2026-07-20 | AI consent is server-authoritative + fail-closed: settings/consent doc is the single authority; entry fields can only deny, never grant; consent-read failure denies the job; missing doc = legacy default-on | Client-writable entry fields were the trust boundary (spoofable); legacy default avoids breaking pre-consent-doc users | After a consent-doc backfill migration, flip missing-doc to deny |
| 2026-07-20 | CI hosting builds default VITE_VOICE_RELAY_URL to the public prod wss URL (secret overrides); build fails if any bundle contains ws:// or localhost:8080 | Secret was never set; CI-built bundles would have shipped ws://localhost. URL is public, not a credential | Relay endpoint changes or becomes environment-split |
| 2026-07-20 | Model migrations (PRD 0A) go through a server-owned registry behind flags; gpt-5.6-terra NOT adopted (limited preview); embedding v2 = dual-field, never mixed vector spaces | text-embedding-004 + gemini-2.0-flash are past shutdown dates; registry makes rollback a data change, not a deploy | Terra reaches GA with favorable pricing |
| 2026-01-13 | Replace entire insights system with Nexus 2.0 | Current system produces correlation-level insights ("X boosts mood 30%") not causal insights with mechanisms. Fundamental architecture limitation, not fixable incrementally. | Implementation takes >3 weeks |
| 2026-01-13 | Belief dissonance feature ON by default | Core differentiator. Surfaces gaps between stated beliefs and behavioral data. Opt-out sufficient protection. | Multiple users complain it feels judgmental |
| 2026-01-13 | Mood gate at 50% for challenging insights | Don't surface belief dissonance when user is already struggling | Users want it lower/higher |
| 2026-01-13 | Personal baselines, not population averages | "HRV is low" means nothing without knowing what's normal for THIS user | N/A - this is fundamental |
| 2026-01-13 | Narrative-first AND biometric-first patterns | Some insights only emerge from narrative (beliefs), others only from biometrics (recovery). Need both. | N/A |
| 2026-01-13 | Skip formal PM tooling / agents | Overhead not worth it at 2 users. Living docs > process theater. | Hit 50+ users or multiple contributors |
| 2026-01-13 | ~$1.20/user/month LLM budget acceptable | At $9.99 subscription, 88% margin is healthy. Build expensive first, optimize later. | Costs exceed $2/user or scale issues emerge |
| 2026-01-14 | Server-side entity resolution in Cloud Functions | Whisper mishears names (Lunar→Luna). Resolve after transcription before analysis. Server-side avoids browser limitations. | Performance issues at scale |
| 2026-01-14 | Entity migration function for older entries | Users have entries but empty entity list. Migration extracts @person/@pet/@place tags into memory/core/people collection. | N/A - one-time backfill |
| 2026-01-14 | 65% fuzzy match threshold for entity resolution | Lower catches more typos but risks false positives. 65% balances "Lunar"→"Luna" (80%+ match) while avoiding "Mike"→"Luna" (20% match). | Too many false corrections |
| 2026-01-15 | Smart merge Whoop + HealthKit | When both sources connected: Sleep/HRV/Recovery from Whoop (24/7 tracking), Steps from HealthKit (Whoop doesn't track steps). Best of both worlds. | User prefers single source |
| 2026-01-15 | Health backfill user-triggered | Button in Health Settings to retroactively add health data to old entries. User-triggered (not automatic) to give control. | N/A |
| 2026-01-15 | Whoop secrets in Cloud Run Secret Manager | OAuth credentials stored as secrets, not env vars. Relay server handles token exchange and encrypted storage in Firestore. | N/A |
| 2026-01-15 | iOS local analysis for offline + latency | iOS gets <200ms local classification/sentiment vs ~5s server. Full offline journaling (except AI chat). Single codebase with runtime platform detection via Capacitor. | Local accuracy < 80% |
| 2026-01-15 | Native Swift sleep score calculation | Sleep score computed in Swift (<10ms) vs JS for maximum iOS performance. Falls back to JS if native fails. | N/A |
| 2026-01-15 | VADER-style local sentiment (no ML model) | Lexicon-based sentiment analysis with intensifiers, negation, emoji handling. Avoids Core ML complexity while achieving good accuracy. | Accuracy issues warrant ML |
| 2026-01-15 | Environment backfill via Open-Meteo | Weather history API (free, no account) to retroactively add weather data to entries from last 7 days. User-triggered in Health Settings. | API reliability issues |
| 2026-01-15 | Client-side correlation computation | Health-mood and environment-mood correlations computed in browser vs server. Instant feedback, no LLM cost. Statistical only. | Performance issues on large entry sets |
| 2026-01-15 | Context-aware prompts from health/environment | PromptWidget shows personalized prompts based on today's health data (low sleep, low recovery) and environment (low sunshine). High priority contexts get featured. | Users find prompts intrusive |
| 2026-01-15 | Recommendations based on intervention effectiveness | Daily suggestions pull from tracked intervention effectiveness (what activities help this user). Only show if user has baselines computed. | N/A |
| 2026-01-16 | Permanent insight dismissal persists to Firestore | Dashboard insight X button now adds to `insight_exclusions` collection with `permanent: true`. Insights filter against exclusions on load. | Users want undo capability |
| 2026-01-16 | Unified backfill pipeline: health → weather → insights | Retroactive enrichment runs in sequence: health backfill first, then weather (needs location from entries), then insight reassessment. User-triggered in Settings. | N/A |
| 2026-01-16 | Primary Readiness Metric on entry cards | Whoop users see Recovery Score prominently (battery icon). HealthKit-only users see Sleep Score. Shows at-a-glance health context without clutter. | Users find it distracting |
| 2026-01-17 | Vitest for testing framework | Fast, Vite-native, excellent mocking. Module aliasing to mock Capacitor/Firebase dependencies in tests. | N/A |
| 2026-01-17 | Crashlytics via @capacitor-firebase/crashlytics | Industry standard crash reporting, integrates with Firebase Console. Wrapper service for graceful web fallback. | N/A |
| 2026-01-17 | Fastlane for App Store deployment | Automates screenshots, metadata, builds, and uploads. Separate configs for iOS (TestFlight/App Store) and Android (Internal/Beta/Production tracks). | Manual deployment preferred |
| 2026-01-17 | iOS Privacy Manifest (PrivacyInfo.xcprivacy) | Required for iOS 17+. Declares all data types collected and API usage (UserDefaults, file timestamps). | N/A |
| 2026-01-17 | Vendor code splitting in Vite config | Separate chunks for react, firebase, UI libs. Keeps main bundle manageable. Uses rollup manualChunks. | Bundle size issues |
| 2026-01-17 | Console.log stripping in production | `esbuild.drop: ['console', 'debugger']` in vite.config.js. Reduces bundle size and prevents debug leaks. | Need production debugging |
| 2026-01-17 | Android ProGuard minification enabled | `minifyEnabled true`, `shrinkResources true` for release builds. Significantly reduces APK size. | ProGuard rule issues |
| 2026-01-18 | Multi-provider auth (Google, Apple, Email) | iOS App Store requires Apple Sign-In when offering other social logins. Email/password gives non-social option. | N/A |
| 2026-01-18 | Apple Sign-In iOS-only for now | Web Apple Sign-In requires Apple Developer Service ID configuration. Will enable once app name finalized. | App name decided |
| 2026-01-18 | MFA support via Firebase TOTP | Users can enable authenticator app MFA. Handled gracefully during email sign-in flow. | N/A |
| 2026-01-18 | Cloud Function for Apple token exchange | Native iOS Apple Sign-In returns identity token, exchanged server-side for Firebase custom token. Same pattern as Google. | N/A |
| 2026-01-19 | Web entries enriched on mobile | Web can't access HealthKit/Google Fit. Entries created on web get `needsHealthContext: true` flag and are enriched when user opens app on mobile. | If users never open mobile app |
| 2026-01-19 | Batch health enrichment at app init | Process up to 20 entries needing health data on mobile app startup. Rate-limited with 200ms delay between entries. | Performance issues on app launch |
| 2026-01-19 | Timeout wrappers for Whoop relay | 10s timeout on relay fetch, 5s on auth token. Returns cached data on timeout rather than failing silently. | Timeouts too aggressive |
| 2026-01-20 | App.jsx state migration to Zustand | All 39 useState calls migrated to 5 domain stores. Compatibility wrappers added for gradual component updates. | Components can be updated to use store actions directly over time |
| 2026-01-20 | resetAllStores() on logout | Clears all Zustand state when user logs out. Prevents data leakage between users. | N/A |
| 2026-02-20 | Hearthside therapeutic palette over generic Tailwind | Custom warm-tinted palette (hearth, honey, sage, terra, lavender) conveys therapeutic calm. Generic blues/greens felt clinical. | If branding direction changes |
| 2026-02-20 | 3-state dark mode (dark/light/system) | Respects OS preference by default, user can override. FOUC prevention via inline script in index.html. | N/A |
| 2026-02-20 | 4-tier dark surface hierarchy | hearth-950 (base) → 900 (panels) → 850 (cards) → 800 (overlays). Prevents flat "black box" dark mode. | Users find it too subtle |
| 2026-02-20 | Fraunces/DM Sans/Caveat font stack | Display font (headings), body font (UI), handwritten accent (sparingly). Caveat loaded with display=optional to prevent FOUT. | Performance issues on low-end devices |
| 2026-07-10 | Fused Gemini transcription (transcribeEntry) replaces whisper+regex+tone 3-hop | Better cleanup (model hears audio), 1 call, ~3x cheaper | Gemini quality regressions or pricing change |
| 2026-07-10 | Raw audio kept 7 days in local vault, never gated on cloud | Lost recordings are the #1 trust killer in voice apps | Storage pressure complaints |
| 2026-07-20 | Open loops auto-activate on explicit commands (no onboarding gate) | An explicit "ask me Friday" / "remind me" already states clear intent; gating it behind a tutorial adds friction for zero precision benefit — the activation policy's structural checks are the safety net, not a UI gate. Surfaces via the Captured row + Undo, same as any other active intent. | Users report loops surfacing surprises they didn't mean to author |
| 2026-07-20 | Space capture defaults unscoped, then remembers the last explicitly-chosen space | New/undecided users aren't forced to pick a space before every entry; once they do pick one, `settings/spacePrefs.lastCaptureSpaceId` carries it forward so repeat use of the same space (e.g. "Work" during the week) doesn't require re-selecting every time. | Users report the remembered default surprising them (wrong space auto-applied) |
| 2026-07-20 | Ask Journal scope defaults to the last capture space when any spaces exist, else "All" (chip hidden until spaces exist) | Matches the mental model users are already in ("I'm mostly asking about Work stuff right now") without an extra selection step; hiding the chip for zero-space users avoids introducing UI for a feature they haven't opted into. | Users frequently override the default — chip should default to "All" instead |
| 2026-07-20 | Context Space filtering is strict, not permissive: unscoped entries are EXCLUDED from a scoped query, never merged in | A "Work" query silently including unscoped legacy entries would be a trust regression (exactly the cross-space leak the PRD exists to prevent) — better to under-return (user can switch to "All") than to leak. | Users complain a scoped query "misses" old entries they expected to see |
| 2026-07-20 | Loop dismissal is final in v1 — no restore path | Simplicity for the first ship; a wrong dismissal is low-cost (the source entry is untouched, and the underlying thread can resurface naturally in a later entry). Restore requires deciding what "undismissing" even re-activates (state? notifications?) — deferred rather than guessed. | Users report losing loops they meant to keep and want a restore/undo |
| 2026-07-20 | Open Loops are in-app only in v1 — no push notifications | Notification authority requires iOS `aps-environment` entitlement + background mode + an explicit per-loop authorization UI, none of which exist yet; shipping loops without notifications is still a complete, useful feature (the home widget covers the "did I forget" need) and avoids shipping notification infrastructure half-built. | Users report never seeing due loops because they don't open the app on the due day |
| 2026-07-21 | Retire `generateWeeklyDigests` | It writes `digests/weekly`, a doc with NO `firestore.rules` read block — clients have never been able to read it. It's cost real Gemini calls every week for a surface that was invisible by construction, and weekly reports already cover the same ground with a user-visible, receipt-carrying surface. **PENDING MICHAEL VETO** (see Active Work checklist). | A future need for an automated, non-interactive weekly summary resurfaces distinct from on-demand reports |
| 2026-07-21 | Voice Chapters v1 is transcript-anchored — no audio playback or audio deep-links | Raw audio is ephemeral by design (7-day vault; the native background path deletes it immediately post-transcription) and no audio player exists anywhere in the app. Markers persist `startMs` so a future durable-audio feature could add playback without re-capturing anything. **PENDING MICHAEL VETO.** | A durable-audio feature ships and audio-anchored chapter playback becomes valuable |
| 2026-07-21 | Scheduled reports/digest stay all-spaces, now labeled (`scope:'all_spaces'` + receipts) instead of per-space scheduled generation | Per-space scheduled generation multiplies compute cost for a 2-user base; scoped reviews arrive via Reflection Recipes instead (on-demand, scope-explicit, no scheduling cost). **PENDING MICHAEL VETO.** | User base grows enough that per-space scheduled reports become cost-justified |
| 2026-07-21 | Nexus insight receipts are client-generated (where Nexus generation lives today), not server-authoritative | Server-authoritative receipts would require Nexus generation to move server-side first, which is not an R2 scope item. **PENDING MICHAEL VETO.** | Nexus generation moves server-side (flag `serverAnalysisOrchestrator`) |
| 2026-07-21 | Session Prep = a specialized recipe template + export composition, reusing the existing client-side jsPDF `TherapistExportScreen` pathway | Avoids building new AI/export machinery; the export stays foreground-only by construction (no new background-export surface to secure). **PENDING MICHAEL VETO.** | Session Prep needs an export template meaningfully different from the therapist-export pathway |
| 2026-07-21 | Voice-relay scope: the relay respects whatever Context Space is active in `UnifiedConversation` at session start; unscoped sessions default to All spaces (today's behavior) | Matches existing default behavior for unscoped users and avoids the complexity of re-scoping a live voice session mid-conversation. **PENDING MICHAEL VETO.** | Users want to switch Spaces mid-conversation without restarting the voice session |
| 2026-07-21 | Chapters are foreground-capture only in v1 — no background (Shortcuts) marking path | Groundwork noted (a signed `x-goog-meta-chapters` header slot) but deliberately not built, keeping v1 scope contained to the flow that already exists. **PENDING MICHAEL VETO.** | Background voice capture via Shortcuts becomes a priority |
| 2026-07-21 | Gentle Revisit ships flag-off and stays internal until Michael reviews and signs the safety memo | PRD hard gate: "Safety research and suppression rules must pass before Gentle Revisit can be enabled outside internal testing." Non-negotiable exclusions (`safety_flagged`, `has_warning_indicators`, user suppressions) are already codified in the selector regardless. **PENDING MICHAEL VETO + memo sign-off — see Active Work checklist item 4.** | Memo is signed off |
| 2026-07-22 | Insight Control Center's "withheld this week" copy reads "showed N of up to M" rather than an exact suppressed-candidate count | `applyInsightBudget` computes a remaining allowance, not a count of specific candidates it rejected — no exact suppressed-count exists anywhere in the budget data model to report honestly. Approximate-but-truthy copy beats a fabricated precise number. | `insightBudget.js` starts tracking suppressed candidates explicitly |
| 2026-07-22 | `RevisitWidget` re-renders a just-revealed card's content on remount when today's `revisit_queue` doc has `status:'shown'` | Deliberate broadening beyond "queued-only" rendering: without this, navigating away and back after tapping Show would yank the just-revealed entry text back behind the preview gate, which reads as a bug, not caution. Preview-without-content still holds for any doc that hasn't been Shown yet. | Users report a revealed card persisting longer than expected across navigation/sessions |
| 2026-07-22 | R3 decision 1: Observational v1 only — PRD P1's A/B or alternating-condition design is deferred outright | The PRD itself orders alternating-condition design after the observational v1 is "understood and safety-reviewed" — building it first would be scope creep ahead of the PRD's own sequencing. **PENDING MICHAEL VETO.** | Observational v1 proves out and users ask for an active-manipulation design |
| 2026-07-22 | R3 decision 2: Passive variables only — zero new check-in surfaces in v1; every variable pair is computed from data Engram already captures | Removes the entire net-new notification/capture scope the exploration flagged as missing; "minimum check-ins needed" becomes zero extra prompts, and the UI shows data *coverage* (never a streak, per PRD). A structured daily check-in surface is deferred until a variable pair genuinely requires it. **PENDING MICHAEL VETO.** | A compelling variable pair requires a new check-in surface to be useful |
| 2026-07-22 | R3 decision 3: Questions resolve to a curated template catalog — typed questions are matched to a template; a question mapping to none, or that trips the safety gate, is declined with a safer reflection alternative (Recipes), never silently coerced | Data-method tractability + safety: arbitrary free-variable experiments are out of scope for v1. Fail-closed on ambiguity (over-blocking acceptable, under-blocking is not) matches the PRD's own safety posture. **PENDING MICHAEL VETO.** | Users frequently hit "unmappable" for genuinely reasonable questions the catalog should cover |
| 2026-07-22 | R3 decision 4: Client-side result computation — results computed on-demand from the user's own entries via a pure estimator module; no scheduled function, no new deploy surface, no consent gate (no provider calls anywhere in the pipeline) | Same posture as R2's client-side Nexus receipts; the result narrative is template-composed, not LLM-generated, so there is nothing for a consent gate to authorize. **PENDING MICHAEL VETO.** | A future version adds an LLM-generated narrative or server-side computation |
| 2026-07-22 | R3 decision 5: No LLM narrative in v1 — result text is assembled from fixed, safety-reviewed template strings with slotted numbers; "plausible alternatives" come from each template's fixed confounder catalog | Makes the non-causal-wording acceptance criterion structural rather than model-behavioral, eliminating retrofitting risk in narrative generation. **PENDING MICHAEL VETO.** | Users want more personalized/contextual result narration than fixed templates can offer |
| 2026-07-22 | R3 decision 6: Experiments are a NEW `experiments` collection, not a reflections `kind`; plan-freeze enforced via `firestore.rules`' `diff().affectedKeys().hasOnly([...])` pattern; result embeds a standard receipt (`buildReceipt` shape) | Experiments have a distinct lifecycle (draft/running/paused/stopped/completed) that doesn't fit the reflections shape; reusing `buildReceipt` keeps provenance consistent with every other receipt-carrying surface in the app rather than reinventing it. **PENDING MICHAEL VETO.** | Experiments and reflections converge into one artifact model |
| 2026-07-22 | R3 decision 7: Estimator consolidation is in-scope for experiments only — one new pure estimator module with a structured `{insufficient}` return; the three pre-existing inconsistent Pearson implementations stay untouched for their current consumers | A later cleanup task may migrate old consumers to the new estimator; not attempting that migration in R3 keeps this task's blast radius contained to the new experiments pipeline. **PENDING MICHAEL VETO.** | The three existing Pearson implementations' magic-zero bug causes a real user-facing issue |
| 2026-07-22 | R3 decision 8: P1 "export experiment receipt in Session Prep" is deferred to a follow-up once experiments have real usage | Building an export integration for a feature with zero real usage yet (flag-gated OFF, pre-sign-off) is premature scope. **PENDING MICHAEL VETO.** | `personalExperiments` ships to real users and Session Prep export demand emerges |
| 2026-07-22 | R3 execution-time decision (i): `paused -> completed` is a legal status transition (`firestore.rules`' `experimentTransitionAllowed`), alongside `running -> completed` | v1's variables are all passive/computed-from-existing-entries — pausing an experiment never blocks the underlying data from continuing to accumulate, so there's no reason completion should require resuming first. Documented in the rules' own comment. | A future active-manipulation (non-passive) variable makes pause-then-complete semantically wrong |
| 2026-07-22 | R3 execution-time decision (ii): `ExperimentsScreen.jsx` auto-completes an elapsed `running`/`paused` experiment on view (client-side, best-effort, `completingRef`-guarded, tested) | Decision 4 commits to "no scheduled function" for result computation, so something client-side has to notice an elapsed experiment and compute its result; doing it in the screen that's already subscribed to the user's experiments is the natural seam, and the in-flight guard prevents a duplicate write on rapid re-renders. | Users routinely have `personalExperiments` on with the app closed at `endAt` and want completion without reopening the screen |
| 2026-07-22 | R3 execution-time decision (iii): result narrative caveats (`confounders`, `whatThisDoesNotProve`) are snapshotted onto `analysisPlan` at create time, not re-looked-up from the template catalog at result time | Without this, a later wording tweak (or removal) of a template in the catalog could silently change or blank out the safety-caveat text an already-`completed` result shows — the same plan-freeze guarantee already applied to the statistical fields (exposure/outcome/lag), extended to the narrative fields. | The template catalog needs a versioned-migration mechanism for existing completed results |
| 2026-07-22 | **Michael-directed (hardening review, ratified — his own review findings, no veto window):** mood floor retuned 0.4→0.6, `PREFERRED_MOOD` reconciled to 0.7 | The 0.4 floor let through entries that were merely "not bad," not genuinely calm — the "calm moment" copy is now honest | Users report Revisit surfacing entries that don't feel calm |
| 2026-07-22 | Michael-directed: weekly cadence — skip a user unless ≥7 days since their last live (queued/shown) `revisit_queue` selection; a dismissed item never trips it | Prevents daily nagging from a feature meant to be a rare bright spot; per-entry re-suppression is `revisit_exclusions`' job, not this gate's | Users want revisits more or less often than weekly |
| 2026-07-22 | Michael-directed: current-state gate (server + client) — pause selection when a user's last 14 days show a live `safety_flagged`/`has_warning_indicators` signal OR ≥3 of their last 7 mood-scored entries are <0.4; fewer than 3 scored entries fails OPEN (disclosed, not resolved) | Directed hardening against resurfacing a positive memory into an active crisis; fail-open on insufficient signal was judged the least-bad default when there isn't enough journaling to tell — explicitly not a solved answer for grief/trauma without enough recent entries | A real incident of a Revisit landing during a bad stretch despite the gate |
| 2026-07-22 | Michael-directed: legacy entries fail closed — an entry missing an explicit `safety_flagged`/`has_warning_indicators` boolean is re-screened server-side from its text; a hit OR unavailable text excludes it (never defaulted safe) | Old/legacy entries the crisis-detection pipeline never ran on were previously coerced to "safe" by omission — exactly backwards for a safety gate | A retroactive analysis backfill runs and stamps real booleans on every legacy entry |
| 2026-07-22 | Michael-directed: rule 3 adjacency widened to also anchor on `has_warning_indicators` entries, not just `safety_flagged` | Consistent with "a crisis entry near a candidate" framing; can only exclude MORE candidates, never fewer | Adjacency proves too aggressive in practice (too few candidates ever eligible) |
| 2026-07-22 | Michael-directed: Gentle Revisit onboarding gains an opt-in exclusions step (hide-by space/person/tag/date) before `enabled` is ever written, with a "skip for now" path | Surfaces suppression controls before the first surprise, not after it | Users universally skip it and never configure exclusions later either |
| 2026-07-22 | Michael-directed: experiment outcomes normalized to 0-100 ("points") at the series boundary; `analysisPlan.outcome.unit` frozen to `mood_0_100`; anything else fails the whole result closed (`unknown_outcome_unit`) | Fixes a launch blocker — real 0-1 `mood_score` data would otherwise have displayed as "0.35 points" instead of "35 points" | N/A — this is a correctness fix, not a policy choice |
| 2026-07-22 | Michael-directed: estimator group-size guards (n≥5 per group, smaller group ≥25% of pairs) + a dedicated binary present/absent split mode for 0/1-coded exposure (e.g. tag presence) | A 3-4-person group produces a mean dominated by a handful of points even when the overall pair count clears the floor; binary mode avoids the tie-heavy median-split instability 0/1 data reliably triggers | A template needs more than two exposure levels |
| 2026-07-22 | Michael-directed: bootstrap recomputes the median/binary split independently within each resample, falling back to drawing from the ORIGINAL groups when a resample's own split degenerates, capped at 10% fallback before the whole result becomes `insufficient` (`split_unstable`) | Holding the original split fixed across the whole bootstrap hid fragility in the split boundary itself | The 10% cap proves too strict or too loose against real user data |
| 2026-07-22 | Michael-directed: leave-one-day-out (LOO) stability exposed as `estimate.stability` (`deltaMin`/`deltaMax`/`signConsistent`) — diagnostic only, no new insufficiency gate | Lets the result narrative soften/caveat a result whose sign flips when any single day is excluded, without hard-blocking it | The narrative needs to gate on instability, not just caveat it |
| 2026-07-22 | Michael-directed: experiment day-boundaries use the user's local IANA timezone (frozen onto `analysisPlan.timezone` at create); day 1 = the first FULL local day after `startAt` (the partial start day is excluded entirely) | Pre-fix, every dateKey was a UTC calendar day — an evening entry already read as "tomorrow" for most non-UTC users | Users report an experiment's day count looking off relative to their calendar |
| 2026-07-22 | Michael-directed: a completed result's original computation is immutable (`result.original`); any post-result exclusion writes `result.adjusted` + an appended `result.exclusionHistory` (reason required: `wrong_data`/`wrong_date`/`other`); the UI always labels an adjusted result "Modified after seeing the result" | Anti-cherry-picking — a user (or their therapist, via export) must always be able to see what the FIRST honest result said | N/A — this is a trust-integrity guarantee |
| 2026-07-22 | Michael-directed: tag-source series counts a day only when the entry was explicitly analyzed for tags (a real `tags` array present); missing/legacy entries are dropped as unknown, never coerced to "tag absent" | A day never screened for a tag is not evidence the tag was absent | N/A |
| 2026-07-22 | Michael-directed: a result discloses the COUNT of contributing sensitive (`safety_flagged`/`has_warning_indicators`) days ("N sensitive days contributed; details hidden"); those rows render as "sensitive day — details hidden" in the observation table, never omitted or excerpted | Sensitive days still count toward the estimate (excluding them would bias it) but their content must never appear in a receipt or table | N/A |
| 2026-07-22 | Michael-directed: experiment template titles/questions reframed to co-movement, non-causal phrasing ("How does X move together with my mood?"); CI-spans-zero copy replaced with plain "compatible with both higher and lower mood" language | Removes causal-sounding framing before Experiments ever reaches a real user | N/A |
| 2026-07-22 | **RESOLVED BY MICHAEL ROUND-2:** dismissal = exposure, 14d. A dismissed `revisit_queue` item now ALSO trips the cadence gate — at its own longer `DISMISSED_CADENCE_DAYS` = 14-day window (2x the unchanged 7-day queued/shown cadence), reversing GR1's original "dismissed never trips cadence" choice recorded here | Michael's round-2 review: an explicit "not now" is a stronger signal than a passive queued/shown exposure, so it should block longer, not be exempt | Usage data suggests 14d is materially too long or too short |
| 2026-07-22 | **Round-2 (Michael-directed, ratified):** EX - template-specific contrast minimums (sleep 1.0h / exercise 15min / steps 2000 / sunshine 15 / recovery 10, frozen on plan); LOO recomputes split+gates per removal (bare-minimum n=10 results structurally sign-inconsistent - correct signal per review adjudication); unit inference deleted (invalid mood values rejected+disclosed, never clamped); bootstrap discard-not-fallback (single estimand per interval); "rough range (exploratory)" labeling + moving-block bootstrap REQUIRED before external release. GR - at-cap safety reads skip selection (coverage unknown = no selection); dismissal counts as exposure, 14d block anchored on the dismissal action (updatedAt, not original selection); reveal is per-session; anniversary blackout days 351-379; scope-adjacency confirmation line added to memo sign-off | Michael's round-2 review; his internal-testing approval is conditional on EX items 1-3 (done) plus the explicitly-accepted exploratory limitation (spec's Product Acceptance section quotes his condition verbatim with its own sign-off line) | Any threshold via memo/spec re-sign; blackout window and dismissed-14d are controller pins for Michael's confirmation |
| 2026-07-22 | **Embeddings v2 migration COMPLETE (Michael-directed).** Client retrieval is space-aware (same-space-or-nothing) behind `model.embeddingV2Read` = ON; `model.embeddingWriteV2` = ON; all 252 entries carry `embeddingV2` (239 dual + 13 gap-backfilled v2-only); versioned query callable (v2 uses RETRIEVAL_QUERY); thresholds unchanged across spaces initially. **Discovery: Google RETIRED text-embedding-004** (404, verified live 2026-07-22) — v1 writes were silently broken for weeks (13 vectorless entries May 7-12 + Jul 10-21); new entries got zero vectors and semantic retrieval was quietly degrading. v2 now carries retrieval alone (M4: independent writes, {v2}-only queries); v1 field frozen legacy. Ranking sanity artifact on real data: healthy separation (spreads 0.07-0.14 over corpus mean). FOLLOW-UP: threadManager thread-dedup embeddings are v1-pinned and degraded since the retirement (documented in runbook, needs its own small migration). | PRD dependency (embedding migration before retrieval-quality judgments) + the retirement made it a fix, not an enhancement | v2 similarity thresholds if retrieval quality feels off in use; threads follow-up |
| 2026-07-22 | Implementation-time choice, FOR MICHAEL'S CONFIRMATION (EX2's own judgment call): `excludedObservations` stays a plain `list<string>` of dateKeys; the reason/history for each exclusion live only inside `result.exclusionHistory`, not duplicated onto `excludedObservations` itself | Achieves the same audit trail with materially less churn to the already-tested pair-filtering code paths | Michael wants reasons duplicated onto `excludedObservations` directly |
| 2026-07-22 | Implementation-time choice, FOR MICHAEL'S CONFIRMATION (EX2's own reading): the small-effect ("worth noticing, not worth reorganizing your life around") copy only fires when the CI does NOT span zero — never layered on top of a "no clear direction" result | EX2's reading of "in addition to, not instead of, the headline number" — no magnitude judgment on a result with no direction | Michael wants a magnitude caveat even on a CI-spans-zero result |
| 2026-07-22 | Implementation-time choice, FOR MICHAEL'S CONFIRMATION (EX2's own judgment call): `localMidnightUtcMs` uses a single-evaluation DST-offset approximation (not a fixed-point iteration) for local-day boundaries | Documented as an accepted v1 approximation ("no library" constraint), not silently assumed exact | A DST-transition-day boundary bug is reported |
| 2026-07-22 | **R4 ratified decision 1 (Michael):** adopt his external deep review (DR) of the legacy Nexus/basicInsights engines as owner direction, phased — Phase 0 containment now, Phases 1-2 (canonical claim store, verified synthesis) planned in detail when reached | DR's legacy-engine findings verified substantially correct at HEAD by the controller; its InsightClaim architecture is near-isomorphic to the already-shipped experiments/receipts stack, so R4 extends that rigor to the legacy engines rather than building greenfield | Phase 1 scoping surfaces a materially different architecture than the DR's proposal |
| 2026-07-22 | **R4 ratified decision 2 — legacy artifact cutover, not migration:** new generations stamp `generatorVersion`; legacy Nexus `active` items are archived to `history` with `legacyVersion: true` on first post-R4 generation (nothing deleted); basicInsights cache invalidated once via the same field; feedback/exclusions are preserved and become consumed inputs (DR finding 10) | A bulk rewrite script for two loosely-structured Firestore doc shapes (a 50-cap history array, a flat cache doc) is more risk than a version-tagged read-time reinterpretation that piggybacks on generation the app already triggers on its own | A future version bump needs the SAME treatment and this pattern proves too manual to repeat by hand |
| 2026-07-22 | **R4 ratified decision 3:** DR's ≥80% comprehension gate applies before BROAD release only, not internal use — Michael's already-signed internal-testing basis stands | Broad-release and internal-testing risk tolerances are legitimately different; re-litigating the internal bar mid-Phase-0 would stall containment work for a criterion that only matters at a later gate | Phase 2 (broad-release prep) begins |
| 2026-07-22 | **R4 ratified decision 4:** fixing the Mood01 scale bugs must NOT reactivate the four claim types it would otherwise wake up (counterfactuals, belief dissonance, intervention outcomes, personalized recommendations) — suppressed/relabeled behind an internal `RISKY_CLAIMS_ENABLED=false` constant until Phase 1-2's evidence rails exist; recommendations relabel to "ideas" with no personal-evidence claim, fabricated fallback reasoning deleted outright | A scale-arithmetic fix is a correctness patch, not new product permission — these four claim types were effectively dead code by accident, not by design, and un-deading them without evidence rails would ship unfounded claims a mental-health app can't responsibly make | Phase 1-2 ships the typed claim store + verified synthesis this gate is waiting on |
| 2026-07-22 | R4 execution-time decision: Nexus dismissal keys off a content-derived `dismissalKeyFor` (not the raw insight id) for the three Date.now()-minted insight types (causal synthesis, recommendations, entity correlations); a genuinely reworded claim (different title/intervention/entity+direction) produces a different key and legitimately resurfaces | Those three types mint a fresh id every generation (including the 30-minute auto-refresh), so id-keyed dismissal was a silent no-op for exactly the insights most likely to resurface; content-derived keys fix that while an honest, tested boundary (not a hidden gap) covers genuine rewording | The content-derived key proves too coarse (unrelated claims collide) or too fine (trivial rewording resurfaces things that shouldn't) in practice |
| 2026-07-22 | R4 execution-time decision: basicInsights suppression fails toward HOLDING — an unstamped `entriesAtLastEvaluation` baseline (0/absent, including every pre-T5b legacy doc) is treated as "no genuinely new entries yet," not "the corpus was empty," and the doc is lazily self-healed on that same read | The alternative (unstamped = 0) meant a suppressed pattern could clear its re-evaluation threshold on literally the next read regardless of real new data — the exact resurfacing bug DR flagged; failing toward holding costs nothing (a genuinely new corpus still re-evaluates within 5 entries) and closes both the omitted-param path and every pre-fix legacy doc with zero migration | Users report a suppressed pattern staying suppressed long after it should have re-evaluated |
| 2026-07-22 | R4 execution-time decision: complement-baseline (non-overlapping exposed-vs-not-exposed, never an all-entries average) and unique-day-gating floors (entries≥5 AND days≥3 per factor) are the Phase-0 statistical floor, not a final calibration | DR finding 4's core methodological fix needed SOME concrete threshold to ship Phase 0 at all; these mirror the day-gating precedent EX2/Gentle Revisit already established elsewhere in the codebase rather than inventing new numbers, and are explicitly revisitable once Phase 1's evidence rails provide a principled basis | Real usage shows the floors are too strict (insights rarely fire) or too loose (spurious correlations still slip through) |

---

## Parked Ideas

Good ideas we're explicitly NOT doing now. Don't re-suggest these.

| Idea | Why Parked | Revisit When |
|------|------------|--------------|
| Social features / friend comparisons | Need to nail individual value prop first | Core insights validated |
| Oura / Fitbit integration | Whoop + HealthKit covers current user base | User requests it |
| Therapist export feature | No user has asked for this | A user asks |
| Automated UAT / Playwright tests | App changing too fast, maintenance > value | Core flows stabilize |
| CI/CD complexity | Current deploy process works fine | Shipping multiple times/week |
| Multiple LLM provider failover | Gemini reliability acceptable | Outages affect users |

---

## Known Issues / Tech Debt

| Issue | Severity | Notes |
|-------|----------|-------|
| `APP_COLLECTION_ID` hardcoded in `leadershipThreads.js` | Low | Fix during Nexus 2.0 implementation |
| `App.jsx` is 2,523 lines | Medium | ✅ **Zustand migration complete** - 39 useState calls removed. Next: extract child components. |
| `functions/index.js` is 4,390 lines | High | Restructuring plan created - shared utilities extracted to `functions/src/shared/`, domain split pending |
| ~~365 useState across 94 files~~ | ~~Medium~~ | ✅ **App.jsx migrated** - 39 useState → 5 Zustand stores. Other files can adopt stores gradually. |
| Direct Firestore in 34 files | Medium | Restructuring plan created - repository layer ready in `src/repositories/` |
| Test coverage improving | Low | 737 tests passing across 46 files (safety, crash reporting, signal lifecycle, visual overhaul verification). |
| Main bundle 631KB | Medium | Above 500KB warning threshold. Code splitting ready - component extraction will enable route-level splitting. |
| Existing insights files to delete | High | Part of Nexus 2.0 Phase 1 |
| **30-Day Journey chart empty bars light in dark mode** | Low | MoodBarGraph empty day cells use light backgrounds without `dark:` variants. Functional but visually inconsistent. |
| **Health context not being captured** | Medium | **Partially addressed** - Added platform tracking and health enrichment service. Web entries now flagged with `needsHealthContext: true` and enriched when opened on mobile. Need to verify Whoop relay is responding correctly. |
| **Old entries missing location data** | Medium | Environment backfill requires `entry.location` but old entries don't have it. New entries now capture location. |
| **Analysis not extracting themes/emotions** | Low | Cloud Function `analyzeEntry` prompt doesn't request themes/emotions fields. Would need prompt update. |
| **Existing entries need platform flag** | Low | 140 existing entries don't have `createdOnPlatform` field. Could add migration to backfill `createdOnPlatform: 'unknown'` or `'web'`. |
| **Audio vault (Phase 1) spec-vs-implementation deferrals** | Medium | Logged during final-review fix wave, deferred to Phase 2/3 consideration: (a) audio isn't timesliced to Filesystem during recording — kill-mid-recording still loses audio, since the vault only starts at recording stop; (b) failed uploads retry via the `PendingAudioBanner` UI, not through the `offlineManager`/`syncOrchestrator` durable queue; (c) no auto-created processing-state entry is written when a recording starts — the blocking alert-based failure flow is retained instead. |
| **Personal-name doc-comment examples remain in subsystems OUTSIDE R4's scope** | Low | R4 T2's privacy sweep only covered Nexus Layer 1/2 files (patternDetector triggers, threadManager/stateDetector config — see `docs/quality/trustworthy-capture-runbook.md`'s "R4" section). Flagged by the T3-closure review as out-of-scope-but-noted: `src/pages/EntityManagementPage.jsx`, `src/services/memory/memoryGraph.js`, `src/services/experiments/templates.js`, `src/services/basicInsights/correlations/peopleCorrelations.js`, `src/utils/string.js` all still carry "Spencer"/"Luna"-style names in doc-comment EXAMPLES (e.g. `@person:spencer`, "Luna is Spencer's pet") — never a matching trigger/detection literal, never sent to a model, never rendered to any user besides Michael reading source. Harmless; sweep opportunistically alongside any other edit to these files rather than as a dedicated task. |
| **`timeCorrelations.js`'s `classifyTime` uses native `Date` (server-local timezone), not the Intl-based timezone `entryAdapter.js` uses elsewhere** | Low | T1 review minor. Today `computeTimeCorrelations` only ever runs client-side (browser-local time, matches the user's own clock) — the divergence is dormant. Becomes a real bug only if a FUTURE caller invokes this from a server context (Cloud Function, different default timezone); noted so that caller reconciles the two timezone sources before shipping, not discovered live. |
| **R4 T1 report under-disclosure (corrected in PROJECT_STATUS's R4 Active Work entry above):** `peopleCorrelations.js` dropped its `baselineMood`/`entityMood` fields entirely in the R4 rewrite (pre-R4 version wrote both; current version writes neither) | Low | T1's own report framed this as "no display-scale changes... kept their existing meaning," accurate for activity/category/health-extended/themes but not for people — those two fields were removed, not recomputed. No UI consumer of either field anywhere (`src/components`/`src/pages` grepped clean), so no functional regression — just an inaccurate report line, corrected here. |

### Investigation Notes: Health Context Not Captured

**Status:** Partially addressed (2026-01-19). See session notes above for fixes applied.

**Original Symptoms:**
- User has Whoop connected (confirmed in Health Settings)
- User has Apple Watch connected via HealthKit
- New journal entries have `healthContext: null`
- Health backfill reports 0 entries updated

**What Was Fixed:**
- Added platform tracking (`createdOnPlatform`, `needsHealthContext` flags)
- Created entry health enrichment service for web→mobile flow
- Added timeout wrappers to Whoop relay calls
- Improved logging throughout health services

**Remaining Debug Steps:**

1. **For NEW entries created on mobile:**
   Check browser/device console for:
   ```
   [HealthDataService] getEntryHealthContext called
   [HealthDataService] Whoop linked: true/false
   [HealthDataService] getHealthSummary returned: {...}
   ```
   If health data is available, `healthContext` should be populated.

2. **For WEB entries (enrichment flow):**
   Open mobile app and check console for:
   ```
   [HealthEnrichment] Batch enriching X entries
   [HealthEnrichment] Successfully enriched entry XXX with whoop data
   ```
   If no logs appear, check that entries have `needsHealthContext: true` or `createdOnPlatform: 'web'`.

3. **If Whoop relay is timing out:**
   Check console for:
   ```
   [Whoop] Whoop API request timed out after 10000ms
   ```
   If this appears, check relay server logs in Cloud Run.

4. **Verify Whoop connection:**
   - Settings → Health → Whoop should show "Connected"
   - Check Firestore: `users/{uid}/integrations/whoop_tokens` should exist
   - Check relay server is accessible: `curl https://your-relay-url/health`

---

## User Feedback Log

| Date | User | Feedback | Action Taken |
|------|------|----------|--------------|
| — | — | No external user feedback yet | — |

---

## Key Metrics (When Available)

- **Users:** 2
- **Daily Active:** ?
- **Entries/user/week:** ?
- **Insight engagement rate:** ? (not yet instrumented)
- **Whoop connection rate:** ?

---

## Files Created This Session (2026-01-17)

| File | Purpose |
|------|---------|
| `src/services/crashReporting.js` | Firebase Crashlytics wrapper with web platform fallback |
| `src/components/lazy.jsx` | React.lazy wrappers for code splitting |
| `vitest.config.js` | Test framework configuration with Capacitor mocking |
| `src/test/setup.js` | Test environment setup (@testing-library/jest-dom) |
| `src/test/mocks/capacitor.js` | Mock for Capacitor core and plugins |
| `src/test/mocks/crashlytics.js` | Mock for Firebase Crashlytics |
| `src/services/safety/__tests__/safety.test.js` | 30 tests for crisis detection |
| `src/services/__tests__/crashReporting.test.js` | 9 tests for crash reporting service |
| `src/services/signals/__tests__/signalLifecycle.test.js` | 37 tests for signal state machine |
| `ios/fastlane/Fastfile` | iOS deployment automation (beta, release lanes) |
| `ios/fastlane/Appfile` | iOS app metadata for Fastlane |
| `android/fastlane/Fastfile` | Android deployment automation (internal, beta, production) |
| `android/fastlane/Appfile` | Android app metadata for Fastlane |
| `ios/App/App/PrivacyInfo.xcprivacy` | iOS 17+ privacy manifest |
| `public/terms-of-service.html` | Terms of Service page |
| `screenshots/README.md` | Screenshot requirements for App Store/Play Store |
| `screenshots/ios/` | iOS screenshot directory structure |
| `screenshots/android/` | Android screenshot directory |
| `fastlane/metadata/ios/en-US/` | iOS App Store metadata (name, description, keywords) |
| `fastlane/metadata/android/en-US/` | Play Store metadata (title, descriptions) |

## Files Created (Previous Sessions)

| File | Purpose |
|------|---------|
| `Engram-Nexus-2.0-Implementation-Spec.md` | Complete implementation spec for new insights engine (5,300+ lines) |
| `src/pages/EntityManagementPage.jsx` | Entity list/management view (Milestone 1) |
| `src/components/settings/EntityEditModal.jsx` | Entity edit form modal (Milestone 1) |
| `src/services/health/healthBackfill.js` | Retroactive health data for old entries |
| `src/services/offline/offlineStore.js` | IndexedDB wrapper for offline entry queue |
| `src/services/offline/offlineManager.js` | Queue management with retry logic |
| `src/services/sync/syncOrchestrator.js` | Conflict resolution, batch sync |
| `src/services/entries/entryProcessor.js` | Platform-aware entry pipeline |
| `src/services/analysis/localClassifier.js` | Rule-based entry type classification |
| `src/services/analysis/localSentiment.js` | VADER-style sentiment analysis |
| `src/services/analysis/sentimentLexicon.js` | 200+ word lexicon with valence scores |
| `src/services/analysis/analysisRouter.js` | Routes analysis to local or server |
| `src/services/analysis/recurrenceDetector.js` | Detects recurring task patterns |
| `src/services/signals/localGoalDetector.js` | Extracts goals from entry text |
| `src/services/signals/localTemporalParser.js` | Parses date/time expressions |
| `src/hooks/useEntryProcessor.js` | Hook for platform-aware entry processing |
| `src/services/environment/environmentBackfill.js` | Weather history backfill via Open-Meteo |
| `src/services/health/healthCorrelations.js` | Health-mood correlation analysis |
| `src/services/environment/environmentCorrelations.js` | Environment-mood correlation analysis |
| `src/services/prompts/contextPrompts.js` | Context-aware reflection prompts |
| `src/services/nexus/insightIntegration.js` | Unified insight integration service |
| `src/services/backfill/unifiedBackfill.js` | Orchestrates health → weather → insight backfill pipeline |
| `src/services/backfill/insightReassessment.js` | Regenerates insights after backfill with staging pattern |
| `src/services/backfill/index.js` | Backfill service exports |
| `src/services/nexus/insightRotation.js` | Drip-feed insight scheduling (7/day over 7 days) |
| `src/components/settings/BackfillPanel.jsx` | Settings UI for triggering/monitoring backfill |

---

## Session Notes

### 2026-02-20: Hearthside Visual Overhaul Complete

**Context:** Comprehensive visual redesign replacing generic Tailwind colors with a custom therapeutic palette, adding full dark mode support, and introducing typographic hierarchy. Implemented via `/deep-plan` + `/deep-implement` workflow across 18 sections.

**What Was Built:**

1. **Custom Hearthside Palette** (tailwind.config.js)
   - `hearth-*`: Warm-tinted dark neutrals (base surfaces)
   - `warm-*`: Light mode backgrounds
   - `honey-*`: Accent/energy/tasks
   - `sage-*`: Growth/positive patterns
   - `terra-*`: Grounding/negative patterns
   - `lavender-*`: Calm/reflective insights

2. **Full Dark Mode** (3-state: dark/light/system)
   - FOUC prevention script in index.html
   - `useDarkMode()` reactive hook (MutationObserver-based)
   - `DarkModeToggle` component with reduced-motion support
   - 4-tier surface hierarchy: hearth-950 → 900 → 850 → 800

3. **Typography Stack**
   - Fraunces (`font-display`): Headings, titles
   - DM Sans (`font-body`): Body text, UI elements
   - Caveat (`font-hand`): Handwritten accents (sparingly)

4. **Centralized Color API** (src/utils/colorMap.js)
   - `getEntryTypeColors()`, `getPatternTypeColors()`, `getEntityTypeColors()`
   - `HEX_COLORS` for canvas/chart operations
   - 5 gradient presets with dark mode variants

5. **Component Sweep** (sections 06-16)
   - Every component in src/components/ and src/pages/ migrated
   - Off-palette colors eliminated (verified by automated tests)

6. **Verification Suite** (section 18)
   - 17 targeted tests validating palette compliance, typography, dark mode infrastructure

**Verification:**
- Build: Clean production build (no errors)
- Tests: 737/737 passing across 46 files
- UAT: Light mode and dark mode visually inspected via browser

**Commits:** 18 section commits (351c878..af63c83), pushed to origin/main

**One Known Issue:**
- 30-Day Journey (MoodBarGraph) empty day cells show light backgrounds in dark mode

**Reference:** See `planning/hearthside/implementation/usage.md` for full API reference and color palette documentation.

---

### 2026-01-20: App.jsx Zustand Migration Complete

**Context:** Phase 3 of architecture restructuring - migrate App.jsx from 39 useState calls to Zustand stores.

**What Was Done:**

1. **Full State Migration**
   - Removed all 39 useState calls from App.jsx
   - Replaced with hooks from 5 Zustand stores:
     - `useAuthStore` - user, authMode, email, password, displayName, showPassword, authLoading, authError, showEmailForm, mfaResolver, mfaCode, mfaHint
     - `useUiStore` - view, category, all modal states (showDecompression, showSafetyPlan, showExport, showInsights, showJournal, showHealthSettings, showNexusSettings, showEntityManagement, showQuickLog, dailySummaryModal, entryInsightsPopup)
     - `useEntriesStore` - entries, processing, replyContext, entryPreferredMode, offlineQueue, retrofitProgress
     - `useSafetyStore` - safetyPlan, crisisModal, crisisResources, pendingEntry
     - `useSignalsStore` - detectedSignals, showDetectedStrip, signalExtractionEntryId

2. **Compatibility Layer**
   - Added wrapper functions for setter patterns that differ between useState and Zustand
   - Example: `setShowInsights(true)` → calls `showInsightsPanel()`
   - Allows gradual migration of child components

3. **Logout Handler Updated**
   - Added `resetAllStores()` call to clear all Zustand state on logout
   - Prevents data leakage between user sessions

4. **Import Cleanup**
   - Removed `useState` from React imports (no longer needed in App.jsx)

**Verification:**
- Build: ✅ Successful
- Tests: ✅ 76/76 passing
- useState calls in App.jsx: 0

**Files Modified:**
- `src/App.jsx` - Full state migration (~90 lines of store imports, removed ~50 lines of useState)
- `src/stores/index.js` - Already existed with exports

**Future Work (Low Priority):**
- Remove compatibility wrappers by updating child components to use store actions directly
- Extract child components from App.jsx (now possible since they can import stores directly)

---

### 2026-01-19: Health Data Enrichment for Web Entries

**Context:** User reported that despite having Whoop and Apple Watch connected, all 140 journal entries have `healthContext: null`. The retroactive backfill function wasn't updating entries with health data.

**Root Causes Identified:**

1. **No platform tracking**: Entries didn't record where they were created (web vs mobile), so the system couldn't know which entries needed health enrichment
2. **Web entries can't access health data**: HealthKit only works on iOS, Google Fit only on Android. Web entries must be enriched later on mobile.
3. **Whoop relay calls potentially timing out silently**: No timeout wrappers on network requests
4. **No enrichment service**: No mechanism existed to retroactively add health data when web entries are viewed on mobile

**Fixes Applied:**

1. **Platform tracking on entry creation** (`App.jsx`):
   - Added `createdOnPlatform` field tracking 'web', 'ios', or 'android'
   - Added `needsHealthContext` flag set to `true` for web entries without health data
   - Enables future identification of entries needing enrichment

2. **Entry health enrichment service** (`entryHealthEnrichment.js` - NEW):
   - `needsHealthEnrichment(entry)` - checks if entry needs health data
   - `enrichEntryWithHealth(entry)` - fetches health data for entry's date, updates Firestore
   - `batchEnrichEntries(entries, limit)` - processes multiple entries with rate limiting
   - Marks entries as `healthEnrichmentAttempted` to prevent repeated failures

3. **Mobile app initialization** (`App.jsx`):
   - Background health enrichment runs on iOS/Android startup
   - Processes up to 20 web entries per initialization
   - Only runs if user is authenticated and entries are loaded

4. **Whoop service improvements** (`whoop.js`):
   - Added `withTimeout()` wrapper for all network requests
   - Auth token fetch: 5 second timeout
   - Relay fetch: 10 second timeout (configurable per call)
   - Returns cached data on timeout errors
   - Better logging throughout

5. **Health backfill logging** (`healthBackfill.js`):
   - Improved logging in `detectAvailableSources()`
   - Clearer error messages for debugging

**How It Works Now:**

```
Web Entry Creation:
  entry.createdOnPlatform = 'web'
  entry.needsHealthContext = true
  entry.healthContext = null

Mobile App Opens:
  → Loads entries
  → Filters to entries needing enrichment
  → For each entry:
      → Fetch health data for entry's date
      → Update entry with healthContext
      → Mark enrichment complete
```

**Testing Checklist:**
- [ ] Create a new web entry, verify `createdOnPlatform: 'web'` and `needsHealthContext: true`
- [ ] Open mobile app, verify batch enrichment runs (check console logs)
- [ ] Verify enriched entries have `healthContext` populated
- [ ] Verify Whoop relay is responding (check network tab)

**Files Created:**
- `src/services/health/entryHealthEnrichment.js` - Entry health enrichment service

**Files Modified:**
- `src/App.jsx` - Platform tracking, background enrichment
- `src/services/health/whoop.js` - Timeout wrappers, better logging
- `src/services/health/healthBackfill.js` - Better logging
- `src/services/health/index.js` - Export new service

---

### 2026-01-19: Quick Insights Diagnosis & Fixes

**Context:** User reported Quick Insights showing 0 insights despite 140 journal entries with rich data.

**Root Causes Identified:**

1. **Tag location mismatch**: Correlation code looked for `entry.analysis.tags` but structured tags (`@person:spencer`, `@activity:yoga`) are stored at `entry.tags`
2. **Missing healthContext**: All 140 entries have `healthContext: null` despite Whoop being connected
3. **Missing environmentContext**: All entries have `environmentContext: null` because old entries lack `entry.location` field
4. **Analysis not extracting themes/emotions**: Cloud Function prompt doesn't request these fields

**Fixes Applied:**

1. **Activity correlations** (`activityCorrelations.js`):
   - Now checks `entry.tags` in addition to `entry.analysis.tags`
   - Handles structured tags like `@activity:yoga`, `@activity:hiking`

2. **People correlations** (`peopleCorrelations.js`):
   - Now extracts from `entry.tags` including `@person:`, `@pet:` prefixed tags
   - Properly capitalizes names for display

3. **Themes correlations** (`themesCorrelations.js`):
   - Now checks `entry.tags`, `entry.analysis.themes`, AND entry text
   - Matches theme keywords from any source

4. **Location capture at entry creation** (`App.jsx`):
   - New entries now save `entry.location` separately from `environmentContext`
   - Enables future environment backfill even if weather fetch fails

5. **Diagnostic export tool** (`diagnosticExport.js`, `SettingsPage.jsx`):
   - Added JSON export in Settings → Data section
   - Shows summary statistics (mood scores, health data, tags, etc.)
   - Useful for debugging data structure issues

**Result:** Activity and people insights now working based on tag data.

**Remaining Investigation:** Why healthContext isn't being captured despite Whoop being connected (see Known Issues).

**Files Created:**
- `src/utils/diagnosticExport.js` - Diagnostic JSON export utility

**Files Modified:**
- `src/services/basicInsights/correlations/activityCorrelations.js`
- `src/services/basicInsights/correlations/peopleCorrelations.js`
- `src/services/basicInsights/correlations/themesCorrelations.js`
- `src/App.jsx` - Location capture, getCurrentLocation import
- `src/pages/SettingsPage.jsx` - Diagnostic export button
- `src/components/zen/AppLayout.jsx` - Pass entries to SettingsPage

---

### 2026-01-19: Architecture Restructuring (Phases 0-3 Partial)

**Context:** App.jsx is 2,421 lines with 28+ useState calls, functions/index.js is 4,390 lines. Plan created to restructure into modular, maintainable architecture.

**What Was Done:**

1. **Phase 0: Foundation**
   - Created `src/utils/statistics.js` - extracted `average()`, `median()`, `stdDev()`, `pearsonCorrelation()` from duplicated code in healthCorrelations.js and environmentCorrelations.js
   - Created `src/types/` directory with TypeScript definitions for IDE support:
     - `entries.d.ts` - Entry, AnalysisResult, HealthContext, EnvironmentContext
     - `signals.d.ts` - Signal, SignalState, StateTransition, GoalSignal, etc.
     - `health.d.ts` - HealthCorrelation, WhoopTokens, HealthSettings
     - `user.d.ts` - UserProfile, SafetyPlan, UserPreferences
   - Created `tsconfig.json` with `allowJs: true` for gradual TypeScript adoption

2. **Phase 1: Zustand State Management**
   - Installed Zustand (`npm install zustand`)
   - Created 5 domain stores in `src/stores/`:
     - `authStore.js` - user, authMode, email, password, MFA state (~400 lines from App.jsx)
     - `uiStore.js` - view, modals (showInsights, showSafetyPlan, etc.) (~200 lines)
     - `entriesStore.js` - entries, processing, offlineQueue, retrofitProgress (~300 lines)
     - `safetyStore.js` - safetyPlan, crisisModal, pendingEntry (~100 lines)
     - `signalsStore.js` - detectedSignals, showDetectedStrip (~100 lines)
   - Created `src/stores/index.js` with exports and `resetAllStores()` helper

3. **Phase 2: Repository Pattern**
   - Created `src/repositories/` with database abstraction layer:
     - `base.js` - BaseRepository class with CRUD, batch, transaction methods
     - `entries.js` - EntriesRepository (findByCategory, findByDate, updateAnalysis, etc.)
     - `signals.js` - SignalsRepository + ExclusionsRepository (findActiveGoals, transitionState, etc.)
     - `health.js` - HealthRepository (Whoop tokens, health settings, data cache)
     - `users.js` - UsersRepository (profile, safety plan, preferences, notifications)

4. **Phase 3: Cloud Functions (Partial)**
   - Created `functions/src/` directory structure (ai/, triggers/, scheduled/, auth/, shared/)
   - Extracted shared utilities:
     - `shared/gemini.js` - Gemini API helper with embedding support
     - `shared/openai.js` - OpenAI chat, Whisper, embedding helpers
     - `shared/entityResolution.js` - Levenshtein distance, fuzzy matching
     - `shared/constants.js` - APP_COLLECTION_ID, AI_CONFIG, timeouts

**Remaining Work (Future Sessions):**

- [ ] **App.jsx Migration** - Replace useState calls with store hooks (incremental, ~1 store at a time)
- [ ] **Cloud Functions Domain Split** - Move functions from index.js to domain modules
- [ ] **Phase 4: Component Decomposition** - Extract features to `src/features/` structure
- [ ] **Phase 5: TypeScript Migration** - Convert critical paths (.js → .ts)

**How to Continue:**

1. **Migrate App.jsx to Zustand (safest first):**
   ```jsx
   // Before (in App.jsx):
   const [showInsights, setShowInsights] = useState(false);

   // After:
   import { useUiStore } from './stores';
   const { showInsights, toggleInsights } = useUiStore();
   ```

2. **Migrate services to repositories:**
   ```javascript
   // Before (direct Firestore):
   const docRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries', entryId);
   await updateDoc(docRef, { text: newText });

   // After (repository):
   import { entriesRepository } from './repositories';
   await entriesRepository.updateText(userId, entryId, newText);
   ```

3. **Split Cloud Functions** - Import from shared, export from domain modules

**Key Files Created:**
| File | Purpose |
|------|---------|
| `src/utils/statistics.js` | Shared statistical functions |
| `src/types/*.d.ts` | TypeScript type definitions (5 files) |
| `src/stores/*.js` | Zustand stores (6 files) |
| `src/repositories/*.js` | Repository pattern (5 files) |
| `functions/src/shared/*.js` | Cloud Functions shared utilities (5 files) |
| `tsconfig.json` | TypeScript configuration |

---

### 2026-01-18: Multi-Provider Authentication

**Context:** iOS App Store requires Sign in with Apple when offering other social login options. Also added email/password as a non-social alternative.

**What Was Done:**

1. **Sign in with Apple**
   - Added entitlement to `ios/App/App/App.entitlements`
   - Created `exchangeAppleToken` Cloud Function for native iOS token exchange
   - Implemented Apple sign-in handler using `@capgo/capacitor-social-login`
   - Currently iOS-only (web requires Apple Developer Service ID setup)

2. **Email/Password Authentication**
   - Sign in with existing account
   - Sign up with new account (optional display name)
   - Password reset via email
   - User-friendly error messages for all auth states

3. **MFA (Multi-Factor Authentication)**
   - Added Firebase MFA imports and handlers
   - TOTP (authenticator app) support
   - Dedicated MFA verification UI with 6-digit code input
   - Graceful error handling for invalid/expired codes

4. **Login UI Redesign**
   - Apple button (iOS only) - black with white text
   - Google button - white with Google colors
   - Email option expands to form with mode switching
   - Smooth transitions between auth modes

**Key Files Modified:**
- `src/App.jsx` - Auth handlers and login UI
- `src/config/firebase.js` - MFA and auth exports
- `functions/index.js` - `exchangeAppleToken` Cloud Function
- `ios/App/App/App.entitlements` - Apple Sign-In capability

**Remaining for Full Apple Sign-In:**
- [ ] Configure Apple Developer Service ID for web
- [ ] Add private key to Firebase Console
- [ ] Enable Apple provider in Firebase Auth

### 2026-01-17: App Store Readiness Implementation

**Context:** Comprehensive preparation for App Store and Play Store submission with full polish.

**What Was Done:**

1. **Crash Reporting (Phase 1)**
   - Added `@capacitor-firebase/crashlytics` dependency
   - Created `src/services/crashReporting.js` wrapper service
   - Graceful web platform fallback (no-op on browsers)
   - Updated `android/build.gradle` with Crashlytics Gradle plugin
   - Updated `android/app/build.gradle` with Crashlytics dependencies

2. **App Store Assets (Phase 2)**
   - Created `screenshots/` directory structure for iOS and Android
   - Created `fastlane/metadata/` with iOS (name, subtitle, description, keywords) and Android (title, descriptions) metadata
   - Created `public/terms-of-service.html` with full terms
   - Created `ios/App/App/PrivacyInfo.xcprivacy` for iOS 17+ privacy manifest

3. **Fastlane Deployment Automation (Phase 3)**
   - Created `ios/fastlane/Fastfile` with beta (TestFlight) and release (App Store) lanes
   - Created `ios/fastlane/Appfile` with Apple ID configuration
   - Created `android/fastlane/Fastfile` with internal, beta, production tracks
   - Created `android/fastlane/Appfile` with package name configuration

4. **Testing Infrastructure (Phase 4)**
   - Added Vitest, @testing-library/react, @testing-library/jest-dom, jsdom
   - Added rollup-plugin-visualizer for bundle analysis
   - Created `vitest.config.js` with module aliasing to mock Capacitor dependencies
   - Created test mocks for Capacitor core and Crashlytics
   - Created 76 tests across 3 test suites:
     - `safety.test.js` - 30 tests for crisis detection patterns
     - `crashReporting.test.js` - 9 tests for crash reporting service
     - `signalLifecycle.test.js` - 37 tests for signal state machine
   - All tests passing ✅

5. **Accessibility Improvements (Phase 5)**
   - Updated `src/components/ui/index.jsx` with ARIA attributes:
     - Button: aria-label, aria-busy, aria-disabled, focus rings
     - Modal: role="dialog", aria-modal, aria-labelledby, aria-describedby
     - Input/Textarea: htmlFor, aria-invalid, aria-describedby, error alerts
     - Toast: role="status/alert", aria-live
     - BreathingLoader/Spinner: role="status", aria-label

6. **Performance Optimization (Phase 6)**
   - Updated `vite.config.js`:
     - Console.log stripping in production via esbuild.drop
     - Bundle analysis via rollup-plugin-visualizer
     - Vendor code splitting (react, firebase, UI libs, dnd-kit, xyflow)
   - Created `src/components/lazy.jsx` for React.lazy code splitting
   - Enabled Android minification in `android/app/build.gradle`:
     - `minifyEnabled true`, `shrinkResources true` for release builds
     - ProGuard optimization enabled

**Test Results:**
```
Test Files  3 passed (3)
Tests  76 passed (76)
```

**Bundle Analysis:**
```
dist/assets/vendor-react-*.js     175.99 kB
dist/assets/vendor-firebase-*.js  463.89 kB
dist/assets/index-*.js            631.90 kB (main bundle)
```

**Key Files Modified:**
- `package.json` - Added dev dependencies and test scripts
- `vite.config.js` - Build optimization and bundle analysis
- `vitest.config.js` - Test configuration (NEW)
- `android/build.gradle` - Crashlytics Gradle plugin
- `android/app/build.gradle` - Crashlytics deps, ProGuard enabled
- `src/components/ui/index.jsx` - ARIA accessibility attributes

**Remaining Work for Full App Store Submission:**
- [ ] Create actual screenshots for each device size
- [ ] Update `ios/fastlane/Appfile` with real Apple ID and team ID
- [ ] Set up Google Play Service Account for Android Fastlane
- [ ] Run full iOS build via TestFlight
- [ ] Run full Android build via internal testing track
- [ ] Complete store-specific questionnaires (age rating, content, data safety)

### 2026-01-16: Retroactive Backfill System & Insight Dismissal Fix

**Context:** Implementing the plan from `PLAN-retroactive-backfill-insights.md` for retroactive data enrichment and fixing user-reported issue where dismissed insights keep returning.

**What Was Done:**

1. **Unified Backfill System**
   - Created `unifiedBackfill.js` orchestrator running: health → weather → insight reassessment
   - State persistence with checkpoints every 50 entries for resume capability
   - AbortController support for user cancellation
   - Progress callbacks for UI updates

2. **BackfillPanel UI in Settings**
   - Added "Data" section to SettingsPage with BackfillPanel component
   - Shows count of entries needing health/weather backfill
   - Start/Resume button, progress bar during processing
   - Results summary on completion

3. **Primary Readiness Metric on Entry Cards**
   - Added `PrimaryReadinessMetric` component to EntryCard
   - Whoop users: Recovery Score (green/yellow/red battery icon)
   - HealthKit-only: Sleep Score (purple bed icon)
   - Secondary metrics (HRV, Strain, Steps) shown on larger screens

4. **Permanent Insight Dismissal (BUG FIX)**
   - **Problem:** Dashboard insight X button only set local state to null; insights returned on reload
   - **Solution:**
     - `handleDismissInsight` now calls `addToExclusionList()` with `permanent: true`
     - Loads exclusions on mount via `getActiveExclusions()`
     - Filters insights against exclusions when loading via `isInsightExcluded()` helper
   - Updated both MidDayCheckIn and EveningMirror to use new handler

5. **Supporting Services**
   - `insightReassessment.js` - Regenerates baselines, patterns, correlations after backfill
   - `insightRotation.js` - Drip-feed for backfilled insights (7/day over 7 days)
   - Extended `healthBackfill.js` with Whoop support and batched writes
   - Cloud Function fix to skip staleness marking for backfilled entries

**Key Files Modified:**
- `src/components/dashboard/DayDashboard.jsx` - Permanent dismissal logic
- `src/components/entries/EntryCard.jsx` - PrimaryReadinessMetric component
- `src/pages/SettingsPage.jsx` - BackfillPanel integration
- `functions/index.js` - Skip recompute for backfill updates

**Deployed:** Pushed to main, triggering Firebase Hosting + Cloud Functions deployment.

### 2026-01-15: Health & Environment Insights UI Integration

**Context:** Building UI surfaces for the health-mood and environment-mood correlation features created in the previous session.

**What Was Done:**

1. **Correlation Insights on InsightsPage**
   - Added CorrelationsSection component showing health and environment correlations
   - Expandable/collapsible "Your Patterns" section
   - Shows top 3 health insights (sleep, HRV, exercise, etc.)
   - Shows top 3 environment insights (sunshine, weather, temperature)
   - SAD warning for users sensitive to low sunshine
   - Color-coded by correlation strength (strong, moderate, weak)

2. **Context-Aware Prompts in PromptWidget**
   - Enhanced PromptWidget to include health/environment context prompts
   - High-priority prompts (low sleep, low recovery) shown first
   - Context-specific icons and colors (Moon for sleep, Sun for weather)
   - Shows trigger info (e.g., "low sleep") for high-priority prompts
   - Graceful fallback when health data unavailable

3. **Today's Recommendations Section**
   - RecommendationsSection on InsightsPage
   - Pulls from `getTodayRecommendations()` based on:
     - Current health data (recovery score, sleep hours)
     - Environment data (sunshine percentage)
     - Intervention effectiveness history
   - Priority-based styling (high=red, medium=amber, low=green)
   - Shows reasoning for each recommendation

4. **Environment Backfill in Health Settings**
   - Mirrored health backfill UI pattern
   - Shows count of entries that can be enriched (last 7 days)
   - Progress bar with cancel option
   - Results summary (updated, skipped, failed)
   - Uses Open-Meteo weather history API (free, no auth needed)

5. **What's New Modal v2.2.0**
   - Updated to announce health & environment features
   - Four feature cards: Health-Mood Correlations, Weather Tracking, Pattern Discovery, Smart Recommendations
   - Gradient header with heart/sun theme

**Key UI Decisions:**
- Correlations computed client-side (instant, no LLM cost)
- Recommendations require baselines (won't show until enough data)
- High-priority context prompts override normal prompts in widget
- Environment backfill limited to 7 days (Open-Meteo free tier limitation)

**Files Modified:**
- `src/pages/InsightsPage.jsx` - Added CorrelationsSection, RecommendationsSection
- `src/components/zen/widgets/PromptWidget.jsx` - Context-aware prompts
- `src/components/screens/HealthSettingsScreen.jsx` - Environment backfill UI
- `src/components/shared/WhatsNewModal.jsx` - v2.2.0 with new features

### 2026-01-15: iOS vs Web Client-Side Computation (Offline-First)

**Context:** Implement differentiated client-side computation for iOS vs Web to decrease latency and enable full offline journaling.

**Architecture Implemented:**
```
iOS (On-Device)                          Web (Server-Dependent)
===============                          ====================
Entry Input                              Entry Input
    |                                        |
    v                                        v
[Local Classifier] <50ms                 [Cloud Function] ~2s
    |                                        |
    v                                        v
[Local Sentiment] <30ms                  [Gemini Analysis] ~3s
    |                                        |
    v                                        v
[IndexedDB Queue] ---sync when online--> [Firestore]
    |
    v
[Native Sleep Score] <10ms
(Swift/HealthKit)
```

**Key Design Decisions:**
- **Single codebase** with runtime platform detection via `Capacitor.getPlatform()`
- **VADER-style sentiment** (lexicon-based, no Core ML) - simpler and fast enough
- **Native Swift sleep score** for <10ms vs JS calculation
- **Offline queue** with exponential backoff retry (2s base, 30s max)

**New Services Created:**
| Service | Purpose |
|---------|---------|
| `offlineStore.js` | IndexedDB wrapper via Capacitor Preferences |
| `offlineManager.js` | Queue management with retry logic |
| `syncOrchestrator.js` | Conflict resolution, batch sync |
| `entryProcessor.js` | Platform-aware entry pipeline |
| `localClassifier.js` | Rule-based entry type detection |
| `localSentiment.js` | VADER-style sentiment (200+ word lexicon) |
| `analysisRouter.js` | Routes to local or server based on platform |
| `recurrenceDetector.js` | Detects recurring task patterns |
| `localGoalDetector.js` | Extracts goals from text |
| `localTemporalParser.js` | Parses date/time expressions |

**Swift Additions:**
- `calculateSleepScore()` method in HealthPlugin.swift
- Same formula as JS for consistency
- Returns score + breakdown by component

**Integration Points:**
- `App.jsx:doSaveEntry()` now uses local analysis when offline on iOS
- `useNetworkStatus` hook triggers sync on reconnect
- `healthKit.js` tries native sleep score, falls back to JS

**Performance Targets:**
| Operation | Target | Achieved |
|-----------|--------|----------|
| Local classification | <50ms | ✓ |
| Local sentiment | <30ms | ✓ |
| Native sleep score | <10ms | ✓ |
| Full offline save | <200ms | ✓ |

### 2026-01-15: Whoop Integration, Smart Merge & Health Backfill

**Context:** Completing health data integration with Whoop OAuth and handling users with multiple health sources.

**What Was Done:**

1. **Whoop OAuth Setup (WORKING)**
   - Fixed OAuth "invalid_client" error by updating secrets in Cloud Run Secret Manager
   - Fixed redirect URI in Whoop Developer Portal to point to relay server callback
   - Added 'offline' scope to get refresh tokens for persistent access
   - Token exchange and encrypted storage in Firestore now working

2. **Smart Merge for Multiple Health Sources**
   - Users with both Whoop and HealthKit now get best of both:
     - Sleep/HRV/Recovery: From Whoop (24/7 tracking, more accurate)
     - Steps: From HealthKit (Whoop doesn't track steps natively)
     - Workouts: Merged from both sources, deduped by time overlap
   - Updated `healthDataService.js` with `smartMergeHealthData()` function
   - Updated `whoop.js` to return nested format matching HealthKit structure

3. **Health Settings UI Redesign**
   - Unified "Health Sources" section with chips for each connected source
   - Single "Today's Health" card with source badges showing where each metric came from
   - Added placeholder for future sources (Oura, Fitbit)
   - Cleaner, less confusing layout

4. **Health Backfill Feature**
   - Created `healthBackfill.js` service for retroactive health data
   - `getEntriesWithoutHealth()` finds entries missing healthContext
   - `backfillHealthData()` queries historical health data and updates entries
   - UI with progress bar, cancel button, and results summary
   - Rate-limited to avoid overwhelming health APIs

5. **Sleep Query Window Fix**
   - Changed from 36-hour lookback to 6 PM yesterday → now
   - Prevents double-counting multiple nights of sleep data

**Key Files Created/Modified:**
- `src/services/health/healthBackfill.js` (NEW)
- `src/services/health/healthDataService.js` (smart merge)
- `src/services/health/whoop.js` (nested format)
- `src/components/screens/HealthSettingsScreen.jsx` (redesign)
- `plugins/capacitor-health-extended/.../HealthPlugin.swift` (sleep window)
- `relay-server/src/services/whoop/whoopClient.ts` (offline scope)

### 2026-01-14: Expanded HealthKit Integration

**Context:** Expanding health data captured with journal entries to enable better mood correlation insights.

**What Was Done:**

1. **Fixed HealthKit Plugin Loading (WORKING)**
   - Original issue: Plugin hanging on iOS during load
   - Solution: Changed from static import to lazy `registerPlugin()` inside getter function
   - HealthKit now connects, permissions dialog shows, and user can grant access
   - Health Settings screen now displays: Sleep, Steps, Workout status, BPM

2. **Created Local Plugin Fork (`/plugins/capacitor-health-extended/`)**
   - Forked `@flomentumsolutions/capacitor-health-extended@0.6.4`
   - Added `sleep-stages` data type handler in Swift (`HealthPlugin.swift:459-560`)
   - Returns: deep, core, REM, awake (minutes), total, inBedStart, inBedEnd, awakePeriods
   - Package renamed to `@echovault/capacitor-health-extended@0.6.4-fork.1`
   - Package.swift name changed to `EchovaultCapacitorHealthExtended`

3. **Updated healthKit.js for Expanded Data**
   - Added timeout wrappers (10s) around all queries to prevent hanging
   - Added detailed console logging for each query
   - Updated `querySleep()` to use new `sleep-stages` endpoint with fallback
   - Implemented full sleep score calculation using Michael's formula:
     - Duration (30%) - 7-9 hours optimal
     - Efficiency (20%) - time asleep / time in bed
     - Deep sleep (20%) - 13-23% optimal
     - REM (15%) - 18-28% optimal
     - Continuity (15%) - penalize wake-ups

4. **Updated HealthSettingsScreen.jsx**
   - Fixed data mapping for new nested structure:
     - `todayData.activity?.stepsToday` (was `todayData.steps`)
     - `todayData.activity?.hasWorkout` (was `todayData.hasWorkout`)
     - `todayData.heart?.restingRate` (was `todayData.heartRate?.resting`)

5. **Fixed Geolocation Timeout Issue**
   - Added 5-second timeout wrappers around `checkPermissions()` and `requestPermissions()`
   - Falls back to cached location if permissions hang (was blocking entry creation)

**Expanded Health Context Per Entry:**
```javascript
{
  sleep: { totalHours, quality, score, stages: { deep, core, rem, awake } },
  heart: { restingRate, currentRate, hrv, hrvTrend, stressIndicator },
  activity: { stepsToday, totalCaloriesBurned, activeCaloriesBurned, totalExerciseMinutes, hasWorkout, workouts: [...] },
  source: "healthkit",
  capturedAt: "..."
}
```

**Current Issue (Needs Debugging):**
- HealthKit queries work and data shows in Health Settings screen
- BUT health data is NOT being saved to journal entries
- Need to trace where `getEntryHealthContext()` is called during entry creation
- Check if it's being called, and if so, why the data isn't persisting

**Key Files Modified:**
- `src/services/health/healthKit.js` - Main HealthKit integration
- `src/services/health/healthDataService.js` - Entry health context mapping
- `src/components/screens/HealthSettingsScreen.jsx` - UI data binding
- `src/services/environment/environmentService.js` - Geolocation timeout fix
- `plugins/capacitor-health-extended/` - Local plugin fork with sleep stages
- `package.json` - Points to local plugin

**Debugging Next Steps:**
1. Add logging to `getEntryHealthContext()` to see if it's being called
2. Check where entry creation calls health context capture
3. Verify Firestore entry documents have/don't have `healthContext` field
4. May be a timing issue (health queries async vs entry save sync)

### 2026-01-14: Entity Management Feature (Milestone 1.5)

**Context:** Michael identified entity data issues - Whisper mishears names (e.g., "Lunar" instead of "Luna") and relationships need manual correction (e.g., "my dog" should be "partner's dog").

**Completed:**
- **Milestone 1:** Basic Entity Editor
  - EntityManagementPage with list view grouped by type
  - EntityEditModal with name, aliases, type, relationship editing
  - Integration with Settings page and PeopleSection widget
  - CRUD operations in memoryGraph.js
  - `userCorrected` flag to preserve manual edits from AI overwriting

- **Milestone 1.5a:** Entity Resolution in Cloud Functions
  - Levenshtein distance fuzzy matching (65% threshold)
  - `resolveEntities()` function corrects names before analysis
  - `analyzeJournalEntry` applies entity resolution, returns corrections
  - Client updates entry text with corrected version

- **Milestone 1.5b:** Entity Migration
  - `migrateEntitiesFromEntries` Cloud Function
  - Extracts @person/@pet/@place tags from existing entries
  - Creates entities for items mentioned 2+ times
  - UI button in EntityManagementPage for users with empty entity list

**Next Milestones (Parked):**
- Milestone 2: Entity-to-entity relationship links (Luna belongs to Spencer)
- Milestone 3: Visual relationship graph

### 2026-01-13: Nexus 2.0 Design Session

**Context:** Michael dissatisfied with current insight quality. Receiving generic correlations like "drag show boosts mood 30%" that miss deeper patterns.

**Key Insight from Michael's Data:**
- 99 journal entries analyzed (Dec 2025 - Jan 2026)
- Major emotional arc: Databricks offer → verbal acceptance → rejection after reference checks
- Spencer functions as emotional stabilizer (mood floor of 50% when mentioned)
- Sterling walks correlate with HRV recovery
- Immigration anxiety underlies all career stress

**Example of Target Insight Quality:**
> "While you describe yourself as 'patient' regarding Anthropic, your RHR has trended 4bpm higher during waiting periods. However, on days you mention Sterling, your HRV recovers by 12ms within 24 hours. Caring for Sterling is your most effective physical 'off-switch' for career tension."

**Architecture Decided:**
- 4-layer pipeline: Pattern Detection → Temporal Reasoner → Causal Synthesizer → Intervention Optimizer
- Thread metamorphosis for tracking evolving life narratives
- Belief extraction + dissonance detection
- Intervention effectiveness tracking with counterfactual reasoning

---

## How to Use This Document

1. **Start of session:** Read this to understand current state
2. **During work:** Reference Recent Decisions before re-litigating choices
3. **Before PR:** Update relevant sections (see CLAUDE.md for checklist)
4. **After user feedback:** Log it here immediately
