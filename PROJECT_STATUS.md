# EchoVault Project Status

> **Last Updated:** 2026-01-17
> **Updated By:** Claude (via conversation with Michael)

---

## Current Phase

**Pre-launch.** 2 users (Michael + 1). Validating core value proposition before broader release.

**North Star:** Make insights so good users think "holy shit, I didn't realize that about myself."

---

## Active Work

| Item | Status | Notes |
|------|--------|-------|
| **App Store Readiness** | ✅ Complete | Crashlytics, Fastlane, testing, accessibility, performance optimization |
| Health & Environment Insights UI | ✅ Complete | Correlation insights, context prompts, recommendations, environment backfill |
| Nexus 2.0 Insights Engine | 📋 Spec Complete | Full implementation spec created. Replaces entire existing insights system. |
| Entity Management (Milestone 1.5) | ✅ Complete | Entity resolution for voice transcription + migration from older entries |
| HealthKit Integration (Expanded) | ✅ Complete | Sleep stages, smart merge with Whoop, health backfill feature |
| Whoop Integration | ✅ Complete | OAuth working, cloud sync, recovery/strain/sleep data |

### Nexus 2.0 Implementation Phases

- [ ] **Phase 1:** Layer 1 + Layer 2 foundation (Days 1-3)
- [ ] **Phase 2:** Layer 3 LLM synthesis (Days 4-6)
- [ ] **Phase 3:** Layer 4 + orchestration (Days 7-8)
- [ ] **Phase 4:** UI + settings (Days 9-10)
- [ ] **Phase 5:** Migration + launch (Days 11-12)

---

## Current Priorities (Ordered)

1. **Ship Nexus 2.0** — Nothing else matters until insights are genuinely valuable
2. **Get 10 external users** — Need real feedback beyond Michael
3. **Collect feedback** — Instrument what insights get engagement
4. **Iterate** — Based on what users actually respond to

---

## Recent Decisions

| Date | Decision | Why | Revisit If |
|------|----------|-----|------------|
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
| `App.jsx` is 71KB | Medium | Lazy loading infrastructure ready (`src/components/lazy.jsx`), needs route-level integration |
| `functions/index.js` is monolithic | Medium | Consider splitting post-launch |
| Test coverage improving | Low | 76 tests passing (safety, crash reporting, signal lifecycle). Add more as needed. |
| Main bundle 631KB | Medium | Above 500KB warning threshold. Code splitting ready but App.jsx still static imports. |
| Existing insights files to delete | High | Part of Nexus 2.0 Phase 1 |

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
| `EchoVault-Nexus-2.0-Implementation-Spec.md` | Complete implementation spec for new insights engine (5,300+ lines) |
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
