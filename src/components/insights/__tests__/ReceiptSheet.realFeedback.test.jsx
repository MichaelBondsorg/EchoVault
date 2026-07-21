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
