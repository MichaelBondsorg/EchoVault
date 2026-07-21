/**
 * Basic Insights receipts test (R2 Task 8).
 *
 * Verifies the single receipt-wrap seam in `generateBasicInsights`:
 * correlation insights that already carry `entryIds` (activity/people/
 * time/category/themes/extended-health — all pure, unmocked here) get a
 * precise receipt over those exact entries; anything without entryIds
 * falls back to a window-level receipt over the full `entries` set. Every
 * insight that reaches `result.insights` must carry a truthy `.receipt`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

// Feedback learning touches Firestore internally; stub it to a pure
// pass-through so this test stays focused on receipts, not learning.
vi.mock('../feedbackLearning', () => ({
  filterInsightsByLearning: vi.fn(async (userId, insights) =>
    insights.map((i) => ({ ...i, _showDecision: { show: true, adjustedConfidence: 1 } }))
  ),
}));

const { generateBasicInsights } = await import('../basicInsightsOrchestrator');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 10-entry fixture: 5 "yoga" entries (high mood) exercise
 * `computeActivityCorrelations` (real, unmocked) with a strong,
 * entryIds-bearing insight; 5 neutral entries provide baseline mood +
 * padding. No healthContext/environmentContext, so the pre-existing
 * health/environment correlations naturally produce nothing — leaving
 * activity as the sole insight family, which is enough to prove both
 * receipt paths (precise + the invariant that nothing lacks a receipt).
 */
function buildEntries() {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const entries = [];

  for (let i = 0; i < 5; i++) {
    entries.push({
      id: `yoga-${i}`,
      createdAt: new Date(now - i * DAY_MS).toISOString(),
      text: `Did yoga this morning, feeling solid. Entry number ${i}.`,
      analysis: { mood_score: 0.9 },
    });
  }

  for (let i = 0; i < 5; i++) {
    entries.push({
      id: `neutral-${i}`,
      createdAt: new Date(now - (i + 5) * DAY_MS).toISOString(),
      text: `A regular day. Nothing special. Entry number ${i}.`,
      analysis: { mood_score: 0.5 },
    });
  }

  // Health-correlation entries: these carry NO `entryIds` on the resulting
  // insight (health/environment correlations predate the entryIds-bearing
  // "new correlations" and were never touched) — this exercises the
  // window-level receipt fallback path.
  for (let i = 0; i < 4; i++) {
    entries.push({
      id: `good-sleep-${i}`,
      createdAt: new Date(now - (i + 10) * DAY_MS).toISOString(),
      text: `Slept great, feeling rested. Entry number ${i}.`,
      analysis: { mood_score: 0.9 },
      healthContext: { sleep: { totalHours: 8 } },
    });
  }
  for (let i = 0; i < 3; i++) {
    entries.push({
      id: `poor-sleep-${i}`,
      createdAt: new Date(now - (i + 14) * DAY_MS).toISOString(),
      text: `Rough night, barely slept. Entry number ${i}.`,
      analysis: { mood_score: 0.4 },
      healthContext: { sleep: { totalHours: 4 } },
    });
  }

  return entries;
}

describe('generateBasicInsights - receipts (R2 Task 8)', () => {
  it('attaches a truthy receipt to every returned insight', async () => {
    const result = await generateBasicInsights('user-1', buildEntries());

    expect(result.success).toBe(true);
    expect(result.insights.length).toBeGreaterThan(0);
    for (const insight of result.insights) {
      expect(insight.receipt).toBeTruthy();
      expect(Array.isArray(insight.receipt.sources)).toBe(true);
      expect(insight.receipt.scope).toBeNull();
      expect(insight.receipt.versions.computationVersion).toBe(1);
    }
  });

  it('activity correlation insight carries the exact entryIds it was computed over', async () => {
    const result = await generateBasicInsights('user-1', buildEntries());
    const activityInsight = result.insights.find((i) => i.category === 'activity');

    expect(activityInsight).toBeTruthy();
    expect(activityInsight.entryIds.length).toBe(5);
    const sourceIds = activityInsight.receipt.sources.map((s) => s.entryId).sort();
    expect(sourceIds).toEqual(['yoga-0', 'yoga-1', 'yoga-2', 'yoga-3', 'yoga-4']);
    expect(activityInsight.receipt.versions.generator).toBe('basic_activity');
    expect(activityInsight.receipt.sampleSize).toBe(activityInsight.entryIds.length);
  });

  it('health correlation insight (no entryIds) falls back to a window-level receipt', async () => {
    const result = await generateBasicInsights('user-1', buildEntries());
    const healthInsight = result.insights.find((i) => i.category === 'health');

    expect(healthInsight).toBeTruthy();
    expect(healthInsight.entryIds).toBeUndefined();
    expect(healthInsight.receipt).toBeTruthy();
    expect(healthInsight.receipt.sources.length).toBeGreaterThan(0);
    expect(healthInsight.receipt.sources.length).toBeLessThanOrEqual(10);
    expect(healthInsight.receipt.sampleSize).toBe(17); // full window entries count
    expect(healthInsight.receipt.versions.generator).toBe('basic_health');
  });
});
