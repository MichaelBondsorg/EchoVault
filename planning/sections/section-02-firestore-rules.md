Now I have all the context needed. Let me produce the section content.

# Section 02: Firestore Rules and Indexes

## Overview

This section covers the Firestore security rules and composite indexes required by all new collections introduced across the three engagement features (Periodic Life Reports, Conversational Insight Delivery, Smart Journaling Prompts). It also covers the GDPR data deletion plan for the new collections.

This section has **no dependencies** on other sections and **blocks all feature sections** -- security rules must be deployed before any feature writes data to these collections.

## Background

### Current State

The existing Firestore rules live at `/Users/michaelbond/echo-vault/firestore.rules`. All user data is scoped under:

```
artifacts/{appId}/users/{userId}/...
```

The `appId` in production is `echo-vault-v5-fresh`, referenced via the `APP_COLLECTION_ID` constant in code.

The existing rules use two helper functions:

```
function isAuthenticated() {
  return request.auth != null;
}

function isOwner(userId) {
  return isAuthenticated() && request.auth.uid == userId;
}
```

There is also a catch-all admin rule at the bottom:

```
match /{document=**} {
  allow read, write: if request.auth.token.admin == true;
}
```

Cloud Functions use the Firebase Admin SDK, which bypasses Firestore security rules entirely (Admin SDK operates with full privileges). The `admin == true` catch-all rule exists for any custom token scenarios but is not the mechanism Cloud Functions use.

The existing indexes file is at `/Users/michaelbond/echo-vault/firestore.indexes.json` and currently contains a single composite index on the `threads` collection group.

### New Collections Requiring Rules

All paths below are relative to `artifacts/{appId}/users/{userId}/`:

| Collection | Purpose | Client Read | Client Write | Notes |
|------------|---------|-------------|--------------|-------|
| `analytics/topic_coverage` | Per-domain coverage scores | Yes (owner) | No (server-only) | Computed by Cloud Functions |
| `analytics/entry_stats` | Period-based entry statistics | Yes (owner) | No (server-only) | Computed by Cloud Functions |
| `analytics/health_trends` | Health data aggregations | Yes (owner) | No (server-only) | Computed by Cloud Functions |
| `analytics/entity_activity` | Entity mention tracking | Yes (owner) | No (server-only) | Computed by Cloud Functions |
| `analytics/gap_engagement` | Gap prompt preferences doc | Yes (owner) | Yes (owner) | Preferences + history subcollection |
| `analytics/gap_engagement/history/{engagementId}` | Individual gap engagement events | Yes (owner) | Yes (owner) | Subcollection to avoid unbounded doc growth |
| `reports/{reportId}` | Generated report content | Yes (owner) | No (server-only) | Written by Cloud Functions only |
| `report_preferences/{reportId}` | Privacy/sharing settings | Yes (owner) | Yes (owner) | User-editable privacy controls |
| `fcm_tokens/{tokenId}` | Push notification tokens | No | Yes (owner, create/update) | Write-only for security |
| `nexus/conversation_queue` | Insight delivery queue | Yes (owner) | No (server-only) | Written by Cloud Functions |
| `nexus/insight_engagement/{engagementId}` | Insight delivery outcomes | Yes (owner) | Yes (owner) | Written by relay server + client |
| `settings/notifications` | Notification preferences | Yes (owner) | Yes (owner) | Already covered by existing settings rule |

---

## Tests First

There is no dedicated test file for Firestore rules in the TDD plan. However, Firestore rules should be tested using the `@firebase/rules-unit-testing` package. The tests below validate all access control requirements.

### Test File: `functions/src/__tests__/firestoreRules.test.js`

Test suite structure and stubs:

