/**
 * ExperimentsScreen — tests (R3 Task 6).
 *
 * Only Firestore-touching modules are mocked (`config/firebase`,
 * `services/experiments/experimentsService`, `services/spaces/spacesService`).
 * `questionGate.js`, `templates.js`, `preflight.js`, `computeResult.js`,
 * `estimator.js` are the REAL, unmocked pure modules — the binding ordering
 * requirement, preflight-blocks-start, and coverage-so-far assertions below
 * exercise genuine behavior, not a mock's stand-in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import ExperimentsScreen from '../ExperimentsScreen';
import {
  subscribeExperiments,
  createExperiment,
  startExperiment,
  pauseExperiment,
  resumeExperiment,
  stopExperiment,
  deleteExperiment,
  writeResult,
  buildAnalysisPlan,
  getExperimentPrefs,
  markExplainerSeen,
} from '../../../services/experiments/experimentsService';
import { subscribeSpaces } from '../../../services/spaces/spacesService';
import { getFlag } from '../../../config/flags';
import { computeExperimentResult } from '../../../services/experiments/computeResult';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../config/flags', () => ({ getFlag: vi.fn() }));

// Partial mock (real TEMPLATES/getTemplateById/matching logic kept intact
// via importOriginal) so the gate-ordering test can spy on
// `matchQuestionToTemplate` without faking its behavior — every other test
// in this file exercises the genuine matcher. `vi.hoisted` is required
// because `vi.mock` factories are hoisted above normal top-level statements.
const { matchQuestionToTemplateSpy } = vi.hoisted(() => ({ matchQuestionToTemplateSpy: vi.fn() }));
vi.mock('../../../services/experiments/templates', async (importOriginal) => {
  const actual = await importOriginal();
  matchQuestionToTemplateSpy.mockImplementation(actual.matchQuestionToTemplate);
  return { ...actual, matchQuestionToTemplate: (...args) => matchQuestionToTemplateSpy(...args) };
});

vi.mock('../../../services/experiments/experimentsService', () => ({
  subscribeExperiments: vi.fn(),
  createExperiment: vi.fn().mockResolvedValue({ id: 'new-exp' }),
  startExperiment: vi.fn().mockResolvedValue(undefined),
  pauseExperiment: vi.fn().mockResolvedValue(undefined),
  resumeExperiment: vi.fn().mockResolvedValue(undefined),
  stopExperiment: vi.fn().mockResolvedValue(undefined),
  deleteExperiment: vi.fn().mockResolvedValue(undefined),
  writeResult: vi.fn().mockResolvedValue(undefined),
  buildAnalysisPlan: vi.fn((template, params) => ({
    templateId: template.id,
    lag: template.lag,
    exposure: params?.tag ? { ...template.exposure, tag: params.tag } : { ...template.exposure },
    outcome: { ...template.outcome },
    minPairedObservations: 10,
    coverageFloor: 0.5,
    confounders: [...(template.confounders || [])],
    whatThisDoesNotProve: [...(template.whatThisDoesNotProve || [])],
  })),
  getExperimentPrefs: vi.fn().mockResolvedValue({ enabled: true }),
  markExplainerSeen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: vi.fn(),
}));

vi.mock('../ExperimentResultView', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: ({ experiment, onClose }) => (
      <div data-testid="result-view">
        <span data-testid="result-view-question">{experiment.question}</span>
        <button type="button" onClick={onClose}>close result</button>
      </div>
    ),
  };
});

const UID = 'user-a';

const withExperiments = (experiments) => {
  subscribeExperiments.mockImplementation((_db, _uid, cb) => {
    cb(experiments);
    return () => {};
  });
};

const withSpaces = (spaces) => {
  subscribeSpaces.mockImplementation((_db, _uid, cb) => {
    cb(spaces);
    return () => {};
  });
};

/**
 * Like `withExperiments`, but keeps a handle on the subscription callback so
 * a test can emit further snapshots (simulating Firestore pushing a second
 * update — e.g. the same still-running doc arriving again before a
 * completion write has round-tripped). Mirrors real `onSnapshot` semantics:
 * the callback can fire more than once over the component's lifetime.
 */
const controlledSubscribe = () => {
  let cb;
  subscribeExperiments.mockImplementation((_db, _uid, callback) => {
    cb = callback;
    return () => {};
  });
  return { emit: (snapshot) => act(() => cb(snapshot)) };
};

