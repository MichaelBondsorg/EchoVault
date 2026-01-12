import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, TrendingUp, MessageSquare, ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import { generateDaySummary } from '../../services/analysis';

/**
 * DaySummaryModal - Shows detailed summary for a selected day
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

  // Early return AFTER all hooks
  if (!isOpen || !dayData) return null;

  // Format date nicely
  const formattedDate = date?.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // Get mood label
  const getMoodLabel = (score) => {
    if (score === null || score === undefined) return 'No mood data';
    if (score >= 0.7) return 'Great';
    if (score >= 0.5) return 'Good';
    if (score >= 0.3) return 'Okay';
    if (score >= 0.15) return 'Low';
    return 'Struggling';
  };

  const getMoodColor = (score) => {
    if (score === null || score === undefined) return 'text-warm-400';
    if (score >= 0.7) return 'text-mood-great';
    if (score >= 0.5) return 'text-mood-good';
    if (score >= 0.3) return 'text-mood-neutral';
    if (score >= 0.15) return 'text-mood-low';
    return 'text-mood-struggling';
  };

  // Format entry time
  const formatTime = (entry) => {
    const date = entry.effectiveDate || entry.createdAt;
    const d = date?.toDate?.() || new Date(date);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none"
            style={{ minHeight: '100dvh' }}
          >
            <motion.div
              className="
                w-full max-w-md max-h-[80vh]
                bg-white/95 backdrop-blur-xl
                border border-white/30
                rounded-3xl
                shadow-glass-lg
                overflow-hidden
                pointer-events-auto
                flex flex-col
              "
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25 }}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-warm-100">
                <div className="flex items-center gap-2">
                  <Calendar size={18} className="text-primary-500" />
                  <div>
                    <h2 className="font-display font-bold text-warm-800">
                      {formattedDate}
                    </h2>
                    <p className="text-xs text-warm-500">
                      {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-warm-100 transition-colors"
                >
                  <X size={20} className="text-warm-500" />
                </button>
              </div>

              {/* Content - scrollable */}
              <div
                className="flex-1 overflow-y-auto p-4 space-y-4"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {/* AI Summary */}
                <div className="bg-gradient-to-br from-primary-50 to-secondary-50 rounded-2xl p-3 border border-primary-100">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={14} className="text-primary-500" />
                    <span className="text-xs font-semibold text-primary-600 uppercase tracking-wide">
                      AI Summary
                    </span>
                  </div>
                  {summaryLoading && (
                    <div className="flex items-center gap-2 text-warm-500 text-sm py-2">
                      <Loader2 size={14} className="animate-spin" />
                      <span>Analyzing your day...</span>
                    </div>
                  )}
                  {summaryError && (
                    <p className="text-sm text-warm-500 italic">{summaryError}</p>
                  )}
                  {aiSummary?.summary && (
                    <p className="text-sm text-warm-700 leading-relaxed">
                      {aiSummary.summary}
                    </p>
                  )}
                  {!summaryLoading && !summaryError && !aiSummary?.summary && entries.length === 0 && (
                    <p className="text-sm text-warm-500 italic">No entries to summarize</p>
                  )}
                </div>

                {/* Overall Mood */}
                <div className="bg-warm-50 rounded-2xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-warm-600">Overall Mood</span>
                    <span className={`font-bold ${getMoodColor(mood)}`}>
                      {getMoodLabel(mood)}
                    </span>
                  </div>
                  {mood !== null && (
                    <div className="mt-2 h-2 bg-warm-200 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full ${
                          mood >= 0.7 ? 'bg-mood-great' :
                          mood >= 0.5 ? 'bg-mood-good' :
                          mood >= 0.3 ? 'bg-mood-neutral' :
                          mood >= 0.15 ? 'bg-mood-low' : 'bg-mood-struggling'
                        }`}
                        initial={{ width: 0 }}
                        animate={{ width: `${mood * 100}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  )}
                </div>

                {/* Mood Contributors */}
                {(moodContributors.positive.length > 0 || moodContributors.negative.length > 0) && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-warm-500 uppercase tracking-wide flex items-center gap-1">
                      <TrendingUp size={12} />
                      What shaped your day
                    </h3>
                    {moodContributors.positive.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {moodContributors.positive.map((item, i) => (
                          <span
                            key={i}
                            className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full"
                          >
                            + {item}
                          </span>
                        ))}
                      </div>
                    )}
                    {moodContributors.negative.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {moodContributors.negative.map((item, i) => (
                          <span
                            key={i}
                            className="px-2 py-1 bg-red-50 text-red-600 text-xs rounded-full"
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
                    <h3 className="text-xs font-semibold text-warm-500 uppercase tracking-wide">
                      Themes
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {themes.map((theme, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 bg-primary-50 text-primary-700 text-xs rounded-full"
                        >
                          {theme}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Entries List */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-warm-500 uppercase tracking-wide flex items-center gap-1">
                    <MessageSquare size={12} />
                    Entries
                  </h3>
                  <div className="space-y-2">
                    {entries.map((entry) => (
                      <motion.button
                        key={entry.id}
                        onClick={() => onEntryClick?.(entry)}
                        className="
                          w-full p-3 bg-white rounded-xl border border-warm-100
                          text-left hover:border-primary-200 hover:bg-primary-50/30
                          transition-colors group
                        "
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-warm-800 line-clamp-2">
                              {getEntryPreview(entry)}
                            </p>
                            <p className="text-xs text-warm-400 mt-1">
                              {formatTime(entry)}
                              {entry.analysis?.mood_score !== undefined && (
                                <span className={`ml-2 ${getMoodColor(entry.analysis.mood_score)}`}>
                                  {getMoodLabel(entry.analysis.mood_score)}
                                </span>
                              )}
                            </p>
                          </div>
                          <ChevronRight
                            size={16}
                            className="text-warm-300 group-hover:text-primary-500 transition-colors flex-shrink-0 mt-1"
                          />
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default DaySummaryModal;