```javascript
/**
 * Firestore security rules tests for all new collections.
 *
 * Uses @firebase/rules-unit-testing to run rules against a local emulator.
 * Requires: firebase emulators (firestore) running on localhost.
 *
 * Run: npm test -- firestoreRules
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment
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

describe('Analytics collection rules', () => {
  // Test: authenticated owner can read analytics documents
  // Test: authenticated owner CANNOT write to analytics/topic_coverage (server-only)
  // Test: authenticated owner CANNOT write to analytics/entry_stats (server-only)
  // Test: authenticated owner CANNOT write to analytics/health_trends (server-only)
  // Test: authenticated owner CANNOT write to analytics/entity_activity (server-only)
  // Test: unauthenticated user cannot read analytics
  // Test: other authenticated user cannot read analytics
});

describe('Analytics gap_engagement rules', () => {
  // Test: authenticated owner can read gap_engagement document
  // Test: authenticated owner can write gap_engagement document (preferences)
  // Test: authenticated owner can write to gap_engagement/history subcollection
  // Test: other user cannot read or write gap_engagement
});

describe('Reports collection rules', () => {
  // Test: authenticated owner can read their reports
  // Test: authenticated owner CANNOT write to reports (server-only)
  // Test: authenticated owner CANNOT delete reports (server-only)
  // Test: unauthenticated user cannot read reports
  // Test: other authenticated user cannot read reports
});

describe('Report preferences collection rules', () => {
  // Test: authenticated owner can read report_preferences
  // Test: authenticated owner can write report_preferences
  // Test: other user cannot access report_preferences
});

describe('FCM tokens collection rules', () => {
  // Test: authenticated owner can create fcm_tokens document
  // Test: authenticated owner can update fcm_tokens document
  // Test: authenticated owner CANNOT read fcm_tokens (write-only)
  // Test: authenticated owner CANNOT delete fcm_tokens
  // Test: other user cannot write to fcm_tokens
  // Test: unauthenticated user cannot write to fcm_tokens
});

describe('Nexus conversation_queue rules', () => {
  // Test: authenticated owner can read conversation_queue
  // Test: authenticated owner CANNOT write to conversation_queue (server-only)
  // Test: other user cannot read conversation_queue
});

describe('Nexus insight_engagement rules', () => {
  // Test: authenticated owner can read insight_engagement subcollection
  // Test: authenticated owner can write insight_engagement subcollection
  // Test: other user cannot access insight_engagement
});

describe('Notification settings rules', () => {
  // Note: already covered by existing settings/{settingId} rule
  // Test: authenticated owner can read settings/notifications
  // Test: authenticated owner can write settings/notifications
});
```

### Test Notes

- The `@firebase/rules-unit-testing` package provides `initializeTestEnvironment` which loads the rules file and creates authenticated/unauthenticated test contexts.
- Use `testEnv.authenticatedContext(userId)` to create a Firestore instance acting as a specific user.
- Use `testEnv.unauthenticatedContext()` to create an unauthenticated Firestore instance.
- Tests require the Firestore emulator to be running. Start it with: `firebase emulators:start --only firestore`
- The test file should be added to a test script in `functions/package.json` or run via a dedicated emulator test command.

---

## Implementation Details

### File to Modify: `/Users/michaelbond/echo-vault/firestore.rules`

Add the following new `match` blocks inside the existing `match /artifacts/{appId}/users/{userId}` block, after the existing subcollection rules and before the closing brace.

#### Analytics Rules

The analytics collection has mixed access control:
- Four server-computed documents (`topic_coverage`, `entry_stats`, `health_trends`, `entity_activity`) are **read-only** from the client. Cloud Functions (using Admin SDK) write these, so no client write rule is needed.
- The `gap_engagement` document and its `history` subcollection are **read-write** by the owning user.

```
// Analytics subcollection (pre-computed by Cloud Functions)
// Owner can read; only Cloud Functions can write (via Admin SDK)
match /analytics/{analyticsDocId} {
  allow read: if isOwner(userId);
  // gap_engagement is writable by the user for engagement tracking
  allow write: if isOwner(userId) && analyticsDocId == 'gap_engagement';

  // Gap engagement history subcollection (user-writable)
  match /history/{engagementId} {
    allow read, write: if isOwner(userId);
  }
}
```

**Design rationale:** Rather than listing each server-only analytics document individually, the rule allows reads on all analytics documents but restricts writes to only `gap_engagement`. This is forward-compatible: if new server-computed analytics documents are added, they automatically get read-only client access without a rules update. The specific write permission for `gap_engagement` is gated by document ID check.

#### Reports Rules

Reports are generated exclusively by Cloud Functions. The client should never be able to create, modify, or delete report documents.

```
// Reports subcollection (generated by Cloud Functions, read-only for client)
match /reports/{reportId} {
  allow read: if isOwner(userId);
  // No client write - reports are server-generated only
}
```

#### Report Preferences Rules

Users can read and write their own privacy/sharing preferences for reports.

```
// Report preferences subcollection (user-managed privacy settings)
match /report_preferences/{reportId} {
  allow read, write: if isOwner(userId);
}
```

#### FCM Tokens Rules

FCM tokens are sensitive -- they allow sending push notifications to a user's device. The client needs to **write** tokens (create new ones, update on refresh) but should never **read** them back (there is no client-side use case for reading stored tokens, and exposing them increases attack surface).

