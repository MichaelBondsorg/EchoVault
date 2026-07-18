## What this ships

This is the first integrated product-quality release candidate from the review and redesign work. It combines the Cloud visual foundation, a dedicated Type/Record New Entry composer, native durable iOS capture, Home Screen/Siri/Shortcuts entry points, owner-scoped recovery, honest analysis states, provenance/corrections, health-data fixes, identity hardening, privacy controls, dependency remediation, and deployment gates.

The center `+` is New Entry. **Talk with Engram** remains separate.

## Important behavior

- Native audio is persisted before transcription and survives interruption/relaunch.
- Offline queues and audio cannot cross account boundaries.
- Users may continue with typed entries while AI is paused; those entries are not sent for embedding, memory extraction, or client analysis.
- Voice relay authentication uses single-use tickets instead of ID tokens in WebSocket URLs.
- Failed analysis is unavailable/unknown, never a fabricated neutral mood.

## Verification

- Root: 61 test files / 749 tests
- Firestore emulator: 30 rules tests
- Relay: 4 test files / 43 tests, typecheck, build
- Root: typecheck and production build
- iOS: simulator build passed with native capture and App Intents
- Audits: zero production vulnerabilities in root/functions/relay

Full evidence and remaining physical-device release gates are in `docs/quality/release-candidate.md`.
