import { describe, it, expect } from 'vitest';
import { buildCoreEntry } from '../buildCoreEntry';

const baseArgs = (overrides = {}) => ({
  text: 'A durable thought',
  category: 'reflection',
  user: { uid: 'user-1' },
  consentSnapshot: { aiProcessingConsent: true },
  captureContext: {
    capturedAt: '2026-07-20T10:00:00.000Z',
    captureTimezone: 'America/Los_Angeles',
    coarseLocation: { latitude: 37.76, longitude: -122.43 },
  },
  safety: { safetyFlagged: false, hasWarning: false },
  platform: 'web',
  ...overrides,
});

describe('buildCoreEntry', () => {
  it('stamps capture-time provenance (capturedAt + IANA timezone + entryInputVersion)', () => {
    const entry = buildCoreEntry(baseArgs());
    expect(entry.capturedAt).toBe('2026-07-20T10:00:00.000Z');
    expect(entry.captureTimezone).toBe('America/Los_Angeles');
    expect(entry.entryInputVersion).toBe(1);
  });

  it('falls back to the runtime IANA timezone when none supplied', () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const entry = buildCoreEntry(baseArgs({ captureContext: { capturedAt: '2026-07-20T10:00:00.000Z' } }));
    expect(typeof entry.captureTimezone).toBe('string');
    expect(entry.captureTimezone).toBe(expected);
    expect(entry.captureTimezone.length).toBeGreaterThan(0);
  });

  it('carries a pending enrichment envelope with a requestedAt timestamp', () => {
    const entry = buildCoreEntry(baseArgs());
    expect(entry.enrichment.status).toBe('pending');
    expect(typeof entry.enrichment.requestedAt).toBe('string');
    expect(Number.isNaN(Date.parse(entry.enrichment.requestedAt))).toBe(false);
  });

  it('never places any optional enrichment field on the core object', () => {
    const entry = buildCoreEntry(baseArgs());
    for (const field of [
      'healthContext',
      'location',
      'environmentContext',
      'localAnalysis',
      'temporalContext',
      'futureMentions',
      'coarseLocation',
    ]) {
      expect(entry).not.toHaveProperty(field);
    }
  });

  it("honors a 'disabled' consent snapshot (analysisStatus disabled, consent false)", () => {
    const entry = buildCoreEntry(baseArgs({ consentSnapshot: { aiProcessingConsent: false } }));
    expect(entry.aiProcessingConsent).toBe(false);
    expect(entry.analysisStatus).toBe('disabled');
  });

  it("defaults to 'pending' analysis when consent is granted", () => {
    const entry = buildCoreEntry(baseArgs());
    expect(entry.aiProcessingConsent).toBe(true);
    expect(entry.analysisStatus).toBe('pending');
  });

  it('accepts a bare boolean consent snapshot', () => {
    expect(buildCoreEntry(baseArgs({ consentSnapshot: false })).analysisStatus).toBe('disabled');
    expect(buildCoreEntry(baseArgs({ consentSnapshot: true })).analysisStatus).toBe('pending');
  });

  it('applies voiceMoodScore only when voice confidence >= 0.6', () => {
    const high = buildCoreEntry(baseArgs({ voiceTone: { moodScore: 0.8, confidence: 0.6 } }));
    expect(high.voiceMoodScore).toBe(0.8);
    expect(high.voiceTone.moodScore).toBe(0.8);

    const low = buildCoreEntry(baseArgs({ voiceTone: { moodScore: 0.8, confidence: 0.59 } }));
    expect(low).not.toHaveProperty('voiceMoodScore');
    expect(low.voiceTone.moodScore).toBe(0.8); // voiceTone object still stored
  });

  it('leaves absent optionals absent (no null-stuffing)', () => {
    const entry = buildCoreEntry(baseArgs({ category: undefined, voiceTone: null, transcription: null }));
    expect(entry).not.toHaveProperty('category');
    expect(entry).not.toHaveProperty('voiceTone');
    expect(entry).not.toHaveProperty('voiceMoodScore');
    expect(entry).not.toHaveProperty('transcription');
    expect(entry).not.toHaveProperty('safety_flagged');
    expect(entry).not.toHaveProperty('has_warning_indicators');
    expect(entry).not.toHaveProperty('operationId');
    expect(entry).not.toHaveProperty('spaceId');
  });

  it('builds the versioned transcription shape when a raw transcript is supplied', () => {
    const entry = buildCoreEntry(baseArgs({ transcription: { rawTranscript: 'raw words' } }));
    expect(entry.transcription).toEqual({
      rawTranscript: 'raw words',
      cleanedTranscript: 'A durable thought',
      schemaVersion: 1,
      correctedByUser: false,
    });
  });

  it('flags needsHealthContext for web and clears it for native', () => {
    expect(buildCoreEntry(baseArgs({ platform: 'web' })).needsHealthContext).toBe(true);
    expect(buildCoreEntry(baseArgs({ platform: 'ios' })).needsHealthContext).toBe(false);
    expect(buildCoreEntry(baseArgs({ platform: 'android' })).needsHealthContext).toBe(false);
  });

  it('records safety fields (text-derived) when flagged', () => {
    const entry = buildCoreEntry(baseArgs({
      safety: { safetyFlagged: true, safetyUserResponse: 'support', hasWarning: true },
    }));
    expect(entry.safety_flagged).toBe(true);
    expect(entry.safety_user_response).toBe('support');
    expect(entry.has_warning_indicators).toBe(true);
  });

  it('includes operationId only when provided', () => {
    expect(buildCoreEntry(baseArgs({ operationId: 'op-123' })).operationId).toBe('op-123');
    expect(buildCoreEntry(baseArgs())).not.toHaveProperty('operationId');
  });

  it('includes spaceId only when a non-null space is passed', () => {
    expect(buildCoreEntry(baseArgs({ spaceId: 'space-9' })).spaceId).toBe('space-9');
    expect(buildCoreEntry(baseArgs())).not.toHaveProperty('spaceId');
    expect(buildCoreEntry(baseArgs({ spaceId: null }))).not.toHaveProperty('spaceId');
    expect(buildCoreEntry(baseArgs({ spaceId: undefined }))).not.toHaveProperty('spaceId');
  });

  it('sets the invariant core fields (userId, versions, platform, Firestore timestamps)', () => {
    const entry = buildCoreEntry(baseArgs({ platform: 'ios' }));
    expect(entry.userId).toBe('user-1');
    expect(entry.signalExtractionVersion).toBe(1);
    expect(entry.createdOnPlatform).toBe('ios');
    expect(typeof entry.createdAt.toDate).toBe('function'); // Firestore Timestamp
    expect(typeof entry.effectiveDate.toDate).toBe('function');
  });
});
