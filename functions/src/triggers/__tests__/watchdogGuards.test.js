/**
 * pendingEntryCleanup watchdog guard against re-analyzing edited entries in
 * legacy (flag-off) mode — reviewer-flagged Critical fix.
 *
 * An edited entry's `createdAt` is its ORIGINAL creation date, so it looks
 * "stuck" to the watchdog's 10-minute sweep on the very next 15-min run.
 * With `serverAnalysisOrchestrator` OFF, the pre-existing (pre-C4) behavior
 * NEVER re-analyzed an edit — running the watchdog's REDUCED legacy inline
 * path (classify+analyze only) on it would overwrite title/tags/mood while
 * leaving stale goal_update/contextualInsight/extracted_tasks, plus cost
 * unplanned Gemini spend. `shouldWatchdogSkipEditedEntry` must return true
 * in exactly that case, and leave everything else untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../shared/flags.js', () => ({
  getServerFlag: vi.fn(),
}));

const { shouldWatchdogSkipEditedEntry } = await import('../watchdogGuards.js');
const { getServerFlag } = await import('../../shared/flags.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('shouldWatchdogSkipEditedEntry', () => {
  it('skips an edited entry (entryInputVersion 2, pending) when the flag is OFF', async () => {
    getServerFlag.mockResolvedValue(false);
    const skip = await shouldWatchdogSkipEditedEntry({}, {
      entryInputVersion: 2,
      analysisStatus: 'pending',
    });
    expect(skip).toBe(true);
    expect(getServerFlag).toHaveBeenCalledWith({}, 'serverAnalysisOrchestrator', false);
  });

  it('does NOT skip the same edited entry when the flag is ON (orchestrator routing handles it)', async () => {
    getServerFlag.mockResolvedValue(true);
    const skip = await shouldWatchdogSkipEditedEntry({}, {
      entryInputVersion: 2,
      analysisStatus: 'pending',
    });
    expect(skip).toBe(false);
  });

  it('does NOT skip a version-1 (never-edited) pending entry when the flag is OFF (legacy path unchanged)', async () => {
    getServerFlag.mockResolvedValue(false);
    const skip = await shouldWatchdogSkipEditedEntry({}, {
      entryInputVersion: 1,
      analysisStatus: 'pending',
    });
    expect(skip).toBe(false);
    // Never-edited entries don't even need the flag check — legacy status quo.
    expect(getServerFlag).not.toHaveBeenCalled();
  });

  it('does NOT skip a legacy entry with no entryInputVersion field at all', async () => {
    getServerFlag.mockResolvedValue(false);
    const skip = await shouldWatchdogSkipEditedEntry({}, { analysisStatus: 'pending' });
    expect(skip).toBe(false);
    expect(getServerFlag).not.toHaveBeenCalled();
  });
});
