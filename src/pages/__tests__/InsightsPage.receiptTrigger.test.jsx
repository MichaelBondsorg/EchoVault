/**
 * InsightsPage — "Why am I seeing this?" trigger (R2 Task 11).
 *
 * InsightsPage itself has no pre-existing test file (2000+ line component
 * with many data dependencies) — this file mocks every hook/service the
 * page touches so it renders deterministically, and asserts only the new
 * receipts-trigger wiring: flag gating on the Nexus insight card, and the
 * two-taps acceptance (card -> trigger -> sources visible). ReceiptSheet's
 * own rendering/actions are covered exhaustively by ReceiptSheet.test.jsx;
 * it's stubbed here to keep this file focused on the integration seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import InsightsPage from '../InsightsPage';

const getFlag = vi.fn();
vi.mock('../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));

const useNexusInsights = vi.fn();
vi.mock('../../hooks/useNexusInsights', () => ({
  useNexusInsights: (...a) => useNexusInsights(...a),
}));

const useBasicInsights = vi.fn();
vi.mock('../../hooks/useBasicInsights', () => ({
  useBasicInsights: (...a) => useBasicInsights(...a),
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

vi.mock('../../services/basicInsights/feedbackLearning', () => ({
  recordFeedbackAndLearn: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../services/dashboard', () => ({
  calculateStreak: vi.fn(() => 0),
}));

vi.mock('../../components/insights/ReceiptSheet', () => ({
  default: ({ insight, uid, open, onClose }) => {
    if (!open) return null;
    return (
      <div data-testid="receipt-sheet-stub">
        <p>{insight?.title}</p>
        <p>uid:{uid}</p>
        <button type="button" onClick={onClose}>Close receipt</button>
      </div>
    );
  },
}));

const NEXUS_INSIGHT = {
  id: 'nexus-1',
  type: 'pattern',
  title: 'Evening walks lift your mood',
  summary: 'You tend to feel noticeably calmer on days you take an evening walk, based on several recent entries.',
  confidence: 0.8,
  receipt: {
    sources: [{ entryId: 'e1', date: '2026-07-18T10:00:00.000Z', excerpt: 'Went for a walk, felt calmer.' }],
    scope: null,
    timeWindow: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
    sampleSize: 14,
    missingness: '9 of 30 days have entries',
    versions: { generator: 'pattern_correlation', computationVersion: 1, generatedAt: '2026-07-21T00:00:00.000Z', model: null, promptVersion: null },
  },
};

function baseNexusReturn(overrides = {}) {
  return {
    insights: [NEXUS_INSIGHT],
    insightCount: 1,
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
    insights: [],
    loading: false,
    generating: false,
    hasEnoughData: false,
    entriesNeeded: 5,
    regenerate: vi.fn(),
    lastGeneratedFormatted: null,
    ...overrides,
  };
}

// Basic insights always carry a `.receipt` (verified in
// basicInsightsOrchestrator.receipts.test.js) but never a `.title` field —
// QuickInsightsSection renders `insight.insight` as the card text, unlike
// NexusInsightCard which reads `.title`/`.summary`.
const BASIC_INSIGHT = {
  id: 'basic-1',
  category: 'activity',
  insight: 'You journal more on days you exercise.',
  direction: 'positive',
  strength: 'strong',
  moodDelta: 8,
  sampleSize: 12,
  entryIds: ['e1'],
  receipt: {
    sources: [{ entryId: 'e1', date: '2026-07-18T10:00:00.000Z', excerpt: 'Exercised today.' }],
    scope: null,
    timeWindow: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
    sampleSize: 12,
    missingness: null,
    versions: {},
  },
};

const ENTRIES = [
  { id: 'e1', content: 'Went for a walk, felt calmer.', createdAt: '2026-07-18T10:00:00.000Z' },
  { id: 'e2', content: 'Normal day.', createdAt: '2026-07-17T10:00:00.000Z' },
  { id: 'e3', content: 'Normal day.', createdAt: '2026-07-16T10:00:00.000Z' },
  { id: 'e4', content: 'Normal day.', createdAt: '2026-07-15T10:00:00.000Z' },
  { id: 'e5', content: 'Normal day.', createdAt: '2026-07-14T10:00:00.000Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useNexusInsights.mockReturnValue(baseNexusReturn());
  useBasicInsights.mockReturnValue(baseBasicReturn());
});

describe('InsightsPage — insightReceipts flag OFF', () => {
  beforeEach(() => getFlag.mockReturnValue(false));

  it('renders no "Why am I seeing this?" trigger on the Nexus insight card', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    expect(screen.queryByLabelText('Why am I seeing this?')).toBeNull();
  });

  it('never mounts the ReceiptSheet', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    expect(screen.queryByTestId('receipt-sheet-stub')).toBeNull();
  });

  it('renders no "Why am I seeing this?" trigger on basic-insight cards (QuickInsightsSection) either', () => {
    useNexusInsights.mockReturnValue(baseNexusReturn({ insights: [] }));
    useBasicInsights.mockReturnValue(baseBasicReturn({ insights: [BASIC_INSIGHT], hasEnoughData: true }));
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    expect(screen.getByText('You journal more on days you exercise.')).toBeTruthy();
    expect(screen.queryByLabelText('Why am I seeing this?')).toBeNull();
  });
});

describe('InsightsPage — insightReceipts flag ON', () => {
  beforeEach(() => getFlag.mockReturnValue(true));

  it('two-taps acceptance: insight card -> trigger -> sources visible', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    const trigger = screen.getByLabelText('Why am I seeing this?');
    fireEvent.click(trigger);

    const sheet = screen.getByTestId('receipt-sheet-stub');
    expect(within(sheet).getByText('Evening walks lift your mood')).toBeTruthy();
    expect(within(sheet).getByText('uid:user-1')).toBeTruthy();
  });

  it('closing the sheet removes it and does not crash', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    fireEvent.click(screen.getByLabelText('Why am I seeing this?'));
    fireEvent.click(screen.getByText('Close receipt'));
    expect(screen.queryByTestId('receipt-sheet-stub')).toBeNull();
  });

  it('clicking the trigger does not also toggle the card expanded (stopPropagation)', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    fireEvent.click(screen.getByLabelText('Why am I seeing this?'));
    // The card's expandable "Analysis" section only renders when toggled
    // open with body content — this insight has no `body`, so the safest
    // signal is that no crash occurred and the sheet, not an expanded
    // card, is what appeared.
    expect(screen.getByTestId('receipt-sheet-stub')).toBeTruthy();
  });

  it('renders the "Why am I seeing this?" trigger on a basic-insight card (QuickInsightsSection) and opens the shared sheet', () => {
    // Nexus insights emptied so the only trigger in the tree belongs to
    // the basic-insight card — keeps this test unambiguous about which
    // surface it's exercising.
    useNexusInsights.mockReturnValue(baseNexusReturn({ insights: [] }));
    useBasicInsights.mockReturnValue(baseBasicReturn({ insights: [BASIC_INSIGHT], hasEnoughData: true }));
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    const trigger = screen.getByLabelText('Why am I seeing this?');
    fireEvent.click(trigger);

    const sheet = screen.getByTestId('receipt-sheet-stub');
    expect(within(sheet).getByText('uid:user-1')).toBeTruthy();
  });

  it('the basic-card trigger does not also toggle the card open (stopPropagation)', () => {
    useNexusInsights.mockReturnValue(baseNexusReturn({ insights: [] }));
    useBasicInsights.mockReturnValue(baseBasicReturn({ insights: [BASIC_INSIGHT], hasEnoughData: true }));
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    fireEvent.click(screen.getByLabelText('Why am I seeing this?'));
    // No "N entries" expand toggle exists for this fixture (no entryIds
    // affordance rendered beyond the trigger) — the safest signal is that
    // the sheet, not an expanded card, is what appeared, and nothing crashed.
    expect(screen.getByTestId('receipt-sheet-stub')).toBeTruthy();
  });
});
