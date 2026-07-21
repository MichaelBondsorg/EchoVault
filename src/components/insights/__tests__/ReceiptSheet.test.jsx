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
  // recordFeedbackAndLearn (src/services/basicInsights/feedbackLearning.js)
  // destructures its SECOND argument as an object — `{ insightId, category,
  // moodDelta, activityKey, themeKey, peopleKey, entryIds }` — and derives
  // `patternType` from those fields. A bare string there (the previous
  // implementation) yields `patternType === undefined`, which throws
  // inside Firestore's `doc()` and is silently swallowed, so nothing is
  // ever recorded even though the caller believes it succeeded. These
  // tests assert the real, working contract.
  it('"Not true" calls recordFeedbackAndLearn(uid, feedbackObject, citedEntries) with insightId/feedback/entryIds', async () => {
    const onFeedback = vi.fn();
    renderSheet({ onFeedback });
    fireEvent.click(screen.getByText('Not true'));

    await vi.waitFor(() => expect(recordFeedbackAndLearn).toHaveBeenCalledTimes(1));
    expect(recordFeedbackAndLearn).toHaveBeenCalledWith(
      UID,
      {
        insightId: 'insight-1',
        feedback: 'inaccurate',
        entryIds: ['e1', 'e2'],
      },
      [
        entriesById.e1,
        { id: 'e2', entryId: 'e2', date: baseReceipt.sources[1].date, excerpt: baseReceipt.sources[1].excerpt },
      ]
    );
    await vi.waitFor(() => expect(onFeedback).toHaveBeenCalledWith('not_true'));
  });

  it('"Not true" includes activityKey/themeKey/peopleKey/category/moodDelta/sampleSize when the insight carries them', async () => {
    renderSheet({
      insight: {
        ...baseInsight,
        activityKey: 'yoga',
        themeKey: 'gratitude',
        peopleKey: 'partner',
        category: 'activity',
        moodDelta: 12,
        sampleSize: 9,
      },
    });
    fireEvent.click(screen.getByText('Not true'));

    await vi.waitFor(() => expect(recordFeedbackAndLearn).toHaveBeenCalledTimes(1));
    expect(recordFeedbackAndLearn).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        insightId: 'insight-1',
        feedback: 'inaccurate',
        entryIds: ['e1', 'e2'],
        activityKey: 'yoga',
        themeKey: 'gratitude',
        peopleKey: 'partner',
        category: 'activity',
        moodDelta: 12,
        sampleSize: 9,
      }),
      expect.any(Array)
    );
  });

  it('"Not true" only reports success (onFeedback) when recordFeedbackAndLearn actually recorded something', async () => {
    // recordFeedbackAndLearn returns null on any internal failure (bad
    // patternType, Firestore error, ...) — silently claiming success on a
    // null result is exactly the bug this guard closes.
    recordFeedbackAndLearn.mockResolvedValueOnce(null);
    const onFeedback = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderSheet({ onFeedback });
    fireEvent.click(screen.getByText('Not true'));

    await vi.waitFor(() => expect(recordFeedbackAndLearn).toHaveBeenCalledTimes(1));
    expect(onFeedback).not.toHaveBeenCalledWith('not_true');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
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
    // Task-11 re-review: patternTypeOf now mirrors recordFeedbackAndLearn's
    // own chain FIRST. baseInsight has no activityKey/themeKey/peopleKey/
    // category, but does carry `id: 'insight-1'` — the chain's
    // `insightId || category` tail resolves to that id (never reaching
    // insight.type/'pattern'), matching what "Not true" actually records
    // for this exact fixture (see ReceiptSheet.realFeedback.test.jsx).
    expect(excludeSource).toHaveBeenCalledWith(
      { __db: true },
      UID,
      { entryId: 'e1', appliesTo: 'insight-1', reason: 'wrong_source' }
    );
    expect(onExcludeSource).toHaveBeenCalledWith({ entryId: 'e1', appliesTo: 'insight-1', reason: 'wrong_source' });
  });

  it('derives appliesTo from a matched keyword pattern when the insight has no id/category/keys but its text matches one', async () => {
    // The activityKey/themeKey/peopleKey/id/category chain takes priority
    // over keyword text matching (see patternTypeOf's doc comment), so an
    // id-bearing insight never reaches this branch — only an insight with
    // none of those fields (and no keys) falls through to
    // extractPatternTypeFromInsight.
    const { id, ...withoutId } = baseInsight;
    renderSheet({
      insight: {
        ...withoutId,
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

  it('falls back to \'unspecified\' when nothing in the chain resolves: no id/category/keys, no keyword match, no type', async () => {
    // patternTypeOf's last-resort floor (ReceiptSheet.jsx) — `'unspecified'`
    // only shows up when the activityKey/themeKey/peopleKey/id/category
    // chain, extractPatternTypeFromInsight, AND insight.type all come up
    // empty. Base insight's text already matches no keyword (proven by the
    // fallback-to-keyword test above); dropping `id` and `type` too
    // exercises the final branch.
    const { id, type, ...insightWithoutIdOrType } = baseInsight;
    renderSheet({ insight: insightWithoutIdOrType });
    fireEvent.click(screen.getAllByText('Wrong source')[0]);

    await vi.waitFor(() => expect(excludeSource).toHaveBeenCalledTimes(1));
    expect(excludeSource).toHaveBeenCalledWith(
      { __db: true },
      UID,
      { entryId: 'e1', appliesTo: 'unspecified', reason: 'wrong_source' }
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

describe('ReceiptSheet — basic-insight-shaped fixture (Task 11 re-review)', () => {
  // Basic insights (QuickInsightsSection, wired to the receipt trigger in
  // the original Task 11 addendum) carry `{category, insight, activityKey?,
  // themeKey?, peopleKey?}` — no title/body/summary/type. Before this fix,
  // `patternTypeOf` only ever read title/body/summary (via
  // `extractPatternTypeFromInsight`) or `insight.type`, so every basic-card
  // "Wrong source" fell through to `'unspecified'` regardless of the
  // activityKey/themeKey/peopleKey the card actually carries — while "Not
  // true" (via `recordFeedbackAndLearn`'s own chain) correctly scoped to
  // `activity_yoga` etc. These tests pin the fix: same shape, same
  // `appliesTo` on both actions.
  const basicReceipt = {
    sources: [
      { entryId: 'b1', date: '2026-07-10T09:00:00.000Z', excerpt: 'Yoga this morning, felt centered.' },
    ],
    scope: null,
    timeWindow: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
    sampleSize: 6,
    missingness: null,
    versions: {},
  };

  const basicInsight = {
    id: 'basic-1',
    category: 'activity',
    insight: 'Yoga days average +12',
    moodDelta: 12,
    sampleSize: 6,
    activityKey: 'yoga',
    receipt: basicReceipt,
  };

  it('renders without crashing: claim falls back to category, summary shows the .insight text', () => {
    renderSheet({ insight: basicInsight });
    expect(screen.getByText('activity')).toBeTruthy();
    expect(screen.getByText('Yoga days average +12')).toBeTruthy();
  });

  it('"Wrong source" scopes to the SAME patternType recordFeedbackAndLearn would derive (activityKey -> activity_yoga)', async () => {
    const onExcludeSource = vi.fn();
    renderSheet({ insight: basicInsight, onExcludeSource });
    fireEvent.click(screen.getByText('Wrong source'));

    await vi.waitFor(() => expect(excludeSource).toHaveBeenCalledTimes(1));
    // recordFeedbackAndLearn (feedbackLearning.js:129-132) derives
    // `patternType` as `activityKey ? \`activity_${activityKey}\` : ...` —
    // with activityKey: 'yoga' present, that's 'activity_yoga' regardless
    // of any title/type text. Wrong-source must land the same value.
    expect(excludeSource).toHaveBeenCalledWith(
      { __db: true },
      UID,
      { entryId: 'b1', appliesTo: 'activity_yoga', reason: 'wrong_source' }
    );
    expect(onExcludeSource).toHaveBeenCalledWith({ entryId: 'b1', appliesTo: 'activity_yoga', reason: 'wrong_source' });
  });

  it('keeps a Nexus-shaped fixture working through the same path (no regression): id-bearing insight scopes to its own id', async () => {
    // baseInsight has no activityKey/themeKey/peopleKey/category, but does
    // carry an id — recordFeedbackAndLearn's tail (`insightId || category`)
    // resolves to that id, and ReceiptSheet.realFeedback.test.jsx already
    // proves this is exactly what the real "Not true" write records
    // (`writtenDoc.patternType === 'insight-1'`) for this exact fixture.
    renderSheet();
    fireEvent.click(screen.getAllByText('Wrong source')[0]);

    await vi.waitFor(() => expect(excludeSource).toHaveBeenCalledTimes(1));
    expect(excludeSource).toHaveBeenCalledWith(
      { __db: true },
      UID,
      { entryId: 'e1', appliesTo: 'insight-1', reason: 'wrong_source' }
    );
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

describe('ReceiptSheet — 44px tap targets (Chip.jsx pattern: min-height + before:-inset)', () => {
  // jsdom can't measure layout, so this asserts class presence — the same
  // painted+inset formula documented on Chip.jsx (min-h-[28px] + inset-2
  // 8px/side = 44px) must be present on both per-source repair actions.
  it('"Wrong source" carries min-h-[28px] and before:-inset-2', () => {
    renderSheet();
    const button = screen.getAllByText('Wrong source')[0];
    expect(button.className).toContain('min-h-[28px]');
    expect(button.className).toContain('before:-inset-2');
  });

  it('"Exclude source" carries min-h-[28px] and before:-inset-2', () => {
    renderSheet();
    const button = screen.getAllByText('Exclude source')[0];
    expect(button.className).toContain('min-h-[28px]');
    expect(button.className).toContain('before:-inset-2');
  });
});
