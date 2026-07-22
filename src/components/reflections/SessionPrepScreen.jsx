import { useEffect, useMemo, useState } from 'react';
import { Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { db, collection, query, where, getDocs } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getFlag } from '../../config/flags';
import { Button, Chip } from '../cloud';
import SpacePicker from '../spaces/SpacePicker';
import SourceList from '../insights/SourceList';
import { sourceFromEntry } from '../../services/insights/receipts';
import { useDismissablePopover } from '../../hooks/useDismissablePopover';
import { subscribeSpaces } from '../../services/spaces/spacesService';
import { updateBlock, removeBlock } from '../../services/reflections/runRecipe';
import {
  buildSessionBrief,
  regenerateSection,
  composeSessionPrepPdf,
  DEFAULT_SINCE_DAYS_BACK,
  SESSION_PREP_QUESTIONS,
} from '../../services/reflections/sessionPrep';
import { generateQueryEmbeddings } from '../../services/ai';

/**
 * SessionPrepScreen — full-screen Session Prep overlay (R2 Task 18),
 * modeled on `RecipesScreen`/`ReflectionDraft`'s cloud-sheet layout (same
 * `PrivacyCenter.jsx` precedent). Mounted behind `getFlag('sessionPrep')`
 * at the call site (`AppLayout.jsx` + `SettingsPage.jsx` nav row) — this
 * component itself is flag-agnostic.
 *
 * Two views:
 *  1. Setup — since-date (explicit date field, defaults to
 *     `DEFAULT_SINCE_DAYS_BACK` days back, but the user can change it; the
 *     value that's actually stored is whatever's in the field when they
 *     tap Generate — never silently re-derived), scope (`SpacePicker`,
 *     gated behind `contextSpaces` exactly like `RecipesScreen`'s own
 *     picker — same defense-in-depth rationale: `runQuestions` applies
 *     scope filtering unconditionally, so an ungated picker would be a
 *     real leak, not cosmetic), optional topics free text, and a list of
 *     past session preps to reopen. "Generate" pre-computes one embedding
 *     per question (CRITICAL CONTRACT, Task 16 review finding — retrieval
 *     silently degrades without them) before calling `buildSessionBrief`.
 *  2. Brief — the generated/reopened brief: each block labeled
 *     "AI-generated" (+ "Edited" once changed) or "Your note", a tappable
 *     source-count chip opening `SourceList`, edit-in-place, remove
 *     (confirm-gated), and per-AI-block "Regenerate" (confirm-gated ONLY
 *     when the block has already been edited by the user — PRD/brief
 *     requirement). "Export" opens a confirmation sheet with the FULL
 *     content preview (foreground, explicit — PRD: no background/share
 *     path) before `composeSessionPrepPdf` ever runs.
 *
 * Nested-overlay a11y (SpaceManager/RecipesScreen precedent): every nested
 * sheet (regenerate-confirm, remove-confirm, source list, export-confirm)
 * is a hand-rolled `role="dialog" aria-modal="true"` sibling, mutually
 * exclusive with the others; the root drops `aria-modal`/gains
 * `aria-hidden`+`inert` while any of them is open.
 */

function reflectionsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/reflections`;
}

function isoDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function defaultSinceDateValue() {
  return isoDateInputValue(new Date(Date.now() - DEFAULT_SINCE_DAYS_BACK * 24 * 60 * 60 * 1000));
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const SessionPrepScreen = ({ uid, entries = [], onClose }) => {
  const [spaces, setSpaces] = useState([]);
  const contextSpacesOn = getFlag('contextSpaces');

  // Setup form
  const [sinceDateValue, setSinceDateValue] = useState(defaultSinceDateValue);
  const [scope, setScope] = useState(null);
  const [topics, setTopics] = useState('');
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const scopePickerRef = useDismissablePopover(scopePickerOpen, () => setScopePickerOpen(false));
  const [formError, setFormError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ current: 0, total: 0 });

  // Past briefs
  const [pastBriefs, setPastBriefs] = useState([]);
  const [pastLoaded, setPastLoaded] = useState(false);

  // Active brief view
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [editingBlockId, setEditingBlockId] = useState(null);
  const [editText, setEditText] = useState('');
  const [removeTarget, setRemoveTarget] = useState(null);
  const [sourceListBlockId, setSourceListBlockId] = useState(null);
  const [regenerateConfirmId, setRegenerateConfirmId] = useState(null); // only set when editedByUser
  const [regeneratingId, setRegeneratingId] = useState(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const entriesById = useMemo(() => {
    const map = {};
    (entries || []).forEach((entry) => {
      const id = entry?.id || entry?.entryId;
      if (id) map[id] = entry;
    });
    return map;
  }, [entries]);

  // Context Space picker (flag: contextSpaces) — same gate as every other
  // SpacePicker consumer: subscribe only while the flag is on, reset to []
  // when it's off.
  useEffect(() => {
    if (!contextSpacesOn || !uid) {
      setSpaces([]);
      return undefined;
    }
    return subscribeSpaces(db, uid, setSpaces);
  }, [contextSpacesOn, uid]);

  // Past session preps (no live subscription needed — a one-shot fetch,
  // refreshed after each new brief is generated). No orderBy in the query
  // to avoid a composite-index requirement; sorted client-side.
  useEffect(() => {
    if (!uid) {
      setPastBriefs([]);
      setPastLoaded(true);
      return;
    }
    let cancelled = false;
    const q = query(collection(db, reflectionsPath(uid)), where('kind', '==', 'session_brief'));
    getDocs(q)
      .then((snap) => {
        if (cancelled) return;
        const briefs = [];
        snap.forEach((d) => briefs.push({ id: d.id, ...d.data() }));
        briefs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        setPastBriefs(briefs);
        setPastLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setPastBriefs([]);
          setPastLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const openBrief = (brief) => {
    setCurrent(brief);
    setError(null);
  };

  const backToSetup = () => {
    setCurrent(null);
    setError(null);
  };

  const handleGenerate = async () => {
    setFormError(null);
    if (!sinceDateValue) {
      setFormError('Choose a since date.');
      return;
    }
    const sinceDate = new Date(`${sinceDateValue}T00:00:00.000Z`);
    if (Number.isNaN(sinceDate.getTime())) {
      setFormError('That date could not be understood.');
      return;
    }
    if (sinceDate.getTime() > Date.now()) {
      setFormError('The since date can\'t be in the future.');
      return;
    }

    const trimmedTopics = topics.trim();
    const questions = [...SESSION_PREP_QUESTIONS];
    if (trimmedTopics) questions.push(trimmedTopics);
    const uniqueQuestions = [...new Set(questions)];

    setGenerating(true);
    setGenProgress({ current: 0, total: uniqueQuestions.length });
    const embeddings = {};
    try {
      for (const question of uniqueQuestions) {
        // eslint-disable-next-line no-await-in-loop -- sequential so the
        // progress counter reflects real completion; question counts are
        // small and bounded (4 fixed + at most 1 topics question).
        // Space-aware (embeddings v2 migration plan task M2): the
        // `{[question]: queryVectors|null}` map ultimately flows through
        // runRecipe's shared `runQuestions` core into `askJournalAI` ->
        // `getSmartChatContext`, same as RecipesScreen.jsx.
        const embedding = await generateQueryEmbeddings(question);
        embeddings[question] = embedding;
        setGenProgress((prev) => ({ ...prev, current: prev.current + 1 }));
      }

      const brief = await buildSessionBrief(db, uid, {
        sinceDate,
        scope,
        topics: trimmedTopics,
        entries,
        embeddings,
      });
      setPastBriefs((prev) => [brief, ...prev]);
      openBrief(brief);
    } catch (err) {
      setFormError(err?.message || 'Could not build your session prep. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const applyUpdate = (updated) => {
    setCurrent(updated);
    setPastBriefs((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
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

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await removeBlock(db, uid, current.id, removeTarget);
      applyUpdate(updated);
      setRemoveTarget(null);
    } catch (err) {
      setError(err?.message || 'Could not remove that section.');
    } finally {
      setBusy(false);
    }
  };

  const runRegenerate = async (blockId, { confirm = false } = {}) => {
    setRegeneratingId(blockId);
    setError(null);
    try {
      const targetBlock = (current.blocks || []).find((b) => b.id === blockId);
      const embeddings = {};
      if (targetBlock?.question) {
        // Space-aware (embeddings v2 migration plan task M2) — see the
        // generation loop above for the shape this map carries downstream.
        embeddings[targetBlock.question] = await generateQueryEmbeddings(targetBlock.question);
      }
      const updated = await regenerateSection(db, uid, current.id, blockId, { entries, embeddings, confirm });
      applyUpdate(updated);
      setRegenerateConfirmId(null);
    } catch (err) {
      setError(err?.message || 'Could not regenerate that section.');
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleRegenerateClick = (block) => {
    if (block.editedByUser) {
      setRegenerateConfirmId(block.id);
      return;
    }
    runRegenerate(block.id);
  };

  const openExportConfirm = () => {
    setError(null);
    setExportConfirmOpen(true);
  };
  const closeExportConfirm = () => setExportConfirmOpen(false);

  const confirmExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const pdfDoc = await composeSessionPrepPdf(current, entriesById);
      pdfDoc.save('session-prep.pdf');
      setExportConfirmOpen(false);
    } catch (err) {
      setError(err?.message || 'Could not export this session prep. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const sourceListBlock = current ? (current.blocks || []).find((b) => b.id === sourceListBlockId) || null : null;
  const sourceListSources = sourceListBlock
    ? (sourceListBlock.sources || []).map((id) => {
        const entry = entriesById[id];
        return entry ? sourceFromEntry(entry) : { entryId: id, date: null, excerpt: null };
      })
    : [];

  const regenerateConfirmBlock = current ? (current.blocks || []).find((b) => b.id === regenerateConfirmId) || null : null;

  const nestedOverlayOpen = Boolean(removeTarget) || Boolean(sourceListBlockId) || Boolean(regenerateConfirmBlock) || exportConfirmOpen;

  const selectedSpaceLabel = scope?.spaceId
    ? spaces.find((s) => s.id === scope.spaceId)?.name ?? scope.spaceId
    : 'All spaces';

  return (
    <>
      <div
        className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]"
        role="dialog"
        aria-modal={nestedOverlayOpen ? undefined : 'true'}
        aria-hidden={nestedOverlayOpen ? 'true' : undefined}
        inert={nestedOverlayOpen ? 'true' : undefined}
        aria-labelledby="session-prep-title"
      >
        <div className="mx-auto max-w-xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <p className="cloud-kicker">SESSION PREP</p>
              <h2 id="session-prep-title" className="cloud-title text-3xl">
                {current ? current.title : 'Get ready for your session'}
              </h2>
              {!current && (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  A private, editable brief built from your own entries — nothing leaves this app until you export it.
                </p>
              )}
            </div>
            <button type="button" className="cloud-icon-button" aria-label="Close session prep" onClick={onClose}>
              <X size={21} />
            </button>
          </header>

          {error && (
            <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!current ? (
            <>
              {formError && (
                <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
                  {formError}
                </div>
              )}

              <section className="cloud-sheet space-y-3 rounded-2xl border p-4 shadow-sm">
                <div className="space-y-1">
                  <label htmlFor="session-prep-since" className="text-xs font-medium text-[var(--muted-foreground)]">
                    Since
                  </label>
                  <input
                    id="session-prep-since"
                    type="date"
                    value={sinceDateValue}
                    onChange={(e) => setSinceDateValue(e.target.value)}
                    className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
                  />
                </div>

                {contextSpacesOn && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[var(--muted-foreground)]">Space</p>
                    <div className="relative inline-block" ref={scopePickerRef}>
                      <Chip
                        as="button"
                        type="button"
                        onClick={() => setScopePickerOpen((prev) => !prev)}
                        aria-haspopup="listbox"
                        aria-expanded={scopePickerOpen}
                        aria-label={`Space: ${selectedSpaceLabel}`}
                      >
                        {selectedSpaceLabel}
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
                )}

                <div className="space-y-1">
                  <label htmlFor="session-prep-topics" className="text-xs font-medium text-[var(--muted-foreground)]">
                    Anything specific you want to reflect on? (optional)
                  </label>
                  <textarea
                    id="session-prep-topics"
                    value={topics}
                    onChange={(e) => setTopics(e.target.value)}
                    placeholder="e.g. the conversation with my sister"
                    className="w-full rounded-lg border border-border bg-card p-2 text-sm"
                    rows={2}
                  />
                </div>

                <Button onClick={handleGenerate} disabled={generating} className="w-full">
                  {generating
                    ? genProgress.total > 0
                      ? `Preparing… (${Math.min(genProgress.current + 1, genProgress.total)}/${genProgress.total})`
                      : 'Preparing…'
                    : 'Generate session prep'}
                </Button>
              </section>

              {pastLoaded && pastBriefs.length > 0 && (
                <section>
                  <h3 className="cloud-kicker mb-2">RECENT</h3>
                  <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
                    {pastBriefs.map((brief) => (
                      <button
                        key={brief.id}
                        type="button"
                        onClick={() => openBrief(brief)}
                        className="block w-full px-4 py-3 text-left"
                      >
                        <p className="font-medium text-foreground">{brief.title}</p>
                        {brief.period && (
                          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                            Since {formatDateLabel(brief.period.start)}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <>
              {current.period && (
                <p className="text-sm text-[var(--muted-foreground)]">Since {formatDateLabel(current.period.start)}</p>
              )}

              <section className="space-y-3">
                {(current.blocks || []).map((block) => {
                  const isEditing = editingBlockId === block.id;
                  const sourceCount = (block.sources || []).length;
                  return (
                    <div
                      key={block.id}
                      data-testid={`session-prep-block-${block.id}`}
                      className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-display font-semibold text-foreground">{block.section}</h3>
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
                      </div>

                      {isEditing ? (
                        <div className="space-y-2">
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            aria-label={`Edit ${block.section}`}
                            className="w-full rounded-lg border border-border bg-card p-2 text-sm"
                            rows={3}
                          />
                          <div className="flex gap-2">
                            <Button onClick={saveEditBlock} disabled={busy} className="px-4 text-xs">
                              {busy ? 'Saving…' : 'Save'}
                            </Button>
                            <Button variant="ghost" onClick={cancelEditBlock} disabled={busy} className="px-4 text-xs">
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="whitespace-pre-line text-sm text-secondary-foreground break-words">
                            {block.text || (block.type === 'user' ? 'Tap Edit to add your own goals for this session.' : '')}
                          </p>
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              aria-label={`Edit ${block.section}`}
                              onClick={() => startEditBlock(block)}
                              className="cloud-icon-button"
                            >
                              <Pencil size={16} />
                            </button>
                            {block.type === 'ai' && (
                              <button
                                type="button"
                                aria-label={`Regenerate ${block.section}`}
                                onClick={() => handleRegenerateClick(block)}
                                disabled={regeneratingId === block.id}
                                className="cloud-icon-button"
                              >
                                <RefreshCw size={16} className={regeneratingId === block.id ? 'animate-spin' : ''} />
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`Remove ${block.section}`}
                              onClick={() => setRemoveTarget(block.id)}
                              className="cloud-icon-button"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </section>

              <div className="flex gap-2">
                <Button variant="ghost" onClick={backToSetup} className="flex-1">
                  New session prep
                </Button>
                <Button onClick={openExportConfirm} className="flex-1">
                  Export
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {removeTarget && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-session-block-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="remove-session-block-title" className="mb-1 font-display font-bold text-lg text-foreground">
              Remove this section?
            </h3>
            <p className="mb-4 text-sm text-secondary-foreground">
              It won&apos;t appear in this brief — or in the exported PDF — anymore.
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

      {regenerateConfirmBlock && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="regenerate-confirm-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="regenerate-confirm-title" className="mb-1 font-display font-bold text-lg text-foreground">
              Overwrite your edits?
            </h3>
            <p className="mb-4 text-sm text-secondary-foreground">
              You&apos;ve edited &quot;{regenerateConfirmBlock.section}&quot;. Regenerating replaces your wording with a fresh AI answer.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setRegenerateConfirmId(null)} disabled={Boolean(regeneratingId)} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={() => runRegenerate(regenerateConfirmBlock.id, { confirm: true })}
                disabled={Boolean(regeneratingId)}
                className="flex-1"
              >
                {regeneratingId ? 'Regenerating…' : 'Regenerate'}
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
          aria-labelledby="session-prep-source-list-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 id="session-prep-source-list-title" className="font-display font-bold text-lg text-foreground">
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

      {exportConfirmOpen && current && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-confirm-title"
        >
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="export-confirm-title" className="mb-1 font-display font-bold text-lg text-foreground">
              Export &quot;{current.title}&quot;?
            </h3>
            <p className="mb-3 text-sm text-secondary-foreground">
              This is exactly what will be in the PDF. It stays on this device — nothing is shared automatically.
            </p>
            <div className="space-y-3 rounded-xl border border-border bg-background p-3">
              {(current.blocks || []).map((block) => (
                <div key={block.id} data-testid={`export-preview-${block.id}`}>
                  <p className="text-xs font-semibold text-[var(--muted-foreground)]">
                    {block.section} · {block.type === 'ai' ? 'AI-generated' : 'Your note'}
                  </p>
                  <p className="whitespace-pre-line text-sm text-secondary-foreground">{block.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" onClick={closeExportConfirm} disabled={exporting} className="flex-1">
                Cancel
              </Button>
              <Button onClick={confirmExport} disabled={exporting} className="flex-1">
                {exporting ? 'Exporting…' : 'Export PDF'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SessionPrepScreen;