```
// FCM tokens subcollection (write-only for client)
match /fcm_tokens/{tokenId} {
  allow create, update: if isOwner(userId);
  // No read or delete from client - tokens are write-only
  // Server reads tokens via Admin SDK when sending notifications
}
```

**Important:** The rule uses `allow create, update` (not `allow write`) because `write` in Firestore rules is shorthand for `create + update + delete`. We intentionally exclude `delete` to prevent a compromised client from removing all notification tokens and effectively silencing notifications.

#### Nexus Conversation Queue Rules

The conversation queue is written by Cloud Functions (insight pre-computation) and read by the client (relay server fetches via client auth, or the frontend reads it).

```
// The existing nexus/{docId} rule already covers conversation_queue
// for reads. But conversation_queue should be read-only from client.
```

**Important note on the existing nexus rule:** The current `firestore.rules` already has:

```
match /nexus/{docId} {
  allow read, write: if isOwner(userId);
}
```

This gives clients full read/write access to all nexus documents, including `conversation_queue`. To make `conversation_queue` server-write-only, the existing `nexus/{docId}` rule must be **modified** to restrict writes on specific documents. There are two approaches:

**Approach A (Recommended -- minimal change):** Add a condition to the existing nexus write rule:

```
match /nexus/{docId} {
  allow read: if isOwner(userId);
  // Allow write to all nexus docs EXCEPT conversation_queue (server-only)
  allow write: if isOwner(userId) && docId != 'conversation_queue';
}
```

**Approach B (Explicit):** Replace the generic nexus rule with specific rules. This is more verbose but more explicit. Use Approach A unless there are many nexus documents requiring different access levels.

#### Nexus Insight Engagement Rules

The insight engagement data is a subcollection under the nexus document. Since the nexus path already uses `{docId}`, the subcollection needs a nested match:

```
// Insight engagement subcollection under nexus/
// This is already handled by the existing nexus/{docId} rule if we add
// a recursive wildcard, OR we can add an explicit subcollection match.

match /nexus/{nexusDocId}/insight_engagement/{engagementId} {
  allow read, write: if isOwner(userId);
}
```

**Note:** The existing `match /nexus/{docId}` rule does NOT automatically cover subcollections. Firestore rules are not recursive by default. The subcollection needs its own explicit match rule.

### Complete Rules Addition

Here is the complete set of rules to add inside the existing `match /artifacts/{appId}/users/{userId}` block. The existing `nexus/{docId}` rule should also be modified as shown.

```
      // --- EXISTING RULE (MODIFIED) ---
      // Nexus 2.0 subcollection - modified to restrict conversation_queue writes
      match /nexus/{docId} {
        allow read: if isOwner(userId);
        allow write: if isOwner(userId) && docId != 'conversation_queue';
      }

      // --- NEW RULES ---

      // Insight engagement subcollection under nexus/
      match /nexus/{nexusDocId}/insight_engagement/{engagementId} {
        allow read, write: if isOwner(userId);
      }

      // Analytics subcollection (mostly server-computed, read-only for client)
      match /analytics/{analyticsDocId} {
        allow read: if isOwner(userId);
        allow write: if isOwner(userId) && analyticsDocId == 'gap_engagement';

        // Gap engagement history subcollection
        match /history/{engagementId} {
          allow read, write: if isOwner(userId);
        }
      }

      // Reports subcollection (server-generated, read-only for client)
      match /reports/{reportId} {
        allow read: if isOwner(userId);
      }

      // Report preferences subcollection (user-managed privacy settings)
      match /report_preferences/{reportId} {
        allow read, write: if isOwner(userId);
      }

      // FCM tokens subcollection (write-only, no client reads or deletes)
      match /fcm_tokens/{tokenId} {
        allow create, update: if isOwner(userId);
      }
```

### File to Modify: `/Users/michaelbond/echo-vault/firestore.indexes.json`

Add composite indexes needed for efficient queries on the new collections.

#### Required Indexes

**Reports collection** -- query reports by cadence and generation date:

```json
{
  "collectionGroup": "reports",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "cadence", "order": "ASCENDING" },
    { "fieldPath": "generatedAt", "order": "DESCENDING" }
  ]
}
```

This supports the query: "Get all monthly reports for a user, newest first" which the ReportList component needs.

**Reports collection** -- query reports by status (for cleanup function):

```json
{
  "collectionGroup": "reports",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "generatedAt", "order": "ASCENDING" }
  ]
}
```

This supports the stuck report cleanup function that queries for `status == 'generating'` ordered by `generatedAt` ascending to find the oldest stuck reports.

**Insight engagement** -- query engagement by insight and recency:

