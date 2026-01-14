import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Sparkles, TrendingUp, AlertTriangle, Lightbulb, X,
  ChevronDown, ChevronUp, RefreshCw, Loader2, CheckCircle2,
  Activity, FileText, Target
} from 'lucide-react';
import { useNexusInsights } from '../hooks/useNexusInsights';
import { useState } from 'react';

/**
 * InsightsPage - Nexus 2.0 AI Insights View
 *
 * Displays AI-generated insights from the 4-layer Nexus engine:
 * - Causal synthesis (deep pattern analysis)
 * - Recommendations (personalized actions)
 * - Belief dissonance (growth opportunities)
 * - Narrative arcs (life story patterns)
 * - Counterfactuals (what-if analysis)
 */
const InsightsPage = ({
  entries,
  category,
  userId,
  user,
}) => {
  const [dismissedInsights, setDismissedInsights] = useState(new Set());
  const [expandedInsight, setExpandedInsight] = useState(null);

  // Nexus 2.0 insights
  const {
    insights,
    isCalibrating,
    calibrationProgress,
    loading,
    refreshing,
    error,
    dataStatus,
    refresh,
    lastGenerated
  } = useNexusInsights(user, { autoRefresh: true });

  // Filter out dismissed insights
  const activeInsights = insights.filter(i => !dismissedInsights.has(i.id || i.message));

  const handleDismissInsight = (insight, e) => {
    e.stopPropagation();
    setDismissedInsights(prev => new Set([...prev, insight.id || insight.message]));
    if (expandedInsight === insight.id) {
      setExpandedInsight(null);
    }
  };

  const handleToggleExpand = (insightId) => {
    setExpandedInsight(expandedInsight === insightId ? null : insightId);
  };

  return (
    <motion.div
      className="px-4 pb-8 space-y-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Page Header */}
      <div className="pt-2 flex items-start justify-between">
        <div>
          <h2 className="font-display font-bold text-xl text-warm-800">
            Insights
          </h2>
          <p className="text-sm text-warm-500 mt-1">
            AI-powered pattern analysis
          </p>
        </div>

        {/* Refresh Button */}
        <button
          onClick={refresh}
          disabled={loading || refreshing}
          className="p-2 rounded-xl bg-white/50 hover:bg-white/80 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            size={18}
            className={`text-warm-500 ${refreshing ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* Generation Status */}
      <GenerationStatus
        loading={loading}
        refreshing={refreshing}
        isCalibrating={isCalibrating}
        calibrationProgress={calibrationProgress}
        dataStatus={dataStatus}
        lastGenerated={lastGenerated}
        insightCount={activeInsights.length}
        error={error}
      />

      {/* Insights List */}
      {activeInsights.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-purple-500" />
              <h3 className="text-xs font-bold text-warm-400 uppercase tracking-wider">
                AI Insights
              </h3>
            </div>
            <span className="text-xs text-warm-400">
              {activeInsights.length} insight{activeInsights.length !== 1 ? 's' : ''}
            </span>
          </div>

          <AnimatePresence mode="popLayout">
            {activeInsights.map((insight, index) => (
              <NexusInsightCard
                key={insight.id || index}
                insight={insight}
                isExpanded={expandedInsight === (insight.id || index)}
                onToggleExpand={() => handleToggleExpand(insight.id || index)}
                onDismiss={(e) => handleDismissInsight(insight, e)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Empty state */}
      {!loading && activeInsights.length === 0 && !isCalibrating && (
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
          <Brain size={40} className="mx-auto text-warm-300 mb-3" />
          <p className="text-warm-600 font-medium">
            No insights yet
          </p>
          <p className="text-warm-400 text-sm mt-2">
            {entries.length < 5
              ? `Add ${5 - entries.length} more entries to start generating insights`
              : 'Tap refresh to generate new insights'
            }
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};

/**
 * GenerationStatus - Shows insight generation progress
 */
const GenerationStatus = ({
  loading,
  refreshing,
  isCalibrating,
  calibrationProgress,
  dataStatus,
  lastGenerated,
  insightCount,
  error
}) => {
  // Format last generated time
  const formatLastGenerated = () => {
    if (!lastGenerated) return null;
    const date = lastGenerated.toDate ? lastGenerated.toDate() : new Date(lastGenerated);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  // Loading state
  if (loading && !refreshing) {
    return (
      <motion.div
        className="bg-white/50 border border-white/30 rounded-2xl p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="flex items-center gap-3">
          <Loader2 size={20} className="text-purple-500 animate-spin" />
          <div>
            <p className="font-medium text-warm-700">Loading insights...</p>
            <p className="text-xs text-warm-500">Fetching your personalized analysis</p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Calibrating state
  if (isCalibrating) {
    return (
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
              {calibrationProgress >= 30 && calibrationProgress < 70 && 'Detecting behavioral patterns...'}
              {calibrationProgress >= 70 && 'Building your psychological profile...'}
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Error state
  if (error) {
    return (
      <motion.div
        className="bg-red-50 border border-red-200/50 rounded-2xl p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="text-red-500" />
          <div>
            <p className="font-medium text-red-700">Generation failed</p>
            <p className="text-xs text-red-500">{error}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Success/Status state
  return (
    <motion.div
      className="bg-white/30 border border-white/20 rounded-2xl p-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-warm-500">
            <CheckCircle2 size={14} className="text-green-500" />
            <span>{insightCount} insights</span>
          </div>
          {dataStatus?.entries && (
            <div className="flex items-center gap-1.5 text-warm-500">
              <FileText size={14} />
              <span>{dataStatus.entries} entries analyzed</span>
            </div>
          )}
          {dataStatus?.whoopConnected && (
            <div className="flex items-center gap-1.5 text-warm-500">
              <Activity size={14} className="text-teal-500" />
              <span>Whoop linked</span>
            </div>
          )}
        </div>
        {formatLastGenerated() && (
          <span className="text-warm-400">
            Updated {formatLastGenerated()}
          </span>
        )}
      </div>
      {refreshing && (
        <div className="mt-2 flex items-center gap-2 text-xs text-purple-600">
          <Loader2 size={12} className="animate-spin" />
          <span>Refreshing insights...</span>
        </div>
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
 * NexusInsightCard - Expandable insight display
 */
const NexusInsightCard = ({ insight, isExpanded, onToggleExpand, onDismiss }) => {
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
      case 'causal_synthesis':
        return {
          icon: Brain,
          gradient: 'from-indigo-500/10 to-purple-500/10',
          border: 'border-indigo-200/30',
          iconBg: 'bg-indigo-500/20',
          iconColor: 'text-indigo-600',
          label: 'Deep Insight'
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

  // Check if this insight has expandable content
  const hasExpandableContent = Boolean(
    insight.body ||
    insight.mechanism ||
    insight.evidence?.narrative?.length ||
    insight.evidence?.biometric?.length ||
    insight.recommendation?.reasoning
  );

  const confidenceValue = insight.confidence ||
    insight.score ||
    insight.evidence?.statistical?.confidence ||
    insight.recommendation?.confidence;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className={`bg-gradient-to-r ${style.gradient} border ${style.border} rounded-2xl overflow-hidden`}
    >
      {/* Main Card - Clickable */}
      <div
        className={`p-4 ${hasExpandableContent ? 'cursor-pointer' : ''}`}
        onClick={hasExpandableContent ? onToggleExpand : undefined}
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
              <div className="flex items-center gap-1">
                {hasExpandableContent && (
                  <div className="p-1">
                    {isExpanded ? (
                      <ChevronUp size={14} className="text-warm-400" />
                    ) : (
                      <ChevronDown size={14} className="text-warm-400" />
                    )}
                  </div>
                )}
                <button
                  onClick={onDismiss}
                  className="p-1 hover:bg-warm-200/50 rounded-full transition-colors"
                >
                  <X size={14} className="text-warm-400" />
                </button>
              </div>
            </div>

            {/* Title */}
            {getStringContent(insight.title, insight.intervention) && (
              <p className="font-medium text-warm-800 mt-1">
                {getStringContent(insight.title) || `Try: ${insight.intervention}`}
              </p>
            )}

            {/* Summary */}
            <p className="text-sm text-warm-700 mt-1 leading-relaxed">
              {getStringContent(
                insight.summary,
                insight.reasoning,
                insight.message,
                insight.description,
                insight.expectedOutcome
              ) || 'New pattern detected'}
            </p>

            {/* Timing */}
            {getStringContent(insight.timing) && (
              <p className="text-xs text-warm-500 mt-1">
                ⏰ Best time: {insight.timing}
              </p>
            )}

            {/* Quick Action */}
            {!isExpanded && getStringContent(insight.recommendation?.action, insight.suggestion) && (
              <p className="text-xs text-warm-500 mt-2 italic">
                💡 {getStringContent(insight.recommendation?.action, insight.suggestion)}
              </p>
            )}

            {/* Confidence Bar */}
            {confidenceValue && (
              <div className="flex items-center gap-2 mt-2">
                <div className="h-1 flex-1 bg-warm-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${style.iconBg.replace('/20', '')}`}
                    style={{ width: `${Math.round(confidenceValue * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-warm-400">
                  {Math.round(confidenceValue * 100)}% confidence
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && hasExpandableContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 border-t border-warm-200/30 mt-0">
              <div className="pt-4 space-y-4">

                {/* Full Body Text */}
                {getStringContent(insight.body) && (
                  <div>
                    <h4 className="text-xs font-bold text-warm-500 uppercase tracking-wider mb-2">
                      Analysis
                    </h4>
                    <p className="text-sm text-warm-700 leading-relaxed whitespace-pre-line">
                      {insight.body}
                    </p>
                  </div>
                )}

                {/* Mechanism */}
                {getStringContent(insight.mechanism) && (
                  <div className="bg-white/40 rounded-xl p-3">
                    <h4 className="text-xs font-bold text-warm-500 uppercase tracking-wider mb-1">
                      Why This Happens
                    </h4>
                    <p className="text-sm text-warm-700">
                      {insight.mechanism}
                    </p>
                  </div>
                )}

                {/* Evidence */}
                {(insight.evidence?.narrative?.length > 0 || insight.evidence?.biometric?.length > 0) && (
                  <div>
                    <h4 className="text-xs font-bold text-warm-500 uppercase tracking-wider mb-2">
                      Evidence
                    </h4>
                    <div className="space-y-2">
                      {insight.evidence?.narrative?.map((item, i) => (
                        <div key={i} className="bg-white/40 rounded-lg p-2 text-sm text-warm-600 italic">
                          "{typeof item === 'string' ? item : JSON.stringify(item)}"
                        </div>
                      ))}
                      {insight.evidence?.biometric?.map((item, i) => (
                        <div key={i} className="bg-teal-50/50 rounded-lg p-2 text-sm text-teal-700 flex items-center gap-2">
                          <Activity size={14} />
                          {typeof item === 'string' ? item : JSON.stringify(item)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendation Details */}
                {(insight.recommendation?.action || insight.recommendation?.reasoning) && (
                  <div className="bg-blue-50/50 rounded-xl p-3">
                    <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Target size={12} />
                      Recommended Action
                    </h4>
                    {getStringContent(insight.recommendation.action) && (
                      <p className="text-sm text-warm-800 font-medium">
                        {insight.recommendation.action}
                      </p>
                    )}
                    {getStringContent(insight.recommendation.reasoning) && (
                      <p className="text-sm text-warm-600 mt-1">
                        {insight.recommendation.reasoning}
                      </p>
                    )}
                    {getStringContent(insight.recommendation.expectedOutcome) && (
                      <p className="text-xs text-blue-600 mt-2">
                        Expected outcome: {insight.recommendation.expectedOutcome}
                      </p>
                    )}
                  </div>
                )}

                {/* Statistical Info */}
                {insight.evidence?.statistical && (
                  <div className="flex items-center gap-4 text-xs text-warm-500">
                    {insight.evidence.statistical.sampleSize && (
                      <span>Based on {insight.evidence.statistical.sampleSize} data points</span>
                    )}
                    {insight.evidence.statistical.correlation && (
                      <span>Correlation: {(insight.evidence.statistical.correlation * 100).toFixed(0)}%</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default InsightsPage;
