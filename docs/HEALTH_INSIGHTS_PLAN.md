# Health Insights Improvements Plan (Revised)

Based on analysis from Gemini, Claude, and ChatGPT of your diagnostic export. Revised to focus on **actionable alerts** rather than passive suppression.

## Core Philosophy

When health data has problems, **help the user fix it** rather than silently hiding insights.

---

## Phase 1: Health Data Quality Alerts (Critical)

### Problem It Solves
The backfill bug caused 136 entries to have identical health data (6.2h sleep, 15ms HRV). Without detection, the app would show meaningless correlations. With detection, we alert the user and help them fix it.

### What We'll Build

**New file: `src/services/health/healthDataQuality.js`**

```javascript
/**
 * Detect health data issues and generate actionable alerts
 */

// Detect flatlined metrics (CV < 5% across 20+ entries)
export const detectHealthDataIssues = (entries) => {
  // Returns: { issues: [], isHealthy: boolean }
}

// Generate user-friendly alert with actions
export const generateHealthAlert = (issue) => {
  // Returns: { title, message, actions: ['reconnect', 'clear_resync', 'dismiss'] }
}
```

### Alert Types

| Issue Detected | Alert Message | Actions |
|----------------|---------------|---------|
| Flatlined sleep | "Sleep data stuck at 6.2h for 136 entries" | [Check Connection] [Clear & Re-sync] [This is accurate] |
| Flatlined HRV | "HRV readings identical (15ms) - sync may be broken" | [Check Connection] [Clear & Re-sync] [This is accurate] |
| No recent data | "No health data for past 7 days" | [Check Connection] [Open Health Settings] |
| Mixed sources conflict | "Whoop and Apple Health showing different data" | [Choose Primary Source] |

### UI Integration

**Location: Health Settings Screen** (not buried in Insights)

```
┌─────────────────────────────────────────────┐
│ ⚠️ Health Data Issue Detected               │
│                                             │
│ Your sleep data appears stuck at 6.2 hours  │
│ for 136 entries. This usually means:        │
│ • Health sync disconnected                  │
│ • Backfill used incorrect data              │
│                                             │
│ [Check Apple Health]  [Clear & Re-sync]     │
│                                             │
│ ○ My sleep is actually this consistent      │
└─────────────────────────────────────────────┘
```

### Dismissibility

If user clicks "My data is actually this consistent":
- Store dismissal in user preferences
- Don't show alert for that metric again
- Still skip correlations for that metric (statistically meaningless anyway)

---

## Phase 2: Statistical Helpers

**Enhance: `src/services/basicInsights/utils/statisticalHelpers.js`**

```javascript
// Coefficient of Variation - measures data spread
export const coefficientOfVariation = (arr) => {
  const mean = average(arr);
  const std = stdDev(arr);
  return mean === 0 ? 0 : (std / mean) * 100;
}

// Check if data has enough variance for meaningful correlations
export const hasSufficientVariance = (arr, minCV = 5) => {
  return coefficientOfVariation(arr) >= minCV;
}
```

**Why needed:** Phase 1 uses this to detect flatlined data.

---

## Phase 3: Activity Momentum Correlations

### What It Does
Analyzes 3-day rolling averages instead of single-day metrics. Research shows this correlates 3x better with mood (r=0.34 vs r=0.07).

**New file: `src/services/basicInsights/correlations/activityMomentum.js`**

### Insights Generated

| Insight | When Shown | Example |
|---------|------------|---------|
| Consistency insight | 3-day avg correlates better than single day | "Consistent activity over 3 days correlates 3x better with your mood than single high-activity days" |
| 12k threshold | User has 5+ days with 12k+ steps | "After 12k+ step days, your next-day mood averages 15% higher" |
| Exercise sweet spot | Enough exercise data exists | "Your mood peaks with 90-150 min exercise. More isn't always better for you." |

### Where It Appears
- Insights page → Health & Mood Patterns section
- Uses existing insight card UI with expandable methodology

---

## Phase 4: Anomaly Detection & Stressor Prompts

### What It Does
Detects when health metrics can't explain mood - suggesting external stressors are at play.

**New file: `src/services/basicInsights/correlations/anomalyDetection.js`**

