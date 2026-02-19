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
