/**
 * Gap Prompt Safety Module
 *
 * Wraps safety checks around the gap prompt system to ensure
 * prompts do not add psychological pressure during vulnerable periods.
 *
 * Three safety layers:
 * 1. shouldShowGapPrompt — master gate based on longitudinal risk
 * 2. filterGapsForSafety — removes crisis-adjacent domains
 * 3. getPromptStyleForDomain — selects gentler tone when warranted
 */

import { checkLongitudinalRisk } from '../safety';

/**
 * Find the most recent entry in an array by createdAt.
 * Returns null if no entries have valid dates.
 * @param {Array} entries
 * @returns {Object|null}
 */
function getMostRecentEntry(entries) {
  if (!entries || entries.length === 0) return null;

  let latest = null;
  let latestTime = -Infinity;

  for (const entry of entries) {
    const time = entry.createdAt instanceof Date
      ? entry.createdAt.getTime()
      : new Date(entry.createdAt).getTime();

    // Skip entries with invalid dates (NaN guard)
    if (Number.isNaN(time)) continue;

    if (time > latestTime) {
      latestTime = time;
      latest = entry;
    }
  }

  return latest;
}

/**
 * Master safety gate for gap prompts.
 * Checks longitudinal risk — suppresses all prompts when user is at risk.
 * Fails closed: any error in risk check suppresses prompts.
 *
 * @param {string} userId - Current user ID
 * @param {Array} recentEntries - Recent journal entries for risk assessment
 * @returns {boolean} true if safe to show gap prompts
 */
export function shouldShowGapPrompt(userId, recentEntries) {
  try {
    const risk = checkLongitudinalRisk(recentEntries);
    return !risk.isAtRisk;
  } catch (error) {
    // Fail closed: suppress prompts if risk check fails
    console.error('[gapSafety] Risk check failed, suppressing prompts:', error.message);
    return false;
  }
}

/**
 * Filter gap list by removing crisis-adjacent domains.
 * A domain is crisis-adjacent if its most recent entry has safety_flagged: true.
 * Warning indicators alone do NOT suppress the domain (they get gentle prompts instead).
 *
 * @param {Array} gaps - Ranked gap list from gap detector
 * @param {Object} domainEntryMap - { domain: Entry[] } recent entries per domain
 * @returns {Array} Filtered gap list
 */
export function filterGapsForSafety(gaps, domainEntryMap) {
  return gaps.filter(gap => {
    const entries = domainEntryMap[gap.domain];
    if (!entries || entries.length === 0) return true; // No entries = safe to prompt

    const mostRecent = getMostRecentEntry(entries);
    if (!mostRecent) return true;

    // Only suppress for crisis-flagged entries (not warning indicators)
    return !mostRecent.safety_flagged;
  });
}

/**
 * Determine prompt style for a domain, respecting safety state.
 * If the most recent entry has warning indicators, forces gentle style.
 *
 * @param {string} domain - Life domain
 * @param {Array} domainEntries - Recent entries for this domain
 * @param {Object|null} userPreferences - User engagement preferences
 * @returns {string|null} Prompt style or null if no preference available
 */
export function getPromptStyleForDomain(domain, domainEntries, userPreferences) {
  const mostRecent = getMostRecentEntry(domainEntries);

  // If most recent entry has warning indicators, use gentle style
  if (mostRecent?.has_warning_indicators) {
    return 'gentle';
  }

  // Otherwise use user's preferred style
  if (userPreferences?.preferredStyle) {
    return userPreferences.preferredStyle;
  }

  return null;
}
