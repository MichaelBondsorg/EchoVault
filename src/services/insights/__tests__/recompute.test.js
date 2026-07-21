/**
 * Recompute / staleness fan-out tests (R2 Task 10).
 *
 * PRD acceptance: "stale within 10 seconds" — every write onSourcesChanged
 * triggers is an immediate, awaited Firestore write (no debounce/queue).
 * Uses fake timers to prove nothing here is scheduled/deferred.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const markInsightsStale = vi.fn(async () => {});
vi.mock('../../nexus/staleness', () => ({
  markInsightsStale: (...a) => markInsightsStale(...a),
}));

const invalidateDailySummary = vi.fn(async () => {});
const invalidateWeeklyDigest = vi.fn(async () => {});
vi.mock('../../dashboard', () => ({
  invalidateDailySummary: (...a) => invalidateDailySummary(...a),
  invalidateWeeklyDigest: (...a) => invalidateWeeklyDigest(...a),
}));

const { onSourcesChanged } = await import('../recompute.js');

const db = {};
const UID = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('onSourcesChanged', () => {
  it('marks Nexus insights stale', async () => {
    await onSourcesChanged(db, UID);
    expect(markInsightsStale).toHaveBeenCalledWith(UID);
  });

  it('invalidates today\'s dashboard cache for BOTH categories (personal + work)', async () => {
    await onSourcesChanged(db, UID);
    expect(invalidateDailySummary).toHaveBeenCalledWith(UID, 'personal', expect.any(Date));
    expect(invalidateDailySummary).toHaveBeenCalledWith(UID, 'work', expect.any(Date));
    expect(invalidateDailySummary).toHaveBeenCalledTimes(2);
  });

  it('invalidates the weekly digest for BOTH categories', async () => {
    await onSourcesChanged(db, UID);
    expect(invalidateWeeklyDigest).toHaveBeenCalledWith(UID, 'personal', expect.any(Date));
    expect(invalidateWeeklyDigest).toHaveBeenCalledWith(UID, 'work', expect.any(Date));
    expect(invalidateWeeklyDigest).toHaveBeenCalledTimes(2);
  });

  it('all three fan-outs are awaited before onSourcesChanged resolves — no debounce', async () => {
    let staleDone = false;
    let dailyDone = false;
    let weeklyDone = false;
    markInsightsStale.mockImplementationOnce(async () => { staleDone = true; });
    invalidateDailySummary.mockImplementation(async () => { dailyDone = true; });
    invalidateWeeklyDigest.mockImplementation(async () => { weeklyDone = true; });

    await onSourcesChanged(db, UID);

    expect(staleDone).toBe(true);
    expect(dailyDone).toBe(true);
    expect(weeklyDone).toBe(true);
  });
});

describe('onSourcesChanged — fake timers (PRD: stale within 10 seconds)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves without advancing the clock at all — every write is immediate, not scheduled', async () => {
    const promise = onSourcesChanged(db, UID);
    // Flush microtasks without advancing any real or fake timer.
    await Promise.resolve();
    await Promise.resolve();
    await promise;
    expect(markInsightsStale).toHaveBeenCalledTimes(1);
  });
});
