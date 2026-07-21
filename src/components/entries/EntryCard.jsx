import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Trash2, Calendar, Edit2, Check, RefreshCw, Lightbulb, Wind, Sparkles,
  Brain, Info, Footprints, Clipboard, X, Compass, Tag,
  Sun, Moon, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudDrizzle, CloudSun, CloudMoon,
  Thermometer, Activity, BedDouble, Battery, Zap
} from 'lucide-react';
import { safeString, formatMentions } from '../../utils/string';
import { formatDateForInput, getTodayForInput, parseDateInput, getDateString } from '../../utils/date';
import { accentForMood } from '../../utils/moodTrend';
import { getFlag } from '../../config/flags';
import { db } from '../../config/firebase';
import { useUser } from '../../stores';
import { subscribeSpaces } from '../../services/spaces/spacesService';
import { useDismissablePopover } from '../../hooks/useDismissablePopover';
import { Chip } from '../cloud';
import SpacePicker from '../spaces/SpacePicker';
import ProvenanceDisclosure from '../ui/ProvenanceDisclosure';
import IntentSuggestionTray from './IntentSuggestionTray';

/**
 * SpaceChip — Context Space re-scoping affordance for a saved entry (PRD R1
 * Context Spaces, plan task 9). Mirrors EntryBar's SpacePill (same popover
 * pattern, now the shared `SpacePicker` — R2 task 4), but writes back to
 * the entry itself: selecting a space calls `onSelect` with the entry's
 * own updateDoc payload, `{spaceId, updatedAt}` — and nothing else ever
 * changes (createdAt/effectiveDate/transcription stay untouched).
 *
 * Dismissal (review fix): an outside tap or Escape closes the popover via
 * the shared `useDismissablePopover` hook.
 */
