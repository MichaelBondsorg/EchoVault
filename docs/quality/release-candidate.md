# Product quality release candidate

- Branch: `agent/product-quality-cloud-capture`
- Baseline: `7c009c24787a66d912b83e91c1c36c4ea67cce5a`
- Prepared: 2026-07-18

## Delivered

### Low-friction capture

- The center `+` opens a dedicated **New entry** composer with explicit **Type** and **Record** tabs.
- **Talk with Engram** remains a separate AI conversation surface.
- iOS recording is owned by a native Swift coordinator and is shown as recording only after the native recorder confirms startup.
- Native drafts are owner-scoped, persisted before capture begins, finalized atomically, and recovered after interruption or relaunch.
- Home Screen quick actions, App Intents/Siri/Shortcuts, and `engram://new-entry` deep links open the exact capture mode.
- Audio is adopted by the durable owner-scoped vault before transcription. Failed processing remains recoverable in the Entry Reliability center.

### Trust, privacy, and identity

- Local queues, consent, and audio are physically scoped to the authenticated owner; unowned legacy data is quarantined rather than assigned to the next login.
- AI consent is owner-scoped. **Continue without AI** keeps typed capture available, marks entries as analysis-disabled, and prevents entry embedding, memory extraction, voice tickets, and client analysis.
- Google and Apple identities are keyed by verified provider subjects. Cross-provider email collisions require authenticated re-linking instead of silent account merging.
- Google ID tokens are verified cryptographically without placing credentials in query strings.
- Voice WebSockets use rate-limited, 60-second, single-use tickets instead of Firebase ID tokens in URLs.
- Entry cards disclose provenance, use qualitative mood bands, show unavailable states instead of fabricated neutral scores, and let users correct type and mood.

### Data integrity and health

- Offline writes are idempotent, recover stuck syncing state, preserve transcription/safety/consent fields, and cannot cross account boundaries.
- Fused transcription stores raw and cleaned text and accepts a bounded proper-noun vocabulary derived from the user's own entity tags.
- WHOOP data is filtered by local date and timezone, normalizes duration units, rejects impossible sleep records, and records provenance.
- Failed AI analysis remains failed/unknown rather than becoming a synthetic `0.5` mood or reflection classification.

### Cloud visual system and delivery

- Cloud semantic color/type/motion tokens, three accent themes, dark mode, safe-area handling, reduced motion, and system font stacks replace runtime font requests.
- Heavy screens now load on demand. The main app chunk moved from **690.98 kB / 189.82 kB gzip** to **664.64 kB / 186.93 kB gzip** despite the new product surfaces.
- Production dependency audits moved from 58 aggregate findings across the app/functions/relay to **zero**.
- CI uses Node 22, Java 21 for the rules emulator, strict lockfile installs, relay gates, rules tests, and candidate health verification before Cloud Run promotion.

## Verification evidence

| Gate | Result |
|---|---|
| Root Vitest | 61 files, 749 tests passed |
| Firestore rules | 30 tests passed in emulator |
| Relay Vitest | 4 files, 43 tests passed |
| Root TypeScript | Passed |
| Relay TypeScript | Passed |
| Web production build | Passed |
| Relay production build | Passed |
| iOS simulator build | Passed, including App Intents metadata |
| Production dependency audits | 0 vulnerabilities in root, functions, and relay |

## Release gates that remain intentionally manual

- Run microphone permission, phone-call interruption, Bluetooth route change, lock/unlock, force-quit recovery, and long-recording tests on physical iPhones.
- Validate Siri phrase discovery and Home Screen quick actions on the minimum and current iOS versions.
- Complete App Store signing, privacy manifest review, screenshots, and TestFlight acceptance testing.
- A custom Lock Screen widget, Live Activity, or iOS Control Center control is a follow-on native target. This release exposes the same capture intents through Siri/Shortcuts, which users can place on supported system surfaces without creating a second recording pipeline.
- Production deployment and traffic promotion happen only after review/merge; this branch does not mutate the live environment.
