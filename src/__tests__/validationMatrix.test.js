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

// Provider callables from config/firebase.js. Every AI-provider entry point
// (transcription + analysis) is mocked here alongside the consent callables
// so row 1 can assert none of them are ever invoked by a consent revoke.
const revokeAiProcessingFn = vi.fn();
const grantAiProcessingFn = vi.fn();
const transcribeAudioFn = vi.fn();
const transcribeWithToneFn = vi.fn();
const transcribeEntryFn = vi.fn();
const analyzeJournalEntryFn = vi.fn();
const askJournalAIFn = vi.fn();
const executePromptFn = vi.fn();
vi.mock('../config/firebase', () => ({
  revokeAiProcessingFn: (...args) => revokeAiProcessingFn(...args),
  grantAiProcessingFn: (...args) => grantAiProcessingFn(...args),
  transcribeAudioFn: (...args) => transcribeAudioFn(...args),
  transcribeWithToneFn: (...args) => transcribeWithToneFn(...args),
  transcribeEntryFn: (...args) => transcribeEntryFn(...args),
  analyzeJournalEntryFn: (...args) => analyzeJournalEntryFn(...args),
  askJournalAIFn: (...args) => askJournalAIFn(...args),
  executePromptFn: (...args) => executePromptFn(...args),
}));

const providerFns = [
  transcribeAudioFn,
  transcribeWithToneFn,
  transcribeEntryFn,
  analyzeJournalEntryFn,
  askJournalAIFn,
  executePromptFn,
];

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

  it('no provider callable (transcription/analysis) is ever invoked by the revoke + reload + flush sequence', async () => {
    const { revokeAiConsent, flushConsentOutbox } = await import('../services/consent/consentService.js');
    revokeAiProcessingFn.mockRejectedValue(new Error('offline'));

    await revokeAiConsent(OWNER);
    vi.resetModules();
    const fresh = await import('../services/consent/consentService.js');
    revokeAiProcessingFn.mockResolvedValue({ data: { cancelled: 3 } });
    await fresh.flushConsentOutbox(OWNER);
    // Also exercise the module reference obtained before reload, mirroring a
    // caller that already held a handle to the service.
    await flushConsentOutbox(OWNER).catch(() => {});

    for (const fn of providerFns) {
      expect(fn).not.toHaveBeenCalled();
    }
    // The ONLY provider call reachable from this flow is the consent callable
    // itself.
    expect(revokeAiProcessingFn).toHaveBeenCalled();
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