const SpaceChip = ({ spaces, selectedId, onSelect, open, onToggle, onDismiss }) => {
  const selected = spaces.find((s) => s.id === selectedId) || null;
  const containerRef = useDismissablePopover(open, onDismiss);
  return (
    <div className="relative inline-block" ref={containerRef}>
      <Chip
        as="button"
        type="button"
        onClick={onToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={selected ? `Space: ${selected.name}` : 'Assign a space'}
        className="text-[10px]"
      >
        <Tag size={10} aria-hidden="true" />
        {selected && <span>{selected.name}</span>}
      </Chip>
      {open && (
        <SpacePicker
          spaces={spaces}
          selectedSpaceId={selectedId}
          onSelect={onSelect}
          defaultLabel="No space"
          align="left"
        />
      )}
    </div>
  );
};

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
    const recoveryColor = recovery >= 67 ? 'bg-accent-wash text-accent-deep border-border' :
                          recovery >= 34 ? 'bg-divider text-secondary-foreground border-border' :
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
    const sleepColor = sleepScore >= 80 ? 'bg-accent-wash text-accent-deep border-border' :
                       sleepScore >= 60 ? 'bg-divider text-secondary-foreground border-border' :
                       'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800'; /* @color-safe: health warning */
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
    const hoursColor = sleepHours >= 7 ? 'bg-accent-wash text-accent-deep' :
                       sleepHours >= 5 ? 'bg-divider text-secondary-foreground' :
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

// Mood dot color — CSS-var driven accent scale, exactly matching
// MoodHeatmapWidget's `accentForMood` bucketing (CLOUD-DESIGN-SPEC.md §7
// Journal "mood dot per row" / §7 Home "mood-trend bar card") so the same
// mood_score renders the same intensity on both Home and Journal. No
// legacy `mood-*` classes, no raw hex — accent tokens only.
// Mood bucket -> CSS-var mapping now lives in src/utils/moodTrend.js
// (accentForMood) as the single source of truth (C5b) - kept named
// getMoodDotColor here since it's referenced by that name below/in
// tests, but it's just a re-export, not a second copy of the mapping.
const getMoodDotColor = accentForMood;

const EntryCard = ({ entry, onDelete, onUpdate }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [showAllTags, setShowAllTags] = useState(false); // LAY-001: Control tag overflow
  const [showCorrections, setShowCorrections] = useState(false);
  const contextSpacesOn = getFlag('contextSpaces');
  const uid = useUser()?.uid;
  const [spaces, setSpaces] = useState([]);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  // Use effectiveDate if set, otherwise fall back to createdAt
  const [editDate, setEditDate] = useState(
    formatDateForInput(entry.effectiveDate || entry.createdAt)
  );
  const isPending = entry.analysisStatus === 'pending';
  const entryType = entry.userCorrections?.entryType?.value || entry.entry_type || 'unknown';
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const isTask = entryType === 'task';
  const isMixed = entryType === 'mixed';
  const isVent = entryType === 'vent';

  useEffect(() => { setTitle(entry.title); }, [entry.title]);
  useEffect(() => {
    setEditDate(formatDateForInput(entry.effectiveDate || entry.createdAt));
  }, [entry.effectiveDate, entry.createdAt]);

  // Context Space (flag: contextSpaces) — subscribe to active spaces so the
  // re-scoping chip can resolve this entry's Space name + list picker options.
  useEffect(() => {
    if (!contextSpacesOn || !uid) {
      setSpaces([]);
      return undefined;
    }
    return subscribeSpaces(db, uid, setSpaces);
  }, [contextSpacesOn, uid]);

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

  // Re-scope this entry to a different Space (or clear it). ONLY spaceId +
  // updatedAt are ever written — createdAt/effectiveDate/transcription/
  // provenance are never touched by a Space change.
  const handleSpaceSelect = (spaceId) => {
    onUpdate(entry.id, { spaceId, updatedAt: new Date().toISOString() });
    setSpacePickerOpen(false);
  };

  const cardStyle = isTask
    ? 'bg-accent-wash border-border'
    : 'bg-card border-border';

  const moodDotColor = getMoodDotColor(entry.analysis?.mood_score);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl p-5 shadow-sm border transition-shadow relative overflow-hidden ${cardStyle}`}
    >
      {isPending && <div className="absolute top-0 left-0 right-0 h-1 bg-divider"><div className="h-full bg-accent animate-progress-indeterminate"></div></div>}

      {/* Insight Box */}
      {entry.contextualInsight?.found && insightMsg && !isTask && (() => {
        const insightType = entry.contextualInsight.type;
        const isWarning = insightType === 'warning';
        const colorClass = isWarning
          ? 'bg-red-50 border-red-100 text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-200' /* @color-safe: warning insight */
          : 'bg-accent-wash border-border text-accent-deep';
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
                <p className="mt-2 text-secondary-foreground italic border-t border-border pt-2">{cbt.validation}</p>
              )}
            </div>
          </motion.div>
        );
      })()}

      {/* Vent Support Display */}
      {isVent && ventSupport && (
        <div className="mb-4 space-y-3">
          {ventSupport.validation && (
            <p className="text-muted-foreground italic text-sm">{ventSupport.validation}</p>
          )}
          {ventSupport.cooldown && (
            <div className="bg-accent-wash p-3 rounded-xl border border-border">
              <div className="flex items-center gap-2 text-accent-deep font-display font-semibold text-xs uppercase mb-2">
                <Wind size={14} /> {ventSupport.cooldown.technique || 'Grounding'}
              </div>
              <p className="text-sm text-secondary-foreground font-body">{ventSupport.cooldown.instruction}</p>
            </div>
          )}
        </div>
      )}

      {/* Celebration Display */}
      {framework === 'celebration' && celebration && (
        <div className="mb-4 space-y-3">
          {celebration.affirmation && (
            <div className="bg-accent-wash p-3 rounded-xl border border-border">
              <div className="flex items-center gap-2 text-accent-deep font-display font-semibold text-xs uppercase mb-2">
                <Sparkles size={14} /> Nice!
              </div>
              <p className="text-sm font-body text-accent-deep">{celebration.affirmation}</p>
              {celebration.amplify && (
                <p className="text-xs text-muted-foreground mt-2 italic">{celebration.amplify}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ACT (Acceptance & Commitment) Display */}
      {framework === 'act' && actAnalysis && (
        <div className="mb-4 space-y-3">
          <div className="bg-accent-wash rounded-xl p-4 border border-border">
            {/* Header with technique badge */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wind className="text-accent-deep" size={16} />
                <span className="text-xs font-bold text-accent-deep uppercase">Defusion</span>
              </div>
              {actAnalysis.defusion_technique && (
                <span className="text-[10px] font-semibold text-accent-deep bg-card px-2 py-0.5 rounded-full">
                  {actAnalysis.defusion_technique.replace('_', ' ')}
                </span>
              )}
            </div>

            {/* Fusion thought (the "hook") */}
            {actAnalysis.fusion_thought && (
              <div className="text-foreground text-sm mb-2">
                <span className="opacity-75">Instead of: </span>
                <span className="line-through decoration-faint">"{actAnalysis.fusion_thought}"</span>
              </div>
            )}

            {/* Defusion phrase */}
            {actAnalysis.defusion_phrase && (
              <div className="text-foreground font-medium text-sm bg-card p-2 rounded-lg">
                Try: "{actAnalysis.defusion_phrase}"
              </div>
            )}

            {/* Values context */}
            {actAnalysis.values_context && (
              <div className="mt-3 pt-3 border-t border-border flex items-center gap-2">
                <Compass size={14} className="text-accent-deep" />
                <span className="text-xs text-accent-deep">
                  <span className="font-semibold">Value:</span> {actAnalysis.values_context}
                </span>
              </div>
            )}
          </div>

          {/* Committed Action */}
          {actAnalysis.committed_action && (
            <div className="bg-accent-wash p-3 rounded-xl border border-border">
              <div className="flex items-center gap-2 text-accent-deep font-display font-semibold text-xs uppercase mb-2">
                <Footprints size={14} /> Committed Action
              </div>
              <p className="text-sm font-medium font-body text-accent-deep">{actAnalysis.committed_action}</p>
              <p className="text-xs text-muted-foreground mt-1 italic">Do this regardless of how you feel right now.</p>
            </div>
          )}
        </div>
      )}

      {/* Task Acknowledgment */}
      {isMixed && taskAcknowledgment && (
        <p className="text-muted-foreground italic text-sm mb-4">{taskAcknowledgment}</p>
      )}

      {/* Enhanced CBT Breakdown */}
      {framework === 'cbt' && cbt && (
        <div className="mb-4 space-y-3">
          {cbt.validation && !entry.contextualInsight?.found && (
            <p className="text-muted-foreground italic text-sm">{cbt.validation}</p>
          )}

          {cbt.distortion && (
            entry.analysis?.mood_score < 0.4 ||
            ['Catastrophizing', 'All-or-Nothing Thinking', 'All-or-Nothing', 'Mind Reading', 'Fortune Telling', 'Emotional Reasoning'].some(d =>
              cbt.distortion?.toLowerCase().includes(d.toLowerCase())
            )
          ) && (
            <div className="flex items-center gap-2">
              <span className="bg-accent-wash text-accent-deep px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                <Info size={12} />
                {cbt.distortion}
              </span>
            </div>
          )}

          {cbt.automatic_thought && (
            <div className="text-sm text-secondary-foreground font-body">
              <span className="font-semibold">Thought:</span> {cbt.automatic_thought}
            </div>
          )}

          {cbt.perspective && (
            <div className="bg-accent-wash p-3 rounded-xl border-l-4 border-accent">
              <div className="text-xs font-display font-semibold text-accent-deep uppercase mb-1">Perspective</div>
              <p className="text-sm text-secondary-foreground font-body">{cbt.perspective}</p>
            </div>
          )}

          {!cbt.perspective && cbt.socratic_question && (
            <div className="bg-accent-wash p-3 rounded-xl border-l-4 border-accent">
              <div className="text-xs font-display font-semibold text-accent-deep uppercase mb-1">Reflect:</div>
              <p className="text-sm text-secondary-foreground font-body">{cbt.socratic_question}</p>
            </div>
          )}

          {!cbt.perspective && (cbt.suggested_reframe || cbt.challenge) && (
            <div className="text-sm font-body">
              <span className="text-accent-deep font-semibold">Try thinking:</span>{' '}
              <span className="text-secondary-foreground">{cbt.suggested_reframe || cbt.challenge}</span>
            </div>
          )}

          {cbt.behavioral_activation && (
            <div className="bg-divider p-3 rounded-xl border border-border">
              <div className="flex items-center gap-2 text-secondary-foreground font-display font-semibold text-xs uppercase mb-2">
                <Footprints size={14} /> Try This (Under 5 min)
              </div>
              <p className="text-sm text-foreground font-medium font-body">{cbt.behavioral_activation.activity}</p>
              {cbt.behavioral_activation.rationale && (
                <p className="text-xs text-muted-foreground mt-1">{cbt.behavioral_activation.rationale}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legacy CBT Breakdown */}
      {framework === 'cbt' && cbt && !cbt.validation && !cbt.socratic_question && cbt.challenge && !cbt.suggested_reframe && (
        <div className="mb-4 bg-accent-wash p-3 rounded-xl border border-border text-sm space-y-2">
          <div className="flex items-center gap-2 text-accent-deep font-display font-bold text-xs uppercase"><Brain size={12}/> Cognitive Restructuring</div>
          <div className="grid gap-2 font-body">
            <div><span className="font-semibold text-foreground">Thought:</span> {cbt.automatic_thought}</div>
            <div className="bg-card p-2 rounded-lg border border-border"><span className="font-semibold text-accent-deep">Challenge:</span> {cbt.challenge}</div>
          </div>
        </div>
      )}

      {/* Header row 1: category/type metadata on the left, actions
          (mood pill / Correct AI / delete) as a fixed-width group on the
          right that can never be squeezed into wrapping. Tags live in
          their own full-width wrapping region below. */}
      <div className="flex justify-between items-center gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <button
            onClick={toggleCategory}
            className={`text-[10px] font-display font-bold px-2 py-0.5 rounded-full uppercase tracking-wide hover:opacity-80 transition-opacity flex items-center gap-1 ${entry.category === 'work' ? 'bg-divider text-secondary-foreground' : 'bg-accent-wash text-accent-deep'}`}
            title="Click to switch category"
          >
            {entry.category}
            <RefreshCw size={8} className="opacity-50" />
          </button>
          {/* Entry-type badge: single neutral Cloud badge treatment (spec
              favors ONE accent + minimal surfaces over per-type hue coding;
              `isMixed`'s Clipboard icon already differentiates that type) —
              local styling, not colorMap.js's getEntryTypeColors(). */}
          {entryType !== 'reflection' && (
            <span className="text-[10px] font-display font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1 bg-divider text-secondary-foreground">
              {isMixed && <Clipboard size={10} />}
              {entryType}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-none">
          {typeof entry.analysis?.mood_score === 'number' && entry.analysis.mood_score !== null && (
            <span className="rounded-full bg-[var(--accent-wash)] px-2 py-1 text-[10px] font-bold text-[var(--accent-deep)] whitespace-nowrap">
              {entry.analysis.mood_score >= 0.7 ? 'Lighter' : entry.analysis.mood_score >= 0.4 ? 'Steady' : 'Heavy'}
            </span>
          )}
          <button onClick={() => setShowCorrections((shown) => !shown)} className="min-h-11 px-2 text-xs font-semibold text-[var(--accent-deep)] whitespace-nowrap">Correct AI</button>
          <button aria-label="Delete entry" onClick={() => onDelete(entry.id)} className="cloud-icon-button text-muted-foreground hover:text-red-400 transition-colors"><Trash2 size={16}/></button>
        </div>
      </div>

      {/* Header row 2: tags in their own full-width wrapping region so they
          never compete with the action controls for width. The Space chip
          (flag: contextSpaces) lives here too so the row still renders even
          for a Space-scoped entry with zero tags. */}
      {(tags.length > 0 || contextSpacesOn) && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {contextSpacesOn && (
            <SpaceChip
              spaces={spaces}
              selectedId={entry.spaceId ?? null}
              onSelect={handleSpaceSelect}
              open={spacePickerOpen}
              onToggle={() => setSpacePickerOpen((prev) => !prev)}
              onDismiss={() => setSpacePickerOpen(false)}
            />
          )}
          {/* LAY-001: Limit visible tags to prevent overflow */}
          {(() => {
            const MAX_VISIBLE_TAGS = 5;
            const visibleTags = showAllTags ? tags : tags.slice(0, MAX_VISIBLE_TAGS);
            const hiddenCount = tags.length - MAX_VISIBLE_TAGS;

            return (
              <>
                {visibleTags.map((t, i) => {
                  const tag = safeString(t);
                  // Helper to format entity names (replace underscores with spaces, title case)
                  const formatName = (prefix) => tag.replace(prefix, '').replace(/_/g, ' ');

                  const entityPrefix = ENTITY_PREFIXES.find(p => tag.startsWith(p));

                  if (entityPrefix) {
                    // Single neutral Cloud badge treatment for entity tags —
                    // the per-prefix emoji already differentiates @person/
                    // @place/@goal/etc., so no hue coding via colorMap.js's
                    // getEntityTypeColors() is needed (spec §4/§5: minimal
                    // surfaces, ONE accent).
                    return <span key={i} className="text-[10px] font-semibold text-secondary-foreground bg-divider px-2 py-0.5 rounded-full inline-block max-w-full truncate whitespace-nowrap align-middle">{ENTITY_EMOJIS[entityPrefix]} {formatName(entityPrefix)}</span>;
                  } else if (tag.startsWith('@')) {
                    // Unknown @ tag - show without prefix
                    return <span key={i} className="text-[10px] font-semibold text-secondary-foreground bg-divider px-2 py-0.5 rounded-full inline-block max-w-full truncate whitespace-nowrap align-middle">{tag.split(':')[1]?.replace(/_/g, ' ') || tag}</span>;
                  }
                  return <span key={i} className="text-[10px] font-semibold text-accent-deep bg-accent-wash px-2 py-0.5 rounded-full inline-block max-w-full truncate whitespace-nowrap align-middle">#{tag}</span>;
                })}
                {/* Show "+N more" button when tags are hidden */}
                {hiddenCount > 0 && !showAllTags && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAllTags(true);
                    }}
                    className="text-[10px] font-semibold text-muted-foreground bg-divider px-2 py-0.5 rounded-full hover:bg-border transition-colors"
                  >
                    +{hiddenCount} more
                  </button>
                )}
                {/* Show "Show less" button when all tags are visible */}
                {showAllTags && tags.length > MAX_VISIBLE_TAGS && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAllTags(false);
                    }}
                    className="text-[10px] font-semibold text-muted-foreground bg-divider px-2 py-0.5 rounded-full hover:bg-border transition-colors"
                  >
                    Show less
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}

      {showCorrections && (
        <div className="mb-4 grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-[var(--secondary-foreground)]">Entry type
            <select defaultValue={entryType} className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-sm" onChange={(event) => {
              const value = event.target.value;
              onUpdate(entry.id, {
                entry_type: value,
                userCorrections: { ...entry.userCorrections, entryType: { value, correctedAt: new Date().toISOString() } },
              });
            }}>
              {['reflection', 'vent', 'task', 'mixed', 'celebration', 'unknown'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--secondary-foreground)]">How it felt to you
            <select defaultValue="" className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 text-sm" onChange={(event) => {
              if (!event.target.value) return;
              const [label, numeric] = event.target.value.split(':');
              const moodScore = Number(numeric);
              onUpdate(entry.id, {
                analysis: { ...entry.analysis, mood_score: moodScore },
                userCorrections: { ...entry.userCorrections, mood: { label, value: moodScore, correctedAt: new Date().toISOString() } },
              });
            }}>
              <option value="">Choose…</option>
              <option value="very-heavy:0.15">Very heavy</option>
              <option value="heavy:0.3">Heavy</option>
              <option value="steady:0.5">Steady</option>
              <option value="lighter:0.7">Lighter</option>
              <option value="very-light:0.85">Very light</option>
            </select>
          </label>
        </div>
      )}

      <div className="mb-2">
        {editing ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="flex-1 font-display font-bold text-lg border-b-2 border-accent focus:outline-none bg-transparent"
                placeholder="Entry title"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <label
                htmlFor={`entry-date-${entry.id}`}
                className="text-xs text-muted-foreground font-medium flex items-center gap-1"
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
                className="text-sm border border-border rounded-lg px-2 py-1 bg-card text-foreground focus:outline-none focus:border-accent"
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
                className="text-accent-deep hover:opacity-80"
              >
                <Check size={18}/>
              </button>
              <button
                onClick={() => {
                  setTitle(entry.title);
                  setEditDate(formatDateForInput(entry.effectiveDate || entry.createdAt));
                  setEditing(false);
                }}
                className="text-muted-foreground hover:text-secondary-foreground"
              >
                <X size={18}/>
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h3 className={`text-lg font-display font-bold text-foreground ${isPending ? 'animate-pulse' : ''}`}>{isPending ? "Processing..." : title}</h3>
            {!isPending && <button aria-label="Edit entry title" onClick={() => setEditing(true)} className="cloud-icon-button -my-2 text-muted-foreground hover:text-accent-deep"><Edit2 size={14}/></button>}
          </div>
        )}
      </div>

      {/* Meta line (CLOUD-DESIGN-SPEC.md §7 Journal: "mood dot per row, meta
          line") — mood dot + time + date, "(edited)" when effectiveDate was
          corrected away from the original capture date. */}
      <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5 font-medium">
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{ background: moodDotColor }}
          aria-hidden="true"
        />
        <Calendar size={12}/>
        {(entry.effectiveDate || entry.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        {' · '}
        {(entry.effectiveDate || entry.createdAt).toLocaleDateString()}
        {entry.effectiveDate && getDateString(entry.effectiveDate) !== getDateString(entry.createdAt) && (
          <span className="text-faint ml-1">(edited)</span>
        )}
      </div>

      {/* Environment & Health Context Strip */}
      {(entry.environmentContext || entry.healthContext) && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground mb-3 pb-2 border-b border-divider">
          {/* Weather Context */}
          {entry.environmentContext && (() => {
            const env = entry.environmentContext;
            const WeatherIcon = getWeatherIcon(env.weather, env.isDay !== false);
            const dayCondition = env.daySummary?.condition;
            const showDaySummary = dayCondition && dayCondition !== env.weather;

            return (
              <>
                <span className="flex items-center gap-1 bg-divider text-secondary-foreground px-1.5 py-0.5 rounded-full">
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
                  <span className="flex items-center gap-1 bg-divider text-secondary-foreground px-1.5 py-0.5 rounded-full">
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
                  <span className="text-accent-deep hidden sm:inline">
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
                  <span className="hidden md:flex items-center gap-1 bg-divider text-secondary-foreground px-1.5 py-0.5 rounded-full text-[10px]">
                    <BedDouble size={10} />
                    {health.sleep.totalHours.toFixed(1)}h
                  </span>
                )}

                {/* HRV */}
                {health.heart?.hrv > 0 && (
                  <span className={`hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
                    health.heart.hrvTrend === 'improving' ? 'bg-accent-wash text-accent-deep' :
                    'bg-divider text-secondary-foreground'
                  }`}>
                    <Activity size={10} />
                    HRV {health.heart.hrv}ms
                  </span>
                )}

                {/* Strain (Whoop only) */}
                {hasWhoop && health.strain?.score > 0 && (
                  <span className={`hidden md:flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
                    health.strain.score >= 15 ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' /* @color-safe: high strain warning */ :
                    'bg-divider text-secondary-foreground'
                  }`}>
                    <Zap size={10} />
                    {health.strain.score.toFixed(1)} strain
                  </span>
                )}

                {/* Steps - always show on larger screens */}
                {health.activity?.stepsToday > 0 && (
                  <span className="hidden sm:flex items-center gap-1 bg-accent-wash text-accent-deep px-1.5 py-0.5 rounded-full">
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
      <div className="text-secondary-foreground text-sm whitespace-pre-wrap leading-7 font-body max-w-prose [&>*]:mb-3">
        {entry.text?.split(/\n\n+/).map((paragraph, i) => (
          <p key={i} className={i > 0 ? 'mt-4' : ''}>{paragraph}</p>
        )) || entry.text}
      </div>

      {/* Extracted Tasks for mixed entries */}
      {isMixed && entry.extracted_tasks && entry.extracted_tasks.length > 0 && (
        <div className="mt-4 pt-3 border-t border-divider">
          <div className="text-xs font-display font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
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
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <span className={displayAsCompleted ? 'line-through text-faint' : 'text-secondary-foreground'}>
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

      <IntentSuggestionTray entryId={entry.id} />

      <ProvenanceDisclosure entry={entry} />
    </motion.div>
  );
};

export default EntryCard;
