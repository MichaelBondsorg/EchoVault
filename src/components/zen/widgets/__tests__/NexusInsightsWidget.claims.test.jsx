/**
 * NexusInsightsWidget — INS-01 claims-mode cutover (2026-07-24 review brief,
 * P0). Two things this file proves that NexusInsightsWidget.test.jsx and
 * NexusInsightsWidget.portalBubbling.test.jsx don't:
 *
 * 1. Flag-swap: `insightClaims=true` renders the compact claims card
 *    (top-ranked verified claim, via the real `rankClaims` — not mocked,
 *    so the ranking itself is exercised, not just wiring) and calls
 *    `useNexusInsights` with `enabled: false` — the acceptance gate's
 *    "zero current UI queries or generates Nexus for proactive display".
 *    `insightClaims=false` renders the legacy branch identically and calls
 *    `useNexusInsights` with `enabled: true`, unchanged from before INS-01.
 * 2. The claims card's receipt trigger opens the same ReceiptSheet the
 *    legacy card's trigger does, and a claim feedback event refreshes the
 *    claims list (mirrors InsightsPage.jsx's own `handleReceiptFeedback`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const getFlag = vi.fn();
vi.mock('../../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('../../GlassCard', () => ({
  default: ({ children, onClick }) => <div onClick={onClick}>{children}</div>,
}));

// Stubbed the same way NexusInsightsWidget.test.jsx stubs it — proves the
// widget wires the right props without pulling in ReceiptSheet's own
// dependency tree (Drawer/Dialog/vaul).
vi.mock('../../../insights/ReceiptSheet', () => ({
  default: ({ insight, entriesById, uid, open, onClose, onFeedback }) => {
    if (!open) return null;
    return (
      <div data-testid="receipt-sheet-stub">
        <p>{insight?.wording}</p>
        <p>uid:{uid}</p>
        <p>hasEntry:{entriesById?.e1 ? 'yes' : 'no'}</p>
        <button type="button" onClick={onClose}>
          Close receipt
        </button>
        <button type="button" onClick={() => onFeedback?.('do_not_analyze')}>
          Submit feedback
        </button>
      </div>
    );
  },
}));

const useNexusInsights = vi.fn();
vi.mock('../../../../hooks/useNexusInsights', () => ({
  useNexusInsights: (...a) => useNexusInsights(...a),
}));

const useClaims = vi.fn();
const refreshClaims = vi.fn();
vi.mock('../../../../hooks/useClaims', () => ({
  useClaims: (...a) => useClaims(...a),
}));

// rankClaims is NOT mocked — real ranking logic (claimType weight > |effect
// size| > recency) is exercised, matching ClaimFeed's own ordering.
import NexusInsightsWidget from '../NexusInsightsWidget';

const USER = { uid: 'user-1' };
const ENTRIES = [{ id: 'e1', content: 'Went for a walk, felt calmer.' }];

function claim(overrides = {}) {
  return {
    id: 'claim-1',
    claimType: 'pattern_to_watch',
    subject: 'gym',
    direction: 'positive',
    wording: 'On days you mention gym, mood tends to run higher than on comparison days.',
    limitations: ['This is one observed pattern in your own data, not a general conclusion.'],
    evidence: {
      exposedDayCount: 12,
      comparisonDayCount: 40,
      observedSpanDays: 60,
      effectMoodPoints: -7.4,
    },
    status: 'verified',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function legacyHookReturn(overrides = {}) {
  return {
    insights: [],
    isCalibrating: false,
    calibrationProgress: 0,
    loading: false,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockReset();
  useNexusInsights.mockReturnValue(legacyHookReturn());
  useClaims.mockReturnValue({ claims: [], loading: false, refresh: refreshClaims });
});

describe('NexusInsightsWidget — insightClaims flag ON', () => {
  beforeEach(() => {
    getFlag.mockImplementation((flag) => flag === 'insightClaims');
  });

  it('disables useNexusInsights (enabled: false) — no Nexus fetch/generate for display', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    expect(useNexusInsights).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ enabled: false })
    );
  });

  it('renders the top-ranked verified claim (real rankClaims, out-of-order input)', () => {
    const weak = claim({ id: 'weak', claimType: 'observation', effectMoodPoints: 1, createdAt: '2020-01-01T00:00:00.000Z' });
    const strong = claim({
      id: 'strong',
      claimType: 'experiment_result',
      wording: 'Your mood was higher on days you exercised, in your recent experiment.',
      effectMoodPoints: 9,
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    useClaims.mockReturnValue({ claims: [weak, strong], loading: false, refresh: refreshClaims });

    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);

    expect(screen.getByText('Experiment result')).toBeTruthy();
    expect(screen.getByText(strong.wording)).toBeTruthy();
    expect(screen.queryByText(weak.wording)).toBeNull();
  });

  it('badge label matches ClaimCard.jsx (badgeLabelFor) — same claim, same language as Insights', () => {
    useClaims.mockReturnValue({ claims: [claim({ claimType: 'pattern_to_watch' })], loading: false, refresh: refreshClaims });
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    expect(screen.getByText('Pattern to watch')).toBeTruthy();
  });

  it('loading state shows a spinner, not the legacy empty/populated copy', () => {
    useClaims.mockReturnValue({ claims: [], loading: true, refresh: refreshClaims });
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    expect(screen.queryByText(/Keep journaling/)).toBeNull();
  });

  it('empty state (no verified claims) shows non-apologetic copy, not the legacy empty copy', () => {
    useClaims.mockReturnValue({ claims: [], loading: false, refresh: refreshClaims });
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    expect(screen.getByText(/verified pattern will show up here/)).toBeTruthy();
    expect(screen.queryByText('Keep journaling to unlock personalized insights')).toBeNull();
  });

  it('"Why am I seeing this?" opens the receipt sheet with the claim (wording, uid, entriesById)', () => {
    useClaims.mockReturnValue({ claims: [claim()], loading: false, refresh: refreshClaims });
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);

    fireEvent.click(screen.getByText('Why am I seeing this?'));

    const sheet = screen.getByTestId('receipt-sheet-stub');
    expect(within(sheet).getByText(claim().wording)).toBeTruthy();
    expect(within(sheet).getByText('uid:user-1')).toBeTruthy();
    expect(within(sheet).getByText('hasEntry:yes')).toBeTruthy();
  });

  it('clicking the receipt trigger never navigates to /insights (stopPropagation)', () => {
    useClaims.mockReturnValue({ claims: [claim()], loading: false, refresh: refreshClaims });
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    fireEvent.click(screen.getByText('Why am I seeing this?'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a claim feedback submission refreshes the claims list (drops a suppressed claim without remount)', () => {
    useClaims.mockReturnValue({ claims: [claim()], loading: false, refresh: refreshClaims });
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);

    fireEvent.click(screen.getByText('Why am I seeing this?'));
    fireEvent.click(screen.getByText('Submit feedback'));

    expect(refreshClaims).toHaveBeenCalledTimes(1);
  });

  it('clicking elsewhere on the card still navigates to /insights (tap-through, unrelated to the claim actions)', () => {
    useClaims.mockReturnValue({ claims: [claim()], loading: false, refresh: refreshClaims });
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    fireEvent.click(screen.getByText('AI Insights'));
    expect(navigate).toHaveBeenCalledWith('/insights');
  });

  it('never renders a legacy Nexus insight even if useNexusInsights somehow returns one', () => {
    useNexusInsights.mockReturnValue(legacyHookReturn({
      insights: [{ id: 'legacy-1', type: 'pattern', title: 'Legacy insight', summary: 'Should never render.' }],
    }));
    useClaims.mockReturnValue({ claims: [claim()], loading: false, refresh: refreshClaims });

    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);

    expect(screen.queryByText('Legacy insight')).toBeNull();
    expect(screen.queryByText('Should never render.')).toBeNull();
  });
});

describe('NexusInsightsWidget — insightClaims flag OFF (unchanged legacy behavior)', () => {
  beforeEach(() => {
    getFlag.mockImplementation(() => false);
  });

  it('calls useNexusInsights with enabled: true (unchanged from pre-INS-01)', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    expect(useNexusInsights).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ enabled: true })
    );
  });

  it('ignores claims data entirely, even when useClaims returns a claim', () => {
    useClaims.mockReturnValue({ claims: [claim()], loading: false, refresh: refreshClaims });
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    expect(screen.queryByText(claim().wording)).toBeNull();
    expect(screen.queryByText('Pattern to watch')).toBeNull();
  });

  it('renders the legacy empty state when there are no Nexus insights', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    expect(screen.getByText('Keep journaling to unlock personalized insights')).toBeTruthy();
  });
});
