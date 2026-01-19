import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Sparkles, TrendingUp, AlertTriangle, Lightbulb, X,
  ChevronDown, ChevronUp, RefreshCw, Loader2, CheckCircle2,
  Activity, FileText, Target, Sun, Moon, Heart, Thermometer,
  CloudRain, Footprints, Zap
} from 'lucide-react';
import { useNexusInsights } from '../hooks/useNexusInsights';
import { useBasicInsights } from '../hooks/useBasicInsights';
import { useState, useEffect, useMemo } from 'react';
import {
  computeHealthMoodCorrelations,
  getTopHealthInsights,
  checkHealthDataSufficiency
} from '../services/health/healthCorrelations';
import {
  computeEnvironmentMoodCorrelations,
  getTopEnvironmentInsights,
  checkEnvironmentDataSufficiency
} from '../services/environment/environmentCorrelations';
import { getTodayRecommendations } from '../services/nexus/insightIntegration';

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
  todayHealth = null,
  todayEnvironment = null,
}) => {
  const [dismissedInsights, setDismissedInsights] = useState(new Set());
  const [expandedInsight, setExpandedInsight] = useState(null);
  const [showCorrelations, setShowCorrelations] = useState(true);
  const [recommendations, setRecommendations] = useState(null);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  // Load recommendations when health/environment data is available
  useEffect(() => {
    const loadRecommendations = async () => {
      if (!userId || !entries?.length) return;
      if (!todayHealth && !todayEnvironment) return;

      setLoadingRecommendations(true);
      try {
        const result = await getTodayRecommendations(userId, entries, todayHealth, todayEnvironment);
        setRecommendations(result);
      } catch (e) {
        console.warn('Failed to load recommendations:', e);
      }
      setLoadingRecommendations(false);
    };

    loadRecommendations();
  }, [userId, entries?.length, todayHealth, todayEnvironment]);

  // Compute correlations from entries
  const correlations = useMemo(() => {
    if (!entries || entries.length < 5) return null;

    const healthSufficiency = checkHealthDataSufficiency(entries);
    const envSufficiency = checkEnvironmentDataSufficiency(entries);

    const result = { health: null, environment: null };

    if (healthSufficiency.hasEnoughData) {
      const healthCorr = computeHealthMoodCorrelations(entries);
      if (healthCorr) {
        result.health = {
          ...healthCorr,
          topInsights: getTopHealthInsights(entries, 3)
        };
      }
    } else {
      result.healthMessage = healthSufficiency.message;
    }

    if (envSufficiency.hasEnoughData) {
      const envCorr = computeEnvironmentMoodCorrelations(entries);
      if (envCorr) {
        result.environment = {
          ...envCorr,
          topInsights: getTopEnvironmentInsights(entries, 3)
        };
      }
    } else {
      result.envMessage = envSufficiency.message;
    }

    return result;
  }, [entries]);

  // Nexus 2.0 insights (includes active + historical, filtered by confidence ≥50%)
  const {
    insights: allInsights,
    insightCount: totalInsightCount,
    isCalibrating,
    calibrationProgress,
    loading,
    refreshing,
    error,
    dataStatus,
    refresh,
    lastGenerated
  } = useNexusInsights(user, { autoRefresh: true });

  // Basic Insights (statistical correlations - fast, no LLM)
  const {
    insights: basicInsights,
    loading: basicLoading,
    generating: basicGenerating,
    hasEnoughData: hasEnoughBasicData,
    entriesNeeded: basicEntriesNeeded,
    regenerate: regenerateBasic,
    lastGeneratedFormatted: basicLastGenerated
  } = useBasicInsights(user, entries, { autoRefresh: true });

  // Helper to check if an insight has meaningful content
  const hasQualityContent = (insight) => {
    // Generic body templates to filter out
    const genericBodyPatterns = [
      'appears frequently in your entries with an average mood',
      'detected from',
      'this pattern'
    ];

    const bodyLower = (insight.body || '').toLowerCase();
    const hasGenericBody = genericBodyPatterns.some(p => bodyLower.includes(p));

    // Filter out generic pattern titles like "health Pattern", "career Pattern"
    const titleLower = (insight.title || '').toLowerCase();
    const isGenericPatternTitle = titleLower.endsWith('pattern') &&
                                  titleLower.split(' ').length <= 2;

    // If it's a generic pattern title with generic body, filter it out
    if (isGenericPatternTitle) {
      return false;
    }

    // Must have either a meaningful body, summary, or recommendation
    const hasBody = insight.body && insight.body.length > 30 && !hasGenericBody;
    const hasSummary = insight.summary && insight.summary.length > 20 &&
                       !insight.summary.toLowerCase().includes('detected from');
    const hasRecommendation = insight.recommendation?.intervention ||
                              insight.recommendation?.reasoning;

    return hasBody || hasSummary || hasRecommendation;
  };

  // Filter out dismissed insights and low-quality insights
  const filteredInsights = allInsights
    .filter(i => !dismissedInsights.has(i.id || i.message))
    .filter(hasQualityContent);

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
        insightCount={filteredInsights.length}
        error={error}
      />

      {/* Correlations Section */}
      {correlations && (correlations.health || correlations.environment) && (
        <CorrelationsSection
          correlations={correlations}
          isExpanded={showCorrelations}
          onToggle={() => setShowCorrelations(!showCorrelations)}
        />
      )}

      {/* Quick Insights (Basic statistical correlations) */}
      <QuickInsightsSection
        insights={basicInsights}
        entries={entries}
        loading={basicLoading}
        generating={basicGenerating}
        hasEnoughData={hasEnoughBasicData}
        entriesNeeded={basicEntriesNeeded}
        lastGenerated={basicLastGenerated}
        onRefresh={regenerateBasic}
      />

      {/* Today's Recommendations */}
      {recommendations?.recommendations?.length > 0 && (
        <RecommendationsSection recommendations={recommendations} />
      )}

      {/* Insights List */}
      {filteredInsights.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-purple-500" />
              <h3 className="text-xs font-bold text-warm-500 uppercase tracking-wider">
                AI Insights
              </h3>
            </div>
            <span className="text-xs text-warm-500">
              {filteredInsights.length} insight{filteredInsights.length !== 1 ? 's' : ''}
            </span>
          </div>

          <AnimatePresence mode="popLayout">
            {filteredInsights.map((insight, index) => (
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
      {!loading && filteredInsights.length === 0 && !isCalibrating && (
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
          <p className="text-warm-500 text-sm mt-2">
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
          <span className="text-warm-500">
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

/**
 * CorrelationsSection - Shows health and environment correlations with mood
 */
const CorrelationsSection = ({ correlations, isExpanded, onToggle }) => {
  const hasHealth = correlations.health?.topInsights?.length > 0;
  const hasEnv = correlations.environment?.topInsights?.length > 0;

  // Get icon for correlation type
  const getCorrelationIcon = (type) => {
    switch (type) {
      case 'sleep': return Moon;
      case 'hrv': return Heart;
      case 'recovery': return Zap;
      case 'strain': return Activity;
      case 'exercise': return Activity;
      case 'steps': return Footprints;
      case 'sunshine': return Sun;
      case 'temperature': return Thermometer;
      case 'weather': return CloudRain;
      case 'daylight': return Sun;
      default: return Activity;
    }
  };

  // Format correlation strength as percentage
  const formatCorrelation = (value) => {
    if (!value && value !== 0) return null;
    const pct = Math.round(Math.abs(value) * 100);
    return `${pct}%`;
  };

  return (
    <motion.div
      className="bg-white/50 border border-white/30 rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/30 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-red-400/20 to-blue-400/20 rounded-xl">
            <TrendingUp size={18} className="text-warm-600" />
          </div>
          <div>
            <h3 className="font-semibold text-warm-800">Your Patterns</h3>
            <p className="text-xs text-warm-500">
              How health &amp; environment affect your mood
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp size={18} className="text-warm-500" />
        ) : (
          <ChevronDown size={18} className="text-warm-500" />
        )}
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* Health Correlations */}
              {hasHealth && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Heart size={14} className="text-red-500" />
                    <span className="text-xs font-bold text-warm-500 uppercase tracking-wider">
                      Health &amp; Mood
                    </span>
                  </div>
                  <div className="space-y-2">
                    {correlations.health.topInsights.map((insight, i) => {
                      const Icon = getCorrelationIcon(insight.metric);
                      const strengthColor =
                        insight.strength === 'strong' ? 'text-green-600 bg-green-50' :
                        insight.strength === 'moderate' ? 'text-blue-600 bg-blue-50' :
                        'text-warm-500 bg-warm-50';

                      return (
                        <motion.div
                          key={i}
                          className="bg-white/60 rounded-xl p-3 flex items-start gap-3"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <div className={`p-1.5 rounded-lg ${strengthColor.split(' ')[1]}`}>
                            <Icon size={14} className={strengthColor.split(' ')[0]} />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm text-warm-700">{insight.insight}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${strengthColor}`}>
                                {insight.strength}
                              </span>
                              {insight.correlation && (
                                <span className="text-xs text-warm-500">
                                  {formatCorrelation(insight.correlation)} correlation
                                </span>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Environment Correlations */}
              {hasEnv && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Sun size={14} className="text-amber-500" />
                    <span className="text-xs font-bold text-warm-500 uppercase tracking-wider">
                      Environment &amp; Mood
                    </span>
                  </div>
                  <div className="space-y-2">
                    {correlations.environment.topInsights.map((insight, i) => {
                      const Icon = getCorrelationIcon(insight.metric);
                      const strengthColor =
                        insight.strength === 'strong' ? 'text-amber-600 bg-amber-50' :
                        insight.strength === 'moderate' ? 'text-sky-600 bg-sky-50' :
                        'text-warm-500 bg-warm-50';

                      return (
                        <motion.div
                          key={i}
                          className="bg-white/60 rounded-xl p-3 flex items-start gap-3"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <div className={`p-1.5 rounded-lg ${strengthColor.split(' ')[1]}`}>
                            <Icon size={14} className={strengthColor.split(' ')[0]} />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm text-warm-700">{insight.insight}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${strengthColor}`}>
                                {insight.strength}
                              </span>
                              {insight.correlation && (
                                <span className="text-xs text-warm-500">
                                  {formatCorrelation(insight.correlation)} correlation
                                </span>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* SAD Warning */}
                  {correlations.environment.lowSunshineWarning && (
                    <motion.div
                      className="bg-amber-50 border border-amber-200/50 rounded-xl p-3"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm text-amber-800 font-medium">
                            {correlations.environment.lowSunshineWarning.insight}
                          </p>
                          {correlations.environment.lowSunshineWarning.recommendation && (
                            <p className="text-xs text-amber-600 mt-1">
                              {correlations.environment.lowSunshineWarning.recommendation}
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {/* No data messages */}
              {!hasHealth && correlations.healthMessage && (
                <div className="text-xs text-warm-500 italic">
                  {correlations.healthMessage}
                </div>
              )}
              {!hasEnv && correlations.envMessage && (
                <div className="text-xs text-warm-500 italic">
                  {correlations.envMessage}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/**
 * RecommendationsSection - Shows today's personalized recommendations
 */
const RecommendationsSection = ({ recommendations }) => {
  const getPriorityStyle = (priority) => {
    switch (priority) {
      case 'high':
        return {
          bg: 'bg-red-50',
          border: 'border-red-200/50',
          icon: 'text-red-500',
          text: 'text-red-800'
        };
      case 'medium':
        return {
          bg: 'bg-amber-50',
          border: 'border-amber-200/50',
          icon: 'text-amber-500',
          text: 'text-amber-800'
        };
      default:
        return {
          bg: 'bg-green-50',
          border: 'border-green-200/50',
          icon: 'text-green-500',
          text: 'text-green-800'
        };
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'recovery': return Moon;
      case 'activity': return Activity;
      case 'environment': return Sun;
      case 'self_care': return Heart;
      default: return Lightbulb;
    }
  };

  return (
    <motion.div
      className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 border border-blue-200/30 rounded-2xl p-4"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb size={16} className="text-blue-600" />
        <h3 className="font-semibold text-warm-800">Today's Recommendations</h3>
      </div>

      <div className="space-y-2">
        {recommendations.recommendations.map((rec, i) => {
          const style = getPriorityStyle(rec.priority);
          const Icon = getTypeIcon(rec.type);

          return (
            <motion.div
              key={i}
              className={`${style.bg} ${style.border} border rounded-xl p-3`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <div className="flex items-start gap-3">
                <Icon size={16} className={`${style.icon} flex-shrink-0 mt-0.5`} />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${style.text}`}>
                    {rec.action}
                  </p>
                  {rec.reasoning && (
                    <p className="text-xs text-warm-500 mt-1">
                      {rec.reasoning}
                    </p>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${style.bg} ${style.text} font-medium`}>
                  {rec.priority}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {recommendations.basedOn && (
        <p className="text-xs text-warm-500 mt-3">
          Based on {recommendations.basedOn.entriesAnalyzed} entries
          {recommendations.basedOn.interventionsTracked > 0 && (
            <> &amp; {recommendations.basedOn.interventionsTracked} tracked activities</>
          )}
        </p>
      )}
    </motion.div>
  );
};

/**
 * QuickInsightsSection - Shows basic statistical insights
 */
const QuickInsightsSection = ({
  insights,
  entries,
  loading,
  generating,
  hasEnoughData,
  entriesNeeded,
  lastGenerated,
  onRefresh
}) => {
  const [expandedInsight, setExpandedInsight] = useState(null);
  const [showAllEntries, setShowAllEntries] = useState(new Set());
  const [selectedEntry, setSelectedEntry] = useState(null);

  // Helper to get entries by IDs
  const getEntriesByIds = (entryIds, showAll = false) => {
    if (!entries || !entryIds || entryIds.length === 0) return [];
    const matched = entries.filter(e => entryIds.includes(e.id || e.entryId));
    return showAll ? matched : matched.slice(0, 5);
  };

  // Toggle showing all entries for an insight
  const toggleShowAll = (insightId) => {
    setShowAllEntries(prev => {
      const next = new Set(prev);
      if (next.has(insightId)) {
        next.delete(insightId);
      } else {
        next.add(insightId);
      }
      return next;
    });
  };

  // Don't render if still loading
  if (loading) {
    return null;
  }

  // If we haven't determined data sufficiency yet, show loading
  // (this happens when dataSufficiency is null, causing hasEnoughData=false and entriesNeeded=0)
  if (!hasEnoughData && entriesNeeded === 0 && (!insights || insights.length === 0)) {
    return (
      <motion.div
        className="bg-white/30 border border-white/20 rounded-2xl p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-warm-100/50 rounded-xl">
            <Loader2 size={18} className="text-warm-400 animate-spin" />
          </div>
          <div>
            <h3 className="font-medium text-warm-600">Quick Insights</h3>
            <p className="text-xs text-warm-500">
              Checking your data...
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Insufficient data message
  if (!hasEnoughData && entriesNeeded > 0) {
    return (
      <motion.div
        className="bg-white/30 border border-white/20 rounded-2xl p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-warm-100/50 rounded-xl">
            <Zap size={18} className="text-warm-400" />
          </div>
          <div>
            <h3 className="font-medium text-warm-600">Quick Insights</h3>
            <p className="text-xs text-warm-500">
              Add {entriesNeeded} more entries to unlock pattern insights
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  // No insights generated yet - show generating state if we have enough data
  if (!insights || insights.length === 0) {
    // If generating, show loading state
    if (generating) {
      return (
        <motion.div
          className="bg-gradient-to-r from-emerald-50/50 to-teal-50/50 border border-emerald-200/30 rounded-2xl p-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-emerald-400/20 to-teal-400/20 rounded-xl">
              <Loader2 size={18} className="text-emerald-600 animate-spin" />
            </div>
            <div>
              <h3 className="font-semibold text-warm-800">Quick Insights</h3>
              <p className="text-xs text-warm-500">
                Analyzing your patterns...
              </p>
            </div>
          </div>
        </motion.div>
      );
    }
    // If has enough data but no insights, show prompt to generate
    if (hasEnoughData) {
      return (
        <motion.div
          className="bg-gradient-to-r from-emerald-50/50 to-teal-50/50 border border-emerald-200/30 rounded-2xl p-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-emerald-400/20 to-teal-400/20 rounded-xl">
                <Zap size={18} className="text-emerald-600" />
              </div>
              <div>
                <h3 className="font-semibold text-warm-800">Quick Insights</h3>
                <p className="text-xs text-warm-500">
                  Tap refresh to generate pattern insights
                </p>
              </div>
            </div>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="px-3 py-1.5 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition-colors"
              >
                Generate
              </button>
            )}
          </div>
        </motion.div>
      );
    }
    return null;
  }

  // Get category icon and colors
  const getCategoryStyle = (category) => {
    switch (category) {
      case 'activity':
        return { icon: Activity, color: 'text-green-600', bg: 'bg-green-50' };
      case 'people':
        return { icon: Heart, color: 'text-pink-600', bg: 'bg-pink-50' };
      case 'health':
        return { icon: Heart, color: 'text-red-600', bg: 'bg-red-50' };
      case 'environment':
        return { icon: Sun, color: 'text-amber-600', bg: 'bg-amber-50' };
      case 'time':
        return { icon: Moon, color: 'text-indigo-600', bg: 'bg-indigo-50' };
      default:
        return { icon: Zap, color: 'text-purple-600', bg: 'bg-purple-50' };
    }
  };

  return (
    <motion.div
      className="bg-gradient-to-r from-emerald-50/50 to-teal-50/50 border border-emerald-200/30 rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-emerald-400/20 to-teal-400/20 rounded-xl">
            <Zap size={18} className="text-emerald-600" />
          </div>
          <div>
            <h3 className="font-semibold text-warm-800">Quick Insights</h3>
            <p className="text-xs text-warm-500">
              Based on your patterns
              {lastGenerated && ` • ${lastGenerated}`}
            </p>
          </div>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={generating}
            className="p-2 rounded-xl hover:bg-white/50 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              size={14}
              className={`text-warm-500 ${generating ? 'animate-spin' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Insights Grid */}
      <div className="px-4 pb-4 grid gap-2">
        {insights.map((insight, index) => {
          const style = getCategoryStyle(insight.category);
          const Icon = style.icon;
          const isPositive = insight.direction === 'positive';
          const insightKey = insight.id || index;
          const isExpanded = expandedInsight === insightKey;
          const hasEntryIds = insight.entryIds && insight.entryIds.length > 0;
          const isShowingAll = showAllEntries.has(insightKey);
          const citedEntries = isExpanded ? getEntriesByIds(insight.entryIds, isShowingAll) : [];
          const hiddenCount = hasEntryIds ? insight.entryIds.length - 5 : 0;

          return (
            <motion.div
              key={insight.id || index}
              className="bg-white/60 rounded-xl overflow-hidden"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="p-3 flex items-start gap-3">
                <div className={`p-1.5 rounded-lg ${style.bg}`}>
                  <Icon size={14} className={style.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-warm-700 leading-relaxed">
                    {insight.insight}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      insight.strength === 'strong'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {insight.strength}
                    </span>
                    <span className={`text-xs ${isPositive ? 'text-green-600' : 'text-amber-600'}`}>
                      {isPositive ? '+' : ''}{insight.moodDelta}% mood
                    </span>
                    {insight.sampleSize && hasEntryIds && (
                      <button
                        onClick={() => setExpandedInsight(isExpanded ? null : insightKey)}
                        className="text-xs text-warm-500 hover:text-warm-700 flex items-center gap-1 transition-colors"
                      >
                        {insight.sampleSize} entries
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                    {insight.sampleSize && !hasEntryIds && (
                      <span className="text-xs text-warm-400">
                        {insight.sampleSize} entries
                      </span>
                    )}
                  </div>
                  {insight.recommendation && (
                    <p className="text-xs text-warm-500 mt-1.5 italic">
                      {insight.recommendation}
                    </p>
                  )}
                </div>
              </div>

              {/* Expanded entries section */}
              <AnimatePresence>
                {isExpanded && citedEntries.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-warm-200/50 bg-warm-50/50"
                  >
                    <div className="p-3 space-y-2">
                      <p className="text-xs font-medium text-warm-500 uppercase tracking-wider">
                        Related Entries
                      </p>
                      {citedEntries.map((entry, i) => (
                        <button
                          key={entry.id || i}
                          onClick={() => setSelectedEntry(entry)}
                          className="w-full text-left bg-white/80 hover:bg-white rounded-lg p-2 text-xs transition-colors cursor-pointer"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-warm-500">
                              {entry.createdAt?.toDate
                                ? entry.createdAt.toDate().toLocaleDateString()
                                : new Date(entry.createdAt).toLocaleDateString()}
                            </span>
                            <div className="flex items-center gap-2">
                              {typeof entry.analysis?.mood_score === 'number' && (
                                <span className={`font-medium ${
                                  entry.analysis.mood_score >= 0.6 ? 'text-green-600' :
                                  entry.analysis.mood_score >= 0.4 ? 'text-amber-600' :
                                  'text-red-600'
                                }`}>
                                  {Math.round(entry.analysis.mood_score * 100)}%
                                </span>
                              )}
                              <ChevronDown size={12} className="text-warm-400 -rotate-90" />
                            </div>
                          </div>
                          <p className="text-warm-700 line-clamp-2">
                            {(entry.content || entry.text || '').slice(0, 150)}
                            {(entry.content || entry.text || '').length > 150 ? '...' : ''}
                          </p>
                        </button>
                      ))}
                      {hiddenCount > 0 && !isShowingAll && (
                        <button
                          onClick={() => toggleShowAll(insightKey)}
                          className="w-full text-xs text-emerald-600 hover:text-emerald-700 text-center py-1 hover:bg-emerald-50 rounded-lg transition-colors"
                        >
                          +{hiddenCount} more entries — tap to show all
                        </button>
                      )}
                      {isShowingAll && hiddenCount > 0 && (
                        <button
                          onClick={() => toggleShowAll(insightKey)}
                          className="w-full text-xs text-warm-500 hover:text-warm-700 text-center py-1 hover:bg-warm-100 rounded-lg transition-colors"
                        >
                          Show fewer entries
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* Entry Detail Modal */}
      <AnimatePresence>
        {selectedEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedEntry(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 border-b border-warm-200 flex items-center justify-between">
                <div>
                  <p className="text-sm text-warm-500">
                    {selectedEntry.createdAt?.toDate
                      ? selectedEntry.createdAt.toDate().toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })
                      : new Date(selectedEntry.createdAt).toLocaleDateString('en-US', {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                  </p>
                  {typeof selectedEntry.analysis?.mood_score === 'number' && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-warm-500">Mood:</span>
                      <span className={`text-sm font-semibold ${
                        selectedEntry.analysis.mood_score >= 0.6 ? 'text-green-600' :
                        selectedEntry.analysis.mood_score >= 0.4 ? 'text-amber-600' :
                        'text-red-600'
                      }`}>
                        {Math.round(selectedEntry.analysis.mood_score * 100)}%
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="p-2 hover:bg-warm-100 rounded-xl transition-colors"
                >
                  <X size={20} className="text-warm-500" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-4 overflow-y-auto max-h-[60vh]">
                <p className="text-warm-700 whitespace-pre-wrap leading-relaxed">
                  {selectedEntry.content || selectedEntry.text || 'No content available'}
                </p>

                {/* Tags if available */}
                {selectedEntry.analysis?.tags && selectedEntry.analysis.tags.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-warm-200">
                    <p className="text-xs font-medium text-warm-500 uppercase tracking-wider mb-2">
                      Tags
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {selectedEntry.analysis.tags.map((tag, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-1 bg-warm-100 text-warm-600 rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary if available */}
                {selectedEntry.analysis?.summary && (
                  <div className="mt-4 pt-4 border-t border-warm-200">
                    <p className="text-xs font-medium text-warm-500 uppercase tracking-wider mb-2">
                      Summary
                    </p>
                    <p className="text-sm text-warm-600 italic">
                      {selectedEntry.analysis.summary}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
                      <ChevronUp size={14} className="text-warm-500" />
                    ) : (
                      <ChevronDown size={14} className="text-warm-500" />
                    )}
                  </div>
                )}
                {/* INT-003: Increased tap target size for accessibility (44x44px minimum) */}
                <button
                  onClick={onDismiss}
                  className="p-2 hover:bg-warm-200/50 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  aria-label="Dismiss insight"
                >
                  <X size={18} className="text-warm-500" />
                </button>
              </div>
            </div>

            {/* Title - RES-002: Added break-words for text reflow */}
            {getStringContent(insight.title, insight.intervention) && (
              <p className="font-medium text-warm-800 mt-1 break-words">
                {getStringContent(insight.title) || `Try: ${insight.intervention}`}
              </p>
            )}

            {/* Summary - RES-002: Added break-words for text reflow */}
            <p className="text-sm text-warm-700 mt-1 leading-relaxed break-words">
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
                <span className="text-xs text-warm-500">
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
