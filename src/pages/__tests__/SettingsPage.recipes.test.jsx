/**
 * SettingsPage — "Reflection Recipes" nav row (R2 Task 17).
 * Flag-gated on `reflectionRecipes`: absent when off, present (in the App
 * group) and wired to onOpenRecipes when on. Mirrors
 * SettingsPage.controlCenter.test.jsx's flag-gating conventions.
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
  onOpenRecipes: vi.fn(),
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

describe('SettingsPage — Reflection Recipes nav row', () => {
  it('is absent when reflectionRecipes flag is off', () => {
    flagsModule.getFlag = vi.fn(() => false);
    render(<SettingsPage {...defaultProps} />);
    expect(screen.queryByText('Reflection Recipes')).toBeNull();
  });

  it('renders in the App group when the flag is on', () => {
    flagsModule.getFlag = vi.fn((flag) => flag === 'reflectionRecipes');
    render(<SettingsPage {...defaultProps} />);

    const sectionLabel = screen.getByText('App');
    const section = sectionLabel.closest('.space-y-2');
    expect(within(section).getByText('Reflection Recipes')).toBeTruthy();
  });

  it('calls onOpenRecipes when clicked', async () => {
    flagsModule.getFlag = vi.fn((flag) => flag === 'reflectionRecipes');
    render(<SettingsPage {...defaultProps} />);

    fireEvent.click(screen.getByText('Reflection Recipes'));
    // handleItemClick fires the handler after a short delay to show a
    // loading spinner first — same wrapper every other nav row uses.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(defaultProps.onOpenRecipes).toHaveBeenCalled();
  });

  it('does not affect Context Spaces gating (independent flags)', () => {
    flagsModule.getFlag = vi.fn((flag) => flag === 'reflectionRecipes');
    render(<SettingsPage {...defaultProps} />);
    expect(screen.queryByText('Context Spaces')).toBeNull();
  });
});
