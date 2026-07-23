# Capture Processing Sheet + Insight Rebuild (Michael's engineer-ready brief, adopted verbatim as owner direction 2026-07-24)

> **For agentic workers:** execute via superpowers:subagent-driven-development. Tasks: FIX-A (UI-1, capture processing sheet), FIX-B (INS-1, current-vs-history feed contract), FIX-C (rebuild orchestrator), RECOVERY (one-time account verification). The sections below are Michael's brief, unedited — its acceptance criteria and tests are binding. Execution model identical to R4 phases (main, green batches, implementers never git, adversarial review per task, full gate before push). Controller timeline note: the 2026-07-23 9:57 AM screenshots predate both the P2 feed-swap deploy (a1da374, later that day) and the insightClaims flip (2026-07-24) — the legacy render branch was expected then; INS-1's history-blending root cause is real regardless and still affects flag-OFF surfaces + reports.

---

**Date:** 2026-07-23
**Status:** Engineer-ready issue/fix brief
**Scope:** Mobile capture UI, legacy-insight cutover, and a safe user-triggered insight rebuild
**Related:** `2026-07-22-r4-insight-integrity.md`, `2026-07-23-r4-phase2-trustworthy-synthesis.md`

## Outcome

1. Voice processing never produces clipped, overlapping, or leaking controls on a compact iPhone viewport.
2. The live Insights feed never mixes historical/legacy cards back into current results.
3. A user can rebuild the currently enabled insight engine from their present journal data without deleting entries, feedback, exclusions, claim history, or statistical-testing history.
4. A failed rebuild leaves the prior usable feed in place and explains what happened.

## User evidence

### UI-1 — Processing state breaks the New Entry sheet

Screenshot from 2026-07-20, 4:13 PM:

- A long Reflect prompt remains mounted above the processing state.
- The mic/Aa controls remain visible even though capture is locked.
- The processing treatment is rendered in the small space belonging to the underlying EntryBar mode rather than as a real layout row.
- A small red recording-control artifact is visible above "Processing your voice…".
- The sheet has no reliable internal overflow behavior if the content exceeds its `max-height`.

This is not only cosmetic. It makes the state of the recording ambiguous: the screen simultaneously shows disabled entry-method controls, a fragment of the recording UI, and a processing message.

### INS-1 — Old and near-duplicate insights survive the new build

Screenshots from 2026-07-23, 9:57 AM show the legacy Nexus card design, including:

- "The Proxy Control Paradox"
- "The Preparation-Proximity Paradox"
- "The Nomadic Buffer Paradox"
- "The Spontaneity-Soma Paradox"
- "Creative Flow Pattern"
- "Rest Day Pattern"
- "Learning Your Baseline"

Several cards cover substantially overlapping regulation/routine/proximity themes. They also use the old `PATTERN` / `DEEP INSIGHT` card treatment, not the verified-claim card layout introduced behind `insightClaims`.

## Diagnosis

### UI-1 root cause

Three layout choices combine to produce the break:

1. `src/components/cloud/Drawer.jsx` constrains the sheet to `max-h-[92vh]`, but the sheet itself has no internal scrolling/content viewport.
2. `src/components/dashboard/EntryBar.jsx` renders the loading treatment as `absolute inset-0`. The loading panel therefore contributes no height of its own and is sized to whichever recording/idle child remains underneath it.
3. `src/components/capture/EntryComposer.jsx` continues rendering the Reflect card, entry-method controls, EntryBar, and footer during processing.

On a compact iOS viewport, a long Reflect card consumes most of the available height. The absolutely positioned loading treatment then overflows its small parent and can expose animated recording UI underneath it. Static `vh` also does not follow iOS's dynamic visual viewport as reliably as `dvh`.

### INS-1 root cause

The R4 cutover preserves old derived artifacts correctly, but two live-feed seams undo the intended cutover:

1. `saveInsights` reads both existing `active` and `history` items and checks every newly generated insight against both sets for semantic duplication.
2. The version cutover moves legacy `active` items into `history` with `legacyVersion: true`.
3. `useNexusInsights` then combines `activeInsights + historyInsights` into the user-visible feed.

Consequences:

- Archived cards are still shown as if current.
- A newly generated insight can be rejected for resembling an archived legacy card.
- The user can be left with the old wording and no current replacement.
- The 50-item audit history becomes a second, stale proactive feed.

There is a separate control-path gap:

- The Insights page's top refresh action regenerates Nexus only.
- Quick Insights has a separate refresh action.
- `ClaimFeed` refresh only re-reads `insight_claims`; it does not rerun the claims pipeline.
- Insight Control Center's "Recompute now" calls `generateInsights(uid)` and therefore also rebuilds Nexus only.
- Insight Control Center is currently unavailable unless `insightReceipts` is enabled, even though rebuild is useful independently of receipts.

Finally, the screenshots prove the deployed client was taking the legacy render branch at capture time. Before treating the new claim feed as deployed for a user, verify both:

- the deployed bundle contains the R4 Phase 2 single-feed swap; and
- `config/flags.insightClaims === true` after flag initialization for that session.

