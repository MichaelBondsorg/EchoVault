import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Check, Calendar, Clock, Heart, Target, MessageCircle } from 'lucide-react';

/**
 * DetectedStrip - Shows extracted temporal signals for user confirmation
 *
 * Appears as a toast/banner after entry save, displaying signals grouped by day.
 * Users can confirm all, dismiss individual signals, or close the strip.
 */

// Format relative day label
const formatDayLabel = (targetDate, recordedAt) => {
  const target = new Date(targetDate);
  const recorded = new Date(recordedAt);

  // Normalize to start of day for comparison
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const recordedDay = new Date(recorded.getFullYear(), recorded.getMonth(), recorded.getDate());

  const diffDays = Math.round((targetDay - recordedDay) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays === -2) return '2 days ago';
  if (diffDays === 2) return 'In 2 days';
  if (diffDays < -2 && diffDays >= -7) return `${Math.abs(diffDays)} days ago`;
  if (diffDays > 2 && diffDays <= 7) return `In ${diffDays} days`;

  // For dates beyond a week, show the actual date
  return target.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// Get icon for signal type
const getSignalIcon = (type) => {
  switch (type) {
    case 'feeling': return <Heart size={12} className="text-rose-500" />;
    case 'event': return <Calendar size={12} className="text-blue-500" />;
    case 'plan': return <Target size={12} className="text-amber-500" />;
    case 'reflection': return <MessageCircle size={12} className="text-purple-500" />;
    default: return <Clock size={12} className="text-warm-500" />;
  }
};

// Get sentiment emoji/indicator
const getSentimentIndicator = (sentiment) => {
  const indicators = {
    positive: { emoji: '😊', color: 'text-emerald-500' },
    excited: { emoji: '🎉', color: 'text-amber-500' },
    hopeful: { emoji: '🌟', color: 'text-sky-500' },
    neutral: { emoji: '😐', color: 'text-warm-400' },
    anxious: { emoji: '😰', color: 'text-orange-500' },
    negative: { emoji: '😔', color: 'text-blue-500' },
    dreading: { emoji: '😨', color: 'text-purple-500' },
  };
  return indicators[sentiment] || indicators.neutral;
};

// Group signals by target day
const groupSignalsByDay = (signals, recordedAt) => {
  const groups = {};

  signals.forEach(signal => {
    const dayLabel = formatDayLabel(signal.targetDate, recordedAt);
    if (!groups[dayLabel]) {
      groups[dayLabel] = [];
    }
    groups[dayLabel].push(signal);
  });

  // Sort groups: Today first, then future days, then past days
  const sortedEntries = Object.entries(groups).sort(([a], [b]) => {
    const order = { 'Today': 0, 'Tomorrow': 1, 'Yesterday': -1 };
    const aOrder = order[a] ?? (a.startsWith('In') ? 2 : -2);
    const bOrder = order[b] ?? (b.startsWith('In') ? 2 : -2);
    return aOrder - bOrder;
  });

  return Object.fromEntries(sortedEntries);
};

const DetectedStrip = ({
  signals,
  recordedAt,
  onConfirmAll,
  onDismiss,
  onClose,
  className = ''
}) => {
  const groupedSignals = useMemo(() =>
    groupSignalsByDay(signals, recordedAt),
    [signals, recordedAt]
  );

  const hasNonTodaySignals = useMemo(() =>
    signals.some(s => formatDayLabel(s.targetDate, recordedAt) !== 'Today'),
    [signals, recordedAt]
  );

  if (!signals || signals.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className={`bg-white rounded-2xl shadow-xl border border-warm-200 overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-honey-50 to-lavender-50/30 border-b border-warm-100">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-honey-500" />
          <span className="text-sm font-medium text-warm-700">
            Detected in your entry
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-warm-100 transition-colors"
          aria-label="Close"
        >
          <X size={16} className="text-warm-400" />
        </button>
      </div>

      {/* Signal Groups */}
      <div className="px-4 py-3 space-y-3 max-h-64 overflow-y-auto">
        {Object.entries(groupedSignals).map(([dayLabel, daySignals]) => (
          <div key={dayLabel} className="space-y-1.5">
            {/* Day Label */}
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-semibold ${
                dayLabel === 'Today' ? 'text-warm-500' :
                dayLabel === 'Tomorrow' || dayLabel.startsWith('In') ? 'text-amber-600' :
                'text-blue-600'
              }`}>
                {dayLabel}
              </span>
              {dayLabel !== 'Today' && (
                <span className="text-[10px] text-warm-400">
                  ({daySignals.length})
                </span>
              )}
            </div>

            {/* Signals for this day */}
            <div className="flex flex-wrap gap-1.5">
              {daySignals.map((signal, idx) => {
                const sentiment = getSentimentIndicator(signal.sentiment);
                return (
                  <motion.div
                    key={signal.id || idx}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="inline-flex items-center gap-1.5 px-2 py-1 bg-warm-50 rounded-full border border-warm-200 group"
                  >
                    {getSignalIcon(signal.type)}
                    <span className="text-xs text-warm-700 max-w-[120px] truncate">
                      {signal.content}
                    </span>
                    <span className={`text-xs ${sentiment.color}`} title={signal.sentiment}>
                      {sentiment.emoji}
                    </span>
                    <button
                      onClick={() => onDismiss(signal.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-warm-200 transition-all"
                      aria-label="Dismiss signal"
                    >
                      <X size={10} className="text-warm-400" />
                    </button>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between px-4 py-3 bg-warm-50 border-t border-warm-100">
        <span className="text-xs text-warm-500">
          {hasNonTodaySignals
            ? 'These will appear on your calendar'
            : 'All signals are for today'}
        </span>
        <button
          onClick={onConfirmAll}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-honey-500 text-white text-xs font-medium rounded-full hover:bg-honey-600 transition-colors"
        >
          <Check size={12} />
          Looks right
        </button>
      </div>
    </motion.div>
  );
};

export default DetectedStrip;
