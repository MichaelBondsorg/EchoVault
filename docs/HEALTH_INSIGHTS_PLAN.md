# Health Insights Improvements Plan

Based on analysis from Gemini, Claude, and ChatGPT of your diagnostic export, this plan addresses the unanimous recommendation for a **Data Quality Layer** and adds new correlation types.

## Summary

All three external analyses identified the same core issue: 99%+ of entries have identical health data (6.2h sleep, 15ms HRV), making correlations meaningless. The top recommendation from all three is to detect and warn users about this, rather than showing false insights.

## Implementation Scope

### Phase 1: Data Quality Validation (Critical)
**New file: `src/services/basicInsights/validation/healthDataQuality.js`**

Detect "flatlined" metrics that lack variance:
- Calculate coefficient of variation (CV) for each health metric
- Flag metrics with CV < 5% as invalid for correlations
- Return warnings for UI display
- Filter out backfilled entries when assessing quality

**Integration in orchestrator:**
- Call `validateHealthDataQuality(entries)` before generating insights
- Pass quality report to health correlation functions
- Skip insights for invalid metrics
- Include `dataQualityWarnings` in result object

### Phase 2: Statistical Helper Additions
**Enhance: `src/services/basicInsights/utils/statisticalHelpers.js`**

Add:
- `coefficientOfVariation(arr)` - CV = (stdDev / mean) * 100
- `hasSufficientVariance(arr, minCV)` - Boolean check for quality

### Phase 3: Activity Momentum Correlations
**New file: `src/services/basicInsights/correlations/activityMomentum.js`**

Key findings from ChatGPT analysis:
- 3-day rolling average correlates r=0.34 vs single-day r=0.07
- 12k+ steps → next-day mood 0.712 vs 0.619 (+15%)
- Exercise sweet spot: 90-150 min (not linear)

Implement:
- `calculateRollingAverage(entries, metric, windowDays)`
- `computeActivityMomentumCorrelations(entries)`
- Insights like: "Consistent activity patterns correlate 3x better with mood"

### Phase 4: Anomaly Detection
**New file: `src/services/basicInsights/correlations/anomalyDetection.js`**

Detect mismatches that suggest external stressors:
- High activity + low mood (19 entries flagged in your data)
- Good recovery + poor mood
- Recovery-activity mismatches (pushing hard on red days)

### Phase 5: Enhanced Day Patterns
**Enhance: `src/services/basicInsights/correlations/timeCorrelations.js`**

Add named patterns:
- "Wednesday Slump" instead of "Wednesdays are 12% below average"
- "Monday Blues", "TGIF Boost", "Sunday Scaries" etc.

### Phase 6: UI Warning Display
**Enhance: `src/components/modals/InsightsPanel.jsx`**

Add data quality warning section:
- Amber banner when metrics have insufficient variance
- Message: "Not enough variation in Sleep/HRV to compute correlations"
- Help text explaining what this means

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/services/basicInsights/validation/healthDataQuality.js` | Create | Data quality validation |
| `src/services/basicInsights/correlations/activityMomentum.js` | Create | Rolling average correlations |
| `src/services/basicInsights/correlations/anomalyDetection.js` | Create | Mismatch detection |
| `src/services/basicInsights/utils/statisticalHelpers.js` | Modify | Add CV calculation |
| `src/services/basicInsights/utils/thresholds.js` | Modify | Add new thresholds |
| `src/services/basicInsights/basicInsightsOrchestrator.js` | Modify | Integrate new modules |
| `src/services/basicInsights/correlations/timeCorrelations.js` | Modify | Named day patterns |
| `src/components/modals/InsightsPanel.jsx` | Modify | Warning UI |

## New Thresholds

```javascript
// Data quality
MIN_VARIANCE_PERCENT: 5,        // CV threshold for valid data
MIN_VARIANCE_SAMPLES: 5,        // Minimum samples to assess

// Activity momentum
ROLLING_WINDOW_DAYS: 3,
STEPS_HIGH_THRESHOLD: 12000,
EXERCISE_SWEET_SPOT_MIN: 90,
EXERCISE_SWEET_SPOT_MAX: 150,

// Anomaly detection
HIGH_ACTIVITY_PERCENTILE: 75,
LOW_MOOD_THRESHOLD: 0.4,
RECOVERY_LOW_THRESHOLD: 34,     // Whoop red zone
```

## Verification

1. **Data quality detection**: Export diagnostic JSON, verify warning appears when health data is uniform
2. **Suppressed insights**: Confirm no sleep/HRV insights shown when data has no variance
3. **Activity momentum**: Verify 3-day rolling insights appear after re-backfill with fixed plugin
4. **Anomaly detection**: Check that high-activity-low-mood entries are flagged
5. **Day patterns**: Confirm "Wednesday Slump" style naming appears

## Dependencies

- Requires the HealthKit backfill bug fix (already done in Swift plugin)
- User must clear bad backfilled data and re-run backfill to get real health data
- Then these insights will work properly

## Not Included (Future Work)

- Mood score precision improvements (store raw + display-rounded)
- Sleep timing/regularity tracking
- Caffeine/alcohol self-report
- Subjective stress rating
- Life events tagging system

---

*Generated from analysis of diagnostic export by Gemini, Claude, and ChatGPT on January 20, 2026*
