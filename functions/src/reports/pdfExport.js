/**
 * Report PDF Export Cloud Function
 *
 * Generates a styled PDF from a report document with privacy controls applied
 * (section redaction, entity anonymization, crisis content stripping).
 * Uploads to Firebase Storage and returns a signed download URL.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import React from 'react';
import { renderToBuffer, Document, Page, View, Text, StyleSheet, Font, Svg, Line, Rect } from '@react-pdf/renderer';
import { APP_COLLECTION_ID, DEFAULT_REGION, MEMORY, TIMEOUTS } from '../shared/constants.js';

// Placeholder labels for anonymized entities
const PERSON_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `Person ${l}`);

// Valid reportId format: cadence-YYYY-MM-DD
const REPORT_ID_PATTERN = /^(weekly|monthly|quarterly|annual)-\d{4}-\d{2}-\d{2}$/;

// Custom error codes for clean mapping to HttpsError
class ExportError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// PDF Styles
const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 11, color: '#3d3d3d' },
  coverPage: { padding: 40, fontFamily: 'Helvetica', justifyContent: 'center', alignItems: 'center' },
  coverTitle: { fontSize: 28, fontWeight: 'bold', color: '#4a6fa5', marginBottom: 12 },
  coverCadence: { fontSize: 16, color: '#6b7b8d', marginBottom: 8 },
  coverPeriod: { fontSize: 14, color: '#8a9bac', marginBottom: 4 },
  coverDate: { fontSize: 11, color: '#aab5c0', marginTop: 20 },
  coverBrand: { fontSize: 10, color: '#c5cdd5', marginTop: 40 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#4a6fa5', marginBottom: 8, marginTop: 16 },
  narrative: { fontSize: 11, lineHeight: 1.6, color: '#3d3d3d', marginBottom: 12 },
  metaLabel: { fontSize: 10, color: '#8a9bac', marginBottom: 2 },
  metaValue: { fontSize: 13, fontWeight: 'bold', color: '#3d3d3d', marginBottom: 8 },
  divider: { marginVertical: 12 },
  insightItem: { fontSize: 11, color: '#3d3d3d', marginBottom: 4, paddingLeft: 8 },
  entityChip: { fontSize: 10, color: '#4a6fa5', marginRight: 6 },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 8, color: '#c5cdd5', textAlign: 'center' },
  chartContainer: { marginVertical: 10, alignItems: 'center' },
});

/**
 * Apply privacy redactions to a report.
 * - Removes hidden sections
 * - Strips crisis-flagged entry references
 *
 * @param {Object} report - Report data
 * @param {Object|null} privacy - Privacy preferences (hiddenSections, anonymizedEntities)
 * @param {Set<string>} [crisisEntryIds] - Entry IDs flagged as crisis content
 * @returns {Object} Redacted report (shallow copy)
 */
export function applyRedactions(report, privacy, crisisEntryIds) {
  let sections = [...report.sections];

  // Remove hidden sections
  if (privacy?.hiddenSections?.length) {
    const hidden = new Set(privacy.hiddenSections);
    sections = sections.filter(s => !hidden.has(s.id));
  }

  // Strip crisis-flagged entry refs
  if (crisisEntryIds?.size) {
    sections = sections.map(s => ({
      ...s,
      entryRefs: (s.entryRefs || []).filter(ref => !crisisEntryIds.has(ref)),
    }));
  }

  return { ...report, sections };
}

/**
 * Replace entity names with anonymous placeholders in text.
 * Case-insensitive replacement with consistent mapping.
 *
 * @param {string} text - Original narrative text
 * @param {string[]|null} entityNames - Names to anonymize
 * @returns {string} Anonymized text
 */
export function anonymizeEntities(text, entityNames) {
  if (!entityNames?.length) return text;
  if (!text) return text;

  let result = text;
  entityNames.forEach((name, i) => {
    const label = PERSON_LABELS[i] || `Person ${i + 1}`;
    const regex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(regex, label);
  });

  return result;
}

// --- PDF Components ---

