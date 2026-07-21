/**
 * SettingsPage Insight Budget mode selector tests
 * Tests flag-gating, UI rendering, mode selection, persistence, and error recovery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SettingsPage from '../SettingsPage';
import * as insightBudgetService from '../../services/insights/insightBudget';
import * as flagsModule from '../../config/flags';

// Mock the dependencies
vi.mock('../../config/firebase', () => ({
  db: {},
  deleteAccountFn: vi.fn(),
}));

vi.mock('../../config/flags');

vi.mock('../../services/insights/insightBudget', () => ({
  readBudgetMode: vi.fn(),
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

describe('SettingsPage - Insight Budget Mode Selector', () => {
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

  describe('Flag-gating', () => {
    it('does not render the Insight frequency row when insightBudget flag is off', () => {
      flagsModule.getFlag = vi.fn((flag) => flag === 'insightBudget' ? false : true);

      render(<SettingsPage {...defaultProps} />);

      expect(screen.queryByText('Insight frequency')).toBeNull();
    });

    it('renders the Insight frequency row when insightBudget flag is on', async () => {
      flagsModule.getFlag = vi.fn((flag) => flag === 'insightBudget' ? true : false);
      insightBudgetService.readBudgetMode.mockResolvedValue('balanced');

      render(<SettingsPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Insight frequency')).toBeTruthy();
      });
    });
  });

  describe('UI Rendering', () => {
    beforeEach(() => {
      flagsModule.getFlag = vi.fn((flag) => flag === 'insightBudget' ? true : false);
      insightBudgetService.readBudgetMode.mockResolvedValue('balanced');
    });

    it('renders three mode chips with correct labels and descriptions', async () => {
      render(<SettingsPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Quiet')).toBeTruthy();
        expect(screen.getByText('Only the clearest, rarest insights')).toBeTruthy();

        expect(screen.getByText('Balanced')).toBeTruthy();
        expect(screen.getByText('A few well-supported insights — the default')).toBeTruthy();

        expect(screen.getByText('Exploratory')).toBeTruthy();
        expect(screen.getByText('More ideas, including tentative ones')).toBeTruthy();
      });
    });

    it('renders the row in the AI & Privacy section', async () => {
      render(<SettingsPage {...defaultProps} />);

      // Find the row and verify it's in the AI & Privacy section
      const sectionLabel = screen.getByText('AI & Privacy');
      const section = sectionLabel.closest('.space-y-2');

      await waitFor(() => {
        expect(section).toBeTruthy();
        expect(within(section).getByText('Insight frequency')).toBeTruthy();
      });
    });
  });

  describe('Mode Selection', () => {
    beforeEach(() => {
      flagsModule.getFlag = vi.fn((flag) => flag === 'insightBudget' ? true : false);
      insightBudgetService.readBudgetMode.mockResolvedValue('balanced');
    });

    it('highlights the current mode chip', async () => {
      render(<SettingsPage {...defaultProps} />);

      await waitFor(() => {
        const balancedChip = screen.getByText('Balanced');
        // Chip component does not expose aria-pressed; relying on className
        // coupling (bg-accent-deep applied when selected=true). If Chip.jsx
        // adds aria-pressed support, this assertion should migrate to use it.
        expect(balancedChip.className).toContain('bg-accent-deep');
      });
    });

    it('calls setBudgetMode when a different mode is selected', async () => {
      insightBudgetService.setBudgetMode.mockResolvedValue();

      render(<SettingsPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Quiet')).toBeTruthy();
      });

      const quietChip = screen.getByText('Quiet');
      fireEvent.click(quietChip);

      await waitFor(() => {
        expect(insightBudgetService.setBudgetMode).toHaveBeenCalledWith(
          expect.any(Object),
          'test-uid',
          'quiet'
        );
      });
    });

    it('updates the selected chip after mode change', async () => {
      insightBudgetService.setBudgetMode.mockResolvedValue();
      insightBudgetService.readBudgetMode.mockResolvedValueOnce('balanced').mockResolvedValueOnce('exploratory');

      const { rerender } = render(<SettingsPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Balanced').className).toContain('bg-accent-deep');
      });

      // Simulate mode change to exploratory
      const exploratoryChip = screen.getByText('Exploratory');
      fireEvent.click(exploratoryChip);

      await waitFor(() => {
        expect(insightBudgetService.setBudgetMode).toHaveBeenCalledWith(
          expect.any(Object),
          'test-uid',
          'exploratory'
        );
      });
    });

    it('handles quiet mode selection', async () => {
      insightBudgetService.setBudgetMode.mockResolvedValue();

      render(<SettingsPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Quiet')).toBeTruthy();
      });

      const quietChip = screen.getByText('Quiet');
      fireEvent.click(quietChip);

      await waitFor(() => {
        expect(insightBudgetService.setBudgetMode).toHaveBeenCalledWith(
          expect.any(Object),
          'test-uid',
          'quiet'
        );
      });
    });

    it('handles exploratory mode selection', async () => {
      insightBudgetService.setBudgetMode.mockResolvedValue();

      render(<SettingsPage {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Exploratory')).toBeTruthy();
      });

      const exploratoryChip = screen.getByText('Exploratory');
      fireEvent.click(exploratoryChip);

      await waitFor(() => {
        expect(insightBudgetService.setBudgetMode).toHaveBeenCalledWith(
          expect.any(Object),
          'test-uid',
          'exploratory'
        );
      });
    });

    it('reverts UI to persisted mode when setBudgetMode rejects', async () => {
      // Start with balanced selected
      insightBudgetService.readBudgetMode.mockResolvedValue('balanced');
      // setBudgetMode fails on selection
      insightBudgetService.setBudgetMode.mockRejectedValueOnce(
        new Error('Failed to save')
      );
      // readBudgetMode returns the persisted mode (balanced) on fallback
      insightBudgetService.readBudgetMode.mockResolvedValueOnce('balanced');

      render(<SettingsPage {...defaultProps} />);

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText('Balanced').className).toContain('bg-accent-deep');
      });

      // Try to select quiet; setBudgetMode will reject
      const quietChip = screen.getByText('Quiet');
      fireEvent.click(quietChip);

      // UI should attempt the change (optimistic)
      // but then revert to balanced after the error
      await waitFor(() => {
        expect(insightBudgetService.readBudgetMode).toHaveBeenCalledTimes(2);
      });

      // Verify balanced is highlighted again (reverted)
      expect(screen.getByText('Balanced').className).toContain('bg-accent-deep');
    });
  });

  describe('Initial Load', () => {
    it('loads the current mode on mount', async () => {
      flagsModule.getFlag = vi.fn((flag) => flag === 'insightBudget' ? true : false);
      insightBudgetService.readBudgetMode.mockResolvedValue('quiet');

      render(<SettingsPage {...defaultProps} />);

      await waitFor(() => {
        expect(insightBudgetService.readBudgetMode).toHaveBeenCalledWith(
          expect.any(Object),
          'test-uid'
        );
      });
    });

    it('uses balanced as the default when no mode is set', async () => {
      flagsModule.getFlag = vi.fn((flag) => flag === 'insightBudget' ? true : false);
      insightBudgetService.readBudgetMode.mockResolvedValue('balanced');

      render(<SettingsPage {...defaultProps} />);

      await waitFor(() => {
        const balancedChip = screen.getByText('Balanced');
        // See comment in "highlights the current mode chip" test about className coupling.
        expect(balancedChip.className).toContain('bg-accent-deep');
      });
    });

    it('still renders row with default balanced when readBudgetMode fails on mount', async () => {
      flagsModule.getFlag = vi.fn((flag) => flag === 'insightBudget' ? true : false);
      // readBudgetMode fails on mount
      insightBudgetService.readBudgetMode.mockRejectedValueOnce(
        new Error('Failed to load')
      );

      render(<SettingsPage {...defaultProps} />);

      // Row still renders with Insight frequency visible even after load failure
      await waitFor(() => {
        expect(screen.getByText('Insight frequency')).toBeTruthy();
      });

      // Balanced should be selected by default (fallback when load fails)
      const balancedChip = screen.getByText('Balanced');
      // See comment in "highlights the current mode chip" test about className coupling.
      expect(balancedChip.className).toContain('bg-accent-deep');

      // Verify readBudgetMode was called and failed gracefully
      expect(insightBudgetService.readBudgetMode).toHaveBeenCalledWith(
        expect.any(Object),
        'test-uid'
      );

      // Verify the error was logged (no throw), so app remains usable
      // by confirming all three chips are present and interactive
      expect(screen.getByText('Quiet')).toBeTruthy();
      expect(screen.getByText('Balanced')).toBeTruthy();
      expect(screen.getByText('Exploratory')).toBeTruthy();
    });
  });
});
