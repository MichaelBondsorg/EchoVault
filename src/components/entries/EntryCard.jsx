import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Trash2, Calendar, Edit2, Check, RefreshCw, Lightbulb, Wind, Sparkles,
  Brain, Info, Footprints, Clipboard, X, Compass,
  Sun, Moon, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudDrizzle, CloudSun, CloudMoon,
  Thermometer, Activity, BedDouble, Battery, Zap
} from 'lucide-react';
import { safeString, formatMentions } from '../../utils/string';
import { formatDateForInput, getTodayForInput, parseDateInput, getDateString } from '../../utils/date';
import { getEntryTypeColors, getEntityTypeColors, getTherapeuticColors } from '../../utils/colorMap';

// Entity tag emoji lookup (hoisted for performance - used in tag rendering)
const ENTITY_EMOJIS = {
  '@person:': '👤', '@place:': '📍', '@goal:': '🎯',
  '@situation:': '📌', '@self:': '💭', '@activity:': '🏃',
  '@media:': '🎬', '@event:': '📅', '@food:': '🍽️', '@topic:': '💬'
};
const ENTITY_PREFIXES = Object.keys(ENTITY_EMOJIS);

// Weather icon mapping
const getWeatherIcon = (condition, isDay = true) => {
  const icons = {
    clear: isDay ? Sun : Moon,
    mostly_clear: isDay ? Sun : Moon,
    partly_cloudy: isDay ? CloudSun : CloudMoon,
    overcast: Cloud,
    foggy: CloudFog,
    drizzle: CloudDrizzle,
    rain: CloudRain,
    heavy_rain: CloudRain,
    snow: CloudSnow,
    heavy_snow: CloudSnow,
    rain_showers: CloudRain,
    snow_showers: CloudSnow,
    thunderstorm: CloudLightning
  };
  return icons[condition] || Cloud;
};

/**
 * Primary Readiness Metric Component
 * Displays the most relevant health metric based on data source:
 * - Whoop users: Recovery Score (green/yellow/red zones)
 * - HealthKit-only users: Sleep Score (calculated from sleep data)
 * - Merged: Recovery Score (Whoop priority)
 */