function isoDaysAgo(days, hour = 12) {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour)).toISOString();
}

/** `n` daily entries, most-recent-first, fully covered for sleep+mood (mirrors preflight.test.js's fixture). */
function sleepEntries(n) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    entries.push({
      id: `entry-${i}`,
      createdAt: isoDaysAgo(i),
      healthContext: { sleep: { totalHours: 7 + (i % 3) } },
      analysis: { mood_score: 60 + (i % 20) },
      tags: [],
    });
  }
  return entries;
}

function runningExperiment(overrides = {}) {
  return {
    id: 'exp-1',
    question: 'Does how much I sleep affect my mood?',
    template: 'sleep-hours-mood-same-day',
    analysisPlan: {
      templateId: 'sleep-hours-mood-same-day',
      lag: 0,
      exposure: { source: 'health', field: 'sleepHours', label: 'sleep hours' },
      outcome: { field: 'analysis.mood_score', label: 'mood' },
      minPairedObservations: 10,
      coverageFloor: 0.5,
      confounders: [],
      whatThisDoesNotProve: [],
    },
    scope: null,
    status: 'running',
    startAt: isoDaysAgo(14, 0),
    endAt: isoDaysAgo(-14, 0), // 14 days in the future
    durationDays: 28,
    excludedObservations: [],
    createdAt: isoDaysAgo(14, 0),
    updatedAt: isoDaysAgo(14, 0),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getFlag.mockImplementation((flag) => {
    if (flag === 'contextSpaces') return false;
    if (flag === 'reflectionRecipes') return false;
    return false;
  });
  getExperimentPrefs.mockResolvedValue({ enabled: true });
  // `vi.clearAllMocks()` clears call history but NOT a custom
  // `mockImplementation`/pending-promise a test may have installed on
  // `writeResult` (that's `mockReset`'s job, not `mockClear`'s) — restore
  // the factory default explicitly every test so the auto-completion tests
  // below (which override it) can never leak into a later test.
  writeResult.mockReset();
  writeResult.mockResolvedValue(undefined);
  withExperiments([]);
  withSpaces([]);
});

