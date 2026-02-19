/**
 * Reports Store
 *
 * Manages report state: report list, active report, privacy preferences, export progress.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

const initialState = {
  reports: [],
  activeReport: null,
  activeReportPrivacy: null,
  loading: false,
  exportProgress: null, // null | 'exporting' | 'complete' | 'error'
};

export const useReportsStore = create(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchReports: async (userId) => {
        set({ loading: true }, false, 'reports/fetchReports');
        try {
          const { reportsRepository } = await import('../repositories/reports');
          const reports = await reportsRepository.findAllReports(userId);
          set({ reports, loading: false }, false, 'reports/fetchReportsSuccess');
        } catch (e) {
          console.error('[reportsStore] Failed to fetch reports:', e);
          set({ loading: false }, false, 'reports/fetchReportsError');
        }
      },

      setActiveReport: async (reportId, userId) => {
        const { reports } = get();
        const report = reports.find(r => r.id === reportId) || null;
        set({ activeReport: report }, false, 'reports/setActiveReport');

        if (report && userId) {
          try {
            const { reportPreferencesRepository } = await import('../repositories/reports');
            const privacy = await reportPreferencesRepository.getPreferences(userId, reportId);
            set({ activeReportPrivacy: privacy }, false, 'reports/setActiveReportPrivacy');
          } catch {
            set({ activeReportPrivacy: null }, false, 'reports/setActiveReportPrivacyError');
          }
        }
      },

      clearActiveReport: () => set(
        { activeReport: null, activeReportPrivacy: null },
        false,
        'reports/clearActiveReport'
      ),

      exportPdf: async (userId, reportId) => {
        set({ exportProgress: 'exporting' }, false, 'reports/exportPdfStart');
        try {
          const { exportReportPdfFn } = await import('../config/firebase');
          const result = await exportReportPdfFn({ reportId });
          set({ exportProgress: 'complete' }, false, 'reports/exportPdfComplete');
          return result.data?.downloadUrl || null;
        } catch (e) {
          console.error('[reportsStore] PDF export failed:', e);
          set({ exportProgress: 'error' }, false, 'reports/exportPdfError');
          return null;
        }
      },

      updatePrivacy: async (userId, reportId, prefs) => {
        try {
          const { reportPreferencesRepository } = await import('../repositories/reports');
          await reportPreferencesRepository.savePreferences(userId, reportId, prefs);
          set({ activeReportPrivacy: { id: reportId, ...prefs } }, false, 'reports/updatePrivacy');
        } catch (e) {
          console.error('[reportsStore] Failed to update privacy:', e);
        }
      },

      reset: () => set(initialState, false, 'reports/reset'),
    }),
    { name: 'reports-store' }
  )
);

export const useReports = () => useReportsStore((state) => state.reports);
export const useActiveReport = () => useReportsStore((state) => state.activeReport);
export const useReportsLoading = () => useReportsStore((state) => state.loading);
export const useExportProgress = () => useReportsStore((state) => state.exportProgress);
