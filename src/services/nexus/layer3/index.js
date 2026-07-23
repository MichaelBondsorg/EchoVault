/**
 * Layer 3: Causal Synthesizer
 *
 * LLM-powered insight generation. Most of this runs
 * via Cloud Function (generateNexusInsightsFn).
 */

export * from './synthesizer';
export * from './crossThreadDetector';
// beliefDissonance.js / counterfactual.js deleted R4-P3 per P3-D1
// (superseded by claims+experiments; legacy Firestore belief docs may
// remain, harmless).
