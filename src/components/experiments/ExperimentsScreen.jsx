import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Pause, Square, Trash2 } from 'lucide-react';
import { db } from '../../config/firebase';
import { getFlag } from '../../config/flags';
import { Button, Chip, Dialog, DialogContent, DialogTitle, DialogDescription } from '../cloud';
import SpacePicker from '../spaces/SpacePicker';
import { useDismissablePopover } from '../../hooks/useDismissablePopover';
import { subscribeSpaces } from '../../services/spaces/spacesService';
import { TEMPLATES, getTemplateById, matchQuestionToTemplate } from '../../services/experiments/templates';
import { screenQuestion, DECLINE_CONTRACTS } from '../../services/experiments/questionGate';
import { preflightExperiment } from '../../services/experiments/preflight';
import { computeExperimentResult, localDateKeyForMs } from '../../services/experiments/computeResult';
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
 * create flow — a canned template tap, the tag-template picker, OR
 * free-text — calls `screenQuestion` FIRST via the shared `screenAndProceed`
 * choke point below. A non-'ok' verdict is a terminal decline for that
 * attempt. `matchQuestionToTemplate` is invoked ONLY by the free-text path
 * (`proceedWithQuestion`), which genuinely has to guess a template from
 * arbitrary text; a canned picker tap or a chosen tag already KNOWS its
 * target template, so `handleTemplateTap`/`handleTagTemplateAsk` select it
 * DIRECTLY after `screenQuestion` passes, never re-deriving it through the
 * matcher (R3 final review fix — see those functions' own comments for the
 * keyword-collision dead-end this closes).
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
 * ENTRIES-READY GUARD (Minor review fix, R3 final review): the effect below
 * used to compute straight from whatever `entries` array it was handed,
 * with no readiness check. `entries` is a prop straight from `AppLayout`,
 * which (as of this review) has no companion "entries finished loading"
 * signal anywhere in the codebase — a transiently empty or partial
 * `entries` array (e.g. mid-fetch, or a stale render before the real
 * Firestore snapshot arrives) could otherwise get computed into a WRONG
 * `insufficient` result and PERSISTED via `writeResult`, which never
 * self-corrects (nothing re-runs auto-completion for an already-`completed`
 * experiment). An optional `entriesLoaded` prop is accepted for a future
 * caller that DOES have a real readiness signal to pass; absent that, this
 * falls back to the pragmatic guard of skipping while `entries.length ===
 * 0`. RESIDUAL RISK (documented, not silently assumed away): a small but
 * non-empty `entries` array that is still mid-load (e.g. one cached entry
 * present, the rest still loading) passes the length guard and could still
 * auto-complete on incomplete data — the length check alone cannot
 * distinguish "fully loaded" from "partially loaded but non-empty." Fixing
 * that fully requires a real `entriesLoaded` signal from the entries
 * source, which is out of scope for this file.
 *
 * PREFILL SEAM (R4 Phase 3 Task 2): an optional `prefill = {templateId,
 * tag?}` prop lets a caller (ClaimCard's "Try as an experiment" via
 * InsightsPage, or an idea card's own mapped CTA — both funneled through
 * AppLayout's `handleTryExperiment`) open this screen straight into a
 * chosen template instead of the question step. Resolved exactly once on
 * mount via `getTemplateById`: an unknown/stale id is never a crash — it's
 * `console.warn`ed and the screen opens to its normal list view, prefill
 * silently ignored. A known id is entered through the SAME
 * `screenAndProceed` choke point every other entry path uses (never a
 * shortcut straight to `selectTemplateAndAdvance`) — a tag prefill composes
 * the same "How does {tag} move together with my mood?" text
 * `handleTagTemplateAsk` does before screening it, a plain prefill screens
 * the template's own title exactly like `handleTemplateTap`. The one-time
 * explainer is intentionally NOT shown on this path — the caller already
 * made an explicit "try this as an experiment" choice elsewhere; re-gating
 * behind the explainer would just detour a deliberate action back to a
 * screen it never asked to see.
 *
 * PREFILL TRACKING-MODE OPT-IN (R4 Phase 3 T2/T3 interaction follow-up): a
 * tag-template prefill jumps past the question step, where T3's confirmed-
 * exposure toggle (`ExposureModeToggle` below) normally lives — without a
 * fix, that silently locked every tag-prefill experiment to passive
 * (mention-based) tracking with no way to opt in from this entry point. Chose
 * option (a) from the review finding: render the SAME toggle on the duration
 * step, gated on `prefillTagFlow` (set true only by the prefill effect's tag
 * branch, reset alongside every other create-flow field in
 * `resetCreateFlow`) rather than on `selectedTemplate === tagTemplate` alone
 * — the latter would ALSO fire for the manual tag-picker path (which already
 * shows its own copy of the toggle in the question step), doubling it. The
 * chosen mode flows into `selectedParams` exactly as
 * `handleTagTemplateAsk`'s does — `buildAnalysisPlan` (called at Start) is
 * what actually decides whether it's honored — and, matching the prefill
 * path's existing default (untouched), stays keyless until the user actively
 * checks the box.
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

const ExperimentsScreen = ({ uid, entries = [], entriesLoaded, prefill = null, onClose, onShowSafetyPlan, onOpenRecipes }) => {
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
  // Confirmed-exposure opt-in (R4 Phase 3 Task 3, action confirmation v1) —
  // tag-template create flow ONLY (see the tag-picker section's toggle
  // below); default 'passive'. Reset alongside every other create-flow field
  // in `resetCreateFlow`.
  const [exposureMode, setExposureMode] = useState('passive');
  // Set true only by the prefill effect's tag branch (see PREFILL
  // TRACKING-MODE OPT-IN in the module doc comment above) — gates the
  // duration-step copy of `ExposureModeToggle` so the manual tag-picker
  // path (which already shows its own copy in the question step) never
  // sees a second one.
  const [prefillTagFlow, setPrefillTagFlow] = useState(false);
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

  // The single tag-presence template, looked up once and reused by both the
  // tag-template picker handler (direct selection, see BINDING ORDERING
  // REQUIREMENT above) and the render below (picker gating).
  const tagTemplate = TEMPLATES.find((t) => t.exposure.source === 'tags');

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
    // ENTRIES-READY GUARD — see module doc comment. Trust an explicit
    // `entriesLoaded` prop when the caller supplies one; otherwise fall
    // back to skipping while `entries` is still empty.
    const entriesReady = entriesLoaded !== undefined ? entriesLoaded === true : entries.length > 0;
    if (!entriesReady) return;
    const now = new Date();
    for (const experiment of experiments) {
      if (experiment.status !== 'running' && experiment.status !== 'paused') continue;
      const endMs = Date.parse(experiment.endAt);
      if (Number.isNaN(endMs) || endMs > now.getTime()) continue;
      if (completingRef.current.has(experiment.id)) continue;
      completingRef.current.add(experiment.id);
      (async () => {
        try {
          // C1 fix (fix wave 1): a confirmed-mode experiment's exposure
          // series comes from its `confirmations` subcollection, not from
          // tag-scanning `entries` — load it before computing. A load
          // failure here propagates through the SAME catch below as a
          // compute failure always has (best-effort: no write, next render
          // pass retries) — never a partial/insufficiency write, since
          // nothing is written unless BOTH the load and the compute
          // succeed. Passive/legacy plans never reach this branch (no new
          // read for them).
          const confirmations = experiment.analysisPlan?.exposureMode === 'confirmed'
            ? await listConfirmations(db, uid, experiment.id)
            : undefined;
          const result = computeExperimentResult({ experiment, entries, confirmations, now });
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
  }, [experiments, entries, uid, entriesLoaded]);

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
    setExposureMode('passive');
    setPrefillTagFlow(false);
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
  // comment. Screens `text` and, only on an 'ok' verdict, hands the
  // trimmed text to `onOk` — a non-'ok' verdict is always a terminal
  // decline for that attempt, regardless of caller.
  const screenAndProceed = (text, onOk) => {
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

    onOk(trimmed);
  };

  const selectTemplateAndAdvance = (template, params, trimmed) => {
    setSelectedTemplate(template);
    setSelectedParams(params);
    setFinalQuestionText(trimmed);
    setCreateStep(contextSpacesOn ? 'space' : 'duration');
  };

  // Prefill seam (R4 Phase 3 Task 2) — see module doc comment's "PREFILL
  // SEAM" section. Runs once per mount (this screen is freshly mounted on
  // every open — see AppLayout's flag-gated mount site — so an empty dep
  // array is the correct "consume once" contract, not a stale-closure risk).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!prefill?.templateId) return;
    const template = getTemplateById(prefill.templateId);
    if (!template) {
      console.warn(
        `ExperimentsScreen: unknown prefill templateId "${prefill.templateId}" — opening normally.`,
      );
      return;
    }
    setCreating(true);
    if (prefill.tag) {
      const composed = `How does ${tagLabel(prefill.tag)} move together with my mood?`;
      screenAndProceed(composed, (trimmed) => {
        setPrefillTagFlow(true);
        selectTemplateAndAdvance(template, { tag: prefill.tag }, trimmed);
      });
    } else {
      screenAndProceed(template.title, (trimmed) => {
        selectTemplateAndAdvance(template, null, trimmed);
      });
    }
  }, []);

  // Free-text path: screenQuestion, THEN matchQuestionToTemplate — this is
  // the only path that has to guess a template from arbitrary text, so it's
  // the only one that still calls the matcher.
  const proceedWithQuestion = (text) => {
    screenAndProceed(text, (trimmed) => {
      const match = matchQuestionToTemplate(trimmed, availableTags);
      if (!match) {
        setUnmappableNotice(true);
        return;
      }
      selectTemplateAndAdvance(match.template, match.params, trimmed);
    });
  };

  // Canned picker tap: `template` is already known, so after screenQuestion
  // passes on its canonical title, select it DIRECTLY — never re-derive it
  // via `matchQuestionToTemplate` (R3 final review fix). Re-deriving used to
  // dead-end a canned button whenever the user had an unrelated tag whose
  // display value happened to collide with the template's own keywords
  // (e.g. a "exercise"/"sleep"/"gym"/"walking" tag): the matcher would then
  // see BOTH the keyword template and the tag-presence template as
  // candidates, call it ambiguous, return null, and the screen would show
  // "not something Engram can measure" for a button that says exactly what
  // it measures. screenQuestion still runs first (the safety choke point is
  // unchanged) — only the post-screening template lookup is skipped.
  const handleTemplateTap = (template) => {
    screenAndProceed(template.title, (trimmed) => {
      selectTemplateAndAdvance(template, null, trimmed);
    });
  };

  // Tag-template picker: the user already chose a concrete tag from their
  // own tags, so the selection (tag-presence template + that exact tag) is
  // composed and set DIRECTLY, same fix and same rationale as
  // `handleTemplateTap` above — this also sidesteps `matchAvailableTag`
  // re-scanning the composed text for a tag match, which is redundant when
  // the caller already knows which tag was picked.
  const handleTagTemplateAsk = () => {
    if (!selectedTagInput || !tagTemplate) return;
    // Co-movement framing (Michael review hardening, item 7) — matches the
    // catalog's own tag-presence template.title pattern.
    const composed = `How does ${tagLabel(selectedTagInput)} move together with my mood?`;
    // exposureMode (R4 Phase 3 Task 3): carried into `params` exactly like
    // `tag` — `buildAnalysisPlan` (called later, at Start) is what actually
    // decides whether it's honored (tag templates + 'confirmed' only); this
    // handler just passes through whatever the toggle below is currently
    // set to.
    screenAndProceed(composed, (trimmed) => {
      selectTemplateAndAdvance(tagTemplate, { tag: selectedTagInput, exposureMode }, trimmed);
    });
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

  // `tagTemplate` is declared once, above, and reused here (picker gating).
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
                        uid={uid}
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
                      See how this moves with my mood
                    </Button>
                  </div>
                )}

                {/* Confirmed-exposure opt-in (R4 Phase 3 Task 3): tag
                    templates only — passive (mention-based) is the default;
                    checking this asks for an explicit daily check-in
                    instead. Honesty copy per the plan: missed days count as
                    unknown, never a "no". */}
                {tagTemplate && availableTags.length > 0 && (
                  <ExposureModeToggle
                    checked={exposureMode === 'confirmed'}
                    onChange={(checked) => setExposureMode(checked ? 'confirmed' : 'passive')}
                  />
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
                  placeholder="e.g. How does exercise move together with my mood?"
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

              {/* PREFILL TRACKING-MODE OPT-IN (R4 Phase 3 T2/T3 follow-up,
                  see module doc comment) — same control as the question
                  step's tag block above, surfaced here ONLY for a
                  tag-template prefill (the manual tag-picker path already
                  got its one copy). Writes straight into `selectedParams`
                  since that's already seeded with `{tag}` by the prefill
                  effect — no second plumbing into `buildAnalysisPlan`. */}
              {prefillTagFlow && (
                <div className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
                  <ExposureModeToggle
                    checked={exposureMode === 'confirmed'}
                    onChange={(checked) => {
                      const mode = checked ? 'confirmed' : 'passive';
                      setExposureMode(mode);
                      setSelectedParams((prev) => {
                        const { exposureMode: _drop, ...rest } = prev || {};
                        return mode === 'confirmed' ? { ...rest, exposureMode: 'confirmed' } : rest;
                      });
                    }}
                  />
                </div>
              )}
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
// Confirmed-exposure opt-in toggle (R4 Phase 3 Task 3; extracted for the
// T2/T3 interaction follow-up so both entry points — the question step's
// tag block and the prefill duration-step block above — share one copy of
// the markup and copy instead of two.)
// ---------------------------------------------------------------------------

function ExposureModeToggle({ checked, onChange }) {
  return (
    <label className="flex items-start gap-2 pt-1 text-xs text-secondary-foreground">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Track this with a daily check-in instead of guessing from your entries — you check in daily; missed days count as unknown, not no.
      </span>
    </label>
  );
}

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

function ExperimentRow({ uid, experiment, entries, onPause, onResume, onStop, onDelete, onViewResult }) {
  const confirmedMode = (experiment.status === 'running' || experiment.status === 'paused')
    && experiment.analysisPlan?.exposureMode === 'confirmed';

  // C1 fix (fix wave 1): this row's own live coverage-so-far is
  // self-contradicting for a confirmed-mode experiment unless it also loads
  // confirmations — mirrors `ConfirmationCheckIn`'s own self-contained fetch
  // just below. `status: 'loaded'` gates the coverage computation so a
  // still-loading or errored fetch never silently computes coverage as if
  // zero days were confirmed (which would render a WRONG, not merely
  // absent, coverage line) — matching this same function's existing
  // catch-returns-null posture (a failure here means no coverage line is
  // shown, not a wrong one). Passive rows never mount this effect at all —
  // no new read for them.
  const [confirmationsState, setConfirmationsState] = useState({ status: 'idle', list: [] });
  useEffect(() => {
    if (!confirmedMode) return undefined;
    let cancelled = false;
    setConfirmationsState({ status: 'loading', list: [] });
    listConfirmations(db, uid, experiment.id)
      .then((list) => { if (!cancelled) setConfirmationsState({ status: 'loaded', list: list || [] }); })
      .catch(() => { if (!cancelled) setConfirmationsState({ status: 'error', list: [] }); });
    return () => { cancelled = true; };
  }, [confirmedMode, uid, experiment.id]);

  const coverage = useMemo(() => {
    if (experiment.status !== 'running' && experiment.status !== 'paused') return null;
    if (confirmedMode && confirmationsState.status !== 'loaded') return null;
    try {
      const result = computeExperimentResult({
        experiment,
        entries,
        now: new Date(),
        ...(confirmedMode ? { confirmations: confirmationsState.list } : {}),
      });
      return result.coverage;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only
    // when the experiment's own persisted fields, the entry pool, or the
    // (confirmed-mode-only) loaded confirmations change.
  }, [experiment.id, experiment.status, experiment.excludedObservations, experiment.startAt, experiment.endAt, entries, confirmedMode, confirmationsState]);

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

      {/* Today's check-in row (R4 Phase 3 Task 3) — running only; a paused
          confirmed-mode experiment does not prompt for today (matching the
          service's own running-status-only write guard). */}
      {experiment.status === 'running' && experiment.analysisPlan?.exposureMode === 'confirmed' && (
        <ConfirmationCheckIn uid={uid} experiment={experiment} />
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

// ---------------------------------------------------------------------------
// Today's confirmed-exposure check-in row (R4 Phase 3 Task 3, action
// confirmation v1)
// ---------------------------------------------------------------------------

/**
 * Self-contained (fetches its own confirmations via `listConfirmations` —
 * no top-level `ExperimentsScreen` state), mirroring `ExperimentRow`'s own
 * per-row `computeExperimentResult` pattern above. Only ever mounted for a
 * RUNNING confirmed-mode experiment (see the gate at its call site) — the
 * service's `setConfirmation`/`clearConfirmation` enforce the same
 * running-status-only guard server-round-trip-side, this is just the UI
 * never offering the control outside that state.
 *
 * `todayKey` is derived in the experiment's own FROZEN
 * `analysisPlan.timezone` (falling back to 'UTC' for a plan predating that
 * field) via `computeResult.js`'s `localDateKeyForMs` — the same helper
 * `computeExperimentResult` itself uses for every other dateKey in this
 * pipeline, so "today" here always means the same calendar day the result
 * computation would eventually assign this check-in to.
 */
function ConfirmationCheckIn({ uid, experiment }) {
  const timeZone = typeof experiment.analysisPlan?.timezone === 'string' && experiment.analysisPlan.timezone
    ? experiment.analysisPlan.timezone
    : 'UTC';
  const todayKey = useMemo(() => localDateKeyForMs(Date.now(), timeZone), [timeZone]);
  const [state, setState] = useState({ loading: true, done: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!uid || !experiment?.id) return undefined;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    listConfirmations(db, uid, experiment.id)
      .then((list) => {
        if (cancelled) return;
        const match = (list || []).find((c) => c.dateKey === todayKey);
        setState({ loading: false, done: match ? match.done === true : null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, done: null });
      });
    return () => {
      cancelled = true;
    };
  }, [uid, experiment?.id, todayKey, refreshKey]);

  const answer = async (done) => {
    setError(null);
    setBusy(true);
    try {
      await setConfirmation(db, uid, experiment.id, todayKey, done);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err?.message || 'Could not save that check-in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const clearToday = async () => {
    setError(null);
    setBusy(true);
    try {
      await clearConfirmation(db, uid, experiment.id, todayKey);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err?.message || 'Could not clear that check-in. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const exposureLabel = experiment.analysisPlan?.exposure?.label || 'this';

  return (
    <div className="mt-2 rounded-xl bg-[var(--accent-wash)] p-2.5 text-xs">
      <p className="font-medium text-[var(--accent-deep)]">Did you do {exposureLabel} today?</p>
      {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || state.loading}
          aria-pressed={state.done === true}
          onClick={() => answer(true)}
          className={`min-h-[32px] rounded-full border px-3 font-medium ${
            state.done === true ? 'border-accent-deep bg-accent-deep text-background' : 'border-border text-secondary-foreground'
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          disabled={busy || state.loading}
          aria-pressed={state.done === false}
          onClick={() => answer(false)}
          className={`min-h-[32px] rounded-full border px-3 font-medium ${
            state.done === false ? 'border-accent-deep bg-accent-deep text-background' : 'border-border text-secondary-foreground'
          }`}
        >
          No
        </button>
        {state.done !== null && (
          <button
            type="button"
            disabled={busy}
            onClick={clearToday}
            className="text-secondary-foreground underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default ExperimentsScreen;
