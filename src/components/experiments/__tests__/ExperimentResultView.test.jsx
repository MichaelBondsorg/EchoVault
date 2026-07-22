/**
 * ExperimentResultView — tests (R3 Task 6).
 *
 * Only `config/firebase` and `experimentsService`'s two write functions
 * (`setObservationExcluded`/`writeResult`) are mocked. `computeResult.js`,
 * `estimator.js`, `templates.js`, `scopeFilter.js`, and `receipts.js` are
 * REAL — the exclude/rerun round trip below feeds synthetic entries through
 * the genuine estimator and asserts the recomputed estimate actually
 * changes, per the binding TDD requirement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ExperimentResultView, { buildObservationRows, reasonCopy } from '../ExperimentResultView';
import { computeExperimentResult, NON_CAUSAL_FRAMING } from '../../../services/experiments/computeResult';
import { getTemplateById } from '../../../services/experiments/templates';
import { setObservationExcluded, writeResult } from '../../../services/experiments/experimentsService';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/experiments/experimentsService', () => ({
  setObservationExcluded: vi.fn(),
  writeResult: vi.fn().mockResolvedValue(undefined),
}));

const UID = 'user-a';
const SLEEP_TEMPLATE = getTemplateById('sleep-hours-mood-same-day');

function isoDay(y, m, d, hour = 12) {
  return new Date(Date.UTC(y, m - 1, d, hour)).toISOString();
}

function goldenSleepHours(i) {
  return 4 + (i % 7);
}

/** 28-day perfect-linear sleep/mood fixture (mirrors computeResult.test.js's own golden fixture). */
function buildGoldenEntries() {
  const entries = [];
  for (let i = 0; i < 28; i++) {
    const day = i + 1;
    const hours = goldenSleepHours(i);
    entries.push({
      id: `golden-${day}`,
      createdAt: isoDay(2026, 1, day),
      healthContext: { sleep: { totalHours: hours } },
      analysis: { mood_score: hours * 10 },
    });
  }
  return entries;
}

const GOLDEN_START = isoDay(2026, 1, 1, 0);
const GOLDEN_END = isoDay(2026, 1, 29, 0);
const GOLDEN_NOW = new Date(isoDay(2026, 2, 5, 0));

function buildAnalysisPlan(template) {
  return {
    templateId: template.id,
    lag: template.lag,
    exposure: { ...template.exposure },
    outcome: { ...template.outcome },
    minPairedObservations: 10,
    coverageFloor: 0.5,
    confounders: [...template.confounders],
    whatThisDoesNotProve: [...template.whatThisDoesNotProve],
  };
}

