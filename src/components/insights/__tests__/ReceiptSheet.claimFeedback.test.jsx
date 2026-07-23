/**
 * ReceiptSheet — claim vs legacy feedback branching (R4 Phase 1 Task 9, DR
 * finding 10). Claims (insight.claimType present) get the 6-option
 * diagnostic feedback taxonomy; legacy insights (no claimType) keep
 * today's "Not true"/"Not useful" pair byte-for-byte, unchanged. Mock
 * harness mirrors ReceiptSheet.test.jsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ReceiptSheet from '../ReceiptSheet';
import { recordFeedbackAndLearn } from '../../../services/basicInsights/feedbackLearning';
import { recordInsightEngagement } from '../../../services/analytics/insightEngagement';
import { excludeSource } from '../../../services/insights/sourceExclusions';
import { recordClaimFeedback } from '../../../services/insights/claims/claimFeedback';

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

vi.mock('../../../services/insights/claims/claimFeedback', async () => {
  const actual = await vi.importActual('../../../services/insights/claims/claimFeedback');
  return {
    ...actual,
    recordClaimFeedback: vi.fn().mockResolvedValue(undefined),
  };
});

const UID = 'user-1';

const baseReceipt = {
  sources: [
    { entryId: 'e1', date: '2026-07-18T10:00:00.000Z', excerpt: 'Went to the gym after work, felt great.' },
  ],
  scope: null,
  timeWindow: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
  sampleSize: 9,
  missingness: null,
  versions: {},
};

const legacyInsight = {
  id: 'insight-1',
  type: 'pattern',
  title: 'Evening walks lift your mood',
  summary: 'You tend to feel calmer on days you go for an evening walk.',
  confidence: 0.82,
  receipt: baseReceipt,
};

const claimInsight = {
  id: 'claim_basic-activity-tag-gym-mood_abcd1234_v1',
  claimType: 'pattern_to_watch',
  wording: 'On days you mention gym, mood tends to run higher.',
  analysisPlan: { hypothesisFamilyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym' },
  evidence: { sourceEntryIds: ['e1'], effectMoodPoints: 7.2, totalCandidateDayCount: 24 },
  status: 'candidate',
  receipt: baseReceipt,
};

const entriesById = {
  e1: { id: 'e1', content: 'Went to the gym after work, felt great, endorphins were flowing.' },
};

function renderSheet(overrides = {}) {
  const props = {
    insight: legacyInsight,
    entriesById,
    uid: UID,
    spaces: [],
    open: true,
    onClose: vi.fn(),
    onFeedback: vi.fn(),
    onExcludeSource: vi.fn(),
    ...overrides,
  };
  return { ...render(<ReceiptSheet {...props} />), props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReceiptSheet — legacy insights (no claimType) keep today\'s UI untouched', () => {
  it('renders "Not true" and "Not useful", no radiogroup', () => {
    renderSheet({ insight: legacyInsight });
    expect(screen.getByText('Not true')).toBeTruthy();
    expect(screen.getByText('Not useful')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText('Submit feedback')).toBeNull();
  });

  it('"Wrong source" still calls excludeSource directly (not recordClaimFeedback)', async () => {
    renderSheet({ insight: legacyInsight });
    fireEvent.click(screen.getByText('Wrong source'));

    await vi.waitFor(() => expect(excludeSource).toHaveBeenCalledTimes(1));
    expect(recordClaimFeedback).not.toHaveBeenCalled();
  });
});

describe('ReceiptSheet — claims (claimType present) get the 6-option diagnostic taxonomy', () => {
  it('renders all 6 feedback options as a radiogroup, and a Submit feedback button, in place of Not true/Not useful', () => {
    renderSheet({ insight: claimInsight });

    expect(screen.getByRole('radiogroup', { name: /feedback on this claim/i })).toBeTruthy();
    expect(screen.getByText('Accurate')).toBeTruthy();
    expect(screen.getByText('Wrong source entries')).toBeTruthy();
    expect(screen.getByText('Real, but not useful')).toBeTruthy();
    expect(screen.getByText('This doesn’t cause that')).toBeTruthy();
    expect(screen.getByText('Misunderstood person/activity')).toBeTruthy();
    expect(screen.getByText('Don’t analyze this topic')).toBeTruthy();
    expect(screen.getByText('Submit feedback')).toBeTruthy();

    expect(screen.queryByText('Not true')).toBeNull();
    expect(screen.queryByText('Not useful')).toBeNull();
  });

  it('selecting "Don’t analyze this topic" and submitting calls recordClaimFeedback(db, uid, claim, "do_not_analyze", ...)', async () => {
    const onFeedback = vi.fn();
    renderSheet({ insight: claimInsight, onFeedback });

    fireEvent.click(screen.getByLabelText("Don’t analyze this topic"));
    fireEvent.click(screen.getByText('Submit feedback'));

    await vi.waitFor(() => expect(recordClaimFeedback).toHaveBeenCalledTimes(1));
    expect(recordClaimFeedback).toHaveBeenCalledWith(
      { __db: true },
      UID,
      claimInsight,
      'do_not_analyze',
      { entriesCount: Object.keys(entriesById).length },
    );
    await vi.waitFor(() => expect(onFeedback).toHaveBeenCalledWith('do_not_analyze'));
    // Legacy consumers must NOT be called directly for a claim.
    expect(recordFeedbackAndLearn).not.toHaveBeenCalled();
    expect(recordInsightEngagement).not.toHaveBeenCalled();
    expect(excludeSource).not.toHaveBeenCalled();
  });

  it('the Submit button is disabled until an option is selected', () => {
    renderSheet({ insight: claimInsight });
    expect(screen.getByText('Submit feedback').closest('button')).toBeDisabled();
  });

  it('selecting "Wrong source entries" keeps Submit disabled and shows a hint to use the per-source row', () => {
    renderSheet({ insight: claimInsight });
    fireEvent.click(screen.getByLabelText('Wrong source entries'));

    expect(screen.getByText('Submit feedback').closest('button')).toBeDisabled();
    expect(screen.getByText(/use .wrong source. under a specific entry/i)).toBeTruthy();
    expect(recordClaimFeedback).not.toHaveBeenCalled();
  });

  it('Finding 3: the wrong_source hint is aria-describedby-linked from both the wrong_source radio and the disabled Submit button', () => {
    renderSheet({ insight: claimInsight });
    const radio = screen.getByLabelText('Wrong source entries');
    const submitButton = screen.getByText('Submit feedback').closest('button');

    // Before selection: hint isn't rendered, so no dangling aria-describedby.
    expect(radio).not.toHaveAttribute('aria-describedby');
    expect(submitButton).not.toHaveAttribute('aria-describedby');

    fireEvent.click(radio);

    const hint = screen.getByText(/use .wrong source. under a specific entry/i);
    expect(hint.id).toBeTruthy();
    expect(radio.getAttribute('aria-describedby')).toBe(hint.id);
    expect(submitButton.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('per-source "Wrong source" routes through recordClaimFeedback (not excludeSource directly) for a claim', async () => {
    const onExcludeSource = vi.fn();
    renderSheet({ insight: claimInsight, onExcludeSource });
    fireEvent.click(screen.getByText('Wrong source'));

    await vi.waitFor(() => expect(recordClaimFeedback).toHaveBeenCalledTimes(1));
    expect(recordClaimFeedback).toHaveBeenCalledWith(
      { __db: true },
      UID,
      claimInsight,
      'wrong_source',
      { entryId: 'e1' },
    );
    expect(excludeSource).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onExcludeSource).toHaveBeenCalledWith({
      entryId: 'e1',
      appliesTo: 'basic:activity:tag:gym:mood',
      reason: 'wrong_source',
    }));
  });

  it('"Exclude source" (permanent, all-surfaces) is unchanged for a claim — still calls excludeSource with a confirm step', async () => {
    renderSheet({ insight: claimInsight });
    fireEvent.click(screen.getByText('Exclude source'));
    const dialog = screen.getByRole('dialog', { name: /exclude this entry/i });
    fireEvent.click(within(dialog).getByText('Exclude'));

    await vi.waitFor(() => expect(excludeSource).toHaveBeenCalledWith(
      { __db: true },
      UID,
      { entryId: 'e1', appliesTo: 'all', reason: 'excluded_by_user' },
    ));
  });

  it('the radio options and submit button carry 44px touch targets', () => {
    renderSheet({ insight: claimInsight });
    const radioLabel = screen.getByText('Accurate').closest('label');
    expect(radioLabel.className).toContain('min-h-[44px]');
    const submitButton = screen.getByText('Submit feedback').closest('button');
    expect(submitButton.className).toContain('min-h-[44px]');
  });
});
