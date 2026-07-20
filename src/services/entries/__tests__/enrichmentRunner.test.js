import { describe, it, expect, vi } from 'vitest';
import { runPostSaveEnrichment } from '../enrichmentRunner';

const CAPTURED_AT = '2026-07-20T10:00:00.000Z';

const makeEntryData = (overrides = {}) => ({
  userId: 'user-1',
  text: 'went to the gym yesterday',
  createdOnPlatform: 'web',
  capturedAt: CAPTURED_AT,
  enrichment: { status: 'pending', requestedAt: '2026-07-20T09:59:59.000Z' },
  ...overrides,
});

const makeDeps = (overrides = {}) => ({
  getEntryHealthContext: vi.fn().mockResolvedValue(null),
  getEntryEnvironmentContext: vi.fn().mockResolvedValue(null),
  getCurrentLocation: vi.fn().mockResolvedValue(null),
  detectTemporalContext: vi.fn().mockResolvedValue({ detected: false }),
  performLocalAnalysis: vi.fn(),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  recordStage: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('runPostSaveEnrichment', () => {
  it('only ever updateDocs the existing ref — it never creates the entry', async () => {
    const deps = makeDeps();
    const entryRef = { id: 'entry-1' };
    await runPostSaveEnrichment({ entryRef, entryData: makeEntryData(), captureContext: {}, deps });

    // Runner has no addDoc capability; the sole persistence call is updateDoc
    // against the ref that already exists.
    expect(deps.updateDoc).toHaveBeenCalledTimes(1);
    expect(deps.updateDoc.mock.calls[0][0]).toBe(entryRef);
  });

  it('marks enrichment complete and stamps version/timestamps when all groups succeed', async () => {
    const deps = makeDeps({
      getEntryHealthContext: vi.fn().mockResolvedValue({ source: 'whoop' }),
      getEntryEnvironmentContext: vi.fn().mockResolvedValue({ weather: 'clear', temperature: 20 }),
    });
    await runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData(), deps });

    const written = deps.updateDoc.mock.calls[0][1];
    expect(written.enrichment.status).toBe('complete');
    expect(written.enrichment.enrichmentVersion).toBe(1);
    expect(typeof written.enrichment.enrichedAt).toBe('string');
    expect(written.enrichment.requestedAt).toBe('2026-07-20T09:59:59.000Z');
    expect(written.enrichment).not.toHaveProperty('reasons');
    expect(written.healthContext).toEqual({ source: 'whoop' });
  });

  it('derives weather against capturedAt: environmentContext.observedFor === capturedAt', async () => {
    const deps = makeDeps({
      getEntryEnvironmentContext: vi.fn().mockResolvedValue({ weather: 'rain', temperature: 12 }),
    });
    await runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData(), deps });

    const written = deps.updateDoc.mock.calls[0][1];
    expect(written.environmentContext.observedFor).toBe(CAPTURED_AT);
    expect(typeof written.environmentContext.fetchedAt).toBe('string');
    expect(written.environmentContext.weather).toBe('rain');
  });

  it('leaves the entry intact and marks status partial when temporal detection fails', async () => {
    const deps = makeDeps({
      detectTemporalContext: vi.fn().mockRejectedValue(new Error('gemini down')),
    });
    await runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData(), deps });

    const written = deps.updateDoc.mock.calls[0][1];
    expect(written.enrichment.status).toBe('partial');
    expect(written.enrichment.reasons.temporal).toBe('temporal_error');
    // Temporal failure must not fabricate temporal fields on the entry.
    expect(written).not.toHaveProperty('temporalContext');
    expect(written).not.toHaveProperty('futureMentions');
  });

  it('records a reason per failing group and keeps successful groups', async () => {
    const deps = makeDeps({
      getEntryHealthContext: vi.fn().mockRejectedValue(new Error('health boom')),
      getEntryEnvironmentContext: vi.fn().mockResolvedValue({ weather: 'clear' }),
    });
    await runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData(), deps });

    const written = deps.updateDoc.mock.calls[0][1];
    expect(written.enrichment.status).toBe('partial');
    expect(written.enrichment.reasons.health).toBe('health_error');
    expect(written).not.toHaveProperty('healthContext'); // absent, not null-stuffed
    expect(written.environmentContext.weather).toBe('clear'); // sibling group survives
  });

  it('writes temporal + future-mention fields with the legacy shape (Timestamp on future dates)', async () => {
    const target = new Date('2026-08-01T00:00:00.000Z');
    const deps = makeDeps({
      detectTemporalContext: vi.fn().mockResolvedValue({
        detected: true,
        reference: 'yesterday',
        originalPhrase: 'yesterday',
        confidence: 0.9,
        futureMentions: [
          { targetDate: target, event: 'dentist', sentiment: 'neutral', phrase: 'next week', confidence: 0.8 },
        ],
      }),
    });
    await runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData(), deps });

    const written = deps.updateDoc.mock.calls[0][1];
    expect(written.temporalContext).toMatchObject({
      detected: true,
      reference: 'yesterday',
      confidence: 0.9,
      backdated: false,
    });
    expect(written.futureMentions).toHaveLength(1);
    // targetDate mapped through Timestamp.fromDate — a Firestore Timestamp.
    expect(typeof written.futureMentions[0].targetDate.toDate).toBe('function');
    expect(written.futureMentions[0].targetDate.toDate().toISOString()).toBe(target.toISOString());
    expect(written.futureMentions[0].isRecurring).toBe(false);
    expect(written.futureMentions[0].recurringPattern).toBe(null);
  });

  it('persists native local analysis but not on web', async () => {
    const la = { entry_type: 'reflection', mood_score: 0.6, local_analysis_time_ms: 3 };

    const webDeps = makeDeps({ performLocalAnalysis: vi.fn().mockReturnValue(la) });
    await runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData({ createdOnPlatform: 'web' }), deps: webDeps });
    expect(webDeps.updateDoc.mock.calls[0][1]).not.toHaveProperty('localAnalysis');
    expect(webDeps.performLocalAnalysis).not.toHaveBeenCalled();

    const iosDeps = makeDeps({ performLocalAnalysis: vi.fn().mockReturnValue(la) });
    await runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData({ createdOnPlatform: 'ios' }), deps: iosDeps });
    const written = iosDeps.updateDoc.mock.calls[0][1];
    expect(written.hasLocalAnalysis).toBe(true);
    expect(written.localAnalysis.entry_type).toBe('reflection');
    // It must NOT clobber the server-owned authoritative fields.
    expect(written).not.toHaveProperty('entry_type');
    expect(written).not.toHaveProperty('title');
    expect(written).not.toHaveProperty('analysis');
  });

  it('prefers the pre-save coarseLocation snapshot for location provenance', async () => {
    const deps = makeDeps();
    const coarseLocation = { latitude: 37.76, longitude: -122.43, accuracy: 50, cached: true };
    await runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData(), captureContext: { coarseLocation }, deps });

    const written = deps.updateDoc.mock.calls[0][1];
    expect(written.location).toEqual({ latitude: 37.76, longitude: -122.43, accuracy: 50, cached: true });
    // coarse snapshot present → no fresh retry needed
    expect(deps.getCurrentLocation).not.toHaveBeenCalled();
  });

  it('retries a fresh location when the coarse snapshot timed out (null)', async () => {
    const deps = makeDeps({
      getCurrentLocation: vi.fn().mockResolvedValue({ latitude: 1, longitude: 2, accuracy: 10 }),
    });
    await runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData(), captureContext: { coarseLocation: null }, deps });

    expect(deps.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(deps.updateDoc.mock.calls[0][1].location).toMatchObject({ latitude: 1, longitude: 2 });
  });

  it('emits enrich_start and enrich_end stage telemetry with a duration', async () => {
    const deps = makeDeps();
    await runPostSaveEnrichment({ entryRef: { id: 'entry-9' }, entryData: makeEntryData({ operationId: 'op-9' }), deps });

    const stages = deps.recordStage.mock.calls.map((c) => c[2]);
    expect(stages).toContain('enrich_start');
    expect(stages).toContain('enrich_end');
    // operationId is used as the telemetry key when present.
    expect(deps.recordStage.mock.calls[0][1]).toBe('op-9');
    const endCall = deps.recordStage.mock.calls.find((c) => c[2] === 'enrich_end');
    expect(typeof endCall[3].durationMs).toBe('number');
  });

  it('never throws even if updateDoc rejects', async () => {
    const deps = makeDeps({ updateDoc: vi.fn().mockRejectedValue(new Error('firestore down')) });
    await expect(
      runPostSaveEnrichment({ entryRef: { id: 'e' }, entryData: makeEntryData(), deps })
    ).resolves.toBeUndefined();
  });
});
