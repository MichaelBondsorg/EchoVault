/**
 * InsightsPage — Fix C (2026-07-24 brief): ONE authoritative "Rebuild
 * insights" action, unifying the page header refresh, ClaimFeed's refresh,
 * and Quick Insights' refresh into the single `rebuildInsights` orchestration
 * contract.
 *
 * Mocking scaffold mirrors InsightsPage.claims.test.jsx, but additionally
 * mocks `useClaims` directly (full control over `refresh`) and the
 * `rebuildInsights`/`describeRebuildResult` service module itself — this
 * suite proves the WIRING (who calls what, in what order, with what
 * result rendered), not the service's own internal orchestration logic
 * (covered by rebuildInsights.test.js).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import InsightsPage from '../InsightsPage';

const getFlag = vi.fn();
vi.mock('../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));

vi.mock('../../config/firebase', () => ({ db: { __db: true } }));

const useNexusInsights = vi.fn();
vi.mock('../../hooks/useNexusInsights', () => ({
  useNexusInsights: (...a) => useNexusInsights(...a),
}));

const useBasicInsights = vi.fn();
vi.mock('../../hooks/useBasicInsights', () => ({
  useBasicInsights: (...a) => useBasicInsights(...a),
}));

const useClaims = vi.fn();
vi.mock('../../hooks/useClaims', () => ({
  useClaims: (...a) => useClaims(...a),
}));

const rebuildInsights = vi.fn();
vi.mock('../../services/insights/rebuildInsights', async () => {
  const actual = await vi.importActual('../../services/insights/rebuildInsights');
  return {
    ...actual,
    rebuildInsights: (...a) => rebuildInsights(...a),
  };
});

vi.mock('../../services/environment/environmentCorrelations', () => ({
  computeEnvironmentMoodCorrelations: vi.fn(() => null),
  getTopEnvironmentInsights: vi.fn(() => []),
  checkEnvironmentDataSufficiency: vi.fn(() => ({ hasEnoughData: false, message: '' })),
}));

vi.mock('../../services/nexus/insightIntegration', () => ({
  getTodayRecommendations: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../services/health/healthCorrelations', () => ({
  computeHealthMoodCorrelations: vi.fn(() => null),
  getTopHealthInsights: vi.fn(() => []),
  checkHealthDataSufficiency: vi.fn(() => ({ hasEnoughData: false, message: '' })),
}));

vi.mock('../../services/moderation/reportInsight', () => ({
  reportInsight: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/analytics/insightEngagement', () => ({
  recordInsightEngagement: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/nexus/insightDismissal', () => ({
  recordInsightDismissal: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../services/basicInsights/feedbackLearning', () => ({
  recordFeedbackAndLearn: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../services/dashboard', () => ({
  calculateStreak: vi.fn(() => 0),
}));

vi.mock('../../components/insights/ReceiptSheet', () => ({
  default: () => null,
}));

function baseNexusReturn(overrides = {}) {
  return {
    insights: [],
    insightCount: 0,
    isCalibrating: false,
    calibrationProgress: 0,
    loading: false,
    refreshing: false,
    error: null,
    dataStatus: null,
    refreshFromCache: vi.fn().mockResolvedValue(undefined),
    lastGenerated: null,
    ...overrides,
  };
}

function baseBasicReturn(overrides = {}) {
  return {
    insights: [],
    loading: false,
    generating: false,
    hasEnoughData: true,
    entriesNeeded: 0,
    refreshFromCache: vi.fn().mockResolvedValue(undefined),
    lastGeneratedFormatted: null,
    ...overrides,
  };
}

function baseClaimsReturn(overrides = {}) {
  return {
    claims: [],
    loading: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const ENTRIES = [
  { id: 'e1', content: 'Went for a walk, felt calmer.', createdAt: '2026-07-18T10:00:00.000Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useNexusInsights.mockReturnValue(baseNexusReturn());
  useBasicInsights.mockReturnValue(baseBasicReturn());
  useClaims.mockReturnValue(baseClaimsReturn());
  getFlag.mockImplementation(() => false);
  rebuildInsights.mockResolvedValue({
    ok: true,
    engines: { basic: { ok: true, insightCount: 1 }, nexus: { ok: true, insightCount: 2 } },
    dayCount: 5,
    verifiedClaimCount: 0,
    insightCount: 3,
  });
});

describe('InsightsPage — Rebuild insights header action (Fix C)', () => {
  it('renders one authoritative "Rebuild insights" action in the header', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    expect(screen.getByRole('button', { name: 'Rebuild insights' })).toBeTruthy();
  });

  it('carries the brief\'s exact supporting copy as an accessible tooltip', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    const button = screen.getByRole('button', { name: 'Rebuild insights' });
    expect(button.getAttribute('title')).toBe(
      "Reanalyze your current journal data. Your entries, feedback, dismissed insights, exclusions, experiments, and insight history won't be deleted."
    );
  });

  it('tapping it calls the rebuildInsights service (runs the pipeline, not a re-read) with db/uid/entries', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild insights' }));

    await waitFor(() => expect(rebuildInsights).toHaveBeenCalledTimes(1));
    expect(rebuildInsights).toHaveBeenCalledWith({ __db: true }, 'user-1', ENTRIES);
  });

  it('disables the button while rebuilding and re-enables once it resolves', async () => {
    let resolveRebuild;
    rebuildInsights.mockReturnValue(new Promise((resolve) => { resolveRebuild = resolve; }));
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    const button = screen.getByRole('button', { name: 'Rebuild insights' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());

    resolveRebuild({ ok: true, engines: { basic: { ok: true }, nexus: { ok: true } }, dayCount: 1, verifiedClaimCount: 0, insightCount: 0 });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('legacy mode (insightClaims off): reloads BOTH basic and nexus from cache, never re-generates a second time', async () => {
    const refreshBasicFromCache = vi.fn().mockResolvedValue(undefined);
    const refreshNexusFromCache = vi.fn().mockResolvedValue(undefined);
    useBasicInsights.mockReturnValue(baseBasicReturn({ refreshFromCache: refreshBasicFromCache }));
    useNexusInsights.mockReturnValue(baseNexusReturn({ refreshFromCache: refreshNexusFromCache }));
    const claimsRefresh = vi.fn().mockResolvedValue(undefined);
    useClaims.mockReturnValue(baseClaimsReturn({ refresh: claimsRefresh }));

    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild insights' }));

    await waitFor(() => expect(refreshBasicFromCache).toHaveBeenCalledTimes(1));
    expect(refreshNexusFromCache).toHaveBeenCalledTimes(1);
    // Claims mode's own refresh must not fire in legacy mode.
    expect(claimsRefresh).not.toHaveBeenCalled();
  });

  it('claims mode (insightClaims on): reloads claims via useClaims.refresh, never the legacy cache reloaders', async () => {
    getFlag.mockImplementation((name) => name === 'insightClaims');
    const refreshBasicFromCache = vi.fn().mockResolvedValue(undefined);
    const refreshNexusFromCache = vi.fn().mockResolvedValue(undefined);
    const claimsRefresh = vi.fn().mockResolvedValue(undefined);
    useBasicInsights.mockReturnValue(baseBasicReturn({ refreshFromCache: refreshBasicFromCache }));
    useNexusInsights.mockReturnValue(baseNexusReturn({ refreshFromCache: refreshNexusFromCache }));
    useClaims.mockReturnValue(baseClaimsReturn({ refresh: claimsRefresh }));

    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild insights' }));

    await waitFor(() => expect(claimsRefresh).toHaveBeenCalledTimes(1));
    expect(refreshBasicFromCache).not.toHaveBeenCalled();
    expect(refreshNexusFromCache).not.toHaveBeenCalled();
  });
});

describe('InsightsPage — Rebuild result states (Fix C)', () => {
  it('success-with-claims copy renders dayCount + verified count', async () => {
    getFlag.mockImplementation((name) => name === 'insightClaims');
    rebuildInsights.mockResolvedValue({
      ok: true,
      engines: { basic: { ok: true }, claims: { ok: true, count: 3 } },
      dayCount: 12,
      verifiedClaimCount: 3,
      insightCount: 3,
    });

    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild insights' }));

    expect(await screen.findByText('Insights rebuilt from 12 recorded days. 3 verified insights are available.')).toBeTruthy();
  });

  it('nothing-qualifies copy renders when the count is zero', async () => {
    rebuildInsights.mockResolvedValue({
      ok: true,
      engines: { basic: { ok: true }, nexus: { ok: true } },
      dayCount: 2,
      verifiedClaimCount: 0,
      insightCount: 0,
    });

    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild insights' }));

    expect(await screen.findByText('Rebuild complete. Nothing currently clears the evidence threshold.')).toBeTruthy();
  });

  it('failure copy renders and identifies that previous insights are still available', async () => {
    rebuildInsights.mockResolvedValue({
      ok: false,
      engines: { basic: { ok: false, error: 'boom' }, nexus: { ok: false, error: 'boom' } },
      dayCount: 0,
      verifiedClaimCount: 0,
      insightCount: 0,
    });

    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild insights' }));

    expect(await screen.findByText("We couldn't rebuild your insights. Your previous insights are still available.")).toBeTruthy();
  });

  it('a thrown rebuildInsights call still renders the failure copy (not a silent no-op)', async () => {
    rebuildInsights.mockRejectedValue(new Error('network down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild insights' }));

    expect(await screen.findByText("We couldn't rebuild your insights. Your previous insights are still available.")).toBeTruthy();
    warnSpy.mockRestore();
  });

  it('no result banner renders before the first rebuild is triggered', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    expect(screen.queryByText(/Rebuild complete|Insights rebuilt from|couldn.?t rebuild/)).toBeNull();
  });
});

describe('InsightsPage — ClaimFeed and Quick Insights refresh route through the same orchestration (Fix C)', () => {
  it('ClaimFeed\'s refresh button calls rebuildInsights (not a bare claims re-read)', async () => {
    getFlag.mockImplementation((name) => name === 'insightClaims');
    const claimsRefresh = vi.fn().mockResolvedValue(undefined);
    useClaims.mockReturnValue(baseClaimsReturn({
      claims: [{
        id: 'c1',
        claimType: 'observation',
        subject: 'gym',
        direction: 'positive',
        wording: 'wording for c1',
        limitations: ['limit'],
        analysisPlan: { hypothesisFamilyId: 'fam', candidateId: 'tag:gym' },
        evidence: { exposedDayCount: 1, comparisonDayCount: 1, observedSpanDays: 1, effectMoodPoints: 1, hiddenSensitiveSourceCount: 0, sourceEntryIds: [] },
        receipt: { sources: [] },
        status: 'verified',
        createdAt: '2026-07-20T00:00:00.000Z',
      }],
      refresh: claimsRefresh,
    }));

    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    await screen.findByText('wording for c1');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh insights' }));

    await waitFor(() => expect(rebuildInsights).toHaveBeenCalledTimes(1));
  });

  it('Quick Insights\' refresh button calls rebuildInsights (not the old regenerate-basic-only path)', async () => {
    useBasicInsights.mockReturnValue(baseBasicReturn({
      insights: [{
        id: 'basic-1',
        category: 'activity',
        insight: 'You tend to feel better on gym days.',
        moodDelta: 8,
        strength: 'moderate',
        direction: 'positive',
        sampleSize: 12,
        entryIds: ['e1'],
      }],
    }));

    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    await screen.findByText('You tend to feel better on gym days.');

    // Quick Insights' own icon-only refresh button carries no accessible
    // name of its own — scope to its section header (sibling of the
    // "Quick Insights" heading) to click the right control unambiguously.
    const sectionHeader = screen.getByText('Quick Insights').closest('.p-4');
    const quickInsightsRefresh = within(sectionHeader).getByRole('button');
    fireEvent.click(quickInsightsRefresh);

    await waitFor(() => expect(rebuildInsights).toHaveBeenCalledTimes(1));
  });
});
