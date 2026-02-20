import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, FileText, Loader2, Download, Check } from 'lucide-react';
import { loadJsPDF } from '../../utils/pdf';

const TherapistExportScreen = ({ entries, onClose }) => {
  const [selectedEntries, setSelectedEntries] = useState(new Set());
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState('pdf');

  const filteredEntries = useMemo(() => {
    let filtered = entries.filter(e => e.entry_type !== 'task');
    if (dateRange.start) {
      const startDate = new Date(dateRange.start);
      filtered = filtered.filter(e => e.createdAt >= startDate);
    }
    if (dateRange.end) {
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59);
      filtered = filtered.filter(e => e.createdAt <= endDate);
    }
    return filtered.sort((a, b) => a.createdAt - b.createdAt);
  }, [entries, dateRange]);

  const toggleEntry = (id) => {
    const newSelected = new Set(selectedEntries);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedEntries(newSelected);
  };

  const selectAll = () => {
    setSelectedEntries(new Set(filteredEntries.map(e => e.id)));
  };

  const selectNone = () => {
    setSelectedEntries(new Set());
  };

  const getMoodEmoji = (score) => {
    if (score === null || score === undefined) return '';
    if (score >= 0.75) return '😊';
    if (score >= 0.55) return '🙂';
    if (score >= 0.35) return '😐';
    if (score >= 0.15) return '😟';
    return '😢';
  };

  const generatePDF = async () => {
    setExporting(true);
    try {
      const jsPDF = await loadJsPDF();
      const doc = new jsPDF();

      const selectedList = filteredEntries.filter(e => selectedEntries.has(e.id));
      const moodScores = selectedList.filter(e => typeof e.analysis?.mood_score === 'number').map(e => e.analysis.mood_score);
      const avgMood = moodScores.length > 0 ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length : null;

      doc.setFontSize(20);
      doc.text('Engram Journal Export', 20, 20);

      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 20, 30);
      doc.text(`Entries: ${selectedList.length}`, 20, 36);
      if (avgMood !== null) {
        doc.text(`Average Mood: ${(avgMood * 100).toFixed(0)}%`, 20, 42);
      }

      let yPos = 55;
      const pageHeight = 280;
      const margin = 20;

      selectedList.forEach((entry) => {
        if (yPos > pageHeight - 40) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(`${entry.createdAt.toLocaleDateString()} - ${entry.title}`, margin, yPos);
        yPos += 6;

        if (typeof entry.analysis?.mood_score === 'number') {
          doc.setFontSize(9);
          doc.setFont(undefined, 'normal');
          doc.text(`Mood: ${(entry.analysis.mood_score * 100).toFixed(0)}%`, margin, yPos);
          yPos += 5;
        }

        // Health context summary
        if (entry.healthContext) {
          doc.setFontSize(8);
          doc.setFont(undefined, 'normal');
          const healthParts = [];
          if (entry.healthContext.sleep?.totalHours) {
            healthParts.push(`Sleep: ${entry.healthContext.sleep.totalHours.toFixed(1)}h${entry.healthContext.sleep.score ? ` (${entry.healthContext.sleep.score})` : ''}`);
          }
          if (entry.healthContext.heart?.hrv) {
            healthParts.push(`HRV: ${entry.healthContext.heart.hrv}ms`);
          }
          if (entry.healthContext.recovery?.score) {
            healthParts.push(`Recovery: ${entry.healthContext.recovery.score}%`);
          }
          if (entry.healthContext.activity?.stepsToday) {
            healthParts.push(`Steps: ${entry.healthContext.activity.stepsToday.toLocaleString()}`);
          }
          if (healthParts.length > 0) {
            doc.text(`Health: ${healthParts.join(' | ')}`, margin, yPos);
            yPos += 4;
          }
        }

        // Environment context summary
        if (entry.environmentContext) {
          doc.setFontSize(8);
          doc.setFont(undefined, 'normal');
          const envParts = [];
          if (entry.environmentContext.weatherLabel) {
            envParts.push(entry.environmentContext.weatherLabel);
          }
          if (entry.environmentContext.temperature != null) {
            envParts.push(`${Math.round(entry.environmentContext.temperature)}°`);
          }
          if (entry.environmentContext.daySummary?.sunshinePercent != null) {
            envParts.push(`${entry.environmentContext.daySummary.sunshinePercent}% sunshine`);
          }
          if (envParts.length > 0) {
            doc.text(`Environment: ${envParts.join(', ')}`, margin, yPos);
            yPos += 4;
          }
        }

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        const textLines = doc.splitTextToSize(entry.text, 170);
        textLines.forEach(line => {
          if (yPos > pageHeight - 10) {
            doc.addPage();
            yPos = 20;
          }
          doc.text(line, margin, yPos);
          yPos += 5;
        });

        if (entry.analysis?.cbt_breakdown) {
          const cbt = entry.analysis.cbt_breakdown;
          yPos += 3;
          doc.setFontSize(9);
          doc.setFont(undefined, 'italic');

          if (cbt.automatic_thought) {
            if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; }
            doc.text(`Thought: ${cbt.automatic_thought}`, margin + 5, yPos);
            yPos += 4;
          }
          if (cbt.distortion) {
            if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; }
            doc.text(`Distortion: ${cbt.distortion}`, margin + 5, yPos);
            yPos += 4;
          }
          if (cbt.suggested_reframe || cbt.challenge) {
            if (yPos > pageHeight - 20) { doc.addPage(); yPos = 20; }
            doc.text(`Reframe: ${cbt.suggested_reframe || cbt.challenge}`, margin + 5, yPos);
            yPos += 4;
          }
        }

        yPos += 8;
      });

      doc.save('engram-export.pdf');
    } catch (e) {
      console.error('PDF generation failed:', e);
      alert('PDF generation failed. Falling back to JSON export.');
      generateJSON();
    }
    setExporting(false);
  };

  const generateJSON = () => {
    const selectedList = filteredEntries.filter(e => selectedEntries.has(e.id));
    const exportData = {
      exportDate: new Date().toISOString(),
      entryCount: selectedList.length,
      entries: selectedList.map(e => ({
        date: e.createdAt.toISOString(),
        title: e.title,
        text: e.text,
        mood_score: e.analysis?.mood_score,
        entry_type: e.entry_type,
        tags: e.tags,
        cbt_breakdown: e.analysis?.cbt_breakdown,
        // Include health context
        healthContext: e.healthContext ? {
          sleep: e.healthContext.sleep ? {
            totalHours: e.healthContext.sleep.totalHours,
            quality: e.healthContext.sleep.quality,
            score: e.healthContext.sleep.score
          } : null,
          heart: e.healthContext.heart ? {
            hrv: e.healthContext.heart.hrv,
            hrvTrend: e.healthContext.heart.hrvTrend,
            restingRate: e.healthContext.heart.restingRate
          } : null,
          recovery: e.healthContext.recovery,
          strain: e.healthContext.strain,
          activity: e.healthContext.activity ? {
            stepsToday: e.healthContext.activity.stepsToday,
            exerciseMinutes: e.healthContext.activity.totalExerciseMinutes,
            hasWorkout: e.healthContext.activity.hasWorkout
          } : null
        } : null,
        // Include environment context
        environmentContext: e.environmentContext ? {
          weather: e.environmentContext.weather,
          weatherLabel: e.environmentContext.weatherLabel,
          temperature: e.environmentContext.temperature,
          daySummary: e.environmentContext.daySummary ? {
            condition: e.environmentContext.daySummary.condition,
            sunshinePercent: e.environmentContext.daySummary.sunshinePercent,
            tempHigh: e.environmentContext.daySummary.tempHigh,
            tempLow: e.environmentContext.daySummary.tempLow
          } : null,
          lightContext: e.environmentContext.lightContext,
          daylightHours: e.environmentContext.daylightHours
        } : null
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'engram-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    if (selectedEntries.size === 0) {
      alert('Please select at least one entry to export.');
      return;
    }
    if (exportFormat === 'pdf') {
      generatePDF();
    } else {
      generateJSON();
    }
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
        <div className="p-6 border-b border-honey-100 bg-gradient-to-r from-honey-500 to-honey-600 text-white">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-display font-bold flex items-center gap-2"><FileText size={20} /> Export for Therapist</h2>
              <p className="text-sm opacity-80 mt-1 font-body">Select entries to include in your export</p>
            </div>
            <motion.button
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className="text-white/80 hover:text-white"
            >
              <X size={24} />
            </motion.button>
          </div>
        </div>

        <div className="p-4 border-b border-warm-100 bg-warm-50">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-xs font-display font-semibold text-warm-500 uppercase block mb-1">From</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="border border-warm-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-honey-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-display font-semibold text-warm-500 uppercase block mb-1">To</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="border border-warm-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-honey-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-display font-semibold text-warm-500 uppercase block mb-1">Format</label>
              <select
                value={exportFormat}
                onChange={e => setExportFormat(e.target.value)}
                className="border border-warm-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-honey-500 outline-none"
              >
                <option value="pdf">PDF</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-honey-600 hover:underline">Select All</button>
              <button onClick={selectNone} className="text-xs text-warm-500 hover:underline">Clear</button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-warm-500 mb-3 font-body">{selectedEntries.size} of {filteredEntries.length} entries selected</p>
          <div className="space-y-2">
            {filteredEntries.map((entry, index) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02 }}
                onClick={() => toggleEntry(entry.id)}
                className={`p-3 rounded-2xl border cursor-pointer transition-all ${
                  selectedEntries.has(entry.id)
                    ? 'border-honey-500 bg-honey-50'
                    : 'border-warm-200 hover:border-warm-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center mt-0.5 ${
                    selectedEntries.has(entry.id) ? 'bg-honey-600 border-honey-600' : 'border-warm-300'
                  }`}>
                    {selectedEntries.has(entry.id) && <Check size={14} className="text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-warm-400">{entry.createdAt.toLocaleDateString()}</span>
                      {typeof entry.analysis?.mood_score === 'number' && (
                        <span className="text-sm">{getMoodEmoji(entry.analysis.mood_score)}</span>
                      )}
                    </div>
                    <h4 className="font-display font-medium text-warm-800 truncate">{entry.title}</h4>
                    <p className="text-sm text-warm-500 line-clamp-2 font-body">{entry.text}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-warm-100 bg-warm-50">
          <motion.button
            onClick={handleExport}
            disabled={exporting || selectedEntries.size === 0}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="w-full bg-honey-600 text-white py-3 rounded-2xl font-display font-semibold flex items-center justify-center gap-2 hover:bg-honey-700 disabled:bg-warm-300 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <><Loader2 size={18} className="animate-spin" /> Generating...</>
            ) : (
              <><Download size={18} /> Export {selectedEntries.size} Entries</>
            )}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default TherapistExportScreen;
