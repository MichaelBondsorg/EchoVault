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
  setConfirmation,
  clearConfirmation,
  listConfirmations,
} from '../../../services/experiments/experimentsService';
import { subscribeSpaces } from '../../../services/spaces/spacesService';
import { getFlag } from '../../../config/flags';
import { computeExperimentResult, localDateKeyForMs } from '../../../services/experiments/computeResult';

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

// Same partial-mock-plus-spy pattern for `screenQuestion` — lets the
// "picker path is still screened" test (R3 final review, Important 2) force
// a non-'ok' verdict for an otherwise-benign canned title without faking
// the gate for every other test in this file, which exercise the genuine
// screener.
const { screenQuestionSpy } = vi.hoisted(() => ({ screenQuestionSpy: vi.fn() }));
vi.mock('../../../services/experiments/questionGate', async (importOriginal) => {
  const actual = await importOriginal();
  screenQuestionSpy.mockImplementation(actual.screenQuestion);
  return { ...actual, screenQuestion: (...args) => screenQuestionSpy(...args) };
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
  setConfirmation: vi.fn().mockResolvedValue(undefined),
  clearConfirmation: vi.fn().mockResolvedValue(undefined),
  listConfirmations: vi.fn().mockResolvedValue([]),
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
      analysis: { mood_score: (60 + (i % 20)) / 100 },
      tags: [],
    });
  }
  return entries;
}

