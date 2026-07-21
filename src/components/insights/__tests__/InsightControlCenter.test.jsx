import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import InsightControlCenter from '../InsightControlCenter';
import { listSourceExclusions, restoreSource } from '../../../services/insights/sourceExclusions';
import { getSuppressedPatterns, liftSuppression } from '../../../services/basicInsights/feedbackLearning';
import { getActiveExclusions, removeExclusion } from '../../../services/signals/signalLifecycle';
import { getCachedInsights, generateInsights } from '../../../services/nexus/orchestrator';
import { readBudgetMode, readShownLog } from '../../../services/insights/insightBudget';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/insights/sourceExclusions', () => ({
  listSourceExclusions: vi.fn(),
  restoreSource: vi.fn(),
}));

vi.mock('../../../services/basicInsights/feedbackLearning', () => ({
  getSuppressedPatterns: vi.fn(),
  liftSuppression: vi.fn(),
}));

vi.mock('../../../services/signals/signalLifecycle', () => ({
  getActiveExclusions: vi.fn(),
  removeExclusion: vi.fn(),
}));

vi.mock('../../../services/nexus/orchestrator', () => ({
  getCachedInsights: vi.fn(),
  generateInsights: vi.fn(),
}));

vi.mock('../../../services/insights/insightBudget', () => ({
  readBudgetMode: vi.fn(),
  readShownLog: vi.fn(),
  getBudgetConfig: vi.fn((mode) => {
    const configs = {
      quiet: { maxHomePerDay: 1, maxHomePerWeek: 4 },
      balanced: { maxHomePerDay: 2, maxHomePerWeek: 8 },
      exploratory: { maxHomePerDay: 4, maxHomePerWeek: 20 },
    };
    return configs[mode] || configs.balanced;
  }),
}));

const UID = 'user-1';

const SOURCE_EXCLUSIONS = [
  { id: 'excl-1', entryId: 'e1', appliesTo: 'all', reason: 'excluded_by_user', permanent: true, createdAt: '2026-07-10T00:00:00.000Z' },
  { id: 'excl-2', entryId: 'e2', appliesTo: 'theme_gratitude', reason: 'wrong_source', permanent: true, createdAt: '2026-07-12T00:00:00.000Z' },
];

const ENTRIES = [
  { id: 'e1', content: 'Had a rough day at work, felt overwhelmed by everything on my plate today.', date: '2026-07-09T12:00:00.000Z' },
  // e2 intentionally absent from the entries prop — exercises the fallback path.
];

const SUPPRESSED_PATTERNS = [
  { patternType: 'activity_journaling', accuracyRate: 0.2, totalFeedback: 5, suppressedAt: '2026-07-01T00:00:00.000Z', requiredMoodDeltaToResurface: 1.2 },
];

const PATTERN_EXCLUSIONS = [
  { id: 'pe-1', patternType: 'sleep_mood_correlation', context: {}, reason: 'user_dismissed', permanent: true },
];

function defaultMocks({
  sourceExclusions = SOURCE_EXCLUSIONS,
  suppressedPatterns = SUPPRESSED_PATTERNS,
  patternExclusions = PATTERN_EXCLUSIONS,
  cachedInsights = { insights: [], generatedAt: '2026-07-20T10:00:00.000Z', stale: true },
  budgetMode = 'balanced',
  shownLog = [
    { id: 'i1', theme: 'mood', title: 'Insight 1', shownAt: '2026-07-19T00:00:00.000Z' },
    { id: 'i2', theme: 'sleep', title: 'Insight 2', shownAt: '2026-07-20T00:00:00.000Z' },
    { id: 'i3', theme: 'activity', title: 'Insight 3', shownAt: '2026-07-20T09:00:00.000Z' },
  ],
} = {}) {
  listSourceExclusions.mockResolvedValue(sourceExclusions);
  getSuppressedPatterns.mockResolvedValue(suppressedPatterns);
  getActiveExclusions.mockResolvedValue(patternExclusions);
  getCachedInsights.mockResolvedValue(cachedInsights);
  readBudgetMode.mockResolvedValue(budgetMode);
  readShownLog.mockResolvedValue(shownLog);
}

function renderCenter(props = {}) {
  return render(<InsightControlCenter uid={UID} entries={ENTRIES} onClose={vi.fn()} {...props} />);
}

let nowSpy;

