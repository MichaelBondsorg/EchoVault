import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';

const MoodHeatmap = ({ entries, onDayClick }) => {
  const days = useMemo(() => new Array(30).fill(null).map((_, i) => {
    const d = new Date(); d.setDate(new Date().getDate() - (29 - i)); return d;
  }), []);

  const getDayData = (d) => {
    const dayEntries = entries.filter(e =>
      e.createdAt.getDate() === d.getDate() &&
      e.createdAt.getMonth() === d.getMonth() &&
      e.createdAt.getFullYear() === d.getFullYear()
    );
    const moodEntries = dayEntries.filter(e => e.entry_type !== 'task' && typeof e.analysis?.mood_score === 'number');
    const avgMood = moodEntries.length > 0
      ? moodEntries.reduce((sum, e) => sum + e.analysis.mood_score, 0) / moodEntries.length
      : null;
    const moodScores = moodEntries.map(e => e.analysis.mood_score);
    const volatility = moodScores.length > 1
      ? Math.max(...moodScores) - Math.min(...moodScores)
      : 0;
    return { entries: dayEntries, avgMood, volatility, hasEntries: dayEntries.length > 0 };
  };

  const getMoodColor = (score) => {
    if (typeof score !== 'number') return '#e5e7eb';
    if (score >= 0.89) return '#15803d';
    if (score >= 0.78) return '#16a34a';
    if (score >= 0.67) return '#22c55e';
    if (score >= 0.56) return '#84cc16';
    if (score >= 0.44) return '#eab308';
    if (score >= 0.33) return '#ea580c';
    if (score >= 0.22) return '#dc2626';
    if (score >= 0.11) return '#991b1b';
    return '#7f1d1d';
  };

  return (
    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-3 text-gray-700 font-semibold text-xs uppercase tracking-wide"><Activity size={14} /> Mood (30 Days)</div>
      <div className="flex justify-between items-end gap-1">{days.map((d, i) => {
        const dayData = getDayData(d);
        const { avgMood, hasEntries } = dayData;
        return (
          <button
            key={i}
            className={`flex-1 rounded transition-all ${hasEntries ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            style={{
              backgroundColor: getMoodColor(avgMood),
              height: avgMood !== null ? `${Math.max(20, avgMood * 60)}px` : '20px',
              minWidth: '8px'
            }}
            title={`${d.toLocaleDateString()}${hasEntries ? `: ${dayData.entries.length} entries${avgMood !== null ? ` - ${(avgMood * 100).toFixed(0)}%` : ''}` : ': No entry'}`}
            onClick={() => hasEntries && onDayClick && onDayClick(d, dayData)}
            disabled={!hasEntries}
          />
        );
      })}</div>
      <div className="mt-3 flex justify-between items-center text-xs text-gray-500">
        <span>Low</span>
        <span className="text-gray-600 font-medium">Mood Scale</span>
        <span>High</span>
      </div>
    </div>
  );
};

export default MoodHeatmap;