function CoverPage({ report }) {
  const cadenceLabel = report.cadence.charAt(0).toUpperCase() + report.cadence.slice(1);
  const periodStart = report.periodStart.toDate ? report.periodStart.toDate() : new Date(report.periodStart);
  const periodEnd = report.periodEnd.toDate ? report.periodEnd.toDate() : new Date(report.periodEnd);
  const generatedAt = report.generatedAt.toDate ? report.generatedAt.toDate() : new Date(report.generatedAt);

  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return React.createElement(Page, { size: 'A4', style: styles.coverPage },
    React.createElement(Text, { style: styles.coverTitle }, `${cadenceLabel} Life Report`),
    React.createElement(Text, { style: styles.coverPeriod }, `${fmt(periodStart)} — ${fmt(periodEnd)}`),
    React.createElement(Text, { style: styles.coverDate }, `Generated ${fmt(generatedAt)}`),
    React.createElement(Text, { style: styles.coverBrand }, 'Engram — Your Journal Companion'),
    React.createElement(View, { style: styles.footer },
      React.createElement(Text, null, 'Generated by Engram')
    )
  );
}

function SummaryPage({ metadata }) {
  const meta = metadata || {};
  return React.createElement(Page, { size: 'A4', style: styles.page },
    React.createElement(Text, { style: styles.sectionTitle }, 'Overview'),
    React.createElement(View, { style: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 } },
      React.createElement(View, null,
        React.createElement(Text, { style: styles.metaLabel }, 'Journal Entries'),
        React.createElement(Text, { style: styles.metaValue }, String(meta.entryCount || 0))
      ),
      React.createElement(View, null,
        React.createElement(Text, { style: styles.metaLabel }, 'Average Mood'),
        React.createElement(Text, { style: styles.metaValue }, meta.moodAvg != null ? meta.moodAvg.toFixed(1) : '—')
      )
    ),
    meta.topInsights?.length ? React.createElement(View, { style: { marginBottom: 12 } },
      React.createElement(Text, { style: styles.metaLabel }, 'Key Insights'),
      ...meta.topInsights.map((insight, i) =>
        React.createElement(Text, { key: i, style: styles.insightItem }, `• ${insight}`)
      )
    ) : null,
    React.createElement(View, { style: styles.footer },
      React.createElement(Text, null, 'Generated by Engram')
    )
  );
}

function SectionPage({ section }) {
  return React.createElement(Page, { size: 'A4', style: styles.page },
    React.createElement(Text, { style: styles.sectionTitle }, section.title),
    React.createElement(Text, { style: styles.narrative }, section.narrative || ''),
    section.chartData ? React.createElement(View, { style: styles.chartContainer },
      renderChartToPdf(section.chartData, section.chartType)
    ) : null,
    React.createElement(View, { style: styles.footer },
      React.createElement(Text, null, 'Generated by Engram')
    )
  );
}

/**
 * Render chart data as @react-pdf/renderer SVG elements.
 * Supports line charts (mood trends) and bar charts (category breakdown).
 */
