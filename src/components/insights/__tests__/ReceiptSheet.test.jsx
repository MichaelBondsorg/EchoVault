import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ReceiptSheet from '../ReceiptSheet';
import { recordFeedbackAndLearn } from '../../../services/basicInsights/feedbackLearning';
import { recordInsightEngagement } from '../../../services/analytics/insightEngagement';
import { excludeSource } from '../../../services/insights/sourceExclusions';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/basicInsights/feedbackLearning', () => ({
  recordFeedbackAndLearn: vi.fn().mockResolvedValue({ accuracyRate: 0.5 }),
}));

vi.mock('../../../services/analytics/insightEngagement', () => ({
  recordInsightEngagement: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../services/insights/sourceExclusions', () => ({
  excludeSource: vi.fn().mockResolvedValue({ id: 'excl-1' }),
}));

const UID = 'user-1';

const baseReceipt = {
  sources: [
    { entryId: 'e1', date: '2026-07-18T10:00:00.000Z', excerpt: 'Went for a walk after dinner, felt so much calmer.' },
    { entryId: 'e2', date: '2026-07-15T09:30:00.000Z', excerpt: 'Another walk day, mood lifted noticeably.' },
  ],
  scope: null,
  timeWindow: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
  sampleSize: 14,
  missingness: '9 of 30 days have entries',
  versions: {
    generator: 'pattern_correlation',
    computationVersion: 1,
    generatedAt: '2026-07-21T00:00:00.000Z',
    model: 'gemini-pro-secret',
    promptVersion: 'v3-token-heavy',
  },
};

const baseInsight = {
  id: 'insight-1',
  type: 'pattern',
  title: 'Evening walks lift your mood',
  summary: 'You tend to feel calmer on days you go for an evening walk.',
  confidence: 0.82,
  evidence: {
    narrative: [
      'You mentioned feeling calmer after walks on 3 separate days.',
      'Could also be linked to fresh air / daylight exposure.',
      'Might just be routine/structure rather than the walk itself.',
    ],
  },
  receipt: baseReceipt,
};

const entriesById = {
  e1: { id: 'e1', content: 'Went for a walk after dinner, felt so much calmer than usual, and my mind felt quieter too.' },
  // e2 intentionally absent — exercises the "not in memory" fallback path.
};

