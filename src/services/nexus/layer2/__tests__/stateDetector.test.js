/**
 * Tests for stateDetector.js duration tracking (R4 T2 — DR finding 9).
 *
 * Bug: durationDays incremented by 1 on every call to updateCurrentState
 * (once per analysis regeneration), regardless of how much real time had
 * passed — running analysis 5x in one minute made a state look 5 days old.
 * Fix: durationDays is derived from elapsed calendar days between the
 * state's startedAt timestamp and now (reusing src/utils/date.js's
 * daysBetween), so re-running analysis on the same day is idempotent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...args) => ({ __path: args.slice(1).join('/') })),
  getDoc: (...args) => mockGetDoc(...args),
  setDoc: (...args) => mockSetDoc(...args),
  Timestamp: {
    now: () => makeTimestamp(NOW_MS),
    fromMillis: (ms) => makeTimestamp(ms),
  },
}));
vi.mock('../../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../../config/constants', () => ({ APP_COLLECTION_ID: 'test-app' }));

import { updateCurrentState } from '../stateDetector';

let NOW_MS = Date.parse('2026-07-22T12:00:00Z');

function makeTimestamp(ms) {
  return {
    toMillis: () => ms,
    toDate: () => new Date(ms),
  };
}

function mockExistingDoc(data) {
  mockGetDoc.mockResolvedValue({
    exists: () => data != null,
    data: () => data,
  });
}

describe('stateDetector — date-based duration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    NOW_MS = Date.parse('2026-07-22T12:00:00Z');
  });

  it('starts a new state at durationDays 0 when the primary state changes', async () => {
    mockExistingDoc({
      currentState: { primary: 'stable', startedAt: makeTimestamp(NOW_MS - 5 * 86400000), durationDays: 5 },
      stateHistory: [],
    });

    await updateCurrentState('user-1', { primary: 'career_waiting', confidence: 0.8 });

    const written = mockSetDoc.mock.calls[0][1];
    expect(written.currentState.durationDays).toBe(0);
    expect(written.currentState.startedAt.toMillis()).toBe(NOW_MS);
  });

  it('does NOT grow durationDays on same-day regeneration (idempotence)', async () => {
    const startedAt = makeTimestamp(NOW_MS - 3 * 86400000); // state started 3 days ago
    mockExistingDoc({
      currentState: { primary: 'career_waiting', startedAt, durationDays: 3 },
      stateHistory: [],
    });

    // Regenerate 3 times within the same "now" (simulating rapid re-analysis).
    for (let i = 0; i < 3; i++) {
      await updateCurrentState('user-1', { primary: 'career_waiting', confidence: 0.8 });
      const written = mockSetDoc.mock.calls[mockSetDoc.mock.calls.length - 1][1];
      expect(written.currentState.durationDays).toBe(3);
      // Feed the same startedAt/durationDays back in for the next iteration,
      // as a real regeneration cycle would re-read what was just written.
      mockExistingDoc({
        currentState: { primary: 'career_waiting', startedAt, durationDays: written.currentState.durationDays },
        stateHistory: [],
      });
    }
  });

  it('grows durationDays by real elapsed calendar days, not call count', async () => {
    const startedAt = makeTimestamp(NOW_MS);
    mockExistingDoc({
      currentState: { primary: 'career_waiting', startedAt, durationDays: 0 },
      stateHistory: [],
    });

    // Advance the clock by 4 days, call updateCurrentState ONCE (not 4x).
    NOW_MS += 4 * 86400000;
    await updateCurrentState('user-1', { primary: 'career_waiting', confidence: 0.8 });

    const written = mockSetDoc.mock.calls[0][1];
    expect(written.currentState.durationDays).toBe(4);
  });

  it('preserves the original startedAt while the state is unchanged', async () => {
    const startedAt = makeTimestamp(NOW_MS - 2 * 86400000);
    mockExistingDoc({
      currentState: { primary: 'career_waiting', startedAt, durationDays: 2 },
      stateHistory: [],
    });

    await updateCurrentState('user-1', { primary: 'career_waiting', confidence: 0.8 });

    const written = mockSetDoc.mock.calls[0][1];
    expect(written.currentState.startedAt.toMillis()).toBe(startedAt.toMillis());
  });
});
