import { useState } from 'react';
import { MoreVertical, Check, X } from 'lucide-react';
import { SectionLabel } from '../cloud';
import { useDismissablePopover } from '../../hooks/useDismissablePopover';

/**
 * ChapterHeader — Voice Chapters UI (R2 Task 15, flag: voiceChapters).
 *
 * Renders one chapter's heading above its text slice: an mm:ss timestamp
 * (derived from `startMs`) + title, styled with the shared Cloud
 * `SectionLabel` type role. Also owns the per-chapter overflow menu
 * (Rename / Merge with previous / Remove marker) — all three actions are
 * pure UI here; EntryCard owns the actual `transcription.chapters` array
 * mutation + updateDoc payload (this component only calls back).
 *
 * "Merge with previous" is omitted entirely for the first chapter (there is
 * no previous chapter to merge into) — EntryCard maps "Remove marker" on the
 * first chapter to a forward-merge instead, so the option set here stays a
 * straightforward isFirst gate.
 *
 * All interactive targets are 44px (`cloud-icon-button` for icon buttons,
 * `min-h-11` for menu rows) per Cloud spec.
 */
function formatChapterTime(startMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(startMs) || 0) / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

const ChapterHeader = ({ chapter, isFirst, onRename, onMergeWithPrevious, onRemove }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(chapter.title || '');
  const menuRef = useDismissablePopover(menuOpen, () => setMenuOpen(false));

  const startRename = () => {
    setDraftTitle(chapter.title || '');
    setRenaming(true);
    setMenuOpen(false);
  };

  const commitRename = () => {
    const next = draftTitle.trim();
    setRenaming(false);
    if (next && next !== chapter.title) {
      onRename(next);
    }
  };

  const cancelRename = () => {
    setDraftTitle(chapter.title || '');
    setRenaming(false);
  };

  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      {renaming ? (
        <div className="flex items-center gap-2 flex-1">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') cancelRename();
            }}
            autoFocus
            aria-label="Chapter title"
            className="flex-1 min-w-0 text-[11px] font-semibold uppercase tracking-[0.1em] bg-transparent border-b border-accent focus:outline-none text-foreground"
          />
          <button
            type="button"
            aria-label="Save chapter title"
            onClick={commitRename}
            className="cloud-icon-button text-accent-deep"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            aria-label="Cancel rename"
            onClick={cancelRename}
            className="cloud-icon-button text-muted-foreground"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <SectionLabel className="flex items-center gap-2 min-w-0">
          <span className="tabular-nums">{formatChapterTime(chapter.startMs)}</span>
          <span className="truncate normal-case tracking-normal">{chapter.title || 'Untitled'}</span>
        </SectionLabel>
      )}

      {!renaming && (
        <div className="relative flex-none" ref={menuRef}>
          <button
            type="button"
            aria-label="Chapter actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="cloud-icon-button text-muted-foreground"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-1 min-w-[190px] rounded-xl border border-border bg-card p-1 shadow-md"
            >
              <button
                type="button"
                role="menuitem"
                onClick={startRename}
                className="flex w-full min-h-11 items-center rounded-lg px-3 text-sm text-secondary-foreground hover:bg-divider"
              >
                Rename
              </button>
              {!isFirst && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onMergeWithPrevious();
                  }}
                  className="flex w-full min-h-11 items-center rounded-lg px-3 text-sm text-secondary-foreground hover:bg-divider"
                >
                  Merge with previous
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onRemove();
                }}
                className="flex w-full min-h-11 items-center rounded-lg px-3 text-sm text-red-600 hover:bg-divider dark:text-red-400"
              >
                Remove marker
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ChapterHeader;
