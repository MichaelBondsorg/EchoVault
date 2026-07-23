/**
 * ClaimFeed — R4 Phase 2 Task 6. The unified ranked feed: renders claims in
 * `rankClaims` order under a type-count group header, with a loading state
 * and a non-apologetic empty state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClaimFeed, { groupSummary } from '../ClaimFeed';

const NOW = new Date('2026-07-23T00:00:00.000Z').getTime();

function claim({
  id,
  claimType = 'observation',
  wording,
  effectMoodPoints = 5,
  createdAt = '2026-07-20T00:00:00.000Z',
}) {
  return {
    id,
    claimType,
    subject: 'gym',
    direction: effectMoodPoints >= 0 ? 'positive' : 'negative',
    wording: wording || `wording for ${id}`,
    limitations: ['This is one observed pattern in your own data, not a general conclusion.'],
    analysisPlan: { hypothesisFamilyId: `fam:${id}`, candidateId: 'tag:gym' },
    evidence: {
      exposedDayCount: 10,
      comparisonDayCount: 20,
      observedSpanDays: 30,
      effectMoodPoints,
      hiddenSensitiveSourceCount: 0,
      sourceEntryIds: [],
    },
    receipt: { sources: [] },
    status: 'verified',
    createdAt,
  };
}

describe('groupSummary', () => {
  it('formats counts in type-priority order, pluralized', () => {
    const claims = [
      claim({ id: 'a', claimType: 'observation' }),
      claim({ id: 'b', claimType: 'observation' }),
      claim({ id: 'c', claimType: 'observation' }),
      claim({ id: 'd', claimType: 'pattern_to_watch' }),
      claim({ id: 'e', claimType: 'pattern_to_watch' }),
      claim({ id: 'f', claimType: 'experiment_result' }),
    ];
    expect(groupSummary(claims)).toBe('1 experiment result · 2 patterns to watch · 3 observations');
  });

  it('singularizes a count of exactly 1', () => {
    expect(groupSummary([claim({ id: 'a', claimType: 'experiment_result' })])).toBe('1 experiment result');
  });

  it('omits types with zero claims', () => {
    const claims = [claim({ id: 'a', claimType: 'observation' })];
    expect(groupSummary(claims)).toBe('1 observation');
  });

  it('returns an empty string for an empty/undefined list', () => {
    expect(groupSummary([])).toBe('');
    expect(groupSummary(undefined)).toBe('');
  });
});

describe('ClaimFeed — rendering', () => {
  it('renders a group header summarizing claim-type counts', () => {
    const claims = [
      claim({ id: 'a', claimType: 'pattern_to_watch' }),
      claim({ id: 'b', claimType: 'pattern_to_watch' }),
      claim({ id: 'c', claimType: 'experiment_result' }),
    ];
    render(<ClaimFeed claims={claims} loading={false} now={NOW} />);
    expect(screen.getByText('1 experiment result · 2 patterns to watch')).toBeTruthy();
  });

  it('renders ClaimCards in rankClaims order (experiment_result before pattern_to_watch before observation)', () => {
    const claims = [
      claim({ id: 'obs-1', claimType: 'observation', wording: 'observation wording' }),
      claim({ id: 'pat-1', claimType: 'pattern_to_watch', wording: 'pattern wording' }),
      claim({ id: 'exp-1', claimType: 'experiment_result', wording: 'experiment wording' }),
    ];
    render(<ClaimFeed claims={claims} loading={false} now={NOW} />);

    const rendered = screen.getAllByText(/wording$/).map((el) => el.textContent);
    expect(rendered).toEqual(['experiment wording', 'pattern wording', 'observation wording']);
  });

  it('renders a loading state when loading and no claims are available yet', () => {
    render(<ClaimFeed claims={[]} loading={true} now={NOW} />);
    expect(screen.getByText('Checking your patterns...')).toBeTruthy();
  });

  it('prefers rendering claims over the loading state once claims are present, even if loading is still true (refresh-in-place)', () => {
    const claims = [claim({ id: 'a', wording: 'still visible during refresh' })];
    render(<ClaimFeed claims={claims} loading={true} now={NOW} />);
    expect(screen.getByText('still visible during refresh')).toBeTruthy();
    expect(screen.queryByText('Checking your patterns...')).toBeNull();
  });

  it('renders a non-apologetic empty state when there are no claims and not loading', () => {
    render(<ClaimFeed claims={[]} loading={false} now={NOW} />);
    expect(screen.getByText('Nothing verified yet')).toBeTruthy();
    expect(screen.getByText(/Engram only surfaces what your recorded days actually support/)).toBeTruthy();
    // Non-apologetic: no "sorry"/apology language.
    expect(screen.queryByText(/sorry/i)).toBeNull();
  });

  it('empty state also renders for a null/undefined claims prop', () => {
    render(<ClaimFeed claims={null} loading={false} now={NOW} />);
    expect(screen.getByText('Nothing verified yet')).toBeTruthy();
  });

  it('calls onRefresh when the refresh button is clicked', () => {
    const onRefresh = vi.fn();
    const claims = [claim({ id: 'a' })];
    render(<ClaimFeed claims={claims} loading={false} now={NOW} onRefresh={onRefresh} />);

    screen.getByRole('button', { name: 'Refresh insights' }).click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('passes onShowReceipt/onFeedback/onTryExperiment through to ClaimCard actions', () => {
    const onShowReceipt = vi.fn();
    const claims = [claim({ id: 'a' })];
    render(<ClaimFeed claims={claims} loading={false} now={NOW} onShowReceipt={onShowReceipt} />);

    screen.getByText('See days').click();
    expect(onShowReceipt).toHaveBeenCalledWith(claims[0]);
  });
});
