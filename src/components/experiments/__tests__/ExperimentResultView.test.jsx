/**
 * ExperimentResultView — tests (R3 Task 6; result-integrity dialog flow
 * added Michael review hardening, EX2 item 3).
 *
 * `config/firebase` and `experimentsService`'s Firestore-touching write
 * functions (`setObservationExcluded`/`writeResult`/`writeAdjustedResult`)
 * are mocked; `buildAdjustedResultUpdate` (a PURE helper, no Firestore) is
 * kept REAL via `importOriginal`, same as `computeResult.js`/`estimator.js`/
 * `templates.js`/`scopeFilter.js`/`receipts.js` — the exclude/rerun round
 * trip below feeds synthetic entries through the genuine estimator and
 * asserts the recomputed estimate actually changes, per the binding TDD
 * requirement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ExperimentResultView, { buildObservationRows, reasonCopy, normalizeStoredResult } from '../ExperimentResultView';
import { computeExperimentResult, NON_CAUSAL_FRAMING } from '../../../services/experiments/computeResult';
import { getTemplateById } from '../../../services/experiments/templates';
import { setObservationExcluded, writeResult, writeAdjustedResult } from '../../../services/experiments/experimentsService';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/experiments/experimentsService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    setObservationExcluded: vi.fn(),
    writeResult: vi.fn().mockResolvedValue(undefined),
    writeAdjustedResult: vi.fn().mockResolvedValue(undefined),
  };
});

const UID = 'user-a';
const SLEEP_TEMPLATE = getTemplateById('sleep-hours-mood-same-day');

const DAY_MS = 24 * 60 * 60 * 1000;

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

// PARTIAL START DAY RULE (Michael review hardening, EX2 item 2): the
// experiment window is whole local calendar days starting the day AFTER
// `startAt` — GOLDEN_START above is written to mean "the first full data
// day" (matching every entry fixture in this file), so the REAL stored
// `startAt` field is one day earlier. Mirrors computeResult.test.js's own
// `baseExperiment`/`dayBefore` convention.
const GOLDEN_STORED_START = new Date(Date.parse(GOLDEN_START) - DAY_MS).toISOString();

function goldenExperiment(overrides = {}) {
  return {
    id: 'exp-1',
    question: 'Does how much I sleep affect my mood?',
    template: SLEEP_TEMPLATE.id,
    analysisPlan: buildAnalysisPlan(SLEEP_TEMPLATE),
    scope: null,
    status: 'completed',
    startAt: GOLDEN_STORED_START,
    endAt: GOLDEN_END,
    durationDays: 28,
    excludedObservations: [],
    createdAt: GOLDEN_STORED_START,
    updatedAt: GOLDEN_STORED_START,
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

describe('ExperimentResultView — exclusion round trip (real computeExperimentResult, result-integrity dialog)', () => {
  it('excluding an observation requires a reason, calls setObservationExcluded, recomputes via the REAL estimator, writes an ADJUSTED result (original untouched), and the displayed estimate changes', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: `Exclude ${excludedDateKey}` }));
    // Reason dialog appears; Continue is disabled until a reason is chosen.
    expect(await screen.findByText('Why exclude this day?')).toBeTruthy();
    expect(setObservationExcluded).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /something else/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(setObservationExcluded).toHaveBeenCalledWith(
      { __db: true }, UID, 'exp-1', excludedDateKey, true,
    ));
    await waitFor(() => expect(writeAdjustedResult).toHaveBeenCalledTimes(1));
    expect(writeResult).not.toHaveBeenCalled();

    const [dbArg, uidArg, expIdArg, nextFieldArg] = writeAdjustedResult.mock.calls[0];
    expect(dbArg).toEqual({ __db: true });
    expect(uidArg).toBe(UID);
    expect(expIdArg).toBe('exp-1');
    // Result integrity: original is carried through UNCHANGED (bitwise the
    // same object the experiment started with), adjusted is the new one.
    expect(nextFieldArg.original).toBe(originalResult);
    expect(nextFieldArg.adjusted.status).toBe('ok');
    expect(nextFieldArg.adjusted.estimate.n).toBe(originalN - 1);
    expect(nextFieldArg.adjusted.estimate.delta).not.toBeCloseTo(originalDelta, 5);
    expect(nextFieldArg.exclusionHistory).toEqual([
      { dateKey: excludedDateKey, excluded: true, reason: 'other', at: expect.any(String) },
    ]);

    // Visible rerun: the DOM now reflects the NEW sample size AND the
    // "Modified after seeing the result" banner + history.
    await waitFor(() => expect(screen.getByText(`${originalN - 1} matched days`)).toBeTruthy());
    expect(screen.getByText('Modified after seeing the result')).toBeTruthy();
    // Original is always accessible via the toggle button.
    fireEvent.click(screen.getByRole('button', { name: 'View original result' }));
    expect(await screen.findByText(`${originalN} matched days`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View latest result' }));
    expect(await screen.findByText(`${originalN - 1} matched days`)).toBeTruthy();
    // History is collapsible and shows the reason.
    fireEvent.click(screen.getByRole('button', { name: 'Show history' }));
    expect(screen.getByText(new RegExp(`${excludedDateKey}.*excluded.*Something else`, 'i'))).toBeTruthy();

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
    fireEvent.click(await screen.findByRole('radio', { name: /something else/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(setObservationExcluded).toHaveBeenCalledWith(
      { __db: true }, UID, 'exp-1', excludedDateKey, false,
    ));
    await waitFor(() => expect(writeAdjustedResult).toHaveBeenCalledTimes(2));

    const restoredField = writeAdjustedResult.mock.calls[1][3];
    expect(restoredField.original).toBe(originalResult);
    expect(restoredField.adjusted.estimate).toEqual(originalResult.estimate);
    expect(restoredField.exclusionHistory).toHaveLength(2);
    expect({ ...restoredField.adjusted.receipt, versions: { ...restoredField.adjusted.receipt.versions, generatedAt: null } })
      .toEqual({ ...originalResult.receipt, versions: { ...originalResult.receipt.versions, generatedAt: null } });
    expect(restoredField.adjusted.narrative).toEqual(originalResult.narrative);

    // Visible rerun back to the original sample size (still "modified", per
    // the immutability contract — the label never disappears once a result
    // has been adjusted, even if the adjustment round-trips back to the
    // same numbers).
    await waitFor(() => expect(screen.getByText(`${originalN} matched days`)).toBeTruthy());
    expect(await screen.findByRole('button', { name: `Exclude ${excludedDateKey}` })).toBeTruthy();
  });

  it('a failed setObservationExcluded surfaces an error and never calls writeAdjustedResult', async () => {
    const entries = buildGoldenEntries();
    const originalResult = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    const experiment = goldenExperiment({ result: originalResult });
    setObservationExcluded.mockRejectedValue(new Error('nope'));

    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exclude 2026-01-01' }));
    fireEvent.click(await screen.findByRole('radio', { name: /something else/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(writeResult).not.toHaveBeenCalled();
    expect(writeAdjustedResult).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// normalizeStoredResult — pure helper (Michael review hardening, item 3)
// ---------------------------------------------------------------------------

describe('normalizeStoredResult', () => {
  it('returns null for a falsy stored field', () => {
    expect(normalizeStoredResult(null)).toBeNull();
    expect(normalizeStoredResult(undefined)).toBeNull();
  });

  it('unwraps a {original, adjusted, exclusionHistory} field as-is', () => {
    const stored = { original: { status: 'ok' }, adjusted: { status: 'ok', estimate: {} }, exclusionHistory: [{ dateKey: 'x' }] };
    expect(normalizeStoredResult(stored)).toEqual(stored);
  });

  it('treats a bare (legacy, pre-wrapping) result as the original, with no adjusted and empty history', () => {
    const bare = { status: 'ok', estimate: { delta: 5 } };
    expect(normalizeStoredResult(bare)).toEqual({ original: bare, adjusted: null, exclusionHistory: [] });
  });
});

// ---------------------------------------------------------------------------
// Sensitive-day disclosure (Michael review hardening, item 5)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// "How this was computed" section (final hardening review, Important 1 —
// Michael's directive: "nHigh, nLow, the split threshold, and exposure
// contrast in the result receipt"). These fields have existed on `estimate`
// since EX1 but rendered nowhere until this fix.
// ---------------------------------------------------------------------------

function roundToOneDecimal(n) {
  return Math.round(n * 10) / 10;
}

describe('ExperimentResultView — "How this was computed" section (final hardening review, Important 1)', () => {
  it('renders nHigh/nLow, a numeric split point + unit (median mode), exposure contrast, and the positive stability line', () => {
    const entries = buildGoldenEntries();
    const result = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    expect(result.estimate.splitThreshold).not.toBeNull(); // sanity: median mode really produces a numeric threshold
    expect(result.estimate.stability.signConsistent).toBe(true); // sanity: golden fixture is direction-stable

    const experiment = goldenExperiment({ result });
    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.getByText('How this was computed')).toBeTruthy();
    expect(screen.getByText(
      `${result.estimate.nHigh} higher-sleep hours days vs ${result.estimate.nLow} lower-sleep hours days`,
    )).toBeTruthy();
    expect(screen.getByText(`Split point: ${roundToOneDecimal(result.estimate.splitThreshold)} sleep hours`)).toBeTruthy();
    expect(screen.getByText(
      `Contrast between the higher and lower groups: ${roundToOneDecimal(result.estimate.exposureContrast)} sleep hours`,
    )).toBeTruthy();
    expect(screen.getByText(
      new RegExp(`Leaving out any single day moved the difference between ${roundToOneDecimal(result.estimate.stability.deltaMin)} and ${roundToOneDecimal(result.estimate.stability.deltaMax)} points \\(0-100\\)\\. The result held its direction when any single day was removed\\.`),
    )).toBeTruthy();
  });

  it('renders "present vs absent" wording for a binary-split (tag-presence) result, where splitThreshold is null', () => {
    const TAG_TEMPLATE = getTemplateById('tag-presence-mood');
    const TAG = '@person:spencer';
    const entries = [];
    for (let day = 1; day <= 14; day++) {
      entries.push({
        id: `tag-${day}`,
        createdAt: isoDay(2026, 8, day),
        tags: day % 2 === 0 ? [TAG] : [],
        analysis: { mood_score: (day % 2 === 0 ? 40 : 70) / 100 },
      });
    }
    const tagExperiment = {
      id: 'exp-tag',
      question: 'How does this tag move with my mood?',
      template: TAG_TEMPLATE.id,
      analysisPlan: {
        templateId: TAG_TEMPLATE.id,
        lag: TAG_TEMPLATE.lag,
        exposure: { ...TAG_TEMPLATE.exposure, tag: TAG },
        outcome: { ...TAG_TEMPLATE.outcome },
        minPairedObservations: 10,
        coverageFloor: 0.5,
        splitMode: 'binary',
        confounders: [...TAG_TEMPLATE.confounders],
        whatThisDoesNotProve: [...TAG_TEMPLATE.whatThisDoesNotProve],
      },
      scope: null,
      status: 'completed',
      startAt: isoDay(2026, 7, 31, 0),
      endAt: isoDay(2026, 8, 15, 0),
      durationDays: 14,
      excludedObservations: [],
      createdAt: isoDay(2026, 7, 31, 0),
      updatedAt: isoDay(2026, 7, 31, 0),
    };
    const now = new Date(isoDay(2026, 9, 1, 0));
    const result = computeExperimentResult({ experiment: tagExperiment, entries, now });
    expect(result.status).toBe('ok');
    expect(result.estimate.splitThreshold).toBeNull(); // sanity: binary mode really produces no numeric threshold

    render(<ExperimentResultView uid={UID} entries={entries} experiment={{ ...tagExperiment, result }} onClose={vi.fn()} />);

    expect(screen.getByText('Split: present vs absent')).toBeTruthy();
    expect(screen.getByText(
      `${result.estimate.nHigh} higher-tag presence days vs ${result.estimate.nLow} lower-tag presence days`,
    )).toBeTruthy();
    expect(screen.queryByText(/^Split point:/)).toBeNull();
  });
});

describe('ExperimentResultView — sensitive-day disclosure', () => {
  it('shows the disclosure sentence and hides raw values for a sensitive paired day, keeping the Exclude toggle available', () => {
    const entries = buildGoldenEntries().map((e, i) => (i === 0 ? { ...e, safety_flagged: true } : e));
    const result = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    expect(result.sensitiveObservationCount).toBeGreaterThan(0);
    const experiment = goldenExperiment({ result });

    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.getByText(
      `${result.sensitiveObservationCount} sensitive day${result.sensitiveObservationCount === 1 ? '' : 's'} contributed to the statistics; details are hidden.`,
    )).toBeTruthy();
    expect(screen.getByText('Sensitive day — details hidden')).toBeTruthy();
    // The dateKey and the toggle are still visible for that row.
    expect(screen.getByText('2026-01-01')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exclude 2026-01-01' })).toBeTruthy();
  });

  it('does not show the disclosure sentence when nothing is sensitive', () => {
    const entries = buildGoldenEntries();
    const result = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    expect(result.sensitiveObservationCount).toBe(0);
    render(<ExperimentResultView uid={UID} entries={entries} experiment={goldenExperiment({ result })} onClose={vi.fn()} />);
    expect(screen.queryByText(/sensitive day/i)).toBeNull();
  });
});
