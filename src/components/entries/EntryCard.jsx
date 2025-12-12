import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Trash2, Calendar, Edit2, Check, RefreshCw, Lightbulb, Wind, Sparkles,
  Brain, Info, Footprints, Clipboard
} from 'lucide-react';
import { safeString } from '../../utils/string';

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
  const isPending = entry.analysisStatus === 'pending';
  const entryType = entry.entry_type || 'reflection';
  const isTask = entryType === 'task';
  const isMixed = entryType === 'mixed';
  const isVent = entryType === 'vent';

  useEffect(() => { setTitle(entry.title); }, [entry.title]);

  const insightMsg = entry.contextualInsight?.message ? safeString(entry.contextualInsight.message) : null;
  const cbt = entry.analysis?.cbt_breakdown;
  const ventSupport = entry.analysis?.vent_support;
  const celebration = entry.analysis?.celebration;
  const taskAcknowledgment = entry.analysis?.task_acknowledgment;

  const toggleCategory = () => {
    const newCategory = entry.category === 'work' ? 'personal' : 'work';
    onUpdate(entry.id, { category: newCategory });
  };

  const cardStyle = isTask
    ? 'bg-yellow-50 border-yellow-200'
    : 'bg-white border-warm-100';

  const moodBorderColor = getMoodColor(entry.analysis?.mood_score);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl p-5 shadow-soft border hover:shadow-soft-lg transition-shadow mb-4 relative overflow-hidden border-l-4 ${cardStyle} ${moodBorderColor}`}
    >
      {isPending && <div className="absolute top-0 left-0 right-0 h-1 bg-warm-100"><div className="h-full bg-primary-500 animate-progress-indeterminate"></div></div>}

      {/* Insight Box */}
      {entry.contextualInsight?.found && insightMsg && !isTask && (() => {
        const insightType = entry.contextualInsight.type;
        const isPositive = ['progress', 'streak', 'absence', 'encouragement'].includes(insightType);
        const isWarning = insightType === 'warning';
        const colorClass = isWarning
          ? 'bg-red-50 border-red-100 text-red-800'
          : isPositive
            ? 'bg-green-50 border-green-100 text-green-800'
            : 'bg-primary-50 border-primary-100 text-primary-800';
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
            <div className="bg-primary-50 p-3 rounded-xl border border-primary-100">
              <div className="flex items-center gap-2 text-primary-700 font-display font-semibold text-xs uppercase mb-2">
                <Wind size={14} /> {ventSupport.cooldown.technique || 'Grounding'}
              </div>
              <p className="text-sm text-primary-800 font-body">{ventSupport.cooldown.instruction}</p>
            </div>
          )}
        </div>
      )}

      {/* Celebration Display */}
      {entry.analysis?.framework === 'celebration' && celebration && (
        <div className="mb-4 space-y-3">
          {celebration.affirmation && (
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-3 rounded-xl border border-green-100">
              <div className="flex items-center gap-2 text-green-700 font-display font-semibold text-xs uppercase mb-2">
                <Sparkles size={14} /> Nice!
              </div>
              <p className="text-sm text-green-800 font-body">{celebration.affirmation}</p>
              {celebration.amplify && (
                <p className="text-xs text-green-600 mt-2 italic">{celebration.amplify}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Task Acknowledgment */}
      {isMixed && taskAcknowledgment && (
        <p className="text-warm-500 italic text-sm mb-4">{taskAcknowledgment}</p>
      )}

      {/* Enhanced CBT Breakdown */}
      {entry.analysis?.framework === 'cbt' && cbt && (
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
            <div className="bg-gradient-to-r from-primary-50 to-green-50 p-3 rounded-xl border-l-4 border-primary-400">
              <div className="text-xs font-display font-semibold text-primary-600 uppercase mb-1">Perspective</div>
              <p className="text-sm text-warm-700 font-body">{cbt.perspective}</p>
            </div>
          )}

          {!cbt.perspective && cbt.socratic_question && (
            <div className="bg-primary-50 p-3 rounded-xl border-l-4 border-primary-400">
              <div className="text-xs font-display font-semibold text-primary-600 uppercase mb-1">Reflect:</div>
              <p className="text-sm text-primary-800 font-body">{cbt.socratic_question}</p>
            </div>
          )}

          {!cbt.perspective && (cbt.suggested_reframe || cbt.challenge) && (
            <div className="text-sm font-body">
              <span className="text-green-700 font-semibold">Try thinking:</span>{' '}
              <span className="text-green-800">{cbt.suggested_reframe || cbt.challenge}</span>
            </div>
          )}

          {cbt.behavioral_activation && (
            <div className="bg-secondary-50 p-3 rounded-xl border border-secondary-100">
              <div className="flex items-center gap-2 text-secondary-700 font-display font-semibold text-xs uppercase mb-2">
                <Footprints size={14} /> Try This (Under 5 min)
              </div>
              <p className="text-sm text-secondary-800 font-medium font-body">{cbt.behavioral_activation.activity}</p>
              {cbt.behavioral_activation.rationale && (
                <p className="text-xs text-secondary-600 mt-1">{cbt.behavioral_activation.rationale}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legacy CBT Breakdown */}
      {entry.analysis?.framework === 'cbt' && cbt && !cbt.validation && !cbt.socratic_question && cbt.challenge && !cbt.suggested_reframe && (
        <div className="mb-4 bg-primary-50 p-3 rounded-xl border border-primary-100 text-sm space-y-2">
          <div className="flex items-center gap-2 text-primary-700 font-display font-bold text-xs uppercase"><Brain size={12}/> Cognitive Restructuring</div>
          <div className="grid gap-2 font-body">
            <div><span className="font-semibold text-primary-900">Thought:</span> {cbt.automatic_thought}</div>
            <div className="bg-white p-2 rounded-lg border border-primary-100"><span className="font-semibold text-green-700">Challenge:</span> {cbt.challenge}</div>
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
          {entryType !== 'reflection' && (
            <span className={`text-[10px] font-display font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1 ${
              isTask ? 'bg-yellow-100 text-yellow-700' :
              isMixed ? 'bg-teal-100 text-teal-700' :
              isVent ? 'bg-pink-100 text-pink-700' : 'bg-warm-100 text-warm-600'
            }`}>
              {isMixed && <Clipboard size={10} />}
              {entryType}
            </span>
          )}
          {entry.tags.map((t, i) => {
            const tag = safeString(t);
            // Helper to format entity names (replace underscores with spaces, title case)
            const formatName = (prefix) => tag.replace(prefix, '').replace(/_/g, ' ');

            if (tag.startsWith('@person:')) {
              return <span key={i} className="text-[10px] font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">👤 {formatName('@person:')}</span>;
            } else if (tag.startsWith('@place:')) {
              return <span key={i} className="text-[10px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">📍 {formatName('@place:')}</span>;
            } else if (tag.startsWith('@goal:')) {
              return <span key={i} className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">🎯 {formatName('@goal:')}</span>;
            } else if (tag.startsWith('@situation:')) {
              return <span key={i} className="text-[10px] font-semibold text-secondary-600 bg-secondary-50 px-2 py-0.5 rounded-full">📌 {formatName('@situation:')}</span>;
            } else if (tag.startsWith('@self:')) {
              return <span key={i} className="text-[10px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">💭 {formatName('@self:')}</span>;
            } else if (tag.startsWith('@activity:')) {
              return <span key={i} className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">🏃 {formatName('@activity:')}</span>;
            } else if (tag.startsWith('@media:')) {
              return <span key={i} className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">🎬 {formatName('@media:')}</span>;
            } else if (tag.startsWith('@event:')) {
              return <span key={i} className="text-[10px] font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">📅 {formatName('@event:')}</span>;
            } else if (tag.startsWith('@food:')) {
              return <span key={i} className="text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">🍽️ {formatName('@food:')}</span>;
            } else if (tag.startsWith('@topic:')) {
              return <span key={i} className="text-[10px] font-semibold text-slate-600 bg-slate-50 px-2 py-0.5 rounded-full">💬 {formatName('@topic:')}</span>;
            } else if (tag.startsWith('@')) {
              // Unknown @ tag - show without prefix
              return <span key={i} className="text-[10px] font-semibold text-warm-600 bg-warm-50 px-2 py-0.5 rounded-full">{tag.split(':')[1]?.replace(/_/g, ' ') || tag}</span>;
            }
            return <span key={i} className="text-[10px] font-semibold text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">#{tag}</span>;
          })}
        </div>
        <div className="flex items-center gap-2">
          {typeof entry.analysis?.mood_score === 'number' && entry.analysis.mood_score !== null && (
            <span className="px-2 py-1 rounded-full text-[10px] font-display font-bold bg-warm-100">{(entry.analysis.mood_score * 100).toFixed(0)}%</span>
          )}
          <button onClick={() => onDelete(entry.id)} className="text-warm-300 hover:text-red-400 transition-colors"><Trash2 size={16}/></button>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2">
        {editing ? (
          <div className="flex-1 flex gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} className="flex-1 font-display font-bold text-lg border-b-2 border-primary-500 focus:outline-none bg-transparent" autoFocus />
            <button onClick={() => { onUpdate(entry.id, { title }); setEditing(false); }} className="text-green-600"><Check size={18}/></button>
          </div>
        ) : (
          <>
            <h3 className={`text-lg font-display font-bold text-warm-800 ${isPending ? 'animate-pulse' : ''}`}>{isPending ? "Processing..." : title}</h3>
            {!isPending && <button onClick={() => setEditing(true)} className="text-warm-300 hover:text-primary-500 opacity-50 hover:opacity-100"><Edit2 size={14}/></button>}
          </>
        )}
      </div>

      <div className="text-xs text-warm-400 mb-4 flex items-center gap-1 font-medium"><Calendar size={12}/> {entry.createdAt.toLocaleDateString()}</div>
      <p className="text-warm-600 text-sm whitespace-pre-wrap leading-relaxed font-body">{entry.text}</p>

      {/* Extracted Tasks for mixed entries */}
      {isMixed && entry.extracted_tasks && entry.extracted_tasks.length > 0 && (
        <div className="mt-4 pt-3 border-t border-warm-100">
          <div className="text-xs font-display font-semibold text-warm-500 uppercase mb-2 flex items-center gap-1">
            <Clipboard size={12} /> Tasks
          </div>
          <div className="space-y-1">
            {entry.extracted_tasks.map((task, i) => {
              // For recurring tasks, check if waiting for next due date
              const isWaitingForNextDue = task.recurrence && task.nextDueDate && new Date(task.nextDueDate) > new Date();
              const displayAsCompleted = task.completed || isWaitingForNextDue;

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
                    className="rounded border-warm-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className={displayAsCompleted ? 'line-through text-warm-400' : 'text-warm-700'}>
                    {task.text}
                  </span>
                  {task.recurrence && (
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
