import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useReportsStore } from '../reportsStore';

// Mock repositories
vi.mock('../../repositories/reports', () => ({
  reportsRepository: {
    findAllReports: vi.fn(),
  },
  reportPreferencesRepository: {
    getPreferences: vi.fn(),
    savePreferences: vi.fn(),
  },
}));

// Mock firebase
vi.mock('../../config/firebase', () => ({
  exportReportPdfFn: vi.fn(),
}));

describe('reportsStore', () => {
  beforeEach(() => {
    useReportsStore.getState().reset();
    vi.clearAllMocks();
  });

  it('has correct initial state', () => {
    const state = useReportsStore.getState();
    expect(state.reports).toEqual([]);
    expect(state.activeReport).toBeNull();
    expect(state.activeReportPrivacy).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.exportProgress).toBeNull();
  });

  it('fetchReports populates reports and sets loading', async () => {
    const mockReports = [
      { id: 'weekly-2026-02-09', cadence: 'weekly', status: 'ready' },
      { id: 'monthly-2026-01-01', cadence: 'monthly', status: 'ready' },
    ];

    const { reportsRepository } = await import('../../repositories/reports');
    reportsRepository.findAllReports.mockResolvedValue(mockReports);

    const promise = useReportsStore.getState().fetchReports('user1');

    // loading should be true during fetch
    expect(useReportsStore.getState().loading).toBe(true);

    await promise;

    expect(useReportsStore.getState().reports).toEqual(mockReports);
    expect(useReportsStore.getState().loading).toBe(false);
  });

  it('fetchReports handles error gracefully', async () => {
    const { reportsRepository } = await import('../../repositories/reports');
    reportsRepository.findAllReports.mockRejectedValue(new Error('Network error'));

    await useReportsStore.getState().fetchReports('user1');

    expect(useReportsStore.getState().reports).toEqual([]);
    expect(useReportsStore.getState().loading).toBe(false);
  });

  it('setActiveReport sets the matching report', async () => {
    const mockReports = [
      { id: 'weekly-2026-02-09', cadence: 'weekly' },
      { id: 'monthly-2026-01-01', cadence: 'monthly' },
    ];
    useReportsStore.setState({ reports: mockReports });

    const { reportPreferencesRepository } = await import('../../repositories/reports');
    reportPreferencesRepository.getPreferences.mockResolvedValue(null);

    await useReportsStore.getState().setActiveReport('monthly-2026-01-01', 'user1');

    expect(useReportsStore.getState().activeReport).toEqual(mockReports[1]);
  });

  it('setActiveReport with invalid ID sets activeReport to null', async () => {
    const mockReports = [{ id: 'weekly-2026-02-09', cadence: 'weekly' }];
    useReportsStore.setState({ reports: mockReports });

    await useReportsStore.getState().setActiveReport('nonexistent', 'user1');

    expect(useReportsStore.getState().activeReport).toBeNull();
  });

  it('exportPdf sets exportProgress to exporting then complete', async () => {
    const { exportReportPdfFn } = await import('../../config/firebase');
    exportReportPdfFn.mockResolvedValue({ data: { downloadUrl: 'https://example.com/pdf' } });

    const promise = useReportsStore.getState().exportPdf('user1', 'report1');
    expect(useReportsStore.getState().exportProgress).toBe('exporting');

    const url = await promise;
    expect(useReportsStore.getState().exportProgress).toBe('complete');
    expect(url).toBe('https://example.com/pdf');
  });

  it('exportPdf sets exportProgress to error on failure', async () => {
    const { exportReportPdfFn } = await import('../../config/firebase');
    exportReportPdfFn.mockRejectedValue(new Error('Export failed'));

    await useReportsStore.getState().exportPdf('user1', 'report1');

    expect(useReportsStore.getState().exportProgress).toBe('error');
  });

  it('updatePrivacy saves and updates state', async () => {
    const { reportPreferencesRepository } = await import('../../repositories/reports');
    reportPreferencesRepository.savePreferences.mockResolvedValue({});

    const prefs = { hiddenSections: ['health'], anonymizedEntities: ['John'] };
    await useReportsStore.getState().updatePrivacy('user1', 'report1', prefs);

    expect(reportPreferencesRepository.savePreferences).toHaveBeenCalledWith('user1', 'report1', prefs);
    expect(useReportsStore.getState().activeReportPrivacy).toEqual({ id: 'report1', ...prefs });
  });

  it('clearActiveReport resets to null', () => {
    useReportsStore.setState({
      activeReport: { id: 'test' },
      activeReportPrivacy: { hiddenSections: [] },
    });

    useReportsStore.getState().clearActiveReport();

    expect(useReportsStore.getState().activeReport).toBeNull();
    expect(useReportsStore.getState().activeReportPrivacy).toBeNull();
  });

  it('reset returns all state to initial values', () => {
    useReportsStore.setState({
      reports: [{ id: 'test' }],
      activeReport: { id: 'test' },
      loading: true,
      exportProgress: 'complete',
    });

    useReportsStore.getState().reset();

    const state = useReportsStore.getState();
    expect(state.reports).toEqual([]);
    expect(state.activeReport).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.exportProgress).toBeNull();
  });
});
