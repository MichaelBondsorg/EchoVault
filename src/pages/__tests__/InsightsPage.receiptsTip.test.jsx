/**
 * InsightsPage — "Why am I seeing this?" first-use tip (What's New /
 * receipts follow-up task).
 *
 * Covers: flag-off byte-identical nothing, tip shows once a receipt-bearing
 * insight is visible with insightReceipts on, dismiss persists (owner-scoped
 * key) and swaps in the HelpCircle re-show affordance, and the re-show
 * button brings the tip back.
 *
 * Mocking scaffold mirrors InsightsPage.receiptTrigger.test.jsx (same file
 * mocks every hook/service InsightsPage touches) — kept as a separate file
 * per that file's own note that InsightsPage has no general-purpose test
 * file, to keep each file focused on one integration seam.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InsightsPage from '../InsightsPage';
import { ownerStorageKey } from '../../services/storage/ownerScopedStorage';

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

const NEXUS_INSIGHT = {
  id: 'nexus-1',
  type: 'pattern',
  title: 'Evening walks lift your mood',
  summary: 'You tend to feel noticeably calmer on days you take an evening walk.',
  confidence: 0.8,
  receipt: {
    sources: [{ entryId: 'e1', date: '2026-07-18T10:00:00.000Z', excerpt: 'Went for a walk.' }],
    scope: null,
    timeWindow: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
    sampleSize: 14,
    missingness: null,
    versions: {},
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

const ENTRIES = [
  { id: 'e1', content: 'Went for a walk, felt calmer.', createdAt: '2026-07-18T10:00:00.000Z' },
  { id: 'e2', content: 'Normal day.', createdAt: '2026-07-17T10:00:00.000Z' },
  { id: 'e3', content: 'Normal day.', createdAt: '2026-07-16T10:00:00.000Z' },
  { id: 'e4', content: 'Normal day.', createdAt: '2026-07-15T10:00:00.000Z' },
  { id: 'e5', content: 'Normal day.', createdAt: '2026-07-14T10:00:00.000Z' },
];

const UID = 'user-1';

// See WhatsNewModal.test.jsx / RevisitControls.test.jsx for why: the global
// test setup stubs `window.localStorage` as bare jest.fn() spies with no
// real storage behind them — give those spies an in-memory backing store.
const localStorageStore = new Map();

beforeEach(() => {
  vi.clearAllMocks();
  localStorageStore.clear();
  window.localStorage.getItem.mockImplementation((key) => (localStorageStore.has(key) ? localStorageStore.get(key) : null));
  window.localStorage.setItem.mockImplementation((key, value) => { localStorageStore.set(key, String(value)); });
  window.localStorage.removeItem.mockImplementation((key) => { localStorageStore.delete(key); });
  window.localStorage.clear.mockImplementation(() => { localStorageStore.clear(); });
  useNexusInsights.mockReturnValue(baseNexusReturn());
  useBasicInsights.mockReturnValue(baseBasicReturn());
});

describe('InsightsPage receipts tip — insightReceipts flag OFF', () => {
  beforeEach(() => getFlag.mockReturnValue(false));

  it('renders no tip and no re-show button (byte-identical nothing)', () => {
    render(<InsightsPage entries={ENTRIES} userId={UID} user={{ uid: UID }} />);
    expect(screen.queryByText("See what's behind an insight")).toBeNull();
    expect(screen.queryByLabelText('Show tip: why am I seeing this?')).toBeNull();
  });
});

describe('InsightsPage receipts tip — insightReceipts flag ON', () => {
  beforeEach(() => getFlag.mockReturnValue(true));

  it('shows the tip once a receipt-bearing insight is visible', () => {
    render(<InsightsPage entries={ENTRIES} userId={UID} user={{ uid: UID }} />);
    expect(screen.getByText("See what's behind an insight")).toBeTruthy();
    // Re-show button only appears once the tip has been dismissed.
    expect(screen.queryByLabelText('Show tip: why am I seeing this?')).toBeNull();
  });

  it('does not show the tip when there are no insights to point at', () => {
    useNexusInsights.mockReturnValue(baseNexusReturn({ insights: [] }));
    useBasicInsights.mockReturnValue(baseBasicReturn({ insights: [], hasEnoughData: false }));
    render(<InsightsPage entries={ENTRIES} userId={UID} user={{ uid: UID }} />);
    expect(screen.queryByText("See what's behind an insight")).toBeNull();
  });

  it('dismissing hides the tip and reveals the HelpCircle re-show button', () => {
    render(<InsightsPage entries={ENTRIES} userId={UID} user={{ uid: UID }} />);
    fireEvent.click(screen.getByLabelText('Dismiss tip'));

    expect(screen.queryByText("See what's behind an insight")).toBeNull();
    expect(screen.getByLabelText('Show tip: why am I seeing this?')).toBeTruthy();
  });

  it('the re-show button brings the tip back', () => {
    render(<InsightsPage entries={ENTRIES} userId={UID} user={{ uid: UID }} />);
    fireEvent.click(screen.getByLabelText('Dismiss tip'));
    fireEvent.click(screen.getByLabelText('Show tip: why am I seeing this?'));

    expect(screen.getByText("See what's behind an insight")).toBeTruthy();
  });

  it('dismissal persists across remount via an owner-scoped key', () => {
    const { unmount } = render(<InsightsPage entries={ENTRIES} userId={UID} user={{ uid: UID }} />);
    fireEvent.click(screen.getByLabelText('Dismiss tip'));
    unmount();

    const expectedKey = ownerStorageKey(UID, 'insights/receiptsTipDismissed');
    expect(localStorageStore.get(expectedKey)).toBe('true');

    render(<InsightsPage entries={ENTRIES} userId={UID} user={{ uid: UID }} />);
    expect(screen.queryByText("See what's behind an insight")).toBeNull();
    expect(screen.getByLabelText('Show tip: why am I seeing this?')).toBeTruthy();
  });
});