### Detection Logic

```javascript
// High activity + low mood = something else going on
const isAnomaly = (entry) => {
  const highActivity = entry.steps > userMedianSteps * 1.5;
  const lowMood = entry.mood < 0.4;
  return highActivity && lowMood;
}
```

### Two Output Types

**1. Insight Card (in Insights page)**
```
🔍 External Factors at Play

You had 5 days with high activity but low mood:
• Dec 16: 10,334 steps, mood 0.20
• Dec 10: 10,564 steps, mood 0.46

Exercise didn't lift your mood these days -
external stressors may have overridden the benefits.

[View These Entries]
```

**2. Optional: Post-Entry Prompt** (future enhancement)
```
After user submits a stressed entry on a high-activity day:

"You've been active today but your entry sounds stressed.
 Want to note what's affecting your mood?

 [Work] [Relationship] [Health] [Sleep] [Other]"
```

### Why This Matters
All three external analyses agreed: your job search stress completely overrode exercise benefits. The app should recognize this pattern and help you track external factors.

---

## Phase 5: Enhanced Day-of-Week Patterns

### What It Does
Gives friendly names to temporal patterns instead of dry statistics.

**Enhance: `src/services/basicInsights/correlations/timeCorrelations.js`**

### Named Patterns

| Pattern | Trigger | Message |
|---------|---------|---------|
| Wednesday Slump | Wednesday mood 10%+ below average | "📆 Midweek Slump: Your Wednesdays average 12% lower mood" |
| Monday Blues | Monday mood 8%+ below average | "📆 Monday Blues: Mood starts 10% lower on Mondays" |
| TGIF Boost | Friday mood 8%+ above average | "📆 TGIF Effect: Fridays lift your mood 15% above baseline" |
| Weekend Lift | Sat+Sun 10%+ above weekdays | "📆 Weekend Recharge: Your mood jumps 12% on weekends" |
| Sunday Scaries | Sunday evening entries low | "📆 Sunday Scaries: Late Sunday entries trend anxious" |

### Actionable Recommendations

```
"📆 Midweek Slump Detected

Your Wednesdays average 12% lower mood (based on 29 entries).

Suggestions:
• Schedule enjoyable activities mid-week
• Lighter workload if possible
• This is common - you're not alone"
```

---

## Implementation Order

| Order | Phase | Effort | Dependencies |
|-------|-------|--------|--------------|
| 1 | Phase 2: Statistical helpers | 30 min | None |
| 2 | Phase 1: Health data quality alerts | 2 hours | Phase 2 |
| 3 | Phase 5: Day-of-week patterns | 1 hour | None |
| 4 | Phase 3: Activity momentum | 2 hours | Phase 2 |
| 5 | Phase 4: Anomaly detection | 2 hours | None |

**Total: ~7-8 hours**

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/services/health/healthDataQuality.js` | Create | Issue detection + alerts |
| `src/services/basicInsights/utils/statisticalHelpers.js` | Modify | Add CV function |
| `src/services/basicInsights/correlations/activityMomentum.js` | Create | Rolling averages |
| `src/services/basicInsights/correlations/anomalyDetection.js` | Create | Stressor detection |
| `src/services/basicInsights/correlations/timeCorrelations.js` | Modify | Named patterns |
| `src/components/screens/HealthSettingsScreen.jsx` | Modify | Show alerts |
| `src/components/modals/InsightsPanel.jsx` | Modify | New insight types |

---

## Verification Plan

1. **Phase 1**: With current bad data, alert should appear in Health Settings
2. **Phase 2**: Unit test CV calculation with known values
3. **Phase 3**: After re-backfill, verify momentum insights appear
4. **Phase 4**: Verify anomaly detection finds the Dec 16 entry (10k steps, 0.20 mood)
5. **Phase 5**: Verify "Wednesday Slump" appears (you have 29 Wednesday entries)

---

## Not Included (Future Work)

- Post-entry stressor tagging prompts
- Mood score precision improvements
- Sleep timing/regularity tracking
- Caffeine/alcohol self-report
- Life events tagging system

---

*Revised January 20, 2026 - Focus on actionable alerts over passive suppression*