const PrimaryReadinessMetric = ({ healthContext }) => {
  if (!healthContext) return null;

  const source = healthContext.source;
  const recovery = healthContext.recovery?.score;
  const sleepScore = healthContext.sleep?.score;
  const sleepHours = healthContext.sleep?.totalHours;

  // Determine which metric to show as primary
  const hasWhoop = source === 'whoop' || source === 'merged';
  const hasRecovery = recovery && recovery > 0;
  const hasSleepScore = sleepScore && sleepScore > 0;

  // Whoop users (or merged): Recovery is primary
  if (hasWhoop && hasRecovery) {
    const recoveryColor = recovery >= 67 ? 'bg-sage-100 text-sage-700 border-sage-200 dark:bg-sage-900/30 dark:text-sage-300 dark:border-sage-700' :
                          recovery >= 34 ? 'bg-honey-100 text-honey-700 border-honey-200 dark:bg-honey-900/30 dark:text-honey-300 dark:border-honey-700' :
                          'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'; /* @color-safe: health warning */
    return (
      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium ${recoveryColor}`}>
        <Battery size={12} />
        <span className="font-semibold">{recovery}%</span>
        <span className="hidden sm:inline text-[9px] opacity-75">recovery</span>
      </span>
    );
  }

  // HealthKit-only users: Sleep Score is primary
  if (hasSleepScore) {
    const sleepColor = sleepScore >= 80 ? 'bg-sage-100 text-sage-700 border-sage-200 dark:bg-sage-900/30 dark:text-sage-300 dark:border-sage-700' :
                       sleepScore >= 60 ? 'bg-lavender-100 text-lavender-700 border-lavender-200 dark:bg-lavender-900/30 dark:text-lavender-300 dark:border-lavender-700' :
                       'bg-terra-100 text-terra-700 border-terra-200 dark:bg-terra-900/30 dark:text-terra-300 dark:border-terra-700';
    return (
      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium ${sleepColor}`}>
        <BedDouble size={12} />
        <span className="font-semibold">{sleepScore}</span>
        <span className="hidden sm:inline text-[9px] opacity-75">sleep</span>
      </span>
    );
  }

  // Fallback: Show sleep hours if available
  if (sleepHours && sleepHours > 0) {
    const hoursColor = sleepHours >= 7 ? 'bg-sage-50 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300' :
                       sleepHours >= 5 ? 'bg-honey-50 text-honey-700 dark:bg-honey-900/30 dark:text-honey-300' :
                       'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'; /* @color-safe: health warning */
    return (
      <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full ${hoursColor}`}>
        <BedDouble size={10} />
        {sleepHours.toFixed(1)}h sleep
      </span>
    );
  }

  return null;
};

// Mood color utility
const getMoodColor = (score) => {
  if (score === null || score === undefined) return 'border-warm-200';
  if (score >= 0.75) return 'border-l-mood-great';
  if (score >= 0.55) return 'border-l-mood-good';
  if (score >= 0.35) return 'border-l-mood-neutral';
  if (score >= 0.15) return 'border-l-mood-low';
  return 'border-l-mood-struggling';
};

const EntryCard = ({ entry, onDelete, onUpdate }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [showAllTags, setShowAllTags] = useState(false); // LAY-001: Control tag overflow
  // Use effectiveDate if set, otherwise fall back to createdAt
  const [editDate, setEditDate] = useState(
    formatDateForInput(entry.effectiveDate || entry.createdAt)
  );
  const isPending = entry.analysisStatus === 'pending';
  const entryType = entry.entry_type || 'reflection';
  const isTask = entryType === 'task';
  const isMixed = entryType === 'mixed';
  const isVent = entryType === 'vent';

  useEffect(() => { setTitle(entry.title); }, [entry.title]);
  useEffect(() => {
    setEditDate(formatDateForInput(entry.effectiveDate || entry.createdAt));
  }, [entry.effectiveDate, entry.createdAt]);

  const insightMsg = entry.contextualInsight?.message ? formatMentions(safeString(entry.contextualInsight.message)) : null;
  const cbt = entry.analysis?.cbt_breakdown;
  const actAnalysis = entry.analysis?.act_analysis;
  const ventSupport = entry.analysis?.vent_support;
  const celebration = entry.analysis?.celebration;
  const taskAcknowledgment = entry.analysis?.task_acknowledgment;

  // Determine framework with backwards compatibility for legacy entries
  const framework = entry.analysis?.framework || (cbt ? 'cbt' : 'general');

  const toggleCategory = () => {
    const newCategory = entry.category === 'work' ? 'personal' : 'work';
    onUpdate(entry.id, { category: newCategory });
  };

  const cardStyle = isTask
    ? 'bg-honey-50 border-honey-200 dark:bg-honey-900/20 dark:border-honey-800'
    : 'bg-white border-warm-100 dark:bg-hearth-900 dark:border-hearth-800';

  const moodBorderColor = getMoodColor(entry.analysis?.mood_score);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl p-5 shadow-soft border hover:shadow-soft-lg transition-shadow mb-4 relative overflow-hidden border-l-4 ${cardStyle} ${moodBorderColor}`}
    >
      {isPending && <div className="absolute top-0 left-0 right-0 h-1 bg-warm-100"><div className="h-full bg-honey-500 animate-progress-indeterminate"></div></div>}

      {/* Insight Box */}
      {entry.contextualInsight?.found && insightMsg && !isTask && (() => {
        const insightType = entry.contextualInsight.type;
        const isPositive = ['progress', 'streak', 'absence', 'encouragement'].includes(insightType);
        const isWarning = insightType === 'warning';
        const colorClass = isWarning
          ? 'bg-red-50 border-red-100 text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-200' /* @color-safe: warning insight */
          : isPositive
            ? 'bg-sage-50 border-sage-100 text-sage-800 dark:bg-sage-900/30 dark:border-sage-800 dark:text-sage-200'
            : 'bg-honey-50 border-honey-100 text-honey-800 dark:bg-honey-900/30 dark:border-honey-800 dark:text-honey-200';
        return (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className={`mb-4 p-3 rounded-xl text-sm border flex gap-3 ${colorClass}`}
          >
            <Lightbulb size={18} className="shrink-0 mt-0.5"/>
            <div>
              <div className="font-display font-bold text-[10px] uppercase opacity-75 tracking-wider mb-1">{safeString(insightType)}</div>
              {insightMsg}
              {cbt?.validation && (
                <p className="mt-2 text-warm-600 italic border-t border-warm-200 pt-2">{cbt.validation}</p>
              )}
            </div>
          </motion.div>
        );
      })()}

      {/* Vent Support Display */}
      {isVent && ventSupport && (
        <div className="mb-4 space-y-3">
          {ventSupport.validation && (
            <p className="text-warm-500 italic text-sm">{ventSupport.validation}</p>
          )}
          {ventSupport.cooldown && (
            <div className="bg-sage-50 p-3 rounded-xl border border-sage-100">
              <div className="flex items-center gap-2 text-sage-700 font-display font-semibold text-xs uppercase mb-2">
                <Wind size={14} /> {ventSupport.cooldown.technique || 'Grounding'}
              </div>
              <p className="text-sm text-sage-800 font-body">{ventSupport.cooldown.instruction}</p>
            </div>
          )}
        </div>
      )}

      {/* Celebration Display */}
      {framework === 'celebration' && celebration && (() => {
        const celebColors = getTherapeuticColors('celebration');
        return (
        <div className="mb-4 space-y-3">
          {celebration.affirmation && (
            <div className={`bg-gradient-to-r from-sage-50 to-sage-100 p-3 rounded-xl border ${celebColors.border} dark:from-sage-900/30 dark:to-sage-800/20`}>
              <div className={`flex items-center gap-2 ${celebColors.text} font-display font-semibold text-xs uppercase mb-2`}>
                <Sparkles size={14} /> Nice!
              </div>
              <p className={`text-sm font-body ${celebColors.text}`}>{celebration.affirmation}</p>
              {celebration.amplify && (
                <p className="text-xs text-sage-600 dark:text-sage-400 mt-2 italic">{celebration.amplify}</p>
              )}
            </div>
          )}
        </div>
        );
      })()}

      {/* ACT (Acceptance & Commitment) Display */}
      {framework === 'act' && actAnalysis && (() => {
        const actColors = getTherapeuticColors('ACT');
        const valuesColors = getTherapeuticColors('values');
        const commitColors = getTherapeuticColors('committed_action');
        return (
        <div className="mb-4 space-y-3">
          <div className={`${actColors.bg} rounded-xl p-4 border ${actColors.border}`}>
            {/* Header with technique badge */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wind className="text-sage-600 dark:text-sage-400" size={16} />
                <span className="text-xs font-bold text-sage-700 dark:text-sage-300 uppercase">Defusion</span>
              </div>
              {actAnalysis.defusion_technique && (
                <span className="text-[10px] font-semibold text-sage-600 dark:text-sage-300 bg-sage-200 dark:bg-sage-800/50 px-2 py-0.5 rounded-full">
                  {actAnalysis.defusion_technique.replace('_', ' ')}
                </span>
              )}
            </div>

            {/* Fusion thought (the "hook") */}
            {actAnalysis.fusion_thought && (
              <div className="text-sage-900 dark:text-sage-100 text-sm mb-2">
                <span className="opacity-75">Instead of: </span>
                <span className="line-through decoration-sage-300 dark:decoration-sage-600">"{actAnalysis.fusion_thought}"</span>
              </div>
            )}

            {/* Defusion phrase */}
            {actAnalysis.defusion_phrase && (
              <div className="text-sage-800 dark:text-sage-200 font-medium text-sm bg-white/50 dark:bg-hearth-800/50 p-2 rounded-lg">
                Try: "{actAnalysis.defusion_phrase}"
              </div>
            )}

            {/* Values context */}
            {actAnalysis.values_context && (
              <div className={`mt-3 pt-3 border-t ${actColors.border} flex items-center gap-2`}>
                <Compass size={14} className={valuesColors.text} />
                <span className={`text-xs ${valuesColors.text}`}>
                  <span className="font-semibold">Value:</span> {actAnalysis.values_context}
                </span>
              </div>
            )}
          </div>

          {/* Committed Action */}
          {actAnalysis.committed_action && (
            <div className={`${commitColors.bg} p-3 rounded-xl border ${commitColors.border}`}>
              <div className={`flex items-center gap-2 ${commitColors.text} font-display font-semibold text-xs uppercase mb-2`}>
                <Footprints size={14} /> Committed Action
              </div>
              <p className={`text-sm font-medium font-body ${commitColors.text}`}>{actAnalysis.committed_action}</p>
              <p className="text-xs text-honey-600 dark:text-honey-400 mt-1 italic">Do this regardless of how you feel right now.</p>
            </div>
          )}
        </div>
        );
      })()}

      {/* Task Acknowledgment */}
      {isMixed && taskAcknowledgment && (
        <p className="text-warm-500 italic text-sm mb-4">{taskAcknowledgment}</p>
      )}

      {/* Enhanced CBT Breakdown */}
      {framework === 'cbt' && cbt && (
        <div className="mb-4 space-y-3">
          {cbt.validation && !entry.contextualInsight?.found && (
            <p className="text-warm-500 italic text-sm">{cbt.validation}</p>
          )}

          {cbt.distortion && (
            entry.analysis?.mood_score < 0.4 ||
            ['Catastrophizing', 'All-or-Nothing Thinking', 'All-or-Nothing', 'Mind Reading', 'Fortune Telling', 'Emotional Reasoning'].some(d =>
              cbt.distortion?.toLowerCase().includes(d.toLowerCase())
            )
          ) && (
            <div className="flex items-center gap-2">
              <span className="bg-accent-light text-accent-dark px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                <Info size={12} />
                {cbt.distortion}
              </span>
            </div>
          )}

          {cbt.automatic_thought && (
            <div className="text-sm text-warm-700 font-body">
              <span className="font-semibold">Thought:</span> {cbt.automatic_thought}
            </div>
          )}

          {cbt.perspective && (
            <div className="bg-gradient-to-r from-sage-50 to-sage-100 p-3 rounded-xl border-l-4 border-sage-400">
              <div className="text-xs font-display font-semibold text-sage-600 uppercase mb-1">Perspective</div>
              <p className="text-sm text-warm-700 font-body">{cbt.perspective}</p>
            </div>
          )}

          {!cbt.perspective && cbt.socratic_question && (
            <div className="bg-sage-50 p-3 rounded-xl border-l-4 border-sage-400">
              <div className="text-xs font-display font-semibold text-sage-600 uppercase mb-1">Reflect:</div>
              <p className="text-sm text-sage-800 font-body">{cbt.socratic_question}</p>
            </div>
          )}

          {!cbt.perspective && (cbt.suggested_reframe || cbt.challenge) && (
            <div className="text-sm font-body">
              <span className="text-sage-700 dark:text-sage-300 font-semibold">Try thinking:</span>{' '}
              <span className="text-sage-800 dark:text-sage-200">{cbt.suggested_reframe || cbt.challenge}</span>
            </div>
          )}

          {cbt.behavioral_activation && (
            <div className="bg-lavender-50 p-3 rounded-xl border border-lavender-100">
              <div className="flex items-center gap-2 text-lavender-700 font-display font-semibold text-xs uppercase mb-2">
                <Footprints size={14} /> Try This (Under 5 min)
              </div>
              <p className="text-sm text-lavender-800 font-medium font-body">{cbt.behavioral_activation.activity}</p>
              {cbt.behavioral_activation.rationale && (
                <p className="text-xs text-lavender-600 mt-1">{cbt.behavioral_activation.rationale}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legacy CBT Breakdown */}
      {framework === 'cbt' && cbt && !cbt.validation && !cbt.socratic_question && cbt.challenge && !cbt.suggested_reframe && (
        <div className="mb-4 bg-sage-50 p-3 rounded-xl border border-sage-100 text-sm space-y-2">
          <div className="flex items-center gap-2 text-sage-700 font-display font-bold text-xs uppercase"><Brain size={12}/> Cognitive Restructuring</div>
          <div className="grid gap-2 font-body">
            <div><span className="font-semibold text-sage-900">Thought:</span> {cbt.automatic_thought}</div>
            <div className="bg-white dark:bg-hearth-800 p-2 rounded-lg border border-sage-100 dark:border-sage-800"><span className="font-semibold text-sage-700 dark:text-sage-300">Challenge:</span> {cbt.challenge}</div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-start mb-3">
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={toggleCategory}
            className={`text-[10px] font-display font-bold px-2 py-0.5 rounded-full uppercase tracking-wide hover:opacity-80 transition-opacity flex items-center gap-1 ${entry.category === 'work' ? 'bg-warm-100 text-warm-600' : 'bg-accent-light text-accent-dark'}`}
            title="Click to switch category"
          >
            {entry.category}
            <RefreshCw size={8} className="opacity-50" />
          </button>
          {entryType !== 'reflection' && (() => {
            const typeColors = getEntryTypeColors(entryType);
            return (
              <span className={`text-[10px] font-display font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1 ${typeColors.bg} ${typeColors.text}`}>
                {isMixed && <Clipboard size={10} />}
                {entryType}
              </span>
            );
          })()}
          {/* LAY-001: Limit visible tags to prevent overflow */}
          {(() => {
            const MAX_VISIBLE_TAGS = 5;
            const visibleTags = showAllTags ? entry.tags : entry.tags.slice(0, MAX_VISIBLE_TAGS);
            const hiddenCount = entry.tags.length - MAX_VISIBLE_TAGS;

            return (
              <>
                {visibleTags.map((t, i) => {
                  const tag = safeString(t);
                  // Helper to format entity names (replace underscores with spaces, title case)
                  const formatName = (prefix) => tag.replace(prefix, '').replace(/_/g, ' ');

                  const entityPrefix = ENTITY_PREFIXES.find(p => tag.startsWith(p));

                  if (entityPrefix) {
                    const entityType = entityPrefix.slice(0, -1); // Remove trailing ':'
                    const colors = getEntityTypeColors(entityType);
                    return <span key={i} className={`text-[10px] font-semibold ${colors.text} ${colors.bg} px-2 py-0.5 rounded-full`}>{ENTITY_EMOJIS[entityPrefix]} {formatName(entityPrefix)}</span>;
                  } else if (tag.startsWith('@')) {
                    // Unknown @ tag - show without prefix
                    return <span key={i} className="text-[10px] font-semibold text-warm-600 bg-warm-50 px-2 py-0.5 rounded-full">{tag.split(':')[1]?.replace(/_/g, ' ') || tag}</span>;
                  }
                  return <span key={i} className="text-[10px] font-semibold text-sage-600 bg-sage-50 px-2 py-0.5 rounded-full">#{tag}</span>;
                })}
                {/* Show "+N more" button when tags are hidden */}
                {hiddenCount > 0 && !showAllTags && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAllTags(true);
                    }}
                    className="text-[10px] font-semibold text-warm-500 bg-warm-100 px-2 py-0.5 rounded-full hover:bg-warm-200 transition-colors"
                  >
                    +{hiddenCount} more
                  </button>
                )}
                {/* Show "Show less" button when all tags are visible */}
                {showAllTags && entry.tags.length > MAX_VISIBLE_TAGS && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAllTags(false);
                    }}
                    className="text-[10px] font-semibold text-warm-500 bg-warm-100 px-2 py-0.5 rounded-full hover:bg-warm-200 transition-colors"
                  >
                    Show less
                  </button>
                )}
              </>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          {typeof entry.analysis?.mood_score === 'number' && entry.analysis.mood_score !== null && (
            <span className="px-2 py-1 rounded-full text-[10px] font-display font-bold bg-warm-100">{(entry.analysis.mood_score * 100).toFixed(0)}%</span>
          )}
          <button onClick={() => onDelete(entry.id)} className="text-warm-300 hover:text-red-400 transition-colors"><Trash2 size={16}/></button>
        </div>
      </div>

      <div className="mb-2">
        {editing ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="flex-1 font-display font-bold text-lg border-b-2 border-honey-500 focus:outline-none bg-transparent"
                placeholder="Entry title"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor={`entry-date-${entry.id}`}
                className="text-xs text-warm-500 font-medium flex items-center gap-1"
              >
                <Calendar size={12} />
                Entry Date:
              </label>
              <input
                id={`entry-date-${entry.id}`}
                type="date"
                value={editDate}
                onChange={e => setEditDate(e.target.value)}
                max={getTodayForInput()}
                className="text-sm border border-warm-200 rounded-lg px-2 py-1 focus:outline-none focus:border-honey-500"
              />
              <button
                onClick={() => {
                  const newDate = parseDateInput(editDate);

                  // Validate: prevent future dates
                  const today = new Date();
                  today.setHours(23, 59, 59, 999);
                  if (newDate > today) {
                    alert('Cannot select future dates');
                    return;
                  }

                  const updates = { title };
                  const options = {};

                  // Only include effectiveDate if it differs from original
                  const originalDate = entry.effectiveDate || entry.createdAt;
                  if (getDateString(newDate) !== getDateString(originalDate)) {
                    updates.effectiveDate = newDate;
                    // Pass date change info via options
                    options.dateChanged = {
                      oldDate: originalDate,
                      newDate: newDate
                    };
                  }
                  onUpdate(entry.id, updates, options);
                  setEditing(false);
                }}
                className="text-sage-600 hover:text-sage-700 dark:text-sage-400 dark:hover:text-sage-300"
              >
                <Check size={18}/>
              </button>
              <button
                onClick={() => {
                  setTitle(entry.title);
                  setEditDate(formatDateForInput(entry.effectiveDate || entry.createdAt));
                  setEditing(false);
                }}
                className="text-warm-400 hover:text-warm-600"
              >
                <X size={18}/>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h3 className={`text-lg font-display font-bold text-warm-800 ${isPending ? 'animate-pulse' : ''}`}>{isPending ? "Processing..." : title}</h3>
            {!isPending && <button onClick={() => setEditing(true)} className="text-warm-300 hover:text-honey-500 opacity-50 hover:opacity-100"><Edit2 size={14}/></button>}
          </div>
        )}
      </div>

      <div className="text-xs text-warm-400 mb-2 flex items-center gap-1 font-medium">
        <Calendar size={12}/>
        {(entry.effectiveDate || entry.createdAt).toLocaleDateString()}
        {entry.effectiveDate && getDateString(entry.effectiveDate) !== getDateString(entry.createdAt) && (
          <span className="text-warm-300 ml-1">(edited)</span>
        )}
      </div>

      {/* Environment & Health Context Strip */}
      {(entry.environmentContext || entry.healthContext) && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-warm-500 mb-3 pb-2 border-b border-warm-100">
          {/* Weather Context */}
          {entry.environmentContext && (() => {
            const env = entry.environmentContext;
            const WeatherIcon = getWeatherIcon(env.weather, env.isDay !== false);
            const dayCondition = env.daySummary?.condition;
            const showDaySummary = dayCondition && dayCondition !== env.weather;

            return (
              <>
                <span className="flex items-center gap-1 bg-lavender-50 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300 px-1.5 py-0.5 rounded-full">
                  <WeatherIcon size={10} />
                  {env.temperature !== null && (
                    <span>{Math.round(env.temperature)}°</span>
                  )}
                  {env.weatherLabel && (
                    <span className="hidden sm:inline">{env.weatherLabel}</span>
                  )}
                </span>
                {/* Day summary if different from point-in-time */}
                {showDaySummary && (
                  <span className="flex items-center gap-1 bg-warm-50 text-warm-600 dark:bg-warm-900/30 dark:text-warm-300 px-1.5 py-0.5 rounded-full">
                    {(() => {
                      const DayIcon = getWeatherIcon(dayCondition, true);
                      return <DayIcon size={10} />;
                    })()}
                    <span>{env.daySummary.conditionLabel} day</span>
                    {env.daySummary.tempHigh !== null && env.daySummary.tempLow !== null && (
                      <span className="hidden sm:inline">
                        ({Math.round(env.daySummary.tempHigh)}°/{Math.round(env.daySummary.tempLow)}°)
                      </span>
                    )}
                  </span>
                )}
                {/* Sunshine percent for low-light days */}
                {env.daySummary?.isLowSunshine && env.daySummary?.sunshinePercent !== undefined && (
                  <span className="text-honey-600 dark:text-honey-400 hidden sm:inline">
                    {env.daySummary.sunshinePercent}% sunshine
                  </span>
                )}
              </>
            );
          })()}

          {/* Health Context - Prioritized display */}
          {entry.healthContext && (() => {
            const health = entry.healthContext;
            const source = health.source;
            const hasWhoop = source === 'whoop' || source === 'merged';

            return (
              <>
                {/* Primary Readiness Metric (Recovery for Whoop, Sleep Score for HealthKit) */}
                <PrimaryReadinessMetric healthContext={health} />

                {/* Secondary metrics shown on larger screens */}
                {/* Sleep hours (if primary is recovery, show hours as secondary) */}
                {hasWhoop && health.recovery?.score > 0 && health.sleep?.totalHours > 0 && (
                  <span className="hidden md:flex items-center gap-1 bg-lavender-50 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300 px-1.5 py-0.5 rounded-full text-[10px]">
                    <BedDouble size={10} />
                    {health.sleep.totalHours.toFixed(1)}h
                  </span>
                )}

                {/* HRV */}
                {health.heart?.hrv > 0 && (
                  <span className={`hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
                    health.heart.hrvTrend === 'improving' ? 'bg-sage-50 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300' :
                    health.heart.hrvTrend === 'declining' ? 'bg-terra-50 text-terra-700 dark:bg-terra-900/30 dark:text-terra-300' :
                    'bg-warm-50 text-warm-600 dark:bg-warm-900/30 dark:text-warm-300'
                  }`}>
                    <Activity size={10} />
                    HRV {health.heart.hrv}ms
                  </span>
                )}

                {/* Strain (Whoop only) */}
                {hasWhoop && health.strain?.score > 0 && (
                  <span className={`hidden md:flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
                    health.strain.score >= 15 ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' /* @color-safe: high strain warning */ :
                    health.strain.score >= 10 ? 'bg-terra-50 text-terra-700 dark:bg-terra-900/30 dark:text-terra-300' :
                    'bg-lavender-50 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300'
                  }`}>
                    <Zap size={10} />
                    {health.strain.score.toFixed(1)} strain
                  </span>
                )}

                {/* Steps - always show on larger screens */}
                {health.activity?.stepsToday > 0 && (
                  <span className="hidden sm:flex items-center gap-1 bg-sage-50 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300 px-1.5 py-0.5 rounded-full">
                    <Footprints size={10} />
                    {health.activity.stepsToday.toLocaleString()}
                  </span>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* TXT-002: Added max-w-prose for optimal line length (50-75 characters) */}
      {/* TXT-003: Improved line-height and paragraph spacing for readability */}
      <div className="text-warm-600 text-sm whitespace-pre-wrap leading-7 font-body max-w-prose [&>*]:mb-3">
        {entry.text?.split(/\n\n+/).map((paragraph, i) => (
          <p key={i} className={i > 0 ? 'mt-4' : ''}>{paragraph}</p>
        )) || entry.text}
      </div>

      {/* Extracted Tasks for mixed entries */}
      {isMixed && entry.extracted_tasks && entry.extracted_tasks.length > 0 && (
        <div className="mt-4 pt-3 border-t border-warm-100">
          <div className="text-xs font-display font-semibold text-warm-500 uppercase mb-2 flex items-center gap-1">
            <Clipboard size={12} /> Tasks
          </div>
          <div className="space-y-1">
            {entry.extracted_tasks.map((rawTask, i) => {
              // Handle both object tasks and legacy string tasks
              const task = typeof rawTask === 'string'
                ? { text: rawTask, completed: false, recurrence: null }
                : rawTask;
              const taskText = task?.text || (typeof rawTask === 'string' ? rawTask : JSON.stringify(rawTask));

              // For recurring tasks, check if waiting for next due date
              const isWaitingForNextDue = task?.recurrence && task?.nextDueDate && new Date(task.nextDueDate) > new Date();
              const displayAsCompleted = task?.completed || isWaitingForNextDue;

              // Helper to calculate next due date
              const calculateNextDueDate = (recurrence) => {
                const next = new Date();
                const { interval, unit } = recurrence;
                switch (unit) {
                  case 'days':
                    next.setDate(next.getDate() + interval);
                    break;
                  case 'weeks':
                    next.setDate(next.getDate() + (interval * 7));
                    break;
                  case 'months':
                    next.setMonth(next.getMonth() + interval);
                    break;
                  default:
                    next.setDate(next.getDate() + interval);
                }
                return next.toISOString();
              };

              return (
                <div key={i} className="flex items-center gap-2 text-sm font-body">
                  <input
                    type="checkbox"
                    checked={displayAsCompleted}
                    onChange={() => {
                      const updatedTasks = [...entry.extracted_tasks];
                      if (task.recurrence) {
                        // For recurring tasks, set next due date
                        updatedTasks[i] = {
                          ...task,
                          completed: false,
                          lastCompletedAt: new Date().toISOString(),
                          nextDueDate: calculateNextDueDate(task.recurrence)
                        };
                      } else {
                        // For non-recurring, toggle completed
                        updatedTasks[i] = {
                          ...task,
                          completed: !task.completed,
                          completedAt: !task.completed ? new Date().toISOString() : null
                        };
                      }
                      onUpdate(entry.id, { extracted_tasks: updatedTasks });
                    }}
                    className="rounded border-warm-300 text-honey-600 focus:ring-honey-500"
                  />
                  <span className={displayAsCompleted ? 'line-through text-warm-400' : 'text-warm-700'}>
                    {taskText}
                  </span>
                  {task?.recurrence && (
                    <span className="badge-recurring">
                      <RefreshCw size={10} className="inline mr-1" />
                      {task.recurrence.description || task.recurrence.pattern}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default EntryCard;
