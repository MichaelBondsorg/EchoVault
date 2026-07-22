/**
 * Server-side mirror of the client's stable dismissal-key derivation.
 *
 * This MUST stay in sync with `dismissalKeyFor` in
 * `src/services/nexus/insightDismissal.js` (the client-authoritative
 * definition — see that module's own doc comment for the full "why keys,
 * not raw ids" rationale). The client and server live in separate
 * deployable packages so the logic is duplicated on purpose, the same
 * precedent as `functions/src/safety/crisisKeywords.js` <-> client
 * `src/config/constants.js`'s CRISIS_KEYWORDS: a divergence here would mean
 * a report could resurface an insight the user believes they permanently
 * dismissed (a UX wart, not a safety issue like the crisis-keyword case —
 * see generator.js's `readNexusData` for how a read failure is handled
 * accordingly).
 *
 * Pure, no I/O — mirrors only the key-derivation half of insightDismissal.js
 * (`dismissalKeyFor`), not the Firestore read/write helpers, which live
 * client-side only.
 */

const normalizeKeyText = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Derive a stable dismissal key for a Nexus insight. See
 * `src/services/nexus/insightDismissal.js`'s `dismissalKeyFor` for the
 * authoritative rationale per insight-id shape — kept identical here.
 *
 * @param {Object} insight
 * @returns {string|null}
 */
export const dismissalKeyFor = (insight) => {
  if (!insight) return null;
  const id = insight.id;

  if (typeof id === 'string' && id.startsWith('insight_')) {
    return `synthesis:${normalizeKeyText(insight.title || insight.summary)}`;
  }

  if (typeof id === 'string' && id.startsWith('recommendation_')) {
    return `recommendation:${insight.intervention || normalizeKeyText(insight.title)}`;
  }

  if (typeof id === 'string' && id.startsWith('entity_')) {
    const entityName = normalizeKeyText((insight.title || '').replace(/\s+effect$/i, ''));
    const moodDelta = insight.evidence?.statistical?.moodDelta;
    const direction = typeof moodDelta === 'number' ? (moodDelta > 0 ? 'boosts' : 'lowers') : '';
    return `entity_correlation:${entityName}:${direction}`;
  }

  return typeof id === 'string' ? id : null;
};

export default { dismissalKeyFor };