function renderChartToPdf(chartData, chartType) {
  if (!chartData?.points?.length && !chartData?.bars?.length) return null;

  const W = 400;
  const H = 150;
  const PAD = 20;

  if (chartType === 'bar' && chartData.bars?.length) {
    const maxVal = Math.max(...chartData.bars.map(b => b.value));
    const barW = Math.min(40, (W - PAD * 2) / chartData.bars.length - 4);
    return React.createElement(Svg, { width: W, height: H, viewBox: `0 0 ${W} ${H}` },
      ...chartData.bars.map((bar, i) => {
        const barH = maxVal > 0 ? ((bar.value / maxVal) * (H - PAD * 2)) : 0;
        const x = PAD + i * (barW + 4);
        const y = H - PAD - barH;
        return React.createElement(Rect, {
          key: i, x, y, width: barW, height: barH,
          fill: '#4a6fa5', opacity: 0.8,
        });
      })
    );
  }

  // Default: line chart
  if (chartData.points?.length > 1) {
    const maxY = Math.max(...chartData.points.map(p => p.y));
    const minY = Math.min(...chartData.points.map(p => p.y));
    const range = maxY - minY || 1;
    const stepX = (W - PAD * 2) / (chartData.points.length - 1);

    const lineSegments = [];
    for (let i = 0; i < chartData.points.length - 1; i++) {
      const x1 = PAD + i * stepX;
      const y1 = H - PAD - ((chartData.points[i].y - minY) / range) * (H - PAD * 2);
      const x2 = PAD + (i + 1) * stepX;
      const y2 = H - PAD - ((chartData.points[i + 1].y - minY) / range) * (H - PAD * 2);
      lineSegments.push(
        React.createElement(Line, { key: i, x1, y1, x2, y2, stroke: '#4a6fa5', strokeWidth: 2 })
      );
    }
    return React.createElement(Svg, { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, ...lineSegments);
  }

  return null;
}

/**
 * Build the complete PDF document from redacted report data.
 */
function buildPdfDocument(report) {
  return React.createElement(Document, null,
    React.createElement(CoverPage, { report }),
    React.createElement(SummaryPage, { metadata: report.metadata }),
    ...report.sections.map((section, i) =>
      React.createElement(SectionPage, { key: i, section })
    )
  );
}

/**
 * Main handler logic for PDF export.
 * Separated from the Cloud Function wrapper for testability.
 *
 * @param {Object} data - Request data { reportId }
 * @param {string|null} userId - Authenticated user ID
 * @returns {Promise<{downloadUrl: string}>}
 */
export async function handleExportRequest(data, userId) {
  // 1. Validate auth
  if (!userId) {
    throw new ExportError('Authentication required', 'unauthenticated');
  }

  // 2. Validate input
  const { reportId } = data || {};
  if (!reportId) {
    throw new ExportError('reportId is required', 'invalid-argument');
  }
  if (!REPORT_ID_PATTERN.test(reportId)) {
    throw new ExportError('reportId format is invalid', 'invalid-argument');
  }

  const db = getFirestore();
  const userBase = `artifacts/${APP_COLLECTION_ID}/users/${userId}`;

  // 3. Read report document
  const reportSnap = await db.doc(`${userBase}/reports/${reportId}`).get();
  if (!reportSnap.exists) {
    throw new ExportError('Report not found', 'not-found');
  }

  const report = reportSnap.data();
  if (report.status !== 'ready') {
    throw new ExportError('Report is not ready for export', 'failed-precondition');
  }

  // 4. Read privacy preferences (optional)
  const privacySnap = await db.doc(`${userBase}/report_preferences/${reportId}`).get();
  const privacy = privacySnap.exists ? privacySnap.data() : null;

  // 5. Collect crisis-flagged entry IDs (safety-critical: never export crisis content)
  const allEntryRefs = new Set(report.sections.flatMap(s => s.entryRefs || []));
  const crisisEntryIds = new Set();
  if (allEntryRefs.size > 0) {
    const entryChecks = [...allEntryRefs].map(async (entryId) => {
      const entrySnap = await db.doc(`${userBase}/entries/${entryId}`).get();
      if (entrySnap.exists && entrySnap.data()?.safety_flagged) {
        crisisEntryIds.add(entryId);
      }
    });
    await Promise.all(entryChecks);
  }

  // 6. Apply redactions (section hiding + crisis stripping)
  let redacted = applyRedactions(report, privacy, crisisEntryIds);

  // 7. Apply entity anonymization to narratives
  if (privacy?.anonymizedEntities?.length) {
    redacted = {
      ...redacted,
      sections: redacted.sections.map(s => ({
        ...s,
        narrative: anonymizeEntities(s.narrative || '', privacy.anonymizedEntities),
      })),
    };
  }

  // 7. Render PDF
  const pdfDoc = buildPdfDocument(redacted);
  const pdfBuffer = await renderToBuffer(pdfDoc);

  // 8. Upload to Firebase Storage
  const storage = getStorage();
  const bucket = storage.bucket();
  const filePath = `reports/${userId}/${reportId}.pdf`;
  const file = bucket.file(filePath);

  await file.save(pdfBuffer, {
    contentType: 'application/pdf',
    metadata: { cacheControl: 'private, max-age=3600' },
  });

  // 9. Generate signed URL (24-hour expiry)
  const [downloadUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 24 * 60 * 60 * 1000,
  });

  return { downloadUrl };
}

/**
 * Cloud Function: exportReportPdf
 * Callable function for authenticated users to generate and download report PDFs.
 */
export const exportReportPdf = onCall({
  region: DEFAULT_REGION,
  memory: MEMORY.ai,
  timeoutSeconds: TIMEOUTS.ai,
}, async (request) => {
  const userId = request.auth?.uid;
  if (!userId) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  try {
    return await handleExportRequest(request.data, userId);
  } catch (error) {
    if (error instanceof ExportError) {
      throw new HttpsError(error.code, error.message);
    }
    throw new HttpsError('internal', 'PDF generation failed');
  }
});
