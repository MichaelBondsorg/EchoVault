import React, { useState, useMemo } from 'react';
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
      doc.text('EchoVault Journal Export', 20, 20);

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

      doc.save('echovault-export.pdf');
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
        cbt_breakdown: e.analysis?.cbt_breakdown
      }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'echovault-export.json';
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2"><FileText size={20} /> Export for Therapist</h2>
              <p className="text-sm opacity-80 mt-1">Select entries to include in your export</p>
            </div>
            <button onClick={onClose} className="text-white/80 hover:text-white"><X size={24} /></button>
          </div>
        </div>

        <div className="p-4 border-b border-gray-100 bg-gray-50">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase block mb-1">From</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase block mb-1">To</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase block mb-1">Format</label>
              <select
                value={exportFormat}
                onChange={e => setExportFormat(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm"
              >
                <option value="pdf">PDF</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-indigo-600 hover:underline">Select All</button>
              <button onClick={selectNone} className="text-xs text-gray-500 hover:underline">Clear</button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="text-xs text-gray-500 mb-3">{selectedEntries.size} of {filteredEntries.length} entries selected</p>
          <div className="space-y-2">
            {filteredEntries.map(entry => (
              <div
                key={entry.id}
                onClick={() => toggleEntry(entry.id)}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedEntries.has(entry.id)
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 ${
                    selectedEntries.has(entry.id) ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                  }`}>
                    {selectedEntries.has(entry.id) && <Check size={14} className="text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-gray-400">{entry.createdAt.toLocaleDateString()}</span>
                      {typeof entry.analysis?.mood_score === 'number' && (
                        <span className="text-sm">{getMoodEmoji(entry.analysis.mood_score)}</span>
                      )}
                    </div>
                    <h4 className="font-medium text-gray-800 truncate">{entry.title}</h4>
                    <p className="text-sm text-gray-500 line-clamp-2">{entry.text}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={handleExport}
            disabled={exporting || selectedEntries.size === 0}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <><Loader2 size={18} className="animate-spin" /> Generating...</>
            ) : (
              <><Download size={18} /> Export {selectedEntries.size} Entries</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TherapistExportScreen;
