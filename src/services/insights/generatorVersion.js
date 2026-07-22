/**
 * Versioned cutover — shared generation-version stamp (R4 Task 6, ratified
 * decision 2: "Legacy artifact cutover, not migration").
 *
 * A single shared constant so Nexus (`src/services/nexus/orchestrator.js`'s
 * `saveInsights`) and basicInsights
 * (`src/services/basicInsights/basicInsightsOrchestrator.js`) can never
 * drift into two different "current version" numbers — both stamp every
 * newly generated insight/cache doc with this exact value.
 *
 * Version 1 is IMPLICIT: nothing before R4 ever stamped a `generatorVersion`
 * field anywhere, so its absence on an existing doc/insight means "written
 * by a pre-R4 engine." Version 2 is the first R4-aware generation. There is
 * no data migration — old docs are read, reinterpreted (archived-not-
 * deleted for Nexus actives; cache-invalidated-once for basicInsights), and
 * replaced the next time generation actually runs. See saveInsights' and
 * getCachedBasicInsights' own comments for the exact cutover mechanics.
 *
 * Bump this constant the next time a change needs the same
 * archive-legacy/invalidate-cache-once cutover treatment (e.g. Phase 1's
 * claim store landing behind its own regeneration).
 */
export const generatorVersion = 2;
