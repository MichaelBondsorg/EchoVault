/**
 * Burnout Service
 *
 * Exports all burnout detection and management functionality.
 */

export {
  computeBurnoutRiskScore,
  getRiskLevelInfo,
  RISK_LEVELS,
  FACTOR_WEIGHTS
} from './burnoutRiskScore';

export {
  FATIGUE_KEYWORDS,
  OVERWORK_KEYWORDS,
  PHYSICAL_SYMPTOMS,
  EMOTIONAL_EXHAUSTION,
  CYNICISM_KEYWORDS,
  RECOVERY_KEYWORDS,
  findKeywordMatches,
  hasWorkStressTags,
  checkTimeRisk
} from './burnoutIndicators';
