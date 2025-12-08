import React, { useMemo } from 'react';
import { X, TrendingDown, TrendingUp, AlertTriangle, Heart, Calendar, Sparkles, BarChart3 } from 'lucide-react';
import { analyzeLongitudinalPatterns } from '../../services/safety';

const InsightsPanel = ({ entries, onClose }) => {
  const patterns = useMemo(() => analyzeLongitudinalPatterns(entries), [entries]);

  const getPatternIcon = (type) => {
    switch (type) {
      case 'weekly_low': return <TrendingDown size={16} className="text-orange-500" />;
      case 'weekly_high': return <TrendingUp size={16} className="text-green-500" />;
      case 'trigger_correlation': return <AlertTriangle size={16} className="text-amber-500" />;
      case 'recovery_pattern': return <Heart size={16} className="text-pink-500" />;
      case 'monthly_summary': return <Calendar size={16} className="text-indigo-500" />;
      default: return <Sparkles size={16} className="text-purple-500" />;
    }
  };

  const getPatternColor = (type) => {
    switch (type) {
      case 'weekly_low': return 'bg-orange-50 border-orange-200';
      case 'weekly_high': return 'bg-green-50 border-green-200';
      case 'trigger_correlation': return 'bg-amber-50 border-amber-200';
      case 'recovery_pattern': return 'bg-pink-50 border-pink-200';
      case 'monthly_summary': return 'bg-indigo-50 border-indigo-200';
      default: return 'bg-purple-50 border-purple-200';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 size={20} /> Your Patterns</h2>
              <p className="text-sm opacity-80 mt-1">Insights from your journal entries</p>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white"><X size={24} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {patterns.length === 0 ? (
            <div className="text-center py-12">
              <div className="h-20 w-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <BarChart3 size={32} className="text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-800">Not enough data yet</h3>
              <p className="text-sm text-gray-500 mt-2">Keep journaling! Patterns will appear after you have at least 7 entries with mood data.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {patterns.map((pattern, i) => (
                <div key={i} className={`p-4 rounded-lg border ${getPatternColor(pattern.type)}`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getPatternIcon(pattern.type)}</div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{pattern.message}</p>
                      {pattern.type === 'trigger_correlation' && (
                        <p className="text-xs text-gray-500 mt-1">Based on {Math.round(pattern.percentDiff)}% mood difference</p>
                      )}
                      {pattern.type === 'recovery_pattern' && (
                        <p className="text-xs text-gray-500 mt-1">Based on {pattern.samples} recovery instances</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-500 text-center">Patterns are calculated from your recent entries and update automatically</p>
        </div>
      </div>
    </div>
  );
};

export default InsightsPanel;
