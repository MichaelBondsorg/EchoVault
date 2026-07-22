/**
 * R4 Task 3 — crossThreadDetector.js: the `generateMetaPatternInsight`
 * context-destructuring seam fix (DR finding 9) and the descending-order
 * `.slice(0, 20)` fix.
 *
 * The orchestrator-level real-call-chain test lives in
 * orchestrator.riskyClaims.test.js; this file unit-tests the function
 * directly against both the orchestrator's real context shape
 * (`activeThreads`) and a plain `threads` shape, to prove the fix accepts
 * either.
 */
import { describe, it, expect, vi } from 'vitest';
import { detectMetaPatterns, generateMetaPatternInsight } from '../crossThreadDetector';

// crossThreadDetector.js imports layer1/threadManager, which imports
// config/firebase — mock it so this file never touches a real Firebase app.
vi.mock('../../../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  Timestamp: { now: vi.fn(() => ({})) },
}));

vi.mock('../../../ai/gemini', () => ({
  callGemini: vi.fn(async () => JSON.stringify({
    title: 'The Connection',
    realization: 'They share a root cause.',
    explanation: 'Two paragraphs.',
    unified_intervention: { action: 'Do X', why: 'Because Y' },
  })),
}));

const THREADS = [
  { id: 't-career', category: 'career', displayName: 'Job search', somaticSignals: [] },
  { id: 't-relationship', category: 'relationship', displayName: 'Partner', somaticSignals: [] },
];

describe('generateMetaPatternInsight — context-shape seam fix (DR finding 9)', () => {
  it('populates affectedThreads (and returns an insight) given orchestrator\'s real `activeThreads` key', async () => {
    const metaPatterns = await detectMetaPatterns('user-1', THREADS, [
      { id: 'e1', text: 'Still waiting to hear back and it is out of my hands.' },
    ]);
    expect(metaPatterns.length).toBeGreaterThan(0);

    // Orchestrator's real synthesisContext shape: `activeThreads`, not
    // `threads`. Before the fix, this destructured to `undefined` and the
    // function always returned `null`.
    const context = { activeThreads: THREADS, recentEntries: [], baselines: null };
    const insight = await generateMetaPatternInsight('user-1', metaPatterns[0], context);

    expect(insight).toBeTruthy();
    expect(insight.type).toBe('meta_pattern');
    expect(insight.title).toBe('The Connection');
  });

  it('also accepts a plain `threads` key (backward compatible)', async () => {
    const metaPatterns = await detectMetaPatterns('user-1', THREADS, [
      { id: 'e1', text: 'Still waiting to hear back and it is out of my hands.' },
    ]);

    const context = { threads: THREADS, entries: [], baselines: null };
    const insight = await generateMetaPatternInsight('user-1', metaPatterns[0], context);

    expect(insight).toBeTruthy();
  });

  it('returns null (not an error) when neither key is present and no threads match', async () => {
    const metaPatterns = await detectMetaPatterns('user-1', THREADS, [
      { id: 'e1', text: 'Still waiting to hear back and it is out of my hands.' },
    ]);

    const insight = await generateMetaPatternInsight('user-1', metaPatterns[0], {});
    expect(insight).toBeNull();
  });
});

describe('detectMetaPatterns — sort-order contract (`.slice(0, 20)` fix)', () => {
  it('scans the 20 MOST RECENT entries, not the 20 oldest, given a DESCENDING entries array', async () => {
    // 25 entries, DESCENDING (index 0 = most recent). Only entry 0 (the
    // most recent) mentions the narrative signal; it must be in the
    // scanned window for the pattern to be detected at all.
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: `e${i}`,
      text: i === 0 ? 'Everything feels out of my hands right now.' : 'A normal day.',
    }));

    const metaPatterns = await detectMetaPatterns('user-1', THREADS, entries);
    expect(metaPatterns.length).toBeGreaterThan(0);
  });

  it('does NOT detect a signal that only appears in an entry older than the 20 most recent', async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: `e${i}`,
      // Only entry 22 (outside the most-recent-20 window) mentions the
      // signal — the old `.slice(-20)` (20 OLDEST) would have caught this;
      // the fixed `.slice(0, 20)` (20 MOST RECENT) must not.
      text: i === 22 ? 'Everything feels out of my hands right now.' : 'A normal day.',
    }));

    const metaPatterns = await detectMetaPatterns('user-1', THREADS, entries);
    expect(metaPatterns.length).toBe(0);
  });
});