beforeEach(() => {
  vi.clearAllMocks();
  // A Date.now() spy (not vi.useFakeTimers()) — fake timers would also
  // freeze the setTimeout-based polling @testing-library/react's waitFor
  // relies on internally, hanging every async assertion in this file.
  nowSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-21T00:00:00.000Z').getTime());
  restoreSource.mockResolvedValue();
  liftSuppression.mockResolvedValue(true);
  removeExclusion.mockResolvedValue();
  generateInsights.mockResolvedValue({ success: true, insights: [{ id: 'n1' }, { id: 'n2' }], generatedAt: '2026-07-21T00:00:00.000Z' });
});

afterEach(() => {
  nowSpy.mockRestore();
});

describe('InsightControlCenter — structure & a11y', () => {
  it('renders a single labelled modal dialog', async () => {
    defaultMocks();
    renderCenter();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy).textContent).toMatch(/Insight Control Center/i);
    expect(screen.queryAllByRole('dialog')).toHaveLength(1);
    // Flush the mount-time data load so its state updates land inside act().
    await waitFor(() => expect(listSourceExclusions).toHaveBeenCalled());
  });

  it('calls onClose when the close button is clicked', async () => {
    defaultMocks();
    const onClose = vi.fn();
    renderCenter({ onClose });
    fireEvent.click(screen.getByLabelText(/close insight control center/i));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(listSourceExclusions).toHaveBeenCalled());
  });

  it('renders all four cloud-sheet sections', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/excluded sources/i)).toBeTruthy();
      expect(screen.getByText(/muted insight families/i)).toBeTruthy();
      expect(screen.getByText('RECOMPUTE')).toBeTruthy();
      expect(screen.getByText(/withheld this week/i)).toBeTruthy();
    });
  });

  it('never shows a destructive confirmation for any action here', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => expect(screen.getByText(/rough day at work/i)).toBeTruthy());
    expect(screen.queryByText(/are you sure/i)).toBeNull();
    expect(screen.queryByText(/permanently/i)).toBeNull();
  });

  it('uses no jargon (model/token) or guilt-tripping copy', async () => {
    defaultMocks();
    const { container } = renderCenter();
    await waitFor(() => expect(getSuppressedPatterns).toHaveBeenCalled());
    const text = container.textContent;
    expect(text).not.toMatch(/\bmodel\b/i);
    expect(text).not.toMatch(/\btoken\b/i);
    expect(text).not.toMatch(/you should/i);
    expect(text).not.toMatch(/you failed/i);
  });
});

describe('InsightControlCenter — Excluded sources', () => {
  it('renders each exclusion with entry excerpt (from entries prop) and reason label', async () => {
    defaultMocks();
    renderCenter();

    await waitFor(() => {
      expect(screen.getByText(/rough day at work/i)).toBeTruthy();
    });
    expect(screen.getByText(/you excluded this/i)).toBeTruthy();
    expect(screen.getByText(/wrong source/i)).toBeTruthy();
  });

  it('falls back to a synchronous placeholder when the entry is not in the entries prop', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/no longer available/i)).toBeTruthy();
    });
  });

  it('shows an empty state when there are no exclusions', async () => {
    defaultMocks({ sourceExclusions: [] });
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/no sources excluded/i)).toBeTruthy();
    });
  });

  it('calls restoreSource with (db, uid, exclusionId) and optimistically removes the row', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => expect(screen.getByText(/rough day at work/i)).toBeTruthy());

    let resolveRestore;
    restoreSource.mockReturnValue(new Promise((resolve) => { resolveRestore = resolve; }));

    fireEvent.click(screen.getAllByRole('button', { name: /restore/i })[0]);

    // Optimistic: removed immediately, before the promise resolves.
    expect(screen.queryByText(/rough day at work/i)).toBeNull();
    expect(restoreSource).toHaveBeenCalledWith({ __db: true }, UID, 'excl-1');

    resolveRestore();
    await waitFor(() => expect(screen.queryByText(/rough day at work/i)).toBeNull());
  });

  it('reverts the optimistic removal when restoreSource fails', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => expect(screen.getByText(/rough day at work/i)).toBeTruthy());

    restoreSource.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getAllByRole('button', { name: /restore/i })[0]);

    expect(screen.queryByText(/rough day at work/i)).toBeNull();

    await waitFor(() => {
      expect(screen.getByText(/rough day at work/i)).toBeTruthy();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/could not restore/i);
  });

  it('Restore buttons meet the 44px hit-target pattern (min-h-[28px] + before:-inset-2 inflation)', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => expect(screen.getByText(/rough day at work/i)).toBeTruthy());
    const restoreButtons = screen.getAllByRole('button', { name: /restore/i });
    restoreButtons.forEach((btn) => {
      expect(btn.className).toMatch(/min-h-\[28px\]/);
      expect(btn.className).toMatch(/before:-inset-2/);
    });
  });
});

