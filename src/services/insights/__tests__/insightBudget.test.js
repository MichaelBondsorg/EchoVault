import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = {
  doc: vi.fn((...args) => ({ __doc: args.slice(1).join('/') })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  setDoc: vi.fn(async () => {}),
};

vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

// isDuplicateInsight is mocked so the boundary contract (adapter shape,
// call args) is asserted directly, rather than re-verifying orchestrator's
// own similarity math (already covered elsewhere). Default: never a dupe.
const isDuplicateInsight = vi.fn(() => false);
vi.mock('../../nexus/orchestrator', () => ({ isDuplicateInsight }));

const {
  getBudgetConfig,
  readBudgetMode,
  readShownLog,
  setBudgetMode,
  applyInsightBudget,
  recordShownInsights,
} = await import('../insightBudget.js');

const db = {};
const UID = 'user-1';
const SETTINGS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/settings';

const DAY_MS = 24 * 60 * 60 * 1000;
// Constructed via the local Date constructor (not a UTC ISO string) so that
// `isSameCalendarDay`'s local getFullYear/getMonth/getDate comparisons line
// up with the `daysAgo`/`hour` helpers below regardless of the machine's
// timezone.
const NOW = new Date(2026, 6, 20, 12, 0, 0).getTime();

function shownEntry({ id, title = 'Some insight', theme = null, daysAgo = 0, hour = 12 }) {
  const d = new Date(NOW - daysAgo * DAY_MS);
  d.setHours(hour, 0, 0, 0);
  return { id, title, theme, shownAt: d.toISOString() };
}

function insight({ id, title = 'New insight', confidence = 0.8, generatedAt = new Date(NOW).toISOString(), type = 'pattern' }) {
  return { id, title, confidence, generatedAt, type };
}

beforeEach(() => {
  vi.clearAllMocks();
  isDuplicateInsight.mockReturnValue(false);
  mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  mocks.setDoc.mockResolvedValue(undefined);
});

describe('getBudgetConfig', () => {
  it('returns the exact ceilings per mode', () => {
    expect(getBudgetConfig('quiet')).toEqual({ maxHomePerDay: 1, maxHomePerWeek: 4 });
    expect(getBudgetConfig('balanced')).toEqual({ maxHomePerDay: 2, maxHomePerWeek: 8 });
    expect(getBudgetConfig('exploratory')).toEqual({ maxHomePerDay: 4, maxHomePerWeek: 20 });
  });

  it('falls back to balanced for an unknown mode', () => {
    expect(getBudgetConfig('bogus')).toEqual({ maxHomePerDay: 2, maxHomePerWeek: 8 });
    expect(getBudgetConfig(undefined)).toEqual({ maxHomePerDay: 2, maxHomePerWeek: 8 });
  });
});

describe('readBudgetMode', () => {
  it('returns balanced when the doc does not exist', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const mode = await readBudgetMode(db, UID);
    expect(mocks.doc).toHaveBeenCalledWith(db, SETTINGS_PATH, 'insightBudget');
    expect(mode).toBe('balanced');
  });

  it('returns balanced when the doc exists but mode is missing', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ shownLog: [] }) });
    expect(await readBudgetMode(db, UID)).toBe('balanced');
  });

  it('returns balanced when mode is an invalid value', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ mode: 'chatty' }) });
    expect(await readBudgetMode(db, UID)).toBe('balanced');
  });

  it('returns the stored mode when valid', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ mode: 'quiet' }) });
    expect(await readBudgetMode(db, UID)).toBe('quiet');
  });
});

describe('readShownLog', () => {
  it('returns [] when the doc does not exist', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    expect(await readShownLog(db, UID)).toEqual([]);
  });

  it('returns [] when the doc exists but shownLog is missing', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ mode: 'quiet' }) });
    expect(await readShownLog(db, UID)).toEqual([]);
  });

  it('returns the stored log', async () => {
    const log = [shownEntry({ id: 'i1' })];
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ shownLog: log }) });
    expect(await readShownLog(db, UID)).toEqual(log);
  });
});

