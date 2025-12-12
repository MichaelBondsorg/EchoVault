import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  X, TrendingDown, TrendingUp, AlertTriangle, Heart, Calendar,
  Sparkles, BarChart3, Loader2, Sun, Cloud, Target, RefreshCw,
  AlertOctagon, Zap, Clock
} from 'lucide-react';
import { analyzeLongitudinalPatterns } from '../../services/safety';
import { getAllPatterns } from '../../services/patterns/cached';

const InsightsPanel = ({ entries, userId, category, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [cachedPatterns, setCachedPatterns] = useState(null);
  const [source, setSource] = useState(null);

  // Load cached patterns from Firestore
  useEffect(() => {
    const loadPatterns = async () => {
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        const result = await getAllPatterns(userId, entries, category);
        setCachedPatterns(result);
        setSource(result.source);
      } catch (error) {
        console.error('Failed to load cached patterns:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPatterns();
  }, [userId, entries, category]);

  // Fallback to client-side patterns if no cached data
  const clientPatterns = useMemo(() => analyzeLongitudinalPatterns(entries), [entries]);

  const getPatternIcon = (type) => {
    switch (type) {
      // Temporal patterns
      case 'weekly_low': return <TrendingDown size={16} className="text-accent" />;
      case 'weekly_high': return <TrendingUp size={16} className="text-mood-great" />;
      case 'best_day': return <Sun size={16} className="text-amber-500" />;
      case 'worst_day': return <Cloud size={16} className="text-blue-500" />;
      // Activity sentiment
      case 'positive_activity': return <TrendingUp size={16} className="text-green-500" />;
      case 'negative_activity': return <TrendingDown size={16} className="text-red-400" />;
      // Trigger patterns
      case 'trigger_correlation': return <AlertTriangle size={16} className="text-amber-500" />;
      case 'trigger': return <Zap size={16} className="text-amber-500" />;
      // Contradiction types
      case 'goal_abandonment': return <Target size={16} className="text-orange-500" />;
      case 'sentiment_contradiction': return <AlertOctagon size={16} className="text-purple-500" />;
      case 'avoidance_contradiction': return <Clock size={16} className="text-indigo-500" />;
      // Other
      case 'recovery_pattern': return <Heart size={16} className="text-pink-500" />;
      case 'monthly_summary': return <Calendar size={16} className="text-primary-500" />;
      default: return <Sparkles size={16} className="text-secondary-500" />;
    }
  };

  const getPatternColor = (type) => {
    switch (type) {
      // Temporal
      case 'weekly_low': return 'bg-accent-light border-accent';
      case 'weekly_high': return 'bg-green-50 border-green-200';
      case 'best_day': return 'bg-amber-50 border-amber-200';
      case 'worst_day': return 'bg-blue-50 border-blue-200';
      // Activity sentiment
      case 'positive_activity': return 'bg-green-50 border-green-200';
      case 'negative_activity': return 'bg-red-50 border-red-200';
      // Triggers
      case 'trigger_correlation': return 'bg-amber-50 border-amber-200';
      case 'trigger': return 'bg-amber-50 border-amber-200';
      // Contradictions
      case 'goal_abandonment': return 'bg-orange-50 border-orange-200';
      case 'sentiment_contradiction': return 'bg-purple-50 border-purple-200';
      case 'avoidance_contradiction': return 'bg-indigo-50 border-indigo-200';
      // Other
      case 'recovery_pattern': return 'bg-pink-50 border-pink-200';
      case 'monthly_summary': return 'bg-primary-50 border-primary-200';
      default: return 'bg-secondary-50 border-secondary-200';
    }
  };

  // Helper to render a pattern card
  const PatternCard = ({ pattern, index }) => (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className={`p-4 rounded-2xl border ${getPatternColor(pattern.type)}`}
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
        </div>
      </div>
    </motion.div>
  );

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
  const hasSummary = cachedPatterns?.summary?.length > 0;
  const hasCachedContent = hasActivityPatterns || hasTemporalPatterns || hasContradictions || hasSummary;
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
        className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col shadow-soft-lg"
      >
        <div className="p-6 border-b border-primary-100 bg-gradient-to-r from-primary-500 to-primary-600 text-white">
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
              <div className="h-20 w-20 bg-warm-100 rounded-full flex items-center justify-center mx-auto mb-4">
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
                  <SectionHeader icon={Sparkles} title="Key Insights" color="text-secondary-600" />
                  <div className="space-y-2">
                    {cachedPatterns.summary.map((insight, i) => (
                      <PatternCard key={`summary-${i}`} pattern={insight} index={i} />
                    ))}
                  </div>
                </>
              )}

              {/* Contradictions - shown prominently if present */}
              {hasContradictions && (
                <>
                  <SectionHeader icon={AlertOctagon} title="Worth Reflecting On" color="text-purple-600" />
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
                </>
              )}

              {/* Activity sentiment patterns */}
              {hasActivityPatterns && (
                <>
                  <SectionHeader icon={TrendingUp} title="Activities & Mood" color="text-green-600" />
                  <div className="space-y-2">
                    {cachedPatterns.activitySentiment
                      .filter(p => p.insight)
                      .slice(0, 5)
                      .map((pattern, i) => (
                        <PatternCard
                          key={`activity-${i}`}
                          pattern={{
                            type: pattern.sentiment === 'positive' ? 'positive_activity' : 'negative_activity',
                            message: pattern.insight,
                            entity: pattern.entity,
                            confidence: pattern.confidence
                          }}
                          index={i}
                        />
                      ))}
                  </div>
                </>
              )}

              {/* Temporal patterns */}
              {hasTemporalPatterns && (
                <>
                  <SectionHeader icon={Calendar} title="Time Patterns" color="text-blue-600" />
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
                </>
              )}

              {/* Fallback to client patterns if no cached data */}
              {!hasCachedContent && clientPatterns.length > 0 && (
                <div className="space-y-2">
                  {clientPatterns.map((pattern, i) => (
                    <PatternCard key={`client-${i}`} pattern={pattern} index={i} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-warm-100 bg-warm-50">
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