```json
{
  "collectionGroup": "insight_engagement",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "insightId", "order": "ASCENDING" },
    { "fieldPath": "timestamp", "order": "DESCENDING" }
  ]
}
```

**Gap engagement history** -- query engagement by domain:

```json
{
  "collectionGroup": "history",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "domain", "order": "ASCENDING" },
    { "fieldPath": "timestamp", "order": "DESCENDING" }
  ]
}
```

#### Complete Updated `firestore.indexes.json`

The file should contain the existing `threads` index plus all new indexes:

```json
{
  "indexes": [
    {
      "collectionGroup": "threads",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "lastUpdated", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "reports",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "cadence", "order": "ASCENDING" },
        { "fieldPath": "generatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "reports",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "generatedAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "insight_engagement",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "insightId", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "history",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "domain", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

---

## GDPR Data Deletion Plan

When a user deletes their account, the following new collections must be cleaned up in addition to existing data. This should be added to the existing account deletion Cloud Function (or a new one if none exists).

### Collections to Delete

All under `artifacts/echo-vault-v5-fresh/users/{userId}/`:

| Collection/Document | Deletion Method |
|---------------------|-----------------|
| `analytics/topic_coverage` | `deleteDoc()` |
| `analytics/entry_stats` | `deleteDoc()` |
| `analytics/health_trends` | `deleteDoc()` |
| `analytics/entity_activity` | `deleteDoc()` |
| `analytics/gap_engagement` | `deleteDoc()` + `recursiveDelete()` for `/history/` subcollection |
| `reports/*` | `recursiveDelete()` on collection |
| `report_preferences/*` | `recursiveDelete()` on collection |
| `fcm_tokens/*` | `recursiveDelete()` on collection |
| `nexus/conversation_queue` | `deleteDoc()` |
| `nexus/insight_engagement/*` | `recursiveDelete()` on subcollection |
| `settings/notifications` | `deleteDoc()` |

### Firebase Storage Cleanup

- Delete all files under `reports/{userId}/` (PDF exports)
- Use `bucket.deleteFiles({ prefix: 'reports/{userId}/' })` from the Firebase Admin Storage SDK

### Implementation Location

The deletion logic should be added to a Cloud Function. If one already exists for account deletion, extend it. Otherwise, create:

```
functions/src/account/onUserDeleted.js
```

This can be triggered by `auth.user().onDelete()` (Firebase Auth trigger) or called explicitly from a callable function during account deletion flow.

The function should use `firestore.recursiveDelete()` for collections (handles subcollections automatically) and individual `deleteDoc()` for known single documents. Wrap the entire operation in a try/catch so that partial deletion failures are logged but do not block the auth deletion.

---

## Deployment

Deploy rules and indexes with:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

Or deploy both together:

```bash
firebase deploy --only firestore
```

**Important:** Deploy rules BEFORE any feature code that writes to the new collections. Rules deployment is fast (seconds) and does not cause downtime.

---

## Checklist

1. Write tests in `functions/src/__tests__/firestoreRules.test.js` covering all access patterns
2. Modify the existing `nexus/{docId}` rule to restrict writes on `conversation_queue`
3. Add new `match` blocks for: `analytics`, `reports`, `report_preferences`, `fcm_tokens`, `nexus/insight_engagement`
4. Add composite indexes for: `reports` (2 indexes), `insight_engagement` (1 index), `history` (1 index)
5. Plan GDPR deletion for all new collections and Firebase Storage
6. Run rules tests against the Firestore emulator
7. Deploy rules and indexes to production before any feature code

---

## Implementation Notes

### Code Review Changes
1. **Added field-level validation** to `fcm_tokens` (requires `token` + `platform` fields, max 5 keys) and `report_preferences` (max 10 keys) to prevent arbitrary payload abuse.
2. **Added missing test cases**: cross-user access to `gap_engagement/history` subcollection, `report_preferences` delete operation, and seed write assertion in FCM token update test.

### Design Decisions
- **collectionGroup index scope** for `history` and `insight_engagement` is intentional. These generic names could collide with future collections, but collectionGroup scope is needed for potential admin/analytics cross-user queries.
- **report_preferences delete** is permitted by design. System falls back to defaults when preferences are absent.
- **Nexus write restriction** uses Approach A (single `!= 'conversation_queue'` check). If more server-only nexus docs are added, the condition must be extended.

### Tests

| File | Tests | Notes |
|------|-------|-------|
| `functions/src/__tests__/firestoreRules.test.js` | ~33 | Emulator-dependent; serves as executable documentation |

Existing tests: 122 passing (unchanged)