/**
 * ReceiptSheet — "Not true" against the REAL feedbackLearning module.
 *
 * ReceiptSheet.test.jsx mocks `recordFeedbackAndLearn` entirely, so it can
 * never catch a call-shape bug that makes the real implementation a silent
 * no-op (exactly what happened before this fix: a bare string second arg
 * made `patternType` come out `undefined`, which throws inside Firestore's
 * `doc()` and gets swallowed by `recordFeedbackAndLearn`'s try/catch,
 * returning `null` while the UI still claimed success).
 *
 * This file does NOT mock `feedbackLearning` — it mocks Firestore at the
 * module boundary instead (the same pattern used in
 * `src/services/basicInsights/__tests__/basicInsightsOrchestrator.receipts.test.js`),
 * so `recordFeedbackAndLearn` runs for real and this test proves the
 * learning doc write actually happens.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReceiptSheet from '../ReceiptSheet';
import { setDoc } from 'firebase/firestore';
import { excludeSource } from '../../../services/insights/sourceExclusions';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  getDocs: vi.fn(async () => ({ forEach: () => {} })),
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

// Everything else ReceiptSheet touches stays mocked/inert so this file
// stays focused on the one real seam (feedbackLearning <-> Firestore).
vi.mock('../../../services/analytics/insightEngagement', () => ({
  recordInsightEngagement: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../services/insights/sourceExclusions', () => ({
  excludeSource: vi.fn().mockResolvedValue({ id: 'excl-1' }),
}));

const UID = 'user-1';

const baseReceipt = {
  sources: [
    { entryId: 'e1', date: '2026-07-18T10:00:00.000Z', excerpt: 'Went for a walk after dinner.' },
  ],
  scope: null,
  timeWindow: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
  sampleSize: 14,
  missingness: null,
  versions: {},
};

const baseInsight = {
  id: 'insight-1',
  type: 'pattern',
  title: 'Evening walks lift your mood',
  summary: 'You tend to feel calmer on days you go for an evening walk.',
  confidence: 0.82,
  receipt: baseReceipt,
};

const entriesById = {
  e1: { id: 'e1', content: 'Went for a walk after dinner, felt calmer.' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReceiptSheet — "Not true" actually writes a learning doc via the real feedbackLearning module', () => {
  it('calls setDoc (the Firestore write) and reports success to the caller', async () => {
    const onFeedback = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ReceiptSheet
        insight={baseInsight}
        entriesById={entriesById}
        uid={UID}
        open
        onClose={vi.fn()}
        onFeedback={onFeedback}
      />
    );

    fireEvent.click(screen.getByText('Not true'));

    // The learning doc write is the thing that was silently not happening
    // before this fix — assert it directly, not just the return value.
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1));
    const [, writtenDoc] = setDoc.mock.calls[0];
    expect(writtenDoc.patternType).toBe('insight-1');
    expect(writtenDoc.inaccurateFeedback).toBe(1);
    expect(writtenDoc.totalFeedback).toBe(1);

    await waitFor(() => expect(onFeedback).toHaveBeenCalledWith('not_true'));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

/**
 * Task-11 re-review pinning tests.
 *
 * `patternTypeOf` (ReceiptSheet.jsx) replicates — deliberately does not
 * import, see that function's doc comment — `recordFeedbackAndLearn`'s own
 * patternType chain, so "Wrong source" and "Not true" scope any given
 * insight identically. Since `feedbackLearning` is NOT mocked in this file
 * (only Firestore is, at the module boundary), this exercises the REAL
 * chain on both sides: `writtenDoc.patternType` comes from the actual
 * `recordFeedbackAndLearn` Firestore write, and `appliesTo` comes from the
 * actual `patternTypeOf` call inside `handleWrongSource`. If the two
 * derivations ever drift apart, this catches it directly rather than via a
 * hand-copied expectation.
 */
describe('ReceiptSheet — patternType pinning: "Wrong source" matches the real "Not true" derivation', () => {
  const receiptFor = (entryId) => ({
    sources: [{ entryId, date: '2026-07-18T10:00:00.000Z', excerpt: 'Some entry text.' }],
    scope: null,
    timeWindow: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
    sampleSize: 5,
    missingness: null,
    versions: {},
  });

  const fixtures = [
    {
      name: 'basic insight with activityKey',
      entryId: 'a1',
      insight: {
        id: 'basic-1',
        category: 'activity',
        insight: 'Yoga days average +12',
        activityKey: 'yoga',
        receipt: receiptFor('a1'),
      },
    },
    {
      name: 'basic insight with themeKey',
      entryId: 't1',
      insight: {
        id: 'basic-2',
        category: 'theme',
        insight: 'Gratitude days run higher',
        themeKey: 'gratitude',
        receipt: receiptFor('t1'),
      },
    },
    {
      name: 'basic insight with peopleKey',
      entryId: 'p1',
      insight: {
        id: 'basic-3',
        category: 'people',
        insight: 'Days mentioning your partner run higher',
        peopleKey: 'partner',
        receipt: receiptFor('p1'),
      },
    },
    {
      name: 'Nexus-shaped insight, no keys/category (id fallback)',
      entryId: 'e1',
      insight: baseInsight,
    },
  ];

  it.each(fixtures)('$name: "Wrong source" appliesTo equals the real "Not true" patternType', async ({ insight, entryId }) => {
    render(
      <ReceiptSheet
        insight={insight}
        entriesById={{}}
        uid={UID}
        open
        onClose={vi.fn()}
        onFeedback={vi.fn()}
        onExcludeSource={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Not true'));
    await waitFor(() => expect(setDoc).toHaveBeenCalledTimes(1));
    const [, writtenDoc] = setDoc.mock.calls[0];
    const notTruePatternType = writtenDoc.patternType;

    fireEvent.click(screen.getAllByText('Wrong source')[0]);
    await waitFor(() => expect(excludeSource).toHaveBeenCalledTimes(1));
    const [, , { entryId: calledEntryId, appliesTo }] = excludeSource.mock.calls[0];

    expect(calledEntryId).toBe(entryId);
    expect(appliesTo).toBe(notTruePatternType);
  });
});
