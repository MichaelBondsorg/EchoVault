/**
 * Tests for PDF Export Cloud Function
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin
const mockGetSignedUrl = vi.fn().mockResolvedValue(['https://storage.example.com/report.pdf?token=abc']);
const mockSave = vi.fn().mockResolvedValue();
const mockFile = vi.fn().mockReturnValue({
  save: mockSave,
  getSignedUrl: mockGetSignedUrl,
});
const mockBucket = vi.fn().mockReturnValue({ file: mockFile });

const mockGet = vi.fn();
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: vi.fn().mockReturnValue({ get: mockGet }),
  }),
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: mockBucket,
  }),
}));

// Mock @react-pdf/renderer
const mockRenderToBuffer = vi.fn().mockResolvedValue(Buffer.from('fake-pdf-content'));
vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: mockRenderToBuffer,
  Document: ({ children }) => children,
  Page: ({ children }) => children,
  View: ({ children }) => children,
  Text: ({ children }) => children,
  StyleSheet: { create: (s) => s },
  Font: { register: vi.fn() },
  Svg: ({ children }) => children,
  Line: () => null,
  Rect: () => null,
  Circle: () => null,
  Path: () => null,
}));

// Import after mocks
const { applyRedactions, anonymizeEntities } = await import('../pdfExport.js');

// Valid report IDs for integration tests
const VALID_REPORT_ID = 'monthly-2026-01-01';

// Sample report data
const makeReport = (overrides = {}) => ({
  cadence: 'monthly',
  periodStart: { toDate: () => new Date('2026-01-01') },
  periodEnd: { toDate: () => new Date('2026-01-31') },
  generatedAt: { toDate: () => new Date('2026-02-01') },
  status: 'ready',
  sections: [
    { id: 'summary', title: 'Summary', narrative: 'Alice and Bob had a good month. Alice improved.', entities: ['Alice', 'Bob'], entryRefs: ['e1', 'e2'] },
    { id: 'goals', title: 'Goals', narrative: 'Working toward fitness goals.', entities: [], entryRefs: ['e3'] },
    { id: 'patterns', title: 'Patterns', narrative: 'Sleep patterns detected.', entities: [], entryRefs: ['e4'] },
  ],
  metadata: { entryCount: 10, moodAvg: 7.2, topInsights: ['Improving mood'], topEntities: ['Alice'] },
  ...overrides,
});

const makePrivacy = (overrides = {}) => ({
  hiddenSections: [],
  anonymizedEntities: [],
  ...overrides,
});

// Helper: mock the subscription read used by the entitlement gate.
// Must be queued FIRST — handleExportRequest checks entitlement before reading
// the report doc.
const mockActiveSubscription = () => {
  mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ status: 'active' }) });
};

// Helper: mock entry lookups (non-crisis by default)
const mockEntryLookups = (count, crisisIds = new Set()) => {
  for (let i = 0; i < count; i++) {
    const entryId = `e${i + 1}`;
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ safety_flagged: crisisIds.has(entryId) }),
    });
  }
};

// Helper: mock entry lookups where some entries carry
// `has_warning_indicators` instead of/alongside `safety_flagged` (Minor 5
// adversarial fixture — warning-indicator-only entries, no crisis flag).
const mockEntryLookupsWithFlags = (count, { crisisIds = new Set(), warningIds = new Set() } = {}) => {
  for (let i = 0; i < count; i++) {
    const entryId = `e${i + 1}`;
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        safety_flagged: crisisIds.has(entryId),
        has_warning_indicators: warningIds.has(entryId),
      }),
    });
  }
};

describe('pdfExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('applyRedactions', () => {
    it('removes hidden sections from report', () => {
      const report = makeReport();
      const privacy = makePrivacy({ hiddenSections: ['goals'] });
      const result = applyRedactions(report, privacy);
      expect(result.sections).toHaveLength(2);
      expect(result.sections.map(s => s.id)).toEqual(['summary', 'patterns']);
    });

    it('strips crisis-flagged entry references', () => {
      const report = makeReport();
      const privacy = makePrivacy();
      const crisisEntryIds = new Set(['e2']);
      const result = applyRedactions(report, privacy, crisisEntryIds);
      const summarySec = result.sections.find(s => s.id === 'summary');
      expect(summarySec.entryRefs).not.toContain('e2');
      expect(summarySec.entryRefs).toContain('e1');
    });

    it('returns all sections when no privacy prefs', () => {
      const report = makeReport();
      const result = applyRedactions(report, null);
      expect(result.sections).toHaveLength(3);
    });
  });

  describe('anonymizeEntities', () => {
    it('replaces entity names with placeholders in narrative', () => {
      const text = 'Alice and Bob went hiking. Alice enjoyed it.';
      const result = anonymizeEntities(text, ['Alice', 'Bob']);
      expect(result).not.toContain('Alice');
      expect(result).not.toContain('Bob');
      expect(result).toContain('Person A');
      expect(result).toContain('Person B');
    });

    it('returns original text when no entities to anonymize', () => {
      const text = 'A normal narrative.';
      expect(anonymizeEntities(text, [])).toBe(text);
      expect(anonymizeEntities(text, null)).toBe(text);
    });

    it('handles case-insensitive matching', () => {
      const text = 'alice went walking. ALICE was happy.';
      const result = anonymizeEntities(text, ['Alice']);
      expect(result).not.toMatch(/alice/i);
      expect(result).toContain('Person A');
    });
  });

  describe('exportReportPdf integration', () => {
    it('rejects unauthenticated requests', async () => {
      const { handleExportRequest } = await import('../pdfExport.js');
      await expect(handleExportRequest({ reportId: VALID_REPORT_ID }, null))
        .rejects.toThrow(/authentication/i);
    });

    it('rejects missing reportId', async () => {
      const { handleExportRequest } = await import('../pdfExport.js');
      await expect(handleExportRequest({}, 'user1'))
        .rejects.toThrow(/reportId/i);
    });

    it('rejects invalid reportId format', async () => {
      const { handleExportRequest } = await import('../pdfExport.js');
      await expect(handleExportRequest({ reportId: '../../hack' }, 'user1'))
        .rejects.toThrow(/invalid/i);
    });

    it('rejects a non-premium user exporting a premium report', async () => {
      // No active subscription → entitlement gate rejects before any report read.
      mockGet.mockResolvedValueOnce({ exists: false });
      const { handleExportRequest } = await import('../pdfExport.js');
      await expect(handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1'))
        .rejects.toThrow(/premium/i);
    });

    it('allows a weekly (free) report without a subscription', async () => {
      // Weekly is a free feature: checkEntitlement short-circuits and never
      // reads the subscription doc, so the first Firestore get is the report.
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makeReport({ cadence: 'weekly' }) });
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makePrivacy() });
      mockEntryLookups(4);
      const { handleExportRequest } = await import('../pdfExport.js');
      const result = await handleExportRequest({ reportId: 'weekly-2026-01-05' }, 'user1');
      expect(result.downloadUrl).toBeTruthy();
    });

    it('rejects if report does not exist', async () => {
      mockActiveSubscription();
      mockGet.mockResolvedValueOnce({ exists: false });
      const { handleExportRequest } = await import('../pdfExport.js');
      await expect(handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1'))
        .rejects.toThrow(/not found/i);
    });

    it('rejects if report status is not ready', async () => {
      mockActiveSubscription();
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makeReport({ status: 'generating' }) });
      const { handleExportRequest } = await import('../pdfExport.js');
      await expect(handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1'))
        .rejects.toThrow(/not.*ready/i);
    });

    it('generates PDF and returns download URL', async () => {
      mockActiveSubscription();
      // Report doc
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makeReport() });
      // Privacy prefs doc
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makePrivacy() });
      // Entry lookups (4 unique entries: e1, e2, e3, e4)
      mockEntryLookups(4);

      const { handleExportRequest } = await import('../pdfExport.js');
      const result = await handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1');

      expect(mockRenderToBuffer).toHaveBeenCalled();
      expect(mockSave).toHaveBeenCalled();
      expect(mockGetSignedUrl).toHaveBeenCalled();
      expect(result.downloadUrl).toBe('https://storage.example.com/report.pdf?token=abc');
    });

    it('applies section redactions from privacy preferences', async () => {
      mockActiveSubscription();
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makeReport() });
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makePrivacy({ hiddenSections: ['goals'] }) });
      // Entry lookups (4 unique entries)
      mockEntryLookups(4);

      const { handleExportRequest } = await import('../pdfExport.js');
      await handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1');

      expect(mockRenderToBuffer).toHaveBeenCalledTimes(1);
    });

    it('strips crisis-flagged entries from export', async () => {
      mockActiveSubscription();
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makeReport() });
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makePrivacy() });
      // Entry lookups: e2 is crisis-flagged
      mockEntryLookups(4, new Set(['e2']));

      const { handleExportRequest } = await import('../pdfExport.js');
      await handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1');

      // Verify the function completed (crisis stripping happens before render)
      expect(mockRenderToBuffer).toHaveBeenCalledTimes(1);
    });

    it('never hands a crisis-flagged entry id to the PDF renderer (non-vacuous: real, non-empty entryRefs)', async () => {
      // Regression guard for the bug this task fixes: entryRefs used to be
      // written as [] by every report-generation path, which made the
      // crisis-strip logic below (applyRedactions, driven by
      // report.sections[].entryRefs) unreachable in practice — there was
      // never anything in entryRefs to strip. This test uses report fixture
      // data with real, non-empty entryRefs (['e1','e2'] on 'summary', etc.,
      // matching what generator.js/narrative.js now actually write) and
      // inspects what's actually passed to the PDF renderer, not just
      // whether rendering completed.
      mockActiveSubscription();
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makeReport() });
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makePrivacy() });
      // e2 (referenced by the 'summary' section) is crisis-flagged.
      mockEntryLookups(4, new Set(['e2']));

      const { handleExportRequest } = await import('../pdfExport.js');
      await handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1');

      // buildPdfDocument() builds:
      //   React.createElement(Document, null, CoverPage, SummaryPage, ...sectionElements)
      // React.createElement never invokes component functions — it only
      // creates descriptor objects — so we can inspect what was actually
      // handed to each SectionPage element's props without needing to mock
      // React itself or execute the component bodies.
      expect(mockRenderToBuffer).toHaveBeenCalledTimes(1);
      const pdfDocElement = mockRenderToBuffer.mock.calls[0][0];
      const [, , ...sectionElements] = pdfDocElement.props.children;

      const renderedSummary = sectionElements.find((el) => el.props.section.id === 'summary');
      const renderedGoals = sectionElements.find((el) => el.props.section.id === 'goals');

      // e2 was stripped from the section that referenced it...
      expect(renderedSummary.props.section.entryRefs).not.toContain('e2');
      // ...but a non-crisis ref on the SAME section survives the strip...
      expect(renderedSummary.props.section.entryRefs).toContain('e1');
      // ...and a different section's non-crisis ref is untouched.
      expect(renderedGoals.props.section.entryRefs).toEqual(['e3']);
    });

    it('never hands a has_warning_indicators-only entry id to the PDF renderer (Minor 5: export redaction asymmetry fix)', async () => {
      // Adversarial fixture: e2 carries `has_warning_indicators: true` but
      // NOT `safety_flagged` — before this fix, pdfExport.js's inline
      // crisis-check only tested `safety_flagged`, so a warning-indicator
      // (but not crisis-flagged) entry would leak into the exported PDF's
      // entryRefs, unlike `privacy.js#filterForExport`'s stricter export-path
      // semantics (strips both flags). e1 carries neither flag and must
      // survive.
      mockActiveSubscription();
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makeReport() });
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makePrivacy() });
      mockEntryLookupsWithFlags(4, { warningIds: new Set(['e2']) });

      const { handleExportRequest } = await import('../pdfExport.js');
      await handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1');

      const pdfDocElement = mockRenderToBuffer.mock.calls[0][0];
      const [, , ...sectionElements] = pdfDocElement.props.children;
      const renderedSummary = sectionElements.find((el) => el.props.section.id === 'summary');

      expect(renderedSummary.props.section.entryRefs).not.toContain('e2');
      expect(renderedSummary.props.section.entryRefs).toContain('e1');
    });

    it('URL expires after 24 hours', async () => {
      mockActiveSubscription();
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makeReport() });
      mockGet.mockResolvedValueOnce({ exists: false });
      // Entry lookups
      mockEntryLookups(4);

      const { handleExportRequest } = await import('../pdfExport.js');
      await handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1');

      const signedUrlCall = mockGetSignedUrl.mock.calls[0][0];
      expect(signedUrlCall.action).toBe('read');
      // Expires should be roughly 24 hours from now
      const expiryMs = new Date(signedUrlCall.expires).getTime();
      const nowMs = Date.now();
      const diff = expiryMs - nowMs;
      expect(diff).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(diff).toBeLessThan(25 * 60 * 60 * 1000);
    });

    it('uploads to correct storage path', async () => {
      mockActiveSubscription();
      mockGet.mockResolvedValueOnce({ exists: true, data: () => makeReport() });
      mockGet.mockResolvedValueOnce({ exists: false });
      // Entry lookups
      mockEntryLookups(4);

      const { handleExportRequest } = await import('../pdfExport.js');
      await handleExportRequest({ reportId: VALID_REPORT_ID }, 'user1');

      expect(mockFile).toHaveBeenCalledWith(`reports/user1/${VALID_REPORT_ID}.pdf`);
    });
  });
});
