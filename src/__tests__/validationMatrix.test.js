/**
 * Trustworthy Capture Sprint — automated validation matrix (plan task D3).
 *
 * Each `describe` below is one row of the sprint's validation matrix,
 * exercised as an INTEGRATION-STYLE test over the REAL client modules that
 * implement the row's contract. Only platform boundaries are mocked:
 * Capacitor Preferences, localStorage, Firestore callables/addDoc/updateDoc,
 * vault IO (Filesystem/IndexedDB), and network (Firebase callables). Nothing
 * about the modules under test — consentService, operationStore,
 * resumeOperations, prepareDurableRecording, audioVault, clearOwnerCaches,
 * enrichmentRunner, buildCoreEntry, entryCorrectionFields — is stubbed.
 *
 * See docs/superpowers/plans/2026-07-20-trustworthy-capture-and-intelligence.md
 * (Task D3) for the source matrix this file automates, and
 * docs/quality/device-validation-matrix.md for the physical-device rows that
 * cannot be automated here.
 *
 * R2 rows (a)-(h), appended below Row 11, cover
 * docs/superpowers/plans/2026-07-21-r2-trust-surfaces.md (Task 21). Same
 * philosophy: real modules, boundary-only mocks. Rows (a)/(b) need the real
 * Nexus orchestrator, which pulls in a large dependency graph (Layer 1-4,
 * health/whoop, gapDetector) — those are stubbed exactly as
 * orchestrator.receipts.test.js / orchestrator.exclusions.test.js (Task 8/10's
 * own dedicated test files) already establish, so Layer 1 pattern detection
 * and the orchestrator's own entity-correlation math stay genuinely real.
 *
 * R3 rows (a)-(g), appended below R2 row (h), cover
 * docs/superpowers/plans/2026-07-22-r3-personal-experiments.md (Task 7).
 * `src/services/experiments/{questionGate,estimator,computeResult}.js` and
 * their import graph (`templates.js`, `spaces/scopeFilter.js`,
 * `insights/receipts.js`, `health/healthFormatter.js`,
 * `environment/environmentFormatter.js`, `safety/index.js`) are entirely
 * Firebase-free — verified by reading every file in that graph — so rows
 * (a), (c), (d), (f), (g) import and call them directly with zero additional
 * mocking, exactly like their own dedicated test files
 * (questionGate.test.js, estimator.test.js, computeResult.test.js). Rows (b)
 * and (e) exercise the real `experimentsService.js` against this file's
 * existing shared `config/firebase` mock (same resolved module
 * `src/config/firebase.js` that `experimentsService.js`'s
 * `'../../config/firebase'` import resolves to) — `deleteDoc` was added to
 * `firestoreMocks` above for this module's import graph; no row here calls
 * `deleteExperiment`, so it is otherwise inert.
 *
 * Hardening rows (h1)-(h8), appended below R3 row (g), cover
 * docs/superpowers/plans/2026-07-22-michael-review-hardening.md (Task QA-H)
 * — Michael's direct review of Gentle Revisit (GR1/GR2) and Personal
 * Experiments (EX1/EX2). Every row calls the real hardened module directly
 * (`functions/src/revisit/selectRevisits.js`'s `selectRevisitCandidate`/
 * `currentStateGateTripped`/`weeklyCadenceTripped`/`MOOD_FLOOR`; the
 * client's own `currentStateGateTripped` from
 * `src/components/zen/widgets/RevisitWidget.jsx`; `estimator.js`'s
 * `runAnalysisPlan`/`pairObservations`/`MIN_GROUP_SIZE`; `computeResult.js`'s
 * `computeExperimentResult`; `experimentsService.js`'s
 * `buildAdjustedResultUpdate`/`EXCLUSION_REASONS`) — no additional mocking
 * beyond what rows (c)-(g)/(e) above already established for these same
 * Firebase-free (or, for RevisitWidget, already-mocked-above) modules. Per
 * the plan's own instruction, several rows carry an inline mutation-check
 * control (the identical fixture run through the PRE-hardening behavior)
 * rather than only asserting the post-hardening result, so a future
 * regression that silently reverts the hardening fails this row, not just
 * the dedicated GR1/EX1/EX2 suites.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Shared platform-boundary fakes
// ---------------------------------------------------------------------------

// In-memory Capacitor Preferences (owner-scoped outbox/op-store/telemetry
// modules all persist through this). Matches the pattern established in
// consentService.test.js / operationStore.test.ts / clearOwnerCaches.test.js.
//
// IMPORTANT: vitest.config.js aliases BOTH '@capacitor/core' AND
// '@capacitor/preferences' (and several other @capacitor/* packages) to the
// SAME underlying mock file (src/test/mocks/capacitor.js). vi.mock()
// intercepts by resolved module id, so two separate vi.mock() calls for
// different specifiers that resolve to that one shared id collide — whichever
// is registered last silently wins for BOTH specifiers, dropping the other's
// exports. audioVault.js needs `Capacitor` from '@capacitor/core'; consentService
// /operationStore/captureTelemetry/clearOwnerCaches need `Preferences` from
// '@capacitor/preferences'. This file exercises both, so a single shared
// factory carries every export either side needs, registered under both
// specifiers so it applies regardless of which one the resolver dedups to.
// `vi.mock()` factories are hoisted above module-level `const`s, so the
// factory body below cannot close over a shared helper variable declared
// with `const` (TDZ) — it's duplicated verbatim under both specifiers
// instead. `prefsStore` itself is safe to reference because factories run
// lazily at import-resolution time, by which point it's initialized.
const prefsStore = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: prefsStore.has(key) ? prefsStore.get(key) : null }),
    set: async ({ key, value }) => { prefsStore.set(key, value); },
    remove: async ({ key }) => { prefsStore.delete(key); },
    keys: async () => ({ keys: Array.from(prefsStore.keys()) }),
  },
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
    isPluginAvailable: () => false,
    convertFileSrc: (path) => path,
  },
  registerPlugin: () => ({ echo: async (options) => options }),
}));
vi.mock('@capacitor/core', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: prefsStore.has(key) ? prefsStore.get(key) : null }),
    set: async ({ key, value }) => { prefsStore.set(key, value); },
    remove: async ({ key }) => { prefsStore.delete(key); },
    keys: async () => ({ keys: Array.from(prefsStore.keys()) }),
  },
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
    isPluginAvailable: () => false,
    convertFileSrc: (path) => path,
  },
  registerPlugin: () => ({ echo: async (options) => options }),
}));

// Consent callables from config/firebase.js — this is the only real module
// under test in this file (consentService.js) that imports config/firebase,
// so the mock only needs to cover its two exports (it still exists purely to
// keep the real Firebase app from initializing on import). See the "Row 1"
// describe block below for why this file does NOT also assert on
// transcription/analysis provider callables — consentService.js's import
// graph never references them, so that assertion would be tautological;
// provider-blocking enforcement is covered elsewhere (see that block's
// comment for exactly where).
const revokeAiProcessingFn = vi.fn();
const grantAiProcessingFn = vi.fn();
// R1 rows (8-11 below) exercise spacesService.js / intentClient.js /
// analysis/index.js's getSmartChatContext — all of which import a handful of
// the modular Firestore SDK's named exports from this SAME resolved module
// (config/firebase.js). `firestoreMocks` is a generic, argument-tagging
// fake (modeled on src/services/spaces/__tests__/spacesService.test.js's own
// mock): each function just records/tags its arguments; the row that needs
// specific return data configures it via mockResolvedValueOnce/
// mockReturnValueOnce in its own test body. Consentservice/operationStore/etc
// (Rows 1-6) never import any of these names, so adding them here cannot
// affect those rows (see the comment above them for why that's provably true).
let autoIdCounter = 0;
function makeFirestoreBatch() {
  return {
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(async () => {}),
  };
}
const firestoreMocks = {
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((...args) => {
    if (args.length === 1) {
      // Auto-id doc ref generated from a collection ref: doc(collectionRef)
      const col = args[0];
      autoIdCounter += 1;
      return { __doc: `${col.__col}/auto-${autoIdCounter}` };
    }
    const [, path, id] = args;
    return { __doc: `${path}/${id}` };
  }),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((f, op, v) => ({ __where: [f, op, v] })),
  orderBy: vi.fn((f, dir) => ({ __orderBy: [f, dir] })),
  limit: vi.fn((n) => ({ __limit: n })),
  onSnapshot: vi.fn(() => () => {}),
  addDoc: vi.fn(async () => ({ id: 'auto-id' })),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: vi.fn(async () => {}),
  writeBatch: vi.fn(() => makeFirestoreBatch()),
};
const askJournalAIFn = vi.fn();
// R4 Phase 2 row (d)/(g)/(i): writeClaimWordingFn (claimsPipeline.js's LLM
// writer callable) and auth (analysis/index.js's buildVerifiedPatternsBlock
// reads auth.currentUser.uid) — both new consumers of this same resolved
// module. `authMock` is a single mutable object (not re-created per test) so
// each row's beforeEach can just set `authMock.currentUser` directly.
const writeClaimWordingFnMock = vi.fn();
const authMock = { currentUser: null };
vi.mock('../config/firebase', () => ({
  revokeAiProcessingFn: (...args) => revokeAiProcessingFn(...args),
  grantAiProcessingFn: (...args) => grantAiProcessingFn(...args),
  askJournalAIFn: (...args) => askJournalAIFn(...args),
  writeClaimWordingFn: (...args) => writeClaimWordingFnMock(...args),
  auth: authMock,
  // R2 row (a)/(b)/(g): the real orchestrator.js/EntryCard.jsx destructure
  // `db` from this module. Vitest's mock proxy throws on ANY accessed key
  // this factory doesn't return (even one nothing in this file dereferences
  // properties of) — an opaque placeholder is enough since every consumer
  // here only ever passes `db` through to an already-mocked doc()/
  // collection()/onSnapshot(), never reads off of it directly.
  db: {},
  ...firestoreMocks,
}));
// Row 8's getSmartChatContext import graph pulls in ai/gemini.js (unused by
// the function actually under test) — stub it so importing analysis/index.js
// never touches a real provider callable. (counterfactual.js/
// beliefDissonance.js, this comment's original reason for row (c) needing
// `callGemini` here, were deleted R4-P3 per P3-D1 — this mock is retained
// because row (b) below still needs it for the real synthesizer prompt
// capture.)
vi.mock('../services/ai/gemini', () => ({ analyzeJournalEntryCloud: vi.fn(), callGemini: vi.fn(async () => null) }));

// R2 rows (a)/(b) need the REAL `generateInsights`/`fetchRecentEntries` (the
// receipts-on-every-insight and exclusion-honoring-regeneration invariants
// can only be pinned against the real orchestrator, not a stub of it).
// Row 11's insightBudget.js only needs `isDuplicateInsight` stubbed to a
// fixed "never a dupe" so the budget-cap math is what's on trial there, not
// orchestrator's similarity heuristics — `importOriginal` keeps every other
// export (generateInsights included) genuinely real for everyone.
vi.mock('../services/nexus/orchestrator', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isDuplicateInsight: vi.fn(() => false) };
});

// The real orchestrator.js (loaded above) imports 'firebase/firestore'
// directly (not through config/firebase's mock) plus its full Layer 1-4 /
// health / gap-detector dependency graph. This block mirrors EXACTLY the
// mocking already established in orchestrator.receipts.test.js /
// orchestrator.exclusions.test.js (Task 8/10's own dedicated test files) —
// Layer 1 pattern detection (`detectPatternsInPeriod`) and the
// orchestrator's own internal `computeEntityMoodCorrelations` are left REAL
// so rows (a)/(b) reflect genuine entry-id threading, not a stubbed
// invariant. No other row in this file touches any of these specifiers.
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  collection: vi.fn(() => ({})),
  query: vi.fn((...args) => ({ __args: args })),
  where: vi.fn((...args) => ({ __where: args })),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  deleteField: vi.fn(() => ({ __op: 'deleteField' })),
  // R4 Phase 1 rows (a)-(j), bottom of file: claimsService.js/testingLedger.js/
  // claimFeedback.js need updateDoc/writeBatch/runTransaction/addDoc, none of
  // which any row ABOVE this one calls — bare placeholders here, given a
  // real path-keyed implementation via that section's own wireClaimsFirestore()
  // helper (mirrors claimsPipeline.test.js's/claimsService.test.js's own
  // dedicated Firestore fakes). Adding them is inert for every earlier row.
  updateDoc: vi.fn(async () => {}),
  writeBatch: vi.fn(() => ({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => {}) })),
  runTransaction: vi.fn(async (_db, fn) => fn({ get: async () => ({ exists: () => false, data: () => undefined }), set: () => {} })),
  addDoc: vi.fn(async () => ({ id: 'auto-id' })),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) })),
    // Row (d) needs this for real (buildOfflineSyncPayload/buildCoreEntry
    // both call Timestamp.fromDate(...).toDate().toISOString() elsewhere in
    // this file's Row 3 too) — return a Date-backed stand-in, not a bare tag.
    fromDate: vi.fn((d) => ({ toMillis: () => d.getTime(), toDate: () => d })),
  },
}));
vi.mock('../services/health/whoop', () => ({
  isWhoopLinked: vi.fn(async () => false),
  getWhoopSummary: vi.fn(async () => null),
  getWhoopHistory: vi.fn(async () => ({ available: false, days: [] })),
}));
vi.mock('../services/nexus/gapDetector', () => ({ detectGaps: vi.fn(async () => []) }));
vi.mock('../services/nexus/layer1/threadManager', () => ({
  getActiveThreads: vi.fn(async () => []),
  identifyThreadAssociation: vi.fn(async () => ({})),
}));
vi.mock('../services/nexus/layer1/somaticExtractor', () => ({ extractSomaticSignals: vi.fn(() => []) }));
vi.mock('../services/nexus/layer2/stateDetector', () => ({
  detectCurrentState: vi.fn(async () => ({})),
  updateCurrentState: vi.fn(async () => {}),
}));
vi.mock('../services/nexus/layer2/baselineManager', () => ({
  getBaselines: vi.fn(async () => null),
  calculateAndSaveBaselines: vi.fn(async () => {}),
  compareToBaseline: vi.fn(() => ({})),
}));
vi.mock('../services/nexus/layer3/synthesizer', () => ({
  INSIGHT_TYPES: {},
  generateCausalSynthesis: vi.fn(async () => ({
    success: true,
    insight: {
      id: 'synthesis-1',
      type: 'causal_synthesis',
      title: 'Synthesis Insight',
      summary: 'summary',
      body: 'body',
      evidence: { narrative: [], statistical: { sampleSize: 12 } },
    },
  })),
  generateNarrativeArcInsight: vi.fn(async () => null),
}));
vi.mock('../services/nexus/layer3/crossThreadDetector', () => ({
  detectMetaPatterns: vi.fn(async () => []),
  generateMetaPatternInsight: vi.fn(async () => null),
}));
// beliefDissonance.js / counterfactual.js mocks deleted R4-P3 per P3-D1
// (superseded by claims+experiments; legacy Firestore belief docs may
// remain, harmless).
vi.mock('../services/nexus/layer4/interventionTracker', () => ({
  updateInterventionData: vi.fn(async () => {}),
  getInterventionData: vi.fn(async () => ({})),
}));
vi.mock('../services/nexus/layer4/recommendationEngine', () => ({ generateRecommendations: vi.fn(async () => []) }));

// Row (a)/(b) also need a controllable `getExcludedEntryIds` (R2 Task 10) —
// mirrors orchestrator.exclusions.test.js's approach: no exclusions by
// default, overridden per-test via mockResolvedValueOnce.
//
// R4 Phase 1 rows (a)/(b)/(e)/(g)/(h), bottom of file, ALSO import this same
// module: claimsPipeline.js calls `listSourceExclusions` (stubbed the same
// way, empty by default) and claimFeedback.js calls `excludeSource` — kept
// REAL via importOriginal, since row (h)'s whole point is asserting on the
// actual write `excludeSource` produces (entryId/appliesTo/reason/permanent)
// through this file's already-established `firestoreMocks.addDoc`.
const getExcludedEntryIdsMock = vi.fn(async () => new Set());
const listSourceExclusionsMock = vi.fn(async () => []);
vi.mock('../services/insights/sourceExclusions', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getExcludedEntryIds: (...args) => getExcludedEntryIdsMock(...args),
    listSourceExclusions: (...args) => listSourceExclusionsMock(...args),
  };
});

// Row (c) needs companionContext's Tier1/Tier2 deps controllable — mirrors
// companionContext.tier1Tier2Scope.test.js's own mocks exactly.
vi.mock('../services/ai/embeddings', () => ({ cosineSimilarity: () => 0 }));
vi.mock('../services/memory', () => ({
  getMemoryGraph: vi.fn(async () => null),
  formatMemoryForContext: vi.fn(() => null),
}));
vi.mock('../services/memory/sessionBuffer', () => ({
  getSessionBuffer: vi.fn(() => null),
  formatBufferForContext: vi.fn(() => null),
  isExpired: vi.fn(() => true),
}));

// Row (f) needs sessionPrep.js importable without pulling in runRecipe's own
// heavy deps (askJournalAI/analysis) — mirrors sessionPrep.test.js's own
// mock of '../runRecipe' verbatim (composeSessionPrepPdf never calls any of
// these; they only need to exist so the module graph resolves).
vi.mock('../services/reflections/runRecipe', () => ({
  runQuestions: vi.fn(),
  loadReflection: vi.fn(),
  writeBlocks: vi.fn(),
  reflectionsPath: vi.fn((uid) => `artifacts/echo-vault-v5-fresh/users/${uid}/reflections`),
  newBlockId: vi.fn(() => 'block_test'),
}));
vi.mock('../utils/pdf', () => ({ loadJsPDF: vi.fn() }));

// Row (g) needs EntryCard's own flag/user seams controllable — mirrors
// EntryCard.test.jsx's own mocks. spacesService/recompute/intentClient are
// deliberately left REAL here (Rows 9/10 already exercise them for real in
// this same file against the config/firebase mock below; mocking them here
// too would shadow those rows).
vi.mock('../config/flags', () => ({ getFlag: vi.fn() }));
vi.mock('../stores', () => ({ useUser: () => ({ uid: 'user-matrix-chapters' }) }));

// R4 Phase 2 row (g): InsightsPage.jsx's own import graph, mirroring
// InsightsPage.claims.test.jsx's established mock recipe (dedicated file)
// ONLY for the specifiers no OTHER row in this file already needs real
// (moderation/reportInsight, analytics/insightEngagement,
// nexus/insightIntegration, the ReceiptSheet component, and the
// useNexusInsights/useBasicInsights hooks themselves — none of these are
// touched by any row above). Deliberately NOT mocked here (unlike
// InsightsPage.claims.test.jsx's own recipe): nexus/insightDismissal,
// basicInsights/feedbackLearning, services/dashboard, and
// health/environment correlations — R2/R4 rows above already exercise
// those SAME resolved modules for real (dismissalKeyFor/getDismissedKeys,
// shouldShowInsight, recompute.js's invalidateDailySummary/etc,
// computeHealthMoodCorrelations), so a blanket replacement here would
// silently break them. Row (g) below never triggers InsightsPage's
// dismiss/feedback actions, and calculateStreak/health-correlations are
// left genuinely real (pure functions over `entries`) with a real
// sufficiency-clearing fixture where the row needs correlations to render.
// claimsService.js (used by useClaims.js) is likewise left REAL via this
// file's existing wireClaimsFirestore() helper below — a deliberate
// divergence from InsightsPage.claims.test.jsx, which mocks claimsService
// directly; here it stays real so row (g) proves the actual Firestore-
// shaped claim flow feeding the page, not a canned fixture.
const useNexusInsightsMock = vi.fn();
vi.mock('../hooks/useNexusInsights', () => ({ useNexusInsights: (...a) => useNexusInsightsMock(...a) }));
const useBasicInsightsMock = vi.fn();
vi.mock('../hooks/useBasicInsights', () => ({ useBasicInsights: (...a) => useBasicInsightsMock(...a) }));
vi.mock('../services/moderation/reportInsight', () => ({ reportInsight: vi.fn().mockResolvedValue(true) }));
vi.mock('../services/analytics/insightEngagement', () => ({ recordInsightEngagement: vi.fn().mockResolvedValue(true) }));
const getTodayRecommendationsMock = vi.fn().mockResolvedValue(null);
vi.mock('../services/nexus/insightIntegration', () => ({ getTodayRecommendations: (...a) => getTodayRecommendationsMock(...a) }));
vi.mock('../components/insights/ReceiptSheet', () => ({ default: () => null }));

// R4 Phase 2 row (h): functions/src/reports/narrative.js — cross-package
// import, same precedent as the CAUSAL_RE parity test / this file's own
// dismissalKey pair. shared/gemini.js's only export (callGemini) is mocked
// wholesale (network boundary; no other functions/src module used for real
// elsewhere in this file calls it at runtime). models/registry.js is NOT
// safe to replace wholesale — R2/R4/Hardening rows above already pull in
// functions/src/shared/constants.js for real (via generator.js/
// selectRevisits.js's own import graphs), and THAT module destructures
// MODEL_DEFAULTS from registry.js at its own top level — importOriginal
// preserves WORKLOADS/MODEL_DEFAULTS/getModelSync/etc. genuinely real and
// overrides only the one function (getModel) row (h) needs controllable.
vi.mock('../../functions/src/shared/gemini.js', () => ({ callGemini: vi.fn() }));
vi.mock('../../functions/src/models/registry.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getModel: vi.fn() };
});

// localStorage backing store. src/test/setup.js replaces window.localStorage
// with plain vi.fn() no-op stubs; drive them with an in-memory Map so the
// owner-scoped modules that use plain localStorage (draftAutosave,
// pendingReviewDrafts, audioVault's index) are genuinely exercised. Following
// the established convention from consentService.test.js.
let localStore;
function wireLocalStorage() {
  localStore = new Map();
  localStorage.getItem.mockImplementation((key) => (localStore.has(key) ? localStore.get(key) : null));
  localStorage.setItem.mockImplementation((key, value) => { localStore.set(key, String(value)); });
  localStorage.removeItem.mockImplementation((key) => { localStore.delete(key); });
  localStorage.clear.mockImplementation(() => { localStore.clear(); });
}

beforeEach(() => {
  prefsStore.clear();
  wireLocalStorage();
  vi.clearAllMocks();
});

// ===========================================================================
// Row 1: Consent revoked while queued
// ===========================================================================
describe('Matrix row: Consent revoked while queued', () => {
  const OWNER = 'user-consent';

  it('revoke flips local state immediately, even before the network call is attempted', async () => {
    const { revokeAiConsent, isAiLocallyEnabled } = await import('../services/consent/consentService.js');
    revokeAiProcessingFn.mockRejectedValue(new Error('offline'));

    // Fail-closed: local marker flips synchronously, independent of network.
    await revokeAiConsent(OWNER);

    expect(isAiLocallyEnabled(OWNER)).toBe(false);
  });

  it('the queued outbox op survives a simulated app reload (fresh module import re-drains it)', async () => {
    const { revokeAiConsent } = await import('../services/consent/consentService.js');
    revokeAiProcessingFn.mockRejectedValue(new Error('offline at revoke time'));
    await revokeAiConsent(OWNER);
    expect(prefsStore.get(`consent_outbox::${OWNER}`)).toBeTruthy();

    // Simulate an app restart: reset the module registry (in-memory state is
    // gone) but the Preferences-backed outbox (prefsStore) persists across it,
    // exactly like real Capacitor Preferences persists across process kills.
    vi.resetModules();
    const fresh = await import('../services/consent/consentService.js');

    revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 0 } });
    await fresh.flushConsentOutbox(OWNER);

    // Flush cancels the queued op once the callable finally succeeds.
    expect(prefsStore.get(`consent_outbox::${OWNER}`)).toBeUndefined();
    expect(revokeAiProcessingFn).toHaveBeenCalled();
  });

  it('isAiLocallyEnabled stays false across a rejected callable AND a simulated reload — the seam any client gate must consume', async () => {
    // NOTE on scope: this file cannot assert "no provider callable invoked"
    // directly here — consentService.js's import graph never references
    // transcription/analysis callables at all, so that assertion would be
    // tautological (it could never fail no matter what the code does).
    // End-to-end provider blocking is actually enforced in two other places,
    // neither of which belongs in this test:
    //   - Server-side: functions/src/consent/consentGate.js's
    //     `assertAiConsent`/`isAiAllowed`, fail-closed on every AI callable
    //     and trigger — covered by
    //     functions/src/consent/__tests__/consentGate.test.js.
    //   - Client-side: App.jsx's `aiProcessingEnabled` UI gates that decide
    //     whether to invoke a provider callable at all — untestable here per
    //     this repo's project constraints (App.jsx is untested; see
    //     docs/quality's gotchas / root CLAUDE.md).
    // What IS this module's honest contract, and what every such gate must
    // ultimately read, is `isAiLocallyEnabled`: it must report `false`
    // synchronously after a revoke whose server callable rejected, and it
    // must stay `false` across a simulated app restart (Preferences-backed
    // state persists; a fresh module import re-reads the same localStorage
    // marker). That's what this test asserts.
    const { revokeAiConsent, isAiLocallyEnabled } = await import('../services/consent/consentService.js');
    revokeAiProcessingFn.mockRejectedValue(new Error('offline'));

    await revokeAiConsent(OWNER);
    expect(isAiLocallyEnabled(OWNER)).toBe(false);

    // Simulate an app restart: reset the module registry, then re-check the
    // seam through a freshly imported module handle. localStorage (the
    // marker's real backing store) persists across this, exactly as it
    // would across a real process restart.
    vi.resetModules();
    const fresh = await import('../services/consent/consentService.js');
    expect(fresh.isAiLocallyEnabled(OWNER)).toBe(false);

    // Draining the outbox afterward (server finally reachable) must not
    // flip local state back on — a late-succeeding revoke ack is still a
    // revoke ack, not a grant.
    revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 3 } });
    await fresh.flushConsentOutbox(OWNER);
    expect(fresh.isAiLocallyEnabled(OWNER)).toBe(false);
    expect(grantAiProcessingFn).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Row 2: Account switch on one device
// ===========================================================================
describe('Matrix row: Account switch on one device', () => {
  const OWNER_A = 'user-switch-a';
  const OWNER_B = 'user-switch-b';

  it('B reads none of A\'s data across every owner-scoped store after A logs out and B logs in', async () => {
    const { clearOwnerCaches } = await import('../services/storage/clearOwnerCaches.js');
    const operationStore = await import('../services/capture/operationStore');
    const draftAutosave = await import('../services/capture/draftAutosave.js');
    const pendingReviewDrafts = await import('../services/capture/pendingReviewDrafts');
    const captureTelemetry = await import('../services/telemetry/captureTelemetry.js');
    const { audioVault } = await import('../services/audio/audioVault.js');

    // --- Seed owner A's data across all six owner-scoped store families ---

    // 1. whoop cache keys (Preferences).
    prefsStore.set(`whoop_cached_summary::${OWNER_A}`, JSON.stringify({ recovery: { score: 80 } }));
    prefsStore.set(`whoop_link_status::${OWNER_A}`, 'true');

    // 2. capture_ops (Preferences, via the real operationStore).
    const op = await operationStore.createOperation(OWNER_A, { recordingId: 'rec_1_aaaaaa' });

    // 3. entry_draft (localStorage, via the real draftAutosave module).
    draftAutosave.writeDraft('entry_draft', OWNER_A, 'unsent typed draft text for A');

    // 4. pending_review_drafts (localStorage, via the real module).
    pendingReviewDrafts.markPendingReview(OWNER_A, 'native-draft-a1');

    // 5. capture_stages (Preferences, via the real telemetry ring buffer).
    await captureTelemetry.recordStage(OWNER_A, op.opId, captureTelemetry.STAGES.LOCAL_READY, {});

    // 6. audioVault index (localStorage; falls back off IndexedDB in jsdom, so
    //    saveRecording uses the legacy single-blob localStorage path — still a
    //    real, owner-scoped write through the real module).
    const saved = await audioVault.saveRecording(OWNER_A, 'QUJD', 'audio/webm');
    expect(saved.id).toBeTruthy();

    // Sanity: A can read its own data before switching.
    expect(await operationStore.listIncomplete(OWNER_A)).toHaveLength(1);
    expect(draftAutosave.restoreDraft('entry_draft', OWNER_A)).not.toBe('');
    expect(pendingReviewDrafts.isPendingReview(OWNER_A, 'native-draft-a1')).toBe(true);
    expect(await captureTelemetry.getRecentStages(OWNER_A)).toHaveLength(1);
    expect(await audioVault.listOrphans(OWNER_A)).toHaveLength(1);

    // --- Logout: clearOwnerCaches(A) ---
    await clearOwnerCaches(OWNER_A);

    // clearOwnerCaches sweeps every Preferences key suffixed `::A`, so the
    // Preferences-backed stores (whoop + capture_ops + capture_stages) are
    // actually removed, not merely shadowed.
    expect(prefsStore.has(`whoop_cached_summary::${OWNER_A}`)).toBe(false);
    expect(prefsStore.has(`whoop_link_status::${OWNER_A}`)).toBe(false);
    expect(prefsStore.has(`capture_ops::${OWNER_A}`)).toBe(false);
    expect(prefsStore.has(`capture_stages::${OWNER_A}`)).toBe(false);

    // --- Login as B: every read is scoped to B's own uid, so B sees none of
    // A's data regardless of storage backend. This is the actual isolation
    // guarantee (key scoping, per clearOwnerCaches.js's own module doc) — the
    // localStorage-backed stores (entry_draft, pending_review_drafts,
    // audioVault index) are NOT touched by clearOwnerCaches, and isolation
    // still holds because B's reads never address A's key.
    expect(await operationStore.listIncomplete(OWNER_B)).toEqual([]);
    expect(draftAutosave.restoreDraft('entry_draft', OWNER_B)).toBe('');
    expect(pendingReviewDrafts.isPendingReview(OWNER_B, 'native-draft-a1')).toBe(false);
    expect(await captureTelemetry.getRecentStages(OWNER_B)).toEqual([]);
    expect(await audioVault.listOrphans(OWNER_B)).toEqual([]);
    // Preferences-swept whoop keys are gone for A, and B never had any.
    expect(prefsStore.has(`whoop_cached_summary::${OWNER_B}`)).toBe(false);
  });

  it('clearOwnerCaches(A) never touches an unrelated owner B\'s Preferences data', async () => {
    const { clearOwnerCaches } = await import('../services/storage/clearOwnerCaches.js');
    prefsStore.set(`whoop_cached_summary::${OWNER_A}`, 'a-data');
    prefsStore.set(`whoop_cached_summary::${OWNER_B}`, 'b-data');
    prefsStore.set(`capture_ops::${OWNER_B}`, '[]');

    await clearOwnerCaches(OWNER_A);

    expect(prefsStore.get(`whoop_cached_summary::${OWNER_B}`)).toBe('b-data');
    expect(prefsStore.get(`capture_ops::${OWNER_B}`)).toBe('[]');
  });
});

// ===========================================================================
// Row 3: Health/location/weather unavailable
// ===========================================================================
describe('Matrix row: Health/location/weather unavailable', () => {
  it('core entry is untouched, every enrichment field is ABSENT (never fabricated), status is partial', async () => {
    const { buildCoreEntry } = await import('../services/entries/buildCoreEntry.js');
    const { runPostSaveEnrichment } = await import('../services/entries/enrichmentRunner.js');

    const core = buildCoreEntry({
      text: 'went for a walk, not sure how it went',
      user: { uid: 'user-enrich' },
      captureContext: { capturedAt: '2026-07-20T10:00:00.000Z', captureTimezone: 'America/Los_Angeles' },
      platform: 'web',
      consentSnapshot: true,
    });
    // Snapshot own keys + primitive field values (not a JSON round-trip,
    // which would strip the Firestore Timestamp class off createdAt/
    // effectiveDate and produce a false-positive mismatch against itself).
    const keysBeforeEnrichment = Object.keys(core).sort();
    const textBeforeEnrichment = core.text;
    const userIdBeforeEnrichment = core.userId;
    const analysisStatusBeforeEnrichment = core.analysisStatus;
    const enrichmentBeforeEnrichment = { ...core.enrichment };

    const updateDoc = vi.fn().mockResolvedValue(undefined);
    const deps = {
      getEntryHealthContext: vi.fn().mockRejectedValue(new Error('whoop unreachable')),
      getEntryEnvironmentContext: vi.fn().mockRejectedValue(new Error('open-meteo down')),
      getCurrentLocation: vi.fn().mockRejectedValue(new Error('geolocation denied')),
      detectTemporalContext: vi.fn().mockRejectedValue(new Error('gemini down')),
      performLocalAnalysis: vi.fn(),
      updateDoc,
      recordStage: vi.fn().mockResolvedValue(undefined),
    };

    const entryRef = { id: 'entry-enrich-1' };
    await runPostSaveEnrichment({
      entryRef,
      entryData: core,
      captureContext: { coarseLocation: null },
      deps,
    });

    // Core entry object itself was never mutated by the runner (enrichment
    // is a separate updateDoc payload, not an in-place write to entryData).
    expect(Object.keys(core).sort()).toEqual(keysBeforeEnrichment);
    expect(core.text).toBe(textBeforeEnrichment);
    expect(core.userId).toBe(userIdBeforeEnrichment);
    expect(core.analysisStatus).toBe(analysisStatusBeforeEnrichment);
    expect(core.enrichment).toEqual(enrichmentBeforeEnrichment);

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const written = updateDoc.mock.calls[0][1];

    expect(written.enrichment.status).toBe('partial');
    expect(written.enrichment.reasons.health).toBeTruthy();
    expect(written.enrichment.reasons.environment).toBeTruthy();
    expect(written.enrichment.reasons.temporal).toBeTruthy();

    // Nothing fabricated: every optional field stays ABSENT, not null-stuffed.
    expect(written).not.toHaveProperty('healthContext');
    expect(written).not.toHaveProperty('environmentContext');
    expect(written).not.toHaveProperty('location');
    expect(written).not.toHaveProperty('temporalContext');
    expect(written).not.toHaveProperty('futureMentions');

    // Defensive: no known fabricated-default field values anywhere in the write.
    const serialized = JSON.stringify(written);
    expect(serialized).not.toContain('hasWorkout');
    expect(serialized).not.toContain('isDay');

    // Core fields were never re-written by the enrichment update payload.
    expect(written).not.toHaveProperty('text');
    expect(written).not.toHaveProperty('userId');
    expect(written).not.toHaveProperty('analysisStatus');
  });
});

// ===========================================================================
// Row 4: Duplicate trigger/retry delivery
// ===========================================================================
describe('Matrix row: Duplicate trigger/retry delivery', () => {
  const OWNER = 'user-dup';

  it('resumeOperations with an entry already carrying operationId: no second entry create, op completes idempotently', async () => {
    const operationStore = await import('../services/capture/operationStore');
    const { resumeIncompleteOperations } = await import('../services/capture/resumeOperations.js');

    const op = await operationStore.createOperation(OWNER, { recordingId: 'rec_dup_aaaaaa' });
    await operationStore.advance(OWNER, op.opId, 'transcribing');

    const vault = { getRecording: vi.fn(async () => ({ base64: 'QUJD', mime: 'audio/mp4' })) };
    const handleAudioRetry = vi.fn(); // would re-transcribe / re-create if called
    // Simulates the real defaultFindEntryByOperationId's contract: an entry
    // already exists for this operationId (a prior delivery landed it).
    const findEntryByOperationId = vi.fn(async () => 'entry-already-saved');

    const summary = await resumeIncompleteOperations({
      ownerUid: OWNER,
      db: {},
      handleAudioRetry,
      store: operationStore,
      vault,
      findEntryByOperationId,
    });

    // No second entry is ever created — the duplicate-delivery guard links +
    // completes instead of re-dispatching transcription.
    expect(handleAudioRetry).not.toHaveBeenCalled();
    expect(summary.completed).toBe(1);
    expect(summary.resumed).toBe(0);

    // Verified against the REAL operationStore's persisted state, not a fake.
    expect(await operationStore.listIncomplete(OWNER)).toEqual([]);
    const persisted = JSON.parse(prefsStore.get(`capture_ops::${OWNER}`));
    expect(persisted[0].stage).toBe('complete');
    expect(persisted[0].entryId).toBe('entry-already-saved');
  });

  it('operationStore attempts cap engages at 5: the 6th resume no longer retries', async () => {
    const operationStore = await import('../services/capture/operationStore');
    const { resumeIncompleteOperations } = await import('../services/capture/resumeOperations.js');

    const op = await operationStore.createOperation(OWNER, { recordingId: 'rec_poison_aaaaaa' });
    await operationStore.advance(OWNER, op.opId, 'transcribing');

    const vault = { getRecording: vi.fn(async () => ({ base64: 'QUJD', mime: 'audio/mp4' })) };
    // A retry that "never lands" (simulating repeated app kills mid-retry) —
    // it never advances the op stage or creates an entry.
    const handleAudioRetry = vi.fn();
    const findEntryByOperationId = vi.fn(async () => null);

    for (let i = 0; i < 6; i += 1) {
      await resumeIncompleteOperations({
        ownerUid: OWNER,
        db: {},
        handleAudioRetry,
        store: operationStore,
        vault,
        findEntryByOperationId,
      });
    }

    // Real operationStore: 5 actual retry dispatches (attempts 0->5 via
    // recordAttempt), then the 6th launch hits the cap and surfaces via
    // markNeedsAttention instead of dispatching a 6th retry (markNeedsAttention
    // itself also bumps attempts once more when it fires, landing at 6).
    expect(handleAudioRetry).toHaveBeenCalledTimes(5);
    const persisted = await operationStore.findByRecordingId(OWNER, 'rec_poison_aaaaaa');
    expect(persisted.attempts).toBe(6);
    expect(persisted.stage).toBe('needs_attention');
    expect(persisted.lastError).toBe('retry-exhausted');
  });
});

// ===========================================================================
// Row 5: Network loss during upload
// ===========================================================================
describe('Matrix row: Network loss during upload', () => {
  const OWNER = 'user-netloss';

  it('vault audio stays intact, op lands in needs_attention with a real error code, and retry reuses the same recordingId+op (no duplicate vault entry)', async () => {
    const { prepareDurableRecording } = await import('../services/capture/prepareDurableRecording.js');
    const operationStore = await import('../services/capture/operationStore');
    const { audioVault } = await import('../services/audio/audioVault.js');

    // 1. Fresh save: audio is committed durably BEFORE any network call.
    const prepared = await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJDREVGRw==',
      mimeType: 'audio/webm',
      audioVault,
    });
    expect(prepared.ok).toBe(true);
    const { recordingId } = prepared;

    const op = await operationStore.createOperation(OWNER, { recordingId });
    await operationStore.advance(OWNER, op.opId, 'uploading');

    // 2. Simulate the transcription network call failing (the boundary being
    //    mocked — everything else here is the real client pipeline).
    const transcribeAudio = vi.fn().mockRejectedValue(new Error('network request failed'));
    let errorCode;
    try {
      await transcribeAudio();
    } catch (e) {
      errorCode = 'network_error';
      await operationStore.markNeedsAttention(OWNER, op.opId, errorCode);
    }

    // 3. Vault audio survived the transcription failure intact.
    const recording = await audioVault.getRecording(OWNER, recordingId);
    expect(recording).not.toBeNull();
    expect(recording.base64).toBe('QUJDREVGRw==');

    // 4. Op is needs_attention with a real (non-empty, descriptive) error code.
    const afterFailure = await operationStore.findByRecordingId(OWNER, recordingId);
    expect(afterFailure.stage).toBe('needs_attention');
    expect(afterFailure.lastError).toBe('network_error');
    expect(typeof afterFailure.lastError).toBe('string');
    expect(afterFailure.lastError.length).toBeGreaterThan(0);

    // 5. Retry path: prepareDurableRecording called again with the SAME
    //    recordingId (as a real retry would supply) reuses it without a new
    //    vault write.
    const saveRecordingSpy = vi.spyOn(audioVault, 'saveRecording');
    const retried = await prepareDurableRecording({
      ownerUid: OWNER,
      base64: 'QUJDREVGRw==',
      mimeType: 'audio/webm',
      existingRecordingId: recordingId,
      audioVault,
    });
    expect(retried).toEqual({ ok: true, recordingId });
    expect(saveRecordingSpy).not.toHaveBeenCalled();
    saveRecordingSpy.mockRestore();

    // The retry reuses the SAME op (found by recordingId) — no duplicate op,
    // no duplicate vault entry.
    const sameOp = await operationStore.findByRecordingId(OWNER, recordingId);
    expect(sameOp.opId).toBe(op.opId);
    const allOrphans = await audioVault.listOrphans(OWNER);
    expect(allOrphans).toHaveLength(1);
    const allOps = JSON.parse(prefsStore.get(`capture_ops::${OWNER}`));
    expect(allOps).toHaveLength(1);
  });
});

// ===========================================================================
// Row 6: User edits transcript
// ===========================================================================
describe('Matrix row: User edits transcript', () => {
  it('buildMeaningfulEditFields bumps entryInputVersion, sets analysisStatus pending, marks enrichment stale — and never touches rawTranscript', async () => {
    const { hasTextMeaningfullyChanged, buildMeaningfulEditFields } = await import('../services/entries/entryCorrectionFields.js');

    const oldText = 'went to the gym today felt tired';
    const newText = 'went to the gym today felt tired but pushed through and had a great session';
    expect(hasTextMeaningfullyChanged(oldText, newText)).toBe(true);

    const incrementSentinel = { __op: 'increment', by: 1 };
    const increment = vi.fn((by) => ({ ...incrementSentinel, by }));

    const fields = buildMeaningfulEditFields({ nextSignalExtractionVersion: 4, increment });

    expect(fields.signalExtractionVersion).toBe(4);
    expect(fields.entryInputVersion).toEqual({ __op: 'increment', by: 1 });
    expect(increment).toHaveBeenCalledWith(1);
    expect(fields.analysisStatus).toBe('pending');
    expect(fields['enrichment.status']).toBe('stale');

    // transcription.rawTranscript (capture-time provenance) is never among
    // the keys a meaningful edit updates — raw transcript survives corrections
    // untouched.
    const updatedKeys = Object.keys(fields);
    expect(updatedKeys).not.toContain('transcription.rawTranscript');
    expect(updatedKeys).not.toContain('transcription');
    expect(updatedKeys).not.toContain('rawTranscript');
    expect(fields).not.toHaveProperty('transcription');
  });

  it('a non-meaningful edit (punctuation/typo only) is NOT flagged as requiring re-extraction', async () => {
    const { hasTextMeaningfullyChanged } = await import('../services/entries/entryCorrectionFields.js');
    expect(hasTextMeaningfullyChanged('went to the gym today', 'went to the gym today.')).toBe(false);
  });
});

// ===========================================================================
// Row 7: Dismissed open loop does not reappear after re-extraction (R1 Task 1)
// ===========================================================================
describe('Matrix row: Dismissed open loop survives re-extraction', () => {
  // Minimal in-memory Firestore fake matching the shape
  // functions/src/intents/extractIntents.js expects (entryRef.parent.parent.
  // collection(name), collection.where(...).get(), collection.doc(id),
  // db.batch()/commit()). Mirrors the fake in
  // functions/src/intents/__tests__/extractIntents.test.js, trimmed to only
  // what this one row needs.
  function makeFakeFirestore() {
    const store = new Map();
    function matches(data, field, op, value) {
      if (op === 'in') return Array.isArray(value) && value.includes(data[field]);
      return data[field] === value;
    }
    function makeDocRef(path) {
      return {
        path,
        id: path.split('/').pop(),
        get parent() { return makeColRef(path.split('/').slice(0, -1).join('/')); },
        collection(name) { return makeColRef(`${path}/${name}`); },
        async get() {
          if (path === 'config/flags') return { exists: true, data: () => ({}) };
          const data = store.get(path);
          return { exists: data !== undefined, data: () => data };
        },
      };
    }
    function makeColRef(path) {
      return {
        path,
        get parent() { return makeDocRef(path.split('/').slice(0, -1).join('/')); },
        doc(id) { return makeDocRef(`${path}/${id}`); },
        where(field, op, value) {
          return {
            async get() {
              const docs = [];
              for (const [p, data] of store.entries()) {
                if (p.startsWith(`${path}/`) && p.split('/').length === path.split('/').length + 1) {
                  if (matches(data, field, op, value)) docs.push({ id: p.split('/').pop(), data: () => data });
                }
              }
              return { forEach: (fn) => docs.forEach(fn), size: docs.length, empty: docs.length === 0 };
            },
          };
        },
      };
    }
    const db = {
      batch() {
        const ops = [];
        return {
          set(ref, data, opts) { ops.push({ type: 'set', ref, data, opts }); },
          delete(ref) { ops.push({ type: 'delete', ref }); },
          async commit() {
            for (const op of ops) {
              if (op.type === 'delete') { store.delete(op.ref.path); continue; }
              const prev = op.opts?.merge ? store.get(op.ref.path) || {} : {};
              store.set(op.ref.path, { ...prev, ...op.data });
            }
          },
        };
      },
      doc: (p) => makeDocRef(p),
    };
    return { db, store };
  }

  it('a dismissed open_loop intent is never resurrected by a later re-extraction of the same entry, using the real extraction+policy modules', async () => {
    const { _clearFlagCacheForTest } = await import('../../functions/src/shared/flags.js');
    _clearFlagCacheForTest();
    const { runIntentExtraction, normalizeCandidates } = await import('../../functions/src/intents/extractIntents.js');
    const { INTENT_ATTRIBUTE_KEYS } = await import('../../functions/src/intents/intentSchema.js');

    function attrs(overrides = {}) {
      const base = {};
      for (const k of INTENT_ATTRIBUTE_KEYS) base[k] = false;
      return { ...base, ...overrides };
    }

    const { db, store } = makeFakeFirestore();
    const USER_BASE = 'artifacts/app/users/loop-user';
    const entryRef = db.doc(`${USER_BASE}/entries/e1`);
    const text = 'Ask me tomorrow how the meeting went.';
    const buildCandidates = () => async () => normalizeCandidates([
      {
        kind: 'open_loop',
        text: 'Ask me tomorrow how the meeting went',
        attributes: attrs({ agency: true, unfinished: true }),
        confidence: 0.8,
        explicitCommand: true,
      },
    ], text);

    // v1: normal extraction creates an active open_loop intent.
    await runIntentExtraction({
      db, entryRef, entry: { id: 'e1', text, entryInputVersion: 1 }, modelId: 'm', apiKey: 'k', extractCandidates: buildCandidates(),
    });
    const intentPath = [...store.keys()].find((p) => p.includes('/intents/'));
    expect(store.get(intentPath).state).toBe('active');
    expect(store.get(intentPath).kind).toBe('open_loop');

    // The user dismisses it client-side (same write shape
    // intentClient.dismissIntent produces: state -> 'dismissed').
    store.set(intentPath, { ...store.get(intentPath), state: 'dismissed', userText: 'not relevant anymore' });
    const beforeReExtraction = store.get(intentPath);

    // A later edit bumps entryInputVersion; the entry is re-extracted with the
    // SAME candidate (same evidence span -> same deterministic id).
    const result = await runIntentExtraction({
      db, entryRef, entry: { id: 'e1', text, entryInputVersion: 2 }, modelId: 'm', apiKey: 'k', extractCandidates: buildCandidates(),
    });

    const afterReExtraction = store.get(intentPath);
    expect(afterReExtraction.state).toBe('dismissed'); // never resurrected
    expect(afterReExtraction.userText).toBe('not relevant anymore'); // user-set field preserved
    expect(afterReExtraction.inputVersion).toBe(2); // only the reap-relevant marker bumped
    // Confirm the merge touched ONLY inputVersion/updatedAt.
    const { inputVersion: _iv1, updatedAt: _ua1, ...restBefore } = beforeReExtraction;
    const { inputVersion: _iv2, updatedAt: _ua2, ...restAfter } = afterReExtraction;
    expect(restAfter).toEqual(restBefore);
    expect(result.extractedTasks).toEqual([]); // dismissed loop never resurfaces via the legacy compat list
  });
});

// ===========================================================================
// Row 8: Work-scoped question retrieves zero Personal candidates (R1 Task 10)
// ===========================================================================
describe('Matrix row: Work-scoped chat retrieval never surfaces Personal/unscoped candidates', () => {
  it('getSmartChatContext (scopeFilter applied first) never returns a Personal-space or unscoped id, even when it is the strongest semantic/tag match', async () => {
    const { getSmartChatContext } = await import('../services/analysis/index.js');

    // Identical embedding on every entry -> similarity 1.0 for all three
    // pre-filter, maximizing semantic-match leakage risk if the filter were
    // applied after candidate selection instead of before it.
    const SHARED_EMBEDDING = [1, 0, 0];
    const entries = [
      { id: 'work-1', spaceId: 'work', text: 'Roadmap sync with Sarah', tags: ['@person:sarah'], embedding: SHARED_EMBEDDING },
      { id: 'personal-1', spaceId: 'personal', text: 'Dinner with Sarah about the wedding', tags: ['@person:sarah'], embedding: SHARED_EMBEDDING },
      { id: 'unscoped-1', text: 'Legacy entry mentioning Sarah', tags: ['@person:sarah'], embedding: SHARED_EMBEDDING },
    ];

    const result = await getSmartChatContext(entries, 'What did Sarah say?', SHARED_EMBEDDING, { spaceId: 'work' });
    const ids = result.map((e) => e.id);

    expect(ids).toEqual(['work-1']);
    expect(ids).not.toContain('personal-1');
    expect(ids).not.toContain('unscoped-1');
  });
});

// ===========================================================================
// Row 9: Space change alters only spaceId (R1 Task 8)
// ===========================================================================
describe('Matrix row: Reassigning a space only ever touches spaceId + updatedAt', () => {
  it('reassignEntriesSpace writes ONLY {spaceId, updatedAt} onto each moved entry — every other field untouched', async () => {
    const { reassignEntriesSpace } = await import('../services/spaces/spacesService.js');

    const entryDoc = {
      id: 'entry-1',
      data: () => ({
        spaceId: 'work',
        text: 'Original entry text',
        createdAt: '2026-01-01T00:00:00.000Z',
        effectiveDate: '2026-01-01T00:00:00.000Z',
        transcription: { rawTranscript: 'raw audio text' },
      }),
    };
    firestoreMocks.getDocs.mockResolvedValueOnce({ docs: [entryDoc] });
    const batch = { update: vi.fn(), set: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => {}) };
    firestoreMocks.writeBatch.mockReturnValueOnce(batch);

    const total = await reassignEntriesSpace({}, 'user-1', 'work', 'personal');

    expect(total).toBe(1);
    expect(batch.update).toHaveBeenCalledTimes(1);
    const [, payload] = batch.update.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['spaceId', 'updatedAt']);
    expect(payload.spaceId).toBe('personal');
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Row 10: Closing an open loop leaves the source entry untouched (R1 Task 4)
// ===========================================================================
describe('Matrix row: Closing/answering an open loop never touches the source entry', () => {
  it('answerLoop only updates the intent doc + appends a user_decisions record — no /entries/ write of any kind', async () => {
    const { answerLoop } = await import('../services/intents/intentClient.js');

    await answerLoop({}, 'user-1', 'intent-1', 'entry-42');

    expect(firestoreMocks.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = firestoreMocks.updateDoc.mock.calls[0];
    expect(ref.__doc).toBe('artifacts/echo-vault-v5-fresh/users/user-1/intents/intent-1');
    expect(ref.__doc).not.toContain('/entries/');
    expect(payload.state).toBe('completed_state');
    expect(payload.outcome).toEqual(expect.objectContaining({ kind: 'answered', answerEntryId: 'entry-42' }));

    // The decision append targets user_decisions — again never /entries/.
    expect(firestoreMocks.addDoc).toHaveBeenCalledTimes(1);
    const [colRef, decision] = firestoreMocks.addDoc.mock.calls[0];
    expect(colRef.__col).toBe('artifacts/echo-vault-v5-fresh/users/user-1/user_decisions');
    expect(decision.action).toBe('answered');
    expect(decision.targetId).toBe('intent-1');
  });
});

// ===========================================================================
// Row 11: Insight budget cap never exceeded across a simulated day (R1 Task 12)
// ===========================================================================
describe('Matrix row: Insight budget cap holds across a simulated day of repeated calls', () => {
  it('quiet mode (max 1/day) never lets more than 1 insight through across 5 same-day surface refreshes', async () => {
    const { applyInsightBudget } = await import('../services/insights/insightBudget.js');

    const dayStart = new Date(2026, 6, 20, 9, 0, 0).getTime();
    let shownLog = [];
    let totalShownToday = 0;

    for (let i = 0; i < 5; i += 1) {
      const callNow = dayStart + i * 60 * 60 * 1000; // an hour apart, same calendar day
      const candidates = [0, 1, 2].map((n) => ({
        id: `insight-${i}-${n}`,
        title: `Insight ${i}-${n}`,
        confidence: 0.9,
        generatedAt: new Date(callNow).toISOString(),
      }));
      const shown = applyInsightBudget(candidates, { mode: 'quiet', shownLog, now: callNow });
      totalShownToday += shown.length;
      // Simulate recordShownInsights: append what was actually displayed.
      shownLog = [...shownLog, ...shown.map((s) => ({ id: s.id, title: s.title, shownAt: new Date(callNow).toISOString() }))];
    }

    // quiet = {maxHomePerDay:1}. Never exceeded no matter how many times the
    // gate is called, or how many fresh candidates are offered each time.
    expect(totalShownToday).toBeLessThanOrEqual(1);
  });

  it('the gate never widens to "fill the quota" with a near-duplicate — zero survivors stays zero, even with allowance left', async () => {
    const { isDuplicateInsight } = await import('../services/nexus/orchestrator');
    isDuplicateInsight.mockReturnValueOnce(true); // this one candidate is judged a dupe (single call, self-restoring)

    const { applyInsightBudget } = await import('../services/insights/insightBudget.js');
    const now = Date.now();
    const shown = applyInsightBudget(
      [{ id: 'dup-1', title: 'Same thing again', confidence: 0.95, generatedAt: new Date(now).toISOString() }],
      { mode: 'exploratory', shownLog: [], now },
    );

    expect(shown).toEqual([]); // full daily allowance (4) was available; still zero
  });
});

// ===========================================================================
// R2 Row (a): every generated Nexus insight carries a receipt
// ===========================================================================
describe('R2 Matrix row (a): every generated Nexus insight carries a receipt', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Condensed version of orchestrator.receipts.test.js's own fixture: enough
  // to exercise TWO distinct real generator families in one pass (Layer 1
  // pattern_correlation via real detectPatternsInPeriod, entity_correlation
  // via the orchestrator's own real computeEntityMoodCorrelations) so the
  // invariant below can't pass vacuously off a single insight.
  // Mood01 (R4 T3): literals are the real 0-1 scale, matching this file's
  // own convention elsewhere (see e.g. line ~1320's `mood_score: 0.7`).
  function buildFixtureEntries() {
    const now = Date.parse('2026-07-21T12:00:00.000Z');
    const entries = [];
    for (let i = 0; i < 4; i++) {
      entries.push({
        id: `interview-${i}`,
        createdAt: new Date(now - i * DAY_MS).toISOString(),
        text: `Had another interview today, feeling good about it. Entry number ${i}.`,
        analysis: { mood_score: 0.80 },
      });
    }
    for (let i = 0; i < 4; i++) {
      entries.push({
        id: `yoga-${i}`,
        createdAt: new Date(now - (i + 4) * DAY_MS).toISOString(),
        text: `Did yoga this morning, feeling solid. Entry number ${i}.`,
        analysis: { mood_score: 0.85 },
      });
    }
    for (let i = 0; i < 4; i++) {
      entries.push({
        id: `neutral-${i}`,
        createdAt: new Date(now - (i + 8) * DAY_MS).toISOString(),
        text: `A regular day. Nothing special. Entry number ${i}.`,
        analysis: { mood_score: 0.50 },
      });
    }
    return entries;
  }

  function mockEntriesSnapshot(entries) {
    return { docs: entries.map((e) => ({ id: e.id, data: () => ({ ...e }) })) };
  }

  beforeEach(async () => {
    const { getDocs, getDoc, setDoc } = await import('firebase/firestore');
    getDocs.mockReset();
    getDoc.mockReset();
    setDoc.mockClear();
    getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    getExcludedEntryIdsMock.mockReset();
    getExcludedEntryIdsMock.mockResolvedValue(new Set());
  });

  it('mirrors Task 8\'s invariant: the persisted `active` array (the real setDoc payload) has a truthy .receipt on every insight — real generateInsights + real detectPatternsInPeriod', async () => {
    const { getDocs, setDoc } = await import('firebase/firestore');
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildFixtureEntries()));

    const { generateInsights } = await import('../services/nexus/orchestrator');
    const result = await generateInsights('user-matrix-a');

    expect(result.success).toBe(true);
    // Guard against a vacuous pass: the fixture must actually produce
    // insights from more than one generator family.
    const types = new Set(result.insights.map((i) => i.type));
    expect(types.size).toBeGreaterThanOrEqual(2);

    const persistCall = setDoc.mock.calls.find((call) => call[1] && Array.isArray(call[1].active));
    expect(persistCall).toBeTruthy();
    expect(persistCall[1].active.length).toBeGreaterThan(0);
    for (const insight of persistCall[1].active) {
      expect(insight.receipt).toBeTruthy();
      expect(Array.isArray(insight.receipt.sources)).toBe(true);
      expect(typeof insight.receipt.sampleSize).toBe('number');
      expect(insight.receipt.versions.generator).toEqual(expect.any(String));
    }
  });
});

// ===========================================================================
// R2 Row (b): excluded source never appears in regenerated insight
// sources/stats, nor report readEntries (R2 Task 10 client + Task 9 server)
// ===========================================================================
describe('R2 Matrix row (b): excluded source never appears in regenerated insight sources/stats, nor report readEntries', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Condensed version of orchestrator.exclusions.test.js's adversarial
  // fixture: a mis-tagged "yoga" entry that, once excluded, both disappears
  // from receipts AND flips the entity correlation's stats to reflect its
  // absence — proving exclusion isn't merely cosmetic.
  // Mood01 (R4 T3): literals are the real 0-1 scale.
  function buildAdversarialEntries() {
    const now = Date.parse('2026-07-21T12:00:00.000Z');
    const entries = [
      {
        id: 'yoga-excluded',
        createdAt: new Date(now).toISOString(),
        text: 'Mentioned yoga in passing, a totally average day otherwise.',
        analysis: { mood_score: 0.50 },
      },
    ];
    for (let i = 0; i < 3; i++) {
      entries.push({
        id: `yoga-${i}`,
        createdAt: new Date(now - (i + 1) * DAY_MS).toISOString(),
        text: `Did yoga this morning, feeling solid and strong. Entry number ${i}.`,
        analysis: { mood_score: 0.65 },
      });
    }
    for (let i = 0; i < 8; i++) {
      entries.push({
        id: `neutral-${i}`,
        createdAt: new Date(now - (i + 4) * DAY_MS).toISOString(),
        text: `A regular day. Nothing special. Entry number ${i}.`,
        analysis: { mood_score: 0.50 },
      });
    }
    return entries;
  }

  beforeEach(async () => {
    const { getDocs, getDoc, setDoc } = await import('firebase/firestore');
    getDocs.mockReset();
    getDoc.mockReset();
    setDoc.mockClear();
    getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    getExcludedEntryIdsMock.mockReset();
  });

  it('orchestrator: once excluded, the mis-tagged entry never appears in any persisted receipt.sources and the real entity-correlation stats reflect its absence', async () => {
    const { getDocs, setDoc } = await import('firebase/firestore');
    getExcludedEntryIdsMock.mockResolvedValueOnce(new Set(['yoga-excluded']));
    getDocs.mockResolvedValueOnce({
      docs: buildAdversarialEntries().map((e) => ({ id: e.id, data: () => ({ ...e }) })),
    });

    const { generateInsights } = await import('../services/nexus/orchestrator');
    const result = await generateInsights('user-matrix-b');

    const entityInsight = result.insights.find((i) => i.type === 'entity_correlation');
    expect(entityInsight).toBeTruthy(); // sanity: excluding it reveals the correlation
    expect(entityInsight.evidence.statistical.sampleSize).toBe(3); // not 4 — its absence is real

    const persistCall = setDoc.mock.calls.find((call) => call[1] && Array.isArray(call[1].active));
    expect(persistCall).toBeTruthy();
    for (const insight of persistCall[1].active) {
      const ids = (insight.receipt?.sources || []).map((s) => s.entryId);
      expect(ids).not.toContain('yoga-excluded');
    }
  });

  it('report generator: the same excluded entry id is absent from readEntries — real functions/src readEntries, appliesTo:"all"', async () => {
    const { readEntries } = await import('../../functions/src/reports/generator.js');

    function fakeSnap(docs) {
      return { forEach: (fn) => docs.forEach((d) => fn({ id: d.id, data: () => d.data })) };
    }
    function makeQuery(snapshot) {
      const q = { where: () => q, orderBy: () => q, limit: () => q, select: () => q, get: async () => snapshot };
      return q;
    }
    const entryDocs = [
      { id: 'yoga-excluded', data: { createdAt: { toDate: () => new Date('2026-07-10') }, text: 'excluded text', analysis: {} } },
      { id: 'yoga-0', data: { createdAt: { toDate: () => new Date('2026-07-11') }, text: 'kept text', analysis: {} } },
    ];
    const exclusionDocs = [
      { id: 'x1', data: { entryId: 'yoga-excluded', appliesTo: 'all', reason: 'excluded_by_user', permanent: true } },
    ];
    const db = {
      collection: (path) => {
        if (path.endsWith('/entries')) return makeQuery(fakeSnap(entryDocs));
        if (path.endsWith('/source_exclusions')) return makeQuery(fakeSnap(exclusionDocs));
        return makeQuery(fakeSnap([]));
      },
    };

    const result = await readEntries(db, 'artifacts/echo-vault-v5-fresh/users/user-matrix-b', new Date('2026-07-01'), new Date('2026-07-20'), 'weekly');

    expect(result.map((e) => e.id)).toEqual(['yoga-0']);
    expect(result.map((e) => e.id)).not.toContain('yoga-excluded');
  });
});

// ===========================================================================
// R2 Row (c): Work-scoped companion context contains no Personal/unscoped
// Tier-2 entry and omits Tier-1 (R2 Task 5)
// ===========================================================================
describe('R2 Matrix row (c): Work-scoped companion context omits Tier 1 and excludes any non-Work Tier 2 entry', () => {
  it('adversarial: a Personal-space AND an unscoped recentEntry never reach a Work-scoped context, and Tier 1 memory is omitted entirely (real getCompanionContext)', async () => {
    const { getCompanionContext } = await import('../services/rag/companionContext');
    const { getMemoryGraph } = await import('../services/memory');
    const { formatBufferForContext, isExpired } = await import('../services/memory/sessionBuffer');
    isExpired.mockReturnValue(false);

    formatBufferForContext.mockReturnValue('[JUST JOURNALED] personal note');
    const personalResult = await getCompanionContext({
      userId: 'u1', query: 'anything', queryEmbedding: null, entries: [],
      scope: { spaceId: 'work' },
      sessionBuffer: {
        recentEntry: { id: 'buf-personal-1', spaceId: 'personal', text: 'personal note' },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(personalResult.context.sessionBuffer).toBeNull();
    expect(getMemoryGraph).not.toHaveBeenCalled();
    expect(personalResult.context.memory).toBe('(Long-term memory omitted: scoped conversation)');
    expect(personalResult.stats.hasMemory).toBe(false);

    formatBufferForContext.mockReturnValue('[JUST JOURNALED] unscoped note');
    const unscopedResult = await getCompanionContext({
      userId: 'u1', query: 'anything', queryEmbedding: null, entries: [],
      scope: { spaceId: 'work' },
      sessionBuffer: {
        recentEntry: { id: 'buf-unscoped-1', text: 'unscoped note' }, // no spaceId
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(unscopedResult.context.sessionBuffer).toBeNull();

    // Control: the SAME-space recentEntry is included — proves the above two
    // were structurally filtered, not accidentally dropped by the buffer path.
    formatBufferForContext.mockReturnValue('[JUST JOURNALED] work note');
    const workResult = await getCompanionContext({
      userId: 'u1', query: 'anything', queryEmbedding: null, entries: [],
      scope: { spaceId: 'work' },
      sessionBuffer: {
        recentEntry: { id: 'buf-work-1', spaceId: 'work', text: 'work note' },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(workResult.context.sessionBuffer).toBe('[JUST JOURNALED] work note');
  });
});

// ===========================================================================
// R2 Row (d): offline-queued entry preserves spaceId through sync re-save
// (R2 Task 1)
// ===========================================================================
describe('R2 Matrix row (d): offline-queued entry preserves spaceId through sync re-save', () => {
  it('queueEntry -> buildOfflineSyncPayload (the real drain-path builder App.jsx calls before setDoc) carries spaceId through; absent when none was selected', async () => {
    const { queueEntry } = await import('../services/offline/offlineManager.js');
    const { buildOfflineSyncPayload } = await import('../services/offline/offlineSyncPayload.js');

    const queuedWithSpace = await queueEntry('user-matrix-offline', { text: 'queued thought', spaceId: 'space-9' });
    const syncedWithSpace = buildOfflineSyncPayload(queuedWithSpace);
    expect(syncedWithSpace.spaceId).toBe('space-9');

    const queuedWithoutSpace = await queueEntry('user-matrix-offline', { text: 'queued thought 2' });
    const syncedWithoutSpace = buildOfflineSyncPayload(queuedWithoutSpace);
    expect(syncedWithoutSpace).not.toHaveProperty('spaceId');
  });
});

// ===========================================================================
// R2 Row (e): revisit safety fixtures (incl. adjacency + low-mood + bait
// attributes) excluded 100% (R2 Task 19)
// ===========================================================================
describe('R2 Matrix row (e): revisit safety fixtures excluded 100%, including adjacency + low-mood + "bait" scoring attributes', () => {
  it('never selects ANY entry from an adversarial fixture covering every exclusion rule — using the REAL selectRevisitCandidate', async () => {
    const { selectRevisitCandidate } = await import('../../functions/src/revisit/selectRevisits.js');

    const DAY_MS = 24 * 60 * 60 * 1000;
    const ADJACENCY_DAYS = 3;
    const NOW = Date.parse('2026-07-21T16:00:00.000Z');
    const daysAgo = (d) => NOW - d * DAY_MS;

    function baseEntry(overrides = {}) {
      return {
        id: `entry-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: daysAgo(100),
        spaceId: null,
        safety_flagged: false,
        has_warning_indicators: false,
        // GR1 (Michael's direct safety review): MOOD_FLOOR retuned 0.4 -> 0.6
        // (`functions/src/revisit/selectRevisits.js`) — default bumped to
        // stay above the new floor so this fixture's baseline entry is still
        // eligible by default.
        analysis: { mood_score: 0.7 },
        tags: [],
        entities: [],
        ...overrides,
      };
    }

    // Every "unsafe" entry below is deliberately given rich entities/tags
    // AND a near-maximal mood — the exact attributes the preference-scoring
    // step favors most — to prove exclusion is a hard gate that runs BEFORE
    // scoring ever sees these entries, not a soft penalty scoring could
    // outweigh.
    const bait = { tags: ['reunion', 'good-news'], entities: [{ id: 'p1', name: 'Sam', category: 'person' }], analysis: { mood_score: 0.95 } };
    const flaggedAnchor = baseEntry({ id: 'anchor-flagged', createdAt: daysAgo(200), safety_flagged: true, ...bait });
    const adversarial = [
      flaggedAnchor,
      baseEntry({ id: 'unsafe-flagged', safety_flagged: true, createdAt: daysAgo(150), ...bait }),
      baseEntry({ id: 'unsafe-warned', has_warning_indicators: true, createdAt: daysAgo(120), ...bait }),
      baseEntry({ id: 'unsafe-adjacent-plus', createdAt: daysAgo(200) - ADJACENCY_DAYS * DAY_MS, ...bait }),
      baseEntry({ id: 'unsafe-adjacent-minus', createdAt: daysAgo(200) + ADJACENCY_DAYS * DAY_MS, ...bait }),
      baseEntry({ id: 'unsafe-low-mood', analysis: { mood_score: 0.1 }, createdAt: daysAgo(110), tags: bait.tags, entities: bait.entities }),
      baseEntry({ id: 'unsafe-missing-mood', analysis: {}, createdAt: daysAgo(115), tags: bait.tags, entities: bait.entities }),
      baseEntry({ id: 'unsafe-excluded-entry', createdAt: daysAgo(130), ...bait }),
    ];
    const exclusions = [{ dimension: 'entry', value: 'unsafe-excluded-entry' }];

    const noneSafe = selectRevisitCandidate({ entries: adversarial, exclusions, now: NOW });
    expect(noneSafe).toBeNull();

    // Mutation-check control: a genuinely safe entry, deliberately LESS
    // "attractive" than the bait (no tags/entities, mood right at the
    // eligible-but-not-preferred MOOD_FLOOR, not PREFERRED_MOOD — GR1
    // retuned the floor to 0.6), proves the adversarial entries were
    // structurally filtered — not merely outscored.
    const safeControl = baseEntry({ id: 'the-only-safe-one', createdAt: daysAgo(180), analysis: { mood_score: 0.6 } });
    const withControl = selectRevisitCandidate({ entries: [...adversarial, safeControl], exclusions, now: NOW });
    expect(withControl?.id).toBe('the-only-safe-one');
  });
});

// ===========================================================================
// R2 Row (f): session-prep export contains no safety labels and drops
// removed-claim citations (R2 Task 18)
// ===========================================================================
describe('R2 Matrix row (f): session-prep export carries no safety labels and drops removed-claim citations', () => {
  // Same FakeJsPDF textCalls approach as sessionPrep.test.js (Task 18).
  class FakeJsPDF {
    constructor() {
      this.textCalls = [];
      this.pages = 1;
    }
    setFontSize() {}
    setFont() {}
    splitTextToSize(text) { return [text]; }
    text(str) { this.textCalls.push(String(str)); }
    addPage() { this.pages += 1; }
    save() {}
  }

  it('never leaks safety_flagged/has_warning_indicators labels or the flagged entry\'s own text, and removing a block removes its citation — real composeSessionPrepPdf', async () => {
    const { loadJsPDF } = await import('../utils/pdf');
    loadJsPDF.mockResolvedValue(FakeJsPDF);
    const { composeSessionPrepPdf } = await import('../services/reflections/sessionPrep.js');

    const FLAGGED_ENTRY = { id: 'flagged-1', createdAt: '2026-07-10T00:00:00.000Z', text: 'crisis content should never appear', safety_flagged: true };
    const SAFE_ENTRY = { id: 'safe-1', createdAt: '2026-07-09T00:00:00.000Z', text: 'irrelevant' };
    const fullBrief = {
      title: 'Session prep — July 2026',
      period: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
      blocks: [
        { id: 'b1', type: 'ai', section: 'Changes since', text: 'Kept claim.', sources: ['flagged-1'], editedByUser: false },
        { id: 'b2', type: 'ai', section: 'Moments to bring up', text: 'Removed claim body.', sources: ['safe-1'], editedByUser: false },
      ],
    };

    const doc = await composeSessionPrepPdf(fullBrief, { 'flagged-1': FLAGGED_ENTRY, 'safe-1': SAFE_ENTRY });
    const all = doc.textCalls.join('\n');
    expect(all).not.toMatch(/safety_flagged/i);
    expect(all).not.toMatch(/has_warning_indicators/i);
    expect(all).not.toContain('crisis content should never appear');
    expect(all).toContain('Removed claim body.'); // sanity: present before removal
    // b1's ONLY source is the flagged entry — its citation date must be
    // dropped entirely (no bare "Sources:" line for it), not merely its
    // text/field-name. This is the concrete "no safety labels" invariant,
    // distinct from the block-removal citation check below.
    const b1Text = all.slice(0, all.indexOf('Moments to bring up'));
    expect(b1Text).not.toContain('Sources:');

    const afterRemovalBrief = { ...fullBrief, blocks: fullBrief.blocks.filter((b) => b.id !== 'b2') };
    const afterDoc = await composeSessionPrepPdf(afterRemovalBrief, { 'flagged-1': FLAGGED_ENTRY, 'safe-1': SAFE_ENTRY });
    const afterAll = afterDoc.textCalls.join('\n');
    expect(afterAll).not.toContain('Removed claim body.');
  });
});

// ===========================================================================
// R2 Row (g): chapter metadata edits leave text/rawTranscript/createdAt
// byte-identical (R2 Task 14/15)
// ===========================================================================
describe('R2 Matrix row (g): chapter metadata edits leave text/rawTranscript/createdAt byte-identical', () => {
  it('Rename writes ONLY {"transcription.chapters": next} — text/rawTranscript/createdAt/transcription (as a whole) never touched — real EntryCard render', async () => {
    const { getFlag } = await import('../config/flags');
    getFlag.mockImplementation((flag) => flag === 'voiceChapters');
    const { default: EntryCard } = await import('../components/entries/EntryCard');

    // Chapter offsets built with indexOf against the actual fixture text
    // (same technique EntryCard.test.jsx uses), so charStart/charEnd are
    // always correct rather than hand-counted.
    const text = 'Morning notes here.\n\nAfternoon notes here.\n\nEvening notes here.';
    const c0 = 'Morning notes here.';
    const c1 = 'Afternoon notes here.';
    const s0 = text.indexOf(c0);
    const e0 = s0 + c0.length;
    const s1 = text.indexOf(c1, e0);
    const e1 = s1 + c1.length;
    const chapters = [
      { id: 'ch_0', index: 0, startMs: 0, title: 'Morning', charStart: s0, charEnd: e0 },
      { id: 'ch_1', index: 1, startMs: 65000, title: 'Afternoon', charStart: s1, charEnd: e1 },
    ];
    const entry = {
      id: 'entry-matrix-chapters',
      text,
      title: 'Voice entry',
      category: 'personal',
      createdAt: new Date('2026-07-20T10:00:00Z'),
      effectiveDate: new Date('2026-07-20T10:00:00Z'),
      tags: [],
      transcription: { chapters, rawTranscript: 'the original raw transcript, must survive untouched' },
    };
    const onUpdate = vi.fn();

    render(React.createElement(EntryCard, { entry, onDelete: vi.fn(), onUpdate }));

    fireEvent.click(screen.getAllByLabelText('Chapter actions')[1]);
    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByLabelText('Chapter title');
    fireEvent.change(input, { target: { value: 'Lunch break' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [entryId, payload] = onUpdate.mock.calls[0];
    expect(entryId).toBe('entry-matrix-chapters');

    // The invariant: ONLY transcription.chapters changes. text/rawTranscript
    // (top-level and nested)/createdAt are never among the updated keys.
    expect(Object.keys(payload)).toEqual(['transcription.chapters']);
    expect(payload).not.toHaveProperty('text');
    expect(payload).not.toHaveProperty('rawTranscript');
    expect(payload).not.toHaveProperty('createdAt');
    expect(payload).not.toHaveProperty('transcription');

    const next = payload['transcription.chapters'];
    expect(next[1].title).toBe('Lunch break');
    expect(next[0]).toEqual(chapters[0]); // untouched chapter is byte-identical
    expect(next[1]).toEqual({ ...chapters[1], title: 'Lunch break' }); // only title changed
  });
});

// ===========================================================================
// R2 Row (h): budget day-cap honored across a simulated midnight with a live
// tick (R2 self-review + R1 Task 2's useFreshnessTick/insightBudget)
// ===========================================================================
describe('R2 Matrix row (h): budget day-cap honored across a simulated midnight with a live freshness tick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('quiet mode\'s 1/day cap blocks a same-day repeat; the REAL useFreshnessTick crossing midnight then lets the REAL applyInsightBudget allow the same candidate again', async () => {
    const { applyInsightBudget } = await import('../services/insights/insightBudget.js');
    const { useFreshnessTick } = await import('../hooks/useFreshnessTick.js');

    vi.useFakeTimers();
    // Computed via LOCAL Date methods (not a hardcoded UTC literal) so this
    // genuinely straddles local midnight regardless of the runtime's
    // timezone (this sandbox runs America/Los_Angeles; CI may run UTC —
    // a fixed UTC boundary would cross midnight in one and not the other).
    const beforeMidnightDate = new Date();
    beforeMidnightDate.setHours(23, 59, 0, 0);
    const beforeMidnight = beforeMidnightDate.getTime();
    const afterMidnight = beforeMidnight + 5 * 60 * 1000; // local next-day 00:04
    vi.setSystemTime(beforeMidnight);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    const shownLog = [{ id: 'already-shown', title: 'Already shown', shownAt: new Date(beforeMidnight - 5 * 60 * 1000).toISOString() }];
    const candidate = () => [{ id: 'candidate', title: 'Candidate insight', confidence: 0.9, generatedAt: new Date(Date.now()).toISOString() }];

    // Before midnight: quiet mode's 1/day cap was already spent today -> 0 allowed.
    expect(applyInsightBudget(candidate(), { mode: 'quiet', shownLog, now: Date.now() })).toEqual([]);

    const { result } = renderHook(() => useFreshnessTick(5 * 60 * 1000));
    const tickBefore = result.current;

    // Advance the clock across midnight, then let the real 5-minute interval fire.
    vi.setSystemTime(afterMidnight);
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });

    expect(result.current).toBeGreaterThan(tickBefore); // the live tick actually fired

    // After the tick, a fresh Date.now() read lands on a new calendar day —
    // the day-count (derived from shownLog vs `now`) resets, so the same
    // candidate is allowed again. shownLog itself is untouched (nothing new
    // was recorded) — this isolates the gate re-evaluating against a fresh
    // `now`, which is exactly what the live tick exists to trigger.
    expect(applyInsightBudget(candidate(), { mode: 'quiet', shownLog, now: Date.now() }).map((i) => i.id)).toEqual(['candidate']);
  });
});

// ===========================================================================
// R3 shared fixture helpers (Personal Experiments, plan Task 7)
// ===========================================================================

const R3_DAY_MS = 24 * 60 * 60 * 1000;

function r3IsoDay(y, m, d, hour = 12) {
  return new Date(Date.UTC(y, m - 1, d, hour)).toISOString();
}

function r3DateKeyFor(y, m, d) {
  return r3IsoDay(y, m, d, 0).slice(0, 10);
}

/**
 * Local stand-in for `experimentsService.buildAnalysisPlan` (identical
 * output shape) — deliberately not imported from that module for rows (c),
 * (d), (f), (g): those rows exercise the Firebase-free estimator/computeResult
 * pipeline directly (like `computeResult.test.js` itself), so they stay
 * decoupled from experimentsService's Firestore import graph. Rows (b)/(e)
 * DO import the real `experimentsService.js` (see the file-level R3 comment
 * above for why that's safe against this file's shared `config/firebase`
 * mock).
 */
