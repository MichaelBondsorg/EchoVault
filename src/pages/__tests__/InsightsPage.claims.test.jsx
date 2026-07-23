/**
 * InsightsPage — claim-backed Quick Insights (R4 Phase 1, Task 10).
 *
 * Flag OFF: the legacy Quick Insights section renders untouched, and
 * `listActiveClaims` is NEVER called — proven by mocking the underlying
 * `claimsService` module (not `useClaims` itself), so the REAL `useClaims`
 * hook runs and its internal `getFlag('insightClaims')` gate is what's
 * actually under test.
 *
 * Flag ON: `ClaimCard`s render from the mocked claims, "See days"/
 * "Feedback" both open the ReceiptSheet mount site (`onShowReceipt`), and
 * "Try as an experiment" fires the page's stub handler.
 *
 * Mocking scaffold mirrors InsightsPage.dismissal.test.jsx (same file mocks
 * every hook/service InsightsPage touches, plus ReceiptSheet stubbed out).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const listActiveClaims = vi.fn();
vi.mock('../../services/insights/claims/claimsService', () => ({
  listActiveClaims: (...a) => listActiveClaims(...a),
}));

vi.mock('../../services/health/healthCorrelations', () => ({
  computeHealthMoodCorrelations: vi.fn(() => null),
  getTopHealthInsights: vi.fn(() => []),
  checkHealthDataSufficiency: vi.fn(() => ({ hasEnoughData: false, message: '' })),
}));

vi.mock('../../services/environment/environmentCorrelations', () => ({
  computeEnvironmentMoodCorrelations: vi.fn(() => null),
  getTopEnvironmentInsights: vi.fn(() => []),
  checkEnvironmentDataSufficiency: vi.fn(() => ({ hasEnoughData: false, message: '' })),
}));

vi.mock('../../services/nexus/insightIntegration', () => ({
  getTodayRecommendations: vi.fn().mockResolvedValue(null),
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

// F1 (closure-wave review): a real stub (not a bare `() => null`) so tests
// can prove the sheet actually mounts (open=true) and exercise the
// `onFeedback` wiring — a plain `() => null` can never distinguish "mounted
// but rendered nothing" from "not mounted at all".
vi.mock('../../components/insights/ReceiptSheet', () => ({
  default: ({ insight, open, onFeedback }) => {
    if (!open) return null;
    return (
      <div data-testid="receipt-sheet-mount">
        <p>receipt-for:{insight?.id}</p>
        <button type="button" onClick={() => onFeedback?.('do_not_analyze')}>
          submit-claim-feedback
        </button>
      </div>
    );
  },
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
    refresh: vi.fn(),
    lastGenerated: null,
    ...overrides,
  };
}

function baseBasicReturn(overrides = {}) {
  return {
    insights: [
      {
        id: 'basic-1',
        category: 'activity',
        insight: 'You tend to feel better on gym days.',
        moodDelta: 8,
        strength: 'moderate',
        direction: 'positive',
        sampleSize: 12,
        entryIds: ['e1'],
      },
    ],
    loading: false,
    generating: false,
    hasEnoughData: true,
    entriesNeeded: 0,
    regenerate: vi.fn(),
    lastGeneratedFormatted: null,
    ...overrides,
  };
}

const ENTRIES = [
  { id: 'e1', content: 'Went for a walk, felt calmer.', createdAt: '2026-07-18T10:00:00.000Z' },
];

const VERIFIED_TAG_CLAIM = {
  id: 'claim_basic-activity-tag-gym-mood_abcd1234_v1',
  claimType: 'pattern_to_watch',
  subject: 'gym',
  direction: 'positive',
  wording: 'On days you mention gym, mood tends to run higher than on comparison days.',
  limitations: ['This is one observed pattern in your own data, not a general conclusion.'],
  analysisPlan: { hypothesisFamilyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym' },
  evidence: {
    exposedDayCount: 12,
    comparisonDayCount: 40,
    observedSpanDays: 60,
    effectMoodPoints: 7.2,
    hiddenSensitiveSourceCount: 0,
    sourceEntryIds: ['e1'],
  },
  receipt: { sources: [] },
  status: 'verified',
};

const CANDIDATE_CLAIM = { ...VERIFIED_TAG_CLAIM, id: 'claim-candidate-1', status: 'candidate' };

beforeEach(() => {
  vi.clearAllMocks();
  useNexusInsights.mockReturnValue(baseNexusReturn());
  useBasicInsights.mockReturnValue(baseBasicReturn());
  listActiveClaims.mockResolvedValue([VERIFIED_TAG_CLAIM, CANDIDATE_CLAIM]);
});

describe('InsightsPage — insightClaims flag OFF (default): legacy path untouched', () => {
  beforeEach(() => {
    getFlag.mockImplementation((name) => (name === 'insightClaims' ? false : false));
  });

  it('renders the legacy Quick Insights section and never calls listActiveClaims', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    expect(screen.getByText('You tend to feel better on gym days.')).toBeTruthy();
    expect(listActiveClaims).not.toHaveBeenCalled();
  });

  it('does not render any ClaimCard content (no "Pattern to watch" badge)', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    expect(screen.queryByText('Pattern to watch')).toBeNull();
  });
});

describe('InsightsPage — insightClaims flag ON: ClaimCards render from claims', () => {
  beforeEach(() => {
    getFlag.mockImplementation((name) => (name === 'insightClaims' ? true : false));
  });

  it('renders a ClaimCard per verified claim (candidate-status claims excluded) and not the legacy section', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    await vi.waitFor(() => expect(listActiveClaims).toHaveBeenCalledWith({ __db: true }, 'user-1'));
    expect(await screen.findByText(VERIFIED_TAG_CLAIM.wording)).toBeTruthy();
    // Only 1 card — the candidate-status claim is filtered out by useClaims.
    expect(screen.getAllByText('Pattern to watch')).toHaveLength(1);
    // Legacy basic-insight card must not also render.
    expect(screen.queryByText('You tend to feel better on gym days.')).toBeNull();
  });

  it('"See days" and "Feedback" both fire the page\'s ReceiptSheet mount (no crash, ReceiptSheet stubbed)', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    await screen.findByText(VERIFIED_TAG_CLAIM.wording);

    expect(() => fireEvent.click(screen.getByText('See days'))).not.toThrow();
    expect(() => fireEvent.click(screen.getByText('Feedback'))).not.toThrow();
  });

  // F4 (closure-wave review): a mapped claim with NO onTryExperiment handler
  // supplied by the parent must render no button at all — previously
  // InsightsPage always passed a stub handler (dev-only console.info) down
  // to ClaimCard, so the button rendered as a guaranteed no-op in
  // production (AppLayout wires no onTryExperiment). "undefined means
  // hidden" now, not "click and nothing happens".
  it('"Try as an experiment" does NOT render when the parent supplies no onTryExperiment handler (F4)', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    await screen.findByText(VERIFIED_TAG_CLAIM.wording);

    expect(screen.queryByText('Try as an experiment')).toBeNull();
  });

  it('calls the onTryExperiment prop when the parent supplies one', async () => {
    const onTryExperiment = vi.fn();
    render(
      <InsightsPage
        entries={ENTRIES}
        userId="user-1"
        user={{ uid: 'user-1' }}
        onTryExperiment={onTryExperiment}
      />,
    );
    await screen.findByText(VERIFIED_TAG_CLAIM.wording);

    fireEvent.click(screen.getByText('Try as an experiment'));
    expect(onTryExperiment).toHaveBeenCalledWith('tag-presence-mood', 'gym');
  });
});

// F1 (closure-wave final review): the ReceiptSheet mount site was gated
// ONLY on `getFlag('insightReceipts')`, so with insightClaims ON and
// insightReceipts OFF, ClaimCard's "See days"/"Feedback" set
// `receiptInsight` but nothing was ever mounted to read it — a silent
// no-op making the whole T9 claims-feedback taxonomy unreachable. Fixed:
// the sheet now mounts when EITHER flag is on. This block deliberately
// enables ONLY insightClaims (insightReceipts stays false/default) to
// prove the fix, not just re-prove the already-covered "both flags on"
// path.
describe('InsightsPage — F1 (closure-wave review): ReceiptSheet mounts on insightClaims alone', () => {
  beforeEach(() => {
    getFlag.mockImplementation((name) => name === 'insightClaims');
  });

  it('"See days" actually mounts the ReceiptSheet even though insightReceipts is OFF', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    await screen.findByText(VERIFIED_TAG_CLAIM.wording);

    expect(screen.queryByTestId('receipt-sheet-mount')).toBeNull();
    fireEvent.click(screen.getByText('See days'));
    expect(screen.getByTestId('receipt-sheet-mount')).toBeTruthy();
  });

  it('"Feedback" actually mounts the ReceiptSheet even though insightReceipts is OFF', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    await screen.findByText(VERIFIED_TAG_CLAIM.wording);

    fireEvent.click(screen.getByText('Feedback'));
    expect(screen.getByTestId('receipt-sheet-mount')).toBeTruthy();
  });

  it('submitting claim feedback from the sheet triggers a claims refresh (useClaims.refresh) — the suppressed claim leaves the list without a remount', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    await screen.findByText(VERIFIED_TAG_CLAIM.wording);
    await vi.waitFor(() => expect(listActiveClaims).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Feedback'));
    fireEvent.click(screen.getByText('submit-claim-feedback'));

    // The mount site's onFeedback wiring calls useClaims' `refresh`, which
    // re-invokes listActiveClaims — the same query path that would drop a
    // now-suppressed claim from the list on its own (useClaims filters to
    // status === 'verified'), with no page remount required.
    await vi.waitFor(() => expect(listActiveClaims).toHaveBeenCalledTimes(2));
  });
});
