import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { generateDailySynthesis } from '../../utils/synthesis';

const DailySummaryModal = ({ date, dayData, onClose, onDelete, onUpdate }) => {
  const [synthesis, setSynthesis] = useState(null);
  const [loadingSynthesis, setLoadingSynthesis] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadSynthesis = async () => {
      if (dayData.entries.length > 0) {
        const result = await generateDailySynthesis(dayData.entries);
        if (isMounted) {
          setSynthesis(result);
        }
      }
      if (isMounted) {
        setLoadingSynthesis(false);
      }
    };

    loadSynthesis();

    return () => {
      isMounted = false;
    };
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", duration: 0.3 }}
        className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-soft-lg"
      >
        <div className="p-6 border-b border-warm-100">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-display font-bold text-warm-800">{date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              <p className="text-sm text-warm-500">{dayData.entries.length} entries {dayData.volatility > 0.3 && <span className="text-accent">(high mood volatility)</span>}</p>
            </div>
            <motion.button
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className="text-warm-400 hover:text-warm-600"
            >
              <X size={24} />
            </motion.button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loadingSynthesis ? (
            <div className="bg-lavender-50 p-4 rounded-2xl border border-lavender-100 flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-lavender-500" />
              <span className="text-sm text-lavender-700 font-body">Generating daily summary...</span>
            </div>
          ) : synthesis && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-lavender-50 p-4 rounded-2xl border border-lavender-100"
            >
              <div className="flex items-center gap-2 text-lavender-700 font-display font-semibold text-xs uppercase mb-2">
                <Sparkles size={14} /> Daily Summary
              </div>
              <p className="text-sm text-lavender-900 leading-relaxed font-body">
                {typeof synthesis === 'string' ? synthesis : synthesis.summary}
              </p>
              {synthesis.bullets && synthesis.bullets.length > 0 && (
                <div className="mt-3 pt-3 border-t border-lavender-200">
                  <p className="text-xs font-display font-semibold text-lavender-800 mb-2 uppercase tracking-wide">
                    Key mood drivers
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-lavender-900/90 font-body">
                    {synthesis.bullets.map((bullet, idx) => (
                      <li key={idx}>{typeof bullet === 'string' ? bullet : bullet.text || JSON.stringify(bullet)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          )}

          {sortedEntries.map((entry, index) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="border border-warm-100 rounded-2xl p-4 hover:shadow-soft transition-shadow"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-warm-400">{entry.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {entry.entry_type && entry.entry_type !== 'reflection' && (
                    <span className={`text-[10px] font-display font-bold px-2 py-0.5 rounded-full uppercase ${
                      entry.entry_type === 'task' ? 'bg-yellow-100 text-yellow-700' :
                      entry.entry_type === 'mixed' ? 'bg-teal-100 text-teal-700' :
                      entry.entry_type === 'vent' ? 'bg-pink-100 text-pink-700' : 'bg-warm-100 text-warm-600'
                    }`}>{entry.entry_type}</span>
                  )}
                  {typeof entry.analysis?.mood_score === 'number' && (
                    <span className="text-lg">{getMoodEmoji(entry.analysis.mood_score)}</span>
                  )}
                </div>
                <button onClick={() => onDelete(entry.id)} className="text-warm-300 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
              <h4 className="font-display font-semibold text-warm-800 mb-1">{entry.title}</h4>
              <p className="text-sm text-warm-600 line-clamp-3 font-body">{entry.text}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default DailySummaryModal;