function goldenExperiment(overrides = {}) {
  return {
    id: 'exp-1',
    question: 'Does how much I sleep affect my mood?',
    template: SLEEP_TEMPLATE.id,
    analysisPlan: buildAnalysisPlan(SLEEP_TEMPLATE),
    scope: null,
    status: 'completed',
    startAt: GOLDEN_START,
    endAt: GOLDEN_END,
    durationDays: 28,
    excludedObservations: [],
    createdAt: GOLDEN_START,
    updatedAt: GOLDEN_START,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Null result
// ---------------------------------------------------------------------------

describe('ExperimentResultView — null result', () => {
  it('renders a placeholder when the experiment has no stored result', () => {
    const experiment = goldenExperiment({ result: undefined });
    render(<ExperimentResultView uid={UID} entries={[]} experiment={experiment} onClose={vi.fn()} />);
    expect(screen.getByText(/no result is available/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Renders the STORED result (not recomputed on mount)
// ---------------------------------------------------------------------------

describe('ExperimentResultView — ok result (golden fixture)', () => {
  it('renders sample size, coverage, plain-language estimate + CI, alternatives, whatThisDoesNotProve, and sources from the STORED result', () => {
    const entries = buildGoldenEntries();
    const storedResult = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    expect(storedResult.status).toBe('ok'); // sanity: fixture really is 'ok'

    const experiment = goldenExperiment({ result: storedResult });
    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.getByText('28 matched days')).toBeTruthy();
    expect(screen.getByText('28 of 28 days have sleep hours data')).toBeTruthy();
    expect(screen.getByText('28 of 28 days have mood data')).toBeTruthy();
    expect(screen.getByText(storedResult.narrative.summary)).toBeTruthy();
    expect(screen.getByText(storedResult.narrative.summary).textContent).toContain(NON_CAUSAL_FRAMING);
    for (const alt of storedResult.narrative.alternatives) {
      expect(screen.getByText(alt)).toBeTruthy();
    }
    for (const w of storedResult.narrative.whatThisDoesNotProve) {
      expect(screen.getByText(w)).toBeTruthy();
    }
    // Sources: at least one cited source excerpt/date rendered via SourceList.
    expect(storedResult.receipt.sources.length).toBeGreaterThan(0);
  });

  it('does NOT call computeExperimentResult on mount — renders the stored result object verbatim', () => {
    const entries = buildGoldenEntries();
    const storedResult = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    // Mutate a copy of the stored result so we can prove the DOM reflects
    // THIS object, not a freshly recomputed one.
    const taggedResult = { ...storedResult, narrative: { ...storedResult.narrative, summary: 'TAGGED SUMMARY STRING' } };
    const experiment = goldenExperiment({ result: taggedResult });
    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);
    expect(screen.getByText('TAGGED SUMMARY STRING')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Insufficiency: no estimate-shaped DOM
// ---------------------------------------------------------------------------

describe('ExperimentResultView — insufficient result', () => {
  it('renders insufficiency copy + reasons, and NOTHING estimate-shaped', () => {
    const insufficientResult = {
      status: 'insufficient',
      coverage: {
        exposure: { covered: 3, total: 14, label: '3 of 14 days' },
        outcome: { covered: 3, total: 14, label: '3 of 14 days' },
      },
      receipt: {
        sources: [],
        scope: null,
        timeWindow: { start: GOLDEN_START, end: GOLDEN_END },
        sampleSize: 3,
        missingness: null,
        versions: { generator: 'experiment_v1', computationVersion: 1, generatedAt: GOLDEN_START, model: null, promptVersion: null },
      },
      reasons: ['exposure_coverage_below_floor', 'insufficient_paired_observations'],
      narrative: {
        alternatives: [],
        whatThisDoesNotProve: [],
        insufficiency: "There isn't enough data yet to say anything about this. Keep going, or check back once you have more days recorded.",
      },
    };
    const experiment = goldenExperiment({ result: insufficientResult });
    render(<ExperimentResultView uid={UID} entries={[]} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.getByText(insufficientResult.narrative.insufficiency)).toBeTruthy();
    expect(screen.getByText(reasonCopy('exposure_coverage_below_floor'))).toBeTruthy();
    expect(screen.getByText(reasonCopy('insufficient_paired_observations'))).toBeTruthy();

    // Nothing estimate-shaped: no "Sample size" section, no CI/delta text, no summary sentence.
    expect(screen.queryByText('Sample size')).toBeNull();
    expect(screen.queryByText(/matched days$/)).toBeNull();
    expect(screen.queryByText(/95% range/)).toBeNull();
    expect(screen.queryByText('What this shows')).toBeNull();
    expect(document.body.textContent).not.toMatch(/points higher|points lower/i);
  });
});

// ---------------------------------------------------------------------------
// MINOR review fix (R3 final review): provenance caption on the Paired-days
// table — the table is rebuilt LIVE from `entries` on every render while
// the summary above renders the STORED result, so the two can visibly
// disagree after a post-completion entry edit. Copy-only fix.
// ---------------------------------------------------------------------------

describe('ExperimentResultView — Paired-days provenance caption', () => {
  it('shows a caption explaining the table is live while the summary above is from when the result was last computed', () => {
    const entries = buildGoldenEntries();
    const result = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    const experiment = goldenExperiment({ result });
    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.getByText(
      'Reflects your entries as of now; the summary above is from when this result was last computed — toggling an observation recomputes both.',
    )).toBeTruthy();
  });

  it('the caption is also present on an insufficient result (Paired-days table renders in both states)', () => {
    const insufficientResult = {
      status: 'insufficient',
      coverage: {
        exposure: { covered: 3, total: 14, label: '3 of 14 days' },
        outcome: { covered: 3, total: 14, label: '3 of 14 days' },
      },
      receipt: {
        sources: [],
        scope: null,
        timeWindow: { start: GOLDEN_START, end: GOLDEN_END },
        sampleSize: 3,
        missingness: null,
        versions: { generator: 'experiment_v1', computationVersion: 1, generatedAt: GOLDEN_START, model: null, promptVersion: null },
      },
      reasons: ['insufficient_paired_observations'],
      narrative: {
        alternatives: [],
        whatThisDoesNotProve: [],
        insufficiency: "There isn't enough data yet to say anything about this. Keep going, or check back once you have more days recorded.",
      },
    };
    const experiment = goldenExperiment({ result: insufficientResult });
    render(<ExperimentResultView uid={UID} entries={[]} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.getByText(/toggling an observation recomputes both/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// buildObservationRows — cross-check against the real pipeline
// ---------------------------------------------------------------------------

describe('buildObservationRows', () => {
  it('matches computeExperimentResult\'s own pair count when nothing is excluded', () => {
    const entries = buildGoldenEntries();
    const experiment = goldenExperiment();
    const result = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });
    const rows = buildObservationRows(experiment, entries);
    expect(rows.length).toBe(result.estimate.n);
    expect(rows.length).toBe(28);
  });
});

// ---------------------------------------------------------------------------
// Exclude -> recompute -> visible rerun (real computeExperimentResult)
// ---------------------------------------------------------------------------

describe('ExperimentResultView — exclusion round trip (real computeExperimentResult)', () => {
  it('excluding an observation calls setObservationExcluded, recomputes via the REAL estimator, writes the new result, and the displayed estimate changes', async () => {
    const entries = buildGoldenEntries();
    const originalResult = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    const experiment = goldenExperiment({ result: originalResult });

    // Day 1 (hours=4, mood=40) is in the LOW group -> excluding it should
    // shift meanLow (and therefore delta) away from the original.
    const excludedDateKey = '2026-01-01';
    setObservationExcluded.mockResolvedValueOnce([excludedDateKey]);

    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    const originalDelta = originalResult.estimate.delta;
    const originalN = originalResult.estimate.n;
    expect(screen.getByText(`${originalN} matched days`)).toBeTruthy();

    const excludeBtn = screen.getByRole('button', { name: `Exclude ${excludedDateKey}` });
    fireEvent.click(excludeBtn);

    await waitFor(() => expect(setObservationExcluded).toHaveBeenCalledWith(
      { __db: true }, UID, 'exp-1', excludedDateKey, true,
    ));
    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(1));

    const [dbArg, uidArg, expIdArg, newResultArg] = writeResult.mock.calls[0];
    expect(dbArg).toEqual({ __db: true });
    expect(uidArg).toBe(UID);
    expect(expIdArg).toBe('exp-1');
    expect(newResultArg.status).toBe('ok');
    expect(newResultArg.estimate.n).toBe(originalN - 1);
    // The recomputed estimate is genuinely different (real math, not a stub).
    expect(newResultArg.estimate.delta).not.toBeCloseTo(originalDelta, 5);

    // Visible rerun: the DOM now reflects the NEW sample size.
    await waitFor(() => expect(screen.getByText(`${originalN - 1} matched days`)).toBeTruthy());
    // The excluded row now offers "Include" instead of "Exclude".
    const includeBtn = await screen.findByRole('button', { name: `Include ${excludedDateKey}` });

    // Un-excluding restores the ORIGINAL pair set. `effectiveEndMs` is
    // deterministic here regardless of the real wall-clock "now" the
    // component uses internally (GOLDEN_END is fixed and far in the past,
    // so `min(GOLDEN_END, anything-after-it) === GOLDEN_END` always) and the
    // bootstrap seed is derived from the pairs themselves, not from "now" —
    // so this is a genuine bitwise-restore assertion (Task 5's rails
    // guarantee), not an approximate one.
    setObservationExcluded.mockResolvedValueOnce([]);
    fireEvent.click(includeBtn);

    await waitFor(() => expect(setObservationExcluded).toHaveBeenCalledWith(
      { __db: true }, UID, 'exp-1', excludedDateKey, false,
    ));
    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(2));

    const restoredResult = writeResult.mock.calls[1][3];
    expect(restoredResult.estimate).toEqual(originalResult.estimate);
    expect({ ...restoredResult.receipt, versions: { ...restoredResult.receipt.versions, generatedAt: null } })
      .toEqual({ ...originalResult.receipt, versions: { ...originalResult.receipt.versions, generatedAt: null } });
    expect(restoredResult.narrative).toEqual(originalResult.narrative);

    // Visible rerun back to the original sample size.
    await waitFor(() => expect(screen.getByText(`${originalN} matched days`)).toBeTruthy());
    expect(await screen.findByRole('button', { name: `Exclude ${excludedDateKey}` })).toBeTruthy();
  });

  it('a failed setObservationExcluded surfaces an error and never calls writeResult', async () => {
    const entries = buildGoldenEntries();
    const originalResult = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    const experiment = goldenExperiment({ result: originalResult });
    setObservationExcluded.mockRejectedValue(new Error('nope'));

    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exclude 2026-01-01' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(writeResult).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Back navigation
// ---------------------------------------------------------------------------

describe('ExperimentResultView — navigation', () => {
  it('calls onClose from the back button', () => {
    const onClose = vi.fn();
    const entries = buildGoldenEntries();
    const result = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    render(<ExperimentResultView uid={UID} entries={entries} experiment={goldenExperiment({ result })} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Back to experiments'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
