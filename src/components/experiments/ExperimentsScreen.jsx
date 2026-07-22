import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Pause, Square, Trash2 } from 'lucide-react';
import { db } from '../../config/firebase';
import { getFlag } from '../../config/flags';
import { Button, Chip, Dialog, DialogContent, DialogTitle, DialogDescription } from '../cloud';
import SpacePicker from '../spaces/SpacePicker';
import { useDismissablePopover } from '../../hooks/useDismissablePopover';
import { subscribeSpaces } from '../../services/spaces/spacesService';
import { TEMPLATES, matchQuestionToTemplate } from '../../services/experiments/templates';
import { screenQuestion, DECLINE_CONTRACTS } from '../../services/experiments/questionGate';
import { preflightExperiment } from '../../services/experiments/preflight';
import { computeExperimentResult } from '../../services/experiments/computeResult';
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
} from '../../services/experiments/experimentsService';
import ExperimentResultView, { reasonCopy } from './ExperimentResultView';

/**
 * ExperimentsScreen — full-screen Personal Experiments overlay (R3 Task 6),
 * the consent/comprehension surface for PRD §5.4 "Learn Carefully". Modeled
 * on `RecipesScreen.jsx`'s cloud-sheet layout (same precedent
 * `PrivacyCenter.jsx`/`SpaceManager.jsx`/`InsightControlCenter.jsx`
 * followed), mounted behind `getFlag('personalExperiments')` at the call
 * site (`AppLayout.jsx` + `SettingsPage.jsx` nav row, RecipesScreen mount
 * precedent) — this component itself is flag-agnostic for its OWN gate
 * (matching RecipesScreen, which never re-checks `reflectionRecipes`
 * internally either); it DOES re-check `contextSpaces` (SpacePicker) and
 * `reflectionRecipes` (the medical-decline CTA) internally, same nested-flag
 * convention as `RecipesScreen`'s own `contextSpacesOn`.
 *
 * BINDING ORDERING REQUIREMENT (plan, Task 3/4 reviews): every path into the
 * create flow — a canned template tap OR free-text — calls `screenQuestion`
 * FIRST and only calls `matchQuestionToTemplate` when the verdict is 'ok'.
 * A non-'ok' verdict is a terminal decline for that attempt; the matcher is
 * never reached (see `proceedWithQuestion` below — this is the single
 * choke point every entry path funnels through, so there is no second code
 * path that could accidentally call the matcher first).
 *
 * Create flow: question (template picker + free text) -> questionGate
 * decline (crisis surfaces the safety plan via `onShowSafetyPlan`, medical
 * shows fixed decline copy + a Recipes CTA when `reflectionRecipes` is on,
 * unmappable re-shows the template picker with a notice) -> SpacePicker
 * (`contextSpaces`-gated, R2 pattern verbatim) -> duration (14/28) ->
 * preflight review (coverage, missing sources, confounders, appropriateness
 * — `appropriate:false` disables Start) -> explicit Start (the freeze
 * moment: `createExperiment` then `startExperiment`, both via
 * `experimentsService` — zero direct Firestore in this file).
 *
 * One-time explainer ("associations, not proof") before the first create
 * flow, persisted via `settings/experimentPrefs` (`getExperimentPrefs`/
 * `markExplainerSeen`, the revisitPrefs twin — see experimentsService.js's
 * doc comment for why the marker mechanism is a Firestore doc rather than
 * `RevisitControls`' localStorage marker: the rules for this exact doc were
 * already shipped in Task 2 specifically for this purpose).
 *
 * AUTO-COMPLETION (a design decision this task makes, since no task
 * assigned it explicitly and decision #4 commits to pure client-side
 * computation with "no scheduled function"): once a running OR paused
 * experiment's `endAt` has elapsed, this screen computes the result via the
 * REAL `computeExperimentResult` and writes it via `writeResult` (which
 * also flips status to 'completed' in the same call — see
 * `experimentsService.writeResult`'s doc comment, which explicitly
 * documents `running/paused -> completed` as a legal first-completion
 * transition). Paused is included because `endAt` is a fixed calendar
 * timestamp stamped once at `startExperiment` time and never adjusted by
 * pause/resume (pausing does not extend the deadline) — see the
 * `completingRef` effect below. A per-id in-flight guard prevents a
 * duplicate write while one completion is already being computed.
 *
 * Nested-overlay a11y (RecipesScreen/RevisitControls precedent): only one
 * `aria-modal` dialog is ever active. The one-time explainer is a real
 * Radix `Dialog` (its own portal); the stop/delete confirms are hand-rolled
 * `role="dialog" aria-modal="true"` siblings, mutually exclusive with each
 * other and with the explainer. While any of them is open, this outer
 * wrapper drops `aria-modal` and gains `aria-hidden`/`inert` (string).
 * Opening a completed experiment's result swaps this screen out entirely
 * for `ExperimentResultView` (same full-screen-swap pattern RecipesScreen
 * uses for `ReflectionDraft`) rather than nesting a second full-screen
 * overlay.
 */