function r3AnalysisPlan(template, params = {}) {
  const exposure = { ...template.exposure };
  if (template.exposure.source === 'tags') exposure.tag = params.tag;
  return {
    templateId: template.id,
    lag: template.lag,
    exposure,
    outcome: { ...template.outcome },
    confounders: [...(template.confounders || [])],
    whatThisDoesNotProve: [...(template.whatThisDoesNotProve || [])],
  };
}

/**
 * PARTIAL START DAY RULE (Michael review hardening, EX2 item 2, plan-pinned):
 * the experiment window is whole local calendar days starting the day AFTER
 * `experiment.startAt` — every fixture below is written with `startAt`
 * meaning "the first full data day" (matching `computeResult.test.js`'s own
 * convention), so the REAL stored `startAt` field is shifted back one day
 * here, transparently, keeping every hand-computed expectation below
 * unchanged. Mirrors `computeResult.test.js`'s `baseExperiment`/`dayBefore`.
 */
function r3DayBefore(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms - R3_DAY_MS).toISOString();
}

function r3BaseExperiment({ template, params = {}, startAt, endAt, durationDays, excludedObservations = [], scope = null }) {
  const shiftedStartAt = r3DayBefore(startAt);
  return {
    id: 'r3-exp-test',
    question: 'test question',
    template: template.id,
    analysisPlan: r3AnalysisPlan(template, params),
    scope,
    status: 'running',
    startAt: shiftedStartAt,
    endAt,
    durationDays,
    excludedObservations,
    createdAt: shiftedStartAt,
    updatedAt: shiftedStartAt,
  };
}