Do not infer successful rollout from the code merely existing on `main`.

### Current test evidence

The targeted existing suites pass (53/53):

- Nexus versioned cutover
- `useNexusInsights`
- Insights page claim-feed flag swap
- shared Drawer component

This is useful evidence that the implementation is internally consistent, but it also identifies the missing contracts: the cutover suite proves legacy items are archived, while no test proves archived items are absent from the live hook output; the Drawer suite proves the primitive mounts, while no EntryComposer test exercises a compact viewport or its processing composition.

## Fix A — Make processing a dedicated, in-flow sheet state

### Required behavior

When `processing === true`:

- Replace, rather than overlay, the EntryBar controls with one in-flow processing panel.
- Hide the Reflect prompt, initial-context chip, and mic/Aa method controls. Those controls cannot be used while processing and should not compete for space.
- Keep the title, grab handle, security note, and processing status.
- Keep dismissal locked if leaving would genuinely jeopardize the operation. If capture durability now makes leaving safe, change that policy separately; do not change the promise through layout work alone.
- Give the processing panel `role="status"` and `aria-live="polite"`.
- Do not mount the recording/typing/idle branch underneath the processing branch.

Suggested composition:

```text
grab handle
CAPTURE
New entry

spinner  Processing your voice…
         Please keep the app open until processing is complete.

Audio is secured on this device before it is processed.
```

### Layout hardening

- Prefer `92dvh` for the sheet limit, with an appropriate `vh` fallback for older WebViews.
- Add an explicit `min-h-0` internal content viewport.
- Use `overflow-y-auto` and `overscroll-contain` on content-bearing drawers that can legitimately exceed the available viewport.
- Keep the header and grab handle `shrink-0`.
- Do not solve the screenshot by shrinking text or truncating the Reflect prompt.

Avoid making every shared Drawer child scroll independently. The cleanest primitive contract is:

```text
DrawerContent (bounded, overflow hidden)
  fixed chrome (grab handle)
  caller-owned body viewport (min-height 0, overflow auto when needed)
```

EntryComposer can then use a non-scrolling, compact processing body and a scrolling body for long text/reflection states.

### UI-1 acceptance criteria

- No recording, idle, or typing control is mounted while processing.
- No red recording artifact is visible behind the processing state.
- The full status and security note fit at 320×568 CSS pixels.
- The sheet remains usable at 200% text size; if content cannot fit, it scrolls inside the sheet rather than behind the browser viewport.
- The safe-area inset is respected on home-indicator devices.
- Switching from recording → processing does not change the sheet's horizontal bounds or expose the background.
- Processing failure returns to a usable capture state with the prior Reflect context intact.
- Voice-save behavior, durable-draft behavior, and close locking remain unchanged.

### UI-1 tests

Add component tests for:

1. `processing=true` renders the status but not Record, Type, stop-recording, or text-editor controls.
2. The processing element is in normal flow, not `absolute`.
3. The status has `role=status` and an accessible name.
4. Long Reflect content returns after processing ends.
5. Drawer/EntryComposer carries the dynamic-viewport and overflow classes.

Add a manual/device matrix row for:

- iPhone SE-size viewport
- a current Face ID iPhone
- portrait and landscape
- default and 200% text size
- long Reflect prompt
- recording → processing → success and recording → processing → failure

## Fix B — Separate "current" from "history"

### Live-feed contract

- The proactive Nexus feed reads `active` only.
- `history` remains an audit/diagnostic record and is never blended into the current feed.
- `legacyVersion: true` is never eligible for a proactive surface, report, prompt, or recommendation.
- If historical insights are ever shown, put them behind an explicitly labeled "Previous insights" surface with dates; do not silently concatenate them.

### Generation deduplication

`saveInsights` should deduplicate the newly generated batch against:

1. other items in the same new batch; and
2. stable user decisions such as dismissal/suppression keys where applicable.

It should not reject a current-generation result merely because a semantically similar item exists in audit history. Resurfacing frequency belongs to the shown-insight ledger/Insight Budget, not the history archive.

Keep these concepts separate:

- **Within-run duplicate:** two cards in the same proposed live feed say materially the same thing. Keep the stronger/higher-ranked one.
- **Previously shown:** a similar card was displayed recently. Apply the Insight Budget/show ledger.
- **Dismissed/suppressed:** the user told Engram not to show this family/content again. Preserve and enforce that decision.
- **Historical:** an old generated artifact is retained for lineage/audit. It is not a display instruction.

### INS-1 acceptance criteria

- A first post-version generation archives legacy items but displays none of them.
- A fresh current insight is not rejected solely because a similar archived item exists.
- Two same-theme outputs in one generation result in at most one visible active card.
- Reloading does not reintroduce historical cards.
- A dismissed or suppressed insight stays hidden after rebuild.
- With `insightClaims=true`, the page renders the verified ClaimFeed only; it does not show `PATTERN`, `DEEP INSIGHT`, Quick Insights, Nexus recommendations, or a Nexus empty state.
- With `insightClaims=false`, the legacy feed still shows current `active` only.

## Fix C — Replace "refresh fragments" with one safe Rebuild Insights action

