# Code Review: Section 02 - Firestore Rules and Indexes

**Date:** 2026-02-19T09:35:00Z

## Summary

The implementation is largely faithful to the section plan. The firestore.rules, firestore.indexes.json, and firestoreRules.test.js files all match the plan's specifications. Several issues found from security concerns to test gaps.

## HIGH SEVERITY

### 1. FCM Token Update Test Uses Wrong Seeding Approach
**File:** `functions/src/__tests__/firestoreRules.test.js`, lines 181-189
The test seeds via `authenticatedContext(USER_ID, { admin: true })` which works due to the catch-all admin rule, but the test should assert the seed write succeeded before testing the update. Currently misleading if the admin rule is ever removed.

### 2. No Data Validation Rules
No field-level validation on any new rules. fcm_tokens could accept arbitrary payloads of any size. For a mental health app, at minimum fcm_tokens should validate `request.resource.data.size() <= 5` or similar.

## MEDIUM SEVERITY

### 3. `history` Index Uses `collectionGroup` Scope -- Overly Broad
`collectionGroup: "history"` applies to ALL collections named `history` across the entire database. Only intended for `analytics/gap_engagement/history`. Same concern for `insight_engagement` though less likely to collide.

### 4. Missing Test: `analytics/history` Cross-User Access
No test that another user cannot access `gap_engagement/history` subcollection.

### 5. Missing Test: Unauthenticated Access to Multiple Collections
Missing unauthenticated tests for: report_preferences, nexus/insight_engagement, analytics/gap_engagement/history.

### 6. No Test for Admin Override Access
No explicit test verifying admin access works for server-only collections like reports (write) and analytics (write).

## LOW SEVERITY

### 7. Nexus Write Restriction is Brittle
Only `conversation_queue` excluded. Additional server-only nexus docs would need more `!= 'X'` conditions.

### 8. Test File Uses ES Module Imports
The test uses ESM imports but functions/ may need configuration for this.

### 9. GDPR Deletion Not Implemented
Intentional per plan - separate section. Should be tracked.

### 10. report_preferences Allows Delete (Unplanned)
`allow read, write` includes delete. Plan doesn't discuss whether delete should be permitted.

### 11. No Test for report_preferences Delete
No test documenting whether delete is permitted or denied.
