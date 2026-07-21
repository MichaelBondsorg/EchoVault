import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { generateDailySynthesis } from '../../utils/synthesis';

/**
 * DailySummaryModal — restyle only (Task 6, Cloud migration). Kept as its
 * own centered-overlay structure (NOT moved onto the cloud `Drawer` — that's
 * the *other*, already-migrated `zen/DaySummaryModal.jsx`); scrim via
 * `bg-[var(--overlay)]`, same precedent as CrisisSoftBlockModal.jsx. The
 * entry-type badge drops `colorMap.js`'s `getEntryTypeColors()` per-type hue
 * coding for the single neutral Cloud badge treatment established by
 * EntryCard.jsx (bg-divider/text-secondary-foreground) — per Cloud spec
 * §3's "ONE user-selectable accent" precedent. All props/handlers
 * (onClose/onDelete/onUpdate) and content/behavior are unchanged.
 */
const DailySummaryModal = ({ date, dayData, onClose, onDelete, onUpdate }) => {
  const [synthesis, setSynthesis] = useState(null);
  const [loadingSynthesis, setLoadingSynthesis] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadSynthesis = async () => {
      if (dayData.entries.length > 0) {
        const result = await generateDailySynthesis(dayData.entries);
        if (isMounted) {
          setSynthesis(result);
        }
      }
      if (isMounted) {
        setLoadingSynthesis(false);
      }
    };

    loadSynthesis();

    return () => {
      isMounted = false;
    };
  }, [dayData.entries]);

  const sortedEntries = [...dayData.entries].sort((a, b) => a.createdAt - b.createdAt);

  const getMoodEmoji = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 0.75) return '😊';
    if (score >= 0.55) return '🙂';
    if (score >= 0.35) return '😐';
    if (score >= 0.15) return '😟';
    return '😢';
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.3 }}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-card shadow-soft-lg"
      >
        <div className="border-b border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="cloud-title text-xl text-foreground">{date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              <p className="text-sm text-muted-foreground">{dayData.entries.length} entries {dayData.volatility > 0.3 && <span className="text-accent">(high mood volatility)</span>}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close daily summary"
              className="cloud-icon-button"
            >
              <X size={24} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {loadingSynthesis ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-accent-wash p-4">
              <Loader2 size={18} className="animate-spin text-accent-deep" />
              <span className="text-sm text-secondary-foreground font-body">Generating daily summary...</span>
            </div>
          ) : synthesis && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-border bg-accent-wash p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-display font-semibold uppercase text-accent-deep">
                <Sparkles size={14} /> Daily Summary
              </div>
              <p className="text-sm leading-relaxed text-secondary-foreground font-body">
                {typeof synthesis === 'string' ? synthesis : synthesis.summary}
              </p>
              {synthesis.bullets && synthesis.bullets.length > 0 && (
                <div className="mt-3 border-t border-divider pt-3">
                  <p className="mb-2 text-xs font-display font-semibold uppercase tracking-wide text-accent-deep">
                    Key mood drivers
                  </p>
                  <ul className="list-inside list-disc space-y-1 text-sm text-secondary-foreground font-body">
                    {synthesis.bullets.map((bullet, idx) => (
                      <li key={idx}>{typeof bullet === 'string' ? bullet : bullet.text || JSON.stringify(bullet)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          )}

          {sortedEntries.map((entry, index) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="rounded-2xl border border-border p-4 transition-shadow hover:shadow-soft"
            >
              <div className="mb-2 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-faint">{entry.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {entry.entry_type && entry.entry_type !== 'reflection' && (
                    // Entry-type badge: single neutral Cloud badge treatment
                    // (spec favors ONE accent over per-type hue coding) —
                    // matches EntryCard.jsx's precedent, not colorMap.js.
                    <span className="rounded-full bg-divider px-2 py-0.5 text-[10px] font-display font-bold uppercase tracking-wide text-secondary-foreground">{entry.entry_type}</span>
                  )}
                  {typeof entry.analysis?.mood_score === 'number' && (
                    <span className="text-lg">{getMoodEmoji(entry.analysis.mood_score)}</span>
                  )}
                </div>
                <button onClick={() => onDelete(entry.id)} className="text-faint hover:text-red-400"><Trash2 size={14} /></button>
              </div>
              <h4 className="mb-1 font-display font-semibold text-foreground">{entry.title}</h4>
              <p className="line-clamp-3 text-sm text-secondary-foreground font-body">{entry.text}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default DailySummaryModal;
