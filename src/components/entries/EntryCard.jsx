import React, { useState, useEffect } from 'react';
import {
  Trash2, Calendar, Edit2, Check, RefreshCw, Lightbulb, Wind, Sparkles,
  Brain, Info, Footprints, Clipboard
} from 'lucide-react';
import { safeString } from '../../utils/string';

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
    : 'bg-white border-gray-100';

  return (
    <div className={`rounded-xl p-5 shadow-sm border hover:shadow-md transition-shadow mb-4 relative overflow-hidden ${cardStyle}`}>
      {isPending && <div className="absolute top-0 left-0 right-0 h-1 bg-gray-100"><div className="h-full bg-indigo-500 animate-progress-indeterminate"></div></div>}

      {/* Insight Box */}
      {entry.contextualInsight?.found && insightMsg && !isTask && (() => {
        const insightType = entry.contextualInsight.type;
        const isPositive = ['progress', 'streak', 'absence', 'encouragement'].includes(insightType);
        const isWarning = insightType === 'warning';
        const colorClass = isWarning
          ? 'bg-red-50 border-red-100 text-red-800'
          : isPositive
            ? 'bg-green-50 border-green-100 text-green-800'
            : 'bg-blue-50 border-blue-100 text-blue-800';
        return (
          <div className={`mb-4 p-3 rounded-lg text-sm border flex gap-3 ${colorClass}`}>
            <Lightbulb size={18} className="shrink-0 mt-0.5"/>
            <div>
              <div className="font-bold text-[10px] uppercase opacity-75 tracking-wider mb-1">{safeString(insightType)}</div>
              {insightMsg}
              {cbt?.validation && (
                <p className="mt-2 text-gray-600 italic border-t border-gray-200 pt-2">{cbt.validation}</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Vent Support Display */}
      {isVent && ventSupport && (
        <div className="mb-4 space-y-3">
          {ventSupport.validation && (
            <p className="text-gray-500 italic text-sm">{ventSupport.validation}</p>
          )}
          {ventSupport.cooldown && (
            <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
              <div className="flex items-center gap-2 text-blue-700 font-semibold text-xs uppercase mb-2">
                <Wind size={14} /> {ventSupport.cooldown.technique || 'Grounding'}
              </div>
              <p className="text-sm text-blue-800">{ventSupport.cooldown.instruction}</p>
            </div>
          )}
        </div>
      )}

      {/* Celebration Display */}
      {entry.analysis?.framework === 'celebration' && celebration && (
        <div className="mb-4 space-y-3">
          {celebration.affirmation && (
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-3 rounded-lg border border-green-100">
              <div className="flex items-center gap-2 text-green-700 font-semibold text-xs uppercase mb-2">
                <Sparkles size={14} /> Nice!
              </div>
              <p className="text-sm text-green-800">{celebration.affirmation}</p>
              {celebration.amplify && (
                <p className="text-xs text-green-600 mt-2 italic">{celebration.amplify}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Task Acknowledgment */}
      {isMixed && taskAcknowledgment && (
        <p className="text-gray-500 italic text-sm mb-4">{taskAcknowledgment}</p>
      )}

      {/* Enhanced CBT Breakdown */}
      {entry.analysis?.framework === 'cbt' && cbt && (
        <div className="mb-4 space-y-3">
          {cbt.validation && !entry.contextualInsight?.found && (
            <p className="text-gray-500 italic text-sm">{cbt.validation}</p>
          )}

          {cbt.distortion && (
            entry.analysis?.mood_score < 0.4 ||
            ['Catastrophizing', 'All-or-Nothing Thinking', 'All-or-Nothing', 'Mind Reading', 'Fortune Telling', 'Emotional Reasoning'].some(d =>
              cbt.distortion?.toLowerCase().includes(d.toLowerCase())
            )
          ) && (
            <div className="flex items-center gap-2">
              <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                <Info size={12} />
                {cbt.distortion}
              </span>
            </div>
          )}

          {cbt.automatic_thought && (
            <div className="text-sm text-gray-700">
              <span className="font-semibold">Thought:</span> {cbt.automatic_thought}
            </div>
          )}

          {cbt.perspective && (
            <div className="bg-gradient-to-r from-blue-50 to-green-50 p-3 rounded-lg border-l-4 border-blue-400">
              <div className="text-xs font-semibold text-blue-600 uppercase mb-1">Perspective</div>
              <p className="text-sm text-gray-700">{cbt.perspective}</p>
            </div>
          )}

          {!cbt.perspective && cbt.socratic_question && (
            <div className="bg-blue-50 p-3 rounded-lg border-l-4 border-blue-400">
              <div className="text-xs font-semibold text-blue-600 uppercase mb-1">Reflect:</div>
              <p className="text-sm text-blue-800">{cbt.socratic_question}</p>
            </div>
          )}

          {!cbt.perspective && (cbt.suggested_reframe || cbt.challenge) && (
            <div className="text-sm">
              <span className="text-green-700 font-semibold">Try thinking:</span>{' '}
              <span className="text-green-800">{cbt.suggested_reframe || cbt.challenge}</span>
            </div>
          )}

          {cbt.behavioral_activation && (
            <div className="bg-purple-50 p-3 rounded-lg border border-purple-100">
              <div className="flex items-center gap-2 text-purple-700 font-semibold text-xs uppercase mb-2">
                <Footprints size={14} /> Try This (Under 5 min)
              </div>
              <p className="text-sm text-purple-800 font-medium">{cbt.behavioral_activation.activity}</p>
              {cbt.behavioral_activation.rationale && (
                <p className="text-xs text-purple-600 mt-1">{cbt.behavioral_activation.rationale}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Legacy CBT Breakdown */}
      {entry.analysis?.framework === 'cbt' && cbt && !cbt.validation && !cbt.socratic_question && cbt.challenge && !cbt.suggested_reframe && (
        <div className="mb-4 bg-indigo-50 p-3 rounded-lg border border-indigo-100 text-sm space-y-2">
          <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs uppercase"><Brain size={12}/> Cognitive Restructuring</div>
          <div className="grid gap-2">
            <div><span className="font-semibold text-indigo-900">Thought:</span> {cbt.automatic_thought}</div>
            <div className="bg-white p-2 rounded border border-indigo-100"><span className="font-semibold text-green-700">Challenge:</span> {cbt.challenge}</div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-start mb-3">
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={toggleCategory}
            className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide hover:opacity-80 transition-opacity flex items-center gap-1 ${entry.category === 'work' ? 'bg-slate-100 text-slate-600' : 'bg-orange-50 text-orange-600'}`}
            title="Click to switch category"
          >
            {entry.category}
            <RefreshCw size={8} className="opacity-50" />
          </button>
          {entryType !== 'reflection' && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide flex items-center gap-1 ${
              isTask ? 'bg-yellow-100 text-yellow-700' :
              isMixed ? 'bg-teal-100 text-teal-700' :
              isVent ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {isMixed && <Clipboard size={10} />}
              {entryType}
            </span>
          )}
          {entry.tags.map((t, i) => {
            const tag = safeString(t);
            if (tag.startsWith('@person:')) {
              return <span key={i} className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{tag.replace('@person:', '👤 ')}</span>;
            } else if (tag.startsWith('@place:')) {
              return <span key={i} className="text-[10px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded">{tag.replace('@place:', '📍 ')}</span>;
            } else if (tag.startsWith('@goal:')) {
              return <span key={i} className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">{tag.replace('@goal:', '🎯 ')}</span>;
            } else if (tag.startsWith('@situation:')) {
              return <span key={i} className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded">{tag.replace('@situation:', '📌 ')}</span>;
            } else if (tag.startsWith('@self:')) {
              return <span key={i} className="text-[10px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">{tag.replace('@self:', '💭 ')}</span>;
            }
            return <span key={i} className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">#{tag}</span>;
          })}
        </div>
        <div className="flex items-center gap-2">
          {typeof entry.analysis?.mood_score === 'number' && entry.analysis.mood_score !== null && (
            <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-gray-100">{(entry.analysis.mood_score * 100).toFixed(0)}%</span>
          )}
          <button onClick={() => onDelete(entry.id)} className="text-gray-300 hover:text-red-400 transition-colors"><Trash2 size={16}/></button>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2">
        {editing ? (
          <div className="flex-1 flex gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} className="flex-1 font-bold text-lg border-b-2 border-indigo-500 focus:outline-none bg-transparent" autoFocus />
            <button onClick={() => { onUpdate(entry.id, { title }); setEditing(false); }} className="text-green-600"><Check size={18}/></button>
          </div>
        ) : (
          <>
            <h3 className={`text-lg font-bold text-gray-800 ${isPending ? 'animate-pulse' : ''}`}>{isPending ? "Processing..." : title}</h3>
            {!isPending && <button onClick={() => setEditing(true)} className="text-gray-300 hover:text-indigo-500 opacity-50 hover:opacity-100"><Edit2 size={14}/></button>}
          </>
        )}
      </div>

      <div className="text-xs text-gray-400 mb-4 flex items-center gap-1 font-medium"><Calendar size={12}/> {entry.createdAt.toLocaleDateString()}</div>
      <p className="text-gray-600 text-sm whitespace-pre-wrap leading-relaxed">{entry.text}</p>

      {/* Extracted Tasks for mixed entries */}
      {isMixed && entry.extracted_tasks && entry.extracted_tasks.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
            <Clipboard size={12} /> Tasks
          </div>
          <div className="space-y-1">
            {entry.extracted_tasks.map((task, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => {
                    const updatedTasks = [...entry.extracted_tasks];
                    updatedTasks[i] = { ...task, completed: !task.completed };
                    onUpdate(entry.id, { extracted_tasks: updatedTasks });
                  }}
                  className="rounded border-gray-300"
                />
                <span className={task.completed ? 'line-through text-gray-400' : 'text-gray-700'}>{task.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EntryCard;
