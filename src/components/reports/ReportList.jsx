import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Lock, ChevronRight, Loader2, ArrowLeft, AlertCircle } from 'lucide-react';
import { useReportsStore } from '../../stores/reportsStore';
import { useAuthStore } from '../../stores/authStore';

const CADENCE_STYLES = {
  weekly: { label: 'Weekly', color: 'bg-sage-100 text-sage-700 dark:bg-sage-900/30 dark:text-sage-300' },
  monthly: { label: 'Monthly', color: 'bg-lavender-100 text-lavender-700 dark:bg-lavender-900/30 dark:text-lavender-300' },
  quarterly: { label: 'Quarterly', color: 'bg-honey-100 text-honey-700 dark:bg-honey-900/30 dark:text-honey-300' },
  annual: { label: 'Annual', color: 'bg-terra-100 text-terra-700 dark:bg-terra-900/30 dark:text-terra-300' },
};

function formatPeriod(report) {
  const start = report.periodStart?.toDate?.() || new Date(report.periodStart);
  const end = report.periodEnd?.toDate?.() || new Date(report.periodEnd);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}, ${end.getFullYear()}`;
}

export default function ReportList({ onSelectReport, onClose }) {
  const { reports, loading, fetchReports } = useReportsStore();
  const user = useAuthStore((s) => s.user);
  const [premium, setPremium] = useState(false);

  useEffect(() => {
    if (user?.uid) {
      fetchReports(user.uid);
      import('../../services/premium').then(mod => {
        mod.isPremium(user.uid).then(setPremium);
      }).catch(() => {});
    }
  }, [user?.uid]);

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-warm-900 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onClose} className="p-2 rounded-full hover:bg-warm-100 dark:hover:bg-warm-800 transition-colors">
            <ArrowLeft size={20} className="text-warm-600 dark:text-warm-400" />
          </button>
          <h1 className="text-xl font-display font-semibold text-warm-900 dark:text-warm-50">
            Life Reports
          </h1>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-honey-500 mb-3" />
            <p className="text-warm-500 text-sm">Loading reports...</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && reports.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText size={48} className="text-warm-300 mb-4" />
            <p className="text-warm-600 font-medium mb-2">No reports yet</p>
            <p className="text-warm-400 text-sm max-w-xs">
              Keep journaling and your first weekly digest will appear soon.
            </p>
          </div>
        )}

        {/* Report list */}
        {!loading && reports.length > 0 && (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {reports.map((report, index) => {
                const style = CADENCE_STYLES[report.cadence] || CADENCE_STYLES.weekly;
                const isLocked = report.cadence !== 'weekly' && !premium;
                const isGenerating = report.status === 'generating';
                const isFailed = report.status === 'failed';

                return (
                  <motion.button
                    key={report.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ delay: index * 0.03 }}
                    onClick={() => !isLocked && onSelectReport(report.id)}
                    disabled={isLocked}
                    className={`
                      w-full flex items-center gap-3 p-4 rounded-2xl border transition-all text-left
                      ${isLocked
                        ? 'bg-warm-50 dark:bg-warm-900/50 border-warm-200 dark:border-warm-700 opacity-60 cursor-not-allowed'
                        : 'bg-white dark:bg-warm-800 border-warm-100 dark:border-warm-700 hover:border-honey-200 hover:shadow-soft-sm cursor-pointer'
                      }
                    `}
                  >
                    {/* Cadence badge */}
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${style.color}`}>
                      {style.label}
                    </span>

                    {/* Period and status */}
                    <div className="flex-1 min-w-0">
                      {isGenerating ? (
                        <div className="flex items-center gap-2 text-warm-500 text-sm">
                          <Loader2 size={14} className="animate-spin" />
                          <span>Generating...</span>
                        </div>
                      ) : isFailed ? (
                        <div className="flex items-center gap-2 text-red-500 text-sm">
                          <AlertCircle size={14} />
                          <span>Generation failed</span>
                        </div>
                      ) : (
                        <p className="text-sm text-warm-700 dark:text-warm-200 truncate">
                          {formatPeriod(report)}
                        </p>
                      )}
                      {report.metadata?.entryCount != null && !isGenerating && !isFailed && (
                        <p className="text-xs text-warm-400 mt-0.5">
                          {report.metadata.entryCount} entries
                        </p>
                      )}
                    </div>

                    {/* Status indicator */}
                    {isLocked ? (
                      <Lock size={16} className="text-warm-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight size={16} className="text-warm-300 flex-shrink-0" />
                    )}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