// ===========================================================================
// R3 Row (a): unsafe-question fixture set declined 100% (real questionGate)
// ===========================================================================
describe('R3 Matrix row (a): unsafe-question fixture set declined 100% — real questionGate', () => {
  // Representative subset of questionGate.test.js's own adversarial fixture
  // groups (not re-exported from that test file, so reproduced here rather
  // than imported — see that file for the full ~40-fixture set and its
  // per-pattern rationale comments). DOSE_CHANGE below is the exact family
  // added by the Task 4 CRITICAL review-round-2 fix (dose-change verb +
  // dose-noun co-occurrence, in either word order, without naming a specific
  // drug) — included in full, not just a sample, per this row's brief.
  const OBVIOUS_MEDICAL = [
    "What's the right dosage of Zoloft for me?",
    'Do I have bipolar disorder?',
    'Should I stop taking my antidepressants?',
    'Is it safe to taper off Xanax on my own?',
    'Can you diagnose me with ADHD based on my entries?',
  ];
  const OBLIQUE_MEDICAL = [
    'Would journaling more mean I need less of my prescription?',
    'Does my mood improve on days I skip my morning meds?',
    'Could stopping my SSRI be affecting my sleep?',
    'Am I manic or just having a good week?',
  ];
  const DOSE_CHANGE_MEDICAL = [
    'does cutting my dose improve my mood?',
    'since halving the white pills',
    'halved my pills this week, mood better?',
    'should I lower my dose?',
    'increasing my dose lately, does that track with mood?',
    'reducing how much medicine I take, mood impact?',
  ];
  const CRISIS = [
    'Does exercise change how often I think about suicide?',
    "Do I feel more hopeless on days I don't get sunshine?",
    'Is there a pattern between poor sleep and wanting to hurt myself?',
    'Do my steps go down on the days I want to give up?',
  ];
  const CRISIS_AND_MEDICAL = ['Should I stop taking my antidepressants because I want to die?'];
  const BENIGN = [
    "I'm sick of meetings -- does that affect my mood?",
    'My job is killing my vibe lately.',
    'Does more sleep improve my mood?',
    "I'm increasing my exercise minutes this week -- does that affect my mood?",
    'I did medicine-ball workouts today -- does that affect my mood?',
  ];

  it('every unsafe fixture (obvious/oblique/dose-change/crisis) declines with a non-ok verdict — 100%, zero misses', async () => {
    const { screenQuestion } = await import('../services/experiments/questionGate.js');
    const unsafe = [...OBVIOUS_MEDICAL, ...OBLIQUE_MEDICAL, ...DOSE_CHANGE_MEDICAL, ...CRISIS, ...CRISIS_AND_MEDICAL];
    for (const text of unsafe) {
      const { verdict } = screenQuestion(text);
      expect(verdict, `expected "${text}" to be declined, got verdict "${verdict}"`).not.toBe('ok');
    }
  });

  it('crisis wins priority over medical on text that trips both patterns', async () => {
    const { screenQuestion } = await import('../services/experiments/questionGate.js');
    for (const text of CRISIS_AND_MEDICAL) {
      expect(screenQuestion(text).verdict).toBe('crisis');
    }
  });

  it('mutation guard: the benign control set still passes ok — proves the 100% above is a real filter, not a "decline everything" stub', async () => {
    const { screenQuestion } = await import('../services/experiments/questionGate.js');
    for (const text of BENIGN) {
      expect(screenQuestion(text).verdict, `expected "${text}" to pass ok`).toBe('ok');
    }
  });
});

