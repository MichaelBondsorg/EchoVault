import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ChevronRight, Loader2, Brain, AlertCircle, TrendingUp, Target, Lightbulb } from 'lucide-react';
import GlassCard from '../GlassCard';
import { useNexusInsights } from '../../../hooks/useNexusInsights';

// Type-specific styling for insight cards
const INSIGHT_STYLES = {
  pattern: {
    icon: TrendingUp,
    gradient: 'from-blue-500/20 to-indigo-500/20',
    iconColor: 'text-blue-600',
  },
  causal: {
    icon: Brain,
    gradient: 'from-purple-500/20 to-pink-500/20',
    iconColor: 'text-purple-600',
  },
  recommendation: {
    icon: Target,
    gradient: 'from-green-500/20 to-emerald-500/20',
    iconColor: 'text-green-600',
  },
  default: {
    icon: Lightbulb,
    gradient: 'from-amber-500/20 to-orange-500/20',
    iconColor: 'text-amber-600',
  },
};

/**
 * Get safe string content from potentially complex insight fields
 */
const getStringContent = (value) => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    // Check common field patterns
    if (value.summary) return getStringContent(value.summary);
    if (value.description) return getStringContent(value.description);
    if (value.text) return getStringContent(value.text);
    if (value.message) return getStringContent(value.message);
    if (value.intervention) return getStringContent(value.intervention);
    return null;
  }
  return String(value);
};

/**
 * Get the display content for an insight
 */
const getInsightContent = (insight) => {
  // Try various field names in order of preference
  const fields = ['summary', 'reasoning', 'body', 'description', 'intervention', 'expectedOutcome'];

  for (const field of fields) {
    const content = getStringContent(insight[field]);
    if (content && content.length > 0) {
      return content;
    }
  }

  // Check nested recommendation
  if (insight.recommendation) {
    const recContent = getStringContent(insight.recommendation.intervention) ||
                       getStringContent(insight.recommendation.reasoning);
    if (recContent) return recContent;
  }

  return null;
};

/**
 * Mini insight card for the widget
 */
const MiniInsightCard = ({ insight, index }) => {
  const type = insight.type || 'default';
  const style = INSIGHT_STYLES[type] || INSIGHT_STYLES.default;
  const Icon = style.icon;

  const title = getStringContent(insight.title) ||
                (type === 'pattern' ? 'Pattern Detected' :
                 type === 'causal' ? 'Insight' :
                 type === 'recommendation' ? 'Suggestion' : 'Insight');

  const content = getInsightContent(insight);

  if (!content) return null;

  return (
    <motion.div
      className={`
        p-3 rounded-xl
        bg-gradient-to-br ${style.gradient}
        border border-white/30
      `}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 ${style.iconColor}`}>
          <Icon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-warm-700 truncate">
            {title}
          </p>
          <p className="text-xs text-warm-500 line-clamp-2 mt-0.5">
            {content}
          </p>
        </div>
      </div>
    </motion.div>
  );
};

/**
 * NexusInsightsWidget - Displays Nexus insights on the dashboard
 *
 * Shows top 2 insights with tap to see more
 */
const NexusInsightsWidget = ({
  user,
  isEditing = false,
  onDelete,
  size = '2x1',
}) => {
  const navigate = useNavigate();

  const {
    insights,
    isCalibrating,
    calibrationProgress,
    loading,
    error,
  } = useNexusInsights(user, { autoRefresh: false });

  // Take top 2 insights for the widget
  const displayInsights = (insights || []).slice(0, 2);

  const handleClick = () => {
    if (!isEditing) {
      navigate('/insights');
    }
  };

  return (
    <GlassCard
      size={size}
      isEditing={isEditing}
      onDelete={onDelete}
      interactive={!isEditing}
      onClick={handleClick}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-warm-500">
            <Sparkles size={16} className="text-primary-500" />
            <span className="text-xs font-medium">AI Insights</span>
          </div>
          {!isEditing && displayInsights.length > 0 && (
            <ChevronRight size={16} className="text-warm-400" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-warm-400" />
            </div>
          ) : isCalibrating ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center mb-2">
                <Brain size={16} className="text-primary-600" />
              </div>
              <p className="text-xs text-warm-600 font-medium">Learning your patterns</p>
              <div className="w-full mt-2 h-1.5 bg-warm-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${calibrationProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-xs text-warm-400 mt-1">
                {calibrationProgress}% complete
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <AlertCircle size={20} className="text-warm-400 mb-2" />
              <p className="text-xs text-warm-500">Unable to load insights</p>
            </div>
          ) : displayInsights.length > 0 ? (
            <div className="space-y-2">
              <AnimatePresence>
                {displayInsights.map((insight, idx) => (
                  <MiniInsightCard
                    key={insight.id || idx}
                    insight={insight}
                    index={idx}
                  />
                ))}
              </AnimatePresence>
              {insights.length > 2 && (
                <motion.p
                  className="text-xs text-primary-500 text-center pt-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  +{insights.length - 2} more insights
                </motion.p>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <div className="w-10 h-10 rounded-full bg-warm-100 flex items-center justify-center mb-2">
                <Sparkles size={18} className="text-warm-400" />
              </div>
              <p className="text-xs text-warm-500">
                Keep journaling to unlock personalized insights
              </p>
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
};

export default NexusInsightsWidget;
