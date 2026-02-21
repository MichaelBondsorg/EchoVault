import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Shield, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useReportsStore } from '../../stores/reportsStore';
import { useAuthStore } from '../../stores/authStore';
import ReportPrivacyEditor from './ReportPrivacyEditor';

export default function ReportShareSheet({ report, onClose }) {
  const { exportPdf, exportProgress, updatePrivacy, activeReportPrivacy } = useReportsStore();
  const user = useAuthStore((s) => s.user);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState(null);

  const handleExport = async () => {
    if (!user?.uid || !report?.id) return;
    const url = await exportPdf(user.uid, report.id);
    if (url) setDownloadUrl(url);
  };

  const handlePrivacySave = async (prefs) => {
    if (!user?.uid || !report?.id) return;
    await updatePrivacy(user.uid, report.id, prefs);
    setShowPrivacy(false);
  };

  if (showPrivacy) {
    return (
      <ReportPrivacyEditor
        report={report}
        privacy={activeReportPrivacy}
        onSave={handlePrivacySave}
        onClose={() => setShowPrivacy(false)}
      />
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[60] flex items-end justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />

        {/* Sheet */}
        <motion.div
          className="relative w-full max-w-lg bg-white dark:bg-warm-800 rounded-t-3xl px-6 py-8 space-y-4"
          initial={{ y: 300 }}
          animate={{ y: 0 }}
          exit={{ y: 300 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* Close */}
          <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-full hover:bg-warm-100">
            <X size={18} className="text-warm-400" />
          </button>

          <h2 className="text-lg font-display font-semibold text-warm-900 dark:text-warm-50">
            Share Report
          </h2>

          {/* Export PDF */}
          <button
            onClick={handleExport}
            disabled={exportProgress === 'exporting'}
            className="w-full flex items-center gap-3 p-4 rounded-2xl border border-warm-100 dark:border-warm-700 hover:bg-warm-50 dark:hover:bg-warm-700 transition-colors"
          >
            {exportProgress === 'exporting' ? (
              <Loader2 size={20} className="animate-spin text-honey-500" />
            ) : exportProgress === 'complete' ? (
              <CheckCircle size={20} className="text-sage-500 dark:text-sage-400" />
            ) : exportProgress === 'error' ? (
              <AlertCircle size={20} className="text-red-500" />
            ) : (
              <Download size={20} className="text-honey-600" />
            )}
            <div className="text-left flex-1">
              <p className="text-sm font-medium text-warm-800 dark:text-warm-100">
                {exportProgress === 'exporting' ? 'Generating PDF...' :
                 exportProgress === 'complete' ? 'PDF ready!' :
                 exportProgress === 'error' ? 'Export failed - tap to retry' :
                 'Export PDF'}
              </p>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-honey-600 underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Download
                </a>
              )}
            </div>
          </button>

          {/* Privacy editor */}
          <button
            onClick={() => setShowPrivacy(true)}
            className="w-full flex items-center gap-3 p-4 rounded-2xl border border-warm-100 dark:border-warm-700 hover:bg-warm-50 dark:hover:bg-warm-700 transition-colors"
          >
            <Shield size={20} className="text-lavender-500 dark:text-lavender-400" />
            <div className="text-left">
              <p className="text-sm font-medium text-warm-800 dark:text-warm-100">Edit Privacy</p>
              <p className="text-xs text-warm-400">Choose what to include in exports</p>
            </div>
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
