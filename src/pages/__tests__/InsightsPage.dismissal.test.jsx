/**
 * InsightsPage — Nexus dismissal write-through (R4 Task 5 + T5b fix, DR
 * finding 10).
 *
 * Before this fix, `handleDismissInsight` only ever touched
 * `dismissedInsights`, a local React-state `Set` that reset on reload.
 * This proves the click wires through to the durable write
 * (`recordInsightDismissal`), passing the FULL insight object (not just its
 * id — `recordInsightDismissal` derives a content-stable dismissal key
 * internally as of T5b; see `insightDismissal.test.js` for that unit-level
 * coverage, including the no-stable-key no-op), for both the quick-dismiss
 * (X) and report-then-dismiss paths — and that dismissing still removes the
 * card from view instantly (unchanged local-state behavior), so users get
 * both durability AND the existing instant feedback.
 *
 * Mocking scaffold mirrors InsightsPage.receiptTrigger.test.jsx (same file
 * mocks every hook/service InsightsPage touches).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

const reportInsight = vi.fn().mockResolvedValue(true);
vi.mock('../../services/moderation/reportInsight', () => ({
  reportInsight: (...a) => reportInsight(...a),
}));

vi.mock('../../services/analytics/insightEngagement', () => ({
  recordInsightEngagement: vi.fn().mockResolvedValue(true),
}));

const recordInsightDismissal = vi.fn().mockResolvedValue(true);
vi.mock('../../services/nexus/insightDismissal', () => ({
  recordInsightDismissal: (...a) => recordInsightDismissal(...a),
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
  summary: 'You tend to feel noticeably calmer on days you take an evening walk, based on several recent entries.',
  confidence: 0.8,
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
];

beforeEach(() => {
  vi.clearAllMocks();
  getFlag.mockReturnValue(false);
  useNexusInsights.mockReturnValue(baseNexusReturn());
  useBasicInsights.mockReturnValue(baseBasicReturn());
});

describe('InsightsPage — Nexus insight dismissal write-through', () => {
  it('clicking "Dismiss insight" persists via recordInsightDismissal(userId, insight) — the full object, not just its id — and removes the card', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    expect(screen.getByText('Evening walks lift your mood')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dismiss insight'));

    expect(recordInsightDismissal).toHaveBeenCalledWith('user-1', NEXUS_INSIGHT);
    expect(screen.queryByText('Evening walks lift your mood')).toBeNull();
  });

  it('reporting an insight also persists the dismissal (report-then-dismiss is durable too)', async () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    fireEvent.click(screen.getByLabelText('Report this insight as inappropriate'));

    await vi.waitFor(() => expect(reportInsight).toHaveBeenCalledWith('user-1', NEXUS_INSIGHT));
    expect(recordInsightDismissal).toHaveBeenCalledWith('user-1', NEXUS_INSIGHT);
  });

  it('an insight without a stable id still calls through to recordInsightDismissal — the no-op-when-no-key decision lives inside that module now (see insightDismissal.test.js), not in InsightsPage', () => {
    const idLessInsight = { ...NEXUS_INSIGHT, id: undefined, message: 'Untitled pattern' };
    useNexusInsights.mockReturnValue(baseNexusReturn({ insights: [idLessInsight] }));
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);

    fireEvent.click(screen.getByLabelText('Dismiss insight'));
    expect(recordInsightDismissal).toHaveBeenCalledWith('user-1', idLessInsight);
  });
});