// ===========================================================================
// R3 Row (b): plan fields immutable service-side after start (real
// experimentsService against mocked-firebase write capture)
// ===========================================================================
describe('R3 Matrix row (b): plan fields immutable service-side after start — real experimentsService', () => {
  // NOTE on scope: firestore.rules' experimentUpdateAllowed (question/
  // template/analysisPlan/scope/createdAt are simply absent from its
  // affectedKeys allow-list) is the actual server-authoritative enforcement
  // of plan-freeze, and is exercised by
  // functions/src/__tests__/firestoreRules.test.js — a CI-only executor per
  // the plan's Global Constraints, not runnable from this Vitest suite. What
  // THIS row pins is the client contract: experimentsService.js has no code
  // path, anywhere past `createExperiment`, that ever includes
  // question/template/analysisPlan/scope/createdAt in an update payload —
  // so even a compromised/buggy caller of this service cannot construct a
  // write that would need the rules layer to reject it for those fields.
  const FROZEN_KEYS = ['question', 'template', 'analysisPlan', 'scope', 'createdAt'];
  const UID = 'user-r3-freeze';

  beforeEach(async () => {
    const { getTemplateById } = await import('../services/experiments/templates.js');
    firestoreMocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        status: 'running',
        excludedObservations: [],
        analysisPlan: r3AnalysisPlan(getTemplateById('sleep-hours-mood-same-day')),
      }),
    });
  });

  it('createExperiment -> startExperiment -> pause/resume/setObservationExcluded/writeResult (a legal running->completed->completed-rerun sequence): no post-create update payload ever includes a frozen key', async () => {
    const {
      createExperiment,
      startExperiment,
      pauseExperiment,
      resumeExperiment,
      setObservationExcluded,
      writeResult,
    } = await import('../services/experiments/experimentsService.js');
    const { getTemplateById } = await import('../services/experiments/templates.js');

    const template = getTemplateById('sleep-hours-mood-same-day');
    const created = await createExperiment({}, UID, {
      question: 'Does sleep affect my mood?',
      template: template.id,
      analysisPlan: r3AnalysisPlan(template),
      durationDays: 14,
    });
    // Sanity: create IS allowed to write the plan fields (draft-time only).
    const createPayload = firestoreMocks.addDoc.mock.calls[0][1];
    expect(createPayload.question).toBeTruthy();
    expect(createPayload.analysisPlan).toBeTruthy();

    firestoreMocks.updateDoc.mockClear();
    // Legal transition chain per firestore.rules' experimentTransitionAllowed
    // (draft->running->paused->running->completed->completed-rerun) — the
    // service itself does not gate transitions (that's the rules layer, see
    // the describe-level comment above), but staying on a legal chain keeps
    // this row representative of a real client sequence rather than an
    // artificial one.
    await startExperiment({}, UID, created.id, 14, new Date('2026-07-22T00:00:00.000Z'));
    await pauseExperiment({}, UID, created.id);
    await resumeExperiment({}, UID, created.id);
    await setObservationExcluded({}, UID, created.id, '2026-07-23', true);
    await writeResult({}, UID, created.id, { status: 'ok' });
    await setObservationExcluded({}, UID, created.id, '2026-07-24', true); // completed-rerun case

    expect(firestoreMocks.updateDoc.mock.calls.length).toBeGreaterThanOrEqual(5);
    for (const [, payload] of firestoreMocks.updateDoc.mock.calls) {
      for (const key of FROZEN_KEYS) {
        expect(payload).not.toHaveProperty(key);
      }
    }
    // startExperiment's own payload is exactly the freeze-moment fields —
    // the ONLY call in this sequence that touches startAt/endAt.
    const startPayload = firestoreMocks.updateDoc.mock.calls[0][1];
    expect(Object.keys(startPayload).sort()).toEqual(['endAt', 'startAt', 'status', 'updatedAt']);
  });
});

// ===========================================================================
// R3 Row (c): insufficiency below spec thresholds yields no estimate (real
// estimator + real computeResult boundary fixtures — 9-pairs AND
// coverage-below-floor)
// ===========================================================================
describe('R3 Matrix row (c): insufficiency below spec thresholds yields no estimate', () => {
  it('estimator boundary: exactly 9 paired days is insufficient (no estimate key); exactly 10 is ok', async () => {
    const { pairObservations, runAnalysisPlan, MIN_PAIRED_OBSERVATIONS } = await import('../services/experiments/estimator.js');
    expect(MIN_PAIRED_OBSERVATIONS).toBe(10);

    const exposureSeries = [];
    const outcomeSeries = [];
    for (let i = 1; i <= 10; i++) {
      const dateKey = r3DateKeyFor(2026, 3, i);
      exposureSeries.push({ dateKey, value: i });
      outcomeSeries.push({ dateKey, value: i * 10 });
    }

    const ninePairs = pairObservations({ exposureSeries: exposureSeries.slice(0, 9), outcomeSeries: outcomeSeries.slice(0, 9), lag: 0 });
    expect(ninePairs).toHaveLength(9);
    const insufficientResult = runAnalysisPlan({ pairs: ninePairs, plan: { lag: 0 }, seed: 1 });
    expect(insufficientResult.status).toBe('insufficient');
    expect(insufficientResult.reasons).toContain('insufficient_paired_observations');
    expect(insufficientResult).not.toHaveProperty('estimate');

    const tenPairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });
    expect(tenPairs).toHaveLength(10);
    const okResult = runAnalysisPlan({ pairs: tenPairs, plan: { lag: 0 }, seed: 1 });
    expect(okResult.status).toBe('ok');
    expect(okResult.estimate.n).toBe(10);
  });

  it('computeResult boundary (Task 5 Critical fix): 12 of 60 exposure days (20%) clears MIN_PAIRED_OBSERVATIONS on raw count but fails the 50% coverage floor -> insufficient, no estimate', async () => {
    const { computeExperimentResult } = await import('../services/experiments/computeResult.js');
    const { getTemplateById } = await import('../services/experiments/templates.js');
    const { COVERAGE_FLOOR } = await import('../services/experiments/estimator.js');
    expect(COVERAGE_FLOOR).toBe(0.5);

    const template = getTemplateById('sleep-hours-mood-same-day');
    const baseMs = Date.UTC(2027, 5, 1);
    const entries = [];
    for (let i = 0; i < 60; i++) {
      entries.push({
        id: `r3-sparse-${i + 1}`,
        createdAt: new Date(baseMs + i * R3_DAY_MS + 12 * 60 * 60 * 1000).toISOString(),
        healthContext: i < 12 ? { sleep: { totalHours: 6 + (i % 3) } } : undefined,
        analysis: { mood_score: (50 + (i % 10)) / 100 },
      });
    }
    const experiment = r3BaseExperiment({
      template,
      startAt: new Date(baseMs).toISOString(),
      endAt: new Date(baseMs + 60 * R3_DAY_MS).toISOString(),
      durationDays: 60,
    });
    const now = new Date(baseMs + 90 * R3_DAY_MS);

    const result = computeExperimentResult({ experiment, entries, now });

    expect(result.status).toBe('insufficient');
    expect(result.coverage.exposure).toEqual({ covered: 12, total: 60, label: '12 of 60 days' });
    expect(result.reasons).toEqual(['exposure_coverage_below_floor']);
    expect(result).not.toHaveProperty('estimate');
    expect(result.narrative).not.toHaveProperty('summary');
  });
});

// ===========================================================================
// R3 Row (d): every result — ok and insufficient — carries a receipt with
// generator 'experiment_v1'
// ===========================================================================
describe('R3 Matrix row (d): every result carries a receipt with generator experiment_v1, ok and insufficient alike', () => {
  it('an ok result and an insufficient result both carry a truthy receipt stamped generator: experiment_v1', async () => {
    const { computeExperimentResult } = await import('../services/experiments/computeResult.js');
    const { getTemplateById } = await import('../services/experiments/templates.js');
    const template = getTemplateById('sleep-hours-mood-same-day');

    // ok: 14 days, perfect linear sleep -> mood.
    const okEntries = [];
    for (let i = 0; i < 14; i++) {
      okEntries.push({
        id: `r3-ok-${i + 1}`,
        createdAt: r3IsoDay(2026, 4, i + 1),
        healthContext: { sleep: { totalHours: 4 + i } },
        analysis: { mood_score: (50 + i) / 100 },
      });
    }
    const okExperiment = r3BaseExperiment({
      template,
      startAt: r3IsoDay(2026, 4, 1, 0),
      endAt: r3IsoDay(2026, 4, 15, 0),
      durationDays: 14,
    });
    const okResult = computeExperimentResult({ experiment: okExperiment, entries: okEntries, now: new Date(r3IsoDay(2026, 5, 1)) });
    expect(okResult.status).toBe('ok');
    expect(okResult.receipt).toBeTruthy();
    expect(okResult.receipt.versions.generator).toBe('experiment_v1');
    expect(Array.isArray(okResult.receipt.sources)).toBe(true);

    // insufficient: only 5 days, well below MIN_PAIRED_OBSERVATIONS.
    const fewEntries = okEntries.slice(0, 5);
    const fewExperiment = r3BaseExperiment({
      template,
      startAt: r3IsoDay(2026, 4, 1, 0),
      endAt: r3IsoDay(2026, 4, 6, 0),
      durationDays: 14,
    });
    const insufficientResult = computeExperimentResult({ experiment: fewExperiment, entries: fewEntries, now: new Date(r3IsoDay(2026, 5, 1)) });
    expect(insufficientResult.status).toBe('insufficient');
    expect(insufficientResult.receipt).toBeTruthy();
    expect(insufficientResult.receipt.versions.generator).toBe('experiment_v1');
    expect(Array.isArray(insufficientResult.receipt.sources)).toBe(true);
  });
});

