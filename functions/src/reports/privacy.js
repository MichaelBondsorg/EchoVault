/**
 * Report Safety Filtering — Privacy Module
 *
 * Ensures crisis-flagged entries never leak into shareable or exported
 * report content. This is an automatic safety measure, not user-toggleable.
 *
 * Filter strictness levels:
 *   Personal view > Shareable > Export (most restrictive)
 */

/**
 * Filter entries for the user's personal (in-app) view.
 * All entries are included — the user can see their own crisis entries.
 *
 * @param {Array} entries - Journal entries
 * @returns {Array} Copy of entries (unfiltered)
 */
export function filterForPersonalView(entries) {
  if (!entries) return [];
  return [...entries];
}

/**
 * Filter entries for shareable content (sent to others, used in AI narrative).
 * Removes entries where safety_flagged === true.
 *
 * @param {Array} entries - Journal entries
 * @returns {Array} Entries without safety-flagged ones
 */
export function filterForShareableContent(entries) {
  if (!entries) return [];
  return entries.filter(e => !e.safety_flagged);
}

/**
 * Filter entries for export (PDF, external sharing).
 * Most restrictive: removes safety_flagged AND warning_indicator entries.
 *
 * @param {Array} entries - Journal entries
 * @returns {Array} Entries without any safety flags
 */
export function filterForExport(entries) {
  if (!entries) return [];
  return entries.filter(e => !e.safety_flagged && !e.has_warning_indicators);
}

/**
 * Remove the crisis_resources section from shared reports.
 * This section must never appear in shared or exported reports.
 *
 * @param {Array} sections - Report sections
 * @returns {Array} Sections without crisis_resources
 */
export function filterSectionsForSharing(sections) {
  if (!sections) return [];
  return sections.filter(s => s.id !== 'crisis_resources');
}

/**
 * Apply safety filtering to report sections.
 * Removes entryRefs pointing to safety-flagged entries.
 *
 * @param {Array} sections - Report sections with entryRefs
 * @param {Object} entryMetadata - Map of entryId → { safety_flagged, has_warning_indicators }
 * @returns {Array} Sections with flagged entryRefs removed
 */
export function applySafetyFiltering(sections, entryMetadata) {
  return sections.map(section => {
    if (!section.entryRefs || section.entryRefs.length === 0) {
      return { ...section };
    }

    const filteredRefs = section.entryRefs.filter(ref => {
      const meta = entryMetadata[ref];
      // Unknown entries excluded (fail-closed for safety)
      if (!meta) return false;
      return !meta.safety_flagged;
    });

    return {
      ...section,
      entryRefs: filteredRefs,
    };
  });
}
