import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Sparkles, TrendingUp, AlertTriangle, Lightbulb, X,
  ChevronDown, ChevronUp, RefreshCw, Loader2, CheckCircle2,
  Activity, FileText, Target, Sun, Moon, Heart, Thermometer,
  CloudRain, Footprints, Zap, Download, ThumbsUp, ThumbsDown
} from 'lucide-react';
import { useNexusInsights } from '../hooks/useNexusInsights';
import { useBasicInsights } from '../hooks/useBasicInsights';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { recordFeedbackAndLearn } from '../services/basicInsights/feedbackLearning';
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
          <h2 className="font-display font-bold text-xl text-warm-800 dark:text-warm-100">
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
          className="p-2 rounded-xl bg-white/50 dark:bg-hearth-900/50 hover:bg-white/80 dark:hover:bg-hearth-800/80 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            size={18}
            className={`text-warm-500 ${refreshing ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      {/* Disclaimer Note */}
      <div className="bg-warm-50/50 dark:bg-hearth-900/50 border border-warm-200/30 dark:border-hearth-800/30 rounded-xl px-4 py-3">
        <p className="text-xs text-warm-500 leading-relaxed">
          <span className="font-medium">Note:</span> Insights are only as good as your data. The more consistently you journal, the more accurate and personalized these patterns become.
        </p>
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
        userId={userId}
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
              <Sparkles size={16} className="text-honey-500" />
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
            bg-white/30 dark:bg-hearth-900/30 backdrop-blur-sm
            border border-white/20 dark:border-hearth-800/20
            rounded-3xl
          "
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Brain size={40} className="mx-auto text-warm-300 mb-3" />
          <p className="text-warm-600 dark:text-warm-300 font-medium">
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
        className="bg-white/50 dark:bg-hearth-900/50 border border-white/30 dark:border-hearth-800/30 rounded-2xl p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="flex items-center gap-3">
          <Loader2 size={20} className="text-honey-500 animate-spin" />
          <div>
            <p className="font-medium text-warm-700 dark:text-warm-200">Loading insights...</p>
            <p className="text-xs text-warm-500 dark:text-warm-400">Fetching your personalized analysis</p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Calibrating state
  if (isCalibrating) {
    return (
      <motion.div
        className="bg-gradient-to-r from-honey-500/10 to-lavender-500/10 dark:from-honey-900/20 dark:to-lavender-900/20 border border-honey-200/30 dark:border-honey-800/30 rounded-2xl p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-honey-500/20 rounded-xl animate-pulse">
            <Brain size={20} className="text-honey-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-warm-700 dark:text-warm-200">Nexus is learning your patterns</p>
            <div className="mt-2 h-2 bg-warm-200 dark:bg-warm-800 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-honey-500 to-honey-600"
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
        className="bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-900/50 rounded-2xl p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="text-red-500 dark:text-red-400" />
          <div>
            <p className="font-medium text-red-700 dark:text-red-300">Generation failed</p>
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          </div>
        </div>
      </motion.div>
    );
  }

  // Success/Status state
  return (
    <motion.div
      className="bg-white/30 dark:bg-hearth-900/30 border border-white/20 dark:border-hearth-800/20 rounded-2xl p-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-warm-500">
            <CheckCircle2 size={14} className="text-sage-500 dark:text-sage-400" />
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
              <Activity size={14} className="text-sage-500 dark:text-sage-400" />
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
        <div className="mt-2 flex items-center gap-2 text-xs text-honey-600">
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
  const [expandedMethodology, setExpandedMethodology] = useState(null);
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

  // Generate methodology explanation based on insight type
  const getMethodologyExplanation = (insight) => {
    const type = insight.type;
    const n = insight.sampleSize || 'N/A';

    switch (type) {
      case 'sleep_mood':
        return {
          method: 'Threshold comparison',
          description: `Compared mood on days with 7+ hours of sleep vs days with less than 6 hours.`,
          details: [
            `Sample size: ${n} entries with sleep data`,
            insight.goodSleepAvgMood != null ? `7+ hours sleep: ${Math.round(insight.goodSleepAvgMood * 100)}% avg mood` : null,
            insight.poorSleepAvgMood != null ? `<6 hours sleep: ${Math.round(insight.poorSleepAvgMood * 100)}% avg mood` : null,
            insight.correlation != null ? `Pearson correlation: ${(insight.correlation * 100).toFixed(0)}%` : null
          ].filter(Boolean)
        };
      case 'hrv_mood':
        return {
          method: 'Median split comparison',
          description: `Split entries at your median HRV (${insight.medianHRV?.toFixed(0) || '?'}ms) and compared mood above vs below.`,
          details: [
            `Sample size: ${n} entries with HRV data`,
            insight.highHRVAvgMood != null ? `Above median: ${Math.round(insight.highHRVAvgMood * 100)}% avg mood` : null,
            insight.lowHRVAvgMood != null ? `Below median: ${Math.round(insight.lowHRVAvgMood * 100)}% avg mood` : null,
            insight.correlation != null ? `Pearson correlation: ${(insight.correlation * 100).toFixed(0)}%` : null
          ].filter(Boolean)
        };
      case 'rhr_mood':
        return {
          method: 'Median split comparison',
          description: `Split entries at your median resting heart rate (${insight.medianRHR?.toFixed(0) || '?'}bpm) and compared mood.`,
          details: [
            `Sample size: ${n} entries with RHR data`,
            insight.lowRHRMood != null ? `Lower RHR (≤${insight.medianRHR?.toFixed(0)}): ${Math.round(insight.lowRHRMood * 100)}% avg mood` : null,
            insight.highRHRMood != null ? `Higher RHR: ${Math.round(insight.highRHRMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      case 'exercise_mood':
        return {
          method: 'Binary comparison',
          description: 'Compared mood on days with recorded workouts vs rest days.',
          details: [
            `Sample size: ${n} entries with workout data`,
            insight.workoutDays != null ? `Workout days: ${insight.workoutDays} (${Math.round((insight.workoutDayMood || 0) * 100)}% avg mood)` : null,
            insight.restDays != null ? `Rest days: ${insight.restDays} (${Math.round((insight.restDayMood || 0) * 100)}% avg mood)` : null
          ].filter(Boolean)
        };
      case 'steps_mood':
        return {
          method: 'Threshold comparison',
          description: 'Compared mood on active days (8k+ steps) vs sedentary days (<4k steps).',
          details: [
            `Sample size: ${n} entries with step data`,
            `Your median steps: ${insight.medianSteps?.toLocaleString() || '?'}`,
            insight.activeDayMood != null ? `8k+ steps: ${Math.round(insight.activeDayMood * 100)}% avg mood` : null,
            insight.sedentaryDayMood != null ? `<4k steps: ${Math.round(insight.sedentaryDayMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      case 'recovery_mood':
        return {
          method: 'Zone comparison (Whoop)',
          description: 'Compared mood across Whoop recovery zones (green ≥67%, yellow 34-66%, red <34%).',
          details: [
            `Sample size: ${n} entries with recovery data`,
            insight.greenZoneMood != null ? `Green zone: ${Math.round(insight.greenZoneMood * 100)}% avg mood` : null,
            insight.yellowZoneMood != null ? `Yellow zone: ${Math.round(insight.yellowZoneMood * 100)}% avg mood` : null,
            insight.redZoneMood != null ? `Red zone: ${Math.round(insight.redZoneMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      default:
        return {
          method: 'Statistical analysis',
          description: 'Correlation computed from your journal entries with health data.',
          details: [`Sample size: ${n} entries`]
        };
    }
  };

  // Generate methodology explanation for environment insights
  const getEnvironmentMethodologyExplanation = (insight) => {
    const type = insight.type;
    const n = insight.sampleSize || 'N/A';

    switch (type) {
      case 'sunshine_mood':
        return {
          method: 'Threshold comparison',
          description: 'Compared mood on sunny days (60%+ sunshine) vs overcast days (<30% sunshine).',
          details: [
            `Sample size: ${n} entries with sunshine data`,
            insight.highSunshineMood != null ? `Sunny (60%+): ${Math.round(insight.highSunshineMood * 100)}% avg mood` : null,
            insight.lowSunshineMood != null ? `Overcast (<30%): ${Math.round(insight.lowSunshineMood * 100)}% avg mood` : null,
            insight.correlation != null ? `Pearson correlation: ${(insight.correlation * 100).toFixed(0)}%` : null
          ].filter(Boolean)
        };
      case 'weather_mood':
        return {
          method: 'Category comparison',
          description: 'Grouped entries by weather condition (sunny, cloudy, rainy) and compared average mood.',
          details: [
            `Sample size: ${n} entries with weather data`,
            insight.breakdown?.sunny ? `Sunny: ${insight.breakdown.sunny.count} entries, ${Math.round(insight.breakdown.sunny.avgMood * 100)}% avg mood` : null,
            insight.breakdown?.cloudy ? `Cloudy: ${insight.breakdown.cloudy.count} entries, ${Math.round(insight.breakdown.cloudy.avgMood * 100)}% avg mood` : null,
            insight.breakdown?.rainy ? `Rainy: ${insight.breakdown.rainy.count} entries, ${Math.round(insight.breakdown.rainy.avgMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      case 'daylight_mood':
        return {
          method: 'Seasonal daylight comparison',
          description: 'Compared mood during longer daylight periods (12h+) vs shorter days (<10h).',
          details: [
            `Sample size: ${n} entries with daylight data`,
            insight.longDayMood != null ? `Long days (12h+): ${Math.round(insight.longDayMood * 100)}% avg mood` : null,
            insight.shortDayMood != null ? `Short days (<10h): ${Math.round(insight.shortDayMood * 100)}% avg mood` : null,
            insight.correlation != null ? `Pearson correlation: ${(insight.correlation * 100).toFixed(0)}%` : null
          ].filter(Boolean)
        };
      case 'light_context_mood':
        return {
          method: 'Time-of-day comparison',
          description: 'Compared mood of entries made during daylight vs after dark.',
          details: [
            `Sample size: ${n} entries with light context`,
            insight.daylightMood != null ? `Daylight entries: ${Math.round(insight.daylightMood * 100)}% avg mood` : null,
            insight.darkMood != null ? `After-dark entries: ${Math.round(insight.darkMood * 100)}% avg mood` : null,
            insight.peakTime ? `Your peak time: ${insight.peakTime}` : null
          ].filter(Boolean)
        };
      case 'temperature_mood':
        return {
          method: 'Temperature range comparison',
          description: 'Compared mood across different temperature ranges.',
          details: [
            `Sample size: ${n} entries with temperature data`,
            insight.warmMood != null ? `Warm days: ${Math.round(insight.warmMood * 100)}% avg mood` : null,
            insight.coldMood != null ? `Cold days: ${Math.round(insight.coldMood * 100)}% avg mood` : null
          ].filter(Boolean)
        };
      default:
        return {
          method: 'Statistical analysis',
          description: 'Correlation computed from your journal entries with environment data.',
          details: [`Sample size: ${n} entries`]
        };
    }
  };

  return (
    <motion.div
      className="bg-white/50 dark:bg-hearth-900/50 border border-white/30 dark:border-hearth-800/30 rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/30 dark:hover:bg-hearth-800/30 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-terra-400/20 to-lavender-400/20 rounded-xl">
            <TrendingUp size={18} className="text-warm-600" />
          </div>
          <div>
            <h3 className="font-semibold text-warm-800 dark:text-warm-100">Your Patterns</h3>
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
                        insight.strength === 'strong' ? 'text-sage-600 bg-sage-50 dark:text-sage-400 dark:bg-sage-900/30' :
                        insight.strength === 'moderate' ? 'text-lavender-600 bg-lavender-50 dark:text-lavender-400 dark:bg-lavender-900/30' :
                        'text-warm-500 bg-warm-50 dark:text-warm-400 dark:bg-warm-900/30';
                      const insightKey = `health-${i}`;
                      const isMethodExpanded = expandedMethodology === insightKey;
                      const methodology = getMethodologyExplanation(insight);

                      return (
                        <motion.div
                          key={i}
                          className="bg-white/60 dark:bg-hearth-850/60 rounded-xl overflow-hidden"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <div className="p-3 flex items-start gap-3">
                            <div className={`p-1.5 rounded-lg ${strengthColor.split(' ')[1]}`}>
                              <Icon size={14} className={strengthColor.split(' ')[0]} />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-warm-700 dark:text-warm-200">{insight.insight}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${strengthColor}`}>
                                  {insight.strength}
                                </span>
                                {insight.correlation && (
                                  <span className="text-xs text-warm-500">
                                    {formatCorrelation(insight.correlation)} correlation
                                  </span>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedMethodology(isMethodExpanded ? null : insightKey);
                                  }}
                                  className="text-xs text-sage-600 hover:text-sage-700 dark:text-sage-400 dark:hover:text-sage-300 flex items-center gap-1"
                                >
                                  How?
                                  {isMethodExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Methodology Explanation */}
                          <AnimatePresence>
                            {isMethodExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="border-t border-warm-200/50 bg-sage-50/30 dark:bg-sage-900/20"
                              >
                                <div className="p-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Brain size={12} className="text-sage-600 dark:text-sage-400" />
                                    <span className="text-xs font-semibold text-sage-700 dark:text-sage-300">
                                      {methodology.method}
                                    </span>
                                  </div>
                                  <p className="text-xs text-warm-600 dark:text-warm-400">
                                    {methodology.description}
                                  </p>
                                  <ul className="text-xs text-warm-500 space-y-1">
                                    {methodology.details.map((detail, j) => (
                                      <li key={j} className="flex items-center gap-1.5">
                                        <span className="w-1 h-1 bg-sage-400 dark:bg-sage-500 rounded-full" />
                                        {detail}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
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
                    <Sun size={14} className="text-honey-500 dark:text-honey-400" />
                    <span className="text-xs font-bold text-warm-500 uppercase tracking-wider">
                      Environment &amp; Mood
                    </span>
                  </div>
                  <div className="space-y-2">
                    {correlations.environment.topInsights.map((insight, i) => {
                      const Icon = getCorrelationIcon(insight.metric);
                      const strengthColor =
                        insight.strength === 'strong' ? 'text-honey-600 bg-honey-50 dark:text-honey-400 dark:bg-honey-900/30' :
                        insight.strength === 'moderate' ? 'text-lavender-600 bg-lavender-50 dark:text-lavender-400 dark:bg-lavender-900/30' :
                        'text-warm-500 bg-warm-50 dark:text-warm-400 dark:bg-warm-900/30';
                      const envInsightKey = `env-${i}`;
                      const isEnvMethodExpanded = expandedMethodology === envInsightKey;
                      const envMethodology = getEnvironmentMethodologyExplanation(insight);

                      return (
                        <motion.div
                          key={i}
                          className="bg-white/60 dark:bg-hearth-850/60 rounded-xl overflow-hidden"
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                        >
                          <div className="p-3 flex items-start gap-3">
                            <div className={`p-1.5 rounded-lg ${strengthColor.split(' ')[1]}`}>
                              <Icon size={14} className={strengthColor.split(' ')[0]} />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-warm-700 dark:text-warm-200">{insight.insight}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${strengthColor}`}>
                                  {insight.strength}
                                </span>
                                {insight.correlation && (
                                  <span className="text-xs text-warm-500">
                                    {formatCorrelation(insight.correlation)} correlation
                                  </span>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedMethodology(isEnvMethodExpanded ? null : envInsightKey);
                                  }}
                                  className="text-xs text-honey-600 hover:text-honey-700 dark:text-honey-400 dark:hover:text-honey-300 flex items-center gap-1"
                                >
                                  How?
                                  {isEnvMethodExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Environment Methodology Explanation */}
                          <AnimatePresence>
                            {isEnvMethodExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.15 }}
                                className="border-t border-warm-200/50 bg-honey-50/30 dark:bg-honey-900/20"
                              >
                                <div className="p-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <Brain size={12} className="text-honey-600 dark:text-honey-400" />
                                    <span className="text-xs font-semibold text-honey-700 dark:text-honey-300">
                                      {envMethodology.method}
                                    </span>
                                  </div>
                                  <p className="text-xs text-warm-600 dark:text-warm-400">
                                    {envMethodology.description}
                                  </p>
                                  <ul className="text-xs text-warm-500 space-y-1">
                                    {envMethodology.details.map((detail, j) => (
                                      <li key={j} className="flex items-center gap-1.5">
                                        <span className="w-1 h-1 bg-honey-400 dark:bg-honey-500 rounded-full" />
                                        {detail}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </div>

                  {/* SAD Warning */}
                  {correlations.environment.lowSunshineWarning && (
                    <motion.div
                      className="bg-honey-50 dark:bg-honey-950/30 border border-honey-200/50 dark:border-honey-800/50 rounded-xl p-3"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={16} className="text-honey-600 dark:text-honey-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm text-honey-800 dark:text-honey-200 font-medium">
                            {correlations.environment.lowSunshineWarning.insight}
                          </p>
                          {correlations.environment.lowSunshineWarning.recommendation && (
                            <p className="text-xs text-honey-600 dark:text-honey-400 mt-1">
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
          bg: 'bg-red-50 dark:bg-red-950/30',
          border: 'border-red-200/50 dark:border-red-900/50',
          icon: 'text-red-500 dark:text-red-400',
          text: 'text-red-800 dark:text-red-300'
        };
      case 'medium':
        return {
          bg: 'bg-honey-50 dark:bg-honey-950/30',
          border: 'border-honey-200/50 dark:border-honey-800/50',
          icon: 'text-honey-500 dark:text-honey-400',
          text: 'text-honey-800 dark:text-honey-200'
        };
      default:
        return {
          bg: 'bg-sage-50 dark:bg-sage-950/30',
          border: 'border-sage-200/50 dark:border-sage-800/50',
          icon: 'text-sage-500 dark:text-sage-400',
          text: 'text-sage-800 dark:text-sage-200'
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
      className="bg-gradient-to-r from-honey-50/50 to-sage-50/50 dark:from-honey-900/20 dark:to-sage-900/20 border border-honey-200/30 dark:border-honey-800/30 rounded-2xl p-4"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb size={16} className="text-honey-600" />
        <h3 className="font-semibold text-warm-800 dark:text-warm-100">Today's Recommendations</h3>
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
  onRefresh,
  userId
}) => {
  const [expandedInsight, setExpandedInsight] = useState(null);
  const [showAllEntries, setShowAllEntries] = useState(new Set());
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(new Set());

  // Helper to get entries by IDs
  const getEntriesByIds = (entryIds, showAll = false) => {
    if (!entries || !entryIds || entryIds.length === 0) return [];
    const matched = entries.filter(e => entryIds.includes(e.id || e.entryId));
    return showAll ? matched : matched.slice(0, 5);
  };

  // Get full entries with all data for export
  const getFullEntriesForExport = (entryIds) => {
    if (!entries || !entryIds || entryIds.length === 0) return [];
    return entries.filter(e => entryIds.includes(e.id || e.entryId));
  };

  // Export insight data for debugging
  const handleExportInsight = useCallback((insight) => {
    const citedEntries = getFullEntriesForExport(insight.entryIds);

    const exportData = {
      exportedAt: new Date().toISOString(),
      insight: {
        id: insight.id,
        category: insight.category,
        insightText: insight.insight,
        moodDelta: insight.moodDelta,
        direction: insight.direction,
        strength: insight.strength,
        sampleSize: insight.sampleSize,
        recommendation: insight.recommendation,
        // Include any activity/theme/pattern specific fields
        activityKey: insight.activityKey,
        activityLabel: insight.activityLabel,
        peopleKey: insight.peopleKey,
        themeKey: insight.themeKey,
        emotionKey: insight.emotionKey,
        cognitivePattern: insight.cognitivePattern,
        entryType: insight.entryType
      },
      citedEntries: citedEntries.map(entry => ({
        id: entry.id || entry.entryId,
        createdAt: entry.createdAt?.toDate ? entry.createdAt.toDate().toISOString() : entry.createdAt,
        content: entry.content || entry.text,
        moodScore: entry.analysis?.mood_score,
        tags: entry.analysis?.tags,
        themes: entry.analysis?.themes,
        emotions: entry.analysis?.emotions,
        entry_type: entry.analysis?.entry_type,
        category: entry.category || entry.classification?.primary_category,
        healthContext: entry.healthContext ? {
          activity: entry.healthContext.activity,
          hadWorkout: entry.healthContext.hadWorkout,
          strain: entry.healthContext.strain,
          sleep: entry.healthContext.sleep,
          recovery: entry.healthContext.recovery
        } : null,
        environmentContext: entry.environmentContext
      }))
    };

    // Create and download the JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `insight-debug-${insight.id || 'unknown'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [entries]);

  // Submit feedback for an insight and update learning
  const handleFeedback = useCallback(async (insight, isPositive) => {
    if (!userId) return;

    try {
      // Get the cited entries for learning analysis
      const citedEntries = getFullEntriesForExport(insight.entryIds);

      // Record feedback and update learning model
      const feedbackData = {
        insightId: insight.id,
        category: insight.category,
        insightText: insight.insight,
        moodDelta: insight.moodDelta,
        activityKey: insight.activityKey || null,
        themeKey: insight.themeKey || null,
        peopleKey: insight.peopleKey || null,
        sampleSize: insight.sampleSize,
        entryIds: insight.entryIds || [],
        feedback: isPositive ? 'accurate' : 'inaccurate'
      };

      const learningResult = await recordFeedbackAndLearn(userId, feedbackData, citedEntries);

      setFeedbackSubmitted(prev => new Set([...prev, insight.id]));

      // Log learning outcome
      if (learningResult) {
        console.log('[QuickInsights] Feedback recorded with learning:', {
          feedback: isPositive ? 'accurate' : 'inaccurate',
          accuracyRate: `${(learningResult.accuracyRate * 100).toFixed(0)}%`,
          confidenceMultiplier: learningResult.confidenceMultiplier.toFixed(2),
          suppressed: learningResult.suppressed
        });
      }
    } catch (error) {
      console.error('[QuickInsights] Failed to submit feedback:', error);
    }
  }, [userId, entries]);

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
        className="bg-white/30 dark:bg-hearth-900/30 border border-white/20 dark:border-hearth-800/20 rounded-2xl p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-warm-100/50 dark:bg-warm-900/50 rounded-xl">
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
        className="bg-white/30 dark:bg-hearth-900/30 border border-white/20 dark:border-hearth-800/20 rounded-2xl p-4"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-warm-100/50 dark:bg-warm-900/50 rounded-xl">
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
          className="bg-gradient-to-r from-sage-50/50 to-sage-100/50 dark:from-sage-950/30 dark:to-sage-900/30 border border-sage-200/30 dark:border-sage-800/30 rounded-2xl p-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-sage-400/20 to-sage-300/20 dark:from-sage-600/20 dark:to-sage-500/20 rounded-xl">
              <Loader2 size={18} className="text-sage-600 dark:text-sage-400 animate-spin" />
            </div>
            <div>
              <h3 className="font-semibold text-warm-800 dark:text-warm-100">Quick Insights</h3>
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
          className="bg-gradient-to-r from-sage-50/50 to-sage-100/50 dark:from-sage-950/30 dark:to-sage-900/30 border border-sage-200/30 dark:border-sage-800/30 rounded-2xl p-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-sage-400/20 to-sage-300/20 dark:from-sage-600/20 dark:to-sage-500/20 rounded-xl">
                <Zap size={18} className="text-sage-600 dark:text-sage-400" />
              </div>
              <div>
                <h3 className="font-semibold text-warm-800 dark:text-warm-100">Quick Insights</h3>
                <p className="text-xs text-warm-500">
                  Tap refresh to generate pattern insights
                </p>
              </div>
            </div>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="px-3 py-1.5 bg-sage-500 text-white text-sm font-medium rounded-lg hover:bg-sage-600 dark:bg-sage-600 dark:hover:bg-sage-500 transition-colors"
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
        return { icon: Activity, color: 'text-sage-600 dark:text-sage-400', bg: 'bg-sage-50 dark:bg-sage-900/30' };
      case 'people':
        return { icon: Heart, color: 'text-terra-600 dark:text-terra-400', bg: 'bg-terra-50 dark:bg-terra-900/30' };
      case 'health':
        return { icon: Heart, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30' };
      case 'environment':
        return { icon: Sun, color: 'text-honey-600 dark:text-honey-400', bg: 'bg-honey-50 dark:bg-honey-900/30' };
      case 'time':
        return { icon: Moon, color: 'text-lavender-600 dark:text-lavender-400', bg: 'bg-lavender-50 dark:bg-lavender-900/30' };
      default:
        return { icon: Zap, color: 'text-honey-600 dark:text-honey-400', bg: 'bg-honey-50 dark:bg-honey-900/30' };
    }
  };

  return (
    <motion.div
      className="bg-gradient-to-r from-sage-50/50 to-sage-100/50 dark:from-sage-950/30 dark:to-sage-900/30 border border-sage-200/30 dark:border-sage-800/30 rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-sage-400/20 to-sage-300/20 dark:from-sage-600/20 dark:to-sage-500/20 rounded-xl">
            <Zap size={18} className="text-sage-600 dark:text-sage-400" />
          </div>
          <div>
            <h3 className="font-semibold text-warm-800 dark:text-warm-100">Quick Insights</h3>
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
            className="p-2 rounded-xl hover:bg-white/50 dark:hover:bg-hearth-800/50 transition-colors disabled:opacity-50"
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
              className="bg-white/60 dark:bg-hearth-850/60 rounded-xl overflow-hidden"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="p-3 flex items-start gap-3">
                <div className={`p-1.5 rounded-lg ${style.bg}`}>
                  <Icon size={14} className={style.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-warm-700 dark:text-warm-200 leading-relaxed">
                    {insight.insight}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      insight.strength === 'strong'
                        ? 'bg-sage-100 text-sage-700 dark:bg-sage-900/40 dark:text-sage-300'
                        : 'bg-lavender-100 text-lavender-700 dark:bg-lavender-900/40 dark:text-lavender-300'
                    }`}>
                      {insight.strength}
                    </span>
                    <span className={`text-xs ${isPositive ? 'text-sage-600 dark:text-sage-400' : 'text-terra-600 dark:text-terra-400'}`}>
                      {isPositive ? '+' : ''}{insight.moodDelta}% mood
                    </span>
                    {insight.sampleSize && hasEntryIds && (
                      <button
                        onClick={() => setExpandedInsight(isExpanded ? null : insightKey)}
                        className="text-xs text-warm-500 hover:text-warm-700 dark:hover:text-warm-300 flex items-center gap-1 transition-colors"
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
                    className="border-t border-warm-200/50 dark:border-hearth-800/50 bg-warm-50/50 dark:bg-hearth-900/50"
                  >
                    <div className="p-3 space-y-2">
                      {/* Feedback & Export Row */}
                      <div className="flex items-center justify-between pb-2 border-b border-warm-200/30 dark:border-hearth-800/30">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-warm-500 mr-2">Is this accurate?</span>
                          {feedbackSubmitted.has(insight.id) ? (
                            <span className="text-xs text-sage-600 dark:text-sage-400 flex items-center gap-1">
                              <CheckCircle2 size={12} /> Thanks!
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleFeedback(insight, true); }}
                                className="p-1.5 hover:bg-sage-100 dark:hover:bg-sage-900/30 rounded-lg transition-colors"
                                title="Yes, accurate"
                              >
                                <ThumbsUp size={14} className="text-sage-600 dark:text-sage-400" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleFeedback(insight, false); }}
                                className="p-1.5 hover:bg-red-100 dark:hover:bg-red-950/30 rounded-lg transition-colors"
                                title="No, inaccurate"
                              >
                                <ThumbsDown size={14} className="text-red-500 dark:text-red-400" />
                              </button>
                            </>
                          )}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleExportInsight(insight); }}
                          className="flex items-center gap-1 text-xs text-warm-500 hover:text-warm-700 dark:hover:text-warm-300 px-2 py-1 hover:bg-warm-100 dark:hover:bg-hearth-800 rounded-lg transition-colors"
                          title="Export for debugging"
                        >
                          <Download size={12} />
                          Export
                        </button>
                      </div>

                      <p className="text-xs font-medium text-warm-500 uppercase tracking-wider">
                        Related Entries
                      </p>
                      {citedEntries.map((entry, i) => (
                        <button
                          key={entry.id || i}
                          onClick={() => setSelectedEntry(entry)}
                          className="w-full text-left bg-white/80 dark:bg-hearth-850/80 hover:bg-white dark:hover:bg-hearth-800 rounded-lg p-2 text-xs transition-colors cursor-pointer"
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
                                  entry.analysis.mood_score >= 0.6 ? 'text-sage-600 dark:text-sage-400' :
                                  entry.analysis.mood_score >= 0.4 ? 'text-honey-600 dark:text-honey-400' :
                                  'text-red-600 dark:text-red-400'
                                }`}>
                                  {Math.round(entry.analysis.mood_score * 100)}%
                                </span>
                              )}
                              <ChevronDown size={12} className="text-warm-400 -rotate-90" />
                            </div>
                          </div>
                          <p className="text-warm-700 dark:text-warm-200 line-clamp-2">
                            {(entry.content || entry.text || '').slice(0, 150)}
                            {(entry.content || entry.text || '').length > 150 ? '...' : ''}
                          </p>
                        </button>
                      ))}
                      {hiddenCount > 0 && !isShowingAll && (
                        <button
                          onClick={() => toggleShowAll(insightKey)}
                          className="w-full text-xs text-sage-600 hover:text-sage-700 dark:text-sage-400 dark:hover:text-sage-300 text-center py-1 hover:bg-sage-50 dark:hover:bg-sage-900/30 rounded-lg transition-colors"
                        >
                          +{hiddenCount} more entries — tap to show all
                        </button>
                      )}
                      {isShowingAll && hiddenCount > 0 && (
                        <button
                          onClick={() => toggleShowAll(insightKey)}
                          className="w-full text-xs text-warm-500 hover:text-warm-700 dark:hover:text-warm-300 text-center py-1 hover:bg-warm-100 dark:hover:bg-hearth-800 rounded-lg transition-colors"
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
              className="bg-white dark:bg-hearth-900 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 border-b border-warm-200 dark:border-hearth-800 flex items-center justify-between">
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
                        selectedEntry.analysis.mood_score >= 0.6 ? 'text-sage-600 dark:text-sage-400' :
                        selectedEntry.analysis.mood_score >= 0.4 ? 'text-honey-600 dark:text-honey-400' :
                        'text-red-600 dark:text-red-400'
                      }`}>
                        {Math.round(selectedEntry.analysis.mood_score * 100)}%
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="p-2 hover:bg-warm-100 dark:hover:bg-hearth-800 rounded-xl transition-colors"
                >
                  <X size={20} className="text-warm-500" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-4 overflow-y-auto max-h-[60vh]">
                <p className="text-warm-700 dark:text-warm-200 whitespace-pre-wrap leading-relaxed">
                  {selectedEntry.content || selectedEntry.text || 'No content available'}
                </p>

                {/* Tags if available */}
                {selectedEntry.analysis?.tags && selectedEntry.analysis.tags.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-warm-200 dark:border-hearth-800">
                    <p className="text-xs font-medium text-warm-500 uppercase tracking-wider mb-2">
                      Tags
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {selectedEntry.analysis.tags.map((tag, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-1 bg-warm-100 dark:bg-hearth-800 text-warm-600 dark:text-warm-400 rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary if available */}
                {selectedEntry.analysis?.summary && (
                  <div className="mt-4 pt-4 border-t border-warm-200 dark:border-hearth-800">
                    <p className="text-xs font-medium text-warm-500 uppercase tracking-wider mb-2">
                      Summary
                    </p>
                    <p className="text-sm text-warm-600 dark:text-warm-400 italic">
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
          gradient: 'from-terra-500/10 to-terra-400/10 dark:from-terra-500/20 dark:to-terra-400/20',
          border: 'border-terra-200/30 dark:border-terra-800/30',
          iconBg: 'bg-terra-500/20',
          iconColor: 'text-terra-600 dark:text-terra-400',
          label: 'Belief Pattern'
        };
      case 'narrative_arc':
      case 'growth':
        return {
          icon: TrendingUp,
          gradient: 'from-sage-500/10 to-sage-400/10 dark:from-sage-500/20 dark:to-sage-400/20',
          border: 'border-sage-200/30 dark:border-sage-800/30',
          iconBg: 'bg-sage-500/20',
          iconColor: 'text-sage-600 dark:text-sage-400',
          label: 'Growth Pattern'
        };
      case 'recommendation':
      case 'intervention':
        return {
          icon: Lightbulb,
          gradient: 'from-honey-500/10 to-honey-400/10 dark:from-honey-500/20 dark:to-honey-400/20',
          border: 'border-honey-200/30 dark:border-honey-800/30',
          iconBg: 'bg-honey-500/20',
          iconColor: 'text-honey-600 dark:text-honey-400',
          label: 'Recommendation'
        };
      case 'counterfactual':
        return {
          icon: Sparkles,
          gradient: 'from-lavender-500/10 to-lavender-400/10 dark:from-lavender-500/20 dark:to-lavender-400/20',
          border: 'border-lavender-200/30 dark:border-lavender-800/30',
          iconBg: 'bg-lavender-500/20',
          iconColor: 'text-lavender-600 dark:text-lavender-400',
          label: 'What If'
        };
      case 'causal_synthesis':
        return {
          icon: Brain,
          gradient: 'from-lavender-500/10 to-sage-500/10 dark:from-lavender-500/20 dark:to-sage-500/20',
          border: 'border-lavender-200/30 dark:border-lavender-800/30',
          iconBg: 'bg-lavender-500/20',
          iconColor: 'text-lavender-600 dark:text-lavender-400',
          label: 'Deep Insight'
        };
      default:
        return {
          icon: Brain,
          gradient: 'from-honey-500/10 to-lavender-500/10 dark:from-honey-500/20 dark:to-lavender-500/20',
          border: 'border-honey-200/30 dark:border-honey-800/30',
          iconBg: 'bg-honey-500/20',
          iconColor: 'text-honey-600 dark:text-honey-400',
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
              <p className="font-medium text-warm-800 dark:text-warm-100 mt-1 break-words">
                {getStringContent(insight.title) || `Try: ${insight.intervention}`}
              </p>
            )}

            {/* Summary - RES-002: Added break-words for text reflow */}
            <p className="text-sm text-warm-700 dark:text-warm-200 mt-1 leading-relaxed break-words">
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
            <div className="px-4 pb-4 pt-0 border-t border-warm-200/30 dark:border-hearth-800/30 mt-0">
              <div className="pt-4 space-y-4">

                {/* Full Body Text */}
                {getStringContent(insight.body) && (
                  <div>
                    <h4 className="text-xs font-bold text-warm-500 uppercase tracking-wider mb-2">
                      Analysis
                    </h4>
                    <p className="text-sm text-warm-700 dark:text-warm-200 leading-relaxed whitespace-pre-line">
                      {insight.body}
                    </p>
                  </div>
                )}

                {/* Mechanism */}
                {getStringContent(insight.mechanism) && (
                  <div className="bg-white/40 dark:bg-hearth-850/40 rounded-xl p-3">
                    <h4 className="text-xs font-bold text-warm-500 uppercase tracking-wider mb-1">
                      Why This Happens
                    </h4>
                    <p className="text-sm text-warm-700 dark:text-warm-200">
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
                        <div key={i} className="bg-white/40 dark:bg-hearth-850/40 rounded-lg p-2 text-sm text-warm-600 dark:text-warm-400 italic">
                          "{typeof item === 'string' ? item : JSON.stringify(item)}"
                        </div>
                      ))}
                      {insight.evidence?.biometric?.map((item, i) => (
                        <div key={i} className="bg-sage-50/50 dark:bg-sage-900/30 rounded-lg p-2 text-sm text-sage-700 dark:text-sage-300 flex items-center gap-2">
                          <Activity size={14} />
                          {typeof item === 'string' ? item : JSON.stringify(item)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendation Details */}
                {(insight.recommendation?.action || insight.recommendation?.reasoning) && (
                  <div className="bg-honey-50/50 dark:bg-honey-950/30 rounded-xl p-3">
                    <h4 className="text-xs font-bold text-honey-600 dark:text-honey-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                      <Target size={12} />
                      Recommended Action
                    </h4>
                    {getStringContent(insight.recommendation.action) && (
                      <p className="text-sm text-warm-800 dark:text-warm-200 font-medium">
                        {insight.recommendation.action}
                      </p>
                    )}
                    {getStringContent(insight.recommendation.reasoning) && (
                      <p className="text-sm text-warm-600 dark:text-warm-400 mt-1">
                        {insight.recommendation.reasoning}
                      </p>
                    )}
                    {getStringContent(insight.recommendation.expectedOutcome) && (
                      <p className="text-xs text-honey-600 dark:text-honey-400 mt-2">
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