describe('setBudgetMode', () => {
  it.each(['quiet', 'balanced', 'exploratory'])('writes {mode, updatedAt} merged for mode=%s', async (mode) => {
    await setBudgetMode(db, UID, mode);
    expect(mocks.doc).toHaveBeenCalledWith(db, SETTINGS_PATH, 'insightBudget');
    const [, payload, options] = mocks.setDoc.mock.calls[0];
    expect(payload.mode).toBe(mode);
    expect(typeof payload.updatedAt).toBe('string');
    expect(Object.keys(payload).sort()).toEqual(['mode', 'updatedAt']);
    expect(options).toMatchObject({ merge: true });
  });

  it('rejects an invalid mode and never writes', async () => {
    await expect(setBudgetMode(db, UID, 'chatty')).rejects.toThrow(/invalid budget mode/i);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('rejects an empty/undefined mode and never writes', async () => {
    await expect(setBudgetMode(db, UID, undefined)).rejects.toThrow();
    await expect(setBudgetMode(db, UID, '')).rejects.toThrow();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});

describe('applyInsightBudget', () => {
  it('never pads: returns [] when insights is empty regardless of quota', () => {
    expect(applyInsightBudget([], { mode: 'exploratory', shownLog: [], now: NOW })).toEqual([]);
  });

  it('passes through up to the day cap for quiet mode (1/day) with an empty log', () => {
    const insights = [insight({ id: 'a' }), insight({ id: 'b' })];
    const result = applyInsightBudget(insights, { mode: 'quiet', shownLog: [], now: NOW });
    expect(result).toHaveLength(1);
  });

  it('passes through up to the day cap for balanced mode (2/day) with an empty log', () => {
    const insights = [insight({ id: 'a' }), insight({ id: 'b' }), insight({ id: 'c' })];
    const result = applyInsightBudget(insights, { mode: 'balanced', shownLog: [], now: NOW });
    expect(result).toHaveLength(2);
  });

  it('passes through up to the day cap for exploratory mode (4/day) with an empty log', () => {
    const insights = Array.from({ length: 6 }, (_, i) => insight({ id: `i${i}` }));
    const result = applyInsightBudget(insights, { mode: 'exploratory', shownLog: [], now: NOW });
    expect(result).toHaveLength(4);
  });

  it('caps to the week bound when it is tighter than the day cap (balanced: 2/day, 8/week)', () => {
    // 7 already shown this week, none today -> day allowance 2, week allowance 1 -> min = 1
    const shownLog = Array.from({ length: 7 }, (_, i) => shownEntry({ id: `old${i}`, daysAgo: 1 + i }));
    const insights = [insight({ id: 'a' }), insight({ id: 'b' })];
    const result = applyInsightBudget(insights, { mode: 'balanced', shownLog, now: NOW });
    expect(result).toHaveLength(1);
  });

  it('returns [] when the week quota is already exhausted even though the day quota has room', () => {
    // 8 entries within the last 7 days (daysAgo 1..7, with 7 repeated once)
    // exhausts balanced's 8/week cap while none are "today", so the 2/day
    // cap alone would still allow this insight through.
    const shownLog = Array.from({ length: 8 }, (_, i) => shownEntry({ id: `old${i}`, daysAgo: Math.min(1 + i, 7) }));
    const insights = [insight({ id: 'a' })];
    const result = applyInsightBudget(insights, { mode: 'balanced', shownLog, now: NOW });
    expect(result).toEqual([]);
  });

  it('returns [] when the day quota is already exhausted even though the week quota has room', () => {
    const shownLog = Array.from({ length: 2 }, (_, i) => shownEntry({ id: `today${i}`, daysAgo: 0, hour: 1 + i }));
    const insights = [insight({ id: 'a' })];
    const result = applyInsightBudget(insights, { mode: 'balanced', shownLog, now: NOW });
    expect(result).toEqual([]);
  });

  it('returns [] when nothing qualifies despite quota being available (all near-dupe, never widens caps to fill)', () => {
    isDuplicateInsight.mockReturnValue(true);
    const shownLog = [shownEntry({ id: 'old1' })];
    const insights = [insight({ id: 'a' }), insight({ id: 'b' })];
    const result = applyInsightBudget(insights, { mode: 'exploratory', shownLog, now: NOW });
    expect(result).toEqual([]);
  });

  it('drops insights near-duplicating a shownLog entry within 90 days, adapting entries to {title, summary: "", body: ""}', () => {
    const shownLog = [shownEntry({ id: 'old1', title: 'Sleep and mood', daysAgo: 10 })];
    isDuplicateInsight.mockImplementation((_new, existing) => existing.length > 0);
    const insights = [insight({ id: 'a' })];
    const result = applyInsightBudget(insights, { mode: 'exploratory', shownLog, now: NOW });

    expect(result).toEqual([]);
    expect(isDuplicateInsight).toHaveBeenCalledWith(
      insights[0],
      [{ title: 'Sleep and mood', summary: '', body: '' }],
    );
  });

  it('ignores shownLog entries older than 90 days for both dedup and quota counts', () => {
    const shownLog = [shownEntry({ id: 'ancient', daysAgo: 91 })];
    const insights = [insight({ id: 'a' })];

    applyInsightBudget(insights, { mode: 'exploratory', shownLog, now: NOW });
    // The stale entry must not even reach isDuplicateInsight's existing list.
    expect(isDuplicateInsight).toHaveBeenCalledWith(insights[0], []);

    // Quota: with the stale entry excluded, exploratory (4/day) is untouched.
    const result = applyInsightBudget(insights, { mode: 'exploratory', shownLog, now: NOW });
    expect(result).toHaveLength(1);
  });

  it('includes a shownLog entry exactly at the 90-day boundary', () => {
    const shownLog = [shownEntry({ id: 'boundary', daysAgo: 90, hour: 12 })];
    const insights = [insight({ id: 'a' })];
    applyInsightBudget(insights, { mode: 'exploratory', shownLog, now: NOW });
    expect(isDuplicateInsight).toHaveBeenCalledWith(insights[0], [{ title: 'Some insight', summary: '', body: '' }]);
  });

  it('sorts by confidence desc first', () => {
    const insights = [
      insight({ id: 'low', confidence: 0.3 }),
      insight({ id: 'high', confidence: 0.9 }),
      insight({ id: 'mid', confidence: 0.6 }),
    ];
    const result = applyInsightBudget(insights, { mode: 'exploratory', shownLog: [], now: NOW });
    expect(result.map((i) => i.id)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks confidence ties by recency (most recent first)', () => {
    const insights = [
      insight({ id: 'old', confidence: 0.7, generatedAt: new Date(NOW - 2 * DAY_MS).toISOString() }),
      insight({ id: 'new', confidence: 0.7, generatedAt: new Date(NOW - 1 * DAY_MS).toISOString() }),
      insight({ id: 'newest', confidence: 0.7, generatedAt: new Date(NOW).toISOString() }),
    ];
    const result = applyInsightBudget(insights, { mode: 'exploratory', shownLog: [], now: NOW });
    expect(result.map((i) => i.id)).toEqual(['newest', 'new', 'old']);
  });

  it('treats a missing confidence field as 0 (sorted last), not a crash', () => {
    const withConf = insight({ id: 'has-conf', confidence: 0.5 });
    const noConf = { id: 'no-conf', title: 'No confidence field', generatedAt: new Date(NOW).toISOString() };
    const result = applyInsightBudget([noConf, withConf], { mode: 'exploratory', shownLog: [], now: NOW });
    expect(result.map((i) => i.id)).toEqual(['has-conf', 'no-conf']);
  });
});

describe('recordShownInsights', () => {
  it('appends {id, theme, title, shownAt} only (no content bodies) via setDoc merge', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const shown = [insight({ id: 'a', title: 'A title' })];
    await recordShownInsights(db, UID, shown);

    expect(mocks.doc).toHaveBeenCalledWith(db, SETTINGS_PATH, 'insightBudget');
    const [, payload, options] = mocks.setDoc.mock.calls[0];
    expect(options).toMatchObject({ merge: true });
    expect(Object.keys(payload).sort()).toEqual(['shownLog', 'updatedAt']);
    expect(payload.shownLog).toHaveLength(1);
    const entry = payload.shownLog[0];
    expect(Object.keys(entry).sort()).toEqual(['id', 'shownAt', 'theme', 'title']);
    expect(entry.id).toBe('a');
    expect(entry.title).toBe('A title');
    expect(entry.theme).toBe('pattern'); // falls back to insight.type
    expect(typeof entry.shownAt).toBe('string');
  });

  it('does nothing (no read/write) when insights is empty', async () => {
    await recordShownInsights(db, UID, []);
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('skips insights without an id', async () => {
    await recordShownInsights(db, UID, [{ title: 'No id' }]);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('appends to an existing log rather than overwriting it', async () => {
    const existing = [shownEntry({ id: 'existing1' })];
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ shownLog: existing }) });
    await recordShownInsights(db, UID, [insight({ id: 'new1' })]);

    const [, payload] = mocks.setDoc.mock.calls[0];
    expect(payload.shownLog.map((e) => e.id)).toEqual(['existing1', 'new1']);
  });

  it('prunes entries older than 90 days from the merged log', async () => {
    const existing = [
      shownEntry({ id: 'ancient', daysAgo: 91 }),
      shownEntry({ id: 'recent', daysAgo: 10 }),
    ];
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ shownLog: existing }) });
    await recordShownInsights(db, UID, [insight({ id: 'new1' })]);

    const [, payload] = mocks.setDoc.mock.calls[0];
    expect(payload.shownLog.map((e) => e.id)).toEqual(['recent', 'new1']);
  });

  it('caps the merged log to the 200 newest entries', async () => {
    const existing = Array.from({ length: 200 }, (_, i) => shownEntry({ id: `old${i}`, daysAgo: 1 }));
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ shownLog: existing }) });
    await recordShownInsights(db, UID, [insight({ id: 'newest' })]);

    const [, payload] = mocks.setDoc.mock.calls[0];
    expect(payload.shownLog).toHaveLength(200);
    // Newest entries win: the very first "old" entry falls off, the just-added one survives.
    expect(payload.shownLog[payload.shownLog.length - 1].id).toBe('newest');
    expect(payload.shownLog.find((e) => e.id === 'old0')).toBeUndefined();
  });
});