// ===========================================================================
// R3 Row (e): stop is immediate and writes nothing to entries (service
// payload capture)
// ===========================================================================
describe('R3 Matrix row (e): stop is immediate and writes nothing to entries', () => {
  it('stopExperiment writes exactly {status:stopped, updatedAt} to the experiments doc, never touches /entries/, never creates anything', async () => {
    const { stopExperiment } = await import('../services/experiments/experimentsService.js');
    firestoreMocks.updateDoc.mockClear();
    firestoreMocks.addDoc.mockClear();
    firestoreMocks.doc.mockClear();
    firestoreMocks.collection.mockClear();

    await stopExperiment({}, 'user-r3-stop', 'exp-to-stop');

    expect(firestoreMocks.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = firestoreMocks.updateDoc.mock.calls[0];
    expect(ref.__doc).toContain('/experiments/exp-to-stop');
    expect(ref.__doc).not.toContain('/entries/');
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt']);
    expect(payload.status).toBe('stopped');

    // Immediate: no entry created, and no call site in this module's
    // execution ever addressed the entries collection.
    expect(firestoreMocks.addDoc).not.toHaveBeenCalled();
    const anyEntriesPath = [
      ...firestoreMocks.doc.mock.calls.flat(),
      ...firestoreMocks.collection.mock.calls.flat(),
    ].some((arg) => typeof arg === 'string' && arg.includes('/entries'));
    expect(anyEntriesPath).toBe(false);
  });
});

// ===========================================================================
// R3 Row (f): excluded observation changes exactly its contribution on
// rerun and un-exclude restores bitwise (real computeResult)
// ===========================================================================
describe('R3 Matrix row (f): excluded observation changes exactly its contribution on rerun; un-exclude restores bitwise', () => {
  /** Deep-clones a result and strips receipt.versions.generatedAt (real-wall-clock metadata, not part of the determinism contract). */
  function stripGeneratedAt(result) {
    const clone = JSON.parse(JSON.stringify(result));
    if (clone?.receipt?.versions) delete clone.receipt.versions.generatedAt;
    return clone;
  }

  it('excluding one paired day drops exactly that day from n/receipt.sources; un-excluding reproduces the original result bitwise', async () => {
    const { computeExperimentResult } = await import('../services/experiments/computeResult.js');
    const { getTemplateById } = await import('../services/experiments/templates.js');
    const template = getTemplateById('sleep-hours-mood-same-day');

    const entries = [];
    for (let i = 0; i < 14; i++) {
      entries.push({
        id: `r3-excl-${i + 1}`,
        createdAt: r3IsoDay(2026, 6, i + 1),
        healthContext: { sleep: { totalHours: 4 + i } }, // distinct values, no ties
        analysis: { mood_score: (50 + i) / 100 },
      });
    }
    const experiment = r3BaseExperiment({
      template,
      startAt: r3IsoDay(2026, 6, 1, 0),
      endAt: r3IsoDay(2026, 6, 15, 0),
      durationDays: 14,
    });
    const now = new Date(r3IsoDay(2026, 7, 1));

    const original = computeExperimentResult({ experiment, entries, now });
    expect(original.status).toBe('ok');
    expect(original.estimate.n).toBe(14);

    const excludedDateKey = r3DateKeyFor(2026, 6, 5); // day 5 of 14
    const excludedEntryId = 'r3-excl-5';
    expect(original.receipt.sources.some((s) => s.entryId === excludedEntryId)).toBe(true);

    const withExclusion = computeExperimentResult({
      experiment: { ...experiment, excludedObservations: [excludedDateKey] },
      entries,
      now,
    });
    expect(withExclusion.status).toBe('ok');
    // Exactly one observation's contribution is gone: n drops by exactly 1.
    expect(withExclusion.estimate.n).toBe(13);
    expect(withExclusion.receipt.sampleSize).toBe(13);
    expect(withExclusion.receipt.sources.some((s) => s.entryId === excludedEntryId)).toBe(false);
    // Coverage answers "how much data exists" — unaffected by the exclusion toggle.
    expect(withExclusion.coverage).toEqual(original.coverage);

    const restored = computeExperimentResult({
      experiment: { ...experiment, excludedObservations: [] },
      entries,
      now,
    });
    expect(stripGeneratedAt(restored)).toEqual(stripGeneratedAt(original));
  });
});

// ===========================================================================
// R3 Row (g): flagged-entry excerpts never in receipt sources while still
// counted in stats (adversarial fixture)
// ===========================================================================
describe('R3 Matrix row (g): flagged-entry excerpts never appear in receipt sources, while still counted in stats', () => {
  it('a safety_flagged entry contributes to n/receipt.sampleSize but its id and text never appear in receipt.sources or anywhere in the serialized receipt', async () => {
    const { computeExperimentResult } = await import('../services/experiments/computeResult.js');
    const { getTemplateById } = await import('../services/experiments/templates.js');
    const template = getTemplateById('sleep-hours-mood-same-day');

    const FLAGGED_TEXT = 'flagged content that must never be cited in a receipt';
    const entries = [];
    for (let i = 0; i < 14; i++) {
      const flagged = i === 4;
      entries.push({
        id: `r3-flag-${i + 1}`,
        createdAt: r3IsoDay(2026, 8, i + 1),
        healthContext: { sleep: { totalHours: 4 + i } },
        analysis: { mood_score: (50 + i) / 100 },
        ...(flagged ? { text: FLAGGED_TEXT, content: FLAGGED_TEXT, safety_flagged: true } : {}),
      });
    }
    const experiment = r3BaseExperiment({
      template,
      startAt: r3IsoDay(2026, 8, 1, 0),
      endAt: r3IsoDay(2026, 8, 15, 0),
      durationDays: 14,
    });
    const now = new Date(r3IsoDay(2026, 9, 1));

    const result = computeExperimentResult({ experiment, entries, now });

    // Counted in stats: n is 14, not 13 — excluding it would bias the estimate.
    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(14);
    expect(result.receipt.sampleSize).toBe(14);

    // Never in receipt sources — id or text, anywhere in the serialized receipt.
    expect(result.receipt.sources.some((s) => s.entryId === 'r3-flag-5')).toBe(false);
    expect(result.receipt.sources).toHaveLength(13);
    expect(JSON.stringify(result.receipt)).not.toContain(FLAGGED_TEXT);
  });
});

// ===========================================================================
// Hardening Row (h1): current-state gate — a recent flagged/low-mood signal
// pauses server selection AND the widget independently suppresses (Michael
// review hardening, Task GR1, item 1)
// ===========================================================================
describe('Hardening Matrix row (h1): current-state gate pauses selection server-side and the widget suppresses independently', () => {
  const H1_DAY_MS = 24 * 60 * 60 * 1000;
  const H1_NOW = Date.parse('2026-07-21T12:00:00.000Z');

  it('server: currentStateGateTripped (the pause condition runGentleRevisitDaily evaluates against its 14-day recent-window read) trips on a live safety signal; a clean recent entry does not', async () => {
    const { currentStateGateTripped } = await import('../../functions/src/revisit/selectRevisits.js');

    const withFlag = [{ id: 'r1', createdAt: new Date(H1_NOW - 2 * H1_DAY_MS).toISOString(), safety_flagged: true, analysis: { mood_score: 0.9 } }];
    expect(currentStateGateTripped(withFlag)).toBe(true);

    // Mutation-check control: the identical shape with no live signal at all
    // does not trip — proves this isn't a "trip on anything" stub.
    const clean = [{ id: 'r2', createdAt: new Date(H1_NOW - 2 * H1_DAY_MS).toISOString(), safety_flagged: false, has_warning_indicators: false, analysis: { mood_score: 0.9 } }];
    expect(currentStateGateTripped(clean)).toBe(false);
  });

  it('client: RevisitWidget\'s own currentStateGateTripped windows recency itself (effectiveDate||createdAt) — a flagged entry 13 days old suppresses, 15 days old (outside RECENT_WINDOW_DAYS) does not', async () => {
    const { currentStateGateTripped } = await import('../components/zen/widgets/RevisitWidget.jsx');

    const withinWindow = [{ id: 'w1', createdAt: new Date(H1_NOW - 13 * H1_DAY_MS).toISOString(), safety_flagged: true, analysis: { mood_score: 0.9 } }];
    expect(currentStateGateTripped(withinWindow, H1_NOW)).toBe(true);

    const outsideWindow = [{ id: 'w2', createdAt: new Date(H1_NOW - 15 * H1_DAY_MS).toISOString(), safety_flagged: true, analysis: { mood_score: 0.9 } }];
    expect(currentStateGateTripped(outsideWindow, H1_NOW)).toBe(false);
  });
});

// ===========================================================================
// Hardening Row (h2): legacy entry missing explicit safety booleans is never
// selected (Michael review hardening, Task GR1, item 2 — real
// selectRevisitCandidate)
// ===========================================================================
describe('Hardening Matrix row (h2): a legacy entry with no explicit safety booleans is never selected', () => {
  it('an entry missing safety_flagged/has_warning_indicators entirely is excluded even though every other field is eligible; the same entry with explicit false/false booleans is selected', async () => {
    const { selectRevisitCandidate } = await import('../../functions/src/revisit/selectRevisits.js');
    const NOW = Date.parse('2026-07-21T12:00:00.000Z');
    const DAY_MS = 24 * 60 * 60 * 1000;

    const legacyEntry = { id: 'legacy-1', createdAt: NOW - 100 * DAY_MS, analysis: { mood_score: 0.9 } };
    expect(selectRevisitCandidate({ entries: [legacyEntry], now: NOW })).toBeNull();

    // Mutation-check control: the identical entry, explicitly screened
    // (both booleans present), IS selected — proves rule 0 is a real
    // "unknown -> excluded" gate, not an accidental exclusion from some
    // other field on this fixture.
    const screened = { ...legacyEntry, safety_flagged: false, has_warning_indicators: false };
    expect(selectRevisitCandidate({ entries: [screened], now: NOW })?.id).toBe('legacy-1');
  });
});

// ===========================================================================
// Hardening Row (h3): mood floor retuned 0.4 -> 0.6 — 0.55 excluded, 0.6
// eligible (Michael review hardening, Task GR1, item 3 — real constant +
// selector)
// ===========================================================================
describe('Hardening Matrix row (h3): mood floor is 0.6 — 0.55 is never selected, 0.6 is eligible', () => {
  it('MOOD_FLOOR === 0.6; an entry at 0.55 is excluded, an otherwise-identical entry at 0.6 is selected', async () => {
    const { selectRevisitCandidate, MOOD_FLOOR } = await import('../../functions/src/revisit/selectRevisits.js');
    expect(MOOD_FLOOR).toBe(0.6);
    const NOW = Date.parse('2026-07-21T12:00:00.000Z');
    const DAY_MS = 24 * 60 * 60 * 1000;
    const baseEntry = (mood) => ({
      id: `mood-${mood}`,
      createdAt: NOW - 100 * DAY_MS,
      safety_flagged: false,
      has_warning_indicators: false,
      analysis: { mood_score: mood },
    });

    expect(selectRevisitCandidate({ entries: [baseEntry(0.55)], now: NOW })).toBeNull();
    expect(selectRevisitCandidate({ entries: [baseEntry(0.6)], now: NOW })?.id).toBe('mood-0.6');
  });
});

// ===========================================================================
// Hardening Row (h4): weekly cadence — a queued selection 6 days ago blocks
// a new one, 8 days ago does not; REVISED Round 2 (Michael's direct review):
// a dismissal now ALSO trips cadence, at its own longer 14-day window
// (real weeklyCadenceTripped)
// ===========================================================================
describe('Hardening Matrix row (h4): weekly cadence blocks a fresh selection within 7 days of the last live one; a dismissal blocks for 14 (Round 2)', () => {
  it('WEEKLY_CADENCE_DAYS === 7, DISMISSED_CADENCE_DAYS === 14; a queued item 6 days old trips the gate, 8 days old does not; a dismissed item 13 days old trips, 15 days old does not', async () => {
    const { weeklyCadenceTripped, WEEKLY_CADENCE_DAYS, DISMISSED_CADENCE_DAYS } = await import('../../functions/src/revisit/selectRevisits.js');
    expect(WEEKLY_CADENCE_DAYS).toBe(7);
    expect(DISMISSED_CADENCE_DAYS).toBe(14);
    const NOW = Date.parse('2026-07-21T12:00:00.000Z');
    const DAY_MS = 24 * 60 * 60 * 1000;

    const sixDaysAgo = [{ status: 'queued', selectedAt: new Date(NOW - 6 * DAY_MS).toISOString() }];
    expect(weeklyCadenceTripped(sixDaysAgo, NOW)).toBe(true);

    const eightDaysAgo = [{ status: 'queued', selectedAt: new Date(NOW - 8 * DAY_MS).toISOString() }];
    expect(weeklyCadenceTripped(eightDaysAgo, NOW)).toBe(false);

    // Round 2 reversal (was GR1's "dismissal never trips cadence"): a
    // dismissal IS an exposure and, as the stronger "not now" signal, blocks
    // for LONGER (14d, 2x the 7d queued/shown cadence) — mutation-check
    // both sides of that new 14-day boundary.
    const dismissedThirteenDaysAgo = [{ status: 'dismissed', selectedAt: new Date(NOW - 13 * DAY_MS).toISOString() }];
    expect(weeklyCadenceTripped(dismissedThirteenDaysAgo, NOW)).toBe(true);

    const dismissedFifteenDaysAgo = [{ status: 'dismissed', selectedAt: new Date(NOW - 15 * DAY_MS).toISOString() }];
    expect(weeklyCadenceTripped(dismissedFifteenDaysAgo, NOW)).toBe(false);
  });
});

// ===========================================================================
// Hardening Row (h5): mood normalization launch blocker — 0-1 entry data
// yields a 0-100 display delta, never a 0-1-scale delta (Michael review
// hardening, Task EX2, item 1 — real computeExperimentResult)
// ===========================================================================
describe('Hardening Matrix row (h5): 0-1 mood inputs normalize to a 0-100 display delta, not a 0-1-scale delta', () => {
  it('entries at mood 0.62 (high-sleep group) vs 0.54 (low-sleep group) yield delta ~8 points — not ~0.08', async () => {
    const { computeExperimentResult } = await import('../services/experiments/computeResult.js');
    const { getTemplateById } = await import('../services/experiments/templates.js');
    const template = getTemplateById('sleep-hours-mood-same-day');

    const entries = [];
    for (let i = 0; i < 6; i++) {
      entries.push({ id: `h5-low-${i + 1}`, createdAt: r3IsoDay(2026, 3, i + 1), healthContext: { sleep: { totalHours: i + 1 } }, analysis: { mood_score: 0.54 } });
    }
    for (let i = 0; i < 6; i++) {
      entries.push({ id: `h5-high-${i + 1}`, createdAt: r3IsoDay(2026, 3, i + 7), healthContext: { sleep: { totalHours: i + 8 } }, analysis: { mood_score: 0.62 } });
    }
    const experiment = r3BaseExperiment({
      template,
      startAt: r3IsoDay(2026, 3, 1, 0),
      endAt: r3IsoDay(2026, 3, 13, 0),
      durationDays: 12,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(r3IsoDay(2026, 4, 1)) });

    expect(result.status).toBe('ok');
    expect(result.estimate.meanHigh).toBeCloseTo(62, 5);
    expect(result.estimate.meanLow).toBeCloseTo(54, 5);
    expect(result.estimate.delta).toBeCloseTo(8, 5);
    // The literal launch-blocker regression this row guards against: the
    // pre-fix pipeline would have reported this same data as ~0.08, not ~8.
    expect(result.estimate.delta).not.toBeCloseTo(0.08, 5);
  });
});

// ===========================================================================
// Hardening Row (h6): original result stays immutable after an
// exclusion-driven adjustment; the adjusted result is separately labeled
// (Michael review hardening, Task EX2, item 3 — real
// buildAdjustedResultUpdate + computeExperimentResult)
// ===========================================================================
describe('Hardening Matrix row (h6): original result is immutable after an exclusion adjustment; adjusted is separately labeled', () => {
  it('excluding a day recomputes only `adjusted`; `original` is the same object reference and exclusionHistory records reason/dateKey per exclusion', async () => {
    const { computeExperimentResult } = await import('../services/experiments/computeResult.js');
    const { getTemplateById } = await import('../services/experiments/templates.js');
    const { buildAdjustedResultUpdate, EXCLUSION_REASONS } = await import('../services/experiments/experimentsService.js');
    const template = getTemplateById('sleep-hours-mood-same-day');

    const entries = [];
    for (let i = 0; i < 14; i++) {
      entries.push({ id: `h6-${i + 1}`, createdAt: r3IsoDay(2026, 5, i + 1), healthContext: { sleep: { totalHours: 4 + i } }, analysis: { mood_score: (50 + i) / 100 } });
    }
    const experiment = r3BaseExperiment({ template, startAt: r3IsoDay(2026, 5, 1, 0), endAt: r3IsoDay(2026, 5, 15, 0), durationDays: 14 });
    const now = new Date(r3IsoDay(2026, 6, 1));

    const originalResult = computeExperimentResult({ experiment, entries, now });
    expect(originalResult.status).toBe('ok');

    const excludedDateKey = r3DateKeyFor(2026, 5, 5);
    const adjustedResult = computeExperimentResult({ experiment: { ...experiment, excludedObservations: [excludedDateKey] }, entries, now });
    expect(adjustedResult.estimate.n).toBe(13);

    const nowIso = now.toISOString();
    const next = buildAdjustedResultUpdate(
      { original: originalResult, exclusionHistory: [] },
      { adjusted: adjustedResult, dateKey: excludedDateKey, excluded: true, reason: EXCLUSION_REASONS[0], at: nowIso },
    );

    // Immutable: `original` is the SAME object captured before any exclusion.
    expect(next.original).toBe(originalResult);
    expect(next.adjusted).toBe(adjustedResult);
    expect(next.adjusted).not.toBe(next.original);
    expect(next.exclusionHistory).toEqual([{ dateKey: excludedDateKey, excluded: true, reason: 'wrong_data', at: nowIso }]);

    // A second exclusion appends to history without disturbing `original`.
    const nextNext = buildAdjustedResultUpdate(next, {
      adjusted: adjustedResult, dateKey: r3DateKeyFor(2026, 5, 6), excluded: true, reason: 'other', note: 'testing note', at: nowIso,
    });
    expect(nextNext.original).toBe(originalResult);
    expect(nextNext.exclusionHistory).toHaveLength(2);
  });
});

// ===========================================================================
// Hardening Row (h7): tag-presence template runs the binary split
// end-to-end without tripping split_unstable (Michael review hardening,
// EX1's H2 finding + EX2's fix — real computeExperimentResult)
// ===========================================================================
describe('Hardening Matrix row (h7): binary tag-presence template reaches an ok result, not split_unstable', () => {
  it('tag-presence-mood (splitMode: binary) reaches ok over 14 alternating present/absent days; the SAME data through median mode trips split_unstable', async () => {
    const { computeExperimentResult } = await import('../services/experiments/computeResult.js');
    const { getTemplateById } = await import('../services/experiments/templates.js');
    const template = getTemplateById('tag-presence-mood');
    expect(template.splitMode).toBe('binary');

    const TAG = '@person:sam';
    const entries = [];
    for (let day = 1; day <= 14; day++) {
      entries.push({
        id: `h7-${day}`,
        createdAt: r3IsoDay(2026, 6, day),
        tags: day % 2 === 0 ? [TAG] : [],
        analysis: { mood_score: (day % 2 === 0 ? 40 : 70) / 100 },
      });
    }
    const exposure = { ...template.exposure, tag: TAG };
    const binaryPlan = {
      templateId: template.id,
      lag: template.lag,
      exposure,
      outcome: { ...template.outcome },
      confounders: [...(template.confounders || [])],
      whatThisDoesNotProve: [...(template.whatThisDoesNotProve || [])],
      splitMode: 'binary',
    };
    const shiftedStartAt = r3DayBefore(r3IsoDay(2026, 6, 1, 0));
    const baseExp = {
      id: 'h7-exp', question: 'test question', template: template.id, scope: null,
      status: 'running', startAt: shiftedStartAt, endAt: r3IsoDay(2026, 6, 15, 0), durationDays: 14,
      excludedObservations: [], createdAt: shiftedStartAt, updatedAt: shiftedStartAt,
    };
    const now = new Date(r3IsoDay(2026, 7, 1));

    const result = computeExperimentResult({ experiment: { ...baseExp, analysisPlan: binaryPlan }, entries, now });
    expect(result.status).toBe('ok');
    expect(result.estimate.meanHigh).toBeCloseTo(40, 10);
    expect(result.estimate.meanLow).toBeCloseTo(70, 10);

    // Mutation-check control: the identical data through the pre-EX2 default
    // (median) split mode trips split_unstable — proves the template's
    // binary pin (EX2 item 4) is load-bearing, not incidental.
    const medianPlan = { ...binaryPlan, splitMode: undefined };
    const medianResult = computeExperimentResult({ experiment: { ...baseExp, analysisPlan: medianPlan }, entries, now });
    expect(medianResult.status).toBe('insufficient');
    expect(medianResult.reasons).toContain('split_unstable');
  });
});

// ===========================================================================
// Hardening Row (h8): group-size guard — a 4-vs-8 split is insufficient
// (group_too_small), isolated from the raw-n floor (Michael review
// hardening, Task EX1, item 1 — real estimator constants)
// ===========================================================================
describe('Hardening Matrix row (h8): a 4-high/8-low split is insufficient on group size alone (real MIN_GROUP_SIZE)', () => {
  it('12 pairs (clears MIN_PAIRED_OBSERVATIONS) split 4-high/8-low by a tie-heavy median trips ONLY group_too_small', async () => {
    const { pairObservations, runAnalysisPlan, MIN_GROUP_SIZE, MIN_PAIRED_OBSERVATIONS } = await import('../services/experiments/estimator.js');
    expect(MIN_GROUP_SIZE).toBe(5);

    const exposureSeries = [];
    const outcomeSeries = [];
    // 8 tied low-exposure days (all value 5), 4 distinct high-exposure days
    // (13-16) -> median split puts exactly 4 in the high group (below
    // MIN_GROUP_SIZE) and 8 in low.
    for (let i = 1; i <= 8; i++) {
      const dateKey = r3DateKeyFor(2026, 9, i);
      exposureSeries.push({ dateKey, value: 5 });
      outcomeSeries.push({ dateKey, value: 50 + i });
    }
    for (let i = 9; i <= 12; i++) {
      const dateKey = r3DateKeyFor(2026, 9, i);
      exposureSeries.push({ dateKey, value: 4 + i }); // 13, 14, 15, 16
      outcomeSeries.push({ dateKey, value: 50 + i });
    }
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });
    expect(pairs).toHaveLength(12);
    expect(pairs.length).toBeGreaterThanOrEqual(MIN_PAIRED_OBSERVATIONS); // isolates group_too_small from the raw-n floor

    const result = runAnalysisPlan({ pairs, plan: { lag: 0 }, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['group_too_small']);
  });
});

// ===========================================================================
// Hardening Row (h9): anniversary blackout — entries at 351/365/379 days
// old are never selected, 350/380 are eligible, and the blackout is a hard
// gate even against a maximally attractive "bait" entry (Michael's round-2
// direct review — real selectRevisitCandidate + ANNIVERSARY_BLACKOUT_DAYS)
// ===========================================================================
describe('Hardening Matrix row (h9): anniversary blackout (351-379 days) excludes even a high-mood, entity-rich "bait" entry', () => {
  it('351/365/379-day-old entries are excluded; 350/380-day-old entries are eligible; the blackout beats a bait entry\'s scoring advantage', async () => {
    const { selectRevisitCandidate, ANNIVERSARY_BLACKOUT_DAYS, MOOD_FLOOR } = await import('../../functions/src/revisit/selectRevisits.js');
    expect(ANNIVERSARY_BLACKOUT_DAYS).toEqual([351, 379]);

    const NOW = Date.parse('2026-07-21T16:00:00.000Z');
    const DAY_MS = 24 * 60 * 60 * 1000;
    const daysAgo = (d) => NOW - d * DAY_MS;
    const clean = (id, days) => ({
      id, createdAt: daysAgo(days), safety_flagged: false, has_warning_indicators: false,
      analysis: { mood_score: 0.7 }, tags: [], entities: [],
    });

    for (const days of [351, 365, 379]) {
      expect(selectRevisitCandidate({ entries: [clean(`d${days}`, days)], now: NOW })).toBeNull();
    }
    for (const days of [350, 380]) {
      expect(selectRevisitCandidate({ entries: [clean(`d${days}`, days)], now: NOW })?.id).toBe(`d${days}`);
    }

    // Bait fixture: a high-mood, entity/tag-rich entry sitting exactly on
    // the anniversary must still be excluded, and a plainer-but-eligible
    // fallback (right at MOOD_FLOOR, no tags/entities) must win — proving
    // the blackout is a hard gate the scorer never gets to override.
    const bait = clean('bait', 365);
    bait.tags = ['reunion', 'good-news'];
    bait.entities = [{ id: 'p1', name: 'Sam', category: 'person' }];
    bait.analysis = { mood_score: 0.95 };
    const fallback = clean('fallback', 100);
    fallback.analysis = { mood_score: MOOD_FLOOR };
    const result = selectRevisitCandidate({ entries: [bait, fallback], now: NOW });
    expect(result?.id).toBe('fallback');
  });
});

// ===========================================================================
// R4 rows (a)-(i): docs/superpowers/plans/2026-07-22-r4-insight-integrity.md
// (Task 6). Each row is a THIN duplicate of its area's own dedicated test
// file — same fixture/technique, ported here as a representative assertion
// (plus, where the area's own file already carries one, a mutation-check
// control) so the validation matrix stays a complete map of every R4
// hardening area. See the cited dedicated files for exhaustive coverage;
// nothing here re-derives their full fixture math.
// ===========================================================================

describe('R4 Matrix row (a): entry-schema adapter contract — CURRENT/LEGACY/EXPORT shapes, UNKNOWN tri-state pinned (real normalizeEntryForInsights)', () => {
  it('CURRENT shape resolves top-level fields; themes/emotions/cognitivePatterns/entities (never written today) resolve to UNKNOWN, not [] or null', async () => {
    const { normalizeEntryForInsights, isUnknown } = await import('../services/insights/entryAdapter');
    const current = {
      id: 'e1', createdAt: '2026-07-10T12:00:00.000Z', content: 'Went for a yoga class.',
      category: 'health', entry_type: 'reflection', tags: ['@activity:yoga'],
      analysis: { mood_score: 0.8 },
    };
    const n = normalizeEntryForInsights(current, { timeZone: 'UTC' });
    expect(n.entryType).toBe('reflection');
    expect(n.category).toBe('health');
    expect(n.mood01).toBe(0.8);
    expect(isUnknown(n.themes)).toBe(true);
    expect(isUnknown(n.emotions)).toBe(true);
    expect(isUnknown(n.cognitivePatterns)).toBe(true);
    expect(isUnknown(n.entities)).toBe(true);
  });

  it('LEGACY shape (analysis.* nested fields) falls back to entry_type/tags/category correctly', async () => {
    const { normalizeEntryForInsights } = await import('../services/insights/entryAdapter');
    const legacy = {
      id: 'legacy1', createdAt: '2026-05-01T08:00:00.000Z', text: 'Rough day.',
      analysis: { mood_score: 0.3, entry_type: 'vent', tags: ['@activity:exercise'] },
      classification: { primary_category: 'work' },
    };
    const n = normalizeEntryForInsights(legacy, { timeZone: 'UTC' });
    expect(n.entryType).toBe('vent');
    expect(n.tags).toEqual(['@activity:exercise']);
    expect(n.category).toBe('work');
  });

  it('EXPORT shape: object-typed healthContext.activity does not crash and derives lowercased activityTypes (the live .toLowerCase() crash site)', async () => {
    const { normalizeEntryForInsights } = await import('../services/insights/entryAdapter');
    const exportEntry = {
      id: 'export1', createdAt: '2026-07-15T09:00:00.000Z', analysis: { mood_score: 0.85 },
      healthContext: { activity: { stepsToday: 9000, hasWorkout: true, workouts: [{ type: 'Running', durationMinutes: 32 }] } },
    };
    expect(() => normalizeEntryForInsights(exportEntry, { timeZone: 'UTC' })).not.toThrow();
    const n = normalizeEntryForInsights(exportEntry, { timeZone: 'UTC' });
    expect(n.healthSignals.activityTypes).toEqual(['running']);
  });

  it('mutation-check control: an explicit empty tags array is known-empty (UNKNOWN=false), distinct from no tags field at all (UNKNOWN=true) — proves the tri-state is not collapsed to a single "absent" bucket', async () => {
    const { normalizeEntryForInsights, isUnknown } = await import('../services/insights/entryAdapter');
    const withEmpty = normalizeEntryForInsights({ id: 'e2', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 0.5 }, tags: [] }, { timeZone: 'UTC' });
    const withNone = normalizeEntryForInsights({ id: 'e3', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 0.5 } }, { timeZone: 'UTC' });
    expect(isUnknown(withEmpty.tags)).toBe(false);
    expect(withEmpty.tags).toEqual([]);
    expect(isUnknown(withNone.tags)).toBe(true);
  });
});

