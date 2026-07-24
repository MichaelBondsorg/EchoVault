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
change.

Source plan: `docs/superpowers/plans/2026-07-20-trustworthy-capture-and-intelligence.md`
(Task D3). Runbook: `docs/quality/trustworthy-capture-runbook.md`.

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

Flip procedure for any flag above: edit the `config/flags` Firestore doc —
see `docs/quality/trustworthy-capture-runbook.md` § Flags for the full table
and rollback semantics. No app deploy is required to flip a flag; a native
background-upload row still requires a build that contains
`BackgroundUploader.swift` before the flag can do anything on that device.