### Product behavior

Use the label **Rebuild insights**, not "reset insights."

Supporting copy:

> Reanalyze your current journal data. Your entries, feedback, dismissed insights, exclusions, experiments, and insight history won't be deleted.

This action is non-destructive and should not need a destructive-confirmation dialog.

### Active-engine behavior

When `insightClaims === true`:

1. Run the Basic Insights regeneration path over the current, source-exclusion-filtered entry pool.
2. Allow its existing claims-pipeline hook to enumerate candidates, expire claims that no longer qualify, preserve user-suppressed claims, and supersede materially changed claims.
3. Re-read `listActiveClaims`.
4. Replace the visible feed only after the run completes.

When `insightClaims === false`:

1. Regenerate Basic Insights over the source-exclusion-filtered entry pool.
2. Regenerate Nexus.
3. Re-read both current caches.
4. Show current items only.

The Insights page's top refresh button, ClaimFeed refresh button, Quick Insights refresh, and Insight Control Center should call this same orchestration contract rather than four different subsets of it.

### Data that rebuild must preserve

Never delete or reset:

- journal entries or entry analysis
- `source_exclusions`
- `insightLearning` and feedback events
- Nexus dismissal/engagement records
- `insight_exclusions`
- `insight_claims` history or lineage
- `testing_ledger` — deleting it would invalidate the multiple-testing correction
- experiment plans/results
- insight-budget mode or shown ledger
- consent, privacy, or safety state

Derived current caches may be replaced only after a successful recomputation. Do not blank them first. A generation error must leave the previous feed available.

### Result states

- **Success with claims:** "Insights rebuilt from {dayCount} recorded days. {count} verified insights are available."
- **Success, nothing qualifies:** "Rebuild complete. Nothing currently clears the evidence threshold."
- **Partial failure:** identify the failed engine without claiming the whole feed is current.
- **Failure:** "We couldn't rebuild your insights. Your previous insights are still available."

Do not imply that more journaling guarantees a result.

### Rebuild availability

The action should be reachable regardless of `insightReceipts`. Preferred placements:

1. the Insights page header, as the one authoritative refresh/rebuild action; and
2. Insight Control Center, mounted when either `insightReceipts` or `insightClaims` is enabled—or made generally available under AI & Privacy.

### Rebuild concurrency and reliability

- One rebuild per user at a time.
- Disable repeat taps while running.
- Ignore/return the existing in-flight promise rather than starting a second run.
- Generate before replacing current state.
- Report per-engine completion so a claims failure cannot be mislabeled as a complete rebuild merely because Basic Insights cached successfully.
- Record only operational metadata: engine/version, start/end time, result counts, and error class. Never log entry text, claim wording, source excerpts, or health values.

### Rebuild acceptance criteria

- Tapping Rebuild runs the active generation pipeline; it does not merely re-read Firestore.
- A no-longer-supported live claim becomes `expired` and disappears after the same action.
- A materially changed claim is superseded with lineage intact.
- An equivalent claim does not churn versions.
- User-suppressed claims stay suppressed.
- Source-excluded entries do not contribute to any rebuilt engine.
- Two rapid taps produce one run.
- A failed run leaves prior current artifacts visible.
- Closing and reopening Insights shows the same rebuilt current feed.

## One-time recovery for the reported account

After the code fix is deployed:

1. Confirm the deployed bundle includes the R4 Phase 2 feed swap.
2. Read `config/flags.insightClaims` in production and confirm the intended value. A source default of `false` is not evidence of the production value.
3. Reload the app so flag initialization completes.
4. Run **Rebuild insights** once.
5. Verify that no legacy Nexus history cards appear in the current feed.
6. Verify the visible claim count against current, unsuperseded `status=verified` claims.

No production data deletion should be necessary. The historical Nexus artifacts can remain stored once the display path stops treating them as live.

If a pre-fix client must be repaired before deployment, do not directly delete the user's insight collections. Prefer waiting for the display fix. Any emergency admin repair must first copy the exact derived `nexus/insights` document to a private, timestamped recovery record, must target one verified UID, and must never touch entries, feedback, exclusions, claims, or `testing_ledger`.

## Implementation order

1. Fix EntryComposer/EntryBar processing composition and add compact-viewport validation.
2. Change Nexus live reads to active-only.
3. Change Nexus generation deduplication so audit history cannot block current results.
4. Introduce one rebuild orchestrator and wire every refresh/recompute entry point to it.
5. Ensure claim rebuild waits for generation and then refreshes ClaimFeed.
6. Add production flag/version diagnostics that expose booleans/versions only.
7. Deploy, verify the flag, and run the one-time rebuild for the reported account.

## Rollback

- UI fix rollback: restore the previous EntryComposer layout; capture persistence/data paths are untouched.
- Feed fix rollback: restore the previous read behavior, but do not mutate or delete history.
- Rebuild rollback: hide the action and retain automatic TTL/staleness regeneration.
- Flag rollback: set `insightClaims=false`; this returns to the legacy active-only feed after Fix B.

No rollback step requires restoring entries or other source data because this plan does not delete them.
