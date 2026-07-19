import { useState, useMemo, useEffect } from 'react';
import { Calendar, TrendingUp, MessageSquare, ChevronRight, Sparkles, Loader2, X } from 'lucide-react';
import { generateDaySummary } from '../../services/analysis';
import { Drawer, DrawerContent, DrawerDescription } from '../cloud';

/**
 * DaySummaryModal (CLOUD-DESIGN-SPEC.md §5/§7 "Day summary" — mockup 7m):
 * cloud `Drawer` bottom sheet. Shows detailed summary for a selected day.
 *
 * Features:
 * - List of all entries for that day
 * - Summary of themes/topics
 * - Mood contributors
 * - Click into individual entries
 */
const DaySummaryModal = ({
  isOpen,
  onClose,
  date,
  dayData,
  onEntryClick,
}) => {
  // AI Summary state
  const [aiSummary, setAiSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  // Extract entries safely for hooks (before early return)
  const entries = dayData?.entries || [];
  const mood = dayData?.mood;

  // Extract themes from entries - MUST be before early return
  const themes = useMemo(() => {
    if (!entries || entries.length === 0) return [];
    const allThemes = [];
    entries.forEach(entry => {
      if (entry.analysis?.themes) {
        allThemes.push(...entry.analysis.themes);
      }
      if (entry.contextualInsight?.briefSummary) {
        allThemes.push(entry.contextualInsight.briefSummary);
      }
    });
    return [...new Set(allThemes)].slice(0, 5);
  }, [entries]);

  // Extract mood contributors - MUST be before early return
  const moodContributors = useMemo(() => {
    if (!entries || entries.length === 0) return { positive: [], negative: [] };
    const contributors = { positive: [], negative: [] };
    entries.forEach(entry => {
      const score = entry.analysis?.mood_score;
      const summary = entry.contextualInsight?.briefSummary || entry.analysis?.themes?.[0];
      if (summary) {
        if (score >= 0.5) {
          contributors.positive.push(summary);
        } else if (score < 0.4) {
          contributors.negative.push(summary);
        }
      }
    });
    return {
      positive: [...new Set(contributors.positive)].slice(0, 3),
      negative: [...new Set(contributors.negative)].slice(0, 3),
    };
  }, [entries]);

  // Fetch AI summary when modal opens
  useEffect(() => {
    if (isOpen && entries.length > 0 && !aiSummary && !summaryLoading) {
      setSummaryLoading(true);
      setSummaryError(null);

      generateDaySummary(entries)
        .then((result) => {
          setAiSummary(result);
          setSummaryLoading(false);
        })
        .catch((error) => {
          console.error('Failed to generate day summary:', error);
          setSummaryError('Unable to generate summary');
          setSummaryLoading(false);
        });
    }
  }, [isOpen, entries, aiSummary, summaryLoading]);

  // Reset summary when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAiSummary(null);
      setSummaryLoading(false);
      setSummaryError(null);
    }
  }, [isOpen]);

  // Format date nicely
  const formattedDate = date?.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Mood label + accent-scale color (same 4-bucket scale as EntryCard's
  // mood dot / QuickLogModal — CLOUD-DESIGN-SPEC.md §7 Journal note).
  const getMoodLabel = (score) => {
    if (score === null || score === undefined) return 'No mood data';
    if (score >= 0.7) return 'Great';
    if (score >= 0.5) return 'Good';
    if (score >= 0.3) return 'Okay';
    if (score >= 0.15) return 'Low';
    return 'Struggling';
  };

  const getMoodColor = (score) => {
    if (score === null || score === undefined) return 'var(--muted-foreground)';
    if (score >= 0.75) return 'var(--accent-4)';
    if (score >= 0.5) return 'var(--accent-3)';
    if (score >= 0.25) return 'var(--accent-2)';
    return 'var(--accent-1)';
  };

  // Format entry time
  const formatTime = (entry) => {
    const d = entry.effectiveDate || entry.createdAt;
    const parsed = d?.toDate?.() || new Date(d);
    return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  // Get entry preview
  const getEntryPreview = (entry) => {
    if (entry.contextualInsight?.briefSummary) {
      return entry.contextualInsight.briefSummary;
    }
    if (entry.analysis?.themes?.length > 0) {
      return entry.analysis.themes.join(', ');
    }
    if (entry.text) {
      return entry.text.substring(0, 80) + (entry.text.length > 80 ? '...' : '');
    }
    return 'Voice entry';
  };

  // Early return AFTER all hooks
  if (!dayData) return null;

  return (
    <Drawer open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent aria-labelledby="day-summary-title" className="sm:mx-auto sm:max-w-xl">
        <DrawerDescription className="sr-only">
          Summary of your entries, mood, and themes for {formattedDate || 'the selected day'}.
        </DrawerDescription>

        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar size={18} className="text-accent-deep" aria-hidden="true" />
            <div>
              <h2 id="day-summary-title" className="cloud-title text-lg text-foreground">
                {formattedDate}
              </h2>
              <p className="text-xs text-muted-foreground">
                {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="cloud-icon-button"
            aria-label="Close day summary"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Content - scrollable */}
        <div
          className="max-h-[65vh] space-y-4 overflow-y-auto"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {/* AI Summary */}
          <div className="rounded-2xl border border-border bg-accent-wash p-3">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={14} className="text-accent-deep" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wide text-accent-deep">
                AI Summary
              </span>
            </div>
            {summaryLoading && (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                <span>Analyzing your day...</span>
              </div>
            )}
            {summaryError && (
              <p className="text-sm italic text-muted-foreground">{summaryError}</p>
            )}
            {aiSummary?.summary && (
              <p className="text-sm leading-relaxed text-secondary-foreground">
                {aiSummary.summary}
              </p>
            )}
            {!summaryLoading && !summaryError && !aiSummary?.summary && entries.length === 0 && (
              <p className="text-sm italic text-muted-foreground">No entries to summarize</p>
            )}
          </div>

          {/* Overall Mood */}
          <div className="rounded-2xl border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-secondary-foreground">Overall Mood</span>
              <span className="font-bold" style={{ color: getMoodColor(mood) }}>
                {getMoodLabel(mood)}
              </span>
            </div>
            {mood !== null && mood !== undefined && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-divider">
                <div
                  className="h-full transition-[width] duration-500"
                  style={{ width: `${mood * 100}%`, background: getMoodColor(mood) }}
                />
              </div>
            )}
          </div>

          {/* Mood Contributors */}
          {(moodContributors.positive.length > 0 || moodContributors.negative.length > 0) && (
            <div className="space-y-2">
              <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <TrendingUp size={12} aria-hidden="true" />
                What shaped your day
              </h3>
              {moodContributors.positive.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {moodContributors.positive.map((item, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-accent-wash px-2 py-1 text-xs text-accent-deep"
                    >
                      + {item}
                    </span>
                  ))}
                </div>
              )}
              {moodContributors.negative.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {moodContributors.negative.map((item, i) => (
                    // Warning/low-mood color kept as red-*, matching the
                    // EntryCard (C4) / InsightsPage (C5) precedent of
                    // leaving health-warning reds outside the accent
                    // collapse (@color-safe: intentional semantic red, not
                    // a banned legacy palette class).
                    <span
                      key={i}
                      className="rounded-full bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-300"
                    >
                      - {item}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Themes */}
          {themes.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Themes
              </h3>
              <div className="flex flex-wrap gap-1">
                {themes.map((theme, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-accent-wash px-2 py-1 text-xs text-accent-deep"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Entries List */}
          <div className="space-y-2">
            <h3 className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessageSquare size={12} aria-hidden="true" />
              Entries
            </h3>
            <div className="space-y-2">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onEntryClick?.(entry)}
                  className="group w-full rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-accent hover:bg-accent-wash"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm text-foreground">
                        {getEntryPreview(entry)}
                      </p>
                      <p className="mt-1 text-xs text-faint">
                        {formatTime(entry)}
                        {entry.analysis?.mood_score !== undefined && (
                          <span
                            className="ml-2"
                            style={{ color: getMoodColor(entry.analysis.mood_score) }}
                          >
                            {getMoodLabel(entry.analysis.mood_score)}
                          </span>
                        )}
                      </p>
                    </div>
                    <ChevronRight
                      size={16}
                      className="mt-1 shrink-0 text-faint transition-colors group-hover:text-accent-deep"
                      aria-hidden="true"
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default DaySummaryModal;
