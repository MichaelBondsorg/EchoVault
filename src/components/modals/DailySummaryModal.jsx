import React, { useState, useEffect } from 'react';
import { X, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { generateDailySynthesis } from '../../utils/synthesis';

const DailySummaryModal = ({ date, dayData, onClose, onDelete, onUpdate }) => {
  const [synthesis, setSynthesis] = useState(null);
  const [loadingSynthesis, setLoadingSynthesis] = useState(true);

  useEffect(() => {
    const loadSynthesis = async () => {
      if (dayData.entries.length > 0) {
        const result = await generateDailySynthesis(dayData.entries);
        setSynthesis(result);
      }
      setLoadingSynthesis(false);
    };
    loadSynthesis();
  }, [dayData.entries]);

  const sortedEntries = [...dayData.entries].sort((a, b) => a.createdAt - b.createdAt);

  const getMoodEmoji = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 0.75) return '😊';
    if (score >= 0.55) return '🙂';
    if (score >= 0.35) return '😐';
    if (score >= 0.15) return '😟';
    return '😢';
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-100">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-gray-800">{date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              <p className="text-sm text-gray-500">{dayData.entries.length} entries {dayData.volatility > 0.3 && <span className="text-orange-500">(high mood volatility)</span>}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loadingSynthesis ? (
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100 flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-indigo-500" />
              <span className="text-sm text-indigo-700">Generating daily summary...</span>
            </div>
          ) : synthesis && (
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100">
              <div className="flex items-center gap-2 text-indigo-700 font-semibold text-xs uppercase mb-2">
                <Sparkles size={14} /> Daily Summary
              </div>
              <p className="text-sm text-indigo-900 leading-relaxed">
                {typeof synthesis === 'string' ? synthesis : synthesis.summary}
              </p>
              {synthesis.bullets && synthesis.bullets.length > 0 && (
                <div className="mt-3 pt-3 border-t border-indigo-200">
                  <p className="text-xs font-semibold text-indigo-800 mb-2 uppercase tracking-wide">
                    Key mood drivers
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-indigo-900/90">
                    {synthesis.bullets.map((bullet, idx) => (
                      <li key={idx}>{bullet}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {sortedEntries.map((entry) => (
            <div key={entry.id} className="border border-gray-100 rounded-lg p-4 hover:shadow-sm transition-shadow">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{entry.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {entry.entry_type && entry.entry_type !== 'reflection' && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                      entry.entry_type === 'task' ? 'bg-yellow-100 text-yellow-700' :
                      entry.entry_type === 'mixed' ? 'bg-teal-100 text-teal-700' :
                      entry.entry_type === 'vent' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-600'
                    }`}>{entry.entry_type}</span>
                  )}
                  {typeof entry.analysis?.mood_score === 'number' && (
                    <span className="text-lg">{getMoodEmoji(entry.analysis.mood_score)}</span>
                  )}
                </div>
                <button onClick={() => onDelete(entry.id)} className="text-gray-300 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
              <h4 className="font-semibold text-gray-800 mb-1">{entry.title}</h4>
              <p className="text-sm text-gray-600 line-clamp-3">{entry.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DailySummaryModal;