/** An experiment whose window has already fully elapsed (endAt well in the past). */
function elapsedExperiment(overrides = {}) {
  return runningExperiment({
    startAt: isoDaysAgo(40, 0),
    endAt: isoDaysAgo(10, 0),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Null / empty / error states
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — list states', () => {
  it('shows the empty state when the user has zero experiments', async () => {
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    expect(await screen.findByText(/no experiments yet/i)).toBeTruthy();
  });

  it('surfaces an error instead of the empty state when subscribeExperiments reports an error', async () => {
    subscribeExperiments.mockImplementation((_db, _uid, _cb, onError) => {
      onError(new Error('boom'));
      return () => {};
    });
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    expect(await screen.findByText(/could not load your experiments/i)).toBeTruthy();
    expect(screen.queryByText(/no experiments yet/i)).toBeNull();
  });

  it('renders each experiment question and status', async () => {
    withExperiments([runningExperiment(), runningExperiment({ id: 'exp-2', status: 'stopped', question: 'Does exercise affect my mood?' })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    expect(await screen.findByText('Does how much I sleep affect my mood?')).toBeTruthy();
    expect(screen.getByText('Does exercise affect my mood?')).toBeTruthy();
    expect(screen.getByText('Stopped — entries were not affected.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Binding ordering requirement: screenQuestion BEFORE matchQuestionToTemplate
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — gate ordering (binding)', () => {
  it('does NOT call matchQuestionToTemplate when the question is declined (spy assertion)', async () => {
    getExperimentPrefs.mockResolvedValue({ enabled: true });
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('New experiment'));
    const textarea = await screen.findByLabelText(/or ask your own question/i);
    fireEvent.change(textarea, { target: { value: 'does exercise affect my mood stabilizer dose' } });
    fireEvent.click(screen.getByText('Ask'));

    // Declined (medical: "mood stabilizer" + dose-noun co-occurrence) —
    // the decline screen renders, and the matcher was never reached even
    // though this exact phrase would otherwise match the exercise template.
    expect(await screen.findByText(DECLINE_MEDICAL_SNIPPET)).toBeTruthy();
    expect(matchQuestionToTemplateSpy).not.toHaveBeenCalled();
  });

  it('sanity check: the same phrase WOULD match the exercise template if the matcher ran directly (proves this is a real bypass phrase, not a vacuous test)', async () => {
    const { matchQuestionToTemplate } = await import('../../../services/experiments/templates');
    const direct = matchQuestionToTemplate('does exercise affect my mood stabilizer dose', []);
    expect(direct?.template?.id).toBe('exercise-minutes-mood');
  });

  it('does NOT call matchQuestionToTemplate for a crisis-verdict question either', async () => {
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} onShowSafetyPlan={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    const textarea = await screen.findByLabelText(/or ask your own question/i);
    fireEvent.change(textarea, { target: { value: 'I want to kill myself' } });
    fireEvent.click(screen.getByText('Ask'));

    expect(await screen.findByText('See my safety plan')).toBeTruthy();
    expect(matchQuestionToTemplateSpy).not.toHaveBeenCalled();
  });
});

const DECLINE_MEDICAL_SNIPPET = /medication or diagnosis/i;

// ---------------------------------------------------------------------------
// Decline UX per verdict
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — decline UX', () => {
  async function openCreateAndAsk(text) {
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} onShowSafetyPlan={vi.fn()} onOpenRecipes={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    const textarea = await screen.findByLabelText(/or ask your own question/i);
    fireEvent.change(textarea, { target: { value: text } });
    fireEvent.click(screen.getByText('Ask'));
  }

  it('crisis verdict: surfaces the safety-plan CTA and calls onShowSafetyPlan on click', async () => {
    const onShowSafetyPlan = vi.fn();
    const onClose = vi.fn();
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={onClose} onShowSafetyPlan={onShowSafetyPlan} />);
    fireEvent.click(await screen.findByText('New experiment'));
    const textarea = await screen.findByLabelText(/or ask your own question/i);
    fireEvent.change(textarea, { target: { value: 'I want to kill myself' } });
    fireEvent.click(screen.getByText('Ask'));

    const safetyBtn = await screen.findByText('See my safety plan');
    fireEvent.click(safetyBtn);
    expect(onShowSafetyPlan).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('medical verdict without reflectionRecipes: shows decline copy, no Recipes CTA', async () => {
    getFlag.mockImplementation((flag) => flag === 'reflectionRecipes' ? false : false);
    await openCreateAndAsk('Should I stop taking my antidepressants?');
    expect(await screen.findByText(DECLINE_MEDICAL_SNIPPET)).toBeTruthy();
    expect(screen.queryByText('Try a Reflection Recipe instead')).toBeNull();
    expect(screen.getByText('Try a different question')).toBeTruthy();
  });

  it('medical verdict with reflectionRecipes on: shows the Recipes CTA, which calls onOpenRecipes', async () => {
    getFlag.mockImplementation((flag) => flag === 'reflectionRecipes');
    const onOpenRecipes = vi.fn();
    const onClose = vi.fn();
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={onClose} onOpenRecipes={onOpenRecipes} />);
    fireEvent.click(await screen.findByText('New experiment'));
    const textarea = await screen.findByLabelText(/or ask your own question/i);
    fireEvent.change(textarea, { target: { value: 'Should I stop taking my antidepressants?' } });
    fireEvent.click(screen.getByText('Ask'));

    const recipesBtn = await screen.findByText('Try a Reflection Recipe instead');
    fireEvent.click(recipesBtn);
    expect(onOpenRecipes).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"Try a different question" returns to the question step', async () => {
    await openCreateAndAsk('Should I stop taking my antidepressants?');
    fireEvent.click(await screen.findByText('Try a different question'));
    expect(await screen.findByLabelText(/or ask your own question/i)).toBeTruthy();
  });

  it('unmappable question: shows a notice and keeps the template picker visible', async () => {
    await openCreateAndAsk('What is the meaning of life');
    expect(await screen.findByText(/not something engram can measure/i)).toBeTruthy();
    expect(screen.getByText('Does exercise affect my mood?')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Template picker: tag-presence template only appears with >=1 real tag
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — template picker (tag template gating)', () => {
  it('hides the tag-presence template entirely when the user has zero tags', async () => {
    // sleepEntries() builds every fixture entry with `tags: []` — zero tags
    // across the whole pool is exactly the case this test pins.
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(5)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    await screen.findByText('Pick a question');
    expect(screen.queryByLabelText('Choose a tag')).toBeNull();
    expect(screen.queryByText('Does this affect my mood?')).toBeNull();
  });

  it('shows the tag-presence picker once the user has at least one tag', async () => {
    const entries = sleepEntries(5);
    entries[0].tags = ['@person:spencer'];
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    expect(await screen.findByLabelText('Choose a tag')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Preflight review: freeze copy + appropriate=false disables Start
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — preflight review', () => {
  it('blocks Start and shows reasons when the preflight is not appropriate (empty history)', async () => {
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByText('Does exercise affect my mood?'));
    fireEvent.click(await screen.findByText('14 days'));

    const startBtn = await screen.findByText('Start');
    expect(startBtn.closest('button')).toBeDisabled();
    expect(screen.getByText(/doesn't have enough data yet/i)).toBeTruthy();
  });

  it('shows the freeze copy on the preflight screen', async () => {
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByText('Does exercise affect my mood?'));
    fireEvent.click(await screen.findByText('14 days'));
    expect(await screen.findByText(/your question and analysis plan lock when you start/i)).toBeTruthy();
  });

  it('enables Start and creates+starts the experiment when data is sufficient', async () => {
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByText('Does how much I sleep affect my mood?'));
    fireEvent.click(await screen.findByText('14 days'));

    const startBtn = await screen.findByText('Start');
    expect(startBtn.closest('button')).not.toBeDisabled();
    fireEvent.click(startBtn);

    await waitFor(() => expect(createExperiment).toHaveBeenCalledTimes(1));
    const [dbArg, uidArg, payload] = createExperiment.mock.calls[0];
    expect(dbArg).toEqual({ __db: true });
    expect(uidArg).toBe(UID);
    expect(payload.question).toBe('Does how much I sleep affect my mood?');
    expect(payload.durationDays).toBe(14);
    expect(payload.scope).toBeNull();
    expect(payload.analysisPlan.templateId).toBe('sleep-hours-mood-same-day');

    await waitFor(() => expect(startExperiment).toHaveBeenCalledWith({ __db: true }, UID, 'new-exp', 14));
  });
});

// ---------------------------------------------------------------------------
// One-time explainer
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — one-time explainer', () => {
  it('shows the explainer before the first create flow, then marks it seen and opens the create flow', async () => {
    getExperimentPrefs.mockResolvedValue({ enabled: false });
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('New experiment'));
    expect(await screen.findByText('Before your first experiment')).toBeTruthy();
    // The create flow itself must not be visible yet.
    expect(screen.queryByLabelText(/or ask your own question/i)).toBeNull();

    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(markExplainerSeen).toHaveBeenCalledWith({ __db: true }, UID));
    expect(await screen.findByLabelText(/or ask your own question/i)).toBeTruthy();
  });

  it('skips the explainer once already seen', async () => {
    getExperimentPrefs.mockResolvedValue({ enabled: true });
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    expect(await screen.findByLabelText(/or ask your own question/i)).toBeTruthy();
    expect(screen.queryByText('Before your first experiment')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Running card: coverage-so-far (real computeExperimentResult), never streak
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — running card', () => {
  it('renders per-variable coverage-so-far ("N of M days have ... data") using the real computeExperimentResult, fully covered', async () => {
    const experiment = runningExperiment({
      startAt: isoDaysAgo(13, 0),
      endAt: isoDaysAgo(-1, 0),
    });
    withExperiments([experiment]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(14)} onClose={vi.fn()} />);
    // Full coverage over the window -> "N of N days have ... data" (covered == total).
    const sleepLine = await screen.findByText(/^\d+ of \d+ days have sleep hours data$/);
    const moodLine = screen.getByText(/^\d+ of \d+ days have mood data$/);
    const [sleepCovered, sleepTotal] = sleepLine.textContent.match(/^(\d+) of (\d+)/).slice(1).map(Number);
    const [moodCovered, moodTotal] = moodLine.textContent.match(/^(\d+) of (\d+)/).slice(1).map(Number);
    expect(sleepCovered).toBe(sleepTotal);
    expect(moodCovered).toBe(moodTotal);
    expect(sleepTotal).toBeGreaterThan(0);
  });

  it('never renders streak/guilt/urgency copy anywhere on the screen', async () => {
    withExperiments([
      runningExperiment(),
      runningExperiment({ id: 'exp-2', status: 'paused', question: 'Does exercise affect my mood?' }),
    ]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    await screen.findByText('Does how much I sleep affect my mood?');
    const text = document.body.textContent;
    expect(text).not.toMatch(/streak/i);
    expect(text).not.toMatch(/you (missed|forgot|failed)/i);
    expect(text).not.toMatch(/don't break/i);
    expect(text).not.toMatch(/keep it up/i);
    expect(text).not.toMatch(/overdue/i);
  });
});

// ---------------------------------------------------------------------------
// Pause / resume / stop / delete
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — pause/resume/stop/delete', () => {
  it('pauses a running experiment immediately (no confirm)', async () => {
    withExperiments([runningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/pause does how much i sleep affect my mood/i));
    await waitFor(() => expect(pauseExperiment).toHaveBeenCalledWith({ __db: true }, UID, 'exp-1'));
  });

  it('resumes a paused experiment immediately (no confirm)', async () => {
    withExperiments([runningExperiment({ status: 'paused' })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/resume does how much i sleep affect my mood/i));
    await waitFor(() => expect(resumeExperiment).toHaveBeenCalledWith({ __db: true }, UID, 'exp-1'));
  });

  it('stop requires confirmation and states entries are untouched', async () => {
    withExperiments([runningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/stop does how much i sleep affect my mood/i));
    expect(stopExperiment).not.toHaveBeenCalled();
    expect(await screen.findByText(/never changed or removed/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Stop'));
    await waitFor(() => expect(stopExperiment).toHaveBeenCalledWith({ __db: true }, UID, 'exp-1'));
  });

  it('Cancel on the stop dialog never calls stopExperiment', async () => {
    withExperiments([runningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/stop does how much i sleep affect my mood/i));
    fireEvent.click(await screen.findByText('Cancel'));
    expect(stopExperiment).not.toHaveBeenCalled();
  });

  it('delete requires confirmation and calls deleteExperiment(db, uid, id)', async () => {
    withExperiments([runningExperiment({ status: 'stopped' })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/delete does how much i sleep affect my mood/i));
    expect(deleteExperiment).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() => expect(deleteExperiment).toHaveBeenCalledWith({ __db: true }, UID, 'exp-1'));
  });
});

// ---------------------------------------------------------------------------
// Completed -> result view swap
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — result view', () => {
  it('opens ExperimentResultView for a completed experiment', async () => {
    withExperiments([runningExperiment({ status: 'completed', result: { status: 'ok' } })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('View result'));
    expect(await screen.findByTestId('result-view')).toBeTruthy();
    expect(within(screen.getByTestId('result-view')).getByTestId('result-view-question').textContent)
      .toBe('Does how much I sleep affect my mood?');
  });
});

// ---------------------------------------------------------------------------
// SpacePicker gated behind contextSpaces
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — SpacePicker gated behind contextSpaces', () => {
  it('flag off: skips straight from question to duration, never subscribes to spaces', async () => {
    getFlag.mockImplementation((flag) => flag === 'contextSpaces' ? false : false);
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByText('Does exercise affect my mood?'));
    expect(await screen.findByText('How long should this run?')).toBeTruthy();
    expect(subscribeSpaces).not.toHaveBeenCalled();
  });

  it('flag on: shows the space step before duration', async () => {
    getFlag.mockImplementation((flag) => flag === 'contextSpaces');
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByText('Does exercise affect my mood?'));
    expect(await screen.findByText('Which space should this look at?')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// a11y: single aria-modal="true" node at a time (RecipesScreen.test.jsx
// :652,662 parity)
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — a11y', () => {
  it('exposes a single labelled aria-modal dialog when no nested overlay is open', async () => {
    withExperiments([runningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    await screen.findByText('Does how much I sleep affect my mood?');

    const modals = document.querySelectorAll('[aria-modal="true"]');
    expect(modals).toHaveLength(1);
    expect(modals[0]).toHaveAttribute('aria-labelledby', 'experiments-title');
  });

  it('only one aria-modal="true" node exists while the stop-confirm dialog is open', async () => {
    withExperiments([runningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/stop does how much i sleep affect my mood/i));
    await screen.findByText('Stop this experiment?');

    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  });

  it('only one aria-modal="true" node exists while the delete-confirm dialog is open', async () => {
    withExperiments([runningExperiment({ status: 'stopped' })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/delete does how much i sleep affect my mood/i));
    await screen.findByText('Delete this experiment?');

    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  });

  it('never more than one aria-modal="true" node while the one-time explainer is open', async () => {
    getExperimentPrefs.mockResolvedValue({ enabled: false });
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    await screen.findByText('Before your first experiment');

    // The outer screen's own `aria-modal` is dropped while the explainer
    // (a real Radix `Dialog`, its own portal) is open — the invariant this
    // pins is "never two simultaneous aria-modal='true' nodes", not "always
    // exactly one": this installed version of `@radix-ui/react-dialog`
    // gives its `Dialog.Content` `role="dialog"` but does not itself add an
    // `aria-modal="true"` attribute, so the genuinely-open explainer dialog
    // is confirmed via its `role="dialog"` node instead.
    expect(document.querySelectorAll('[aria-modal="true"]').length).toBeLessThanOrEqual(1);
    expect(screen.getByRole('dialog', { name: 'Before your first experiment' })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Auto-completion (a design decision this task made — see module doc
// comment on ExperimentsScreen.jsx). A BACKGROUND Firestore write with no
// explicit user action, so it gets its own dedicated, thorough coverage.
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — auto-completion', () => {
  it('an elapsed running experiment auto-completes: writeResult is called once with a real computed result', async () => {
    const entries = sleepEntries(40);
    const experiment = elapsedExperiment();
    withExperiments([experiment]);
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);

    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(1));
    const [dbArg, uidArg, idArg, payload] = writeResult.mock.calls[0];
    expect(dbArg).toEqual({ __db: true });
    expect(uidArg).toBe(UID);
    expect(idArg).toBe('exp-1');
    expect(payload.receipt.versions.generator).toBe('experiment_v1');
    if (payload.status === 'ok') {
      expect(payload.estimate).toBeTruthy();
      expect(payload.estimate.n).toBeGreaterThan(0);
      expect(payload.narrative.summary).toBeTruthy();
    } else {
      expect(payload.status).toBe('insufficient');
      expect(payload.estimate).toBeUndefined();
      expect(payload.narrative.insufficiency).toBeTruthy();
    }
  });

  it('an elapsed PAUSED experiment also auto-completes (paused -> completed path)', async () => {
    const entries = sleepEntries(40);
    const experiment = elapsedExperiment({ status: 'paused' });
    withExperiments([experiment]);
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);

    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(1));
    expect(writeResult.mock.calls[0][2]).toBe('exp-1');
  });

  it('does NOT auto-complete a running experiment whose window has not elapsed', async () => {
    withExperiments([runningExperiment()]); // default fixture: endAt 14 days in the future
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    await screen.findByText('Does how much I sleep affect my mood?');
    expect(writeResult).not.toHaveBeenCalled();
  });

  it('does not double-write when a second snapshot arrives with the SAME still-running doc before the first write resolves (completingRef guard)', async () => {
    const entries = sleepEntries(40);
    const experiment = elapsedExperiment();

    let resolveWrite;
    writeResult.mockImplementation(() => new Promise((resolve) => { resolveWrite = resolve; }));

    const control = controlledSubscribe();
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    control.emit([experiment]);

    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(1));

    // Simulated Firestore latency: the SAME still-running doc arrives again
    // before the pending write above has resolved (and therefore before the
    // real completed doc would ever come back down the subscription).
    control.emit([{ ...experiment }]);
    // Flush a tick so a (wrongly) re-triggered effect would have had a
    // chance to call writeResult again.
    await act(async () => { await Promise.resolve(); });
    expect(writeResult).toHaveBeenCalledTimes(1);

    // Resolving the pending write releases the guard; no further snapshot
    // is emitted in this test, so no additional call should occur either.
    resolveWrite();
    await act(async () => { await Promise.resolve(); });
    expect(writeResult).toHaveBeenCalledTimes(1);
  });

  it('a writeResult rejection does not crash the screen; a later snapshot is free to retry (best-effort semantics)', async () => {
    const entries = sleepEntries(40);
    const experiment = elapsedExperiment();
    writeResult.mockRejectedValueOnce(new Error('offline'));

    const control = controlledSubscribe();
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    control.emit([experiment]);

    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(1));
    // No crash: the screen is still up and rendering normally.
    expect(await screen.findByText('Does how much I sleep affect my mood?')).toBeTruthy();

    // The completingRef guard is released in a `finally`, so once the first
    // (rejected) attempt has settled, a later snapshot of the SAME
    // still-elapsed doc retries — this is the documented best-effort
    // semantics ("a transient failure just means the next render pass...
    // retries"), pinned precisely here rather than assumed.
    control.emit([{ ...experiment }]);
    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(2));
  });
});
