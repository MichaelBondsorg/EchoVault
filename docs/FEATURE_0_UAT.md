# Feature 0: Stateful Signal Architecture - UAT

**Version:** 1.0
**Date:** December 2024
**Feature Branch:** `claude/burnout-shelter-mode-plan-jkEM5`

---

## Overview

This UAT validates the Stateful Signal Architecture that fixes the "Ghost Goal" problem and enables lifecycle-aware signals throughout EchoVault.

---

## Prerequisites

- [ ] Access to test account with existing journal entries
- [ ] Firebase console access (to verify Firestore documents)
- [ ] App running locally or deployed to staging

---

## Test Scenarios

### 1. Goal Lifecycle - Creation & Confirmation

| ID | Test Case | Steps | Expected Result | Pass/Fail |
|----|-----------|-------|-----------------|-----------|
| 1.1 | New goal detected | Write entry: "I want to start exercising more regularly" | Goal appears in `signal_states` with `state: 'proposed'` | |
| 1.2 | Goal auto-confirms on progress | Write follow-up: "Went for a run today, felt great" | Goal transitions to `state: 'active'` | |
| 1.3 | Manual goal confirmation | Click "Confirm" on a proposed goal in UI | Goal transitions to `state: 'active'` | |

---

### 2. Ghost Goal Fix - Termination Detection

| ID | Test Case | Steps | Expected Result | Pass/Fail |
|----|-----------|-------|-----------------|-----------|
| 2.1 | Termination language | Write: "I'm no longer interested in learning piano" | Related goal transitions to `state: 'abandoned'` | |
| 2.2 | Achievement language | Write: "I finally got the job I was applying for!" | Related goal transitions to `state: 'achieved'` | |
| 2.3 | Goal no longer flagged | After 2.1 or 2.2, wait for pattern refresh | Contradiction warning does NOT appear for terminated goal | |
| 2.4 | `goal_update.status` respected | Entry with `goal_update: { status: 'abandoned' }` | Goal marked as terminated, no future contradictions | |

---

### 3. Contradiction Detection (signal_states as Source of Truth)

| ID | Test Case | Steps | Expected Result | Pass/Fail |
|----|-----------|-------|-----------------|-----------|
| 3.1 | Active goal with no progress | Create goal, wait 15+ days without mention | Contradiction appears with `requiresUserInput: true` | |
| 3.2 | Action buttons work | Click "Completed!" on contradiction | Goal transitions to `achieved`, contradiction resolves | |
| 3.3 | "No longer a priority" works | Click "No longer a priority" | Goal transitions to `abandoned`, contradiction resolves | |
| 3.4 | "Still working on it" works | Click "Still working on it" | `lastUpdated` refreshes, contradiction clears | |
| 3.5 | Terminated goals ignored | Achieve/abandon a goal, trigger pattern refresh | No contradiction for terminated goals | |

---

### 4. Dismissible Insights

| ID | Test Case | Steps | Expected Result | Pass/Fail |
|----|-----------|-------|-----------------|-----------|
| 4.1 | Dismiss insight (temporary) | Click dismiss on insight, select "Not relevant right now" | Insight disappears, excluded for 30 days | |
| 4.2 | Dismiss insight (permanent) | Click dismiss, check "Don't show this type again" | Entry created in `insight_exclusions` with `permanent: true` | |
| 4.3 | Verify insight (positive signal) | Click "This is helpful" on insight | Insight state → `verified`, `userFeedback.verified: true` | |
| 4.4 | Action on insight | Click "Take Action", complete suggested action | Insight state → `actioned` | |
| 4.5 | Excluded patterns don't reappear | Permanently dismiss "cyclical" pattern type | New cyclical insights are NOT generated | |

---

### 5. Goal Matching (Similarity Threshold)

| ID | Test Case | Steps | Expected Result | Pass/Fail |
|----|-----------|-------|-----------------|-----------|
| 5.1 | Exact match works | Goal: "learn guitar", Entry: "practicing guitar today" | Entry linked to existing goal | |
| 5.2 | Similar goals NOT confused | Goal A: "Work on Orion project", Goal B: "Work on garden" | Entry about "Orion" matches only Goal A | |
| 5.3 | Stop words ignored | Goal: "exercise more", Entry: "I want to exercise" | Matches correctly (ignores "I", "want", "to", "more") | |
| 5.4 | Threshold prevents false matches | Entry: "working on something new" | Does NOT match "Work on Orion project" (below 0.4 threshold) | |

---

### 6. Concurrency & Data Integrity

| ID | Test Case | Steps | Expected Result | Pass/Fail |
|----|-----------|-------|-----------------|-----------|
| 6.1 | Rapid entry saves | Save 3 entries quickly (within 2 seconds) | All `stateHistory` entries preserved correctly | |
| 6.2 | Transaction rollback | Simulate network failure mid-transition | State remains consistent (no partial updates) | |
| 6.3 | History limit enforced | Transition a signal 25+ times | `stateHistory` has max 20 entries (first + last 19) | |

---

### 7. Firestore Data Verification

| ID | Check | Location | Expected |
|----|-------|----------|----------|
| 7.1 | signal_states collection exists | `artifacts/{appId}/users/{userId}/signal_states` | Collection present with goal/insight/pattern docs |
| 7.2 | insight_exclusions collection exists | `artifacts/{appId}/users/{userId}/insight_exclusions` | Collection present after dismissals |
| 7.3 | Goal doc structure | Any signal_state doc with `type: 'goal'` | Has `state`, `topic`, `stateHistory[]`, `lastUpdated` |
| 7.4 | Exclusion doc structure | Any insight_exclusion doc | Has `patternType`, `permanent`, `expiresAt` |

---

## Edge Cases

| ID | Scenario | Expected Behavior |
|----|----------|-------------------|
| E1 | User with no signal_states (legacy) | Falls back to entry scanning for contradictions |
| E2 | Empty entry text | No goal extraction attempted |
| E3 | Goal topic is a single word | Matching uses lower threshold, prefers exact match |
| E4 | Dismissed pattern type regenerated | Check `isPatternExcluded()` before generating insight |

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Developer | | | |
| QA | | | |
| Product Owner | | | |

---

## Notes

_Add any observations, bugs found, or suggestions during testing:_

1.
2.
3.
