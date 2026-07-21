import { useEffect, useRef, useState } from 'react';
import { Archive, Check, Layers, Pencil, Plus, X } from 'lucide-react';
import { db } from '../../config/firebase';
import { Button } from '../cloud';
import {
  subscribeSpaces,
  createSpace,
  renameSpace,
  archiveSpace,
  seedStarterSpaces,
  reassignEntriesSpace,
} from '../../services/spaces/spacesService';

/**
 * SpaceManager — full-screen Context Spaces management overlay (PRD R1
 * Context Spaces, plan task 11). Modeled on `PrivacyCenter.jsx`'s
 * full-screen cloud-sheet layout.
 *
 * Lists the owner's active spaces (inline rename), lets them create a new
 * one, and offers a starter-seed CTA (`seedStarterSpaces`) ONLY when they
 * have zero spaces. Archiving a space always goes through the 3-option
 * sheet:
 *
 *   Move entries  -> pick another active space -> reassignEntriesSpace(from, to) THEN archiveSpace(from)
 *   Keep unscoped -> reassignEntriesSpace(from, null) THEN archiveSpace(from)
 *   Cancel        -> closes the sheet; no service call of any kind
 *
 * Journal content is never deleted by any path here — see
 * `src/services/spaces/spacesService.js`: archiving only ever flips
 * `state`, and reassignment only ever rewrites `spaceId` + `updatedAt` on
 * entries.
 *
 * Nested-dialog a11y (R2 task 4): the archive sheet is its own
 * `role="dialog"` + `aria-modal="true"` overlay stacked on top of this
 * one. Two simultaneous `aria-modal="true"` dialogs is an anti-pattern
 * (assistive tech / focus traps can't tell which is actually modal), so
 * while the sheet is open this outer dialog drops `aria-modal`, gains
 * `aria-hidden="true"` + `inert`, and Escape closes the sheet first
 * (inner), then the outer, with focus returning to the archive trigger
 * button that opened the sheet.
 */
