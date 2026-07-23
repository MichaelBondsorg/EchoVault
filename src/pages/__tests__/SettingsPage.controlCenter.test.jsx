/**
 * SettingsPage — "Insight Control Center" nav row (R2 Task 12).
 * Flag-gated on `insightReceipts`: absent when off, present (in the AI &
 * Privacy group) and wired to onOpenControlCenter when on. Mirrors
 * SettingsPage.insightBudget.test.jsx's flag-gating conventions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SettingsPage from '../SettingsPage';
import * as flagsModule from '../../config/flags';

vi.mock('../../config/firebase', () => ({
  db: {},
  deleteAccountFn: vi.fn(),
}));

vi.mock('../../config/flags');

vi.mock('../../services/insights/insightBudget', () => ({
  readBudgetMode: vi.fn().mockResolvedValue('balanced'),
  setBudgetMode: vi.fn(),
}));

vi.mock('../../utils/accent', () => ({
  initAccent: vi.fn(() => 'blue'),
  setAccent: vi.fn((name) => name),
}));

vi.mock('../../utils/darkMode', () => ({
  initDarkMode: vi.fn(),
  cleanupDarkMode: vi.fn(),
  toggleDarkMode: vi.fn(),
}));

vi.mock('../../hooks/useDarkMode', () => ({
  useDarkMode: vi.fn(() => false),
}));

vi.mock('../../stores/uiStore', () => ({
  useUiStore: vi.fn((selector) => {
    if (typeof selector === 'function') {
      return selector({ setBackgroundMotion: vi.fn(), backgroundMotion: false });
    }
    return { setBackgroundMotion: vi.fn(), backgroundMotion: false };
  }),
  useBackgroundMotion: vi.fn(() => false),
}));

vi.mock('../../components/settings/BackfillPanel', () => ({
  default: () => null,
}));

const defaultProps = {
  user: { uid: 'test-uid', email: 'test@example.com', displayName: 'Test User' },
  entries: [],
  onOpenHealthSettings: vi.fn(),
  onOpenNexusSettings: vi.fn(),
  onOpenSafetyPlan: vi.fn(),
  onOpenExport: vi.fn(),
  onOpenEntityManagement: vi.fn(),
  onOpenReports: vi.fn(),
  onOpenReliability: vi.fn(),
  onOpenPrivacy: vi.fn(),
  onOpenSpaces: vi.fn(),
  onOpenControlCenter: vi.fn(),
  onRequestNotifications: vi.fn(),
  onLogout: vi.fn(),
  notificationPermission: 'denied',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SettingsPage — Insight Control Center nav row', () => {
  it('is absent when insightReceipts flag is off', () => {
    flagsModule.getFlag = vi.fn((flag) => flag === 'insightReceipts' ? false : false);
    render(<SettingsPage {...defaultProps} />);
    expect(screen.queryByText('Insight Control Center')).toBeNull();
  });

  it('renders in the AI & Privacy group when the flag is on', () => {
    flagsModule.getFlag = vi.fn((flag) => flag === 'insightReceipts');
    render(<SettingsPage {...defaultProps} />);

    const sectionLabel = screen.getByText('AI & Privacy');
    const section = sectionLabel.closest('.space-y-2');
    expect(within(section).getByText('Insight Control Center')).toBeTruthy();
  });

  // Fix C (2026-07-24 brief): widened to `insightReceipts || insightClaims`
  // — rebuild is useful independently of receipts.
  it('also renders when insightClaims is on, even with insightReceipts off', () => {
    flagsModule.getFlag = vi.fn((flag) => flag === 'insightClaims');
    render(<SettingsPage {...defaultProps} />);

    const sectionLabel = screen.getByText('AI & Privacy');
    const section = sectionLabel.closest('.space-y-2');
    expect(within(section).getByText('Insight Control Center')).toBeTruthy();
  });

  it('calls onOpenControlCenter when clicked', async () => {
    flagsModule.getFlag = vi.fn((flag) => flag === 'insightReceipts');
    render(<SettingsPage {...defaultProps} />);

    fireEvent.click(screen.getByText('Insight Control Center'));
    // handleItemClick fires the handler after a short delay to show a
    // loading spinner first — same wrapper every other nav row uses.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(defaultProps.onOpenControlCenter).toHaveBeenCalled();
  });
});
