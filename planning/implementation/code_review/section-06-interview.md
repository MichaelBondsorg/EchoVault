# Section 06: Report Frontend - Interview Notes

## Key Decisions

### 1. Navigation Entry Point
**Decision**: Added "Life Reports" to SettingsPage instead of HamburgerMenu.
**Rationale**: HamburgerMenu is dead code - it's imported in App.jsx but never rendered anywhere. The Zen navigation redesign replaced it with TopBar + BottomNavbar + SettingsPage. The SettingsPage is where users access all sub-screens (Health, Nexus, Entity Management, etc.), making it the natural home for Reports access.

### 2. Premium Gating Implementation
**Decision**: ReportList component checks `isPremium` via dynamic import on mount.
**Rationale**: The plan specified `checkEntitlement` but `isPremium` is simpler and sufficient since the gating is binary (premium vs free). Dynamic import avoids pulling the premium service into the initial bundle.

### 3. Entry Reference Navigation (Deferred)
**Decision**: Entry refs are styled as interactive but don't navigate yet.
**Rationale**: The app lacks a standalone entry detail view. Entry refs would need to navigate to the journal page and scroll to a specific entry, which requires infrastructure not in this section's scope. Visual interactivity is indicated via hover styles.

### 4. MarkdownLite for Narratives
**Decision**: Used MarkdownLite component for rendering report section narratives.
**Rationale**: Backend generates markdown-formatted prose via Gemini. MarkdownLite is the app's existing lightweight markdown renderer already used elsewhere.

### 5. View Overlay Pattern
**Decision**: Report views use `view === 'reports'` / `view === 'report-detail'` from uiStore, rendered as AppLayout children.
**Rationale**: Consistent with existing overlay patterns (showExport, showInsights, etc.). Components self-position with `fixed inset-0 z-50`.

## Files Modified After Review
- `src/App.jsx` - Added `useReportsStore` import
- `src/components/reports/ReportList.jsx` - Added premium check via dynamic import
- `src/components/reports/ReportSection.jsx` - Switched to MarkdownLite
- `src/components/reports/ReportViewer.jsx` - Replaced Loader2 with BreathingLoader, removed dead import
- `src/stores/index.js` - Consolidated resetAllStores require block