function runningExperiment(overrides = {}) {
  return {
    id: 'exp-1',
    question: 'How does my sleep move together with my mood?',
    template: 'sleep-hours-mood-same-day',
    analysisPlan: {
      templateId: 'sleep-hours-mood-same-day',
      lag: 0,
      exposure: { source: 'health', field: 'sleepHours', label: 'sleep hours' },
      outcome: { field: 'analysis.mood_score', label: 'mood', unit: 'mood_0_100' },
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
    withExperiments([runningExperiment(), runningExperiment({ id: 'exp-2', status: 'stopped', question: 'How does exercise move together with my mood?' })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    expect(await screen.findByText('How does my sleep move together with my mood?')).toBeTruthy();
    expect(screen.getByText('How does exercise move together with my mood?')).toBeTruthy();
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
    fireEvent.change(textarea, { target: { value: 'how does exercise move together with my mood stabilizer dose' } });
    fireEvent.click(screen.getByText('Ask'));

    // Declined (medical: "mood stabilizer" + dose-noun co-occurrence) —
    // the decline screen renders, and the matcher was never reached even
    // though this exact phrase would otherwise match the exercise template.
    expect(await screen.findByText(DECLINE_MEDICAL_SNIPPET)).toBeTruthy();
    expect(matchQuestionToTemplateSpy).not.toHaveBeenCalled();
  });

  it('sanity check: the same phrase WOULD match the exercise template if the matcher ran directly (proves this is a real bypass phrase, not a vacuous test)', async () => {
    const { matchQuestionToTemplate } = await import('../../../services/experiments/templates');
    const direct = matchQuestionToTemplate('how does exercise move together with my mood stabilizer dose', []);
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
    expect(screen.getByText('How does exercise move together with my mood?')).toBeTruthy();
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
    expect(screen.queryByText('See how this moves with my mood')).toBeNull();
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
// IMPORTANT review fix (R3 final review): a canned template tap / the
// tag-template picker select the template DIRECTLY after screenQuestion
// passes, instead of re-deriving it through matchQuestionToTemplate — see
// ExperimentsScreen.jsx's BINDING ORDERING REQUIREMENT + handleTemplateTap/
// handleTagTemplateAsk doc comments for the keyword-collision dead-end this
// closes.
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — picker/tag direct template selection (Important review fix)', () => {
  it('a canned template tap is STILL screened by screenQuestion first (a forced non-ok verdict declines even though the button picks a known-safe template)', async () => {
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} onOpenRecipes={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    await screen.findByText('How does exercise move together with my mood?');

    // Force the NEXT screenQuestion call (this tap's) to decline, proving
    // the picker path still funnels through the safety gate even though it
    // never calls matchQuestionToTemplate.
    screenQuestionSpy.mockReturnValueOnce({ verdict: 'medical' });
    fireEvent.click(screen.getByText('How does exercise move together with my mood?'));

    expect(await screen.findByText(DECLINE_MEDICAL_SNIPPET)).toBeTruthy();
    expect(matchQuestionToTemplateSpy).not.toHaveBeenCalled();
  });

  it('an "exercise"-tagged user can tap the canned exercise button (no ambiguous-match dead-end, no matcher call)', async () => {
    const entries = sleepEntries(5);
    entries[0].tags = ['@habit:exercise']; // tagLabel -> "exercise", colliding with EXERCISE_ALT keywords
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    await screen.findByLabelText('Choose a tag'); // sanity: the tag picker is present too

    fireEvent.click(screen.getByText('How does exercise move together with my mood?'));

    // Proceeds straight to duration (no SpacePicker in this test's flag
    // config) instead of dead-ending on the unmappable notice.
    expect(await screen.findByText('How long should this run?')).toBeTruthy();
    expect(screen.queryByText(/not something engram can measure/i)).toBeNull();
    expect(matchQuestionToTemplateSpy).not.toHaveBeenCalled();
  });

  it('the SAME "exercise"-tagged user can ALSO run a tag experiment on their own "exercise" tag via the tag picker', async () => {
    const entries = sleepEntries(5);
    entries[0].tags = ['@habit:exercise'];
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));

    const tagSelect = await screen.findByLabelText('Choose a tag');
    fireEvent.change(tagSelect, { target: { value: '@habit:exercise' } });
    fireEvent.click(screen.getByText('See how this moves with my mood'));

    expect(await screen.findByText('How long should this run?')).toBeTruthy();
    expect(screen.queryByText(/not something engram can measure/i)).toBeNull();
    expect(matchQuestionToTemplateSpy).not.toHaveBeenCalled();
  });

  it('sanity check: the ambiguity this fix closes is real — matchQuestionToTemplate alone returns null (ambiguous) for the colliding text', async () => {
    const { matchQuestionToTemplate } = await import('../../../services/experiments/templates');
    const direct = matchQuestionToTemplate('How does exercise move together with my mood?', ['@habit:exercise']);
    expect(direct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Confirmed-exposure opt-in toggle (R4 Phase 3 Task 3, action confirmation
// v1) — tag-template create flow only.
// ---------------------------------------------------------------------------

/** `n` daily entries, most-recent-first, every entry carrying `tag` and full mood coverage (mirrors preflight.test.js's own `fullyCoveredEntries(n, {tag})`). */
function tagEntries(n, tag) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    entries.push({
      id: `tag-entry-${i}`,
      createdAt: isoDaysAgo(i),
      tags: [tag],
      analysis: { mood_score: (60 + (i % 20)) / 100 },
    });
  }
  return entries;
}

describe('ExperimentsScreen — confirmed-exposure opt-in toggle (create flow, R4 Phase 3 Task 3)', () => {
  it('does not show the toggle when the user has zero tags', async () => {
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(5)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    await screen.findByText('Pick a question');
    expect(screen.queryByText(/track this with a daily check-in/i)).toBeNull();
  });

  it('shows the toggle, unchecked by default, once the user has at least one tag', async () => {
    const entries = tagEntries(5, '@person:spencer');
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    const toggle = await screen.findByRole('checkbox', { name: /track this with a daily check-in/i });
    expect(toggle.checked).toBe(false);
  });

  it('checking the toggle carries exposureMode:"confirmed" through to buildAnalysisPlan at Start', async () => {
    const entries = tagEntries(28, '@person:spencer');
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));

    const toggle = await screen.findByRole('checkbox', { name: /track this with a daily check-in/i });
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);

    const tagSelect = screen.getByLabelText('Choose a tag');
    fireEvent.change(tagSelect, { target: { value: '@person:spencer' } });
    fireEvent.click(screen.getByText('See how this moves with my mood'));

    fireEvent.click(await screen.findByText('14 days'));
    const startBtn = await screen.findByText('Start');
    expect(startBtn.closest('button')).not.toBeDisabled();
    fireEvent.click(startBtn);

    await waitFor(() => expect(createExperiment).toHaveBeenCalledTimes(1));
    const [, params] = buildAnalysisPlan.mock.calls[buildAnalysisPlan.mock.calls.length - 1];
    expect(params).toEqual({ tag: '@person:spencer', exposureMode: 'confirmed' });
  });

  it('leaving the toggle unchecked carries exposureMode:"passive" through to buildAnalysisPlan at Start', async () => {
    const entries = tagEntries(28, '@person:spencer');
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));

    const tagSelect = await screen.findByLabelText('Choose a tag');
    fireEvent.change(tagSelect, { target: { value: '@person:spencer' } });
    fireEvent.click(screen.getByText('See how this moves with my mood'));

    fireEvent.click(await screen.findByText('14 days'));
    fireEvent.click(await screen.findByText('Start'));

    await waitFor(() => expect(createExperiment).toHaveBeenCalledTimes(1));
    const [, params] = buildAnalysisPlan.mock.calls[buildAnalysisPlan.mock.calls.length - 1];
    expect(params).toEqual({ tag: '@person:spencer', exposureMode: 'passive' });
  });

  it('resetting the create flow (Back) resets the toggle to passive', async () => {
    const entries = tagEntries(5, '@person:spencer');
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByRole('checkbox', { name: /track this with a daily check-in/i }));

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    fireEvent.click(await screen.findByText('New experiment'));
    const toggle = await screen.findByRole('checkbox', { name: /track this with a daily check-in/i });
    expect(toggle.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Preflight review: freeze copy + appropriate=false disables Start
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — preflight review', () => {
  it('blocks Start and shows reasons when the preflight is not appropriate (empty history)', async () => {
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByText('How does exercise move together with my mood?'));
    fireEvent.click(await screen.findByText('14 days'));

    const startBtn = await screen.findByText('Start');
    expect(startBtn.closest('button')).toBeDisabled();
    expect(screen.getByText(/doesn't have enough data yet/i)).toBeTruthy();
  });

  it('shows the freeze copy on the preflight screen', async () => {
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByText('How does exercise move together with my mood?'));
    fireEvent.click(await screen.findByText('14 days'));
    expect(await screen.findByText(/your question and analysis plan lock when you start/i)).toBeTruthy();
  });

  it('enables Start and creates+starts the experiment when data is sufficient', async () => {
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByText('How does my sleep move together with my mood?'));
    fireEvent.click(await screen.findByText('14 days'));

    const startBtn = await screen.findByText('Start');
    expect(startBtn.closest('button')).not.toBeDisabled();
    fireEvent.click(startBtn);

    await waitFor(() => expect(createExperiment).toHaveBeenCalledTimes(1));
    const [dbArg, uidArg, payload] = createExperiment.mock.calls[0];
    expect(dbArg).toEqual({ __db: true });
    expect(uidArg).toBe(UID);
    expect(payload.question).toBe('How does my sleep move together with my mood?');
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
      runningExperiment({ id: 'exp-2', status: 'paused', question: 'How does exercise move together with my mood?' }),
    ]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    await screen.findByText('How does my sleep move together with my mood?');
    const text = document.body.textContent;
    expect(text).not.toMatch(/streak/i);
    expect(text).not.toMatch(/you (missed|forgot|failed)/i);
    expect(text).not.toMatch(/don't break/i);
    expect(text).not.toMatch(/keep it up/i);
    expect(text).not.toMatch(/overdue/i);
  });
});

// ---------------------------------------------------------------------------
// Confirmed-exposure daily check-in row (R4 Phase 3 Task 3, action
// confirmation v1) — running-card region.
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — confirmed-exposure daily check-in row (R4 Phase 3 Task 3)', () => {
  function confirmedRunningExperiment(overrides = {}) {
    return runningExperiment({
      id: 'exp-conf',
      question: 'How does meditate move together with my mood?',
      analysisPlan: {
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
      },
      ...overrides,
    });
  }

  it('renders the check-in row only for a RUNNING confirmed-mode experiment (not passive, not paused)', async () => {
    withExperiments([
      confirmedRunningExperiment(),
      runningExperiment({ id: 'exp-passive', question: 'How does my sleep move together with my mood?' }),
      confirmedRunningExperiment({ id: 'exp-conf-paused', status: 'paused', question: 'How does exercise move together with my mood?' }),
    ]);
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    await screen.findByText('How does meditate move together with my mood?');

    expect(screen.getAllByText(/did you do meditate today/i)).toHaveLength(1);
  });

  it('calls setConfirmation(db, uid, experimentId, todayKey, true) when Yes is clicked, then re-shows it pressed', async () => {
    withExperiments([confirmedRunningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    await screen.findByText(/did you do meditate today/i);

    // The mount-time call already resolved via the default `[]` mock above —
    // queue exactly ONE more resolved value, for the re-fetch triggered by
    // the click below (refreshKey bump).
    const todayKey = localDateKeyForMs(Date.now(), 'UTC');
    listConfirmations.mockResolvedValueOnce([{ id: todayKey, dateKey: todayKey, done: true, createdAt: 'x' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    await waitFor(() => expect(setConfirmation).toHaveBeenCalledWith({ __db: true }, UID, 'exp-conf', todayKey, true));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('calls clearConfirmation(db, uid, experimentId, todayKey) when Clear is clicked', async () => {
    withExperiments([confirmedRunningExperiment()]);
    const todayKey = localDateKeyForMs(Date.now(), 'UTC');
    listConfirmations.mockResolvedValue([{ id: todayKey, dateKey: todayKey, done: false, createdAt: 'x' }]);
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    const clearBtn = await screen.findByRole('button', { name: 'Clear' });
    fireEvent.click(clearBtn);
    await waitFor(() => expect(clearConfirmation).toHaveBeenCalledWith({ __db: true }, UID, 'exp-conf', todayKey));
  });
});

// ---------------------------------------------------------------------------
// Pause / resume / stop / delete
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — pause/resume/stop/delete', () => {
  it('pauses a running experiment immediately (no confirm)', async () => {
    withExperiments([runningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/pause how does my sleep move together with my mood/i));
    await waitFor(() => expect(pauseExperiment).toHaveBeenCalledWith({ __db: true }, UID, 'exp-1'));
  });

  it('resumes a paused experiment immediately (no confirm)', async () => {
    withExperiments([runningExperiment({ status: 'paused' })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/resume how does my sleep move together with my mood/i));
    await waitFor(() => expect(resumeExperiment).toHaveBeenCalledWith({ __db: true }, UID, 'exp-1'));
  });

  it('stop requires confirmation and states entries are untouched', async () => {
    withExperiments([runningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/stop how does my sleep move together with my mood/i));
    expect(stopExperiment).not.toHaveBeenCalled();
    expect(await screen.findByText(/never changed or removed/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Stop'));
    await waitFor(() => expect(stopExperiment).toHaveBeenCalledWith({ __db: true }, UID, 'exp-1'));
  });

  it('Cancel on the stop dialog never calls stopExperiment', async () => {
    withExperiments([runningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/stop how does my sleep move together with my mood/i));
    fireEvent.click(await screen.findByText('Cancel'));
    expect(stopExperiment).not.toHaveBeenCalled();
  });

  it('delete requires confirmation and calls deleteExperiment(db, uid, id)', async () => {
    withExperiments([runningExperiment({ status: 'stopped' })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/delete how does my sleep move together with my mood/i));
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
      .toBe('How does my sleep move together with my mood?');
  });
});

// ---------------------------------------------------------------------------
// "Repeat this experiment" (R4 Phase 3 Task 6, repeated trials) — reuses the
// T2 prefill mechanism INTERNALLY (`enterPrefillFlow`, shared with the
// prefill effect): screenQuestion runs again, the SAME template/tag is
// resolved from the completed experiment's own stored fields, and
// exposureMode is chosen FRESH (never inherited from the prior frozen plan).
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — Repeat this experiment (R4 Phase 3 Task 6)', () => {
  it('re-enters the create flow via screenAndProceed for a plain (non-tag) completed experiment, screening the template\'s own title and landing on duration with it selected', async () => {
    withExperiments([runningExperiment({ status: 'completed', result: { status: 'ok' } })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Repeat this experiment'));

    expect(await screen.findByText('How long should this run?')).toBeTruthy();
    expect(screenQuestionSpy).toHaveBeenCalledWith('How does my sleep move together with my mood?');
    // Never opened the result view instead of the create flow.
    expect(screen.queryByTestId('result-view')).toBeNull();
  });

  it('a repeat of a tag-template experiment composes the SAME co-movement question from the stored analysisPlan.exposure.tag, and shows a FRESH exposureMode toggle defaulting unchecked — never inherited from the prior run\'s frozen "confirmed" plan', async () => {
    const tagExperiment = runningExperiment({
      id: 'exp-tag',
      status: 'completed',
      question: 'How does gym move together with my mood?',
      template: 'tag-presence-mood',
      analysisPlan: {
        templateId: 'tag-presence-mood',
        lag: 0,
        exposure: { source: 'tags', label: 'this tag', tag: '@habit:gym' },
        outcome: { field: 'analysis.mood_score', label: 'mood' },
        exposureMode: 'confirmed', // the PRIOR run's frozen choice — must not carry forward
        minPairedObservations: 10,
        coverageFloor: 0.5,
        confounders: [],
        whatThisDoesNotProve: [],
      },
      result: { status: 'ok' },
    });
    withExperiments([tagExperiment]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Repeat this experiment'));

    expect(await screen.findByText('How long should this run?')).toBeTruthy();
    expect(screenQuestionSpy).toHaveBeenCalledWith('How does gym move together with my mood?');
    const toggle = await screen.findByRole('checkbox', { name: /track this with a daily check-in/i });
    expect(toggle.checked).toBe(false);
  });

  it('screenQuestion still runs FIRST on a repeat: a forced decline verdict blocks the advance entirely (no shortcut past the safety gate for a "known-safe" repeat)', async () => {
    screenQuestionSpy.mockReturnValueOnce({ verdict: 'medical' });
    withExperiments([runningExperiment({ status: 'completed', result: { status: 'ok' } })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Repeat this experiment'));

    expect(await screen.findByText(/medication or diagnosis/i)).toBeTruthy();
    expect(screen.queryByText('How long should this run?')).toBeNull();
  });

  it('an unresolvable stored templateId is ignored — console.warn, the list view stays put — rather than crashing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withExperiments([runningExperiment({ status: 'completed', template: 'not-a-real-template', result: { status: 'ok' } })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Repeat this experiment'));

    expect(screen.queryByText('How long should this run?')).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/not-a-real-template/);
    warnSpy.mockRestore();
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
    fireEvent.click(await screen.findByText('How does exercise move together with my mood?'));
    expect(await screen.findByText('How long should this run?')).toBeTruthy();
    expect(subscribeSpaces).not.toHaveBeenCalled();
  });

  it('flag on: shows the space step before duration', async () => {
    getFlag.mockImplementation((flag) => flag === 'contextSpaces');
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText('New experiment'));
    fireEvent.click(await screen.findByText('How does exercise move together with my mood?'));
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
    await screen.findByText('How does my sleep move together with my mood?');

    const modals = document.querySelectorAll('[aria-modal="true"]');
    expect(modals).toHaveLength(1);
    expect(modals[0]).toHaveAttribute('aria-labelledby', 'experiments-title');
  });

  it('only one aria-modal="true" node exists while the stop-confirm dialog is open', async () => {
    withExperiments([runningExperiment()]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/stop how does my sleep move together with my mood/i));
    await screen.findByText('Stop this experiment?');

    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  });

  it('only one aria-modal="true" node exists while the delete-confirm dialog is open', async () => {
    withExperiments([runningExperiment({ status: 'stopped' })]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(28)} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByLabelText(/delete how does my sleep move together with my mood/i));
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
    await screen.findByText('How does my sleep move together with my mood?');
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
    expect(await screen.findByText('How does my sleep move together with my mood?')).toBeTruthy();

    // The completingRef guard is released in a `finally`, so once the first
    // (rejected) attempt has settled, a later snapshot of the SAME
    // still-elapsed doc retries — this is the documented best-effort
    // semantics ("a transient failure just means the next render pass...
    // retries"), pinned precisely here rather than assumed.
    control.emit([{ ...experiment }]);
    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(2));
  });

  // -------------------------------------------------------------------
  // MINOR review fix (R3 final review): entries-ready guard — see module
  // doc comment's "ENTRIES-READY GUARD" section.
  // -------------------------------------------------------------------

  it('does NOT auto-complete an elapsed experiment while `entries` is still an empty array (no entries-ready signal)', async () => {
    const experiment = elapsedExperiment();
    withExperiments([experiment]);
    render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    await screen.findByText('How does my sleep move together with my mood?');
    // Give any (wrongly) fired effect a tick to have called writeResult.
    await act(async () => { await Promise.resolve(); });
    expect(writeResult).not.toHaveBeenCalled();
  });

  it('auto-completes once entries arrive on a later render (same elapsed experiment, entries prop goes from [] to populated)', async () => {
    const experiment = elapsedExperiment();
    withExperiments([experiment]);
    const { rerender } = render(<ExperimentsScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    await screen.findByText('How does my sleep move together with my mood?');
    await act(async () => { await Promise.resolve(); });
    expect(writeResult).not.toHaveBeenCalled();

    rerender(<ExperimentsScreen uid={UID} entries={sleepEntries(40)} onClose={vi.fn()} />);
    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(1));
    expect(writeResult.mock.calls[0][2]).toBe('exp-1');
  });

  it('an explicit `entriesLoaded={true}` prop is trusted even with zero entries (skips the length fallback)', async () => {
    // A genuinely-empty-but-loaded entries pool: computeExperimentResult
    // still runs (and, for this fixture, comes back `insufficient` — no
    // entries at all — but the point pinned here is that it RUNS).
    const experiment = elapsedExperiment();
    withExperiments([experiment]);
    render(<ExperimentsScreen uid={UID} entries={[]} entriesLoaded onClose={vi.fn()} />);
    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(1));
    expect(writeResult.mock.calls[0][3].status).toBe('insufficient');
  });

  it('an explicit `entriesLoaded={false}` prop blocks auto-completion even with a non-empty entries pool', async () => {
    const experiment = elapsedExperiment();
    withExperiments([experiment]);
    render(<ExperimentsScreen uid={UID} entries={sleepEntries(40)} entriesLoaded={false} onClose={vi.fn()} />);
    await screen.findByText('How does my sleep move together with my mood?');
    await act(async () => { await Promise.resolve(); });
    expect(writeResult).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C1 (Critical, fix wave 1): confirmations must actually be loaded into
// compute at every call site — a confirmed-mode experiment must not ALWAYS
// compute 0-coverage insufficiency because no site ever fetches its
// confirmations subcollection. Two of the three C1 call sites live in this
// file (the third, the exclusion-adjustment recompute, is covered in
// ExperimentResultView.test.jsx).
// ---------------------------------------------------------------------------

describe('ExperimentsScreen — confirmed-mode compute wiring (fix wave 1, C1)', () => {
  /** The local ('UTC') dateKey for `daysAgo` days before "now" at noon — matches the confirmations/entries fixtures below to the real window computation. */
  function confirmedDateKey(daysAgo) {
    return localDateKeyForMs(Date.parse(isoDaysAgo(daysAgo, 12)), 'UTC');
  }

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

  it('auto-complete (site 1) loads confirmations and stores a result whose exposure coverage reflects the seeded check-in days (status ok)', async () => {
    // Elapsed window: day1 = 39 days ago .. effectiveEnd = 10 days ago
    // (exclusive) — see computeResult.js's PARTIAL START DAY RULE. Pick 20
    // days safely inside that range, alternating done true/false with a
    // matching mood contrast so the fixture is unambiguously 'ok'.
    const experiment = runningExperiment({
      id: 'exp-conf-auto',
      question: 'How does meditate move together with my mood?',
      startAt: isoDaysAgo(40, 0),
      endAt: isoDaysAgo(10, 0),
      analysisPlan: confirmedTagAnalysisPlan(),
    });
    const daysAgoList = Array.from({ length: 20 }, (_, i) => 12 + i); // 12..31
    const confirmations = daysAgoList.map((d, idx) => {
      const dateKey = confirmedDateKey(d);
      return { id: dateKey, dateKey, done: idx % 2 === 0, createdAt: 'x' };
    });
    const entries = daysAgoList.map((d, idx) => ({
      id: `mood-auto-${d}`,
      createdAt: isoDaysAgo(d, 12),
      analysis: { mood_score: idx % 2 === 0 ? 0.8 : 0.4 },
    }));

    withExperiments([experiment]);
    listConfirmations.mockResolvedValue(confirmations);
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);

    await waitFor(() => expect(writeResult).toHaveBeenCalledTimes(1));
    expect(listConfirmations).toHaveBeenCalledWith({ __db: true }, UID, 'exp-conf-auto');

    const payload = writeResult.mock.calls[0][3];
    expect(payload.status).toBe('ok');
    expect(payload.coverage.exposure.covered).toBe(20);
    expect(payload.estimate.n).toBe(20);
    expect(payload.estimate.delta).toBeGreaterThan(0);
  });

  it('the running card (site 2) shows exposure coverage-so-far derived from seeded confirmations, not tag-scanned (tagless) entries', async () => {
    const experiment = runningExperiment({
      id: 'exp-conf-row',
      question: 'How does meditate move together with my mood?',
      analysisPlan: confirmedTagAnalysisPlan(),
      // default fixture window: startAt 14 days ago, endAt 14 days in the
      // future — NOT elapsed, so this exercises the row's live coverage
      // computation rather than auto-completion.
    });
    const daysAgoList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const confirmations = daysAgoList.map((d, idx) => {
      const dateKey = confirmedDateKey(d);
      return { id: dateKey, dateKey, done: idx % 2 === 0, createdAt: 'x' };
    });
    // Entries carry mood only — NO `tags` field at all, so a passive
    // tag-scan would find nothing; a confirmed-mode fix must ignore that
    // and read the confirmations subcollection instead.
    const entries = daysAgoList.map((d, idx) => ({
      id: `mood-row-${d}`,
      createdAt: isoDaysAgo(d, 12),
      analysis: { mood_score: idx % 2 === 0 ? 0.8 : 0.4 },
    }));

    withExperiments([experiment]);
    listConfirmations.mockResolvedValue(confirmations);
    render(<ExperimentsScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    await screen.findByText('How does meditate move together with my mood?');

    const exposureLine = await screen.findByText(/^\d+ of \d+ days have meditate data$/);
    const [covered] = exposureLine.textContent.match(/^(\d+) of/).slice(1).map(Number);
    expect(covered).toBe(10);
  });
});
