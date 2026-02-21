# Engram Project Status

> **Last Updated:** 2026-02-20 (Hearthside Visual Overhaul complete)
> **Updated By:** Claude (via conversation with Michael)

---

## Current Phase

**Pre-launch.** 2 users (Michael + 1). Validating core value proposition before broader release.

**North Star:** Make insights so good users think "holy shit, I didn't realize that about myself."

---

## Active Work

| Item | Status | Notes |
|------|--------|-------|
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
