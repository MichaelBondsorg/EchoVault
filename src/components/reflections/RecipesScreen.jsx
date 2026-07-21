import { useEffect, useState } from 'react';
import { Archive, Layers, Pencil, Play, X } from 'lucide-react';
import { db } from '../../config/firebase';
import { Button } from '../cloud';
import { subscribeRecipes, createRecipe, updateRecipe, archiveRecipe } from '../../services/reflections/recipeService';
import { STARTER_RECIPES } from '../../services/reflections/starterRecipes';
import { previewRecipe, runRecipe } from '../../services/reflections/runRecipe';
import { getExcludedEntryIds } from '../../services/insights/sourceExclusions';
import { generateEmbedding } from '../../services/ai';
import ReflectionDraft from './ReflectionDraft';

/**
 * RecipesScreen — full-screen Reflection Recipes overlay (R2 Task 17),
 * modeled on `PrivacyCenter.jsx`'s cloud-sheet layout (same precedent
 * `SpaceManager.jsx`/`InsightControlCenter.jsx` followed). Mounted behind
 * `getFlag('reflectionRecipes')` at the call site (`AppLayout.jsx` +
 * `SettingsPage.jsx` nav row) — this component itself is flag-agnostic.
 *
 * Three flows:
 *  1. Starter-seed CTA (zero recipes only) — writes every
 *     `STARTER_RECIPES` template via `createRecipe`.
 *  2. List (name + cadence line) with inline edit (name + questions only —
 *     scope/timeRangeDays stay whatever they were created with; v1 has no
 *     scope-picker here) and archive (confirm-gated; recipes are archived,
 *     never deleted, and existing reflections are untouched — see
 *     `recipeService.js`).
 *  3. Run: preview dialog (`previewRecipe` — PRD "preview exactly what
 *     will be used before first run") -> explicit "Run" confirm -> a
 *     progress state while per-question embeddings are generated (the
 *     CRITICAL CONTRACT from the Task 16 review: retrieval silently
 *     degrades without them) -> `runRecipe` -> `ReflectionDraft` opens on
 *     the resulting reflection. A failed embedding for a single question
 *     is not fatal (`runRecipe` handles `null` with a console.warn) — it
 *     never blocks the run.
 *
 * Nested-overlay a11y (SpaceManager/InsightControlCenter precedent): only
 * one archive/preview/progress sheet is ever open at a time (they're
 * mutually exclusive states), and each is a hand-rolled `role="dialog"
 * aria-modal="true"` sibling overlay — not the `cloud` Dialog primitive,
 * whose own portal would otherwise coexist with this screen's own
 * `aria-modal="true"` root and produce two simultaneous modal nodes. While
 * any nested overlay is open, this outer dialog drops `aria-modal`, gains
 * `aria-hidden`/`inert`, mirroring `SpaceManager`'s archive sheet.
 */

const MAX_QUESTIONS = 5;
const MAX_QUESTION_LENGTH = 200;

