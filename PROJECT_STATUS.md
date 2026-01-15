# EchoVault Project Status

> **Last Updated:** 2026-01-14
> **Updated By:** Claude (via conversation with Michael)

---

## Current Phase

**Pre-launch.** 2 users (Michael + 1). Validating core value proposition before broader release.

**North Star:** Make insights so good users think "holy shit, I didn't realize that about myself."

---

## Active Work

| Item | Status | Notes |
|------|--------|-------|
| Nexus 2.0 Insights Engine | 📋 Spec Complete | Full implementation spec created. Replaces entire existing insights system. |
| Entity Management (Milestone 1.5) | ✅ Complete | Entity resolution for voice transcription + migration from older entries |
| HealthKit Integration (Expanded) | 🔧 In Progress | Sleep stages fork deployed, needs debugging. Health data not saving to entries. |

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

---

## Parked Ideas

Good ideas we're explicitly NOT doing now. Don't re-suggest these.

| Idea | Why Parked | Revisit When |
|------|------------|--------------|
| Social features / friend comparisons | Need to nail individual value prop first | Core insights validated |
| Apple Health integration | ✅ Now implemented - see HealthKit session notes | N/A |
| Therapist export feature | No user has asked for this | A user asks |
| Automated UAT / Playwright tests | App changing too fast, maintenance > value | Core flows stabilize |
| CI/CD complexity | Current deploy process works fine | Shipping multiple times/week |
| Multiple LLM provider failover | Gemini reliability acceptable | Outages affect users |

---

## Known Issues / Tech Debt

| Issue | Severity | Notes |
|-------|----------|-------|
| `APP_COLLECTION_ID` hardcoded in `leadershipThreads.js` | Low | Fix during Nexus 2.0 implementation |
| `App.jsx` is 71KB | Medium | Needs decomposition, but works |
| `functions/index.js` is monolithic | Medium | Consider splitting post-launch |
| Limited test coverage | Medium | Signal lifecycle has tests, little else |
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

## Files Created This Session

| File | Purpose |
|------|---------|
| `EchoVault-Nexus-2.0-Implementation-Spec.md` | Complete implementation spec for new insights engine (5,300+ lines) |
| `src/pages/EntityManagementPage.jsx` | Entity list/management view (Milestone 1) |
| `src/components/settings/EntityEditModal.jsx` | Entity edit form modal (Milestone 1) |

---

## Session Notes

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
