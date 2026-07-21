import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Pencil, Trash2, X } from 'lucide-react';
import { db, collection, query, where, getDocs } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { Button, Chip } from '../cloud';
import SourceList from '../insights/SourceList';
import { sourceFromEntry } from '../../services/insights/receipts';
import { updateBlock, addUserBlock, removeBlock, reorderBlocks } from '../../services/reflections/runRecipe';

/**
 * ReflectionDraft — full-screen view of a single `reflections/{id}` doc
 * (R2 Task 17), opened by `RecipesScreen` right after a recipe run
 * completes (and reachable again later via the "past runs" list here).
 *
 * PRD trace-or-labeled acceptance: every block is either "AI-generated"
 * (optionally also tagged "Edited" once the user changes its wording — the
 * "AI-generated" label itself never disappears, since the content's origin
 * doesn't change just because the wording did) or "Your note" — never
 * unlabeled. AI blocks additionally carry a tappable source-count chip
 * that opens the Task-11 `SourceList` (extracted from `ReceiptSheet.jsx`)
 * scoped to exactly that block's own `sources` — never another block's.
 *
 * Editing goes through the Task 16 engine helpers 1:1
 * (`updateBlock`/`addUserBlock`/`removeBlock`/`reorderBlocks`), each of
 * which returns the full updated reflection — this component just swaps
 * its local `current` state to whatever they return rather than
 * hand-rolling the merge itself, so the editedByUser/sources semantics
 * those helpers own can never drift from what's actually persisted.
 *
 * No export affordance anywhere in this screen (Session Prep owns export —
 * Task 18).
 *
 * Nested-overlay a11y (SpaceManager/InsightControlCenter precedent): the
 * source-list sheet and the remove-confirm dialog are hand-rolled
 * `role="dialog" aria-modal="true"` siblings, mutually exclusive with each
 * other, and this screen's own root drops `aria-modal`/gains
 * `aria-hidden`+`inert` while either is open — so only one `aria-modal`
 * node ever exists at a time.
 */

function reflectionsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/reflections`;
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const ReflectionDraft = ({ uid, entries = [], reflection, recipeName, onClose }) => {
  const [current, setCurrent] = useState(reflection);
  const [pastRuns, setPastRuns] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [editingBlockId, setEditingBlockId] = useState(null);
  const [editText, setEditText] = useState('');

  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const [removeTarget, setRemoveTarget] = useState(null); // blockId
  const [sourceListBlockId, setSourceListBlockId] = useState(null);

  const entriesById = useMemo(() => {
    const map = {};
    (entries || []).forEach((entry) => {
      const id = entry?.id || entry?.entryId;
      if (id) map[id] = entry;
    });
    return map;
  }, [entries]);

  // Past runs for the same recipe. Only refetches when the recipe id
  // changes (not on every block edit) — `reflection.recipeId` is stable
  // across edits of the currently-displayed run.
  useEffect(() => {
    if (!uid || !reflection?.recipeId) {
      setPastRuns([]);
      return undefined;
    }
    let cancelled = false;
    const q = query(collection(db, reflectionsPath(uid)), where('recipeId', '==', reflection.recipeId));
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        const runs = [];
        snap.forEach((d) => runs.push({ id: d.id, ...d.data() }));
        // No orderBy in the query (avoids requiring a composite index for
        // a simple owner collection) — sort client-side, newest first.
        runs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setPastRuns(runs);
      })
      .catch(() => {
        if (!cancelled) setPastRuns([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, reflection?.recipeId]);

  const applyUpdate = (updated) => {
    setCurrent(updated);
    setPastRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const startEditBlock = (block) => {
    setError(null);
    setEditingBlockId(block.id);
    setEditText(block.text || '');
  };
  const cancelEditBlock = () => {
    setEditingBlockId(null);
    setEditText('');
  };
  const saveEditBlock = async () => {
    if (!editingBlockId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateBlock(db, uid, current.id, editingBlockId, { text: editText });
      applyUpdate(updated);
      cancelEditBlock();
    } catch (err) {
      setError(err?.message || 'Could not save that edit.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddNote = async () => {
    const text = noteText.trim();
    if (!text || addingNote) return;
    setAddingNote(true);
    setError(null);
    try {
      const updated = await addUserBlock(db, uid, current.id, text);
      applyUpdate(updated);
      setNoteText('');
    } catch (err) {
      setError(err?.message || 'Could not add that note.');
    } finally {
      setAddingNote(false);
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await removeBlock(db, uid, current.id, removeTarget);
      applyUpdate(updated);
      setRemoveTarget(null);
    } catch (err) {
      setError(err?.message || 'Could not remove that block.');
    } finally {
      setBusy(false);
    }
  };

  const moveBlock = async (index, direction) => {
    const blocks = current.blocks || [];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= blocks.length) return;
    const reordered = [...blocks];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    setBusy(true);
    setError(null);
    try {
      const updated = await reorderBlocks(db, uid, current.id, reordered.map((b) => b.id));
      applyUpdate(updated);
    } catch (err) {
      setError(err?.message || 'Could not reorder blocks.');
    } finally {
      setBusy(false);
    }
  };

  const sourceListBlock = (current.blocks || []).find((b) => b.id === sourceListBlockId) || null;
  const sourceListSources = sourceListBlock
    ? (sourceListBlock.sources || []).map((id) => {
        const entry = entriesById[id];
        return entry ? sourceFromEntry(entry) : { entryId: id, date: null, excerpt: null };
      })
    : [];

  const nestedOverlayOpen = Boolean(removeTarget) || Boolean(sourceListBlockId);

  return (
    <>
      <div
        className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]"
        role="dialog"
        aria-modal={nestedOverlayOpen ? undefined : 'true'}
        aria-hidden={nestedOverlayOpen ? 'true' : undefined}
        inert={nestedOverlayOpen ? 'true' : undefined}
        aria-labelledby="reflection-draft-title"
      >
        <div className="mx-auto max-w-xl space-y-5">
          <header className="flex items-start justify-between">
            <div className="min-w-0">
              <p className="cloud-kicker">{recipeName || 'REFLECTION'}</p>
              <h2 id="reflection-draft-title" className="cloud-title text-2xl break-words">{current.title}</h2>
              {current.period && (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {formatDateLabel(current.period.start)} – {formatDateLabel(current.period.end)}
                </p>
              )}
            </div>
            <button type="button" className="cloud-icon-button" aria-label="Close reflection" onClick={onClose}>
              <X size={21} />
            </button>
          </header>

          {error && (
            <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {pastRuns.length > 1 && (
            <section>
              <h3 className="cloud-kicker mb-2">PAST RUNS</h3>
              <div className="flex flex-wrap gap-2">
                {pastRuns.map((run) => (
                  <Chip
                    key={run.id}
                    as="button"
                    type="button"
                    selected={run.id === current.id}
                    onClick={() => setCurrent(run)}
                  >
                    {run.title}
                  </Chip>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            {(current.blocks || []).map((block, index) => {
              const isEditing = editingBlockId === block.id;
              const sourceCount = (block.sources || []).length;
              return (
                <div
                  key={block.id}
                  data-testid={`reflection-block-${block.id}`}
                  className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {block.type === 'ai' ? (
                      <>
                        <Chip>AI-generated</Chip>
                        {block.editedByUser && <Chip>Edited</Chip>}
                        <Chip as="button" type="button" onClick={() => setSourceListBlockId(block.id)}>
                          {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
                        </Chip>
                      </>
                    ) : (
                      <Chip>Your note</Chip>
                    )}
                  </div>

                  {block.type === 'ai' && block.question && (
                    <p className="text-xs text-[var(--muted-foreground)]">{block.question}</p>
                  )}

                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        aria-label="Edit block text"
                        className="w-full rounded-lg border border-border bg-card p-2 text-sm"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button onClick={saveEditBlock} disabled={busy} className="min-h-[36px] px-4 text-xs">
                          {busy ? 'Saving…' : 'Save'}
                        </Button>
                        <Button variant="ghost" onClick={cancelEditBlock} disabled={busy} className="min-h-[36px] px-4 text-xs">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="whitespace-pre-line text-sm text-secondary-foreground break-words">{block.text}</p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Edit"
                          onClick={() => startEditBlock(block)}
                          className="cloud-icon-button"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label="Remove"
                          onClick={() => setRemoveTarget(block.id)}
                          className="cloud-icon-button"
                        >
                          <Trash2 size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={index === 0}
                          onClick={() => moveBlock(index, -1)}
                          className="cloud-icon-button disabled:opacity-30"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={index === (current.blocks || []).length - 1}
                          onClick={() => moveBlock(index, 1)}
                          className="cloud-icon-button disabled:opacity-30"
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </section>

          <section className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
            <label htmlFor="reflection-add-note" className="text-xs font-medium text-[var(--muted-foreground)]">
              Add your own note
            </label>
            <textarea
              id="reflection-add-note"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              aria-label="Add a note"
              placeholder="Write something in your own words…"
              className="w-full rounded-lg border border-border bg-card p-2 text-sm"
              rows={2}
            />
            <Button onClick={handleAddNote} disabled={addingNote || !noteText.trim()} className="min-h-[36px] px-4 text-xs">
              {addingNote ? 'Adding…' : 'Add note'}
            </Button>
          </section>
        </div>
      </div>

      {removeTarget && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-block-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="remove-block-title" className="mb-1 font-display font-bold text-lg text-foreground">
              Remove this block?
            </h3>
            <p className="mb-4 text-sm text-secondary-foreground">
              It won&apos;t appear in this reflection anymore.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setRemoveTarget(null)} disabled={busy} className="flex-1">
                Cancel
              </Button>
              <Button onClick={confirmRemove} disabled={busy} className="flex-1">
                {busy ? 'Removing…' : 'Remove'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {sourceListBlockId && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reflection-source-list-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 id="reflection-source-list-title" className="font-display font-bold text-lg text-foreground">
                Sources
              </h3>
              <button
                type="button"
                aria-label="Close sources"
                onClick={() => setSourceListBlockId(null)}
                className="cloud-icon-button"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              <SourceList sources={sourceListSources} entriesById={entriesById} />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ReflectionDraft;
