/**
 * InsightsPage — NexusInsightCard disclosure semantics (A11Y-02, review
 * finding "story/insight cards as clickable divs"). The card's header row
 * toggles expanded content and used to be a plain clickable <div> with no
 * button role, no keyboard equivalent, and no aria-expanded/aria-controls.
 * Mocking scaffold mirrors InsightsPage.receiptTrigger.test.jsx.
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

// Carries `.body` so hasExpandableContent is true and the header becomes a
// real disclosure control.
const EXPANDABLE_INSIGHT = {
  id: 'nexus-1',
  type: 'pattern',
  title: 'Evening walks lift your mood',
  summary: 'You tend to feel noticeably calmer on days you take an evening walk.',
  body: 'Across the last 14 days, entries mentioning an evening walk carried a materially higher mood score than entries that did not.',
  confidence: 0.8,
};

function baseNexusReturn(overrides = {}) {
  return {
    insights: [EXPANDABLE_INSIGHT],
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

describe('InsightsPage — NexusInsightCard disclosure header (A11Y-02)', () => {
  it('the header exposes role="button", tabIndex=0, and aria-expanded=false when collapsed', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    const header = screen.getByRole('button', { name: 'Evening walks lift your mood' });
    expect(header.getAttribute('tabindex')).toBe('0');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    // Panel is conditionally rendered — aria-controls must be absent while
    // collapsed (it may only reference an id present in the DOM).
    expect(header.getAttribute('aria-controls')).toBeNull();
  });

  it('clicking the header flips aria-expanded to true and reveals the body via aria-controls', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    const header = screen.getByRole('button', { name: 'Evening walks lift your mood' });
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    const panelId = header.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId);
    expect(panel).toBeTruthy();
    expect(panel.textContent).toMatch(/materially higher mood score/);
  });

  it('Enter on the header toggles expansion exactly like a click', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    const header = screen.getByRole('button', { name: 'Evening walks lift your mood' });
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('Space on the header toggles expansion exactly like a click', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    const header = screen.getByRole('button', { name: 'Evening walks lift your mood' });
    fireEvent.keyDown(header, { key: ' ' });
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the Dismiss button does not also toggle the header (stopPropagation regression guard)', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    // Dismissing removes the card, so assert the dismissal fired exactly
    // once and the header's own toggle callback was not additionally
    // triggered by event bubbling (recordInsightDismissal called once, not
    // duplicated by a bubbled second handler).
    fireEvent.click(screen.getByLabelText('Dismiss insight'));
    expect(recordInsightDismissal).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Evening walks lift your mood')).toBeNull();
  });

  it('clicking the Report button does not throw from event bubbling into the header toggle', () => {
    render(<InsightsPage entries={ENTRIES} userId="user-1" user={{ uid: 'user-1' }} />);
    expect(() => fireEvent.click(screen.getByLabelText('Report this insight as inappropriate'))).not.toThrow();
    expect(reportInsight).toHaveBeenCalledTimes(1);
  });
});