describe('R4 Matrix row (b): no-personal-literals — GENERIC_TRIGGERS denylist lint across patternDetector triggers + synthesizer prompt-capture scan', () => {
  it('every trigger patternDetector.js can match lives in the curated GENERIC_TRIGGERS vocabulary and contains no PERSONAL_TOKEN_DENYLIST token', async () => {
    const { GENERIC_TRIGGERS, PERSONAL_TOKEN_DENYLIST } = await import('../services/nexus/layer1/genericTriggers');
    const { NARRATIVE_PATTERNS } = await import('../services/nexus/layer1/patternDetector');
    expect(NARRATIVE_PATTERNS).toBe(GENERIC_TRIGGERS);

    const allTriggers = Object.values(GENERIC_TRIGGERS).flatMap((p) => p.triggers);
    expect(allTriggers.length).toBeGreaterThan(0);
    for (const trigger of allTriggers) {
      expect(trigger).toMatch(/^[a-z ]+$/);
      for (const banned of PERSONAL_TOKEN_DENYLIST) {
        expect(trigger.includes(banned)).toBe(false);
      }
    }
  });

  it('the real synthesis prompt, built from a fully-populated context (threads/baselines/whoop/interventions), never contains a PERSONAL_TOKEN_DENYLIST token — captures the ACTUAL built prompt, not just the static template', async () => {
    const { PERSONAL_TOKEN_DENYLIST } = await import('../services/nexus/layer1/genericTriggers');
    const gemini = await import('../services/ai/gemini');
    gemini.callGemini.mockClear();

    // vi.importActual bypasses this file's own top-of-file `vi.mock` stub of
    // layer3/synthesizer (needed so orchestrator rows (a)/(b) can control
    // its output) — this row needs the REAL buildSynthesisPrompt logic.
    // Its nested imports (layer1/threadManager, layer2/baselineManager,
    // config/firebase, firebase/firestore, ai/gemini) still resolve through
    // this file's existing mocks, exactly like the dedicated
    // synthesizer.test.js's own (much smaller) mock set.
    const { generateCausalSynthesis } = await vi.importActual('../services/nexus/layer3/synthesizer');

    const now = Date.parse('2026-07-21T12:00:00.000Z');
    const DAY_MS = 24 * 60 * 60 * 1000;
    const context = {
      recentEntries: Array.from({ length: 10 }, (_, i) => ({
        id: `entry-${i}`, createdAt: new Date(now - i * DAY_MS).toISOString(), text: `Entry number ${i}.`, mood: 0.5,
      })),
      activeThreads: [{ displayName: 'Job Search', category: 'career', entryCount: 5, sentimentTrajectory: 'improving', sentimentBaseline: 0.6 }],
      currentState: { primary: 'career_waiting', confidence: 0.7, secondary: [], durationDays: 5 },
      baselines: { global: { rhr: { mean: 58 } }, contextual: { 'state:career_waiting': { mood: { mean: 55 }, sampleDays: 10 } } },
      whoopToday: { heartRate: { resting: 60 }, hrv: { average: 45 }, recovery: { score: 50 } },
      interventionData: { interventions: { pet_walk: { effectiveness: { global: { score: 0.8 } } } } },
    };

    await generateCausalSynthesis('user-matrix-r4b', context);
    const prompt = gemini.callGemini.mock.calls.at(-1)[0].toLowerCase();
    for (const token of PERSONAL_TOKEN_DENYLIST) {
      expect(prompt).not.toContain(token.toLowerCase());
    }
  });
});

// R4 Matrix row (c) ("Mood01 threshold invariance — counterfactual +
// beliefDissonance") deleted R4-P3 per P3-D1
// (docs/superpowers/plans/2026-07-23-r4-phase3-action-loop.md):
// counterfactual.js/beliefDissonance.js, the two modules this row pinned
// its real-module-import assertions against, were deleted whole (superseded
// by claims+experiments; legacy Firestore belief docs may remain,
// harmless). Not re-pinned on a surviving module: orchestrator.js's own
// LOW_MOOD_THRESHOLD was that block's only consumer and was deleted
// alongside it (no longer "exercises meaningfully" post-deletion), and
// functions/src/revisit/selectRevisits.js's MOOD_FLOOR/LOW_MOOD_THRESHOLD
// (the other live Mood01-threshold module in this codebase) already has its
// own thorough dedicated boundary-condition coverage in
// functions/src/revisit/__tests__/selectRevisits.test.js — re-pinning here
// would be redundant duplicate coverage, not a meaningful addition.

describe('R4 Matrix row (d): complement baseline — a hand-computed activityCorrelations fixture through the REAL basicInsights orchestrator path', () => {
  const dayIso = (day) => `2026-07-${String(day).padStart(2, '0')}T12:00:00.000Z`;

  beforeEach(async () => {
    const { getDoc, getDocs, setDoc } = await import('firebase/firestore');
    getDoc.mockReset();
    getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    // feedbackLearning.js's getAllPatternLearning reads this collection —
    // give it a real empty snapshot so "no learning doc" degrades cleanly
    // (byte-identical passthrough, per T5) instead of throwing internally.
    getDocs.mockResolvedValue({ forEach: () => {} });
    setDoc.mockClear();
  });

  it('baselineMood is the non-overlapping complement average (50), not the all-entries average (70) — real generateBasicInsights end-to-end', async () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push({ id: `yoga-${i}`, createdAt: dayIso(i), content: 'yoga class', analysis: { mood_score: 0.9 } });
    }
    for (let i = 1; i <= 5; i++) {
      entries.push({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'plain day', analysis: { mood_score: 0.5 } });
    }

    const { generateBasicInsights } = await import('../services/basicInsights/basicInsightsOrchestrator');
    const result = await generateBasicInsights('user-matrix-r4d', entries);

    expect(result.success).toBe(true);
    const yoga = result.insights.find((i) => i.activityKey === 'yoga');
    expect(yoga).toBeTruthy();
    // Complement (non-yoga) average is exactly 0.5 -> baselineMood 50 —
    // NOT the all-entries average (0.7 -> would read as baselineMood 70).
    expect(yoga.baselineMood).toBe(50);
    expect(yoga.activityMood).toBe(90);
    expect(yoga.moodDelta).toBe(40);
  });
});

describe('R4 Matrix row (e): empty-group abstention — healthCorrelations never fabricates a comparison against a phantom empty group (real computeHealthMoodCorrelations)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.parse('2026-07-21T12:00:00.000Z');

  it('sleepMood: does NOT emit an insight when the poor-sleep (<6h) group is empty (regression for average([])->0)', async () => {
    const { computeHealthMoodCorrelations } = await import('../services/health/healthCorrelations');
    const padding = Array.from({ length: 2 }, (_, i) => ({
      id: `pad-${i}`, createdAt: new Date(now - (i + 100) * DAY_MS).toISOString(),
      analysis: { mood_score: 0.5 }, healthContext: { heart: { restingRate: null } },
    }));
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `good-${i}`, createdAt: new Date(now - i * DAY_MS).toISOString(),
        analysis: { mood_score: 0.6 }, healthContext: { sleep: { totalHours: 8 } },
      })),
      ...padding,
    ];
    const correlations = computeHealthMoodCorrelations(entries);
    expect(correlations?.sleepMood).toBeUndefined();
  });

  it('mutation-check control: sleepMood DOES fire when both the good-sleep AND poor-sleep groups are genuinely populated — proves abstention is a real empty-group guard, not "sleepMood always undefined"', async () => {
    const { computeHealthMoodCorrelations } = await import('../services/health/healthCorrelations');
    const entries = [
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `good-${i}`, createdAt: new Date(now - i * DAY_MS).toISOString(),
        analysis: { mood_score: 0.8 }, healthContext: { sleep: { totalHours: 8 } },
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `poor-${i}`, createdAt: new Date(now - (i + 10) * DAY_MS).toISOString(),
        analysis: { mood_score: 0.3 }, healthContext: { sleep: { totalHours: 5 } },
      })),
    ];
    const correlations = computeHealthMoodCorrelations(entries);
    expect(correlations?.sleepMood).toBeTruthy();
    expect(correlations.sleepMood.goodSleepAvgMood).toBeCloseTo(0.8);
    expect(correlations.sleepMood.poorSleepAvgMood).toBeCloseTo(0.3);
  });
});

describe('R4 Matrix row (f): reports read the singleton nexus/insights doc + the real analysis.mood_score field (real readNexusData/readEntries vs a faked doc)', () => {
  function fakeSnap(docs) {
    return {
      docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
      forEach(fn) { docs.forEach((d) => fn({ id: d.id, data: () => d.data })); },
    };
  }
  function makeQuery(snapshot) {
    const q = { where: () => q, orderBy: () => q, limit: () => q, get: async () => snapshot };
    return q;
  }

  it('readNexusData reads active[] from the nexus/insights singleton doc (not a phantom by-type collection query)', async () => {
    const { readNexusData } = await import('../../functions/src/reports/generator.js');
    const nexusDoc = {
      active: [{ id: 'pattern_x', type: 'pattern_correlation', title: 'X Effect', receipt: {} }],
      history: [],
    };
    const db = {
      doc: (path) => (path.endsWith('/nexus/insights')
        ? { get: async () => ({ exists: true, data: () => nexusDoc }) }
        : { get: async () => ({ exists: false }) }),
      collection: () => makeQuery(fakeSnap([])),
    };
    const result = await readNexusData(db, 'artifacts/app/users/u1');
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].id).toBe('pattern_x');
  });

  it('readEntries reads the real analysis.mood_score field (0-1 scale) into entry.moodScore', async () => {
    const { readEntries } = await import('../../functions/src/reports/generator.js');
    const entryWithMoodScore = {
      id: 'e1',
      data: { createdAt: { toDate: () => new Date('2026-01-10T12:00:00Z') }, text: 't', analysis: { mood_score: 0.62 } },
    };
    const db = {
      doc: () => ({ get: async () => ({ exists: false }) }),
      collection: (path) => makeQuery(fakeSnap(path.endsWith('/entries') ? [entryWithMoodScore] : [])),
    };
    const entries = await readEntries(db, 'artifacts/app/users/u1', new Date('2026-01-01'), new Date('2026-01-31'), 'weekly');
    expect(entries[0].moodScore).toBe(0.62);
  });

  it('mutation-check control: a legacy camelCase-only doc (analysis.moodScore, no mood_score) reads as missing (null), never silently misread as the camelCase value', async () => {
    const { readEntries } = await import('../../functions/src/reports/generator.js');
    const legacyEntry = {
      id: 'e2',
      data: { createdAt: { toDate: () => new Date('2026-01-10T12:00:00Z') }, text: 't', analysis: { moodScore: 0.62 } },
    };
    const db = {
      doc: () => ({ get: async () => ({ exists: false }) }),
      collection: (path) => makeQuery(fakeSnap(path.endsWith('/entries') ? [legacyEntry] : [])),
    };
    const entries = await readEntries(db, 'artifacts/app/users/u1', new Date('2026-01-01'), new Date('2026-01-31'), 'weekly');
    expect(entries[0].moodScore).toBeNull();
  });
});

describe('R4 Matrix row (g): dismissal survives id churn — real dismissalKeyFor round-trip through recordInsightDismissal/getDismissedKeys', () => {
  let engagementStore;

  beforeEach(async () => {
    const { doc, getDoc, getDocs, setDoc } = await import('firebase/firestore');
    engagementStore = new Map();
    doc.mockImplementation((...args) => ({ __id: args[args.length - 1] }));
    getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    setDoc.mockImplementation(async (ref, data, opts) => {
      if (opts?.merge) {
        engagementStore.set(ref.__id, { ...(engagementStore.get(ref.__id) || {}), ...data });
      } else {
        engagementStore.set(ref.__id, data);
      }
    });
    getDocs.mockImplementation(async () => ({
      forEach: (cb) => {
        for (const [id, data] of engagementStore.entries()) cb({ id, data: () => data });
      },
    }));
  });

  it('dismissalKeyFor derives the SAME content key across two Date.now()-churned recommendation ids', async () => {
    const { dismissalKeyFor } = await import('../services/nexus/insightDismissal');
    const first = { id: 'recommendation_1000', intervention: 'pet_walk', title: 'Walk the dog' };
    const second = { id: 'recommendation_2000', intervention: 'pet_walk', title: 'Walk the dog' };
    expect(dismissalKeyFor(first)).toBe(dismissalKeyFor(second));
    expect(dismissalKeyFor(first)).toBe('recommendation:pet_walk');
  });

  it('real recordInsightDismissal -> getDismissedKeys round trip: a dismissal survives lookup by a churned-id insight with the SAME content, and does NOT match reworded content (documented boundary)', async () => {
    const { recordInsightDismissal, getDismissedKeys, dismissalKeyFor } = await import('../services/nexus/insightDismissal');
    const original = { id: 'recommendation_1000', intervention: 'pet_walk', title: 'Walk the dog' };
    const wrote = await recordInsightDismissal('user-r4g', original);
    expect(wrote).toBe(true);

    const keys = await getDismissedKeys('user-r4g');

    const regenerated = { id: 'recommendation_9999999', intervention: 'pet_walk', title: 'Walk the dog' };
    expect(keys.has(dismissalKeyFor(regenerated))).toBe(true);

    // Mutation-check control: genuinely different content -> different key,
    // legitimately resurfaces (not a bug — see insightDismissal.js's own
    // "honest boundary" comment).
    const reworked = { id: 'recommendation_777', intervention: 'journal_prompt', title: 'Try journaling' };
    expect(keys.has(dismissalKeyFor(reworked))).toBe(false);
  });
});

describe('R4 Matrix row (h): suppression fails toward holding for an unstamped legacy doc — real shouldShowInsight/evaluateShowDecision', () => {
  beforeEach(async () => {
    const { getDoc } = await import('firebase/firestore');
    getDoc.mockReset();
    getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
  });

  it('a suppressed learning doc with entriesAtLastEvaluation entirely ABSENT (pre-T5b legacy shape) holds suppression on the very next evaluation — does not resurface just because the unstamped baseline reads as 0', async () => {
    const { getDoc } = await import('firebase/firestore');
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        totalFeedback: 3,
        suppressed: true,
        suppressedAt: { toMillis: () => Date.now() - 1000 },
        confidenceMultiplier: 0.3,
        requiredMoodDeltaToResurface: null,
        // entriesAtLastEvaluation entirely absent — pre-T5b legacy doc
      }),
    });

    const { shouldShowInsight } = await import('../services/basicInsights/feedbackLearning');
    const decision = await shouldShowInsight('user-r4h', { activityKey: 'yoga', moodDelta: 5 }, 500);
    expect(decision.show).toBe(false);
    expect(decision.reason).toBe('suppressed');
  });

  it('mutation-check control: a properly-stamped doc with >=5 genuinely new entries DOES re-evaluate and resurface — proves the fix is not "suppress forever"', async () => {
    const { getDoc } = await import('firebase/firestore');
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        totalFeedback: 3,
        suppressed: true,
        suppressedAt: { toMillis: () => Date.now() - 1000 },
        confidenceMultiplier: 0.3,
        requiredMoodDeltaToResurface: null,
        entriesAtLastEvaluation: 100,
      }),
    });

    const { shouldShowInsight } = await import('../services/basicInsights/feedbackLearning');
    const decision = await shouldShowInsight('user-r4h-2', { activityKey: 'yoga', moodDelta: 5 }, 106);
    expect(decision.show).toBe(true);
    expect(decision.reason).toBe('new_data_reevaluation');
  });
});

describe('R4 Matrix row (i): versioned cutover — archives-not-deletes + stamps generatorVersion (real generateInsights/saveInsights)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function mockEntriesSnapshot(entries) {
    return { docs: entries.map((e) => ({ id: e.id, data: () => ({ ...e }) })) };
  }
  function buildFixtureEntries() {
    const now = Date.parse('2026-07-21T12:00:00.000Z');
    const entries = [];
    for (let i = 0; i < 4; i++) {
      entries.push({ id: `interview-${i}`, createdAt: new Date(now - i * DAY_MS).toISOString(), text: `Had another interview today, feeling good about it. Entry number ${i}.`, analysis: { mood_score: 0.80 } });
    }
    for (let i = 0; i < 4; i++) {
      entries.push({ id: `yoga-${i}`, createdAt: new Date(now - (i + 4) * DAY_MS).toISOString(), text: `Did yoga this morning, feeling solid. Entry number ${i}.`, analysis: { mood_score: 0.85 } });
    }
    for (let i = 0; i < 4; i++) {
      entries.push({ id: `neutral-${i}`, createdAt: new Date(now - (i + 8) * DAY_MS).toISOString(), text: `A regular day. Nothing special. Entry number ${i}.`, analysis: { mood_score: 0.50 } });
    }
    return entries;
  }

  beforeEach(async () => {
    const { getDocs, getDoc, setDoc } = await import('firebase/firestore');
    getDocs.mockReset();
    getDoc.mockReset();
    setDoc.mockClear();
    getExcludedEntryIdsMock.mockReset();
    getExcludedEntryIdsMock.mockResolvedValue(new Set());
  });

  it('a legacy active insight (no generatorVersion) is archived into history with legacyVersion:true — never left active, never deleted — while every newly generated active insight is stamped with the current generatorVersion', async () => {
    const { getDocs, getDoc, setDoc } = await import('firebase/firestore');
    const legacyInsight = { id: 'pattern_legacy_matrix', type: 'pattern_correlation', title: 'Legacy pattern', summary: 'x', priority: 3 };

    getDoc
      .mockResolvedValueOnce({ exists: () => false, data: () => ({}) }) // getUserSettings' settings/nexus read
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ active: [legacyInsight], history: [] }) }); // saveInsights' nexus/insights read

    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildFixtureEntries()));

    const { generateInsights, generatorVersion } = await import('../services/nexus/orchestrator');
    const result = await generateInsights('user-matrix-r4i');
    expect(result.success).toBe(true);

    const persistCall = setDoc.mock.calls.find((call) => call[1] && Array.isArray(call[1].active));
    expect(persistCall).toBeTruthy();
    expect(persistCall[1].active.length).toBeGreaterThan(0);
    for (const insight of persistCall[1].active) {
      expect(insight.generatorVersion).toBe(generatorVersion);
    }

    const archived = persistCall[1].history.find((i) => i.id === 'pattern_legacy_matrix');
    expect(archived).toBeTruthy();
    expect(archived.legacyVersion).toBe(true);
    expect(persistCall[1].active.find((i) => i.id === 'pattern_legacy_matrix')).toBeUndefined();
  });
});

// ===========================================================================
// R4 Phase 1 rows (a)-(j): claim store / testing ledger / evidence builder /
// retraction / receipts / feedback taxonomy, covering
// docs/superpowers/plans/2026-07-22-r4-phase1-insight-integrity.md (Task 11).
//
// Real modules under test: src/services/insights/claims/{claimsPipeline,
// claimsService,claimSchema,evidenceBuilder,claimFeedback}.js,
// src/services/insights/testingLedger.js, src/services/insights/
// observations.js. Their own import graph (experiments/estimator.js,
// experiments/computeResult.js, entryAdapter.js, receipts.js) is entirely
// Firebase-free — verified by reading every file in it, the same precedent
// already established for the R3 rows above — so it runs for real with zero
// additional mocking.
//
// claimsService.js/testingLedger.js/claimFeedback.js import their Firestore
// primitives directly from 'firebase/firestore' (already vi.mock'd at the
// top of this file). That mock didn't previously export updateDoc/
// writeBatch/runTransaction/addDoc/where — bare placeholders for those were
// added to the top-of-file factory for this section; wireClaimsFirestore()
// below gives doc/collection/getDoc/getDocs/setDoc/updateDoc/writeBatch/
// runTransaction/addDoc a real path-keyed Map-store implementation, called
// fresh from each row's own beforeEach (mirrors claimsPipeline.test.js's/
// claimsService.test.js's own dedicated Firestore fakes verbatim). Nothing
// in the file runs after this section, so overriding doc/collection's mock
// implementation here cannot leak into any earlier row.
let claimsStore;
let claimsAutoId;
async function wireClaimsFirestore() {
  claimsStore = new Map();
  claimsAutoId = 0;
  const {
    collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, runTransaction, addDoc,
  } = await import('firebase/firestore');
  const pathOf = (...segs) => segs.join('/');
  collection.mockImplementation((_db, ...segs) => ({ path: pathOf(...segs) }));
  doc.mockImplementation((_db, ...segs) => ({ path: pathOf(...segs) }));
  getDoc.mockImplementation(async (ref) => ({
    exists: () => claimsStore.has(ref.path), data: () => claimsStore.get(ref.path),
  }));
  getDocs.mockImplementation(async (colRef) => {
    const docs = [...claimsStore.entries()]
      .filter(([path]) => path.startsWith(`${colRef.path}/`))
      .map(([path, data]) => ({ id: path.slice(colRef.path.length + 1), data: () => data }));
    // Both shapes are needed: claimsService.js/testingLedger.js read `.docs`;
    // feedbackLearning.js/sourceExclusions.js read `.forEach`/`.empty`.
    return {
      docs, forEach: (fn) => docs.forEach((d) => fn(d)), empty: docs.length === 0, size: docs.length,
    };
  });
  setDoc.mockImplementation(async (ref, data) => { claimsStore.set(ref.path, data); });
  updateDoc.mockImplementation(async (ref, patch) => {
    if (!claimsStore.has(ref.path)) throw new Error(`no doc at ${ref.path}`);
    claimsStore.set(ref.path, { ...claimsStore.get(ref.path), ...patch });
  });
  writeBatch.mockImplementation(() => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(() => claimsStore.set(ref.path, data)),
      update: (ref, patch) => ops.push(() => {
        if (!claimsStore.has(ref.path)) throw new Error(`no doc at ${ref.path}`);
        claimsStore.set(ref.path, { ...claimsStore.get(ref.path), ...patch });
      }),
      commit: async () => { ops.forEach((fn) => fn()); },
    };
  });
  runTransaction.mockImplementation(async (_db, fn) => fn({
    get: async (ref) => ({ exists: () => claimsStore.has(ref.path), data: () => claimsStore.get(ref.path) }),
    set: (ref, data) => claimsStore.set(ref.path, data),
  }));
  addDoc.mockImplementation(async (colRef, data) => {
    claimsAutoId += 1;
    const id = `auto-${claimsAutoId}`;
    claimsStore.set(`${colRef.path}/${id}`, data);
    return { id };
  });
}

const R4P1_NOW = '2026-07-22T10:00:00.000Z';
// Fixture builders mirror evidenceBuilder.test.js's/claimsPipeline.test.js's
// own STRONG-set precedent verbatim (single entry per day; day-based gate-6
// reconciliation coincides with the entry-based one).
function r4p1Fixtures(days) {
  return days.map((x, i) => {
    const tags = [];
    if (x.gym) tags.push('gym');
    if (x.extraTag) tags.push(x.extraTag);
    return {
      id: `r4p1-e${i}`, createdAt: `${x.d}T12:00:00Z`, text: `entry ${i} text`,
      analysis: { mood_score: x.mood }, tags,
      safety_flagged: x.sensitive === true,
    };
  });
}
const r4p1Mk = (n, startDay, month, gym, mood) => Array.from({ length: n }, (_, i) => ({
  d: `2026-${month}-${String(startDay + i).padStart(2, '0')}`, gym, mood,
}));
// 40 days spanning >3 weeks: 16 gym days mood 0.72, 24 non-gym mood 0.55 —
// proven eligible (delta clears the practical floor, ci95 excludes zero) in
// evidenceBuilder.test.js/claimsPipeline.test.js's own identical fixture.
const R4P1_STRONG = [...r4p1Mk(16, 1, '06', true, 0.72), ...r4p1Mk(14, 17, '06', false, 0.55), ...r4p1Mk(10, 1, '07', false, 0.55)];

const R4P1_SPEC = { key: 'tag:gym', kind: 'tag', label: 'gym', splitMode: 'binary' };

/** A complete, valid buildClaim() input (version 1, no parent) derived from
 * the real evidenceBuilder run over R4P1_STRONG at candidateTestsCount=1 —
 * shared by the rows below that need a well-formed claim to mutate/inspect
 * rather than re-deriving one via the full pipeline. */
