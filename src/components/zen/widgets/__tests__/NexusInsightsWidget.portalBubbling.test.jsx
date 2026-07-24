/**
 * NexusInsightsWidget — REAL portal -> React-tree bubbling regression
 * (R2 Task 11 review finding).
 *
 * NexusInsightsWidget.test.jsx mocks ReceiptSheet as a plain div (see its
 * own comment), so its "portal-bubbling regression" test never actually
 * exercises a portal — the stub's content isn't nested under GlassCard in
 * the DOM either way, so it would pass even if ReceiptSheet's real Drawer
 * (vaul, portaled to document.body) were nested inside GlassCard's
 * onClick-bearing subtree in the REACT tree. React bubbles synthetic
 * events along the React tree, not the DOM tree, so that's exactly the
 * regression that matters: a portal doesn't protect against it — only
 * keeping ReceiptSheet as a *sibling* of GlassCard (not a descendant) does
 * (see NexusInsightsWidget.jsx's own comment on this).
 *
 * This file mounts the REAL ReceiptSheet (real Drawer/Dialog, real vaul
 * portal to document.body — jsdom supports it; see ReceiptSheet.test.jsx's
 * own portal-aware assertions for precedent) and clicks inside the
 * portaled content, asserting the card's onClick/navigation was NOT
 * triggered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const getFlag = vi.fn();
vi.mock('../../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

// Same GlassCard mock as NexusInsightsWidget.test.jsx: forwards onClick
// onto a real DOM div so a REACT-tree bubbling regression would actually
// fire it.
vi.mock('../../GlassCard', () => ({
  default: ({ children, onClick }) => <div onClick={onClick}>{children}</div>,
}));

// ReceiptSheet is NOT mocked in this file — its real Drawer/Dialog (vaul)
// portal to document.body is exactly what's under test.
vi.mock('../../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../../services/basicInsights/feedbackLearning', () => ({
  recordFeedbackAndLearn: vi.fn().mockResolvedValue({ accuracyRate: 1 }),
}));

vi.mock('../../../../services/analytics/insightEngagement', () => ({
  recordInsightEngagement: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../../services/insights/sourceExclusions', () => ({
  excludeSource: vi.fn().mockResolvedValue({ id: 'excl-1' }),
}));

// Partial mock: override only the `useNexusInsights` hook, keeping the
// real `extractPatternTypeFromInsight` export — ReceiptSheet.jsx imports
// it from this same module (for the real "Wrong source" action), and a
// full mock would leave it undefined.
const useNexusInsightsMock = vi.fn();
vi.mock('../../../../hooks/useNexusInsights', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNexusInsights: (...a) => useNexusInsightsMock(...a),
  };
});

import NexusInsightsWidget from '../NexusInsightsWidget';

const INSIGHT = {
  id: 'insight-1',
  type: 'pattern',
  title: 'Evening walks lift your mood',
  summary: 'You tend to feel calmer on evening-walk days.',
  confidence: 0.8,
  receipt: {
    sources: [{ entryId: 'e1', date: '2026-07-18T10:00:00.000Z', excerpt: 'Went for a walk, felt calmer.' }],
    scope: null,
    timeWindow: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
    sampleSize: 14,
    missingness: null,
    versions: {},
  },
};

const ENTRIES = [{ id: 'e1', content: 'Went for a walk, felt calmer.' }];
const USER = { uid: 'user-1' };

beforeEach(() => {
  vi.clearAllMocks();
  navigate.mockReset();
  // insightReceipts ON, insightClaims OFF — this file exercises the legacy
  // Nexus branch's real-portal bubbling regression specifically; INS-01's
  // claims-mode branch has its own coverage (NexusInsightsWidget.claims.test.jsx).
  getFlag.mockImplementation((flag) => flag === 'insightReceipts');
  useNexusInsightsMock.mockReturnValue({
    insights: [INSIGHT],
    isCalibrating: false,
    calibrationProgress: 0,
    loading: false,
    error: null,
  });
});

describe('NexusInsightsWidget — real ReceiptSheet portal never bubbles into GlassCard onClick', () => {
  it('opens the real sheet, and clicking inside its portaled content never navigates', async () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);

    fireEvent.click(screen.getByText('Why am I seeing this?'));

    // The Drawer's content portals to document.body — `screen` queries the
    // whole document, so this finds it there, not under the GlassCard div.
    const notTrueButton = await screen.findByText('Not true');
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(notTrueButton);
    expect(navigate).not.toHaveBeenCalled();

    // Clicking the sheet's own close button (also portaled) must not
    // navigate either.
    fireEvent.click(screen.getByLabelText('Close'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('clicking a per-source "Wrong source" action inside the real portaled sheet never navigates', async () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);

    fireEvent.click(screen.getByText('Why am I seeing this?'));
    const wrongSource = await screen.findByText('Wrong source');
    fireEvent.click(wrongSource);

    expect(navigate).not.toHaveBeenCalled();
  });

  it('sanity: clicking the card itself (outside the sheet) still navigates — proves the mock/wiring is real, not just inert', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    fireEvent.click(screen.getByText('AI Insights'));
    expect(navigate).toHaveBeenCalledWith('/insights');
  });
});
