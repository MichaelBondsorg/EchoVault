import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const getFlag = vi.fn();
vi.mock('../../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));
// The widget imports useClaims (INS-01), which imports config/firebase at
// module scope — the REAL module throws at load when VITE_FIREBASE_API_KEY
// is absent (CI has no .env; local runs mask this). Mock the boundary.
vi.mock('../../../../config/firebase', () => ({ db: { __db: true } }));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

// GlassCard forwards onClick onto a real div so the event-bubbling
// regression this task fixed (ReceiptSheet nested inside GlassCard's
// onClick-bearing subtree would bubble every sheet-internal click into a
// navigate('/insights')) is actually exercised, not hidden by the mock.
vi.mock('../../GlassCard', () => ({
  default: ({ children, onClick }) => <div onClick={onClick}>{children}</div>,
}));

// ReceiptSheet has its own full test suite (ReceiptSheet.test.jsx); here
// it's stubbed to a minimal shell that proves the widget wires the right
// props and that interacting with the (portal-free, in this stub) sheet
// content never bubbles into GlassCard's onClick.
vi.mock('../../../insights/ReceiptSheet', () => ({
  default: ({ insight, entriesById, uid, open, onClose }) => {
    if (!open) return null;
    return (
      <div data-testid="receipt-sheet-stub">
        <p>{insight?.title}</p>
        <p>uid:{uid}</p>
        <p>hasEntry:{entriesById?.e1 ? 'yes' : 'no'}</p>
        <button type="button" onClick={onClose}>
          Close receipt
        </button>
      </div>
    );
  },
}));

const useNexusInsights = vi.fn();
vi.mock('../../../../hooks/useNexusInsights', () => ({
  useNexusInsights: (...a) => useNexusInsights(...a),
}));

import NexusInsightsWidget from '../NexusInsightsWidget';

const INSIGHT = {
  id: 'insight-1',
  type: 'pattern',
  title: 'Evening walks lift your mood',
  summary: 'You tend to feel calmer on evening-walk days.',
};

const ENTRIES = [{ id: 'e1', content: 'Went for a walk, felt calmer.' }];
const USER = { uid: 'user-1' };

function baseHookReturn(overrides = {}) {
  return {
    insights: [INSIGHT],
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
  useNexusInsights.mockReturnValue(baseHookReturn());
});

describe('NexusInsightsWidget — insightReceipts flag OFF', () => {
  // Flag-aware (not a blanket mockReturnValue): insightClaims stays false
  // throughout this file so every test here exercises the legacy Nexus
  // branch — INS-01's own claims-mode behavior has its own test file
  // (NexusInsightsWidget.claims.test.jsx).
  beforeEach(() => getFlag.mockImplementation(() => false));

  it('renders no "Why am I seeing this?" trigger', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    expect(screen.queryByText('Why am I seeing this?')).toBeNull();
  });

  it('never mounts the ReceiptSheet stub', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    expect(screen.queryByTestId('receipt-sheet-stub')).toBeNull();
  });
});

describe('NexusInsightsWidget — insightReceipts flag ON', () => {
  // insightClaims stays false here too — only insightReceipts is ON, so
  // this still exercises the legacy branch (with its receipt trigger).
  beforeEach(() => getFlag.mockImplementation((flag) => flag === 'insightReceipts'));

  it('renders the trigger and opens the sheet in two taps (card -> trigger -> sources visible)', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);

    const trigger = screen.getByText('Why am I seeing this?');
    fireEvent.click(trigger);

    const sheet = screen.getByTestId('receipt-sheet-stub');
    expect(sheet).toBeTruthy();
    expect(within(sheet).getByText('Evening walks lift your mood')).toBeTruthy();
  });

  it('passes uid and a synchronous entriesById lookup built from the entries prop', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    fireEvent.click(screen.getByText('Why am I seeing this?'));

    const sheet = screen.getByTestId('receipt-sheet-stub');
    expect(within(sheet).getByText('uid:user-1')).toBeTruthy();
    expect(within(sheet).getByText('hasEntry:yes')).toBeTruthy();
  });

  it('clicking the trigger never navigates to /insights (stopPropagation)', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    fireEvent.click(screen.getByText('Why am I seeing this?'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('interacting with the open sheet never navigates to /insights (portal-bubbling regression)', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    fireEvent.click(screen.getByText('Why am I seeing this?'));
    fireEvent.click(screen.getByText('Close receipt'));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('receipt-sheet-stub')).toBeNull();
  });

  it('clicking elsewhere on the card still navigates to /insights (unrelated behavior unchanged)', () => {
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    fireEvent.click(screen.getByText('AI Insights'));
    expect(navigate).toHaveBeenCalledWith('/insights');
  });

  it('the trigger carries min-h-[28px] and before:-inset-2 (Chip.jsx 44px painted+inset pattern)', () => {
    // Text-[11px] + before:-inset-2 alone paints well under 44px; the
    // review found this half of the Chip pattern dropped here.
    render(<NexusInsightsWidget user={USER} entries={ENTRIES} />);
    const trigger = screen.getByText('Why am I seeing this?');
    expect(trigger.className).toContain('min-h-[28px]');
    expect(trigger.className).toContain('before:-inset-2');
  });
});
