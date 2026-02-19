import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Share2, Calendar, AlertCircle } from 'lucide-react';
import { useReportsStore } from '../../stores/reportsStore';
import { BreathingLoader } from '../ui';
import ReportSection from './ReportSection';
import ReportShareSheet from './ReportShareSheet';

const CADENCE_LABELS = {
  weekly: 'Weekly Digest',
  monthly: 'Monthly Report',
  quarterly: 'Quarterly Review',
  annual: 'Annual Report',
};

function formatReportTitle(report) {
  if (!report) return '';
  const start = report.periodStart?.toDate?.() || new Date(report.periodStart);
  const end = report.periodEnd?.toDate?.() || new Date(report.periodEnd);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (report.cadence === 'monthly') return `${monthNames[start.getMonth()]} ${start.getFullYear()}`;
  if (report.cadence === 'annual') return `${start.getFullYear()}`;
  return `${monthNames[start.getMonth()]} ${start.getDate()} – ${monthNames[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

export default function ReportViewer({ onBack }) {
  const { activeReport } = useReportsStore();
  const [showShare, setShowShare] = useState(false);

  if (!activeReport) return null;

  const isGenerating = activeReport.status === 'generating';
  const isFailed = activeReport.status === 'failed';

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-warm-900 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 rounded-full hover:bg-warm-100 transition-colors">
              <ArrowLeft size={20} className="text-warm-600" />
            </button>
            <div>
              <h1 className="text-lg font-display font-semibold text-warm-900 dark:text-warm-50">
                {CADENCE_LABELS[activeReport.cadence] || 'Report'}
              </h1>
              <p className="text-xs text-warm-400 flex items-center gap-1">
                <Calendar size={12} />
                {formatReportTitle(activeReport)}
              </p>
            </div>
          </div>
          {!isGenerating && !isFailed && (
            <button
              onClick={() => setShowShare(true)}
              className="p-2 rounded-full hover:bg-warm-100 transition-colors"
            >
              <Share2 size={18} className="text-warm-600" />
            </button>
          )}
        </div>

        {/* Generating state */}
        {isGenerating && (
          <div className="flex flex-col items-center justify-center py-16">
            <BreathingLoader size="md" label="Generating your report..." />
            <p className="text-warm-400 text-sm mt-2">This may take a few minutes.</p>
          </div>
        )}

        {/* Failed state */}
        {isFailed && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle size={32} className="text-red-400 mb-4" />
            <p className="text-warm-600 font-medium">Report generation failed</p>
            <p className="text-warm-400 text-sm mt-1 max-w-xs">
              This report will be automatically retried. Please check back later.
            </p>
          </div>
        )}

        {/* Sections */}
        {!isGenerating && !isFailed && activeReport.sections && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            {activeReport.sections.map((section, i) => (
              <ReportSection key={section.id || i} section={section} />
            ))}

            {/* Metadata footer */}
            {activeReport.metadata && (
              <div className="mt-6 pt-4 border-t border-warm-100 dark:border-warm-700">
                <div className="flex flex-wrap gap-4 text-xs text-warm-400">
                  {activeReport.metadata.entryCount != null && (
                    <span>{activeReport.metadata.entryCount} entries</span>
                  )}
                  {activeReport.metadata.moodAvg != null && (
                    <span>Avg mood: {activeReport.metadata.moodAvg.toFixed(1)}/10</span>
                  )}
                  {activeReport.metadata.topEntities?.length > 0 && (
                    <span>Top: {activeReport.metadata.topEntities.slice(0, 3).join(', ')}</span>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Share Sheet */}
      {showShare && (
        <ReportShareSheet report={activeReport} onClose={() => setShowShare(false)} />
      )}
    </div>
  );
}