async function r4p1ValidClaimInput() {
  const { buildDailyObservations } = await import('../services/insights/observations');
  const { freezeCandidatePlan, buildEvidenceForCandidate } = await import('../services/insights/claims/evidenceBuilder');
  const entries = r4p1Fixtures(R4P1_STRONG);
  const observations = buildDailyObservations(entries, { timeZone: 'UTC' });
  const entriesById = new Map(entries.map((e) => [e.id, e]));
  const plan = freezeCandidatePlan({
    familyId: 'basic:activity:mood', candidateId: 'tag:gym', exposureSpec: R4P1_SPEC,
    candidateTestsCount: 1, timeZone: 'UTC', now: R4P1_NOW,
  });
  const result = buildEvidenceForCandidate({
    observations, entriesById, exposureSpec: R4P1_SPEC, plan,
  });
  return { ...result.claimInput, version: 1, parentClaimId: null };
}

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-a ledger-counts-inconclusive', () => {
  beforeEach(wireClaimsFirestore);

  it('a run where every enumerated candidate is ineligible still registers it in the testing ledger (testedCount > 0), while zero claims are written', async () => {
    const { generateClaims } = await import('../services/insights/claims/claimsPipeline');
    const { familyIdForBasic, readLedgerCounts } = await import('../services/insights/testingLedger');

    // Same "too few total days" fixture evidenceBuilder.test.js proves
    // ineligible: 5 gym days (clears enumerateExposures' minPresentDays=3,
    // so it IS enumerated) but too few paired days to ever be estimable.
    const tooFewDays = [...r4p1Mk(5, 1, '06', true, 0.8), ...r4p1Mk(5, 10, '06', false, 0.4)];
    const result = await generateClaims({}, 'u-r4p1a', r4p1Fixtures(tooFewDays), { timeZone: 'UTC', now: R4P1_NOW });

    expect(result.eligible).toBe(0);
    expect(result.written).toBe(0);
    expect(result.candidatesTested).toBeGreaterThan(0); // tag:gym WAS enumerated + registered

    const activityFamily = familyIdForBasic('activity');
    const counts = await readLedgerCounts({}, 'u-r4p1a', [activityFamily]);
    expect(counts.get(activityFamily)).toBeGreaterThan(0); // count-before-analyze: ledgered regardless of the analysis outcome

    const claimsPrefix = 'artifacts/echo-vault-v5-fresh/users/u-r4p1a/insight_claims/';
    expect([...claimsStore.keys()].some((k) => k.startsWith(claimsPrefix))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-b count-before-analyze', () => {
  beforeEach(wireClaimsFirestore);

  it("the written claim's frozen analysisPlan.candidateTestsCount is >= the number of candidates enumerated (and registered) THIS run — registration completes before any candidate is analyzed, never a stale/smaller count", async () => {
    const { generateClaims } = await import('../services/insights/claims/claimsPipeline');

    // Three candidates enumerated in ONE engine family (tag:gym/call/book —
    // same mixed-eligibility shape claimsPipeline.test.js's own dedicated
    // "count-before-analyze" test proves via call-order spies; this row pins
    // the observable OUTCOME of that ordering instead of the call order).
    const days = R4P1_STRONG.map((d, i) => {
      if (i < 3) return { ...d, extraTag: 'call' };
      if (i >= 3 && i < 6) return { ...d, extraTag: 'book' };
      return d;
    });
    const result = await generateClaims({}, 'u-r4p1b', r4p1Fixtures(days), { timeZone: 'UTC', now: R4P1_NOW });

    expect(result.candidatesTested).toBe(3); // tag:gym + tag:call + tag:book enumerated this run
    const claimsPrefix = 'artifacts/echo-vault-v5-fresh/users/u-r4p1b/insight_claims/';
    const claims = [...claimsStore.entries()].filter(([k]) => k.startsWith(claimsPrefix)).map(([, v]) => v);
    expect(claims).toHaveLength(1);
    expect(claims[0].analysisPlan.candidateId).toBe('tag:gym');
    expect(claims[0].analysisPlan.candidateTestsCount).toBeGreaterThanOrEqual(result.candidatesTested);
    expect(claims[0].analysisPlan.candidateTestsCount).toBe(3); // the pooled family count, not a singleton count of 1
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-c bonferroni-widens', () => {
  it('same fixture, m=1 vs m=50: the m=50 stability interval is never narrower than m=1\'s — it is wider, or the claim becomes ineligible (interval_includes_zero)', async () => {
    const { buildDailyObservations } = await import('../services/insights/observations');
    const { freezeCandidatePlan, buildEvidenceForCandidate } = await import('../services/insights/claims/evidenceBuilder');

    // Borderline fixture from evidenceBuilder.test.js's own "Bonferroni
    // bites" test (verified there: delta=7.375, ci95=[1.43,13.07] excludes
    // zero, ci99.75=[-2.78,17] includes zero) — genuine within-group
    // variance so the bootstrap CI has real width to widen.
    const gymMoods = [0.50, 0.56, 0.62, 0.68, 0.74, 0.56, 0.62, 0.68, 0.50, 0.74, 0.56, 0.68, 0.62, 0.50, 0.74, 0.68];
    const nonGymMoods = [0.40, 0.46, 0.52, 0.58, 0.64, 0.70, 0.46, 0.52, 0.58, 0.64, 0.40, 0.70, 0.46, 0.64, 0.52, 0.58, 0.40, 0.70, 0.46, 0.64, 0.52, 0.58, 0.40, 0.70];
    const gymDays = Array.from({ length: 16 }, (_, i) => ({ d: `2026-06-${String(1 + i).padStart(2, '0')}`, gym: true, mood: gymMoods[i] }));
    const nonGymDays = [
      ...Array.from({ length: 14 }, (_, i) => ({ d: `2026-06-${String(17 + i).padStart(2, '0')}`, gym: false, mood: nonGymMoods[i] })),
      ...Array.from({ length: 10 }, (_, i) => ({ d: `2026-07-${String(1 + i).padStart(2, '0')}`, gym: false, mood: nonGymMoods[14 + i] })),
    ];
    const entries = r4p1Fixtures([...gymDays, ...nonGymDays]);
    const observations = buildDailyObservations(entries, { timeZone: 'UTC' });
    const entriesById = new Map(entries.map((e) => [e.id, e]));

    const run = (testedCount) => buildEvidenceForCandidate({
      observations, entriesById, exposureSpec: R4P1_SPEC,
      plan: freezeCandidatePlan({
        familyId: 'basic:activity:mood', candidateId: 'tag:gym', exposureSpec: R4P1_SPEC,
        candidateTestsCount: testedCount, timeZone: 'UTC', now: R4P1_NOW,
      }),
    });

    const m1 = run(1);
    const m50 = run(50);
    expect(m1.eligible).toBe(true);

    if (!m50.eligible) {
      expect(m50.reasons).toContain('interval_includes_zero'); // Bonferroni bit
    } else {
      const widthOf = (r) => r.claimInput.evidence.stabilityInterval[1] - r.claimInput.evidence.stabilityInterval[0];
      expect(widthOf(m50)).toBeGreaterThanOrEqual(widthOf(m1)); // never the reverse
    }
  });

  it('mutation-check control: identical inputs at the SAME candidateTestsCount produce a deeply-equal result twice — proves the row above measures the Bonferroni correction, not bootstrap run-to-run noise', async () => {
    const { buildDailyObservations } = await import('../services/insights/observations');
    const { freezeCandidatePlan, buildEvidenceForCandidate } = await import('../services/insights/claims/evidenceBuilder');
    const entries = r4p1Fixtures(R4P1_STRONG);
    const observations = buildDailyObservations(entries, { timeZone: 'UTC' });
    const entriesById = new Map(entries.map((e) => [e.id, e]));
    const run = () => buildEvidenceForCandidate({
      observations, entriesById, exposureSpec: R4P1_SPEC,
      plan: freezeCandidatePlan({
        familyId: 'basic:activity:mood', candidateId: 'tag:gym', exposureSpec: R4P1_SPEC,
        candidateTestsCount: 1, timeZone: 'UTC', now: R4P1_NOW,
      }),
    });
    expect(run()).toEqual(run());
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-d claim-immutability', () => {
  // Firestore-rules enforcement of immutability lives in
  // functions/src/__tests__/firestoreRules.test.js, describe('insight_claims
  // collection rules (update contract)'):
  //   - "denies an update that touches wording"
  //   - "denies an update that touches evidence"
  //   - "denies an update that touches analysisPlan"
  //   - "allows an update to status + updatedAt only"
  //   - "allows an update to supersededByClaimId + updatedAt only" (the
  //      supersede path — the ONLY way a claim's facts ever change)
  //   - "denies a status regression to candidate"
  // This row asserts the JS-SIDE seam those rules back up: buildClaim
  // rejects a malformed/tampered claim before it can ever reach a write, and
  // setClaimStatus's own allowlist matches the rules' status-only-update
  // contract — an app bug that tried to write a disallowed status is caught
  // here, one layer before the rules would also catch it.
  it('buildClaim rejects an unrecognized evidence key (closes the nested-map smuggling seam) and rejects a claim missing analysisPlan', async () => {
    const { buildClaim } = await import('../services/insights/claims/claimSchema');
    const base = await r4p1ValidClaimInput();

    expect(() => buildClaim(base)).not.toThrow(); // sanity: the base input IS valid
    expect(() => buildClaim({ ...base, evidence: { ...base.evidence, note: 'smuggled freeform text' } }))
      .toThrow(/not a recognized key/);
    const { analysisPlan, ...withoutPlan } = base;
    expect(() => buildClaim(withoutPlan)).toThrow(/analysisPlan required/);
  });

  it("setClaimStatus allows exactly {suppressed, verified, expired} from app code — the same three-state contract firestoreRules.test.js pins ('candidate' is create-only, per \"denies a status regression to candidate\")", async () => {
    await wireClaimsFirestore();
    const { setClaimStatus } = await import('../services/insights/claims/claimsService');
    const claimsPrefix = 'artifacts/echo-vault-v5-fresh/users/u-r4p1d/insight_claims/';
    claimsStore.set(`${claimsPrefix}c1`, { id: 'c1', status: 'verified', updatedAt: R4P1_NOW });

    await expect(setClaimStatus({}, 'u-r4p1d', 'c1', 'candidate')).rejects.toThrow();
    await expect(setClaimStatus({}, 'u-r4p1d', 'c1', 'bogus')).rejects.toThrow();
    await setClaimStatus({}, 'u-r4p1d', 'c1', 'suppressed', { now: '2026-07-23T00:00:00.000Z' });
    expect(claimsStore.get(`${claimsPrefix}c1`).status).toBe('suppressed');
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-e receipt-reconciliation', () => {
  beforeEach(wireClaimsFirestore);

  it('every eligible claim written by the real pipeline reconciles: visible sourceEntryIds + hiddenSensitiveSourceCount === totalCandidateDayCount, and no sensitive entry ever appears in receipt.sources', async () => {
    const { generateClaims } = await import('../services/insights/claims/claimsPipeline');
    const days = R4P1_STRONG.map((d, i) => (i < 2 ? { ...d, sensitive: true } : d)); // first 2 (gym) days marked sensitive
    const result = await generateClaims({}, 'u-r4p1e', r4p1Fixtures(days), { timeZone: 'UTC', now: R4P1_NOW });
    expect(result.written).toBe(1);

    const claimsPrefix = 'artifacts/echo-vault-v5-fresh/users/u-r4p1e/insight_claims/';
    const [, claim] = [...claimsStore.entries()].find(([k]) => k.startsWith(claimsPrefix));

    expect(claim.evidence.hiddenSensitiveSourceCount).toBe(2);
    expect(claim.evidence.sourceEntryIds.length + claim.evidence.hiddenSensitiveSourceCount)
      .toBe(claim.evidence.totalCandidateDayCount);

    const sensitiveIds = new Set(['r4p1-e0', 'r4p1-e1']); // the two entries marked sensitive above
    expect(sensitiveIds.size).toBeGreaterThan(0);
    for (const source of claim.receipt.sources) {
      expect(sensitiveIds.has(source.entryId)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-f unknown-≠-absent', () => {
  it('a day whose tags field is UNKNOWN (no tags array anywhere on the entry) is omitted from the tag exposure series entirely — neither the present(1) nor the known-absent(0) group — and removing that day changes no series counts', async () => {
    const { buildDailyObservations, observationSeriesFor } = await import('../services/insights/observations');

    const knownDays = [
      ...r4p1Mk(5, 1, '06', true, 0.7),   // present days: tags ['gym']
      ...r4p1Mk(5, 10, '06', false, 0.5), // known-absent days: tags []
    ];
    const knownEntries = r4p1Fixtures(knownDays);
    // No `tags` key at all -> entryAdapter resolves tags to UNKNOWN (never a
    // known-empty []) for this entry's day.
    const unknownDayEntry = {
      id: 'r4p1-unknown', createdAt: '2026-06-20T12:00:00Z', text: 'no tags field at all',
      analysis: { mood_score: 0.6 },
    };
    expect('tags' in unknownDayEntry).toBe(false);

    const withUnknown = buildDailyObservations([...knownEntries, unknownDayEntry], { timeZone: 'UTC' });
    const withoutUnknown = buildDailyObservations(knownEntries, { timeZone: 'UTC' });

    const seriesWith = observationSeriesFor(withUnknown, R4P1_SPEC);
    const seriesWithout = observationSeriesFor(withoutUnknown, R4P1_SPEC);

    expect(seriesWith.find((p) => p.dateKey === '2026-06-20')).toBeUndefined(); // never in NO series
    expect(seriesWith.length).toBe(seriesWithout.length); // removing it changes no counts
    expect(seriesWith.filter((p) => p.value === 1).length).toBe(seriesWithout.filter((p) => p.value === 1).length);
    expect(seriesWith.filter((p) => p.value === 0).length).toBe(seriesWithout.filter((p) => p.value === 0).length);
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-g supersede-not-overwrite', () => {
  beforeEach(wireClaimsFirestore);

  it('a meaningfully changed re-run supersedes: both claim doc versions persist, the old one carries supersededByClaimId, and listActiveClaims (the real read path) returns ONLY the new version', async () => {
    const { generateClaims } = await import('../services/insights/claims/claimsPipeline');
    const { listActiveClaims, listAllClaims } = await import('../services/insights/claims/claimsService');

    const first = await generateClaims({}, 'u-r4p1g', r4p1Fixtures(R4P1_STRONG), { timeZone: 'UTC', now: R4P1_NOW });
    expect(first.written).toBe(1);
    const before = await listAllClaims({}, 'u-r4p1g');
    const oldId = before[0].id;

    const laterNow = '2026-07-30T10:00:00.000Z';
    // 10 more gym days at LOW mood — meaningfully shrinks the gym effect
    // (proven to trigger supersede, not dedup, in claimsPipeline.test.js's
    // identical CONTRADICTING fixture).
    const contradicting = r4p1Mk(10, 11, '07', true, 0.55);
    const second = await generateClaims({}, 'u-r4p1g', r4p1Fixtures([...R4P1_STRONG, ...contradicting]), { timeZone: 'UTC', now: laterNow });
    expect(second.superseded).toBe(1);

    const all = await listAllClaims({}, 'u-r4p1g');
    expect(all).toHaveLength(2); // never overwritten — both versions persist
    const oldDoc = all.find((c) => c.id === oldId);
    const newDoc = all.find((c) => c.id !== oldId);
    expect(oldDoc.supersededByClaimId).toBe(newDoc.id);
    expect(newDoc.version).toBe(2);
    expect(newDoc.parentClaimId).toBe(oldId);

    const active = await listActiveClaims({}, 'u-r4p1g');
    expect(active.map((c) => c.id)).toEqual([newDoc.id]); // only the new version is "active"
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-h feedback-routing', () => {
  beforeEach(wireClaimsFirestore);

  // recordFeedbackAndLearn/recordInsightEngagement (claimFeedback.js's two
  // downstream consumers) are left REAL here — both are already independently
  // unit-tested (feedbackLearning.test.js) and only need the Firestore
  // primitives wireClaimsFirestore() already wires (both import doc/getDoc/
  // setDoc/getDocs from the same 'firebase/firestore' specifier this section
  // wires); this row's own contract is ROUTING (which consumer fires for
  // which option, and whether the claim doc itself is touched), not their
  // internal accuracy math.
  async function liveClaim(uid) {
    const { writeClaim } = await import('../services/insights/claims/claimsService');
    return writeClaim({}, uid, await r4p1ValidClaimInput());
  }

  it("wrong_source writes a source_exclusion (appliesTo: the claim's own hypothesisFamilyId) via excludeSource, and never mutates the claim doc itself", async () => {
    const { recordClaimFeedback } = await import('../services/insights/claims/claimFeedback');
    const { listAllClaims } = await import('../services/insights/claims/claimsService');
    const uid = 'u-r4p1h-wrong-source';
    const claim = await liveClaim(uid);
    firestoreMocks.addDoc.mockClear();

    await recordClaimFeedback({}, uid, claim, 'wrong_source', { entryId: claim.evidence.sourceEntryIds[0] });

    // excludeSource (sourceExclusions.js) writes via config/firebase's addDoc
    // — this file's OTHER shared mock, `firestoreMocks` (not the
    // 'firebase/firestore' one wireClaimsFirestore wires).
    const exclusionCall = firestoreMocks.addDoc.mock.calls.find((call) => call[1]?.reason === 'wrong_source');
    expect(exclusionCall).toBeTruthy();
    expect(exclusionCall[1].appliesTo).toBe(claim.analysisPlan.hypothesisFamilyId);
    expect(exclusionCall[1].entryId).toBe(claim.evidence.sourceEntryIds[0]);

    const after = await listAllClaims({}, uid);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(claim); // no claim mutation whatsoever
  });

  it("do_not_analyze flips the claim's own status to 'suppressed' via setClaimStatus, and never deletes it", async () => {
    const { recordClaimFeedback } = await import('../services/insights/claims/claimFeedback');
    const { listAllClaims } = await import('../services/insights/claims/claimsService');
    const uid = 'u-r4p1h-do-not-analyze';
    const claim = await liveClaim(uid);

    await recordClaimFeedback({}, uid, claim, 'do_not_analyze');

    const after = await listAllClaims({}, uid);
    expect(after).toHaveLength(1); // never deleted
    expect(after[0].id).toBe(claim.id);
    expect(after[0].status).toBe('suppressed');
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-i flag-off-inert', () => {
  const dayIso = (day) => `2026-07-${String(day).padStart(2, '0')}T12:00:00.000Z`;

  beforeEach(async () => {
    // Real path-keyed store so the ledger/claim reads below are a genuine
    // "nothing was ever written" proof, not a vacuous one.
    await wireClaimsFirestore();
    const { getFlag } = await import('../config/flags');
    getFlag.mockReset();
    getFlag.mockReturnValue(false); // insightClaims OFF — this row's whole point
  });

  it('with insightClaims OFF: generateBasicInsights writes zero testing_ledger docs and zero insight_claims docs, and its own legacy output is unchanged (matches the pinned pre-Phase-1 snapshot from R4 row (d) above)', async () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) entries.push({ id: `yoga-${i}`, createdAt: dayIso(i), content: 'yoga class', analysis: { mood_score: 0.9 } });
    for (let i = 1; i <= 5; i++) entries.push({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'plain day', analysis: { mood_score: 0.5 } });

    const { generateBasicInsights } = await import('../services/basicInsights/basicInsightsOrchestrator');
    const result = await generateBasicInsights('user-matrix-r4p1i', entries);

    expect(result.success).toBe(true);
    const yoga = result.insights.find((i) => i.activityKey === 'yoga');
    // Same fixture as R4 row (d)'s pinned legacy-orchestrator snapshot above
    // — insightClaims is entirely orthogonal to this computation (the
    // generateClaims hook runs, if at all, strictly AFTER these results are
    // computed and saved), so flipping it OFF must reproduce it byte-for-byte.
    expect({ baselineMood: yoga.baselineMood, activityMood: yoga.activityMood, moodDelta: yoga.moodDelta })
      .toEqual({ baselineMood: 50, activityMood: 90, moodDelta: 40 });

    const { readLedgerCounts, familyIdForBasic } = await import('../services/insights/testingLedger');
    const { listAllClaims } = await import('../services/insights/claims/claimsService');
    const counts = await readLedgerCounts({}, 'user-matrix-r4p1i', [familyIdForBasic('activity')]);
    expect(counts.get(familyIdForBasic('activity'))).toBe(0); // no ledger doc was ever created
    expect(await listAllClaims({}, 'user-matrix-r4p1i')).toEqual([]); // no claim doc was ever created
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P1-j suppressed-claim durability', () => {
  beforeEach(wireClaimsFirestore);

  it('a suppressed prior is untouched by a re-run whose candidate stays eligible but whose evidence has drifted — no new claim, no supersede, status/updatedAt unchanged (the reviewer scenario: "Don\'t analyze this topic" must not be silently un-suppressed by evidence drift)', async () => {
    const { generateClaims } = await import('../services/insights/claims/claimsPipeline');
    const { setClaimStatus, listAllClaims } = await import('../services/insights/claims/claimsService');

    const first = await generateClaims({}, 'u-r4p1j', r4p1Fixtures(R4P1_STRONG), { timeZone: 'UTC', now: R4P1_NOW });
    expect(first.written).toBe(1);
    const before = await listAllClaims({}, 'u-r4p1j');
    const priorId = before[0].id;

    // User suppresses it ("Don't analyze this topic").
    const suppressedAt = '2026-07-23T00:00:00.000Z';
    await setClaimStatus({}, 'u-r4p1j', priorId, 'suppressed', { now: suppressedAt });

    // Re-run with evidence that has drifted enough to trigger a supersede on
    // an unsuppressed claim (same "meaningfully changed" fixture proven in
    // claimsPipeline.test.js), but the candidate STAYS eligible.
    const laterNow = '2026-07-30T10:00:00.000Z';
    const contradicting = r4p1Mk(10, 11, '07', true, 0.55);
    const second = await generateClaims(
      {}, 'u-r4p1j', r4p1Fixtures([...R4P1_STRONG, ...contradicting]), { timeZone: 'UTC', now: laterNow },
    );

    expect(second.eligible).toBe(1); // still analyzed as eligible...
    expect(second.written).toBe(0); // ...but nothing written
    expect(second.superseded).toBe(0);

    const claims = await listAllClaims({}, 'u-r4p1j');
    expect(claims).toHaveLength(1); // no new claim doc
    const prior = claims.find((c) => c.id === priorId);
    expect(prior.status).toBe('suppressed');
    expect(prior.supersededByClaimId).toBeNull();
    expect(prior.updatedAt).toBe(suppressedAt); // no write touched it
  });
});

// ===========================================================================
// R4 Phase 2 rows (a)-(i): writer-dark default / verifier trust core / third
// claim type (experiment_result) / unified ranked feed / claims-fed reports
// + Ask Journal, covering
// docs/superpowers/plans/2026-07-23-r4-phase2-trustworthy-synthesis.md
// (Task 9).
//
// Real modules under test: src/services/insights/claims/{claimsPipeline,
// claimSchema,evidenceBuilder,claimsService,rankClaims}.js,
// src/services/experiments/experimentClaim.js,
// functions/src/insights/claimVerifier.js (cross-package import — pure, no
// Firestore/Admin SDK; verified by reading the file), functions/src/reports/
// narrative.js (cross-package import; its own shared/gemini.js +
// models/registry.js mocked as the network/registry boundary only, exactly
// as narrative.test.js's own dedicated file does), src/pages/InsightsPage.jsx
// + src/hooks/useClaims.js + src/components/insights/{ClaimFeed,
// ClaimCard}.jsx, and src/services/analysis/index.js's
// askJournalAI/buildVerifiedPatternsBlock. Shared R4P1 fixtures/helpers above
// (wireClaimsFirestore, r4p1Fixtures, R4P1_STRONG, R4P1_NOW, r4p1Mk,
// r4p1ValidClaimInput, R4P1_SPEC) are reused verbatim — row (a)'s written
// claim and row (e)'s sensitive-day fixture are the SAME fixtures those
// R4P1 rows above already pin.
// ===========================================================================

// ---------------------------------------------------------------------------
describe('Matrix row: R4P2-a writer-dark-by-default', () => {
  beforeEach(wireClaimsFirestore);

  it('LLM_WRITER_ENABLED is false, a full pipeline run performs zero writeClaimWordingFn invocations, and the written wording is byte-equal to the Phase-1 deterministic template', async () => {
    const { generateClaims, LLM_WRITER_ENABLED } = await import('../services/insights/claims/claimsPipeline');
    const { listAllClaims } = await import('../services/insights/claims/claimsService');
    expect(LLM_WRITER_ENABLED).toBe(false);

    const expected = await r4p1ValidClaimInput(); // real evidenceBuilder run, same fixture

    // No llmWriterEnabled override passed — this is the production default path.
    const result = await generateClaims({}, 'u-r4p2a', r4p1Fixtures(R4P1_STRONG), { timeZone: 'UTC', now: R4P1_NOW });

    expect(result.written).toBe(1);
    expect(result.llmWordings).toBe(0);
    expect(writeClaimWordingFnMock).not.toHaveBeenCalled();

    const claims = await listAllClaims({}, 'u-r4p2a');
    expect(claims).toHaveLength(1);
    expect(claims[0].wording).toBe(expected.wording); // byte-equal to Phase-1's template output
    expect(claims[0].provenance.wordingSource).toBe('deterministic_template_v1');
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P2-b verifier-rejects-invention', () => {
  const bundle = {
    subject: 'gym', outcome: 'mood', direction: 'positive', claimType: 'pattern_to_watch',
    numbers: {
      exposedDayCount: 12, comparisonDayCount: 40, observedSpanDays: 60,
      effectMoodPoints: 7.2, hiddenSensitiveSourceCount: 0,
    },
    limitations: ['Same-day association only.'],
    excerpts: [],
    deterministicWording: 'On days you logged gym, your recorded mood averaged 7.2 points higher '
      + "(0-100 scale) than on days you didn't — 12 vs 40 days over 60 days.",
  };

  it('kills causal language ("boosts")', async () => {
    const { verifyDeterministic } = await import('../../functions/src/insights/claimVerifier.js');
    const result = verifyDeterministic('Going to the gym boosts your mood by 7.2 points.', bundle);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain('causal_language');
  });

  it('kills an unentailed number invented outside the bundle', async () => {
    const { verifyDeterministic } = await import('../../functions/src/insights/claimVerifier.js');
    const result = verifyDeterministic('On days you logged gym, your mood averaged 42 points higher.', bundle);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain('unentailed_numeral');
  });

  it('kills a direction flip — bundle direction is positive, wording claims lower', async () => {
    const { verifyDeterministic } = await import('../../functions/src/insights/claimVerifier.js');
    const result = verifyDeterministic('On days you logged gym, your mood was 7.2 points lower.', bundle);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain('direction_mismatch');
  });

  it('kills an oversized wording (over 320 chars / more than 2 sentences)', async () => {
    const { verifyDeterministic, MAX_WORDING_CHARS } = await import('../../functions/src/insights/claimVerifier.js');
    const oversized = 'On days you logged gym, your recorded mood ran higher. '.repeat(8);
    expect(oversized.length).toBeGreaterThan(MAX_WORDING_CHARS);
    const result = verifyDeterministic(oversized, bundle);
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain('too_long');
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P2-c verifier-fail-closed', () => {
  const bundle = {
    subject: 'gym', outcome: 'mood', direction: 'positive', claimType: 'pattern_to_watch',
    numbers: {
      exposedDayCount: 12, comparisonDayCount: 40, observedSpanDays: 60,
      effectMoodPoints: 7.2, hiddenSensitiveSourceCount: 0,
    },
    limitations: [],
    excerpts: [],
    deterministicWording: 'On days you logged gym, your recorded mood averaged 7.2 points higher '
      + "(0-100 scale) than on days you didn't — 12 vs 40 days over 60 days.",
  };
  const okWording = 'On days you logged gym, your recorded mood ran 7.2 points higher.';

  it('an explicit entailed:false verdict from the model fails', async () => {
    const { verifyWording } = await import('../../functions/src/insights/claimVerifier.js');
    const callModel = vi.fn(async () => JSON.stringify({ entailed: false, offending: 'x' }));
    const result = await verifyWording(okWording, bundle, { callModel });
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual(['llm_entailment_rejected']);
  });

  it('garbage (unparseable) model output fails closed', async () => {
    const { verifyWording } = await import('../../functions/src/insights/claimVerifier.js');
    const callModel = vi.fn(async () => 'not json at all');
    const result = await verifyWording(okWording, bundle, { callModel });
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual(['llm_entailment_rejected']);
  });

  it('a thrown/rejected model call fails closed', async () => {
    const { verifyWording } = await import('../../functions/src/insights/claimVerifier.js');
    const callModel = vi.fn(async () => { throw new Error('network down'); });
    const result = await verifyWording(okWording, bundle, { callModel });
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toEqual(['llm_entailment_rejected']);
  });

  it('composition requires BOTH layers: a deterministic rejection short-circuits before the model is ever called', async () => {
    const { verifyWording } = await import('../../functions/src/insights/claimVerifier.js');
    const callModel = vi.fn(async () => JSON.stringify({ entailed: true, offending: null }));
    const result = await verifyWording('Going to the gym boosts your mood.', bundle, { callModel });
    expect(result.verdict).toBe('fail');
    expect(result.reasons).toContain('causal_language');
    expect(callModel).not.toHaveBeenCalled();
  });

  it('composition passes only when BOTH layers pass', async () => {
    const { verifyWording } = await import('../../functions/src/insights/claimVerifier.js');
    const callModel = vi.fn(async () => JSON.stringify({ entailed: true, offending: null }));
    const result = await verifyWording(okWording, bundle, { callModel });
    expect(result.verdict).toBe('pass');
    expect(callModel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P2-d fallback-never-blocks', () => {
  beforeEach(wireClaimsFirestore);

  it('writer path forced ON with a REJECTING callable still writes the eligible claim with deterministic wording and llmWordings:0', async () => {
    writeClaimWordingFnMock.mockRejectedValueOnce(new Error('callable unavailable'));
    const { generateClaims } = await import('../services/insights/claims/claimsPipeline');
    const { listAllClaims } = await import('../services/insights/claims/claimsService');
    const expected = await r4p1ValidClaimInput();

    const result = await generateClaims(
      {}, 'u-r4p2d', r4p1Fixtures(R4P1_STRONG),
      { timeZone: 'UTC', now: R4P1_NOW, llmWriterEnabled: true },
    );

    expect(writeClaimWordingFnMock).toHaveBeenCalledTimes(1); // the writer path WAS attempted
    expect(result.written).toBe(1); // still written despite the failing callable
    expect(result.llmWordings).toBe(0); // fell back — never counted as an LLM wording

    const claims = await listAllClaims({}, 'u-r4p2d');
    expect(claims[0].wording).toBe(expected.wording); // deterministic wording, unchanged
    expect(claims[0].provenance.wordingSource).toBe('deterministic_template_v1');
  });

  it('a callable that resolves with verdict:"fail" ALSO falls back — every eligible claim is still written', async () => {
    writeClaimWordingFnMock.mockResolvedValueOnce({ data: { verdict: 'fail', wording: null, reasons: ['banned_phrase'] } });
    const { generateClaims } = await import('../services/insights/claims/claimsPipeline');
    const { listAllClaims } = await import('../services/insights/claims/claimsService');

    const result = await generateClaims(
      {}, 'u-r4p2d2', r4p1Fixtures(R4P1_STRONG),
      { timeZone: 'UTC', now: R4P1_NOW, llmWriterEnabled: true },
    );

    expect(result.written).toBe(1);
    expect(result.llmWordings).toBe(0);
    const claims = await listAllClaims({}, 'u-r4p2d2');
    expect(claims[0].provenance.wordingSource).toBe('deterministic_template_v1');
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P2-e no-sensitive-in-bundle', () => {
  it('a sensitive-day fixture: the writer bundle excerpts exclude the sensitive days while numbers.hiddenSensitiveSourceCount still counts them', async () => {
    const { buildDailyObservations } = await import('../services/insights/observations');
    const {
      freezeCandidatePlan, buildEvidenceForCandidate, buildWriterBundle,
    } = await import('../services/insights/claims/evidenceBuilder');

    // Same reconciliation fixture family as R4P1-e above, but marking the
    // LAST 2 days (2026-07-09/10 — the most recent of all 40, so they'd sort
    // into buildReceipt's top-8-by-recency sources/excerpts if sensitivity
    // filtering were broken) sensitive, rather than the first 2 — a stronger,
    // non-vacuous proof than marking days that recency capping alone would
    // already have excluded.
    const days = R4P1_STRONG.map((d, i, arr) => (i >= arr.length - 2 ? { ...d, sensitive: true } : d));
    const entries = r4p1Fixtures(days);
    const observations = buildDailyObservations(entries, { timeZone: 'UTC' });
    const entriesById = new Map(entries.map((e) => [e.id, e]));
    const plan = freezeCandidatePlan({
      familyId: 'basic:activity:mood', candidateId: 'tag:gym', exposureSpec: R4P1_SPEC,
      candidateTestsCount: 1, timeZone: 'UTC', now: R4P1_NOW,
    });
    const result = buildEvidenceForCandidate({
      observations, entriesById, exposureSpec: R4P1_SPEC, plan,
    });
    expect(result.eligible).toBe(true);
    expect(result.claimInput.evidence.hiddenSensitiveSourceCount).toBe(2); // stats include it

    const bundle = buildWriterBundle(result.claimInput);
    expect(bundle.numbers.hiddenSensitiveSourceCount).toBe(2); // stats include it
    expect(bundle.excerpts.length).toBeGreaterThan(0); // non-vacuous — visible excerpts DID make it through
    expect(bundle.excerpts.some((e) => e.date?.startsWith('2026-07-09') || e.date?.startsWith('2026-07-10'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P2-f experiment-result-claims', () => {
  const PLAN = {
    templateId: 'sleep-hours-mood-same-day',
    lag: 0,
    exposure: { source: 'health', field: 'sleepHours', label: 'sleep hours' },
    outcome: { field: 'analysis.mood_score', label: 'mood', unit: 'mood_0_100' },
    minPairedObservations: 10,
    coverageFloor: 0.5,
    whatThisDoesNotProve: ['This does not show that sleep hours caused the change in mood.'],
    timezone: 'UTC',
    hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day',
  };
  function r4p2fExperiment(overrides = {}) {
    return {
      question: 'Does sleep affect my mood?', analysisPlan: PLAN, durationDays: 14,
      createdAt: '2026-07-01T00:00:00.000Z', ...overrides,
    };
  }
  function r4p2fOkResult(overrides = {}) {
    return {
      status: 'ok',
      estimate: {
        delta: 10, ci: [4, 16], n: 20, nHigh: 10, nLow: 10, splitThreshold: 7,
        exposureContrast: 2.5, stability: { signConsistent: true },
      },
      coverage: {
        exposure: { covered: 20, total: 20, label: '20 of 20 days' },
        outcome: { covered: 20, total: 20, label: '20 of 20 days' },
      },
      receipt: {
        sources: [{ entryId: 'e1', date: '2026-07-10T00:00:00.000Z', excerpt: 'slept well' }],
        scope: null,
        timeWindow: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-20T00:00:00.000Z' },
        sampleSize: 20,
        missingness: 'Exposure: 20 of 20 days. Outcome: 20 of 20 days.',
      },
      sensitiveObservationCount: 1,
      narrative: {
        summary: 'On days with more sleep hours than usual, mood averaged 10.0 points (0-100) higher than on '
          + 'days with less. This is an association, not proof that one caused the other.',
      },
      ...overrides,
    };
  }

  it('an "ok" result maps to a valid, non-causal experiment_result claim (buildClaim-validated end to end)', async () => {
    const { buildExperimentResultClaim } = await import('../services/experiments/experimentClaim');
    const { buildClaim, CAUSAL_RE } = await import('../services/insights/claims/claimSchema');
    const claimInput = buildExperimentResultClaim({
      experiment: r4p2fExperiment(), experimentId: 'exp-1', result: r4p2fOkResult(), now: '2026-07-22T12:00:00.000Z',
    });
    expect(claimInput.claimType).toBe('experiment_result');
    expect(claimInput.direction).toBe('positive');
    expect(claimInput.subject).toBe('sleep hours');
    expect(CAUSAL_RE.test(claimInput.wording)).toBe(false);
    expect(() => buildClaim(claimInput)).not.toThrow(); // schema-valid end to end
  });

  it('an insufficient result maps to null — insufficiency is never a claim', async () => {
    const { buildExperimentResultClaim } = await import('../services/experiments/experimentClaim');
    const claimInput = buildExperimentResultClaim({
      experiment: r4p2fExperiment(), experimentId: 'exp-1',
      result: { status: 'insufficient', reasons: ['below_minimum_paired'] },
      now: '2026-07-22T12:00:00.000Z',
    });
    expect(claimInput).toBeNull();
  });

  it('an adjusted (post-exclusion) recomputation supersedes the original claim: v2, parentClaimId links v1, old claim marked superseded', async () => {
    await wireClaimsFirestore();
    const { buildExperimentResultClaim } = await import('../services/experiments/experimentClaim');
    const { writeClaim, supersedeClaim, listAllClaims } = await import('../services/insights/claims/claimsService');

    const originalInput = buildExperimentResultClaim({
      experiment: r4p2fExperiment(), experimentId: 'exp-1', result: r4p2fOkResult(), now: '2026-07-22T12:00:00.000Z',
    });
    const original = await writeClaim({}, 'u-r4p2f', originalInput);

    // Adjusted result: excluding one day nudges the estimate (still ok, still positive).
    const adjustedInput = buildExperimentResultClaim({
      experiment: r4p2fExperiment(), experimentId: 'exp-1',
      result: r4p2fOkResult({
        estimate: {
          delta: 13.5, ci: [5, 20], n: 18, nHigh: 9, nLow: 9, splitThreshold: 7,
          exposureContrast: 2.5, stability: { signConsistent: true },
        },
      }),
      now: '2026-07-25T09:00:00.000Z',
    });
    const superseding = await supersedeClaim({}, 'u-r4p2f', original, {
      ...adjustedInput, version: original.version + 1, parentClaimId: original.id,
    });

    expect(superseding.version).toBe(2);
    expect(superseding.parentClaimId).toBe(original.id);
    expect(superseding.evidence.effectMoodPoints).toBe(13.5);

    const all = await listAllClaims({}, 'u-r4p2f');
    const originalAfter = all.find((c) => c.id === original.id);
    expect(originalAfter.supersededByClaimId).toBe(superseding.id);
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P2-g single-feed-swap', () => {
  const manyEntries = Array.from({ length: 6 }, (_, i) => ({
    id: `e${i}`, content: 'entry', createdAt: '2026-07-18T10:00:00.000Z',
  }));
  // Real, sufficiency-clearing health fixture (same shape R4 row (e) above
  // pins for computeHealthMoodCorrelations) — left to run through the REAL
  // healthCorrelations.js (not mocked, see this section's header comment)
  // so "Correlations stays present" is proven against genuine correlation
  // math, not a canned return value.
  const HEALTH_DAY_MS = 24 * 60 * 60 * 1000;
  const healthNow = Date.parse('2026-07-21T12:00:00.000Z');
  const healthEntries = [
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `good-${i}`, createdAt: new Date(healthNow - i * HEALTH_DAY_MS).toISOString(),
      analysis: { mood_score: 0.8 }, healthContext: { sleep: { totalHours: 8 } },
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `poor-${i}`, createdAt: new Date(healthNow - (i + 10) * HEALTH_DAY_MS).toISOString(),
      analysis: { mood_score: 0.3 }, healthContext: { sleep: { totalHours: 5 } },
    })),
  ];

  beforeEach(async () => {
    await wireClaimsFirestore();
    const { getFlag } = await import('../config/flags');
    getFlag.mockReset();
    useNexusInsightsMock.mockReset();
    useBasicInsightsMock.mockReset();
    getTodayRecommendationsMock.mockReset().mockResolvedValue(null);
    useBasicInsightsMock.mockReturnValue({
      insights: [{
        id: 'basic-1', category: 'activity', insight: 'Legacy basic insight text.',
        moodDelta: 5, strength: 'moderate', direction: 'positive', sampleSize: 10, entryIds: [],
      }],
      loading: false, generating: false, hasEnoughData: true, entriesNeeded: 0,
      regenerate: vi.fn(), lastGeneratedFormatted: null,
    });
  });

  it('flag ON: the unified ClaimFeed renders a REAL verified claim, AI Insights/Recommendations are absent, Correlations stays present', async () => {
    const { getFlag } = await import('../config/flags');
    getFlag.mockImplementation((name) => name === 'insightClaims');
    useNexusInsightsMock.mockReturnValue({
      insights: [{ id: 'nexus-1', type: 'pattern', title: 'Should never render', body: 'x', confidence: 0.9 }],
      insightCount: 1, isCalibrating: false, calibrationProgress: 0, loading: false, refreshing: false,
      error: null, dataStatus: null, refresh: vi.fn(), lastGenerated: null,
    });
    getTodayRecommendationsMock.mockResolvedValue({
      recommendations: [{ action: 'Take a walk', priority: 'medium', type: 'activity' }],
      basedOn: { entriesAnalyzed: 10, interventionsTracked: 0 },
    });

    const { writeClaim } = await import('../services/insights/claims/claimsService');
    const claimInput = await r4p1ValidClaimInput();
    await writeClaim({}, 'user-r4p2g', claimInput);

    const InsightsPage = (await import('../pages/InsightsPage')).default;
    render(React.createElement(InsightsPage, {
      entries: healthEntries, userId: 'user-r4p2g', user: { uid: 'user-r4p2g' },
    }));

    expect(await screen.findByText(claimInput.wording)).toBeTruthy(); // ClaimFeed rendered the real, Firestore-shaped claim
    expect(screen.queryByText('AI Insights')).toBeNull();
    expect(screen.queryByText('Should never render')).toBeNull();
    expect(screen.queryByText("Today's Recommendations")).toBeNull();
    expect(getTodayRecommendationsMock).not.toHaveBeenCalled(); // no dark Firestore read for a hidden section
    expect(useNexusInsightsMock).toHaveBeenCalledWith({ uid: 'user-r4p2g' }, expect.objectContaining({ enabled: false }));
    expect(screen.getByText('Your Patterns')).toBeTruthy(); // CorrelationsSection stays
  });

  it('flag OFF: the legacy tree renders untouched — AI Insights from useNexusInsights, no ClaimFeed group header, no live claim read', async () => {
    const { getFlag } = await import('../config/flags');
    getFlag.mockReturnValue(false);
    useNexusInsightsMock.mockReturnValue({
      insights: [{ id: 'nexus-1', type: 'pattern', title: 'Legacy nexus insight', body: 'On days you did X, mood ran higher.', confidence: 0.9 }],
      insightCount: 1, isCalibrating: false, calibrationProgress: 0, loading: false, refreshing: false,
      error: null, dataStatus: null, refresh: vi.fn(), lastGenerated: null,
    });
    const { getDocs } = await import('firebase/firestore');
    getDocs.mockClear();

    const InsightsPage = (await import('../pages/InsightsPage')).default;
    render(React.createElement(InsightsPage, {
      entries: manyEntries, userId: 'user-r4p2g-off', user: { uid: 'user-r4p2g-off' },
    }));

    expect(await screen.findByText('Legacy basic insight text.')).toBeTruthy();
    expect(screen.getByText('Legacy nexus insight')).toBeTruthy();
    expect(screen.queryByText(/pattern to watch$/i)).toBeNull(); // no ClaimFeed group-summary header
    expect(useNexusInsightsMock).toHaveBeenCalledWith({ uid: 'user-r4p2g-off' }, expect.objectContaining({ enabled: true }));
    expect(getDocs).not.toHaveBeenCalled(); // useClaims' internal flag gate — listActiveClaims never reads Firestore
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P2-h reports-claims-not-nexus-prose', () => {
  it('the premium narrative prompt sent to Gemini contains verified-claim wording and NEVER a Nexus insight summary', async () => {
    const { generatePremiumNarrative } = await import('../../functions/src/reports/narrative.js');
    const { callGemini } = await import('../../functions/src/shared/gemini.js');
    const { getModel } = await import('../../functions/src/models/registry.js');
    callGemini.mockReset().mockResolvedValue('Generated narrative text.');
    getModel.mockReset().mockResolvedValue('model-x');

    const claim = {
      id: 'c1', claimType: 'pattern_to_watch', status: 'verified', supersededByClaimId: null,
      wording: 'On days you logged gym, your recorded mood averaged 7 points higher.',
      limitations: ['Same-day association only, not causation.'],
      evidence: {
        exposedDayCount: 9, comparisonDayCount: 15, effectMoodPoints: 7.2, sourceEntryIds: ['e1', 'e2'],
      },
      createdAt: '2026-01-05T00:00:00.000Z',
    };
    const contextData = {
      entries: [{ id: 'e1', date: '2026-01-15', text: 'Test entry' }],
      analytics: {}, signals: { activeGoals: [], achievedGoals: [] },
      // A populated nexus fixture — P2-D6 removed the old nexusInsightLabel
      // seam that fed this prompt with unverified Nexus prose; its summary
      // must NEVER reach the premium prompt again.
      nexus: { patterns: [{ id: 'pattern_x', summary: 'NEXUS-SUMMARY-MUST-NEVER-APPEAR', title: 'Nexus Pattern' }] },
      health: {},
      claims: [claim],
    };

    await generatePremiumNarrative('monthly', contextData, 'test-key', { __fake: 'db' });

    expect(callGemini.mock.calls.length).toBeGreaterThan(0);
    for (const call of callGemini.mock.calls) {
      const userPrompt = call[2];
      expect(userPrompt).toContain(claim.wording);
      expect(userPrompt).not.toContain('NEXUS-SUMMARY-MUST-NEVER-APPEAR');
    }
  });
});

// ---------------------------------------------------------------------------
describe('Matrix row: R4P2-i askjournal-claims-block', () => {
  beforeEach(async () => {
    await wireClaimsFirestore();
    const { getFlag } = await import('../config/flags');
    getFlag.mockReset();
    authMock.currentUser = null;
    askJournalAIFn.mockReset();
    askJournalAIFn.mockResolvedValue({ data: { response: 'answer' } });
  });

  it('flag ON: context is PREPENDED with a capped (5), verified-only VERIFIED PATTERNS block — a candidate-status claim is excluded even though listActiveClaims itself would include it', async () => {
    const { getFlag } = await import('../config/flags');
    getFlag.mockImplementation((name) => name === 'insightClaims');
    authMock.currentUser = { uid: 'user-r4p2i' };

    const { writeClaim } = await import('../services/insights/claims/claimsService');
    const base = await r4p1ValidClaimInput();
    // 6 verified claims (one over the 5-cap) + 1 candidate-status claim that
    // listActiveClaims WOULD surface (verified OR candidate) but
    // buildVerifiedPatternsBlock's own re-filter must still exclude.
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      await writeClaim({}, 'user-r4p2i', {
        ...base,
        version: 1,
        parentClaimId: null,
        analysisPlan: { ...base.analysisPlan, candidateId: `tag:thing${i}` },
        wording: `Claim wording number ${i}.`,
      });
    }
    await writeClaim({}, 'user-r4p2i', {
      ...base,
      version: 1,
      parentClaimId: null,
      status: 'candidate',
      analysisPlan: { ...base.analysisPlan, candidateId: 'tag:candidateonly' },
      wording: 'A candidate-status claim that must never reach the prompt.',
    });

    const { askJournalAI } = await import('../services/analysis/index.js');
    await askJournalAI([], 'What patterns hold up?', null, null);

    const [call] = askJournalAIFn.mock.calls;
    const context = call[0].entriesContext;
    expect(context.startsWith('VERIFIED PATTERNS')).toBe(true); // prepended, not appended
    expect(context).not.toContain('candidate-status claim that must never reach the prompt'); // verified-only re-filter
    const mentionedCount = (context.match(/Claim wording number/g) || []).length;
    expect(mentionedCount).toBe(5); // capped at 5
  });

  it('flag OFF: no VERIFIED PATTERNS block ever appears in the prompt context', async () => {
    const { getFlag } = await import('../config/flags');
    getFlag.mockReturnValue(false);
    authMock.currentUser = { uid: 'user-r4p2i-off' };

    const { askJournalAI } = await import('../services/analysis/index.js');
    await askJournalAI([], 'What patterns hold up?', null, null);

    const [call] = askJournalAIFn.mock.calls;
    expect(call[0].entriesContext).not.toContain('VERIFIED PATTERNS');
  });

  it('a claims-load failure is CONTAINED — askJournalAI still succeeds using the plain entries context, no VERIFIED PATTERNS block', async () => {
    const { getFlag } = await import('../config/flags');
    getFlag.mockImplementation((name) => name === 'insightClaims');
    authMock.currentUser = { uid: 'user-r4p2i-fail' };
    const { getDocs } = await import('firebase/firestore');
    getDocs.mockImplementationOnce(async () => { throw new Error('firestore down'); });

    const { askJournalAI } = await import('../services/analysis/index.js');
    const response = await askJournalAI([], 'What patterns hold up?', null, null);

    expect(response).toBe('answer'); // askJournalAIFn still resolves normally
    const [call] = askJournalAIFn.mock.calls;
    expect(call[0].entriesContext).not.toContain('VERIFIED PATTERNS');
  });
});
