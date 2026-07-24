# Trustworthy capture — physical-device validation matrix

Companion to `src/__tests__/validationMatrix.test.js` (the automatable rows).
Every row below is blocked-by-device — it needs real hardware chrome (iOS
backgrounding, lock-screen behavior, force-quit recovery, real Dynamic Type/
VoiceOver/Reduce Motion) that a simulator or Vitest/jsdom cannot reproduce,
so none of it runs in CI; each row's own "Depends on"/setup text states
exactly what device-only behavior it needs and why. Run rows 1-8 on a
physical iPhone before enabling any capture-durability flag in production,
and again whenever `src/services/capture/**`, `ios/App/App/Capture/**`, or
the native capture plugin change. Run rows 9-10 (added by the capture-sheet/
A11Y-02 work — no capture-durability flag involved) whenever the New Entry
capture sheet layout or the a11y semantics of Home/Insights/tasks/loops
change. Run rows 11-14 (CAP-01, product review 2026-07-24 — the client
wiring that makes `nativeBackgroundUpload` actually do something, see
`docs/ops/feature-manifest.md`) before this flag is EVER flipped on for a
real account, anywhere; they are the gate referenced by the CAP-01 task
report (`.superpowers/sdd/task-cap01-report.md`).

Source plan: `docs/superpowers/plans/2026-07-20-trustworthy-capture-and-intelligence.md`
(Task D3) + `docs/superpowers/plans/2026-07-24-full-product-review.md` (CAP-01).
Runbook: `docs/quality/trustworthy-capture-runbook.md`.

## How to run this

1. Build to a physical device (`npm run cap:build:ios`, open in Xcode, run on
   hardware — the simulator does not enforce real background execution
   limits or lock-screen audio session behavior).
2. Sign in as a real test account. For any row that depends on a flag, set it
   in the `config/flags` Firestore doc (see runbook) before recording.
3. Work down the table. For each row: reproduce the physical action, then
   confirm every item in "Expected outcome" before checking it off.
4. If a row fails, capture the device console log (Xcode → Devices and
   Simulators → View Device Logs) filtered to `[capture-stage]` /
   `[Capture]` / `[audioVault]`, and file it against the relevant task in the
   plan doc rather than silently working around it.

## Rows

### 1. Auto-lock while recording

**Setup:** Start a voice recording, then let the screen auto-lock (do not
press the lock button) while recording continues.

**Depends on:** none (baseline native capture path); if
`nativeBackgroundUpload` is on, also exercises row 6 (background upload) in
combination.

**Expected outcome:**
- [ ] The native recording file continues to grow after lock (native
      `AVAudioSession`/`AVAudioRecorder` keeps running under the audio
      background mode — this is NOT `nativeBackgroundUpload`, it's the base
      recording session).
- [ ] Unlocking mid-recording shows the app still in the recording state,
      with elapsed time reflecting the locked interval (no gap/reset).
- [ ] Stopping and saving after unlock produces exactly one entry — no
      duplicate asset in the audio vault (check Entry Reliability Center /
      `audioVault.listOrphans` count for the session).
- [ ] If the app is killed while locked (simulate via device Settings or a
      forced kill), the draft is recoverable on next launch per row 4 below
      (the native draft persists to disk before recording starts —
      `CaptureDraftStore`).

### 2. Manual lock after Stop

**Setup:** Tap Stop to end a recording, then immediately press the physical
lock button before the save/upload pipeline finishes.

**Depends on:** `nativeBackgroundUpload` (native background upload path) —
run this row with the flag both OFF (foreground base64 pipeline) and ON
(background `URLSession` path) since the safe-continuation mechanism
differs.

**Expected outcome:**
- [ ] With the flag OFF: the in-flight base64 transcription call either
      completes before lock suspends the app, or the operation is left at
      `local_ready`/`uploading` (never partially transcribed) and is picked
      up by `resumeIncompleteOperations` on next foreground/launch — no
      duplicate entry is created (idempotent duplicate-delivery guard, see
      `src/services/capture/resumeOperations.js`).
