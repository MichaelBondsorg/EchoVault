import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * SourceList — the "cited entries" row list (date + excerpt + tap-to-expand),
 * extracted from `ReceiptSheet.jsx` (Task 11) so Task 17's `ReflectionDraft`
 * can reuse the exact same row treatment instead of re-implementing it.
 * `ReceiptSheet` itself now renders this component for its own Sources
 * section (see its `renderActions`/`footer` usage) — this file changes
 * behavior for neither consumer, it only moves the markup.
 *
 * Row shape: `{entryId, date, excerpt}` — the same normalized shape
 * `receipt.sources` already carries (ReceiptSheet) and that
 * `sourceFromEntry()` (`services/insights/receipts.js`) produces from a raw
 * journal entry (ReflectionDraft, which only has entry ids on a block, not
 * a pre-built receipt).
 *
 * Tap-to-expand is synchronous-only, same v1 scope note as the original:
 * `entriesById` is whatever the caller already has in memory — a missing
 * entry just means no expand affordance, never a fetch/crash. Expand state
 * is owned internally (one row open at a time) so every consumer gets it
 * for free.
 *
 * `renderActions(source)`, when provided, renders per-source actions (e.g.
 * ReceiptSheet's "Wrong source" / "Exclude source" buttons) below each row.
 * Omit it for a read-only list (ReflectionDraft's usage: no per-source
 * repair actions in v1).
 */
function formatSourceDate(iso) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  // `timeZone: 'UTC'` mirrors ReceiptSheet's original formatDate: source
  // dates are ISO/UTC instants, and formatting in the host's local
  // timezone can shift the displayed calendar day by +/-1 depending on
  // viewer/CI timezone.
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const SourceList = ({
  sources = [],
  entriesById = {},
  emptyMessage = 'No individual entries cited.',
  renderActions,
  footer,
}) => {
  const [expandedSourceId, setExpandedSourceId] = useState(null);

  if (!sources || sources.length === 0) {
    return <p className="mt-1 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="mt-2 space-y-2">
      {sources.map((source) => {
        const fullEntry = entriesById?.[source.entryId];
        const isExpanded = expandedSourceId === source.entryId;
        const sourceDate = formatSourceDate(source.date);
        return (
          <div key={source.entryId} className="rounded-xl border border-border bg-background p-3">
            <button
              type="button"
              onClick={() => setExpandedSourceId(isExpanded ? null : source.entryId)}
              className="flex w-full items-start justify-between gap-2 text-left"
            >
              <div className="min-w-0 flex-1">
                {sourceDate && (
                  <p className="text-xs text-muted-foreground">{sourceDate}</p>
                )}
                <p className="mt-0.5 text-sm text-secondary-foreground break-words">
                  {source.excerpt || 'No excerpt available'}
                </p>
              </div>
              {fullEntry && (
                isExpanded ? (
                  <ChevronUp size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronDown size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )
              )}
            </button>

            {isExpanded && fullEntry && (
              <p className="mt-2 whitespace-pre-line border-t border-divider pt-2 text-sm text-secondary-foreground">
                {fullEntry.content || fullEntry.text}
              </p>
            )}

            {renderActions && (
              <div className="mt-2 flex items-center gap-4">
                {renderActions(source)}
              </div>
            )}
          </div>
        );
      })}
      {footer}
    </div>
  );
};

export default SourceList;
