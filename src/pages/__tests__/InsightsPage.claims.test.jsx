/**
 * InsightsPage — claim-backed Quick Insights (R4 Phase 1, Task 10), extended
 * for the unified ranked feed (R4 Phase 2, Task 6).
 *
 * Flag OFF: the legacy Quick Insights section renders untouched, and
 * `listActiveClaims` is NEVER called — proven by mocking the underlying
 * `claimsService` module (not `useClaims` itself), so the REAL `useClaims`
 * hook runs and its internal `getFlag('insightClaims')` gate is what's
 * actually under test.
 *
 * Flag ON: `ClaimCard`s render from the mocked claims (via `ClaimFeed`),
 * "See days"/"Feedback" both open the ReceiptSheet mount site
 * (`onShowReceipt`), and "Try as an experiment" fires the page's stub
 * handler.
 *
 * Phase 2 Task 6 additions (bottom of file): flag ON replaces BOTH the
 * Quick Insights block AND the AI Insights (Nexus) block with the single
 * `ClaimFeed`, hides `RecommendationsSection`, disables `useNexusInsights`
 * (`enabled: false` — proven via the mock's call args, not just its
 * output), and leaves `CorrelationsSection` untouched.
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

vi.mock('../../services/environment/environmentCorrelations', () => ({
  computeEnvironmentMoodCorrelations: vi.fn(() => null),
  getTopEnvironmentInsights: vi.fn(() => []),
  checkEnvironmentDataSufficiency: vi.fn(() => ({ hasEnoughData: false, message: '' })),
}));

const getTodayRecommendations = vi.fn().mockResolvedValue(null);
vi.mock('../../services/nexus/insightIntegration', () => ({
  getTodayRecommendations: (...a) => getTodayRecommendations(...a),
}));

const checkHealthDataSufficiency = vi.fn(() => ({ hasEnoughData: false, message: '' }));
const computeHealthMoodCorrelations = vi.fn(() => null);
const getTopHealthInsights = vi.fn(() => []);
vi.mock('../../services/health/healthCorrelations', () => ({
  computeHealthMoodCorrelations: (...a) => computeHealthMoodCorrelations(...a),
  getTopHealthInsights: (...a) => getTopHealthInsights(...a),
  checkHealthDataSufficiency: (...a) => checkHealthDataSufficiency(...a),
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

// R4 Phase 2, Task 6: the unified ranked feed. Flag ON swaps BOTH the Quick
// Insights block AND the AI Insights (Nexus) block for one `ClaimFeed`,
// hides `RecommendationsSection`, and disables `useNexusInsights` entirely
// (no dark fetch/budget work for a section that never renders) — while
// `CorrelationsSection` stays untouched. Flag OFF must remain byte-identical
// to the legacy tree (already proven above and by the other InsightsPage.*
// suites); this block only adds the flag-ON-specific assertions the earlier
// Task 10 suite didn't need.
const NEXUS_INSIGHT_WITH_QUALITY_CONTENT = {
  id: 'nexus-1',
  type: 'pattern',
  title: 'Evening walks lift your mood',
  body: 'On the days you mentioned an evening walk, your recorded mood ran noticeably higher than on other days in the same period.',
  confidence: 0.8,
};

describe('InsightsPage — R4 Phase 2 Task 6: unified feed replaces Quick Insights + AI Insights', () => {
  beforeEach(() => {
    getFlag.mockImplementation((name) => name === 'insightClaims');
    // Even if useNexusInsights (mocked) were to return real insights, the
    // Nexus section must not render when insightClaims is ON — this proves
    // the ternary hides the section rather than merely relying on the
    // (real) hook happening to return nothing when disabled.
    useNexusInsights.mockReturnValue(baseNexusReturn({
      insights: [NEXUS_INSIGHT_WITH_QUALITY_CONTENT],
      insightCount: 1,
    }));
    getTodayRecommendations.mockResolvedValue({
      recommendations: [{ action: 'Take an evening walk', priority: 'medium', type: 'activity' }],
      basedOn: { entriesAnalyzed: 10, interventionsTracked: 0 },
    });
  });

  it('renders the ClaimFeed (group header + claim wording) in place of the legacy Quick Insights section', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    await screen.findByText(VERIFIED_TAG_CLAIM.wording);
    expect(screen.getByText('1 pattern to watch')).toBeTruthy();
  });

  it('does not render the AI Insights (Nexus) section even though useNexusInsights would return content', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    await screen.findByText(VERIFIED_TAG_CLAIM.wording);
    expect(screen.queryByText('AI Insights')).toBeNull();
    expect(screen.queryByText(NEXUS_INSIGHT_WITH_QUALITY_CONTENT.title)).toBeNull();
  });

  it('does not render RecommendationsSection even though it would have content', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    await screen.findByText(VERIFIED_TAG_CLAIM.wording);
    expect(screen.queryByText("Today's Recommendations")).toBeNull();
    expect(screen.queryByText('Take an evening walk')).toBeNull();
  });

  // Review finding (important, cheap, R4 Phase 2 Task 6): the
  // recommendations-loading effect still called getTodayRecommendations
  // flag-ON even though RecommendationsSection is hidden in that mode — a
  // dark Firestore read for a section nobody sees. Guarded with an
  // early-return on getFlag('insightClaims').
  it('never calls getTodayRecommendations (the section is hidden flag-ON — avoid a dark Firestore read)', async () => {
    render(
      <InsightsPage
        entries={ENTRIES}
        userId="user-1"
        user={{ uid: 'user-1' }}
        todayHealth={{ sleepHours: 7 }}
      />,
    );

    await screen.findByText(VERIFIED_TAG_CLAIM.wording);
    expect(getTodayRecommendations).not.toHaveBeenCalled();
  });

  it('calls useNexusInsights with enabled:false (no dark fetch/budget work for a hidden section)', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    await screen.findByText(VERIFIED_TAG_CLAIM.wording);
    expect(useNexusInsights).toHaveBeenCalledWith(
      { uid: 'user-1' },
      expect.objectContaining({ enabled: false }),
    );
  });

  it('still renders CorrelationsSection when there is enough health/environment data', async () => {
    checkHealthDataSufficiency.mockReturnValueOnce({ hasEnoughData: true, message: '' });
    computeHealthMoodCorrelations.mockReturnValueOnce({ someCorrelation: true });
    getTopHealthInsights.mockReturnValueOnce([
      { metric: 'sleep', insight: 'Better sleep, better mood.', strength: 'moderate', sampleSize: 12 },
    ]);

    const manyEntries = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`,
      content: 'entry',
      createdAt: '2026-07-18T10:00:00.000Z',
    }));

    render(<InsightsPage entries={manyEntries} userId="user-1" user={{ uid: 'user-1' }} />);

    await screen.findByText(VERIFIED_TAG_CLAIM.wording);
    expect(screen.getByText('Your Patterns')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// R4 Phase 3 Task 2: RecommendationsSection idea→experiment CTAs
// ---------------------------------------------------------------------------
//
// Idea→template map (Shared contracts): recovery -> 'recovery-score-mood',
// activity -> 'exercise-minutes-mood', environment -> 'sunshine-percent-mood';
// self_care/other -> no button. Buttons only render when BOTH
// `personalExperiments` is on AND the parent supplied a real
// `onTryExperiment` handler — same "mapped && handler present" gate as
// ClaimCard's own "Try as an experiment" (F4).
describe('InsightsPage — R4 Phase 3 Task 2: RecommendationsSection "Try as an experiment"', () => {
  const IDEA_RECS = {
    recommendations: [
      { action: 'Prioritize recovery tonight', priority: 'medium', type: 'recovery' },
      { action: 'Take a short walk', priority: 'medium', type: 'activity' },
      { action: 'Get some sunshine', priority: 'low', type: 'environment' },
      { action: 'Try a self-care ritual', priority: 'low', type: 'self_care' },
      { action: 'Something unmapped', priority: 'low', type: 'other' },
    ],
    basedOn: { entriesAnalyzed: 10, interventionsTracked: 0 },
  };

  beforeEach(() => {
    // insightClaims OFF (legacy tree, where RecommendationsSection lives).
    getTodayRecommendations.mockResolvedValue(IDEA_RECS);
  });

  it('renders "Try as an experiment" only for mapped idea types when personalExperiments is on and a handler is supplied', async () => {
    getFlag.mockImplementation((name) => name === 'personalExperiments');
    const onTryExperiment = vi.fn();
    render(
      <InsightsPage
        entries={ENTRIES}
        userId="user-1"
        user={{ uid: 'user-1' }}
        todayHealth={{ sleepHours: 7 }}
        onTryExperiment={onTryExperiment}
      />,
    );

    await screen.findByText("Today's Recommendations");
    const buttons = screen.getAllByText('Try as an experiment');
    expect(buttons).toHaveLength(3); // recovery, activity, environment — not self_care/other.
  });

  it('clicking each mapped idea button calls onTryExperiment with the correct template id', async () => {
    getFlag.mockImplementation((name) => name === 'personalExperiments');
    const onTryExperiment = vi.fn();
    render(
      <InsightsPage
        entries={ENTRIES}
        userId="user-1"
        user={{ uid: 'user-1' }}
        todayHealth={{ sleepHours: 7 }}
        onTryExperiment={onTryExperiment}
      />,
    );

    await screen.findByText("Today's Recommendations");
    const buttons = screen.getAllByText('Try as an experiment');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    fireEvent.click(buttons[2]);

    expect(onTryExperiment).toHaveBeenNthCalledWith(1, 'recovery-score-mood', undefined);
    expect(onTryExperiment).toHaveBeenNthCalledWith(2, 'exercise-minutes-mood', undefined);
    expect(onTryExperiment).toHaveBeenNthCalledWith(3, 'sunshine-percent-mood', undefined);
  });

  it('renders no idea buttons when personalExperiments is off, even with a real handler supplied', async () => {
    getFlag.mockImplementation(() => false);
    const onTryExperiment = vi.fn();
    render(
      <InsightsPage
        entries={ENTRIES}
        userId="user-1"
        user={{ uid: 'user-1' }}
        todayHealth={{ sleepHours: 7 }}
        onTryExperiment={onTryExperiment}
      />,
    );

    await screen.findByText("Today's Recommendations");
    expect(screen.queryByText('Try as an experiment')).toBeNull();
  });

  it('renders no idea buttons when personalExperiments is on but no onTryExperiment handler is supplied', async () => {
    getFlag.mockImplementation((name) => name === 'personalExperiments');
    render(
      <InsightsPage
        entries={ENTRIES}
        userId="user-1"
        user={{ uid: 'user-1' }}
        todayHealth={{ sleepHours: 7 }}
      />,
    );

    await screen.findByText("Today's Recommendations");
    expect(screen.queryByText('Try as an experiment')).toBeNull();
  });

  it('flag-OFF page (insightClaims off, personalExperiments off): zero "Try as an experiment" buttons anywhere, including ClaimCard\'s (which never renders in this mode anyway)', async () => {
    getFlag.mockImplementation(() => false);
    render(
      <InsightsPage
        entries={ENTRIES}
        userId="user-1"
        user={{ uid: 'user-1' }}
        todayHealth={{ sleepHours: 7 }}
        onTryExperiment={vi.fn()}
      />,
    );

    await screen.findByText("Today's Recommendations");
    expect(screen.queryAllByText('Try as an experiment')).toHaveLength(0);
  });
});

describe('InsightsPage — R4 Phase 2 Task 6: flag OFF stays on the legacy tree', () => {
  beforeEach(() => {
    getFlag.mockImplementation(() => false);
  });

  it('calls useNexusInsights with enabled:true (unchanged from pre-Task-6 behavior)', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    expect(useNexusInsights).toHaveBeenCalledWith(
      { uid: 'user-1' },
      expect.objectContaining({ enabled: true }),
    );
  });

  it('never renders a ClaimFeed group-summary header', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    expect(screen.queryByText(/pattern to watch$/)).toBeNull();
  });
});