function renderSheet(overrides = {}) {
  const props = {
    insight: baseInsight,
    entriesById,
    uid: UID,
    spaces: [],
    open: true,
    onClose: vi.fn(),
    onFeedback: vi.fn(),
    onExcludeSource: vi.fn(),
    ...overrides,
  };
  const utils = render(<ReceiptSheet {...props} />);
  return { ...utils, props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReceiptSheet — renders every receipt field', () => {
  it('renders the claim (title + summary)', () => {
    renderSheet();
    expect(screen.getByText('Evening walks lift your mood')).toBeTruthy();
    expect(screen.getByText('You tend to feel calmer on days you go for an evening walk.')).toBeTruthy();
  });

  it('renders confidence as a plain-language band, never a bare number', () => {
    renderSheet();
    expect(screen.getByText('Strong pattern')).toBeTruthy();
    expect(screen.queryByText(/82%/)).toBeNull();
    expect(screen.queryByText(/0\.82/)).toBeNull();
  });

  it.each([
    [0.82, 'Strong pattern'],
    [0.6, 'Moderate pattern'],
    [0.3, 'Tentative pattern'],
  ])('bands confidence %s as %s', (confidence, expected) => {
    renderSheet({ insight: { ...baseInsight, confidence } });
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('defaults to a moderate band when the insight has no confidence value at all', () => {
    const { confidence, ...withoutConfidence } = baseInsight;
    renderSheet({ insight: withoutConfidence });
    expect(screen.getByText('Moderate pattern')).toBeTruthy();
  });

  it('renders "All spaces" when receipt.scope is null', () => {
    renderSheet();
    expect(screen.getByText('All spaces')).toBeTruthy();
  });

  it('resolves receipt.scope.spaceId to a Space name via the spaces prop', () => {
    renderSheet({
      insight: { ...baseInsight, receipt: { ...baseReceipt, scope: { spaceId: 'space-1' } } },
      spaces: [{ id: 'space-1', name: 'Work' }],
    });
    expect(screen.getByText('Work')).toBeTruthy();
  });

  it('falls back to "a Space" when the scoped space is not found in the spaces list', () => {
    renderSheet({
      insight: { ...baseInsight, receipt: { ...baseReceipt, scope: { spaceId: 'missing-space' } } },
      spaces: [{ id: 'space-1', name: 'Work' }],
    });
    expect(screen.getByText('a Space')).toBeTruthy();
  });

  it('renders the time window', () => {
    renderSheet();
    expect(screen.getByText(/Jun 21, 2026/)).toBeTruthy();
    expect(screen.getByText(/Jul 21, 2026/)).toBeTruthy();
  });

  it('renders sample size and missingness together', () => {
    renderSheet();
    expect(screen.getByText(/Based on 14 entries/)).toBeTruthy();
    expect(screen.getByText(/9 of 30 days have entries/)).toBeTruthy();
  });

  it('renders each source date + excerpt', () => {
    renderSheet();
    expect(screen.getByText('Went for a walk after dinner, felt so much calmer.')).toBeTruthy();
    expect(screen.getByText('Another walk day, mood lifted noticeably.')).toBeTruthy();
    expect(screen.getByText('Jul 18, 2026')).toBeTruthy();
    expect(screen.getByText('Jul 15, 2026')).toBeTruthy();
  });

  it('renders an alternatives line when evidence.narrative offers more than one entry', () => {
    renderSheet();
    expect(screen.getByText('Other explanations')).toBeTruthy();
    expect(screen.getByText('Could also be linked to fresh air / daylight exposure.')).toBeTruthy();
    expect(screen.getByText('Might just be routine/structure rather than the walk itself.')).toBeTruthy();
    // The first narrative entry is the primary evidence, not an "alternative".
    expect(screen.queryByText('You mentioned feeling calmer after walks on 3 separate days.')).toBeNull();
  });

  it('renders no alternatives line when evidence.narrative has 0 or 1 entries', () => {
    renderSheet({
      insight: { ...baseInsight, evidence: { narrative: ['Only one observation.'] } },
    });
    expect(screen.queryByText('Other explanations')).toBeNull();
  });
});

describe('ReceiptSheet — missingness precedes narrative/evidence (PRD order)', () => {
  // The Drawer content renders into a portal appended to document.body, not
  // inside RTL's `container` — assert against document.body.innerHTML so
  // this actually inspects the rendered DOM order.
  it('places the sample+missingness line before the alternatives section in DOM order', () => {
    renderSheet();
    const html = document.body.innerHTML;
    const missingnessIndex = html.indexOf('9 of 30 days have entries');
    const alternativesIndex = html.indexOf('Other explanations');
    expect(missingnessIndex).toBeGreaterThan(-1);
    expect(alternativesIndex).toBeGreaterThan(-1);
    expect(missingnessIndex).toBeLessThan(alternativesIndex);
  });

  it('places the sample+missingness line before the sources list', () => {
    renderSheet();
    const html = document.body.innerHTML;
    const missingnessIndex = html.indexOf('9 of 30 days have entries');
    const sourcesIndex = html.indexOf('Went for a walk after dinner');
    expect(missingnessIndex).toBeGreaterThan(-1);
    expect(missingnessIndex).toBeLessThan(sourcesIndex);
  });
});

describe('ReceiptSheet — tap a source row to expand full entry text', () => {
  it('expands to the full entry text when the entry is available in entriesById', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Went for a walk after dinner, felt so much calmer.'));
    expect(
      screen.getByText('Went for a walk after dinner, felt so much calmer than usual, and my mind felt quieter too.')
    ).toBeTruthy();
  });

  it('does not fetch or crash when the entry is not in entriesById — shows only the excerpt/date already in the receipt', () => {
    renderSheet();
    fireEvent.click(screen.getByText('Another walk day, mood lifted noticeably.'));
    // Nothing beyond the receipt's own excerpt/date renders for e2 — no full
    // entry text materializes since it's not synchronously available.
    expect(screen.getByText('Another walk day, mood lifted noticeably.')).toBeTruthy();
  });
});

describe('ReceiptSheet — distinct repair actions call the exact service with exact payloads', () => {
  it('"Not true" calls recordFeedbackAndLearn(uid, \'inaccurate\', citedEntries)', async () => {
    const onFeedback = vi.fn();
    renderSheet({ onFeedback });
    fireEvent.click(screen.getByText('Not true'));

    await vi.waitFor(() => expect(recordFeedbackAndLearn).toHaveBeenCalledTimes(1));
    expect(recordFeedbackAndLearn).toHaveBeenCalledWith(UID, 'inaccurate', [
      entriesById.e1,
      { id: 'e2', entryId: 'e2', date: baseReceipt.sources[1].date, excerpt: baseReceipt.sources[1].excerpt },
    ]);
    await vi.waitFor(() => expect(onFeedback).toHaveBeenCalledWith('not_true'));
  });

  it('"Not useful" calls recordInsightEngagement(uid, insight, \'dismissed\')', async () => {
    const onFeedback = vi.fn();
    renderSheet({ onFeedback });
    fireEvent.click(screen.getByText('Not useful'));

    await vi.waitFor(() => expect(recordInsightEngagement).toHaveBeenCalledTimes(1));
    expect(recordInsightEngagement).toHaveBeenCalledWith(UID, baseInsight, 'dismissed');
    await vi.waitFor(() => expect(onFeedback).toHaveBeenCalledWith('not_useful'));
  });

  it('per-source "Wrong source" calls excludeSource with the derived pattern type, no confirm required', async () => {
    const onExcludeSource = vi.fn();
    renderSheet({ onExcludeSource });
    const rows = screen.getAllByText('Wrong source');
    fireEvent.click(rows[0]);

    await vi.waitFor(() => expect(excludeSource).toHaveBeenCalledTimes(1));
    // "Evening walks lift your mood" matches no keyword in the pattern map
    // -> falls back to insight.type ('pattern').
    expect(excludeSource).toHaveBeenCalledWith(
      { __db: true },
      UID,
      { entryId: 'e1', appliesTo: 'pattern', reason: 'wrong_source' }
    );
    expect(onExcludeSource).toHaveBeenCalledWith({ entryId: 'e1', appliesTo: 'pattern', reason: 'wrong_source' });
  });

  it('derives appliesTo from a matched keyword pattern when the insight text matches one', async () => {
    renderSheet({
      insight: {
        ...baseInsight,
        title: 'Exercise boosts your mood',
        summary: 'Days with exercise tend to run higher on mood.',
      },
    });
    fireEvent.click(screen.getAllByText('Wrong source')[0]);

    await vi.waitFor(() => expect(excludeSource).toHaveBeenCalledTimes(1));
    expect(excludeSource).toHaveBeenCalledWith(
      { __db: true },
      UID,
      { entryId: 'e1', appliesTo: 'activity_exercise', reason: 'wrong_source' }
    );
  });

  it('per-source "Exclude source" requires confirmation before calling excludeSource', async () => {
    const onExcludeSource = vi.fn();
    renderSheet({ onExcludeSource });
    const rows = screen.getAllByText('Exclude source');
    fireEvent.click(rows[0]);

    // Not called yet — the confirm dialog must appear first.
    expect(excludeSource).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: /exclude this entry/i });
    expect(within(dialog).getByText('This will recompute affected insights.')).toBeTruthy();

    fireEvent.click(within(dialog).getByText('Exclude'));

    await vi.waitFor(() => expect(excludeSource).toHaveBeenCalledTimes(1));
    expect(excludeSource).toHaveBeenCalledWith(
      { __db: true },
      UID,
      { entryId: 'e1', appliesTo: 'all', reason: 'excluded_by_user' }
    );
    expect(onExcludeSource).toHaveBeenCalledWith({ entryId: 'e1', appliesTo: 'all', reason: 'excluded_by_user' });
  });

  it('cancelling the confirm dialog never calls excludeSource', () => {
    renderSheet();
    fireEvent.click(screen.getAllByText('Exclude source')[0]);
    const dialog = screen.getByRole('dialog', { name: /exclude this entry/i });
    fireEvent.click(within(dialog).getByText('Cancel'));

    expect(excludeSource).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /exclude this entry/i })).toBeNull();
  });

  it('shows "This will recompute affected insights" for the immediate Wrong-source path too, not only inside the confirm dialog', () => {
    renderSheet();
    expect(screen.getByText('This will recompute affected insights.')).toBeTruthy();
  });
});

