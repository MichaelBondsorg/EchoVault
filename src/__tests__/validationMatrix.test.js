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
vi.mock('../config/firebase', () => ({
  revokeAiProcessingFn: (...args) => revokeAiProcessingFn(...args),
  grantAiProcessingFn: (...args) => grantAiProcessingFn(...args),
  askJournalAIFn: (...args) => askJournalAIFn(...args),
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
// never touches a real provider callable.
vi.mock('../services/ai/gemini', () => ({ analyzeJournalEntryCloud: vi.fn() }));

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
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  deleteField: vi.fn(() => ({ __op: 'deleteField' })),
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
vi.mock('../services/nexus/layer3/beliefDissonance', () => ({
  extractBeliefsFromEntry: vi.fn(() => []),
  refineBeliefsWithLLM: vi.fn(async () => []),
  validateBeliefAgainstData: vi.fn(async () => ({ dissonanceScore: 0 })),
  generateDissonanceInsight: vi.fn(async () => null),
  saveBeliefs: vi.fn(async () => {}),
  getBeliefs: vi.fn(async () => []),
}));
vi.mock('../services/nexus/layer3/counterfactual', () => ({
  identifyMissingInterventions: vi.fn(() => []),
  generateCounterfactualInsight: vi.fn(async () => null),
  findGoodDayActivities: vi.fn(() => []),
}));
vi.mock('../services/nexus/layer4/interventionTracker', () => ({
  updateInterventionData: vi.fn(async () => {}),
  getInterventionData: vi.fn(async () => ({})),
}));
vi.mock('../services/nexus/layer4/recommendationEngine', () => ({ generateRecommendations: vi.fn(async () => []) }));

// Row (a)/(b) also need a controllable `getExcludedEntryIds` (R2 Task 10) —
// mirrors orchestrator.exclusions.test.js's approach: no exclusions by
// default, overridden per-test via mockResolvedValueOnce.
const getExcludedEntryIdsMock = vi.fn(async () => new Set());
vi.mock('../services/insights/sourceExclusions', () => ({
  getExcludedEntryIds: (...args) => getExcludedEntryIdsMock(...args),
}));

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
  function buildFixtureEntries() {
    const now = Date.parse('2026-07-21T12:00:00.000Z');
    const entries = [];
    for (let i = 0; i < 4; i++) {
      entries.push({
        id: `interview-${i}`,
        createdAt: new Date(now - i * DAY_MS).toISOString(),
        text: `Had another interview today, feeling good about it. Entry number ${i}.`,
        analysis: { mood_score: 80 },
      });
    }
    for (let i = 0; i < 4; i++) {
      entries.push({
        id: `yoga-${i}`,
        createdAt: new Date(now - (i + 4) * DAY_MS).toISOString(),
        text: `Did yoga this morning, feeling solid. Entry number ${i}.`,
        analysis: { mood_score: 85 },
      });
    }
    for (let i = 0; i < 4; i++) {
      entries.push({
        id: `neutral-${i}`,
        createdAt: new Date(now - (i + 8) * DAY_MS).toISOString(),
        text: `A regular day. Nothing special. Entry number ${i}.`,
        analysis: { mood_score: 50 },
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
  function buildAdversarialEntries() {
    const now = Date.parse('2026-07-21T12:00:00.000Z');
    const entries = [
      {
        id: 'yoga-excluded',
        createdAt: new Date(now).toISOString(),
        text: 'Mentioned yoga in passing, a totally average day otherwise.',
        analysis: { mood_score: 50 },
      },
    ];
    for (let i = 0; i < 3; i++) {
      entries.push({
        id: `yoga-${i}`,
        createdAt: new Date(now - (i + 1) * DAY_MS).toISOString(),
        text: `Did yoga this morning, feeling solid and strong. Entry number ${i}.`,
        analysis: { mood_score: 65 },
      });
    }
    for (let i = 0; i < 8; i++) {
      entries.push({
        id: `neutral-${i}`,
        createdAt: new Date(now - (i + 4) * DAY_MS).toISOString(),
        text: `A regular day. Nothing special. Entry number ${i}.`,
        analysis: { mood_score: 50 },
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
        analysis: { mood_score: 0.6 },
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
    // preferred-but-not-maximal 0.5 threshold), proves the adversarial
    // entries were structurally filtered — not merely outscored.
    const safeControl = baseEntry({ id: 'the-only-safe-one', createdAt: daysAgo(180), analysis: { mood_score: 0.5 } });
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

function r3BaseExperiment({ template, params = {}, startAt, endAt, durationDays, excludedObservations = [], scope = null }) {
  return {
    id: 'r3-exp-test',
    question: 'test question',
    template: template.id,
    analysisPlan: r3AnalysisPlan(template, params),
    scope,
    status: 'running',
    startAt,
    endAt,
    durationDays,
    excludedObservations,
    createdAt: startAt,
    updatedAt: startAt,
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
        analysis: { mood_score: 50 + (i % 10) },
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
        analysis: { mood_score: 50 + i },
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
        analysis: { mood_score: 50 + i },
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
        analysis: { mood_score: 50 + i },
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