const DURATIONS = [14, 28];

const STATUS_LABEL = {
  draft: 'Starting…',
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  completed: 'Completed',
};

/** Display value from a `@category:value` tag (or the bare string). */
function tagLabel(tag) {
  if (typeof tag !== 'string') return '';
  const idx = tag.lastIndexOf(':');
  return (idx >= 0 ? tag.slice(idx + 1) : tag.replace(/^@/, '')).trim();
}

function uniqueTags(entries) {
  const seen = new Set();
  for (const entry of entries || []) {
    for (const tag of entry?.tags || []) {
      if (typeof tag === 'string' && tag.trim()) seen.add(tag);
    }
  }
  return [...seen];
}

function coverageLine(coverage, label) {
  if (!coverage) return null;
  return `${coverage.covered} of ${coverage.total} days have ${label} data`;
}

const ExperimentsScreen = ({ uid, entries = [], onClose, onShowSafetyPlan, onOpenRecipes }) => {
  const [experiments, setExperiments] = useState([]);
  const [experimentsLoaded, setExperimentsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [spaces, setSpaces] = useState([]);
  const contextSpacesOn = getFlag('contextSpaces');
  const recipesOn = getFlag('reflectionRecipes');

  // One-time explainer
  const [explainerSeen, setExplainerSeen] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);

  // Create flow
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState('question'); // question | space | duration | preflight | decline
  const [questionText, setQuestionText] = useState('');
  const [selectedTagInput, setSelectedTagInput] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [selectedParams, setSelectedParams] = useState(null);
  const [finalQuestionText, setFinalQuestionText] = useState('');
  const [declineVerdict, setDeclineVerdict] = useState(null);
  const [unmappableNotice, setUnmappableNotice] = useState(false);
  const [scope, setScope] = useState(null);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const scopePickerRef = useDismissablePopover(scopePickerOpen, () => setScopePickerOpen(false));
  const [durationDays, setDurationDays] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [startBusy, setStartBusy] = useState(false);

  // Stop / delete confirm
  const [stopTarget, setStopTarget] = useState(null);
  const [stopping, setStopping] = useState(false);
  const stopTriggerRef = useRef(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const deleteTriggerRef = useRef(null);
  const [rowError, setRowError] = useState(null);

  // Result view
  const [resultExperimentId, setResultExperimentId] = useState(null);

  const completingRef = useRef(new Set());

  const availableTags = useMemo(() => uniqueTags(entries), [entries]);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeExperiments(
      db,
      uid,
      (next) => {
        setExperiments(next);
        setExperimentsLoaded(true);
        setLoadError(false);
      },
      () => {
        setExperimentsLoaded(true);
        setLoadError(true);
      },
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;
    getExperimentPrefs(db, uid)
      .then((prefs) => {
        if (!cancelled) setExplainerSeen(prefs.enabled === true);
      })
      .catch(() => {
        if (!cancelled) setExplainerSeen(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Context Space picker (flag: contextSpaces) — same gate as
  // RecipesScreen's own SpacePicker usage: subscribe only while the flag is
  // on, reset to [] when it's off.
  useEffect(() => {
    if (!contextSpacesOn || !uid) {
      setSpaces([]);
      return undefined;
    }
    return subscribeSpaces(db, uid, setSpaces);
  }, [contextSpacesOn, uid]);

  // Auto-completion — see module doc comment. Runs on every experiments/
  // entries change; the completingRef guard means each elapsed experiment
  // is attempted at most once concurrently.
  useEffect(() => {
    if (!uid) return;
    const now = new Date();
    for (const experiment of experiments) {
      if (experiment.status !== 'running' && experiment.status !== 'paused') continue;
      const endMs = Date.parse(experiment.endAt);
      if (Number.isNaN(endMs) || endMs > now.getTime()) continue;
      if (completingRef.current.has(experiment.id)) continue;
      completingRef.current.add(experiment.id);
      (async () => {
        try {
          const result = computeExperimentResult({ experiment, entries, now });
          await writeResult(db, uid, experiment.id, result);
        } catch {
          // Best-effort: a transient failure just means the next render
          // pass (e.g. a fresh entries/experiments snapshot) retries — this
          // never blocks the rest of the screen from rendering.
        } finally {
          completingRef.current.delete(experiment.id);
        }
      })();
    }
  }, [experiments, entries, uid]);

  const preflightResult = useMemo(() => {
    if (!selectedTemplate) return null;
    try {
      return preflightExperiment({
        entries,
        template: selectedTemplate,
        params: selectedParams || {},
        scope,
        now: new Date(),
      });
    } catch {
      return null;
    }
  }, [selectedTemplate, selectedParams, scope, entries]);

  // ---------------------------------------------------------------------
  // Create flow
  // ---------------------------------------------------------------------

  const resetCreateFlow = () => {
    setCreating(false);
    setCreateStep('question');
    setQuestionText('');
    setSelectedTagInput('');
    setSelectedTemplate(null);
    setSelectedParams(null);
    setFinalQuestionText('');
    setDeclineVerdict(null);
    setUnmappableNotice(false);
    setScope(null);
    setScopePickerOpen(false);
    setDurationDays(null);
    setCreateError(null);
  };

  const openCreateFlow = () => {
    resetCreateFlow();
    setCreating(true);
  };

  const handleNewExperiment = () => {
    if (explainerSeen) {
      openCreateFlow();
    } else {
      setShowExplainer(true);
    }
  };

  const confirmExplainer = async () => {
    setShowExplainer(false);
    setExplainerSeen(true);
    openCreateFlow();
    try {
      await markExplainerSeen(db, uid);
    } catch {
      // Best-effort: a failed write just means the explainer may reappear
      // next time — never blocks entering the create flow.
    }
  };

  const cancelExplainer = () => {
    setShowExplainer(false);
  };

  // The single choke point every entry path into the create flow funnels
  // through — see the BINDING ORDERING REQUIREMENT in the module doc
  // comment. `text` is the raw question (typed, or a canned template's own
  // title / a composed tag-template question).
  const proceedWithQuestion = (text) => {
    setCreateError(null);
    setUnmappableNotice(false);
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return;

    const verdict = screenQuestion(trimmed);
    if (verdict.verdict !== 'ok') {
      setDeclineVerdict(verdict.verdict);
      setCreateStep('decline');
      return;
    }

    const match = matchQuestionToTemplate(trimmed, availableTags);
    if (!match) {
      setUnmappableNotice(true);
      return;
    }

    setSelectedTemplate(match.template);
    setSelectedParams(match.params);
    setFinalQuestionText(trimmed);
    setCreateStep(contextSpacesOn ? 'space' : 'duration');
  };

  const handleTemplateTap = (template) => {
    proceedWithQuestion(template.title);
  };

  const handleTagTemplateAsk = () => {
    if (!selectedTagInput) return;
    proceedWithQuestion(`Does ${tagLabel(selectedTagInput)} affect my mood?`);
  };

  const handleFreeTextAsk = () => {
    proceedWithQuestion(questionText);
  };

  const backToQuestion = () => {
    setDeclineVerdict(null);
    setCreateStep('question');
  };

  const handleCrisisAction = () => {
    onShowSafetyPlan?.();
    resetCreateFlow();
    onClose?.();
  };

  const handleMedicalRecipesAction = () => {
    onOpenRecipes?.();
    resetCreateFlow();
    onClose?.();
  };

  const proceedToDuration = () => {
    setCreateStep('duration');
  };

  const handleDurationPick = (days) => {
    setDurationDays(days);
    setCreateStep('preflight');
  };

  const handleStart = async () => {
    if (!selectedTemplate || !durationDays || !preflightResult?.appropriate || startBusy) return;
    setCreateError(null);
    setStartBusy(true);
    try {
      const analysisPlan = buildAnalysisPlan(selectedTemplate, selectedParams || {});
      const created = await createExperiment(db, uid, {
        question: finalQuestionText,
        template: selectedTemplate,
        analysisPlan,
        scope,
        durationDays,
      });
      await startExperiment(db, uid, created.id, durationDays);
      resetCreateFlow();
    } catch (err) {
      setCreateError(err?.message || 'Could not start that experiment. Please try again.');
    } finally {
      setStartBusy(false);
    }
  };

  // ---------------------------------------------------------------------
  // Running-card actions
  // ---------------------------------------------------------------------

  const handlePause = async (experiment) => {
    setRowError(null);
    try {
      await pauseExperiment(db, uid, experiment.id);
    } catch (err) {
      setRowError(err?.message || 'Could not pause that experiment.');
    }
  };

  const handleResume = async (experiment) => {
    setRowError(null);
    try {
      await resumeExperiment(db, uid, experiment.id);
    } catch (err) {
      setRowError(err?.message || 'Could not resume that experiment.');
    }
  };

  const openStopConfirm = (experiment, triggerEl) => {
    setRowError(null);
    setStopTarget(experiment);
    stopTriggerRef.current = triggerEl || null;
  };
  const closeStopConfirm = () => {
    setStopTarget(null);
    stopTriggerRef.current?.focus();
    stopTriggerRef.current = null;
  };
  const confirmStop = async () => {
    if (!stopTarget) return;
    setStopping(true);
    try {
      await stopExperiment(db, uid, stopTarget.id);
      closeStopConfirm();
    } catch (err) {
      setRowError(err?.message || 'Could not stop that experiment.');
    } finally {
      setStopping(false);
    }
  };

  const openDeleteConfirm = (experiment, triggerEl) => {
    setRowError(null);
    setDeleteTarget(experiment);
    deleteTriggerRef.current = triggerEl || null;
  };
  const closeDeleteConfirm = () => {
    setDeleteTarget(null);
    deleteTriggerRef.current?.focus();
    deleteTriggerRef.current = null;
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteExperiment(db, uid, deleteTarget.id);
      closeDeleteConfirm();
    } catch (err) {
      setRowError(err?.message || 'Could not delete that experiment.');
    } finally {
      setDeleting(false);
    }
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const resultExperiment = resultExperimentId
    ? experiments.find((e) => e.id === resultExperimentId)
    : null;

  if (resultExperimentId && resultExperiment) {
    return (
      <ExperimentResultView
        uid={uid}
        entries={entries}
        experiment={resultExperiment}
        onClose={() => setResultExperimentId(null)}
      />
    );
  }

  const nestedOverlayOpen = showExplainer || Boolean(stopTarget) || Boolean(deleteTarget);

  const tagTemplate = TEMPLATES.find((t) => t.exposure.source === 'tags');
  const pickableTemplates = TEMPLATES.filter((t) => t.exposure.source !== 'tags');

  return (
    <>
      <div
        className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]"
        role="dialog"
        aria-modal={nestedOverlayOpen ? undefined : 'true'}
        aria-hidden={nestedOverlayOpen ? 'true' : undefined}
        inert={nestedOverlayOpen ? 'true' : undefined}
        aria-labelledby="experiments-title"
      >
        <div className="mx-auto max-w-xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <p className="cloud-kicker">PERSONAL EXPERIMENTS</p>
              <h2 id="experiments-title" className="cloud-title text-3xl">Experiments</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Explore a pattern in your own data — an association, never proof.
              </p>
            </div>
            <button type="button" className="cloud-icon-button" aria-label="Close experiments" onClick={onClose}>
              <X size={21} />
            </button>
          </header>

          {!creating && (
            <>
              {rowError && (
                <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
                  {rowError}
                </div>
              )}

              {loadError && (
                <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
                  Could not load your experiments. Please try again.
                </div>
              )}

              <Button onClick={handleNewExperiment}>New experiment</Button>

              <section>
                <h3 className="cloud-kicker mb-2">YOUR EXPERIMENTS</h3>
                {!loadError && experimentsLoaded && experiments.length === 0 && (
                  <p className="cloud-sheet rounded-2xl border p-4 text-sm text-[var(--muted-foreground)] shadow-sm">
                    No experiments yet. Start one to explore a pattern in your own data.
                  </p>
                )}
                {experiments.length > 0 && (
                  <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
                    {experiments.map((experiment) => (
                      <ExperimentRow
                        key={experiment.id}
                        experiment={experiment}
                        entries={entries}
                        onPause={handlePause}
                        onResume={handleResume}
                        onStop={openStopConfirm}
                        onDelete={openDeleteConfirm}
                        onViewResult={() => setResultExperimentId(experiment.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {creating && createStep === 'question' && (
            <section className="space-y-4">
              <button type="button" onClick={resetCreateFlow} className="text-xs font-medium text-accent-deep">
                &larr; Back
              </button>

              {unmappableNotice && (
                <p role="alert" className="rounded-xl bg-[var(--accent-wash)] p-3 text-sm text-[var(--accent-deep)]">
                  That's not something Engram can measure yet. Try one of the questions below, or rephrase.
                </p>
              )}

              <div className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
                <p className="font-semibold">Pick a question</p>
                <div className="flex flex-col gap-2">
                  {pickableTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => handleTemplateTap(template)}
                      className="min-h-[44px] rounded-xl border border-border bg-card px-3 py-2 text-left text-sm hover:bg-divider"
                    >
                      {template.title}
                    </button>
                  ))}
                </div>

                {tagTemplate && availableTags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <select
                      aria-label="Choose a tag"
                      value={selectedTagInput}
                      onChange={(e) => setSelectedTagInput(e.target.value)}
                      className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
                    >
                      <option value="">Choose a tag…</option>
                      {availableTags.map((tag) => (
                        <option key={tag} value={tag}>{tagLabel(tag)}</option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      onClick={handleTagTemplateAsk}
                      disabled={!selectedTagInput}
                      className="px-4 text-xs"
                    >
                      Does this affect my mood?
                    </Button>
                  </div>
                )}
              </div>

              <div className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
                <label htmlFor="experiment-question-input" className="font-semibold">
                  Or ask your own question
                </label>
                <textarea
                  id="experiment-question-input"
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  maxLength={200}
                  rows={3}
                  placeholder="e.g. Does exercise affect my mood?"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                />
                <Button onClick={handleFreeTextAsk} disabled={!questionText.trim()} className="px-4 text-xs">
                  Ask
                </Button>
              </div>

              {createError && (
                <p role="alert" className="text-sm text-destructive">{createError}</p>
              )}
            </section>
          )}

          {creating && createStep === 'decline' && declineVerdict && (
            <DeclineScreen
              verdict={declineVerdict}
              recipesOn={recipesOn}
              onSafetyPlan={handleCrisisAction}
              onRecipes={handleMedicalRecipesAction}
              onTryAgain={backToQuestion}
              onClose={() => { resetCreateFlow(); }}
            />
          )}

          {creating && createStep === 'space' && (
            <section className="space-y-4">
              <button type="button" onClick={() => setCreateStep('question')} className="text-xs font-medium text-accent-deep">
                &larr; Back
              </button>
              <div className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
                <p className="font-semibold">Which space should this look at?</p>
                <div className="relative inline-block" ref={scopePickerRef}>
                  <Chip
                    as="button"
                    type="button"
                    onClick={() => setScopePickerOpen((prev) => !prev)}
                    aria-haspopup="listbox"
                    aria-expanded={scopePickerOpen}
                  >
                    {scope?.spaceId ? (spaces.find((s) => s.id === scope.spaceId)?.name ?? scope.spaceId) : 'All spaces'}
                  </Chip>
                  {scopePickerOpen && (
                    <SpacePicker
                      spaces={spaces}
                      selectedSpaceId={scope?.spaceId || null}
                      onSelect={(spaceId) => {
                        setScope(spaceId ? { spaceId } : null);
                        setScopePickerOpen(false);
                      }}
                      defaultLabel="All spaces"
                    />
                  )}
                </div>
              </div>
              <Button onClick={proceedToDuration}>Continue</Button>
            </section>
          )}

          {creating && createStep === 'duration' && (
            <section className="space-y-4">
              <button
                type="button"
                onClick={() => setCreateStep(contextSpacesOn ? 'space' : 'question')}
                className="text-xs font-medium text-accent-deep"
              >
                &larr; Back
              </button>
              <div className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
                <p className="font-semibold">How long should this run?</p>
                {preflightResult && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Based on your data, {preflightResult.recommendedDurationDays} days is recommended.
                  </p>
                )}
                <div className="flex gap-2">
                  {DURATIONS.map((days) => (
                    <Chip
                      key={days}
                      as="button"
                      type="button"
                      selected={durationDays === days}
                      aria-pressed={durationDays === days}
                      onClick={() => handleDurationPick(days)}
                    >
                      {days} days
                    </Chip>
                  ))}
                </div>
              </div>
            </section>
          )}

          {creating && createStep === 'preflight' && (
            <PreflightReview
              preflight={preflightResult}
              durationDays={durationDays}
              exposureLabel={selectedTemplate?.exposure?.label || 'this variable'}
              startBusy={startBusy}
              createError={createError}
              onBack={() => setCreateStep('duration')}
              onStart={handleStart}
            />
          )}
        </div>
      </div>

      <Dialog open={showExplainer} onOpenChange={(next) => { if (!next) cancelExplainer(); }}>
        <DialogContent aria-labelledby="experiments-explainer-title">
          <DialogTitle id="experiments-explainer-title">Before your first experiment</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-[var(--secondary-foreground)]">
              <p>Experiments look for associations, not proof, in your own data — a pattern here never shows that one thing caused another.</p>
              <p>Engram never diagnoses or gives medical advice, and unsafe or medical questions are declined.</p>
              <p>You can pause, stop, or delete an experiment at any time — your journal entries are never changed.</p>
            </div>
          </DialogDescription>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={cancelExplainer}
              className="min-h-[44px] flex-1 rounded-full border border-border text-sm font-medium text-secondary-foreground transition-colors hover:bg-divider"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={confirmExplainer}
              className="min-h-[44px] flex-1 rounded-full bg-accent-deep text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Continue
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {stopTarget && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stop-experiment-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="stop-experiment-title" className="mb-1 font-display font-bold text-lg text-foreground">
              Stop this experiment?
            </h3>
            <p className="mb-4 text-sm text-secondary-foreground">
              This ends data collection for this experiment. Your journal entries are never changed or removed.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closeStopConfirm} disabled={stopping} className="flex-1">
                Cancel
              </Button>
              <Button onClick={confirmStop} disabled={stopping} className="flex-1">
                {stopping ? 'Stopping…' : 'Stop'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-experiment-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="delete-experiment-title" className="mb-1 font-display font-bold text-lg text-foreground">
              Delete this experiment?
            </h3>
            <p className="mb-4 text-sm text-secondary-foreground">
              This removes the experiment only — your journal entries are never affected.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closeDeleteConfirm} disabled={deleting} className="flex-1">
                Cancel
              </Button>
              <Button onClick={confirmDelete} disabled={deleting} className="flex-1">
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Decline screen (crisis / medical)
// ---------------------------------------------------------------------------

function DeclineScreen({ verdict, recipesOn, onSafetyPlan, onRecipes, onTryAgain, onClose }) {
  const contract = DECLINE_CONTRACTS[verdict];
  if (!contract) return null;

  return (
    <section className="space-y-4">
      <div className="cloud-sheet space-y-3 rounded-2xl border p-4 shadow-sm">
        <p className="text-sm leading-relaxed text-[var(--secondary-foreground)]">{contract.copy}</p>
        {verdict === 'crisis' && (
          <Button onClick={onSafetyPlan} className="w-full">
            See my safety plan
          </Button>
        )}
        {verdict === 'medical' && (
          <div className="flex flex-col gap-2">
            {recipesOn && (
              <Button onClick={onRecipes} className="w-full">
                Try a Reflection Recipe instead
              </Button>
            )}
            <Button variant="outline" onClick={onTryAgain} className="w-full">
              Try a different question
            </Button>
          </div>
        )}
      </div>
      <button type="button" onClick={onClose} className="text-xs font-medium text-accent-deep">
        Close
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Preflight review
// ---------------------------------------------------------------------------

function PreflightReview({ preflight, durationDays, exposureLabel, startBusy, createError, onBack, onStart }) {
  if (!preflight) {
    return (
      <section className="space-y-4">
        <button type="button" onClick={onBack} className="text-xs font-medium text-accent-deep">&larr; Back</button>
        <p className="text-sm text-[var(--muted-foreground)]">Checking your data…</p>
      </section>
    );
  }

  const reasons = [...new Set([...(preflight.reasons || []), ...(preflight.missingSources || [])])];

  return (
    <section className="space-y-4">
      <button type="button" onClick={onBack} className="text-xs font-medium text-accent-deep">&larr; Back</button>

      <div className="rounded-xl bg-[var(--accent-wash)] p-3 text-sm text-[var(--accent-deep)]">
        Your question and analysis plan lock when you start.
      </div>

      <div className="cloud-sheet space-y-3 rounded-2xl border p-4 shadow-sm">
        <p className="font-semibold">What Engram will use</p>
        <ul className="space-y-1 text-sm text-secondary-foreground">
          <li>{coverageLine(preflight.expectedCoverage.exposure, exposureLabel)}</li>
          <li>{coverageLine(preflight.expectedCoverage.outcome, 'mood')}</li>
        </ul>

        {preflight.confounders?.length > 0 && (
          <div>
            <p className="text-xs font-medium text-[var(--muted-foreground)]">Other things that could explain a pattern here</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-secondary-foreground">
              {preflight.confounders.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        )}

        {!preflight.appropriate && (
          <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
            <p className="font-medium">Engram doesn't have enough data yet for this experiment.</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {reasons.map((token) => <li key={token}>{reasonCopy(token)}</li>)}
            </ul>
          </div>
        )}
      </div>

      <p className="text-sm text-secondary-foreground">Duration: {durationDays} days</p>

      {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}

      <Button onClick={onStart} disabled={!preflight.appropriate || startBusy} className="w-full">
        {startBusy ? 'Starting…' : 'Start'}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Running / completed / stopped row
// ---------------------------------------------------------------------------

function ExperimentRow({ experiment, entries, onPause, onResume, onStop, onDelete, onViewResult }) {
  const coverage = useMemo(() => {
    if (experiment.status !== 'running' && experiment.status !== 'paused') return null;
    try {
      const result = computeExperimentResult({ experiment, entries, now: new Date() });
      return result.coverage;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only
    // when the experiment's own persisted fields or the entry pool change.
  }, [experiment.id, experiment.status, experiment.excludedObservations, experiment.startAt, experiment.endAt, entries]);

  const exposureLabel = experiment.analysisPlan?.exposure?.label || 'this variable';

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{experiment.question}</p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{STATUS_LABEL[experiment.status] || experiment.status}</p>
        </div>
        <button
          type="button"
          aria-label={`Delete ${experiment.question}`}
          onClick={(e) => onDelete(experiment, e.currentTarget)}
          className="cloud-icon-button"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {(experiment.status === 'running' || experiment.status === 'paused') && coverage && (
        <ul className="mt-2 space-y-0.5 text-xs text-secondary-foreground">
          <li>{coverageLine(coverage.exposure, exposureLabel)}</li>
          <li>{coverageLine(coverage.outcome, 'mood')}</li>
        </ul>
      )}

      {(experiment.status === 'running' || experiment.status === 'paused') && (
        <div className="mt-2 flex gap-2">
          {experiment.status === 'running' ? (
            <button
              type="button"
              aria-label={`Pause ${experiment.question}`}
              onClick={() => onPause(experiment)}
              className="cloud-icon-button"
            >
              <Pause size={16} />
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Resume ${experiment.question}`}
              onClick={() => onResume(experiment)}
              className="cloud-icon-button"
            >
              <Play size={16} />
            </button>
          )}
          <button
            type="button"
            aria-label={`Stop ${experiment.question}`}
            onClick={(e) => onStop(experiment, e.currentTarget)}
            className="cloud-icon-button"
          >
            <Square size={16} />
          </button>
        </div>
      )}

      {experiment.status === 'completed' && (
        <div className="mt-2">
          <Button variant="outline" onClick={onViewResult} className="px-4 text-xs">
            View result
          </Button>
        </div>
      )}

      {experiment.status === 'stopped' && (
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">Stopped — entries were not affected.</p>
      )}
    </div>
  );
}

export default ExperimentsScreen;
