/**
 * Strict Context Space retrieval filter (R1 plan task 10).
 *
 * `filterEntriesByScope` is applied at every retrieval seam (AI chat context,
 * companion RAG, dashboard prompts, day summaries, nexus recent-entries,
 * server-side recent-context) BEFORE candidate selection (semantic
 * similarity, tag matching, recency slicing, etc.) so a Work-scoped call can
 * never surface a Personal-space or unscoped entry as a "relevant"
 * candidate.
 *
 * Semantics (binding, from the plan):
 *  - `scope` null/undefined -> identity. Returns the SAME array reference
 *    (no copy), so legacy (pre-Context-Spaces) call sites that never pass a
 *    scope are byte-for-byte unaffected.
 *  - `scope = { spaceId }` -> strict `entry.spaceId === scope.spaceId`.
 *    Unscoped entries (no `spaceId` field) are EXCLUDED, not merged in —
 *    scoping is strict, not permissive.
 */

/**
 * @param {Array<{spaceId?: string}>} entries
 * @param {{spaceId: string} | null | undefined} scope
 * @returns {Array} `entries` itself when scope is null/undefined; otherwise a
 *   new filtered array containing only entries whose `spaceId` strictly
 *   equals `scope.spaceId`.
 */
export function filterEntriesByScope(entries, scope) {
  if (scope == null) return entries;
  const { spaceId } = scope;
  return entries.filter((entry) => entry.spaceId === spaceId);
}

export default { filterEntriesByScope };
