a# EchoVault UI/UX Issues Register

**App URL:** https://echo-vault-app.web.app/
**Review Date:** January 17, 2026
**Reviewer:** Claude (AI Assistant)

---

## Summary

Total Issues Identified: **27**
- Critical: 3 (1 fixed)
- High: 8 (7 fixed)
- Medium: 10 (6 fixed)
- Low: 6 (2 fixed)

**Fixed: 16 issues** | **Remaining: 11 issues**

---

## Issue Categories

### 1. MODAL & DIALOG ISSUES

| ID | Severity | Component | Issue | Expected Behavior | Status |
|----|----------|-----------|-------|-------------------|--------|
| MOD-001 | High | Health Settings Modal | Modal does not close when clicking outside the overlay | Modal should close on backdrop click | ✅ Fixed |
| MOD-002 | High | Health Settings Modal | Modal does not close when pressing Escape key | Modal should close on Escape keypress | ✅ Fixed |
| MOD-003 | Medium | Health Settings Modal | X close button has low visibility and is positioned far from content | Close button should be prominent and easily accessible | ✅ Fixed |
| MOD-004 | Medium | All Modals | Background content is visible/bleeds through during modal transitions | Clean overlay transition without background bleed | ✅ Fixed (HealthSettings) |

---

### 2. COLOR & THEMING ISSUES

| ID | Severity | Component | Issue | Expected Behavior | Status |
|----|----------|-----------|-------|-------------------|--------|
| CLR-001 | Critical | Health Settings Header (Mobile) | Dark teal/green status bar clashes with app's soft pastel color palette | Header should match app's light, soft aesthetic | ✅ Fixed |
| CLR-002 | Medium | Health Settings | Pink heart icon doesn't match the app's primary teal/green color scheme | Consistent icon coloring throughout | ✅ Fixed (same as CLR-001) |
| CLR-003 | Medium | Navigation | Multiple inconsistent shades of teal/green used (nav active state vs buttons vs progress bars) | Unified color palette with defined primary/secondary colors | ⏳ Design System Review |
| CLR-004 | Low | Journal Cards | Inconsistent colored left borders (some green, some orange, some none) | Consistent visual language for card borders | ⏳ Design System Review |

---

### 3. TEXT & READABILITY ISSUES

| ID | Severity | Component | Issue | Expected Behavior | Status |
|----|----------|-----------|-------|-------------------|--------|
| TXT-001 | High | Insights Page | Low contrast text - faded gray text is difficult to read | Text should meet WCAG AA contrast ratio (4.5:1) | ✅ Fixed |
| TXT-002 | High | Journal Entries | Overly long text lines without proper max-width constraints | Line length should be 50-75 characters for readability | ✅ Fixed |
| TXT-003 | Medium | Journal Entries | Dense blocks of text without paragraph breaks or formatting | Long entries should have proper paragraph formatting | ✅ Fixed |
| TXT-004 | Low | Home Page | "Taking it one step at a time" text has low opacity/visibility | Motivational text should be clearly legible | ✅ Fixed |

---

### 4. LAYOUT & SPACING ISSUES

| ID | Severity | Component | Issue | Expected Behavior | Status |
|----|----------|-----------|-------|-------------------|--------|
| LAY-001 | High | Journal Tags | Tags overflow horizontally in a single row, creating clutter | Tags should wrap or have "show more" functionality | ✅ Fixed |
| LAY-002 | Medium | Bottom Navigation | Navigation bar partially overlaps content at bottom of scrollable areas | Content should have bottom padding to prevent overlap | ✅ Fixed |
| LAY-003 | Medium | Cards | Varying amounts of padding and spacing between cards | Consistent spacing system throughout | ⏳ Design System Review |
| LAY-004 | Low | Header | "Good evening" greeting appears redundantly on multiple pages | Single greeting on home page only, or contextual headers | ✅ Fixed |

---

### 5. DATA DISPLAY ISSUES

| ID | Severity | Component | Issue | Expected Behavior | Status |
|----|----------|-----------|-------|-------------------|--------|
| DAT-001 | Medium | Health Data | Empty states show just dashes ("— hrs", "— bpm") | Informative empty states (e.g., "No data yet" or "Connect to sync") | ✅ Fixed |
| DAT-002 | Medium | 7-Day Stats | Middle statistic shows "—" with "Stable" label - unclear meaning | Clear labels explaining what each stat represents | ✅ Fixed |
| DAT-003 | Medium | 30-Day Journey | Grid visualization lacks legend explaining color meanings | Color legend showing what each shade represents | ✅ Fixed |
| DAT-004 | Low | 30-Day Journey | No date labels on the visualization grid | Date markers to help users understand timeline | ✅ Fixed |

