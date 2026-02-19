Now I have all the context I need. Let me produce the section content.

# Section 06: Report Frontend

## Overview

This section covers the frontend components, state management, and routing for the Periodic Life Reports feature. It includes the Zustand `reportsStore`, six new React components under `src/components/reports/`, lazy-loading registration in `src/components/lazy.jsx`, a new repository for report data access, a callable Cloud Function reference for PDF export, and view routing changes in `src/App.jsx`.

**Dependencies:** This section depends on:
- **section-04-premium-gating** -- the premium entitlement service (`src/services/premium/`) must be available to gate non-weekly report cadences
- **section-05-report-cloud-functions** -- report documents must exist in Firestore at `users/{userId}/reports/{reportId}` with the data model described below

**Blocks:** section-07-report-pdf-export (the PDF export button in `ReportShareSheet` calls the export function wired up in that section)

---

## Report Data Model (Context from Section 05)

The frontend reads report documents from Firestore. Each report lives at:
```
artifacts/echo-vault-v5-fresh/users/{userId}/reports/{reportId}
```

Report ID format: `{cadence}-{YYYY-MM-DD}` (e.g., `weekly-2026-02-17`, `monthly-2026-02-01`).

Document fields consumed by the frontend:

```
reports/{reportId}
  cadence: "weekly" | "monthly" | "quarterly" | "annual"
  periodStart: Timestamp
  periodEnd: Timestamp
  generatedAt: Timestamp
  status: "generating" | "ready" | "failed"
  sections: [
    {
      id: string,           // e.g., "summary", "patterns", "goals"
      title: string,
      narrative: string,    // Gemini-generated prose (or template-based for weekly)
      chartData: object?,   // Structured data for client-side chart rendering
      entities: string[],   // Entity IDs referenced in this section
      entryRefs: string[]   // Entry IDs referenced
    }
  ]
  metadata: {
    entryCount: number,
    moodAvg: number,
    topInsights: string[],
    topEntities: string[]
  }
  notificationSent: boolean
```

Privacy preferences are stored separately at:
```
artifacts/echo-vault-v5-fresh/users/{userId}/report_preferences/{reportId}
```

Fields:
```
  hiddenSections: string[]       // Section IDs to exclude from exports
  anonymizedEntities: string[]   // Entity names to replace with "Person A", etc.
  updatedAt: Timestamp
```

---

## Tests First

All tests use Vitest with jsdom. Tests should avoid importing Firebase directly; mock repository methods and store actions.

### Test File: `/Users/michaelbond/echo-vault/src/stores/__tests__/reportsStore.test.js`

Test the Zustand reports store in isolation by verifying state transitions:

- **Test: initial state has empty reports array, null activeReport, loading false, exportProgress null**
- **Test: fetchReports populates reports array from repository data and sets loading to false**
- **Test: fetchReports sets loading to true while fetching**
- **Test: fetchReports handles fetch error gracefully (sets loading false, reports stays empty)**
- **Test: setActiveReport sets the activeReport to the matching report object**
- **Test: setActiveReport with invalid ID sets activeReport to null**
- **Test: exportPdf sets exportProgress to "exporting" then "complete" on success**
- **Test: exportPdf sets exportProgress to "error" on failure**
- **Test: updatePrivacy updates the privacy preferences for a report**
- **Test: clearActiveReport resets activeReport to null**
- **Test: reset returns all state to initial values**

### Test File: `/Users/michaelbond/echo-vault/src/components/reports/__tests__/ReportList.test.js`

Test the report list component rendering:

- **Test: renders a list of report items with cadence badges**
- **Test: shows loading spinner when reports are loading**
- **Test: shows empty state message when no reports exist**
- **Test: clicking a report item calls setActiveReport and navigates to report-detail view**
- **Test: reports are sorted by generatedAt descending (most recent first)**
- **Test: cadence badge shows correct label and color for each cadence type**
- **Test: "generating" status reports show a loading indicator instead of date**
- **Test: premium lock icon shown on non-weekly reports for free users**

### Test File: `/Users/michaelbond/echo-vault/src/components/reports/__tests__/ReportPrivacyEditor.test.js`

From the TDD plan:

- **Test: renders section toggles for each report section**
- **Test: renders entity list with anonymize toggles**
- **Test: crisis content toggle is disabled (always excluded)**
- **Test: saves preferences to Firestore on confirm**

