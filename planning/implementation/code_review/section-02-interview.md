# Code Review Interview: Section 02 - Firestore Rules and Indexes

**Date:** 2026-02-19T09:36:00Z

## Auto-Fixes Applied

1. **FCM token test seeding assertion** (High #1): Changed bare `setDoc` to `assertSucceeds(setDoc(...))` in admin context seed, and clarified comment about catch-all admin rule.

2. **Added cross-user history subcollection test** (Medium #4): New test verifying other users cannot read/write to `gap_engagement/history` subcollection.

3. **Added report_preferences delete test** (Low #11): New test documenting that delete is permitted on report_preferences (falls back to defaults).

## User Interview

**Q: Add data validation rules to Firestore for fcm_tokens and report_preferences?**
- User chose: **Add basic validation**
- Action: Added `request.resource.data.keys().hasAll(['token', 'platform'])` and `size() <= 5` to fcm_tokens. Added `size() <= 10` to report_preferences write rule.

**Q: Index scope for 'history' and 'insight_engagement' collectionGroup indexes?**
- User chose: **Keep as-is, document intent**
- Action: Documented in section plan that collectionGroup scope is intentional for potential admin/analytics cross-user queries. JSON doesn't support comments so documented in section files.

## Items Let Go

- Missing unauthenticated tests for additional collections (#5): Covered by `isOwner(userId)` which inherently requires auth. Low risk.
- Admin override access tests (#6): Admin rule is well-established catch-all. Low risk.
- Brittle nexus write restriction (#7): Acknowledged design choice per plan (Approach A). Only one doc currently needs exclusion.
- ESM in functions test (#8): `functions/package.json` already has `"type": "module"`, ESM works.
- GDPR deletion (#9): Intentionally separate section per plan.
- report_preferences delete allowed (#10): Allowing delete is fine; system falls back to defaults. Documented via new test.