- [ ] With the flag ON: the `BackgroundUploader` (`URLSession(configuration:
      .background(...))`) continues the PUT after lock without the app
      needing to be foregrounded; the op record advances
      `uploading → uploaded` via plugin events even while locked.
- [ ] In both cases: unlocking later shows the entry as completed (or a
      clearly surfaced `needs_attention` state) — never a silent gap with no
      entry and no error.
- [ ] The app is never re-opened by the user to "finish" the save — the
      pipeline completes on its own or surfaces for retry.

### 3. Background during transcription

**Setup:** Start a recording, stop it, and background the app (Home button
/ swipe up) while transcription is actively in flight.

**Depends on:** `nativeBackgroundUpload`. With it OFF, iOS gives foreground
JS/network work only a few seconds of background grace before suspension —
this row is specifically validating that the SERVER, not a dying client
promise chain, owns completion.

**Expected outcome:**
- [ ] The server (Storage-triggered `onCaptureAudioUploaded`, or the
      `transcribeEntry` callable path) owns finishing the job — completion
      does not depend on the client JS event loop staying alive.
- [ ] Re-opening the app after backgrounding shows the UI "catching up" from
      the durable operation record (`capture_ops::{uid}` via
      `operationStore.listIncomplete`) and the entry snapshot listener —
      not from any in-memory promise state that was lost when the app
      suspended.
- [ ] No duplicate entry is created by re-opening the app mid-transcription.
- [ ] If transcription fails while backgrounded, the op surfaces as
      `needs_attention` with a real error code on next foreground — never a
      silently vanished recording.

### 4. Force-quit while recording

**Setup:** Start a recording, then force-quit the app (swipe up and away in
the app switcher) mid-recording — not a clean Stop.

**Depends on:** none (native draft persistence is unconditional).

**Expected outcome:**
- [ ] On next launch, the interrupted native draft is detected as stale
      (non-empty, older than the staleness window, no active session) and
      converted to `needsReview` — see
      `src/services/capture/nativeCaptureAdapter.ts` (`recoverNativeDrafts` /
      `isStaleRecordingDraft`).
- [ ] The stale draft NEVER auto-submits / auto-transcribes. It surfaces in
      the Capture Reliability Center with explicit **Transcribe** / **Discard**
      actions and is tracked in
      `pending_review_drafts::{uid}` (`src/services/capture/pendingReviewDrafts.ts`)
      so it cannot be silently re-adopted by a later recovery pass.
- [ ] The reviewed draft shows accurate play-context (duration derived via
      `AVURLAsset` when the sidecar lacks it, and capture date).
- [ ] Choosing **Discard** removes it from `pending_review_drafts` and the
      native draft store without creating an entry. Choosing **Transcribe**
      runs it through the normal pipeline and creates exactly one entry.
- [ ] Force-quitting AGAIN before reviewing the flagged draft does not lose
      it, duplicate it, or auto-submit it on the next launch.

### 5. Background-upload flag-on end-to-end

**Setup:** With `nativeBackgroundUpload` set to `true` in `config/flags`,
record, stop, and background the app immediately (do not wait for the
foreground upload to start).

**Depends on:** `nativeBackgroundUpload` (default OFF — only run this row
once the flag is intentionally enabled for a test/staging account, never in
prod without explicit rollout sign-off).

**Expected outcome:**
- [ ] `issueCaptureUploadTicket` is called at `local_ready` and a signed V4
      PUT URL is obtained (functions consent gate must pass — test with
      consent granted).
- [ ] The file uploads via `BackgroundUploader`'s background `URLSession`
      even with the app backgrounded and the device screen locked.
- [ ] `AppDelegate.swift`'s `handleEventsForBackgroundURLSession` correctly
      re-attaches the completion handler after an iOS-initiated app
      relaunch (kill the app via Xcode's "Debug > Simulate Background
      Fetch"-style relaunch, or let iOS terminate and relaunch it naturally
      after a long background period, then confirm the upload still
      completes and is reported through `CapturePlugin` events).