### Test File: `/Users/michaelbond/echo-vault/src/components/reports/__tests__/ReportChart.test.js`

- **Test: renders SVG mood line chart from chartData with type "mood_trend"**
- **Test: renders SVG bar chart from chartData with type "category_breakdown"**
- **Test: handles empty chartData gracefully (renders nothing)**
- **Test: chart dimensions adapt to container width**

### Test File: `/Users/michaelbond/echo-vault/src/components/reports/__tests__/ReportViewer.test.js`

- **Test: renders all sections from the active report**
- **Test: shows loading state when report status is "generating"**
- **Test: shows error state when report status is "failed"**
- **Test: entry references are rendered as tappable links**
- **Test: share button is visible and opens ReportShareSheet on click**
- **Test: back button navigates to reports list view**

---

## Implementation Details

### 1. Reports Repository

**File to create:** `/Users/michaelbond/echo-vault/src/repositories/reports.js`

Create a repository class extending `BaseRepository` from `/Users/michaelbond/echo-vault/src/repositories/base.js`. The collection name is `reports`.

Methods to implement:

- `findAllReports(userId)` -- calls `findAll(userId, { orderByField: 'generatedAt', orderDirection: 'desc' })` to get all reports sorted newest first
- `findByStatus(userId, status)` -- calls `findByField(userId, 'status', '==', status)` to filter reports by status (e.g., `'ready'`)
- `findByCadence(userId, cadence)` -- calls `findByField(userId, 'cadence', '==', cadence)`
- `getReport(userId, reportId)` -- calls `findById(userId, reportId)`

Also create a second repository instance for `report_preferences` collection:

- `getPreferences(userId, reportId)` -- calls `findById(userId, reportId)` on the preferences collection
- `savePreferences(userId, reportId, prefs)` -- calls `createWithId(userId, reportId, prefs, { merge: true })`

Export singleton instances: `reportsRepository` and `reportPreferencesRepository`.

**File to modify:** `/Users/michaelbond/echo-vault/src/repositories/index.js`

Add exports for the new repositories:
```javascript
export { reportsRepository, reportPreferencesRepository, ReportsRepository, ReportPreferencesRepository } from './reports';
```

### 2. Cloud Function Callable Reference

**File to modify:** `/Users/michaelbond/echo-vault/src/config/firebase.js`

Add a new callable function reference for PDF export. This follows the existing pattern in the file (see lines 51-60 of the existing file):

```javascript
export const exportReportPdfFn = httpsCallable(functions, 'exportReportPdf', { timeout: 120000 }); // 2 min
```

This callable is invoked from the reports store when the user requests a PDF export. The actual Cloud Function implementation is covered in section-07-report-pdf-export.

### 3. Zustand Reports Store

**File to create:** `/Users/michaelbond/echo-vault/src/stores/reportsStore.js`

Follow the same pattern as the existing stores (see `/Users/michaelbond/echo-vault/src/stores/entriesStore.js` for the canonical example). Use `create` from `zustand` with the `devtools` middleware.

**Initial state:**
```javascript
const initialState = {
  reports: [],
  activeReport: null,
  activeReportPrivacy: null,
  loading: false,
  exportProgress: null  // null | 'exporting' | 'complete' | 'error'
};
```

**Actions:**

- `fetchReports(userId)` -- Sets `loading: true`, reads all reports from `reportsRepository.findAllReports(userId)`, sets `reports` and `loading: false`. On error, sets `loading: false` and logs the error.
- `setActiveReport(reportId)` -- Finds the report in the local `reports` array and sets `activeReport`. Also fetches privacy preferences from `reportPreferencesRepository.getPreferences(userId, reportId)` and stores in `activeReportPrivacy`.
- `clearActiveReport()` -- Sets `activeReport` and `activeReportPrivacy` to null.
- `exportPdf(userId, reportId)` -- Sets `exportProgress: 'exporting'`, calls `exportReportPdfFn({ reportId })`, on success sets `exportProgress: 'complete'` and returns the download URL. On error sets `exportProgress: 'error'`.
- `updatePrivacy(userId, reportId, prefs)` -- Calls `reportPreferencesRepository.savePreferences(userId, reportId, prefs)` and updates `activeReportPrivacy` in state.
- `reset()` -- Resets to `initialState`.

