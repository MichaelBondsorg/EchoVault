/**
 * Firestore security rules tests for all new collections.
 *
 * Uses @firebase/rules-unit-testing to run rules against a local emulator.
 * Requires: firebase emulators (firestore) running on localhost.
 *
 * Run: firebase emulators:exec --only firestore "npx vitest run functions/src/__tests__/firestoreRules.test.js"
 *
 * NOTE: These tests are emulator-dependent and cannot run in CI without
 * the Firestore emulator. They serve as executable documentation of the
 * security rules contract.
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc } from 'firebase/firestore';

const APP_ID = 'echo-vault-v5-fresh';
const USER_ID = 'testUser123';
const OTHER_USER_ID = 'otherUser456';

// Path helper - all user data is under artifacts/{appId}/users/{userId}/
function userPath(userId) {
  return `artifacts/${APP_ID}/users/${userId}`;
}

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'echo-vault-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

// --- Analytics collection rules ---

describe('Analytics collection rules', () => {
  it('allows authenticated owner to read analytics documents', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'analytics', 'topic_coverage');
    await assertSucceeds(getDoc(ref));
  });

  it('denies authenticated owner write to server-only analytics docs', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    for (const docId of ['topic_coverage', 'entry_stats', 'health_trends', 'entity_activity']) {
      const ref = doc(db, userPath(USER_ID), 'analytics', docId);
      await assertFails(setDoc(ref, { test: true }));
    }
  });

  it('allows authenticated owner to write gap_engagement', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'analytics', 'gap_engagement');
    await assertSucceeds(setDoc(ref, { preferences: {} }));
  });

  it('denies unauthenticated user read on analytics', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const ref = doc(db, userPath(USER_ID), 'analytics', 'topic_coverage');
    await assertFails(getDoc(ref));
  });

  it('denies other authenticated user read on analytics', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'analytics', 'topic_coverage');
    await assertFails(getDoc(ref));
  });
});

// --- Analytics gap_engagement rules ---

describe('Analytics gap_engagement rules', () => {
  it('allows owner to read and write gap_engagement', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'analytics', 'gap_engagement');
    await assertSucceeds(setDoc(ref, { domains: ['health'] }));
    await assertSucceeds(getDoc(ref));
  });

  it('allows owner to write to gap_engagement/history subcollection', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const historyRef = doc(
      db,
      userPath(USER_ID),
      'analytics',
      'gap_engagement',
      'history',
      'engagement1'
    );
    await assertSucceeds(setDoc(historyRef, { domain: 'health', timestamp: Date.now() }));
  });

  it('denies other user access to gap_engagement', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'analytics', 'gap_engagement');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { test: true }));
  });

  it('denies other user access to gap_engagement/history subcollection', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const historyRef = doc(
      db,
      userPath(USER_ID),
      'analytics',
      'gap_engagement',
      'history',
      'engagement1'
    );
    await assertFails(getDoc(historyRef));
    await assertFails(setDoc(historyRef, { domain: 'health' }));
  });
});

// --- Reports collection rules ---

describe('Reports collection rules', () => {
  it('allows authenticated owner to read reports', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reports', 'report1');
    await assertSucceeds(getDoc(ref));
  });

  it('denies authenticated owner write to reports', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reports', 'report1');
    await assertFails(setDoc(ref, { content: 'test' }));
  });

  it('denies authenticated owner delete on reports', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reports', 'report1');
    await assertFails(deleteDoc(ref));
  });

  it('denies unauthenticated user read on reports', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const ref = doc(db, userPath(USER_ID), 'reports', 'report1');
    await assertFails(getDoc(ref));
  });

  it('denies other authenticated user read on reports', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reports', 'report1');
    await assertFails(getDoc(ref));
  });
});

// --- Report preferences collection rules ---

describe('Report preferences collection rules', () => {
  it('allows owner to read and write report_preferences', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'report_preferences', 'monthly');
    await assertSucceeds(setDoc(ref, { privacy: 'private' }));
    await assertSucceeds(getDoc(ref));
  });

  it('denies other user access to report_preferences', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'report_preferences', 'monthly');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { privacy: 'public' }));
  });

  it('allows owner to delete report_preferences (falls back to defaults)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'report_preferences', 'monthly');
    await assertSucceeds(setDoc(ref, { privacy: 'private' }));
    await assertSucceeds(deleteDoc(ref));
  });
});

// --- FCM tokens collection rules ---

describe('FCM tokens collection rules', () => {
  it('allows owner to create fcm_tokens document', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'fcm_tokens', 'token1');
    await assertSucceeds(setDoc(ref, { token: 'abc123', platform: 'ios' }));
  });

  it('allows owner to update fcm_tokens document', async () => {
    // Seed the document via admin context (uses catch-all admin rule)
    const adminDb = testEnv.authenticatedContext(USER_ID, { admin: true }).firestore();
    const seedRef = doc(adminDb, userPath(USER_ID), 'fcm_tokens', 'token1');
    await assertSucceeds(setDoc(seedRef, { token: 'abc123', platform: 'ios' }));

    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'fcm_tokens', 'token1');
    await assertSucceeds(updateDoc(ref, { token: 'xyz789' }));
  });

  it('denies owner read on fcm_tokens (write-only)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'fcm_tokens', 'token1');
    await assertFails(getDoc(ref));
  });

  it('denies owner delete on fcm_tokens', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'fcm_tokens', 'token1');
    await assertFails(deleteDoc(ref));
  });

  it('denies other user write to fcm_tokens', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'fcm_tokens', 'token1');
    await assertFails(setDoc(ref, { token: 'hacked' }));
  });

  it('denies unauthenticated user write to fcm_tokens', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const ref = doc(db, userPath(USER_ID), 'fcm_tokens', 'token1');
    await assertFails(setDoc(ref, { token: 'anon' }));
  });
});

// --- Nexus conversation_queue rules ---

describe('Nexus conversation_queue rules', () => {
  it('allows owner to read conversation_queue', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'nexus', 'conversation_queue');
    await assertSucceeds(getDoc(ref));
  });

  it('denies owner write to conversation_queue (server-only)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'nexus', 'conversation_queue');
    await assertFails(setDoc(ref, { insights: [] }));
  });

  it('allows owner to write to other nexus docs', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'nexus', 'beliefs');
    await assertSucceeds(setDoc(ref, { coreBeliefs: [] }));
  });

  it('denies other user read on conversation_queue', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'nexus', 'conversation_queue');
    await assertFails(getDoc(ref));
  });
});

// --- Nexus insight_engagement rules ---

describe('Nexus insight_engagement rules', () => {
  it('allows owner to read and write insight_engagement subcollection', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(
      db,
      userPath(USER_ID),
      'nexus',
      'insights',
      'insight_engagement',
      'eng1'
    );
    await assertSucceeds(setDoc(ref, { insightId: 'ins1', response: 'acknowledged' }));
    await assertSucceeds(getDoc(ref));
  });

  it('denies other user access to insight_engagement', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(
      db,
      userPath(USER_ID),
      'nexus',
      'insights',
      'insight_engagement',
      'eng1'
    );
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { insightId: 'ins1' }));
  });
});

// --- Notification settings rules ---

describe('Notification settings rules', () => {
  // Already covered by existing settings/{settingId} rule
  it('allows owner to read and write settings/notifications', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'notifications');
    await assertSucceeds(setDoc(ref, { reportReady: true, insightDelivery: true }));
    await assertSucceeds(getDoc(ref));
  });
});

// --- AI consent settings rules (settings/consent shape validation) ---

describe('AI consent settings rules', () => {
  it('allows owner to write a valid consent shape (aiProcessing bool only)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'consent');
    await assertSucceeds(setDoc(ref, { aiProcessing: true }));
  });

  it('allows owner to write consent with permitted extra keys', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'consent');
    await assertSucceeds(
      setDoc(ref, { aiProcessing: false, policyVersion: 1, updatedAt: Date.now() })
    );
  });

  it('allows owner to read their own consent doc', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'consent');
    await assertSucceeds(getDoc(ref));
  });

  it('denies a consent write with a non-bool aiProcessing', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'consent');
    await assertFails(setDoc(ref, { aiProcessing: 'yes' }));
  });

  it('denies a consent write missing aiProcessing', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'consent');
    await assertFails(setDoc(ref, { policyVersion: 1 }));
  });

  it('denies a consent write with an unexpected junk key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'consent');
    await assertFails(setDoc(ref, { aiProcessing: true, hacked: 'gotcha' }));
  });

  it('denies another user reading the consent doc', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'consent');
    await assertFails(getDoc(ref));
  });

  it('denies another user writing the consent doc', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'consent');
    await assertFails(setDoc(ref, { aiProcessing: false }));
  });
});

// --- Top-level config/flags rules (D12: feature-flag service) -----------

describe('Top-level config/flags rules', () => {
  it('allows an authenticated user to read config/flags', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, 'config', 'flags');
    await assertSucceeds(getDoc(ref));
  });

  it('denies an unauthenticated user reading config/flags', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const ref = doc(db, 'config', 'flags');
    await assertFails(getDoc(ref));
  });

  it('denies an authenticated user writing config/flags', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, 'config', 'flags');
    await assertFails(setDoc(ref, { coreFirstSave: true }));
  });

  it('denies an authenticated user reading any other config/{docId}', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, 'config', 'secrets');
    await assertFails(getDoc(ref));
  });
});

// --- Intents collection rules (PRD 0B precision-first intent system) -----

// Seed a server-created intent (bypassing rules, as the Admin SDK does) so we
// can exercise the client update contract against it.
async function seedIntent(intentId, state, extra = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, userPath(USER_ID), 'intents', intentId), {
      ownerId: USER_ID,
      entryId: 'entry-1',
      kind: 'task',
      state,
      sourceSpan: { start: 0, end: 5, text: 'call' },
      attributes: { agency: true, concrete: true, unfinished: true, temporalFit: true, negated: false, quoted: false, conditional: false, goalLanguage: false, otherOwned: false, completed: false },
      confidence: 0.9,
      activationReason: 'seed',
      targetAt: null,
      authorization: { notifications: false },
      versions: { extraction: 1, model: 'gemini-3.5-flash', prompt: 1, schema: 1 },
      decidedBy: 'policy',
      createdAt: 'seed',
      updatedAt: 'seed',
      ...extra,
    });
  });
}

describe('Intents collection rules', () => {
  it('allows the owner to read their own intents', async () => {
    await seedIntent('i-read', 'active');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(getDoc(doc(db, userPath(USER_ID), 'intents', 'i-read')));
  });

  it('denies another user reading an intent', async () => {
    await seedIntent('i-cross', 'active');
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    await assertFails(getDoc(doc(db, userPath(USER_ID), 'intents', 'i-cross')));
  });

  it('denies a client CREATE (only the server may mint intents)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'intents', 'forged');
    await assertFails(setDoc(ref, {
      ownerId: USER_ID, kind: 'task', state: 'active',
      attributes: {}, confidence: 0.99,
    }));
  });

  it('denies a client DELETE', async () => {
    await seedIntent('i-del', 'active');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(deleteDoc(doc(db, userPath(USER_ID), 'intents', 'i-del')));
  });

  it('ALLOWS suggested -> active (keep) touching only state/updatedAt', async () => {
    await seedIntent('i-keep', 'suggested');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-keep'), { state: 'active', updatedAt: 'now' }));
  });

  it('ALLOWS active -> completed_state (complete)', async () => {
    await seedIntent('i-done', 'active');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-done'), { state: 'completed_state', updatedAt: 'now' }));
  });

  it('ALLOWS any -> dismissed', async () => {
    await seedIntent('i-dismiss', 'suggested');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-dismiss'), { state: 'dismissed', updatedAt: 'now' }));
  });

  it('FORBIDS abstain -> active (a hard-negative can never be activated by a client)', async () => {
    await seedIntent('i-abstain', 'abstain');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-abstain'), { state: 'active', updatedAt: 'now' }));
  });

  it('FORBIDS suggested -> completed_state (illegal transition)', async () => {
    await seedIntent('i-badtrans', 'suggested');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-badtrans'), { state: 'completed_state', updatedAt: 'now' }));
  });

  it('FORBIDS mutating an extraction-owned field alongside a legal state move', async () => {
    await seedIntent('i-tamper', 'suggested');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-tamper'), { state: 'active', confidence: 0.1 }));
  });

  it('denies another user updating an intent', async () => {
    await seedIntent('i-crossupd', 'suggested');
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-crossupd'), { state: 'active', updatedAt: 'now' }));
  });

  // --- PRD R1 task-repair keys (snoozedUntil/outcome/userText) ------------

  it('ALLOWS setting snoozedUntil on an active intent (no-op state)', async () => {
    await seedIntent('i-snooze', 'active');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-snooze'), {
      state: 'active',
      updatedAt: 'now',
      snoozedUntil: '2026-08-01T00:00:00.000Z',
    }));
  });

  it('ALLOWS setting outcome when closing a loop', async () => {
    await seedIntent('i-outcome', 'active');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-outcome'), {
      state: 'active',
      updatedAt: 'now',
      outcome: { closedAt: '2026-07-20T00:00:00.000Z', kind: 'closed', answerEntryId: null },
    }));
  });

  it('ALLOWS editing userText (repair) alongside a legal state move', async () => {
    await seedIntent('i-usertext', 'suggested');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-usertext'), {
      state: 'active',
      updatedAt: 'now',
      userText: 'Call the dentist',
    }));
  });

  it('FORBIDS touching sourceSpan alongside an allowed snooze update', async () => {
    await seedIntent('i-tamper-span', 'active');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-tamper-span'), {
      state: 'active',
      updatedAt: 'now',
      snoozedUntil: 'now',
      sourceSpan: { start: 0, end: 3, text: 'xyz' },
    }));
  });

  it('FORBIDS touching attributes alongside an allowed userText edit', async () => {
    await seedIntent('i-tamper-attrs', 'active');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-tamper-attrs'), {
      state: 'active',
      updatedAt: 'now',
      userText: 'hacked',
      attributes: { agency: false, concrete: false, unfinished: false, temporalFit: false, negated: false, quoted: false, conditional: false, goalLanguage: false, otherOwned: false, completed: true },
    }));
  });

  it('FORBIDS touching confidence alongside an allowed outcome close', async () => {
    await seedIntent('i-tamper-conf', 'active');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'intents', 'i-tamper-conf'), {
      state: 'active',
      updatedAt: 'now',
      confidence: 0.01,
      outcome: { closedAt: 'now', kind: 'closed', answerEntryId: null },
    }));
  });
});

// --- user_decisions collection rules -------------------------------------

describe('user_decisions collection rules', () => {
  const validDecision = { targetId: 'i1', targetType: 'intent', action: 'kept', reasonCode: null, createdAt: 'now', reversible: true };

  it('allows the owner to create a well-formed intent decision', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(addDoc(collection(db, userPath(USER_ID), 'user_decisions'), validDecision));
  });

  it('allows the owner to read their own decisions', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(getDoc(doc(db, userPath(USER_ID), 'user_decisions', 'anything')));
  });

  it('denies a decision with an unknown action', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(addDoc(collection(db, userPath(USER_ID), 'user_decisions'), { ...validDecision, action: 'frobnicate' }));
  });

  it('allows the owner to create decisions with the new R1 open-loop actions', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    for (const action of ['snoozed', 'answered', 'closed']) {
      await assertSucceeds(addDoc(collection(db, userPath(USER_ID), 'user_decisions'), { ...validDecision, action }));
    }
  });

  it('denies a decision with an unexpected extra key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(addDoc(collection(db, userPath(USER_ID), 'user_decisions'), { ...validDecision, escalate: true }));
  });

  it('denies a decision missing a required key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(addDoc(collection(db, userPath(USER_ID), 'user_decisions'), { targetId: 'i1', targetType: 'intent', action: 'kept' }));
  });

  it('denies another user creating a decision in this user space', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    await assertFails(addDoc(collection(db, userPath(USER_ID), 'user_decisions'), validDecision));
  });

  it('denies update and delete of a decision', async () => {
    let decisionId;
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const cdb = context.firestore();
      const ref = await addDoc(collection(cdb, userPath(USER_ID), 'user_decisions'), validDecision);
      decisionId = ref.id;
    });
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'user_decisions', decisionId), { action: 'dismissed' }));
    await assertFails(deleteDoc(doc(db, userPath(USER_ID), 'user_decisions', decisionId)));
  });
});

// --- Spaces collection rules (PRD R1 Context Spaces v1) -------------------

describe('Spaces collection rules', () => {
  const validSpace = { name: 'Work', state: 'active', createdAt: 'now', updatedAt: 'now' };

  it('allows the owner to create a well-formed space', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(setDoc(doc(db, userPath(USER_ID), 'spaces', 'space1'), validSpace));
  });

  it('allows the owner to read and update their own space', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'spaces', 'space1');
    await assertSucceeds(setDoc(ref, validSpace));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { name: 'Deep Work', updatedAt: 'later' }));
  });

  it('denies a space name over 40 characters', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'spaces', 'space-toolong');
    await assertFails(setDoc(ref, { ...validSpace, name: 'x'.repeat(41) }));
  });

  it('denies a non-string name', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'spaces', 'space-badname');
    await assertFails(setDoc(ref, { ...validSpace, name: 123 }));
  });

  it('denies an unknown state', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'spaces', 'space-badstate');
    await assertFails(setDoc(ref, { ...validSpace, state: 'deleted' }));
  });

  it('denies an unexpected extra key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'spaces', 'space-junk');
    await assertFails(setDoc(ref, { ...validSpace, color: 'blue' }));
  });

  it('denies another user reading, creating, or updating a space', async () => {
    const ownerDb = testEnv.authenticatedContext(USER_ID).firestore();
    const ownerRef = doc(ownerDb, userPath(USER_ID), 'spaces', 'space-cross');
    await assertSucceeds(setDoc(ownerRef, validSpace));

    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'spaces', 'space-cross');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, validSpace));
    await assertFails(updateDoc(ref, { name: 'Hacked' }));
  });

  it('denies a client DELETE (archive is a state update, never a hard delete)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'spaces', 'space-nodelete');
    await assertSucceeds(setDoc(ref, validSpace));
    await assertFails(deleteDoc(ref));
  });
});

// --- Insight Budget settings rules (settings/insightBudget shape) ---------

describe('Insight Budget settings rules', () => {
  it('allows owner to write a valid insightBudget shape', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'insightBudget');
    await assertSucceeds(setDoc(ref, { mode: 'balanced', updatedAt: 'now' }));
  });

  it('allows owner to write insightBudget with the optional shownLog list', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'insightBudget');
    await assertSucceeds(setDoc(ref, { mode: 'quiet', updatedAt: 'now', shownLog: ['insight-1'] }));
  });

  it('denies an unknown mode', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'insightBudget');
    await assertFails(setDoc(ref, { mode: 'unlimited', updatedAt: 'now' }));
  });

  it('denies a non-list shownLog', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'insightBudget');
    await assertFails(setDoc(ref, { mode: 'balanced', updatedAt: 'now', shownLog: 'not-a-list' }));
  });

  it('allows a mode-less write (recordShownInsights writing shownLog to a doc with no persisted mode yet)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'insightBudget');
    await assertSucceeds(setDoc(ref, { updatedAt: 'now', shownLog: [] }, { merge: true }));
  });

  it('allows a mode-less write with no shownLog either (bare updatedAt)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'insightBudget');
    await assertSucceeds(setDoc(ref, { updatedAt: 'now' }));
  });

  it('still denies an invalid mode on a later write, even after an earlier mode-less shownLog write', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'insightBudget');
    await assertSucceeds(setDoc(ref, { updatedAt: 'now', shownLog: [] }, { merge: true }));
    await assertFails(setDoc(ref, { mode: 'unlimited', updatedAt: 'now2' }, { merge: true }));
  });

  it('denies an unexpected extra key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'insightBudget');
    await assertFails(setDoc(ref, { mode: 'balanced', updatedAt: 'now', hacked: true }));
  });

  it('denies another user writing the insightBudget doc', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'insightBudget');
    await assertFails(setDoc(ref, { mode: 'balanced', updatedAt: 'now' }));
  });
});

// --- Space prefs settings rules (settings/spacePrefs shape) ---------------

describe('Space prefs settings rules', () => {
  it('allows owner to write a valid spacePrefs shape with a space id', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'spacePrefs');
    await assertSucceeds(setDoc(ref, { lastCaptureSpaceId: 'space1', updatedAt: 'now' }));
  });

  it('allows owner to write spacePrefs with a null lastCaptureSpaceId (unscoped)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'spacePrefs');
    await assertSucceeds(setDoc(ref, { lastCaptureSpaceId: null, updatedAt: 'now' }));
  });

  it('denies a non-string/non-null lastCaptureSpaceId', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'spacePrefs');
    await assertFails(setDoc(ref, { lastCaptureSpaceId: 42, updatedAt: 'now' }));
  });

  it('denies an unexpected extra key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'spacePrefs');
    await assertFails(setDoc(ref, { lastCaptureSpaceId: 'space1', updatedAt: 'now', hacked: true }));
  });

  it('denies another user writing the spacePrefs doc', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'spacePrefs');
    await assertFails(setDoc(ref, { lastCaptureSpaceId: 'space1', updatedAt: 'now' }));
  });
});

// --- Source exclusions collection rules (R2) -------------------------------

describe('Source exclusions collection rules', () => {
  const validExclusion = {
    entryId: 'entry-1',
    appliesTo: 'all',
    reason: 'wrong_source',
    permanent: true,
    createdAt: 'now',
  };

  it('allows the owner to create a well-formed source exclusion', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(setDoc(doc(db, userPath(USER_ID), 'source_exclusions', 'ex1'), validExclusion));
  });

  it('allows the owner to read and delete their own source exclusion', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'source_exclusions', 'ex1');
    await assertSucceeds(setDoc(ref, validExclusion));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });

  it('denies an update (delete is the only way to restore)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'source_exclusions', 'ex-noupdate');
    await assertSucceeds(setDoc(ref, validExclusion));
    await assertFails(updateDoc(ref, { reason: 'excluded_by_user' }));
  });

  it('accepts appliesTo as a specific patternType string, not just "all"', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'source_exclusions', 'ex-pattern');
    await assertSucceeds(setDoc(ref, { ...validExclusion, appliesTo: 'weekly_mood_dip' }));
  });

  it('denies a non-string entryId', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'source_exclusions', 'ex-badentry');
    await assertFails(setDoc(ref, { ...validExclusion, entryId: 123 }));
  });

  it('denies a non-string appliesTo', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'source_exclusions', 'ex-badapplies');
    await assertFails(setDoc(ref, { ...validExclusion, appliesTo: 42 }));
  });

  it('denies an unknown reason', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'source_exclusions', 'ex-badreason');
    await assertFails(setDoc(ref, { ...validExclusion, reason: 'because' }));
  });

  it('denies permanent set to false (or any non-true value)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'source_exclusions', 'ex-badpermanent');
    await assertFails(setDoc(ref, { ...validExclusion, permanent: false }));
  });

  it('denies an unexpected extra key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'source_exclusions', 'ex-junk');
    await assertFails(setDoc(ref, { ...validExclusion, note: 'hacked' }));
  });

  it('denies another user reading, creating, or deleting a source exclusion', async () => {
    const ownerDb = testEnv.authenticatedContext(USER_ID).firestore();
    const ownerRef = doc(ownerDb, userPath(USER_ID), 'source_exclusions', 'ex-cross');
    await assertSucceeds(setDoc(ownerRef, validExclusion));

    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'source_exclusions', 'ex-cross');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, validExclusion));
    await assertFails(deleteDoc(ref));
  });
});

// --- Recipes collection rules (R2 Reflection Recipes) ----------------------

describe('Recipes collection rules', () => {
  const validRecipe = {
    name: 'Weekly check-in',
    questions: ['What went well?', 'What was hard?'],
    scope: 'all',
    timeRangeDays: 7,
    cadence: 'manual',
    state: 'active',
    definitionVersion: 1,
    createdAt: 'now',
    updatedAt: 'now',
  };

  it('allows the owner to create a well-formed recipe', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(setDoc(doc(db, userPath(USER_ID), 'recipes', 'r1'), validRecipe));
  });

  it('allows the owner to read, update, and delete their own recipe', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r1');
    await assertSucceeds(setDoc(ref, validRecipe));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { state: 'archived', updatedAt: 'later' }));
    await assertSucceeds(deleteDoc(ref));
  });

  it('denies a name over 60 characters', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r-toolong');
    await assertFails(setDoc(ref, { ...validRecipe, name: 'x'.repeat(61) }));
  });

  it('denies a non-string (list) name', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r-namelist');
    await assertFails(setDoc(ref, { ...validRecipe, name: ['x'] }));
  });

  it('denies a non-string (map) name', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r-namemap');
    await assertFails(setDoc(ref, { ...validRecipe, name: { a: 1 } }));
  });

  it('denies a non-list questions field', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r-badquestions');
    await assertFails(setDoc(ref, { ...validRecipe, questions: 'not-a-list' }));
  });

  it('denies more than 5 questions', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r-toomanyquestions');
    await assertFails(setDoc(ref, { ...validRecipe, questions: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] }));
  });

  it('denies an unknown state', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r-badstate');
    await assertFails(setDoc(ref, { ...validRecipe, state: 'deleted' }));
  });

  it('denies an unknown cadence (only manual is supported in v1)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r-badcadence');
    await assertFails(setDoc(ref, { ...validRecipe, cadence: 'weekly' }));
  });

  it('denies an unexpected extra key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r-junk');
    await assertFails(setDoc(ref, { ...validRecipe, color: 'blue' }));
  });

  it('denies another user reading, creating, updating, or deleting a recipe', async () => {
    const ownerDb = testEnv.authenticatedContext(USER_ID).firestore();
    const ownerRef = doc(ownerDb, userPath(USER_ID), 'recipes', 'r-cross');
    await assertSucceeds(setDoc(ownerRef, validRecipe));

    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'recipes', 'r-cross');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, validRecipe));
    await assertFails(updateDoc(ref, { state: 'archived' }));
    await assertFails(deleteDoc(ref));
  });
});

// --- Reflections collection rules (R2) --------------------------------------

describe('Reflections collection rules', () => {
  const validReflection = {
    kind: 'recipe_run',
    recipeId: 'r1',
    definitionVersion: 1,
    scope: 'all',
    period: { start: '2026-07-14', end: '2026-07-21' },
    title: 'Weekly check-in — Jul 21',
    blocks: [{ question: 'What went well?', answer: 'Slept better.' }],
    status: 'draft',
    createdAt: 'now',
    updatedAt: 'now',
  };

  it('allows the owner to create a well-formed reflection', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(setDoc(doc(db, userPath(USER_ID), 'reflections', 'ref1'), validReflection));
  });

  it('allows the owner to read, update, and delete their own reflection', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reflections', 'ref1');
    await assertSucceeds(setDoc(ref, validReflection));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { status: 'final', updatedAt: 'later' }));
    await assertSucceeds(deleteDoc(ref));
  });

  it('allows a session_brief kind reflection (no recipeId)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reflections', 'ref-brief');
    await assertSucceeds(setDoc(ref, { ...validReflection, kind: 'session_brief', recipeId: null }));
  });

  it('denies an unknown kind', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reflections', 'ref-badkind');
    await assertFails(setDoc(ref, { ...validReflection, kind: 'summary' }));
  });

  it('denies an unknown status', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reflections', 'ref-badstatus');
    await assertFails(setDoc(ref, { ...validReflection, status: 'published' }));
  });

  it('denies a non-string title', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reflections', 'ref-badtitle');
    await assertFails(setDoc(ref, { ...validReflection, title: ['x'] }));
  });

  it('denies a non-list blocks field', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reflections', 'ref-badblocks');
    await assertFails(setDoc(ref, { ...validReflection, blocks: 'not-a-list' }));
  });

  it('denies an unexpected extra key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reflections', 'ref-junk');
    await assertFails(setDoc(ref, { ...validReflection, hacked: true }));
  });

  it('denies another user reading, creating, updating, or deleting a reflection', async () => {
    const ownerDb = testEnv.authenticatedContext(USER_ID).firestore();
    const ownerRef = doc(ownerDb, userPath(USER_ID), 'reflections', 'ref-cross');
    await assertSucceeds(setDoc(ownerRef, validReflection));

    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'reflections', 'ref-cross');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, validReflection));
    await assertFails(updateDoc(ref, { status: 'final' }));
    await assertFails(deleteDoc(ref));
  });
});

// --- Revisit exclusions collection rules (R2 Gentle Revisit) ----------------

describe('Revisit exclusions collection rules', () => {
  const validExclusion = {
    dimension: 'entry',
    value: 'entry-1',
    reason: 'never_show',
    permanent: true,
    createdAt: 'now',
    expiresAt: null,
  };

  it('allows the owner to create a well-formed revisit exclusion', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(setDoc(doc(db, userPath(USER_ID), 'revisit_exclusions', 'rex1'), validExclusion));
  });

  it('allows the owner to read and delete their own revisit exclusion', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'revisit_exclusions', 'rex1');
    await assertSucceeds(setDoc(ref, validExclusion));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });

  it('denies an update (delete is the only way to restore)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'revisit_exclusions', 'rex-noupdate');
    await assertSucceeds(setDoc(ref, validExclusion));
    await assertFails(updateDoc(ref, { reason: 'less_like_this' }));
  });

  it('allows every supported dimension', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    for (const dimension of ['entry', 'date', 'person', 'tag', 'space', 'family']) {
      const ref = doc(db, userPath(USER_ID), 'revisit_exclusions', `rex-dim-${dimension}`);
      await assertSucceeds(setDoc(ref, { ...validExclusion, dimension }));
    }
  });

  it('denies an unknown dimension', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'revisit_exclusions', 'rex-baddim');
    await assertFails(setDoc(ref, { ...validExclusion, dimension: 'topic' }));
  });

  it('denies an unknown reason', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'revisit_exclusions', 'rex-badreason');
    await assertFails(setDoc(ref, { ...validExclusion, reason: 'because' }));
  });

  it('denies a non-string value', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'revisit_exclusions', 'rex-badvalue');
    await assertFails(setDoc(ref, { ...validExclusion, value: 123 }));
  });

  it('denies an unexpected extra key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'revisit_exclusions', 'rex-junk');
    await assertFails(setDoc(ref, { ...validExclusion, note: 'hacked' }));
  });

  it('denies another user reading, creating, or deleting a revisit exclusion', async () => {
    const ownerDb = testEnv.authenticatedContext(USER_ID).firestore();
    const ownerRef = doc(ownerDb, userPath(USER_ID), 'revisit_exclusions', 'rex-cross');
    await assertSucceeds(setDoc(ownerRef, validExclusion));

    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'revisit_exclusions', 'rex-cross');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, validExclusion));
    await assertFails(deleteDoc(ref));
  });
});

// --- Revisit queue collection rules (R2 Gentle Revisit, server-written) -----

// Seed a server-created revisit_queue candidate (bypassing rules, as the
// Admin SDK does) so we can exercise the client update/read/delete contract
// against it.
async function seedRevisitQueueItem(id, status, extra = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, userPath(USER_ID), 'revisit_queue', id), {
      entryId: 'entry-1',
      dimension: 'entry',
      status,
      score: 0.5,
      createdAt: 'seed',
      updatedAt: 'seed',
      ...extra,
    });
  });
}

describe('Revisit queue collection rules', () => {
  it('denies a client CREATE (only the server may enqueue candidates)', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'revisit_queue', 'forged');
    await assertFails(setDoc(ref, { entryId: 'entry-1', status: 'pending' }));
  });

  it('allows the owner to read their own queue item', async () => {
    await seedRevisitQueueItem('rq-read', 'pending');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(getDoc(doc(db, userPath(USER_ID), 'revisit_queue', 'rq-read')));
  });

  it('allows the owner to delete their own queue item', async () => {
    await seedRevisitQueueItem('rq-del', 'pending');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(deleteDoc(doc(db, userPath(USER_ID), 'revisit_queue', 'rq-del')));
  });

  it('ALLOWS updating status to shown, touching only status/updatedAt', async () => {
    await seedRevisitQueueItem('rq-shown', 'pending');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(updateDoc(doc(db, userPath(USER_ID), 'revisit_queue', 'rq-shown'), {
      status: 'shown',
      updatedAt: 'now',
    }));
  });

  it('ALLOWS updating status to dismissed, touching only status/updatedAt', async () => {
    await seedRevisitQueueItem('rq-dismissed', 'shown');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertSucceeds(updateDoc(doc(db, userPath(USER_ID), 'revisit_queue', 'rq-dismissed'), {
      status: 'dismissed',
      updatedAt: 'now',
    }));
  });

  it('FORBIDS an unknown status value', async () => {
    await seedRevisitQueueItem('rq-badstatus', 'pending');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'revisit_queue', 'rq-badstatus'), {
      status: 'archived',
      updatedAt: 'now',
    }));
  });

  it('FORBIDS touching a field other than status/updatedAt', async () => {
    await seedRevisitQueueItem('rq-tamper', 'pending');
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    await assertFails(updateDoc(doc(db, userPath(USER_ID), 'revisit_queue', 'rq-tamper'), {
      status: 'shown',
      updatedAt: 'now',
      score: 0.99,
    }));
  });

  it('denies another user reading, updating, or deleting a queue item', async () => {
    await seedRevisitQueueItem('rq-cross', 'pending');
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'revisit_queue', 'rq-cross');
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { status: 'shown', updatedAt: 'now' }));
    await assertFails(deleteDoc(ref));
  });
});

// --- Revisit prefs settings rules (settings/revisitPrefs shape, R2) --------

describe('Revisit prefs settings rules', () => {
  it('allows owner to write a valid revisitPrefs shape', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'revisitPrefs');
    await assertSucceeds(setDoc(ref, { enabled: true, optInAt: 'now', updatedAt: 'now' }));
  });

  it('allows owner to write revisitPrefs with enabled false', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'revisitPrefs');
    await assertSucceeds(setDoc(ref, { enabled: false, updatedAt: 'now' }));
  });

  it('denies a non-bool enabled', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'revisitPrefs');
    await assertFails(setDoc(ref, { enabled: 'yes', updatedAt: 'now' }));
  });

  it('denies an unexpected extra key', async () => {
    const db = testEnv.authenticatedContext(USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'revisitPrefs');
    await assertFails(setDoc(ref, { enabled: true, updatedAt: 'now', hacked: true }));
  });

  it('denies another user writing the revisitPrefs doc', async () => {
    const db = testEnv.authenticatedContext(OTHER_USER_ID).firestore();
    const ref = doc(db, userPath(USER_ID), 'settings', 'revisitPrefs');
    await assertFails(setDoc(ref, { enabled: true, updatedAt: 'now' }));
  });
});