- [ ] `onCaptureAudioUploaded` (Storage `onObjectFinalized`) creates exactly
      one entry server-side, using the SAME `operationId` idempotency guard
      as the client duplicate-delivery path.
- [ ] Raw audio at `capture-uploads/{uid}/{opId}.m4a` is deleted immediately
      on transcript success (see runbook's retention policy).

### 6. PUT-with-signed-headers correctness

**Setup:** With `nativeBackgroundUpload` on, inspect (via a proxy or Xcode
network debugging) the actual PUT request `BackgroundUploader` sends.

**Depends on:** `nativeBackgroundUpload`.

**Expected outcome:**
- [ ] The PUT sends EXACTLY the headers echoed back in `requiredHeaders` by
      `issueCaptureUploadTicketCore` (`Content-Type`, and when capture
      provenance is supplied: `x-goog-meta-captured-at` /
      `x-goog-meta-capture-timezone`) — no more, no fewer, no different
      values. Any mismatch fails the V4 signature (`SignatureDoesNotMatch`);
      this is a security property (see `functions/src/capture/uploadTicket.js`
      module doc), not just a correctness nit.
- [ ] `capturedAt` sent is a strict ISO-8601 instant and `captureTimezone` is
      a valid IANA id (invalid values are rejected by the ticket issuer
      before a signed URL is ever produced — confirm the client surfaces
      that failure rather than silently dropping provenance).
- [ ] The uploaded object's path is exactly
      `capture-uploads/{authenticated-uid}/{operationId}.m4a` where
      `operationId` is a canonical UUID — confirm the server derives
      ownership from this PATH, never from client-supplied custom metadata.

### 7. Xcode / pbxproj build integrity

**Setup:** Clean build (`Product > Clean Build Folder`) then build for a
physical device from a fresh `pod install` / `cap sync ios`.

**Depends on:** none — this is a build-hygiene row, run it after any change
under `ios/App/App/Capture/**` or when `cap:sync`/`cap:build:ios` is next run
before a release.

**Expected outcome:**
- [ ] `CapturePlugin.swift`, `CaptureDraftStore.swift`, and
      `BackgroundUploader.swift` (when present) are all members of the `App`
      target in `project.pbxproj` — a file added on disk but not added to the
      Xcode project target silently fails to compile into the app with no
      obvious build error.
- [ ] The background modes capability (`UIBackgroundModes` → `audio` for
      recording continuity, plus background `URLSession` support for
      `nativeBackgroundUpload`) is present in `Info.plist` / the target's
      Signing & Capabilities tab.
- [ ] Build succeeds with no new warnings introduced in the Capture sources.
- [ ] App Intents / Siri Shortcuts metadata (if touched) still resolves —
      spot check via the Shortcuts app.

### 8. `AVURLAsset` duration derivation

**Setup:** Trigger the stale-draft recovery path (row 4) for a draft whose
sidecar JSON lacks a duration field (simulate by deleting/corrupting the
sidecar's duration key, or by force-quitting early enough that the sidecar
was written before duration was known).

**Depends on:** none.

**Expected outcome:**
- [ ] `readDraft` in the native plugin derives duration from the audio file
      itself via `AVURLAsset` rather than reporting `0`, `null`, or a
      fabricated placeholder.
- [ ] The derived duration is accurate to within normal `AVURLAsset`
      precision (spot check against the actual recording length).
- [ ] A genuinely zero-length / corrupt file does not crash the recovery
      scan — it surfaces as a reviewable (and likely discardable) draft
      rather than throwing.

### 9. Capture processing sheet (New Entry) across viewport/text-size combinations

**Setup:** Companion to the component tests in `EntryBar.test.jsx`,
`EntryComposer.test.jsx`, and `cloud-kit.test.jsx` (Fix A, UI-1,
`docs/superpowers/plans/2026-07-24-capture-sheet-insight-rebuild.md`) —
those are the automatable rows; the ones below need real device chrome
(dynamic Safari/WebView viewport resize, real Dynamic Type, real safe-area
insets) that jsdom can't reproduce. Open the New Entry sheet from a Reflect
prompt (so a Reflect card is present), start a voice recording, and let it
run through to Stop → processing, for each of the following device/state
combinations:

- iPhone SE-size viewport (375×667 or smaller — the tightest common iOS
  viewport)
- a current Face ID iPhone (e.g. iPhone 15/16-class — home-indicator safe
  area, no physical Home button)
- portrait AND landscape orientation, for each device above
- default text size AND iOS Larger Text set to 200%, for each orientation
  above
- with a long Reflect prompt (multi-line, near/at the prompt's max length)
  loaded into the sheet before recording starts

For each combination, run BOTH of:
- recording → processing → success (let transcription/analysis complete
  normally)
- recording → processing → failure (force a failure — e.g. airplane mode
  before Stop, or a backend error — to exercise the recovery path)

**Depends on:** none (base capture-sheet layout; independent of every
capture-durability flag above).

**Expected outcome:**
- [ ] At every combination, the processing panel ("Processing your voice…"
      + the "keep the app open" note) is fully visible without being clipped
      by the sheet edge, the home-indicator safe area, or the browser chrome
      — scrolling inside the sheet if it doesn't fit, never spilling behind
      the viewport.
- [ ] No recording, idle, or typing control (mic/Aa buttons, the red Stop
      button, the Type/Record tabs, the text editor) is visible during
      processing, in any combination — including landscape and 200% text
      size, where cramped layouts are most likely to leak the underlying
      branch.
- [ ] The Reflect prompt and initial-context chip are hidden during
      processing and reappear, unchanged, once processing ends (success or
      failure) — verify this specifically with the long Reflect prompt,
      since that's the content most likely to visually break the layout if
      the fix regresses.
- [ ] Switching from recording → processing does not change the sheet's
      horizontal bounds or reveal the page behind the scrim, at any
      orientation.
- [ ] On the processing → failure path, the sheet returns to a usable
      capture state (Type/Record tabs and the Reflect prompt back) rather
      than a stuck or blank sheet.
- [ ] Close stays disabled/locked for the entire processing window in every
      combination (dismissal-locking policy is unchanged by this fix).

### 10. A11Y-02 assistive-technology pass on capture/Home/Insights/tasks/loops

**Setup:** Companion to the component-level a11y tests added under this task
(`EntryBar.test.jsx`, `InsightsPage.a11y02.test.jsx`, `StoriesWidget.test.jsx`,
`GlassCard.test.jsx`, `TasksWidget.test.jsx`, `OpenLoopsWidget.test.jsx`,
`IntentSuggestionTray.test.jsx`, `CapturedToast.test.jsx`, `EntryCard.test.jsx`)
— those assert role/name/aria-expanded/keyboard-activation/class-level target
size in jsdom, which cannot exercise a real screen reader, real Dynamic Type
reflow, a hardware keyboard, or the OS-level Reduce Motion setting. Run this
row on a physical iPhone (VoiceOver) and, where noted, a laptop with an
external keyboard, covering: the EntryBar capture composer (idle → typing
mode textarea), the Home Bento grid (NexusInsightsWidget's tap card,
StoriesWidget's story rows, TasksWidget, OpenLoopsWidget), and the Insights
page (NexusInsightCard's expandable header, dismiss/report/receipt buttons).

**Depends on:** none (a11y semantics are unconditional; `insightClaims`,
`openLoops`/`intentExtraction`, and `voiceChapters` should each be tried both
on and off since they change which of the above widgets/rows are present).

**Expected outcome:**
- [ ] **VoiceOver rotor:** swiping through the Home screen and Insights page
      with VoiceOver's rotor set to "Headings"/"Form Controls" reaches the
      entry textarea (announced "New journal entry, text field", not silent
      or announced only by placeholder), every story row (announced as a
      button with the story name, collapsed/expanded state included), the
      NexusInsightsWidget card (announced as a button), and every
      Dismiss/Report/Why-am-I-seeing-this/checkbox/snooze/close/answer
      control (announced with its `aria-label`, not just an icon glyph).
      Double-tapping each activates it exactly like a mouse click.
- [ ] **Dynamic Type at 200%:** with iOS Larger Text set to its largest
      Dynamic Type step (or the separate Accessibility Sizes range), the
      Home Bento cards, story rows, task rows, and open-loop rows reflow
      without truncating an interactive control's accessible name or
      causing two controls to visually overlap into a single unreachable
      tap target — text wraps/scrolls rather than being clipped.
- [ ] **Keyboard-only (external keyboard, iPad or desktop Safari):** Tab
      order reaches the entry textarea, every story row (Enter/Space
      toggles expansion, matching the mouse behavior), the
      NexusInsightsWidget card (Enter/Space navigates to Insights, matching
      a click), and the NexusInsightCard header (Enter/Space toggles
      expansion) — each control shows the Cloud kit's accent focus ring
      (`:focus-visible` in `src/index.css`) while focused, and Tab never
      gets trapped inside a widget or skips a control silently.
- [ ] **Reduced Motion:** with iOS Reduce Motion enabled, the story-row
      expand/collapse, insight-card expand/collapse, and card entrance
      animations (Framer Motion `initial`/`animate`/`exit` on the touched
      components) either respect the OS setting or, at minimum, never leave
      a control in a visually-broken or unreachable intermediate state —
      the underlying state change (expanded/collapsed, dismissed/kept)
      still completes correctly with motion reduced or skipped.
- [ ] Every touch-target fix in this task (checkbox/dismiss/answer/snooze/
      close controls) is comfortably tappable with a thumb on a physical
      device at default zoom, not just measurable as ≥44px in the DOM.

### 11. CAP-01 — suspend mid-upload

**Setup:** With `nativeBackgroundUpload` set to `true` in `config/flags` on a
test/staging account, record a voice entry of at least 15-20 seconds (large
enough that the PUT is still in flight a moment later), tap Stop, and — while
`BackgroundUploader`'s `URLSession` upload is actively transferring (watch
Xcode's network debugger or a proxy to confirm bytes are still moving) —
press the physical lock button to suspend the app. Distinct from row 2
("Manual lock after Stop", which covers the instant right after Stop) and
row 5 (which backgrounds immediately without confirming the transfer was
mid-flight) — this row specifically confirms the upload survives a
suspend that lands **while bytes are actively being sent**, not just before
the transfer starts.

**Depends on:** `nativeBackgroundUpload`. Code-complete but ships DARK this
sprint (CAP-01) — do not run against a production account.

**Expected outcome:**
- [ ] The PUT continues and completes after the device locks — no partial
      upload, no silent stall (confirm via the same network debugging tool,
      or via the `captureUploadComplete` event firing once the app is next
      foregrounded).
- [ ] `onCaptureAudioUploaded` creates exactly one entry once the object
      finalizes, indistinguishable in shape from a foreground-saved entry
      (same `transcription`/`analysisStatus`/`entryInputVersion` fields —
      see `functions/src/capture/onAudioUploaded.js`'s
      `buildBackgroundCoreEntry`).
- [ ] Unlocking and foregrounding the app clears the local
      `capture_bg_uploads::{uid}` breadcrumb for that draft (via the
      `captureUploadComplete` listener in
      `src/services/capture/nativeBackgroundUpload.js`) and deletes the now-
      redundant native draft — it does not linger in the Capture Reliability
      Center as a "stored" draft needing manual review.

### 12. CAP-01 — force-kill mid-upload

**Setup:** With `nativeBackgroundUpload` on, record and Stop, then — while the
upload is still in flight — force-kill the app from the app switcher (swipe
up and away), not just lock it. This is stronger than row 11: a suspended app
keeps its process; a force-kill terminates it, so recovery must not depend on
ANY in-memory JS state surviving.

**Depends on:** `nativeBackgroundUpload`. Ships DARK this sprint.

**Expected outcome:**
- [ ] The native `URLSession` background session (identifier
      `engram.capture.upload`, see `BackgroundUploader.swift`) continues the
      transfer at the OS level even though the app process is gone — this is
      the entire point of a background `URLSessionConfiguration`, as opposed
      to a plain in-process fetch.
- [ ] When iOS relaunches the app to deliver the completion (or the user
      manually reopens it), `AppDelegate.application(_:
      handleEventsForBackgroundURLSession:completionHandler:)` re-attaches
      the completion handler and the app's launch-time
      `reconcileNativeBackgroundUploads` (`src/App.jsx`, gated by the flag)
      is able to resolve the breadcrumb even though NO JS code was running
      when the upload actually completed on the wire.
- [ ] Exactly one entry exists — no duplicate, no silent loss. If the kill
      happened before the object even finished uploading (not just before
      the JS heard about it), the retention sweeper
      (`captureUploadsRetention`, every 6h) is the eventual backstop for any
      object left orphaned server-side.
- [ ] The local native draft (`CaptureDraftStore`) is never silently deleted
      before either (a) the server confirms the entry was created, or (b)
      the object is confirmed abandoned — a force-kill must never be able to
      lose the only durable copy of the recording.

### 13. CAP-01 — airplane-mode retry

**Setup:** With `nativeBackgroundUpload` on, enable Airplane Mode BEFORE
tapping Stop (so the PUT can never even start), then Stop the recording, wait
a few seconds, and turn Airplane Mode back off.

**Depends on:** `nativeBackgroundUpload`. Ships DARK this sprint.

**Expected outcome:**
- [ ] `issueCaptureUploadTicket` either fails fast (surfaced as a
      foreground-path fallback per `enqueueNativeBackgroundUpload`'s design —
      see `src/services/capture/nativeBackgroundUpload.js`, which falls back
      to the existing base64 pipeline on any enqueue failure) or the ticket
      succeeds but `BackgroundUploader`'s `URLSession` itself queues the PUT
      and retries once connectivity returns (`URLSession` background tasks
      are designed to survive exactly this).
- [ ] Whichever path is taken, the recording is NEVER lost: either the
      foreground fallback transcribes it directly, or the background PUT
      completes once the network returns and `onCaptureAudioUploaded`
      creates the entry.
- [ ] If the signed URL's 15-minute expiry (`UPLOAD_TICKET_TTL_MS`,
      `functions/src/capture/uploadTicket.js`) is exceeded while offline, the
      PUT fails with an expired-signature error; confirm this surfaces as a
      `captureUploadFailed` event (not a silent hang) so the record in
      `capture_bg_uploads::{uid}` is marked `failed` rather than staying
      `queued` forever, and that the native draft remains recoverable
      through the existing Capture Reliability Center path.
- [ ] Exactly one entry is created — not zero (lost), not two (foreground
      fallback AND background upload both succeeding for the same
      operationId; this is what row 14's duplicate-finalize guard exists
      for).

### 14. CAP-01 — duplicate-finalize

**Setup:** This row validates the idempotency guard itself
(`functions/src/capture/onAudioUploaded.js`'s `captureUploadGuardRef` +
transactional guard-and-create) against a REAL duplicate Storage finalize
delivery, which the unit tests
(`functions/src/capture/__tests__/onAudioUploaded.test.js`) simulate but
cannot fully substitute for. With `nativeBackgroundUpload` on: (a) trigger a
natural redelivery by forcing the `onCaptureAudioUploaded` function to fail
transiently right after it successfully commits the transaction but before
it returns (e.g. temporarily throw after the `db.runTransaction` call in a
local/staging deploy, forcing Cloud Functions' at-least-once retry), and (b)
separately, manually re-PUT the same object path
(`capture-uploads/{uid}/{operationId}.m4a`) a second time with the Storage
console/`gsutil` after the first upload already completed and was deleted
(reconstructing the redelivery/re-PUT scenario from first principles rather
than the unit test's injected race).

**Depends on:** `nativeBackgroundUpload`. Ships DARK this sprint — safe to
exercise directly against Cloud Functions logs/Firestore, since this row is
specifically about server behavior, not on-device UI.

**Expected outcome:**
- [ ] In both (a) and (b), exactly ONE entry exists for the operationId
      afterward — check via a Firestore query
      (`entries` where `operationId == <opId>`) returning exactly one
      document, and via server logs showing `duplicate_skipped` for the
      redelivered/re-PUT event.
- [ ] The guard doc at
      `artifacts/echo-vault-v5-fresh/users/{uid}/captureUploadGuards/{operationId}`
      exists and its `entryId` matches the single entry that was created —
      confirm no second guard write, transaction retry loop, or crash
      occurred.
- [ ] The SECOND (duplicate) object is deleted from Storage — no orphaned
      audio left behind by the duplicate path specifically (distinct from
      the retention sweeper, which is the backstop for genuinely stuck
      objects, not a substitute for this guard).
- [ ] Repeat scenario (a) with a transcription FAILURE instead of success
      (temporarily force `transcribe()` to reject) to confirm the inverse: NO
      guard doc is left behind by a failed attempt, so a subsequent
      legitimate retry with the same operationId is not wrongly treated as a
      duplicate and successfully creates its entry.

### CAP-01 pre-flip code items (in addition to rows 5, 6, 11-14)

Recorded here per the whole-sprint final review (2026-07-24) so they live in
the same durable gate document as the device rows they accompany. All three
came out of CAP-01's own opus review — none blocks the dark landing, ALL
block flipping `nativeBackgroundUpload`:

- [ ] **Failed-breadcrumb age prune** — `markFailedByDraftId` leaves
      permanently-failed upload breadcrumbs in
      `capture_bg_uploads::{uid}` forever (reconcile only clears on a found
      entry). Add an age-based prune during reconcile before flip
      (`src/services/capture/nativeBackgroundUpload.js` /
      `backgroundUploadStore.js`).
- [ ] **Background-entry integration test** — entry-shape parity with the
      foreground path is unit-asserted only; add an integration test that
      drives a background-created entry through the real
      `onEntryCreated` → analysis → conversationReady/INS-01 chain.
- [ ] **operationId design note** — one-line code comment in
      `uploadTicket.js`/`onAudioUploaded.js` stating the client-generated
      UUID (auth-uid-namespaced, UUID-validated) is deliberate.
- [ ] **flip-flag.mjs ALLOWED entry** — `nativeBackgroundUpload` is
      intentionally NOT in the flip allowlist today; add it only when this
      gate clears (the friction is the point).

## Flag cross-reference

| Row | Flag(s) | Default | Where read |
|---|---|---|---|
| 1 | — | n/a | native `AVAudioSession` background audio mode |
| 2 | `nativeBackgroundUpload` | `false` | `src/config/flags.js`, `functions/src/shared/flags.js` |
| 3 | `nativeBackgroundUpload` | `false` | same |
| 4 | — | n/a | `pending_review_drafts::{uid}` (unconditional) |
| 5 | `nativeBackgroundUpload` | `false` | same |
| 6 | `nativeBackgroundUpload` | `false` | same |
| 7 | — | n/a | build configuration |
| 8 | — | n/a | native plugin (unconditional) |
| 9 | — | n/a | `src/components/capture/EntryComposer.jsx`, `src/components/dashboard/EntryBar.jsx`, `src/components/cloud/Drawer.jsx` (unconditional) |
| 10 | `insightClaims`, `openLoops`, `intentExtraction`, `voiceChapters` (each varies which widgets/rows render; the a11y semantics themselves are unconditional) | all `false` | `src/config/flags.js` |
| 11 | `nativeBackgroundUpload` | `false` | `src/config/flags.js`, `functions/src/shared/flags.js`, `src/services/capture/nativeBackgroundUpload.js` |
| 12 | `nativeBackgroundUpload` | `false` | same |
| 13 | `nativeBackgroundUpload` | `false` | same |
| 14 | `nativeBackgroundUpload` | `false` | same (server-only exercise — `functions/src/capture/onAudioUploaded.js`) |

Flip procedure for any flag above: edit the `config/flags` Firestore doc —
see `docs/quality/trustworthy-capture-runbook.md` § Flags for the full table
and rollback semantics. No app deploy is required to flip a flag; a native
background-upload row still requires a build that contains
`BackgroundUploader.swift` before the flag can do anything on that device.
