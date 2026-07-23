// Admin: set a feature/model flag on the config/flags doc (echo-vault-app).
// Usage (from repo root, after `cd scripts && npm install` once):
//   export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/gcloud/legacy_credentials/<you>/adc.json"
//   node scripts/flip-flag.mjs <flagName> <true|false>
// Prints before/after; refuses unknown names as a typo guard. Flips take
// effect on the next app load (client) / within 60s (functions) — no
// deploy. Rollback = flip back to false. See the runbook's flag tables for
// per-flag rollback semantics and the recommended flip order.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const [name, value] = process.argv.slice(2);
const ALLOWED = [
  'intentExtraction', 'openLoops', 'contextSpaces', 'insightBudget',
  'insightReceipts', 'voiceChapters', 'reflectionRecipes', 'sessionPrep',
  'gentleRevisit', 'personalExperiments', 'insightClaims',
  'model.embeddingWriteV2', 'model.embeddingV2Read',
];
// String-valued model-workload overrides (registry `model.<workload>` keys).
// Each name whitelists its accepted model ids as a typo guard; 'default'
// DELETES the override so the registry default applies again (rollback).
const STRING_ALLOWED = {
  'model.fusedTranscription': ['gemini-3.5-flash', 'gemini-2.5-flash', 'default'],
};
const isBool = ALLOWED.includes(name) && ['true', 'false'].includes(value);
const isString = name in STRING_ALLOWED && STRING_ALLOWED[name].includes(value);
if (!isBool && !isString) {
  console.error(`Usage: node flip-flag.mjs <${ALLOWED.join('|')}> <true|false>`);
  console.error(`   or: node flip-flag.mjs <${Object.keys(STRING_ALLOWED).join('|')}> <model-id|default>`);
  process.exit(1);
}
initializeApp({ credential: applicationDefault(), projectId: 'echo-vault-app' });
const db = getFirestore();
const ref = db.doc('config/flags');
const before = (await ref.get()).data() || {};
console.log(`[flip-flag] before: ${name} = ${JSON.stringify(before[name])}`);
if (isString) {
  const { FieldValue } = await import('firebase-admin/firestore');
  await ref.set(
    { [name]: value === 'default' ? FieldValue.delete() : value },
    { merge: true },
  );
} else {
  await ref.set({ [name]: value === 'true' }, { merge: true });
}
const after = (await ref.get()).data() || {};
console.log(`[flip-flag] after:  ${name} = ${JSON.stringify(after[name])}`);