describe('InsightControlCenter — Muted insight families', () => {
  it('renders suppressed feedback-learning patterns and R1 pattern exclusions', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/activity journaling/i)).toBeTruthy();
      expect(screen.getByText(/sleep mood correlation/i)).toBeTruthy();
    });
  });

  it('shows an empty state when nothing is muted', async () => {
    defaultMocks({ suppressedPatterns: [], patternExclusions: [] });
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/nothing is muted/i)).toBeTruthy();
    });
  });

  it('"Show again" on a suppressed pattern calls liftSuppression(uid, patternType) and removes the row', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => expect(screen.getByText(/activity journaling/i)).toBeTruthy());

    const row = screen.getByText(/activity journaling/i).closest('.flex');
    fireEvent.click(within(row).getByRole('button', { name: /show again/i }));

    expect(screen.queryByText(/activity journaling/i)).toBeNull();
    expect(liftSuppression).toHaveBeenCalledWith(UID, 'activity_journaling');
  });

  it('"Show again" on an R1 pattern exclusion calls removeExclusion(uid, exclusionId) and removes the row', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => expect(screen.getByText(/sleep mood correlation/i)).toBeTruthy());

    const row = screen.getByText(/sleep mood correlation/i).closest('.flex');
    fireEvent.click(within(row).getByRole('button', { name: /show again/i }));

    expect(screen.queryByText(/sleep mood correlation/i)).toBeNull();
    expect(removeExclusion).toHaveBeenCalledWith(UID, 'pe-1');
  });

  it('reverts optimistic removal when liftSuppression signals failure', async () => {
    defaultMocks();
    liftSuppression.mockResolvedValueOnce(false);
    renderCenter();
    await waitFor(() => expect(screen.getByText(/activity journaling/i)).toBeTruthy());

    const row = screen.getByText(/activity journaling/i).closest('.flex');
    fireEvent.click(within(row).getByRole('button', { name: /show again/i }));

    await waitFor(() => {
      expect(screen.getByText(/activity journaling/i)).toBeTruthy();
    });
  });
});

describe('InsightControlCenter — Recompute', () => {
  it('shows the staleness line when cached insights are stale', async () => {
    defaultMocks({ cachedInsights: { insights: [], generatedAt: '2026-07-20T10:00:00.000Z', stale: true } });
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/will refresh with your current exclusions/i)).toBeTruthy();
    });
  });

  it('shows a last-generated relative time when fresh', async () => {
    defaultMocks({ cachedInsights: { insights: [], generatedAt: '2026-07-20T22:00:00.000Z', stale: false } });
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/last generated/i)).toBeTruthy();
    });
  });

  it('shows the exclusion-count context line', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/recomputing uses your current exclusions \(2 sources excluded\)/i)).toBeTruthy();
    });
  });

  it('Recompute now triggers generateInsights(uid), shows a loading state, then a result line', async () => {
    defaultMocks();
    let resolveGenerate;
    generateInsights.mockReturnValue(new Promise((resolve) => { resolveGenerate = resolve; }));
    renderCenter();

    await waitFor(() => expect(screen.getByRole('button', { name: /recompute now/i })).toBeTruthy());
    const button = screen.getByRole('button', { name: /recompute now/i });
    fireEvent.click(button);

    expect(generateInsights).toHaveBeenCalledWith(UID);
    expect(button).toBeDisabled();

    resolveGenerate({ success: true, insights: [{ id: 'n1' }, { id: 'n2' }], generatedAt: '2026-07-21T00:00:00.000Z' });

    await waitFor(() => {
      expect(screen.getByText(/2 insights/i)).toBeTruthy();
    });
    expect(button).not.toBeDisabled();
  });

  it('shows a non-alarming result line when recompute fails', async () => {
    defaultMocks();
    generateInsights.mockResolvedValueOnce({ success: false, insights: [], errors: ['boom'] });
    renderCenter();

    await waitFor(() => expect(screen.getByRole('button', { name: /recompute now/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /recompute now/i }));

    await waitFor(() => {
      expect(screen.getByText(/didn.?t complete|try again/i)).toBeTruthy();
    });
  });
});

describe('InsightControlCenter — Withheld this week', () => {
  it('shows an honest budget line derived from the shown log and mode cap', async () => {
    defaultMocks({ budgetMode: 'balanced' });
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/balanced budget showed 3 of up to 8 insights this week/i)).toBeTruthy();
    });
  });

  it('mentions Settings as where to change the frequency, without building nav', async () => {
    defaultMocks();
    renderCenter();
    await waitFor(() => {
      expect(screen.getByText(/insight frequency/i)).toBeTruthy();
    });
  });
});