function cadenceLine(recipe) {
  return `Manual · last ${recipe.timeRangeDays} days`;
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const RecipesScreen = ({ uid, entries = [], onClose }) => {
  const [recipes, setRecipes] = useState([]);
  const [recipesLoaded, setRecipesLoaded] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState(null);

  // Inline edit
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editQuestions, setEditQuestions] = useState([]);
  const [editError, setEditError] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Archive confirm
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);

  // Run flow
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState({ current: 0, total: 0 });
  const [runError, setRunError] = useState(null);
  const [activeReflection, setActiveReflection] = useState(null);
  const [activeRecipe, setActiveRecipe] = useState(null);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeRecipes(
      db,
      uid,
      (next) => {
        setRecipes(next);
        setRecipesLoaded(true);
      },
      () => setRecipesLoaded(true),
    );
  }, [uid]);

  const handleSeed = async () => {
    if (!uid || seeding) return;
    setSeeding(true);
    setError(null);
    try {
      for (const template of STARTER_RECIPES) {
        // eslint-disable-next-line no-await-in-loop -- sequential writes are
        // fine for a fixed, tiny (4) starter set; no need for Promise.all
        // complexity here.
        await createRecipe(db, uid, template);
      }
    } catch (err) {
      setError(err?.message || 'Could not create starter recipes.');
    } finally {
      setSeeding(false);
    }
  };

  const startEdit = (recipe) => {
    setError(null);
    setEditError(null);
    setEditingId(recipe.id);
    setEditName(recipe.name);
    setEditQuestions([...recipe.questions]);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditQuestions([]);
    setEditError(null);
  };

  const updateEditQuestion = (index, value) => {
    setEditQuestions((prev) => prev.map((q, i) => (i === index ? value : q)));
  };

  const addEditQuestion = () => {
    setEditQuestions((prev) => (prev.length >= MAX_QUESTIONS ? prev : [...prev, '']));
  };

  const removeEditQuestion = (index) => {
    setEditQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const saveEdit = async (recipe) => {
    setEditError(null);
    const trimmedName = editName.trim();
    const trimmedQuestions = editQuestions.map((q) => q.trim()).filter(Boolean);

    if (!trimmedName) {
      setEditError('Give this recipe a name.');
      return;
    }
    if (trimmedQuestions.length === 0) {
      setEditError('Add at least one question.');
      return;
    }
    if (trimmedQuestions.length > MAX_QUESTIONS) {
      setEditError(`Recipes can have at most ${MAX_QUESTIONS} questions.`);
      return;
    }
    if (trimmedQuestions.some((q) => q.length > MAX_QUESTION_LENGTH)) {
      setEditError(`Questions must be ${MAX_QUESTION_LENGTH} characters or fewer.`);
      return;
    }

    setSavingEdit(true);
    try {
      await updateRecipe(db, uid, recipe, { name: trimmedName, questions: trimmedQuestions });
      cancelEdit();
    } catch (err) {
      setEditError(err?.message || 'Could not save your changes.');
    } finally {
      setSavingEdit(false);
    }
  };

  const openArchiveConfirm = (recipe) => {
    setError(null);
    setArchiveTarget(recipe);
  };
  const closeArchiveConfirm = () => setArchiveTarget(null);

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await archiveRecipe(db, uid, archiveTarget.id);
      closeArchiveConfirm();
    } catch (err) {
      setError(err?.message || 'Could not archive that recipe.');
    } finally {
      setArchiving(false);
    }
  };

  const openPreview = async (recipe) => {
    setRunError(null);
    setPreviewTarget(recipe);
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      const exclusions = await getExcludedEntryIds(db, uid);
      setPreviewData(previewRecipe(recipe, entries, exclusions, []));
    } catch (err) {
      setError(err?.message || 'Could not preview that recipe.');
      setPreviewTarget(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewTarget(null);
    setPreviewData(null);
  };

  const confirmRun = async () => {
    const recipe = previewTarget;
    if (!recipe) return;
    closePreview();
    setRunning(true);
    setRunError(null);

    const uniqueQuestions = [...new Set(recipe.questions)];
    setRunProgress({ current: 0, total: uniqueQuestions.length });
    const embeddings = {};

    try {
      for (const question of uniqueQuestions) {
        // eslint-disable-next-line no-await-in-loop -- sequential so the
        // progress counter reflects real completion, not fan-out; question
        // counts are small (rules cap recipes at 5).
        const embedding = await generateEmbedding(question);
        embeddings[question] = embedding;
        setRunProgress((prev) => ({ ...prev, current: prev.current + 1 }));
      }

      const reflection = await runRecipe(db, uid, recipe, { entries, embeddings });
      setActiveReflection(reflection);
      setActiveRecipe(recipe);
    } catch (err) {
      setRunError(err?.message || 'Could not run that recipe. Please try again.');
    } finally {
      setRunning(false);
    }
  };

  const closeReflectionDraft = () => {
    setActiveReflection(null);
    setActiveRecipe(null);
  };

  if (activeReflection) {
    return (
      <ReflectionDraft
        uid={uid}
        entries={entries}
        reflection={activeReflection}
        recipeName={activeRecipe?.name}
        onClose={closeReflectionDraft}
      />
    );
  }

  const nestedOverlayOpen = Boolean(archiveTarget) || Boolean(previewTarget) || running;

  return (
    <>
      <div
        className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]"
        role="dialog"
        aria-modal={nestedOverlayOpen ? undefined : 'true'}
        aria-hidden={nestedOverlayOpen ? 'true' : undefined}
        inert={nestedOverlayOpen ? 'true' : undefined}
        aria-labelledby="recipes-title"
      >
        <div className="mx-auto max-w-xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <p className="cloud-kicker">REFLECTION RECIPES</p>
              <h2 id="recipes-title" className="cloud-title text-3xl">Guided reflections</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Ask a set of questions across your entries, whenever you want to look back.
              </p>
            </div>
            <button type="button" className="cloud-icon-button" aria-label="Close reflection recipes" onClick={onClose}>
              <X size={21} />
            </button>
          </header>

          {error && (
            <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {recipesLoaded && recipes.length === 0 && (
            <section className="cloud-sheet rounded-2xl border p-4 shadow-sm">
              <p className="font-semibold">Start with a few ready-made recipes</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Monthly review, goal progress, relationship check-in, and session preparation.
              </p>
              <Button onClick={handleSeed} disabled={seeding} className="mt-3">
                <Layers size={16} aria-hidden="true" />
                {seeding ? 'Creating…' : 'Create starter recipes'}
              </Button>
            </section>
          )}

          <section>
            <h3 className="cloud-kicker mb-2">YOUR RECIPES</h3>
            <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
              {recipes.length === 0 ? (
                <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">No recipes yet.</p>
              ) : (
                recipes.map((recipe) => (
                  <div key={recipe.id} className="px-4 py-3">
                    {editingId === recipe.id ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          aria-label={`Name for ${recipe.name}`}
                          className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
                          maxLength={60}
                        />
                        {editQuestions.map((q, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={q}
                              onChange={(e) => updateEditQuestion(i, e.target.value)}
                              aria-label={`Question ${i + 1}`}
                              className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
                              maxLength={MAX_QUESTION_LENGTH}
                            />
                            <button
                              type="button"
                              aria-label={`Remove question ${i + 1}`}
                              onClick={() => removeEditQuestion(i)}
                              className="cloud-icon-button"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                        {editQuestions.length < MAX_QUESTIONS && (
                          <button
                            type="button"
                            onClick={addEditQuestion}
                            className="text-xs font-medium text-accent-deep"
                          >
                            + Add question
                          </button>
                        )}
                        {editError && (
                          <p role="alert" className="text-xs text-destructive">{editError}</p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <Button
                            onClick={() => saveEdit(recipe)}
                            disabled={savingEdit}
                            className="min-h-[36px] px-4 text-xs"
                          >
                            {savingEdit ? 'Saving…' : 'Save'}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={cancelEdit}
                            disabled={savingEdit}
                            className="min-h-[36px] px-4 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">{recipe.name}</p>
                          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{cadenceLine(recipe)}</p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Run ${recipe.name}`}
                          onClick={() => openPreview(recipe)}
                          className="cloud-icon-button"
                        >
                          <Play size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Edit ${recipe.name}`}
                          onClick={() => startEdit(recipe)}
                          className="cloud-icon-button"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Archive ${recipe.name}`}
                          onClick={() => openArchiveConfirm(recipe)}
                          className="cloud-icon-button"
                        >
                          <Archive size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          {runError && (
            <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
              {runError}
            </div>
          )}
        </div>
      </div>

      {archiveTarget && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-recipe-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="archive-recipe-title" className="mb-1 font-display font-bold text-lg text-foreground">
              Archive &quot;{archiveTarget.name}&quot;?
            </h3>
            <p className="mb-4 text-sm text-secondary-foreground">
              Past reflections from this recipe are kept — only the recipe itself is archived.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closeArchiveConfirm} disabled={archiving} className="flex-1">
                Cancel
              </Button>
              <Button onClick={confirmArchive} disabled={archiving} className="flex-1">
                {archiving ? 'Archiving…' : 'Archive'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {previewTarget && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-recipe-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="run-recipe-title" className="mb-2 font-display font-bold text-lg text-foreground">
              Run &quot;{previewTarget.name}&quot;?
            </h3>
            <p className="mb-4 text-sm text-secondary-foreground">
              {previewLoading || !previewData
                ? 'Checking what will be used…'
                : `Will use ${previewData.entryCount} entries · ${previewData.spaceName} · ${formatDateLabel(previewData.start)} – ${formatDateLabel(previewData.end)}`}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={closePreview} className="flex-1">
                Cancel
              </Button>
              <Button onClick={confirmRun} disabled={previewLoading || !previewData} className="flex-1">
                Run
              </Button>
            </div>
          </div>
        </div>
      )}

      {running && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="run-progress-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="run-progress-title" className="mb-2 font-display font-bold text-lg text-foreground">
              Preparing your reflection…
            </h3>
            <p className="text-sm text-secondary-foreground">
              {runProgress.total > 0
                ? `Understanding question ${Math.min(runProgress.current + 1, runProgress.total)} of ${runProgress.total}…`
                : 'Gathering your entries…'}
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default RecipesScreen;
