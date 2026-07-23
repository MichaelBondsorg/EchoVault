/**
 * ExperimentsScreen — prefill seam tests (R4 Phase 3 Task 2).
 *
 * Follows ExperimentsScreen.test.jsx's harness exactly (only Firestore-
 * touching modules mocked; `questionGate.js`/`templates.js` real, with a
 * spy wrapper on `screenQuestion` so ordering can be pinned precisely).
 *
 * Pins: a valid `prefill` resolves its template, funnels through the SAME
 * `screenAndProceed` choke point (screenQuestion invoked BEFORE any create-
 * flow state advance — proven by forcing a decline verdict and observing
 * the screen does NOT advance past the question gate), and lands the user
 * on the next create step (space/duration) with the template already
 * selected. An unknown templateId is ignored (console.warn + normal open,
 * no screenQuestion call at all). A tag prefill composes the same
 * "How does {tag} move together with my mood?" text `handleTagTemplateAsk`
 * does before screening it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../config/flags', () => ({ getFlag: vi.fn() }));

// Same partial-mock-plus-spy pattern as ExperimentsScreen.test.jsx: the
// REAL screenQuestion/templates run underneath, but the call is observable
// and can be forced to a non-'ok' verdict once to prove gate-before-advance
// ordering.
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

beforeEach(() => {
  vi.clearAllMocks();
  getFlag.mockImplementation((flag) => {
    if (flag === 'contextSpaces') return false;
    if (flag === 'reflectionRecipes') return false;
    return false;
  });
  getExperimentPrefs.mockResolvedValue({ enabled: true });
  writeResult.mockReset();
  writeResult.mockResolvedValue(undefined);
  withExperiments([]);
  withSpaces([]);
});

describe('ExperimentsScreen — prefill (valid template)', () => {
  it('resolves the template, screens its title through screenQuestion, and lands on the duration step with the template selected (contextSpaces off)', async () => {
    render(
      <ExperimentsScreen
        uid={UID}
        entries={[]}
        prefill={{ templateId: 'exercise-minutes-mood' }}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('How long should this run?')).toBeTruthy();
    expect(screenQuestionSpy).toHaveBeenCalledWith('How does exercise move together with my mood?');
    // Landed past the question step — the template picker itself is gone.
    expect(screen.queryByText('Pick a question')).toBeNull();
    // The one-time explainer is never shown on this path.
    expect(screen.queryByText('Before your first experiment')).toBeNull();
  });

  it('lands on the space step instead of duration when contextSpaces is on', async () => {
    getFlag.mockImplementation((flag) => flag === 'contextSpaces');
    render(
      <ExperimentsScreen
        uid={UID}
        entries={[]}
        prefill={{ templateId: 'exercise-minutes-mood' }}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('Which space should this look at?')).toBeTruthy();
  });
});

describe('ExperimentsScreen — prefill safety ordering (gate before advance)', () => {
  it('screenQuestion runs FIRST: a forced non-ok verdict blocks the state advance entirely (decline screen shown, never duration)', async () => {
    screenQuestionSpy.mockReturnValueOnce({ verdict: 'medical' });
    render(
      <ExperimentsScreen
        uid={UID}
        entries={[]}
        prefill={{ templateId: 'exercise-minutes-mood' }}
        onClose={vi.fn()}
      />,
    );

    expect(screenQuestionSpy).toHaveBeenCalledWith('How does exercise move together with my mood?');
    expect(await screen.findByText(/medication or diagnosis/i)).toBeTruthy();
    expect(screen.queryByText('How long should this run?')).toBeNull();
    expect(screen.queryByText('Which space should this look at?')).toBeNull();
  });

  it('a crisis verdict on the prefilled question surfaces the safety-plan CTA instead of advancing', async () => {
    screenQuestionSpy.mockReturnValueOnce({ verdict: 'crisis' });
    const onShowSafetyPlan = vi.fn();
    render(
      <ExperimentsScreen
        uid={UID}
        entries={[]}
        prefill={{ templateId: 'exercise-minutes-mood' }}
        onClose={vi.fn()}
        onShowSafetyPlan={onShowSafetyPlan}
      />,
    );

    expect(await screen.findByText('See my safety plan')).toBeTruthy();
    expect(screen.queryByText('How long should this run?')).toBeNull();
  });
});

describe('ExperimentsScreen — prefill (invalid template id)', () => {
  it('an unknown templateId is ignored: console.warn fires, screenQuestion is never called, and the screen opens normally', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <ExperimentsScreen
        uid={UID}
        entries={[]}
        prefill={{ templateId: 'not-a-real-template' }}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('New experiment')).toBeTruthy();
    expect(screen.queryByText('How long should this run?')).toBeNull();
    expect(screenQuestionSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/not-a-real-template/);
    warnSpy.mockRestore();
  });
});

/** 28 daily entries, most-recent-first, every day tagged and mood-scored —
 * full coverage on both series so the real (unmocked) `preflightExperiment`
 * reports `appropriate: true` for the tag-presence template. */
function taggedEntries(n, tag) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    const ms = Date.now() - i * 24 * 60 * 60 * 1000;
    const d = new Date(ms);
    entries.push({
      id: `entry-${i}`,
      createdAt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)).toISOString(),
      analysis: { mood_score: (60 + (i % 20)) / 100 },
      tags: [tag],
    });
  }
  return entries;
}

describe('ExperimentsScreen — prefill (tag template)', () => {
  it('composes "How does {tag} move together with my mood?" from the tag, screens THAT text, and lands past the question step', async () => {
    render(
      <ExperimentsScreen
        uid={UID}
        entries={[]}
        prefill={{ templateId: 'tag-presence-mood', tag: '@habit:gym' }}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('How long should this run?')).toBeTruthy();
    expect(screenQuestionSpy).toHaveBeenCalledWith('How does gym move together with my mood?');
  });

  it('the composed tag question and the tag itself carry all the way through to the created experiment (question text + analysisPlan.exposure.tag)', async () => {
    render(
      <ExperimentsScreen
        uid={UID}
        entries={taggedEntries(28, '@habit:gym')}
        prefill={{ templateId: 'tag-presence-mood', tag: '@habit:gym' }}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByText('14 days'));
    const startBtn = await screen.findByText('Start');
    expect(startBtn.closest('button')).not.toBeDisabled();
    fireEvent.click(startBtn);

    await waitFor(() => expect(createExperiment).toHaveBeenCalledTimes(1));
    const [, , payload] = createExperiment.mock.calls[0];
    expect(payload.question).toBe('How does gym move together with my mood?');
    expect(payload.analysisPlan.exposure.tag).toBe('@habit:gym');
    expect(buildAnalysisPlan).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tag-presence-mood' }),
      { tag: '@habit:gym' },
    );
    // Flush the remaining awaited call in handleStart (+ its resetCreateFlow
    // state updates) inside `act` before the test ends, same discipline
    // ExperimentsScreen.test.jsx's own "enables Start..." test uses.
    await waitFor(() => expect(startExperiment).toHaveBeenCalledWith({ __db: true }, UID, 'new-exp', 14));
  });
});