const SpaceManager = ({ uid, onClose }) => {
  const [spaces, setSpaces] = useState([]);
  const [spacesLoaded, setSpacesLoaded] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [archiveTarget, setArchiveTarget] = useState(null); // the space object being archived, or null
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The archive-sheet trigger button that was clicked to open the sheet
  // (a11y: focus must return here, not vanish, when the sheet closes —
  // see closeArchiveSheet).
  const archiveTriggerRef = useRef(null);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeSpaces(db, uid, (next) => {
      setSpaces(next);
      setSpacesLoaded(true);
    });
  }, [uid]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !uid || creating) return;
    setCreating(true);
    setError(null);
    try {
      await createSpace(db, uid, newName);
      setNewName('');
    } catch (err) {
      setError(err?.message || 'Could not create that space.');
    } finally {
      setCreating(false);
    }
  };

  const handleSeed = async () => {
    if (!uid || seeding) return;
    setSeeding(true);
    setError(null);
    try {
      await seedStarterSpaces(db, uid);
    } catch (err) {
      setError(err?.message || 'Could not create starter spaces.');
    } finally {
      setSeeding(false);
    }
  };

  const startRename = (space) => {
    setError(null);
    setRenamingId(space.id);
    setRenameValue(space.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const commitRename = async (spaceId) => {
    if (!renameValue.trim() || !uid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await renameSpace(db, uid, spaceId, renameValue);
      setRenamingId(null);
      setRenameValue('');
    } catch (err) {
      setError(err?.message || 'Could not rename that space.');
    } finally {
      setBusy(false);
    }
  };

  const openArchiveSheet = (space, triggerEl) => {
    setError(null);
    setArchiveTarget(space);
    setMovePickerOpen(false);
    archiveTriggerRef.current = triggerEl || null;
  };

  // Cancel is a pure no-op: closes the sheet, calls nothing. Also the
  // shared close path for Escape (see the keydown effect below) — either
  // way, focus returns to the trigger that opened the sheet (a11y: focus
  // must never be dropped when a modal closes). The trigger button is
  // still mounted underneath the sheet the whole time (the spaces list
  // isn't unmounted while the sheet is open), so `.focus()` here is
  // synchronous — no need to wait for a re-render.
  const closeArchiveSheet = () => {
    setArchiveTarget(null);
    setMovePickerOpen(false);
    archiveTriggerRef.current?.focus();
    archiveTriggerRef.current = null;
  };

  // Escape order (R2 task 4 a11y fix): while the archive sheet is open, a
  // single Escape closes ONLY the sheet (inner-first) and must NOT also
  // close the outer manager in the same keypress. Once the sheet is
  // closed, the next Escape closes the outer dialog via `onClose`.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (archiveTarget) {
        closeArchiveSheet();
      } else {
        onClose?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveTarget, onClose]);

  const handleKeepUnscoped = async () => {
    if (!archiveTarget || !uid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reassignEntriesSpace(db, uid, archiveTarget.id, null);
      await archiveSpace(db, uid, archiveTarget.id);
      closeArchiveSheet();
    } catch (err) {
      setError(err?.message || 'Could not archive that space.');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveTo = async (toSpaceId) => {
    if (!archiveTarget || !uid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reassignEntriesSpace(db, uid, archiveTarget.id, toSpaceId);
      await archiveSpace(db, uid, archiveTarget.id);
      closeArchiveSheet();
    } catch (err) {
      setError(err?.message || 'Could not archive that space.');
    } finally {
      setBusy(false);
    }
  };

  const otherActiveSpaces = archiveTarget
    ? spaces.filter((s) => s.id !== archiveTarget.id)
    : [];
  const archiveSheetOpen = !!archiveTarget;

  return (
    <>
      <div
        className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]"
        role="dialog"
        aria-modal={archiveSheetOpen ? undefined : 'true'}
        aria-hidden={archiveSheetOpen ? 'true' : undefined}
        // React 18 (unlike 19) treats `inert` as a plain string-valued DOM
        // attribute, not a recognized boolean prop — passing `true` logs a
        // "non-boolean attribute" warning and renders nothing. Any string
        // value makes the attribute present (browsers key off presence, not
        // value, for `inert`), so pass `"true"` explicitly.
        inert={archiveSheetOpen ? 'true' : undefined}
        aria-labelledby="space-manager-title"
      >
        <div className="mx-auto max-w-xl space-y-5">
          <header className="flex items-start justify-between">
            <div>
              <p className="cloud-kicker">CONTEXT SPACES</p>
              <h2 id="space-manager-title" className="cloud-title text-3xl">Organize your journal</h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Group entries into spaces like Work or Personal, then scope Ask Journal to just one.
              </p>
            </div>
            <button type="button" className="cloud-icon-button" aria-label="Close space management" onClick={onClose}>
              <X size={21} />
            </button>
          </header>

          {error && (
            <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {spacesLoaded && spaces.length === 0 && (
            <section className="cloud-sheet rounded-2xl border p-4 shadow-sm">
              <p className="font-semibold">Get started with a few spaces</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Create Personal, Work, Family, and Health to sort entries as you go.
              </p>
              <Button onClick={handleSeed} disabled={seeding} className="mt-3">
                <Layers size={16} aria-hidden="true" />
                {seeding ? 'Creating…' : 'Create starter spaces'}
              </Button>
            </section>
          )}

          <section>
            <h3 className="cloud-kicker mb-2">YOUR SPACES</h3>
            <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
              {spaces.length === 0 ? (
                <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">No spaces yet.</p>
              ) : (
                spaces.map((space) => (
                  <div key={space.id} className="flex items-center gap-2 px-4 py-3">
                    {renamingId === space.id ? (
                      <>
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          aria-label={`Rename ${space.name}`}
                          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
                          maxLength={40}
                          autoFocus
                        />
                        <button
                          type="button"
                          aria-label="Save name"
                          onClick={() => commitRename(space.id)}
                          disabled={busy}
                          className="cloud-icon-button"
                        >
                          <Check size={18} />
                        </button>
                        <button type="button" aria-label="Cancel rename" onClick={cancelRename} className="cloud-icon-button">
                          <X size={18} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate font-medium">{space.name}</span>
                        <button
                          type="button"
                          aria-label={`Rename ${space.name}`}
                          onClick={() => startRename(space)}
                          className="cloud-icon-button"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Archive ${space.name}`}
                          onClick={(e) => openArchiveSheet(space, e.currentTarget)}
                          className="cloud-icon-button"
                        >
                          <Archive size={16} />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h3 className="cloud-kicker mb-2">NEW SPACE</h3>
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Work"
                aria-label="New space name"
                className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm"
                maxLength={40}
              />
              <Button type="submit" disabled={creating || !newName.trim()}>
                <Plus size={16} aria-hidden="true" />
                New space
              </Button>
            </form>
          </section>
        </div>
      </div>

      {/* Archive sheet: deliberately a SIBLING of the outer dialog above,
          not nested inside it. `aria-hidden` on an ancestor hides its
          entire subtree from the accessibility tree regardless of the
          descendant's own attributes — nesting the sheet inside the outer
          dialog would mean the outer's `aria-hidden="true"` (above) also
          hides this sheet, defeating the whole point of the fix. Keeping
          it a sibling lets the outer become inert/hidden while the sheet
          stays fully reachable as the one true modal. */}
      {archiveTarget && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-sheet-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="archive-sheet-title" className="mb-1 font-display font-bold text-lg text-foreground">
              Archive &ldquo;{archiveTarget.name}&rdquo;?
            </h3>
            <p className="mb-4 text-sm text-secondary-foreground">
              Entries in this space are never deleted. Choose what happens to them.
            </p>

            {movePickerOpen ? (
              <div className="space-y-1">
                {otherActiveSpaces.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No other active spaces to move entries to.</p>
                ) : (
                  otherActiveSpaces.map((space) => (
                    <button
                      key={space.id}
                      type="button"
                      onClick={() => handleMoveTo(space.id)}
                      disabled={busy}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-divider"
                    >
                      {space.name}
                    </button>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setMovePickerOpen(false)}
                  disabled={busy}
                  className="mt-2 block w-full rounded-lg px-3 py-2 text-left text-sm text-muted-foreground hover:bg-divider"
                >
                  Back
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={() => setMovePickerOpen(true)} disabled={busy} className="w-full">
                  Move entries to another space
                </Button>
                <Button variant="outline" onClick={handleKeepUnscoped} disabled={busy} className="w-full">
                  Keep entries unscoped
                </Button>
                <Button variant="ghost" onClick={closeArchiveSheet} disabled={busy} className="w-full">
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default SpaceManager;
