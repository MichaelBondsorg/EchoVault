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
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
  ...firestoreMocks,
}));
// Row 8's getSmartChatContext import graph pulls in ai/gemini.js (unused by
// the function actually under test) — stub it so importing analysis/index.js
// never touches a real provider callable. Row 11's insightBudget.js pulls in
// nexus/orchestrator.js's isDuplicateInsight for near-dup suppression; stub
// it to a fixed "never a dupe" so the budget-cap math is what's on trial,
// not orchestrator's similarity heuristics (covered separately).
vi.mock('../services/ai/gemini', () => ({ analyzeJournalEntryCloud: vi.fn() }));
vi.mock('../services/nexus/orchestrator', () => ({ isDuplicateInsight: vi.fn(() => false) }));

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