**Selector hooks to export:**
```javascript
export const useReports = () => useReportsStore((state) => state.reports);
export const useActiveReport = () => useReportsStore((state) => state.activeReport);
export const useReportsLoading = () => useReportsStore((state) => state.loading);
export const useExportProgress = () => useReportsStore((state) => state.exportProgress);
```

**File to modify:** `/Users/michaelbond/echo-vault/src/stores/index.js`

Add the reports store exports following the existing pattern. Also add `useReportsStore` to the `resetAllStores` function.

### 4. Report Components

All components go under `/Users/michaelbond/echo-vault/src/components/reports/`. Use the existing project conventions: functional components, Tailwind CSS, `lucide-react` icons, Framer Motion for animations, and the therapeutic color palette.

#### 4a. ReportList.jsx

**File to create:** `/Users/michaelbond/echo-vault/src/components/reports/ReportList.jsx`

A full-page list view showing all available reports. This is rendered when `view === 'reports'`.

Key behavior:
- On mount, calls `fetchReports(userId)` from the reports store
- Renders reports grouped or listed chronologically (newest first)
- Each report item shows: cadence badge (color-coded), period date range, status indicator
- Cadence badge colors: weekly = blue, monthly = indigo, quarterly = purple, annual = gold
- Reports with `status: 'generating'` show a subtle animated loading indicator
- Reports with `status: 'failed'` show an error indicator
- Non-weekly reports for free users show a premium lock icon (use `checkEntitlement` from `src/services/premium/`)
- Tapping a report calls `setActiveReport(reportId)` and then `setView('report-detail')` via `useUiStore`
- Empty state: friendly message like "No reports yet. Keep journaling and your first weekly digest will appear soon."
- Uses `motion.div` for list item enter animations

Icons from lucide-react: `FileText`, `Lock`, `ChevronRight`, `Loader2`

#### 4b. ReportViewer.jsx

**File to create:** `/Users/michaelbond/echo-vault/src/components/reports/ReportViewer.jsx`

Full-page scrollable report detail view. Rendered when `view === 'report-detail'`.

Key behavior:
- Reads `activeReport` from the reports store
- Header: back arrow (navigates to `view: 'reports'`), report title (e.g., "Monthly Report -- January 2026"), cadence badge, share button
- Body: iterates over `activeReport.sections` and renders a `ReportSection` for each
- Metadata footer: entry count, average mood, top entities
- When `status === 'generating'`, shows a centered loading state with the BreathingLoader component from `src/components/ui/`
- When `status === 'failed'`, shows an error message with a retry note
- Share button opens `ReportShareSheet` (rendered as a bottom sheet or modal)
- Back button calls `clearActiveReport()` and `setView('reports')`

Icons: `ArrowLeft`, `Share2`, `Calendar`, `BarChart3`

#### 4c. ReportSection.jsx

**File to create:** `/Users/michaelbond/echo-vault/src/components/reports/ReportSection.jsx`

Renders a single section of a report.

Props: `section` (the section object from the report document)

Key behavior:
- Renders `section.title` as a heading
- Renders `section.narrative` using the existing `MarkdownLite` component from `/Users/michaelbond/echo-vault/src/components/ui/MarkdownLite.jsx`
- If `section.chartData` exists, renders a `ReportChart` component below the narrative
- If `section.entryRefs` has items, renders tappable entry reference links at the bottom (clicking navigates to the journal entry -- this can use `useUiStore` to set view and pass entry context)
- Visual separator between sections (subtle divider line)

#### 4d. ReportChart.jsx

**File to create:** `/Users/michaelbond/echo-vault/src/components/reports/ReportChart.jsx`

Lightweight SVG chart renderer. No heavy charting library -- keep the bundle small.

Props: `chartData` (the structured chart data object from a section)

The `chartData` object has a `type` field that determines rendering:

- `type: 'mood_trend'` -- Line chart. Data points: `{ date: string, score: number }[]`. Renders an SVG polyline with dots at data points. Y-axis 0-10 (mood range). X-axis shows dates.
- `type: 'category_breakdown'` -- Bar chart. Data points: `{ label: string, count: number }[]`. Horizontal bars with labels and counts.
- `type: 'entry_types'` -- Donut or simple pie. Data points: `{ type: string, count: number }[]`.