describe('ReceiptSheet — copy constraints', () => {
  it('never renders "model" or "token" jargon anywhere, even though the receipt carries them internally', () => {
    renderSheet();
    expect(screen.queryByText(/model/i)).toBeNull();
    expect(screen.queryByText(/token/i)).toBeNull();
    expect(screen.queryByText(/gemini-pro-secret/i)).toBeNull();
    expect(screen.queryByText(/v3-token-heavy/i)).toBeNull();
  });

  it('uses neutral, non-guilt copy for the repair actions', () => {
    renderSheet();
    expect(screen.getByText('Not true')).toBeTruthy();
    expect(screen.getByText('Not useful')).toBeTruthy();
    expect(screen.queryByText(/you were wrong/i)).toBeNull();
    expect(screen.queryByText(/you shouldn't/i)).toBeNull();
  });
});

describe('ReceiptSheet — closed / missing-receipt states', () => {
  it('renders nothing visible when open is false', () => {
    renderSheet({ open: false });
    expect(screen.queryByText('Evening walks lift your mood')).toBeNull();
  });

  it('does not crash when insight has no receipt yet', () => {
    renderSheet({ insight: { ...baseInsight, receipt: null }, open: true });
    expect(screen.queryByText('Why am I seeing this?')).toBeNull();
  });
});