---

### 6. INTERACTION ISSUES

| ID | Severity | Component | Issue | Expected Behavior | Status |
|----|----------|-----------|-------|-------------------|--------|
| INT-001 | Critical | Connection Status | Redundant text "Connected to Apple Health" repeated twice in same element | Single clear status message | ⚠️ Cannot Reproduce (web) |
| INT-002 | High | Settings Items | No visual feedback when clicking on settings items before modal loads | Loading indicator or instant visual feedback | ✅ Fixed |
| INT-003 | Medium | Insight Cards | Dismiss/close buttons (×) have small tap targets | Minimum 44x44px touch targets per iOS guidelines | ✅ Fixed |

---

### 7. RESPONSIVE DESIGN ISSUES

| ID | Severity | Component | Issue | Expected Behavior | Status |
|----|----------|-----------|-------|-------------------|--------|
| RES-001 | Critical | Mobile View | Status bar styling doesn't adapt properly to mobile context | Proper safe-area handling and theme-color meta tag | ✅ Fixed |
| RES-002 | High | All Pages | Long text content doesn't reflow properly on different screen sizes | Responsive text containers with proper breakpoints | ✅ Fixed |

---

### 8. ACCESSIBILITY ISSUES

| ID | Severity | Component | Issue | Expected Behavior | Status |
|----|----------|-----------|-------|-------------------|--------|
| A11Y-001 | High | Insights Page | Low color contrast fails WCAG guidelines | Minimum 4.5:1 contrast ratio for normal text | ✅ Fixed (same as TXT-001) |
| A11Y-002 | Medium | All Modals | Focus not trapped within modal when open | Focus should cycle within modal elements | ✅ Fixed |

---

## Priority Matrix

### Critical (Fix Immediately)
1. **CLR-001** - Mobile header color clash
2. **INT-001** - Duplicate connection status text
3. **RES-001** - Mobile status bar styling

### High Priority (Fix Soon)
1. **MOD-001/002** - Modal close behavior
2. **TXT-001** - Low contrast text on Insights
3. **TXT-002** - Long text lines
4. **LAY-001** - Tag overflow
5. **INT-002** - Missing loading feedback
6. **RES-002** - Responsive text issues
7. **A11Y-001** - Contrast accessibility

### Medium Priority (Plan for Next Sprint)
- MOD-003, MOD-004, CLR-002, CLR-003, TXT-003, LAY-002, LAY-003
- DAT-001, DAT-002, DAT-003, INT-003, A11Y-002

### Low Priority (Backlog)
- CLR-004, TXT-004, LAY-004, DAT-004

---

## Recommended Fixes

### Quick Wins (< 1 hour each)
1. Add `max-width: 65ch` to text containers for better readability
2. Add backdrop click handler to modals: `onClick={(e) => e.target === e.currentTarget && onClose()}`
3. Add Escape key listener to modals
4. Remove duplicate "Connected to Apple Health" text
5. Increase text contrast on Insights page (change from light gray to darker gray)

### Design System Updates Needed
1. Define consistent color palette with primary, secondary, and accent colors
2. Establish spacing scale (4px, 8px, 16px, 24px, 32px)
3. Create reusable card component with consistent styling
4. Define typography scale with proper line-heights and max-widths

### Component Refactoring
1. Create `<Modal>` wrapper component with proper close behavior, focus trapping, and transitions
2. Create `<Tag>` component with overflow handling ("Show +N more")
3. Create `<EmptyState>` component for consistent empty data presentation
4. Update mobile header to use CSS safe-area-inset-top and proper theme colors

---

## Notes

- The app has a generally clean and calming aesthetic that aligns well with its mental health/journaling purpose
- Most issues are polish items rather than fundamental design problems
- The 30-Day Journey visualization is visually appealing but needs better labeling
- Consider adding subtle animations for better perceived performance during loading states

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-01-17 | Initial issue register created | Claude |
| 2026-01-18 | Fixed MOD-001, MOD-002 (modal close behavior), CLR-001/CLR-002 (teal header icon), TXT-001 (text contrast), TXT-002 (max-width prose), LAY-001 (tag overflow), DAT-001 (empty states), A11Y-001 (contrast) - 8 issues total | Claude |
| 2026-01-18 | Fixed MOD-003 (close button visibility), TXT-004 (text visibility), LAY-004 (redundant greeting), DAT-002 (trend labels), DAT-003 (heatmap legend), INT-002 (loading feedback), INT-003 (tap targets), A11Y-002 (focus trapping) - 8 more issues | Claude |

