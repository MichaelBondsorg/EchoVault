import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Users, TrendingUp, TrendingDown, Minus, AlertTriangle, Pencil } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';

/**
 * PeopleSection - Collapsible section for @person: entities
 *
 * Shows people mentioned in entries with:
 * - Overall sentiment (positive/negative/mixed)
 * - Mood correlation (how they affect your mood)
 * - Shadow friction warnings (context-specific issues)
 */

const PeopleSection = ({ entries, category, shadowFriction = [], onEditPerson }) => {
  const people = useMemo(() => {
    const categoryEntries = entries.filter(e => e.category === category);

    // Extract all people from entries
    const personMap = new Map();

    categoryEntries.forEach(entry => {
      const personTags = entry.tags?.filter(t => t.startsWith('@person:')) || [];
      const entryMood = entry.analysis?.mood_score;
      const entryDate = entry.effectiveDate || entry.createdAt;
      const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

      // Get sentiment from entry analysis
      const sentimentByEntity = entry.analysis?.sentiment_by_entity || {};

      personTags.forEach(tag => {
        const personName = tag.replace('@person:', '').replace(/_/g, ' ');

        if (!personMap.has(personName)) {
          personMap.set(personName, {
            name: personName,
            tag: tag,
            mentionCount: 1,
            moods: entryMood !== null && entryMood !== undefined ? [entryMood] : [],
            lastMentioned: date,
            sentiments: []
          });
        } else {
          const existing = personMap.get(personName);
          existing.mentionCount++;
          if (entryMood !== null && entryMood !== undefined) {
            existing.moods.push(entryMood);
          }
          if (date > existing.lastMentioned) {
            existing.lastMentioned = date;
          }
        }

        // Track sentiment if available
        const sentiment = sentimentByEntity[tag];
        if (sentiment) {
          personMap.get(personName).sentiments.push(sentiment);
        }
      });
    });

    // Calculate mood correlation and overall sentiment
    const allMoods = categoryEntries
      .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
      .map(e => e.analysis.mood_score);
    const baselineMood = allMoods.length > 0
      ? allMoods.reduce((a, b) => a + b, 0) / allMoods.length
      : 0.5;

    return Array.from(personMap.values())
      .filter(p => p.mentionCount >= 2) // Only show people mentioned 2+ times
      .map(person => {
        // Calculate average mood when person is mentioned
        const avgMood = person.moods.length > 0
          ? person.moods.reduce((a, b) => a + b, 0) / person.moods.length
          : null;

        // Calculate mood delta vs baseline
        const moodDelta = avgMood !== null ? avgMood - baselineMood : null;
        const moodDeltaPercent = moodDelta !== null ? Math.round(moodDelta * 100) : null;

        // Determine overall sentiment
        let overallSentiment = 'neutral';
        if (person.sentiments.length > 0) {
          const positiveCount = person.sentiments.filter(s => s === 'positive').length;
          const negativeCount = person.sentiments.filter(s => s === 'negative').length;

          if (positiveCount > negativeCount * 2) {
            overallSentiment = 'positive';
          } else if (negativeCount > positiveCount * 2) {
            overallSentiment = 'negative';
          } else if (positiveCount > 0 && negativeCount > 0) {
            overallSentiment = 'mixed';
          }
        } else if (moodDeltaPercent !== null) {
          // Infer from mood correlation
          if (moodDeltaPercent > 10) overallSentiment = 'positive';
          else if (moodDeltaPercent < -10) overallSentiment = 'negative';
        }

        // Check for shadow friction
        const frictionPatterns = shadowFriction.filter(sf =>
          sf.primary?.toLowerCase() === person.tag.toLowerCase() ||
          sf.key?.toLowerCase().includes(person.name.toLowerCase())
        );

        return {
          ...person,
          avgMood,
          moodDelta,
          moodDeltaPercent,
          overallSentiment,
          hasFriction: frictionPatterns.length > 0,
          frictionPatterns
        };
      })
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 6);
  }, [entries, category, shadowFriction]);

  // Don't render if no people
  if (people.length === 0) return null;

  const getSentimentIcon = (sentiment) => {
    switch (sentiment) {
      case 'positive': return <TrendingUp size={12} className="text-sage-500 dark:text-sage-400" />;
      case 'negative': return <TrendingDown size={12} className="text-terra-400 dark:text-terra-300" />;
      case 'mixed': return <AlertTriangle size={12} className="text-honey-500 dark:text-honey-400" />;
      default: return <Minus size={12} className="text-warm-400" />;
    }
  };

  const getSentimentColor = (sentiment) => {
    switch (sentiment) {
      case 'positive': return 'bg-sage-50 dark:bg-sage-900/30 border-sage-200 dark:border-sage-800';
      case 'negative': return 'bg-terra-50 dark:bg-terra-900/30 border-terra-200 dark:border-terra-800';
      case 'mixed': return 'bg-honey-50 dark:bg-honey-900/30 border-honey-200 dark:border-honey-800';
      default: return 'bg-white dark:bg-hearth-900 border-warm-200 dark:border-warm-700';
    }
  };

  const formatDate = (date) => {
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return `${Math.floor(diffDays / 7)}w ago`;
  };

  return (
    <CollapsibleSection
      title="People"
      icon={Users}
      colorScheme="violet"
      defaultExpanded={false}
    >
      <div className="space-y-2">
        {people.map((person, index) => (
          <motion.div
            key={person.tag}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className={`p-3 rounded-xl border ${getSentimentColor(person.overallSentiment)}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                {getSentimentIcon(person.overallSentiment)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-lavender-800 dark:text-lavender-200 truncate capitalize">
                    {person.name}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-lavender-600 dark:text-lavender-400 mt-0.5">
                    <span>{person.mentionCount} mentions</span>
                    <span>·</span>
                    <span>last {formatDate(person.lastMentioned)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Mood delta badge */}
                {person.moodDeltaPercent !== null && Math.abs(person.moodDeltaPercent) > 5 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    person.moodDeltaPercent > 0
                      ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300'
                      : 'bg-terra-100 dark:bg-terra-900/40 text-terra-700 dark:text-terra-300'
                  }`}>
                    {person.moodDeltaPercent > 0 ? '+' : ''}{person.moodDeltaPercent}%
                  </span>
                )}

                {/* Edit button */}
                {onEditPerson && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditPerson(person);
                    }}
                    className="p-1.5 rounded-lg hover:bg-lavender-100 dark:hover:bg-lavender-900/40 transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} className="text-lavender-500 dark:text-lavender-400" />
                  </button>
                )}
              </div>
            </div>

            {/* Shadow friction warning */}
            {person.hasFriction && person.frictionPatterns.length > 0 && (
              <div className="mt-2 pt-2 border-t border-lavender-100 dark:border-lavender-800">
                <p className="text-xs text-honey-600 dark:text-honey-400 flex items-center gap-1">
                  <AlertTriangle size={10} />
                  {person.frictionPatterns[0].message || person.frictionPatterns[0].insight}
                </p>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </CollapsibleSection>
  );
};

export default PeopleSection;