Key behavior:
- SVG viewBox-based for responsiveness
- Uses the therapeutic color palette from Tailwind config (indigo, purple, teal tones)
- Graceful handling of empty or malformed data (return null)
- Minimal, clean aesthetic -- no gridlines, subtle axes only

#### 4e. ReportShareSheet.jsx

**File to create:** `/Users/michaelbond/echo-vault/src/components/reports/ReportShareSheet.jsx`

Modal or bottom-sheet overlay for sharing/exporting a report.

Props: `report` (the active report), `onClose` (dismiss handler)

Key behavior:
- "Export PDF" button -- calls `exportPdf(userId, reportId)` from the reports store. Shows progress indicator during export (`exportProgress` state). On completion, provides the download URL.
- "Edit Privacy" button -- opens `ReportPrivacyEditor` inline or as a sub-view
- Shows `exportProgress` states: idle (button), exporting (spinner + "Generating PDF..."), complete (download link), error (retry button)
- Backdrop overlay with dismiss on tap outside

Icons: `Download`, `Shield`, `X`

#### 4f. ReportPrivacyEditor.jsx

**File to create:** `/Users/michaelbond/echo-vault/src/components/reports/ReportPrivacyEditor.jsx`

Privacy controls for a report before sharing/exporting.

Props: `report` (the active report), `privacy` (current privacy preferences from store), `onSave` (callback with updated preferences), `onClose`

Key behavior:
- Lists all sections from `report.sections` with toggle switches
- Each toggle controls whether the section is included in exports (toggling off adds to `hiddenSections`)
- Lists all entities from across all sections with anonymize toggles
- Toggling an entity on adds it to `anonymizedEntities` (will be replaced with "Person A", "Person B", etc. in exports)
- Crisis-flagged content toggle is always off and disabled with explanatory text ("Crisis-related content is always excluded from exports for your safety")
- "Save" button calls `onSave` with the updated preferences object, which triggers `updatePrivacy` in the store
- "Cancel" button calls `onClose` without saving

### 5. Lazy Loading Registration

**File to modify:** `/Users/michaelbond/echo-vault/src/components/lazy.jsx`

Add lazy-loaded exports for the report components, following the existing pattern in the file. The report components should be code-split since they are not needed on initial load and the main bundle is already 631KB.

Add to the "Lazy-loaded Pages" section:

```javascript
export const LazyReportList = lazy(() =>
  import('./reports/ReportList')
);

export const LazyReportViewer = lazy(() =>
  import('./reports/ReportViewer')
);
```

Add pre-wrapped versions at the bottom:

```javascript
export const ReportListWithSuspense = withSuspense(LazyReportList);
export const ReportViewerWithSuspense = withSuspense(LazyReportViewer);
```

Note: Only `ReportList` and `ReportViewer` need lazy loading since they are top-level views. `ReportSection`, `ReportChart`, `ReportShareSheet`, and `ReportPrivacyEditor` are child components loaded as part of `ReportViewer` and will be included in its chunk automatically.

### 6. App.jsx View Routing

**File to modify:** `/Users/michaelbond/echo-vault/src/App.jsx`

Add two new view cases to the view switching logic. The existing pattern uses `view` from `useUiStore` and conditionally renders components. Add:

- `view === 'reports'` -- render `ReportListWithSuspense` (from lazy.jsx)
- `view === 'report-detail'` -- render `ReportViewerWithSuspense` (from lazy.jsx)

Import the Suspense-wrapped components from lazy.jsx:

```javascript
import { ReportListWithSuspense, ReportViewerWithSuspense } from './components/lazy';
```

The exact integration point depends on how App.jsx currently switches views. The existing pattern uses the `view` variable from `useUiStore` destructuring (line ~171) and conditionally renders based on its value. Add the report views alongside existing view conditionals.

### 7. Navigation Entry Point

Add a navigation item to access reports. The most natural location is in the hamburger menu (`/Users/michaelbond/echo-vault/src/components/ui/HamburgerMenu.jsx`) or the bottom navigation bar (`/Users/michaelbond/echo-vault/src/components/zen/BottomNavbar.jsx`).

Add a menu item labeled "Reports" with a `FileText` icon from lucide-react that calls `setView('reports')`.

### 8. uiStore View Type Update

**File to modify:** `/Users/michaelbond/echo-vault/src/stores/uiStore.js`

Update the `ViewType` JSDoc typedef to include the new views:

```javascript
/**
 * @typedef {'feed' | 'dashboard' | 'insights' | 'settings' | 'reports' | 'report-detail'} ViewType
 */
```

No functional changes are needed since `setView` already accepts any string value, but the typedef serves as documentation.

---

## File Summary

**New files to create:**
| Path | Purpose |
|------|---------|
| `/Users/michaelbond/echo-vault/src/repositories/reports.js` | Reports and report preferences repository |
| `/Users/michaelbond/echo-vault/src/stores/reportsStore.js` | Zustand store for report state |
| `/Users/michaelbond/echo-vault/src/stores/__tests__/reportsStore.test.js` | Store unit tests |
| `/Users/michaelbond/echo-vault/src/components/reports/ReportList.jsx` | Report list view |
| `/Users/michaelbond/echo-vault/src/components/reports/ReportViewer.jsx` | Report detail view |
| `/Users/michaelbond/echo-vault/src/components/reports/ReportSection.jsx` | Individual section renderer |
| `/Users/michaelbond/echo-vault/src/components/reports/ReportChart.jsx` | SVG chart renderer |
| `/Users/michaelbond/echo-vault/src/components/reports/ReportShareSheet.jsx` | Share/export modal |
| `/Users/michaelbond/echo-vault/src/components/reports/ReportPrivacyEditor.jsx` | Privacy controls |
| `/Users/michaelbond/echo-vault/src/components/reports/__tests__/ReportList.test.js` | Report list tests |
| `/Users/michaelbond/echo-vault/src/components/reports/__tests__/ReportViewer.test.js` | Report viewer tests |
| `/Users/michaelbond/echo-vault/src/components/reports/__tests__/ReportChart.test.js` | Chart tests |
| `/Users/michaelbond/echo-vault/src/components/reports/__tests__/ReportPrivacyEditor.test.js` | Privacy editor tests |

**Existing files to modify:**
| Path | Change |
|------|--------|
| `/Users/michaelbond/echo-vault/src/repositories/index.js` | Add reports repository exports |
| `/Users/michaelbond/echo-vault/src/stores/index.js` | Add reports store exports and reset |
| `/Users/michaelbond/echo-vault/src/stores/uiStore.js` | Update ViewType typedef |
| `/Users/michaelbond/echo-vault/src/config/firebase.js` | Add `exportReportPdfFn` callable |
| `/Users/michaelbond/echo-vault/src/components/lazy.jsx` | Add lazy report component exports |
| `/Users/michaelbond/echo-vault/src/App.jsx` | Add report view routing |
| `/Users/michaelbond/echo-vault/src/pages/SettingsPage.jsx` | Add "Life Reports" navigation item |
| `/Users/michaelbond/echo-vault/src/components/zen/AppLayout.jsx` | Pass `onShowReports` to SettingsPage |

---

## Implementation Notes

### Deviations from Plan

1. **Navigation entry point**: Added to `SettingsPage.jsx` instead of HamburgerMenu. HamburgerMenu is dead code (imported but never rendered; replaced by Zen navigation). SettingsPage is where all sub-screen navigation lives.

2. **Premium gating**: ReportList checks `isPremium` internally via dynamic import on mount, rather than receiving it as a prop from App.jsx. Simpler wiring.

3. **Test files**: Component test files use `.jsx` extension (not `.js` as planned) because they contain JSX syntax that Vite requires the `.jsx` extension to parse.

4. **MarkdownLite**: ReportSection uses MarkdownLite to render narratives (code review fix). Plan specified this but initial implementation used plain `<p>`.

5. **BreathingLoader**: ReportViewer uses BreathingLoader for generating state (code review fix). Consistent with app's therapeutic design language.

6. **Entry ref navigation**: Entry refs are styled as interactive but don't navigate yet. Actual navigation requires entry detail view infrastructure not in scope.

### Code Review Fixes Applied
- Added missing `useReportsStore` import in App.jsx (CRITICAL: would crash on report selection)
- Wired up premium gating in ReportList
- Switched to MarkdownLite for narrative rendering
- Replaced Loader2 with BreathingLoader in ReportViewer
- Removed dead BarChart3 import
- Consolidated require() block in resetAllStores

### Test Results
- 232 tests passing (19 test files)
- New tests: 30 (10 store + 5 chart + 6 list + 5 viewer + 4 privacy editor)