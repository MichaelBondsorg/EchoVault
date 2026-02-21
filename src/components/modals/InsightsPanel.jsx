import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, TrendingDown, TrendingUp, AlertTriangle, Heart, Calendar,
  Sparkles, BarChart3, Loader2, Sun, Cloud, Target,
  AlertOctagon, Zap, Clock, Users, MessageSquare, AlertCircle
} from 'lucide-react';
import { analyzeLongitudinalPatterns } from '../../services/safety';
import { getAllPatterns, getRotatedInsights, markInsightShown } from '../../services/nexus/compat';
import { addToExclusionList, getActiveExclusions } from '../../services/signals/signalLifecycle';
import { getPatternTypeColors } from '../../utils/colorMap';

const InsightsPanel = ({ entries, userId, category, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [cachedPatterns, setCachedPatterns] = useState(null);
  const [source, setSource] = useState(null);
  const [dismissedPatterns, setDismissedPatterns] = useState(new Set());
  const [dismissingPattern, setDismissingPattern] = useState(null); // Pattern being dismissed

  // Load cached patterns and exclusions from Firestore
  useEffect(() => {
    const loadPatternsAndExclusions = async () => {
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        // Load exclusions first to pre-populate dismissed state
        const exclusions = await getActiveExclusions(userId);
        const excludedKeys = new Set(
          exclusions.map(exc => {
            // Reconstruct the pattern key from exclusion context
            const entity = exc.context?.entity || '';
            const message = exc.context?.message || '';
            return `${exc.patternType}:${entity}:${message.slice(0, 50)}`;
          })
        );
        setDismissedPatterns(excludedKeys);

        // Then load patterns
        const result = await getAllPatterns(userId, entries, category);
        setCachedPatterns(result);
        setSource(result.source);
      } catch (error) {
        console.error('Failed to load cached patterns:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPatternsAndExclusions();
  }, [userId, entries, category]);

  // Fallback to client-side patterns if no cached data
  const clientPatterns = useMemo(() => analyzeLongitudinalPatterns(entries), [entries]);

  // Apply rotation to activity patterns for varied display order
  const rotatedActivityPatterns = useMemo(() => {
    if (!cachedPatterns?.activitySentiment?.length || !userId) {
      return cachedPatterns?.activitySentiment || [];
    }

    // Convert to insight format for rotation
    const insightsForRotation = cachedPatterns.activitySentiment
      .filter(p => p.insight)
      .map(p => ({
        ...p,
        type: p.sentiment === 'positive' ? 'positive_activity' : 'negative_activity',
        message: p.insight
      }));

    // Get rotated order
    return getRotatedInsights(userId, category, insightsForRotation, 10);
  }, [cachedPatterns?.activitySentiment, userId, category]);

  const getPatternIcon = (type) => {
    const colors = getPatternTypeColors(type);
    const iconClass = colors.text;
    switch (type) {
      // Temporal patterns
      case 'weekly_low': return <TrendingDown size={16} className="text-accent" />;
      case 'weekly_high': return <TrendingUp size={16} className="text-mood-great" />;
      case 'best_day': return <Sun size={16} className={iconClass} />;
      case 'worst_day': return <Cloud size={16} className={iconClass} />;
      // Activity sentiment
      case 'positive_activity': return <TrendingUp size={16} className={iconClass} />;
      case 'negative_activity': return <TrendingDown size={16} className={iconClass} />;
      // Shadow friction (entity + context intersections)
      case 'shadow_friction': return <Users size={16} className={iconClass} />;
      // Absence warnings (pre-emptive)
      case 'absence_warning': return <AlertCircle size={16} className={iconClass} />;
      // Linguistic shifts (self-talk)
      case 'linguistic_shift': return <MessageSquare size={16} className={iconClass} />;
      // Trigger patterns
      case 'trigger_correlation': return <AlertTriangle size={16} className={iconClass} />;
      case 'trigger': return <Zap size={16} className={iconClass} />;
      // Contradiction types
      case 'goal_abandonment': return <Target size={16} className={iconClass} />;
      case 'sentiment_contradiction': return <AlertOctagon size={16} className={iconClass} />;
      case 'avoidance_contradiction': return <Clock size={16} className={iconClass} />;
      // Other
      case 'recovery_pattern': return <Heart size={16} className={iconClass} />;
      case 'monthly_summary': return <Calendar size={16} className="text-lavender-500" />;
      default: return <Sparkles size={16} className="text-lavender-500" />;
    }
  };

  const getPatternColor = (type) => {
    // weekly_low has a special border weight
    if (type === 'weekly_low') return 'bg-lavender-50 border-lavender-400 dark:bg-lavender-900/30 dark:border-lavender-700';
    const colors = getPatternTypeColors(type);
    return `${colors.bg} ${colors.border}`;
  };

  // Generate a unique key for a pattern (for dismissal tracking)
  // Uses multiple fields to avoid collision when messages start similarly
  const getPatternKey = (pattern) => {
    const type = pattern.type || 'unknown';
    const entity = pattern.entity || pattern.entityName || '';
    const message = pattern.message || pattern.insight || '';
    const category = pattern.category || '';

    // Create a simple hash from the full message to avoid collisions
    const msgHash = message.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0).toString(36);

    return `${type}:${entity}:${category}:${msgHash}`;
  };

  // Show dismiss options for a pattern
  const handleShowDismissOptions = (pattern, patternKey) => {
    setDismissingPattern({ pattern, patternKey });
  };

  // Handle pattern dismissal with permanent option
  const handleDismissPattern = async (permanent = false) => {
    if (!dismissingPattern) return;

    const { pattern, patternKey } = dismissingPattern;

    // Immediately hide from UI
    setDismissedPatterns(prev => new Set([...prev, patternKey]));
    setDismissingPattern(null);

    // Persist to exclusions if userId available
    if (userId) {
      try {
        await addToExclusionList(userId, {
          patternType: pattern.type,
          context: {
            entity: pattern.entity,
            message: (pattern.message || pattern.insight || '').slice(0, 100)
          },
          reason: 'user_dismissed',
          permanent
        });
      } catch (error) {
        console.error('Failed to persist pattern dismissal:', error);
      }
    }
  };

  // Helper to render a pattern card with dismiss button
  const PatternCard = ({ pattern, index }) => {
    const patternKey = getPatternKey(pattern);
    const isBeingDismissed = dismissingPattern?.patternKey === patternKey;

    // Don't render if dismissed
    if (dismissedPatterns.has(patternKey)) return null;

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -20, height: 0 }}
        transition={{ delay: index * 0.03 }}
        className={`p-4 rounded-2xl border ${getPatternColor(pattern.type)} relative group`}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{getPatternIcon(pattern.type)}</div>
          <div className="flex-1">
            <p className="text-sm font-medium text-warm-800 font-body">{pattern.message || pattern.insight}</p>
            {pattern.entity && (
              <p className="text-xs text-warm-600 mt-1 font-medium">{pattern.entity}</p>
            )}
            {pattern.type === 'trigger_correlation' && (
              <p className="text-xs text-warm-500 mt-1">Based on {Math.round(pattern.percentDiff)}% mood difference</p>
            )}
            {pattern.type === 'recovery_pattern' && (
              <p className="text-xs text-warm-500 mt-1">Based on {pattern.samples} recovery instances</p>
            )}
            {pattern.confidence && (
              <p className="text-xs text-warm-400 mt-1">{Math.round(pattern.confidence * 100)}% confidence</p>
            )}

            {/* Dismiss options - shown when dismissing this pattern */}
            {isBeingDismissed && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-3 pt-3 border-t border-warm-200 space-y-2"
              >
                <p className="text-xs text-warm-600 font-medium">Hide this insight?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDismissPattern(false)}
                    className="px-3 py-1.5 text-xs bg-warm-100 hover:bg-warm-200 text-warm-700 rounded-lg transition-colors"
                  >
                    Hide for 30 days
                  </button>
                  <button
                    onClick={() => handleDismissPattern(true)}
                    className="px-3 py-1.5 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors"
                  >
                    Never show again
                  </button>
                  <button
                    onClick={() => setDismissingPattern(null)}
                    className="px-3 py-1.5 text-xs text-warm-500 hover:text-warm-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </div>

          {/* Dismiss button - visible on hover, hidden when showing options */}
          {!isBeingDismissed && (
            <button
              onClick={() => handleShowDismissOptions(pattern, patternKey)}
              className="absolute top-2 right-2 p-1.5 rounded-full opacity-0 group-hover:opacity-100 hover:bg-white/70 transition-all text-warm-400 hover:text-warm-600"
              aria-label="Dismiss this insight"
              title="Not useful? Click to hide"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  // Section header component
  const SectionHeader = ({ icon: Icon, title, color }) => (
    <div className={`flex items-center gap-2 mt-4 mb-2 ${color}`}>
      <Icon size={14} />
      <h3 className="text-xs font-display font-semibold uppercase tracking-wide">{title}</h3>
    </div>
  );

  // Determine what to show
  const hasActivityPatterns = cachedPatterns?.activitySentiment?.length > 0;
  const hasTemporalPatterns = cachedPatterns?.temporal?.insights;
  const hasContradictions = cachedPatterns?.contradictions?.length > 0;
  const hasShadowFriction = cachedPatterns?.shadowFriction?.length > 0;
  const hasAbsenceWarnings = cachedPatterns?.absenceWarnings?.length > 0;
  const hasLinguisticShifts = cachedPatterns?.linguisticShifts?.length > 0;
  const hasSummary = cachedPatterns?.summary?.length > 0;
  const hasCachedContent = hasActivityPatterns || hasTemporalPatterns || hasContradictions || hasShadowFriction || hasAbsenceWarnings || hasLinguisticShifts || hasSummary;
  const hasAnyContent = hasCachedContent || clientPatterns.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.3 }}
        className="bg-white dark:bg-hearth-900 rounded-3xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col shadow-soft-lg"
      >
        <div className="p-6 border-b border-honey-100 bg-gradient-to-r from-honey-500 to-honey-600 text-white">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-display font-bold flex items-center gap-2"><BarChart3 size={20} /> Your Patterns</h2>
              <p className="text-sm opacity-80 mt-1 font-body">Insights from your journal entries</p>
            </div>
            <motion.button
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className="text-white/80 hover:text-white"
            >
              <X size={24} />
            </motion.button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-warm-400">
              <Loader2 className="animate-spin mb-2" size={24} />
              <span className="text-sm font-body">Loading patterns...</span>
            </div>
          ) : !hasAnyContent ? (
            <div className="text-center py-12">
              <div className="h-20 w-20 bg-warm-100 dark:bg-hearth-850 rounded-full flex items-center justify-center mx-auto mb-4">
                <BarChart3 size={32} className="text-warm-400" />
              </div>
              <h3 className="text-lg font-display font-medium text-warm-800">Not enough data yet</h3>
              <p className="text-sm text-warm-500 mt-2 font-body">Keep journaling! Patterns will appear after you have at least 5-7 entries with mood data.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Summary insights (top-level) */}
              {hasSummary && (
                <>
                  <SectionHeader icon={Sparkles} title="Key Insights" color="text-lavender-600" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-2">
                      {cachedPatterns.summary.map((insight, i) => (
                        <PatternCard key={`summary-${i}`} pattern={insight} index={i} />
                      ))}
                    </div>
                  </AnimatePresence>
                </>
              )}

              {/* Absence Warnings - Pre-emptive alerts */}
              {hasAbsenceWarnings && (
                <>
                  <SectionHeader icon={AlertCircle} title="Heads Up" color="text-honey-600 dark:text-honey-400" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-2">
                      {cachedPatterns.absenceWarnings.slice(0, 3).map((warning, i) => (
                        <PatternCard
                          key={`absence-${warning.entity || i}`}
                          pattern={{
                            type: 'absence_warning',
                            message: warning.message,
                            entity: warning.entityName,
                            confidence: warning.absenceCorrelation
                          }}
                          index={i}
                        />
                      ))}
                    </div>
                  </AnimatePresence>
                </>
              )}

              {/* Linguistic Shifts - Self-talk changes */}
              {hasLinguisticShifts && (
                <>
                  <SectionHeader icon={MessageSquare} title="Your Self-Talk" color="text-lavender-600 dark:text-lavender-400" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-2">
                      {cachedPatterns.linguisticShifts.slice(0, 3).map((shift, i) => (
                        <PatternCard
                          key={`linguistic-${shift.category || i}`}
                          pattern={{
                            type: 'linguistic_shift',
                            message: shift.message,
                            entity: shift.category,
                            confidence: shift.changePercent > 30 ? 0.85 : 0.7
                          }}
                          index={i}
                        />
                      ))}
                    </div>
                  </AnimatePresence>
                </>
              )}

              {/* Contradictions - shown prominently if present */}
              {hasContradictions && (
                <>
                  <SectionHeader icon={AlertOctagon} title="Worth Reflecting On" color="text-lavender-600 dark:text-lavender-400" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-2">
                      {cachedPatterns.contradictions.map((contradiction, i) => (
                        <PatternCard
                          key={`contradiction-${i}`}
                          pattern={{
                            type: contradiction.type,
                            message: contradiction.message,
                            confidence: contradiction.confidence
                          }}
                          index={i}
                        />
                      ))}
                    </div>
                  </AnimatePresence>
                </>
              )}

              {/* Shadow Friction - Entity + Context intersections */}
              {hasShadowFriction && (
                <>
                  <SectionHeader icon={Users} title="Relationship Dynamics" color="text-lavender-600 dark:text-lavender-400" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-2">
                      {cachedPatterns.shadowFriction.slice(0, 4).map((pattern, i) => (
                        <PatternCard
                          key={`friction-${pattern.key || i}`}
                          pattern={{
                            type: 'shadow_friction',
                            message: pattern.message || pattern.insight,
                            entity: pattern.key,
                            confidence: pattern.entryCount >= 3 ? 0.8 : 0.6
                          }}
                          index={i}
                        />
                      ))}
                    </div>
                  </AnimatePresence>
                </>
              )}

              {/* Activity sentiment patterns - rotated for variety */}
              {hasActivityPatterns && rotatedActivityPatterns.length > 0 && (
                <>
                  <SectionHeader icon={TrendingUp} title="Activities & Mood" color="text-sage-600 dark:text-sage-400" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-2">
                      {rotatedActivityPatterns
                        .slice(0, 5)
                        .map((pattern, i) => (
                          <PatternCard
                            key={`activity-${pattern.entity || i}`}
                            pattern={{
                              type: pattern.type || (pattern.sentiment === 'positive' ? 'positive_activity' : 'negative_activity'),
                              message: pattern.message || pattern.insight,
                              entity: pattern.entity,
                              confidence: pattern.confidence
                            }}
                            index={i}
                          />
                        ))}
                    </div>
                  </AnimatePresence>
                </>
              )}

              {/* Temporal patterns */}
              {hasTemporalPatterns && (
                <>
                  <SectionHeader icon={Calendar} title="Time Patterns" color="text-lavender-600 dark:text-lavender-400" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-2">
                      {cachedPatterns.temporal.insights.bestDay && (
                        <PatternCard
                          pattern={{
                            type: 'best_day',
                            message: cachedPatterns.temporal.insights.bestDay.insight
                          }}
                          index={0}
                        />
                      )}
                      {cachedPatterns.temporal.insights.worstDay && (
                        <PatternCard
                          pattern={{
                            type: 'worst_day',
                            message: cachedPatterns.temporal.insights.worstDay.insight
                          }}
                          index={1}
                        />
                      )}
                      {cachedPatterns.temporal.insights.bestHour && (
                        <PatternCard
                          pattern={{
                            type: 'weekly_high',
                            message: cachedPatterns.temporal.insights.bestHour.insight
                          }}
                          index={2}
                        />
                      )}
                    </div>
                  </AnimatePresence>
                </>
              )}

              {/* Fallback to client patterns if no cached data */}
              {!hasCachedContent && clientPatterns.length > 0 && (
                <AnimatePresence mode="popLayout">
                  <div className="space-y-2">
                    {clientPatterns.map((pattern, i) => (
                      <PatternCard key={`client-${i}`} pattern={pattern} index={i} />
                    ))}
                  </div>
                </AnimatePresence>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-warm-100 bg-warm-50 dark:bg-hearth-850 dark:border-hearth-800">
          <p className="text-xs text-warm-500 text-center font-body">
            {source === 'cache' && 'Updated automatically in the background'}
            {source === 'computed' && 'Computed on-demand from your entries'}
            {source === 'insufficient' && 'Add more entries to see deeper patterns'}
            {!source && 'Patterns are calculated from your recent entries'}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default InsightsPanel;
