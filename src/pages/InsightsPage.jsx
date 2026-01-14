import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Sparkles, TrendingUp, AlertTriangle, Lightbulb, X } from 'lucide-react';
import { QuickStatsBar, GoalsProgress, WeeklyDigest } from '../components/dashboard/shared';
import { useNexusInsights } from '../hooks/useNexusInsights';
import { useState } from 'react';

/**
 * InsightsPage - Analytics and patterns view
 *
 * Contains components moved from the main feed:
 * - QuickStatsBar (7-day mood trend, streak, distribution)
 * - GoalsProgress (active goals tracking)
 * - WeeklyDigest (weekly summary)
 * - Nexus 2.0 AI insights (belief dissonance, narrative arcs, recommendations)
 */
const InsightsPage = ({
  entries,
  category,
  userId,
  user,
  onShowFullInsights,
}) => {
  const [dismissedInsights, setDismissedInsights] = useState(new Set());

  // Nexus 2.0 insights
  const {
    insights,
    primaryInsight,
    isCalibrating,
    calibrationProgress,
    loading,
    dataStatus
  } = useNexusInsights(user, { autoRefresh: true });

  // Filter out dismissed insights
  const activeInsights = insights.filter(i => !dismissedInsights.has(i.id || i.message));

  const handleDismissInsight = (insight) => {
    setDismissedInsights(prev => new Set([...prev, insight.id || insight.message]));
  };

  return (
    <motion.div
      className="px-4 pb-8 space-y-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Page Title */}
      <div className="pt-2">
        <h2 className="font-display font-bold text-xl text-warm-800">
          Insights
        </h2>
        <p className="text-sm text-warm-500 mt-1">
          Your patterns and progress
        </p>
      </div>

      {/* Nexus Calibration Progress */}
      {isCalibrating && (
        <motion.div
          className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-200/30 rounded-2xl p-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 rounded-xl animate-pulse">
              <Brain size={20} className="text-purple-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-warm-700">Nexus is learning your patterns</p>
              <div className="mt-2 h-2 bg-warm-200 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${calibrationProgress}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <p className="text-xs text-warm-500 mt-1">
                {calibrationProgress < 30 && 'Gathering initial data...'}
                {calibrationProgress >= 30 && calibrationProgress < 70 && 'Detecting patterns...'}
                {calibrationProgress >= 70 && 'Almost ready for deep insights...'}
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Nexus Insights Section */}
      {activeInsights.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-500" />
            <h3 className="text-xs font-bold text-warm-400 uppercase tracking-wider">
              AI Insights
            </h3>
          </div>

          <AnimatePresence mode="popLayout">
            {activeInsights.slice(0, 3).map((insight, index) => (
              <NexusInsightCard
                key={insight.id || index}
                insight={insight}
                onDismiss={() => handleDismissInsight(insight)}
              />
            ))}
          </AnimatePresence>

          {activeInsights.length > 3 && (
            <p className="text-sm text-warm-500 text-center">
              +{activeInsights.length - 3} more insights available
            </p>
          )}
        </div>
      )}

      {/* Quick Stats Bar */}
      {entries.length > 0 && (
        <QuickStatsBar
          entries={entries}
          category={category}
        />
      )}

      {/* Weekly Digest */}
      {entries.length >= 3 && (
        <WeeklyDigest
          entries={entries}
          category={category}
          userId={userId}
        />
      )}

      {/* Goals Progress */}
      {entries.length > 0 && (
        <GoalsProgress
          entries={entries}
          category={category}
          userId={userId}
        />
      )}

      {/* View Full Patterns Button */}
      {entries.length > 0 && (
        <motion.button
          onClick={onShowFullInsights}
          className="
            w-full py-3 px-4
            bg-gradient-to-r from-primary-500 to-primary-600
            text-white font-bold
            rounded-2xl
            shadow-soft
            flex items-center justify-center gap-2
          "
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          View Full Pattern Analysis
        </motion.button>
      )}

      {/* Empty state */}
      {entries.length === 0 && !isCalibrating && (
        <motion.div
          className="
            p-8 text-center
            bg-white/30 backdrop-blur-sm
            border border-white/20
            rounded-3xl
          "
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-warm-600 font-medium">
            No insights yet
          </p>
          <p className="text-warm-400 text-sm mt-2">
            Add more entries to unlock patterns and insights
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};

// Helper to safely get string content (some fields might be objects)
const getStringContent = (...fields) => {
  for (const field of fields) {
    if (typeof field === 'string' && field.length > 0) {
      return field;
    }
  }
  return null;
};

/**
 * NexusInsightCard - Individual insight display
 */
const NexusInsightCard = ({ insight, onDismiss }) => {
  // Determine insight type styling
  const getInsightStyle = () => {
    const type = insight.type || insight.source || 'pattern';

    switch (type) {
      case 'belief_dissonance':
      case 'contradiction':
        return {
          icon: AlertTriangle,
          gradient: 'from-amber-500/10 to-orange-500/10',
          border: 'border-amber-200/30',
          iconBg: 'bg-amber-500/20',
          iconColor: 'text-amber-600',
          label: 'Belief Pattern'
        };
      case 'narrative_arc':
      case 'growth':
        return {
          icon: TrendingUp,
          gradient: 'from-green-500/10 to-emerald-500/10',
          border: 'border-green-200/30',
          iconBg: 'bg-green-500/20',
          iconColor: 'text-green-600',
          label: 'Growth Pattern'
        };
      case 'recommendation':
      case 'intervention':
        return {
          icon: Lightbulb,
          gradient: 'from-blue-500/10 to-cyan-500/10',
          border: 'border-blue-200/30',
          iconBg: 'bg-blue-500/20',
          iconColor: 'text-blue-600',
          label: 'Recommendation'
        };
      case 'counterfactual':
        return {
          icon: Sparkles,
          gradient: 'from-purple-500/10 to-pink-500/10',
          border: 'border-purple-200/30',
          iconBg: 'bg-purple-500/20',
          iconColor: 'text-purple-600',
          label: 'What If'
        };
      default:
        return {
          icon: Brain,
          gradient: 'from-purple-500/10 to-blue-500/10',
          border: 'border-purple-200/30',
          iconBg: 'bg-purple-500/20',
          iconColor: 'text-purple-600',
          label: 'Pattern'
        };
    }
  };

  const style = getInsightStyle();
  const Icon = style.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className={`bg-gradient-to-r ${style.gradient} border ${style.border} rounded-2xl p-4`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 ${style.iconBg} rounded-xl flex-shrink-0`}>
          <Icon size={18} className={style.iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${style.iconColor} uppercase tracking-wider`}>
              {style.label}
            </span>
            <button
              onClick={onDismiss}
              className="p-1 hover:bg-warm-200/50 rounded-full transition-colors"
            >
              <X size={14} className="text-warm-400" />
            </button>
          </div>
          {/* Title if available - for recommendations, use intervention name */}
          {getStringContent(insight.title, insight.intervention) && (
            <p className="font-medium text-warm-800 mt-1">
              {getStringContent(insight.title) || `Try: ${insight.intervention}`}
            </p>
          )}
          {/* Main content - check multiple possible field names including recommendation fields */}
          <p className="text-sm text-warm-700 mt-1 leading-relaxed">
            {getStringContent(
              insight.summary,
              insight.reasoning,
              insight.message,
              insight.body,
              insight.description,
              insight.expectedOutcome
            ) || 'New pattern detected'}
          </p>
          {/* Timing for recommendations */}
          {getStringContent(insight.timing) && (
            <p className="text-xs text-warm-500 mt-1">
              ⏰ Best time: {insight.timing}
            </p>
          )}
          {/* Recommendation action if available */}
          {getStringContent(insight.recommendation?.action, insight.suggestion, insight.expectedOutcome) && (
            <p className="text-xs text-warm-500 mt-2 italic">
              💡 {getStringContent(insight.recommendation?.action, insight.suggestion, insight.expectedOutcome)}
            </p>
          )}
          {(insight.confidence || insight.score || insight.evidence?.statistical?.confidence || insight.recommendation?.confidence) && (
            <div className="flex items-center gap-2 mt-2">
              <div className="h-1 flex-1 bg-warm-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${style.iconBg.replace('/20', '')}`}
                  style={{ width: `${Math.round((insight.confidence || insight.score || insight.evidence?.statistical?.confidence || insight.recommendation?.confidence) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-warm-400">
                {Math.round((insight.confidence || insight.score || insight.evidence?.statistical?.confidence || insight.recommendation?.confidence) * 100)}% match
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default InsightsPage;
