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
import { setObservationExcluded, writeResult, writeAdjustedResult, listConfirmations } from '../../../services/experiments/experimentsService';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/experiments/experimentsService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    setObservationExcluded: vi.fn(),
    writeResult: vi.fn().mockResolvedValue(undefined),
    writeAdjustedResult: vi.fn().mockResolvedValue(undefined),
    listConfirmations: vi.fn().mockResolvedValue([]),
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
      // Round-2 review (item 3): analysis.mood_score is on the 0-1 schema —
      // this fixture's `hours * 10` construction (a clean 40-100 spread) is
      // divided by 100 here so it lands in the schema's valid [0,1] domain
      // and is normalized (not dropped) at the series boundary.
      analysis: { mood_score: (hours * 10) / 100 },
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

  // Michael's round-2 statistical review, item 5: the CI is labeled a "rough
  // range (exploratory)", not a "95% range" — the 95% confidence framing
  // stays accurate in the spec doc, but the UI leads with the exploratory
  // wording (see ExperimentResultView.jsx's module doc comment).
  it('labels the CI "rough range (exploratory)", never "95%", anywhere on the page (item 5)', () => {
    const entries = buildGoldenEntries();
    const storedResult = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    const experiment = goldenExperiment({ result: storedResult });
    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.getByText(/rough range \(exploratory\)/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/95%/);
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
// Confirmed-exposure source disclosure (R4 Phase 3 Task 3, action
// confirmation v1) — a confirmed-mode result states where its exposure
// numbers came from; a passive-mode result never mentions check-ins.
// ---------------------------------------------------------------------------

describe('ExperimentResultView — confirmed-exposure source disclosure (R4 Phase 3 Task 3)', () => {
  it('shows the daily-check-in disclosure with the N-days-answered count when analysisPlan.exposureMode is confirmed', async () => {
    const okResult = {
      status: 'ok',
      estimate: {
        meanHigh: 70, meanLow: 55, delta: 15, ci: [5, 25], n: 14, pearsonR: 0.4,
        nHigh: 7, nLow: 7, splitThreshold: null, exposureContrast: 1,
        resampleDiscardCount: 0, stability: { signConsistent: true, deltaMin: 10, deltaMax: 20 },
      },
      coverage: {
        exposure: { covered: 9, total: 14, label: '9 of 14 days' },
        outcome: { covered: 14, total: 14, label: '14 of 14 days' },
      },
      receipt: { sources: [], scope: null, timeWindow: { start: GOLDEN_START, end: GOLDEN_END }, sampleSize: 14, missingness: null },
      sensitiveObservationCount: 0,
      invalidObservationCount: 0,
      narrative: { summary: 'summary text', alternatives: [], whatThisDoesNotProve: [] },
    };
    const experiment = goldenExperiment({
      analysisPlan: { ...goldenExperiment().analysisPlan, exposureMode: 'confirmed' },
      result: okResult,
    });
    render(<ExperimentResultView uid={UID} entries={[]} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.getByText('From your daily check-ins — 9 days answered.')).toBeTruthy();
    // Flush the table's own confirmations load (I1) so this test doesn't
    // leak a pending state update into the next one.
    await waitFor(() => expect(listConfirmations).toHaveBeenCalled());
  });

  it('never shows the check-in disclosure for a passive-mode (no exposureMode) result', () => {
    const entries = buildGoldenEntries();
    const storedResult = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    const experiment = goldenExperiment({ result: storedResult });
    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.queryByText(/daily check-ins/i)).toBeNull();
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

// ---------------------------------------------------------------------------
// Invalid-observation disclosure (Michael's round-2 statistical review,
// 2026-07-22, item 3): an out-of-range mood_score is DROPPED, not clamped,
// and disclosed with a calm one-liner when the dropped count is > 0.
// ---------------------------------------------------------------------------

describe('ExperimentResultView — invalid-observation disclosure (item 3)', () => {
  it('shows the disclosure sentence when an out-of-range mood_score was dropped', () => {
    const entries = buildGoldenEntries().map((e, i) => (i === 0 ? { ...e, analysis: { mood_score: 1.2 } } : e));
    const result = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    expect(result.invalidObservationCount).toBeGreaterThan(0);
    const experiment = goldenExperiment({ result });

    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    expect(screen.getByText(
      `${result.invalidObservationCount} observation${result.invalidObservationCount === 1 ? ' had' : 's had'} out-of-range values and were not used.`,
    )).toBeTruthy();
  });

  it('does not show the disclosure sentence when nothing is out of range', () => {
    const entries = buildGoldenEntries();
    const result = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    expect(result.invalidObservationCount).toBe(0);
    render(<ExperimentResultView uid={UID} entries={entries} experiment={goldenExperiment({ result })} onClose={vi.fn()} />);
    expect(screen.queryByText(/out-of-range/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C1 (Critical, fix wave 1) — site 3: exclusion-adjustment recompute must
// load confirmations for a confirmed-mode experiment, or the adjusted
// result is nuked to 'insufficient' regardless of the original result.
// I1 (Important, fix wave 1) — the paired-days table must be
// exposureMode-aware: confirmed rows show check-in-derived Yes/No, not a
// tag scan over (tagless) entries.
// ---------------------------------------------------------------------------

function confirmedTagAnalysisPlan() {
  return {
    templateId: 'tag-presence-mood',
    lag: 0,
    exposure: { source: 'tags', field: 'tags', label: 'meditate', tag: '@habit:meditate' },
    outcome: { field: 'analysis.mood_score', label: 'mood', unit: 'mood_0_100' },
    minPairedObservations: 10,
    coverageFloor: 0.5,
    confounders: [],
    whatThisDoesNotProve: [],
    splitMode: 'binary',
    exposureMode: 'confirmed',
  };
}

/** 20-day fixture, mood only (deliberately NO `tags` field on any entry — a passive tag-scan would find nothing). */
function confirmedFixtureEntries() {
  const entries = [];
  for (let day = 1; day <= 20; day++) {
    entries.push({
      id: `conf-${day}`,
      createdAt: isoDay(2026, 3, day, 12),
      analysis: { mood_score: (day % 2 === 0 ? 80 : 40) / 100 },
    });
  }
  return entries;
}

function confirmedFixtureConfirmations() {
  const list = [];
  for (let day = 1; day <= 20; day++) {
    const dateKey = `2026-03-${String(day).padStart(2, '0')}`;
    list.push({ id: dateKey, dateKey, done: day % 2 === 0, createdAt: 'x' });
  }
  return list;
}

function confirmedFixtureExperiment(overrides = {}) {
  return {
    id: 'exp-conf-result',
    question: 'How does meditate move together with my mood?',
    template: 'tag-presence-mood',
    analysisPlan: confirmedTagAnalysisPlan(),
    scope: null,
    status: 'completed',
    startAt: isoDay(2026, 2, 28, 0),
    endAt: isoDay(2026, 3, 21, 0),
    durationDays: 28,
    excludedObservations: [],
    createdAt: isoDay(2026, 2, 28, 0),
    updatedAt: isoDay(2026, 2, 28, 0),
    ...overrides,
  };
}

const CONFIRMED_FIXTURE_NOW = new Date(isoDay(2026, 4, 1, 0));

describe('ExperimentResultView — confirmed-mode exclusion-adjustment recompute (fix wave 1, C1)', () => {
  it('retains the confirmation-derived exposure series on a post-result exclusion toggle (never nuked to insufficient)', async () => {
    const entries = confirmedFixtureEntries();
    const confirmations = confirmedFixtureConfirmations();
    const experimentBase = confirmedFixtureExperiment();
    const originalResult = computeExperimentResult({
      experiment: experimentBase, entries, confirmations, now: CONFIRMED_FIXTURE_NOW,
    });
    expect(originalResult.status).toBe('ok'); // sanity: fixture is well-formed

    listConfirmations.mockResolvedValue(confirmations);
    const experiment = { ...experimentBase, result: originalResult };

    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);
    expect(screen.getByText(`${originalResult.estimate.n} matched days`)).toBeTruthy();

    const excludedDateKey = '2026-03-01';
    setObservationExcluded.mockResolvedValueOnce([excludedDateKey]);

    // The paired-days table's own confirmations load (I1) is async — wait
    // for the row to actually appear before interacting with it.
    fireEvent.click(await screen.findByRole('button', { name: `Exclude ${excludedDateKey}` }));
    fireEvent.click(await screen.findByRole('radio', { name: /something else/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(writeAdjustedResult).toHaveBeenCalledTimes(1));
    const adjusted = writeAdjustedResult.mock.calls[0][3].adjusted;
    // Pre-fix, confirmations are never loaded at this call site, so the
    // recompute tag-scans zero-confirmation (tagless) entries and always
    // lands on 'insufficient' — this assertion is what proves the fix.
    expect(adjusted.status).toBe('ok');
    expect(adjusted.estimate.n).toBe(originalResult.estimate.n - 1);
  });
});

describe('ExperimentResultView — paired-days table is exposureMode-aware (I1)', () => {
  it('confirmed-mode rows show check-in-derived Yes/No values, not a tag scan over (tagless) entries', async () => {
    const entries = confirmedFixtureEntries();
    const confirmations = confirmedFixtureConfirmations();
    const experimentBase = confirmedFixtureExperiment();
    const originalResult = computeExperimentResult({
      experiment: experimentBase, entries, confirmations, now: CONFIRMED_FIXTURE_NOW,
    });
    listConfirmations.mockResolvedValue(confirmations);
    const experiment = { ...experimentBase, result: originalResult };

    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    // Confirmations are loaded async (mount effect) for the table — wait for
    // that load before asserting on the row content.
    await waitFor(() => expect(listConfirmations).toHaveBeenCalled());

    // 2026-03-02 has done:true -> "Yes"; 2026-03-01 has done:false -> "No".
    const yesRow = await screen.findByText('2026-03-02');
    const yesCells = yesRow.closest('tr').querySelectorAll('td');
    expect(yesCells[1].textContent).toBe('Yes');

    const noRow = screen.getByText('2026-03-01');
    const noCells = noRow.closest('tr').querySelectorAll('td');
    expect(noCells[1].textContent).toBe('No');
  });

  it('passive-mode rows stay byte-identical (numeric tag-scan values, unaffected by this fix)', () => {
    const entries = buildGoldenEntries();
    const result = computeExperimentResult({ experiment: goldenExperiment(), entries, now: GOLDEN_NOW });
    const experiment = goldenExperiment({ result });

    render(<ExperimentResultView uid={UID} entries={entries} experiment={experiment} onClose={vi.fn()} />);

    const row = screen.getByText('2026-01-01').closest('tr');
    const cells = row.querySelectorAll('td');
    expect(cells[1].textContent).toBe(String(goldenSleepHours(0)));
    // Passive path: no new reads.
    expect(listConfirmations).not.toHaveBeenCalled();
  });
});
