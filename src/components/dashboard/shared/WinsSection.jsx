import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Calendar, Star } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';

/**
 * WinsSection - Collapsible section for wins/accomplishments
 *
 * Shows wins from completed tasks and journal entries
 * Collapsed view shows count: "5 wins this week"
 * Expanded view shows list with dates and linked goals
 */

const WinsSection = ({ wins = [], daySummary, timeRange = 'week' }) => {
  // Combine wins from different sources
  const allWins = useMemo(() => {
    const combinedWins = [];

    // Add wins from day summary
    if (daySummary?.wins?.items) {
      daySummary.wins.items.forEach((win, i) => {
        combinedWins.push({
          id: `summary-${i}`,
          text: typeof win === 'string' ? win : win.text,
          date: new Date(),
          source: 'summary',
          relatedGoal: win.relatedGoal || null
        });
      });
    }

    // Add wins passed directly
    wins.forEach((win, i) => {
      const winObj = typeof win === 'string' ? { text: win } : win;
      combinedWins.push({
        id: win.id || `win-${i}`,
        text: winObj.text || winObj.message,
        date: winObj.date || winObj.completedAt || new Date(),
        source: winObj.source || 'task',
        relatedGoal: winObj.relatedGoal || null
      });
    });

    // Sort by date (most recent first)
    return combinedWins.sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateB - dateA;
    }).slice(0, 10);
  }, [wins, daySummary]);

  // Don't render if no wins
  if (allWins.length === 0) return null;

  const formatDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Calculate time-based count text
  const getCountText = () => {
    const count = allWins.length;
    if (timeRange === 'today') {
      return `${count} win${count !== 1 ? 's' : ''} today`;
    }
    return `${count} win${count !== 1 ? 's' : ''} this week`;
  };

  return (
    <CollapsibleSection
      title="Wins"
      icon={Trophy}
      collapsedContent={getCountText()}
      colorScheme="amber"
      defaultExpanded={false}
    >
      <div className="space-y-2">
        {allWins.map((win, index) => (
          <motion.div
            key={win.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="p-3 rounded-xl bg-white/60 border border-amber-100"
          >
            <div className="flex items-start gap-2">
              <Star size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-amber-800">
                  {win.text}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <Calendar size={10} />
                    {formatDate(win.date)}
                  </span>
                  {win.relatedGoal && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      {win.relatedGoal}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </CollapsibleSection>
  );
};

export default WinsSection;
