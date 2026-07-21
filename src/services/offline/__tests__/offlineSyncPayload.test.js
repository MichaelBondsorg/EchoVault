import { describe, it, expect } from 'vitest';
import { buildOfflineSyncPayload } from '../offlineSyncPayload';

// This is the actual drain path: App.jsx's sync `saveEntry` closure calls
// buildOfflineSyncPayload(entryData) and passes the result straight to
// setDoc. These tests cover the payload shape that really reaches
// Firestore when an offline-queued entry syncs — unlike offlineManager.test.js's
// queueEntry -> buildCoreEntry composition, which exercises a different
// (core-first re-save) path buildCoreEntry is not on this one.
describe('buildOfflineSyncPayload', () => {
  const baseEntry = {
    text: 'queued offline thought',
    createdAt: '2026-07-21T09:00:00.000Z',
    effectiveDate: '2026-07-20T09:00:00.000Z',
  };

  it('includes spaceId when the entry was captured with a Context Space selected', () => {
    const payload = buildOfflineSyncPayload({ ...baseEntry, spaceId: 'space-9' });
    expect(payload.spaceId).toBe('space-9');
  });

  it('omits spaceId entirely (not null/undefined) when no space was selected', () => {
    const payload = buildOfflineSyncPayload({ ...baseEntry });
    expect(payload).not.toHaveProperty('spaceId');
  });

  it('omits spaceId when explicitly falsy (empty string / null)', () => {
    const payload = buildOfflineSyncPayload({ ...baseEntry, spaceId: null });
    expect(payload).not.toHaveProperty('spaceId');
  });

  it('passes text/createdAt/effectiveDate through untouched (as Firestore Timestamps)', () => {
    const payload = buildOfflineSyncPayload(baseEntry);
    expect(payload.text).toBe('queued offline thought');
    expect(payload.createdAt.toDate().toISOString()).toBe('2026-07-21T09:00:00.000Z');
    expect(payload.effectiveDate.toDate().toISOString()).toBe('2026-07-20T09:00:00.000Z');
  });

  it('defaults effectiveDate to createdAt when effectiveDate is absent', () => {
    const payload = buildOfflineSyncPayload({ text: 'hi', createdAt: '2026-07-21T09:00:00.000Z' });
    expect(payload.effectiveDate.toDate().toISOString()).toBe('2026-07-21T09:00:00.000Z');
  });

  it('sets analysisStatus/aiProcessingConsent based on consent, defaulting to pending/true', () => {
    const consented = buildOfflineSyncPayload(baseEntry);
    expect(consented.analysisStatus).toBe('pending');
    expect(consented.aiProcessingConsent).toBe(true);

    const revoked = buildOfflineSyncPayload({ ...baseEntry, aiProcessingConsent: false });
    expect(revoked.analysisStatus).toBe('disabled');
    expect(revoked.aiProcessingConsent).toBe(false);
  });

  it('matches the unscoped payload shape byte-for-byte (protects the no-null-stuffing convention)', () => {
    const payload = buildOfflineSyncPayload(baseEntry);
    const { createdAt, effectiveDate, ...rest } = payload;

    // Timestamps are asserted separately above; snapshot everything else so
    // any accidental null-stuffing or dropped/added key shows up as a diff.
    expect(rest).toEqual({
      text: 'queued offline thought',
      analysisStatus: 'pending',
      aiProcessingConsent: true,
      signalExtractionVersion: 1,
      syncedFromOffline: true,
    });
    expect(rest).not.toHaveProperty('spaceId');
    expect(rest).not.toHaveProperty('category');
    expect(rest).not.toHaveProperty('offlineId');
    expect(rest).not.toHaveProperty('createdOnPlatform');
  });

  it('preserves the other whitelisted conventions (category, platform, offlineId, etc.) when present', () => {
    const payload = buildOfflineSyncPayload({
      ...baseEntry,
      category: 'reflection',
      platform: 'ios',
      offlineId: 'offline-1',
      localAnalysis: { mood: 'calm' },
      healthContext: { steps: 100 },
      environmentContext: { weather: 'clear' },
      voiceTone: 'steady',
      transcription: 'transcribed text',
      safety_flagged: true,
      safety_user_response: 'im_safe',
      has_warning_indicators: true,
    });

    expect(payload.category).toBe('reflection');
    expect(payload.createdOnPlatform).toBe('ios');
    expect(payload.offlineId).toBe('offline-1');
    expect(payload.localAnalysis).toEqual({ mood: 'calm' });
    expect(payload.healthContext).toEqual({ steps: 100 });
    expect(payload.environmentContext).toEqual({ weather: 'clear' });
    expect(payload.voiceTone).toBe('steady');
    expect(payload.transcription).toBe('transcribed text');
    expect(payload.safety_flagged).toBe(true);
    expect(payload.safety_user_response).toBe('im_safe');
    expect(payload.has_warning_indicators).toBe(true);
  });
});
