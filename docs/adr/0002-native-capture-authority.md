# ADR 0002: Native iOS capture authority

- Status: Accepted
- Date: 2026-07-18

## Context

The React/Capacitor recorder currently owns microphone capture through `MediaRecorder`, accumulates a complete session, converts it to base64, and only then writes a durable backup. That cannot reliably support screen lock, interruption recovery, cold system actions, or bounded memory on iPhone.

## Decision

A narrow Swift `CaptureCoordinator` is the authoritative iOS recorder. It owns the audio session, incremental protected-file persistence, state confirmation, interruption/route handling, finalization, and recovery. React owns the New Entry Type/Record composition and review UI through a typed Capacitor bridge.

The existing browser recorder remains behind a web adapter. Widgets, App Intents, Live Activities, Controls, and future system recording intents must route through the same coordinator.

## Consequences

- UI displays Recording only after native confirmation.
- Stop means finalize and store; transcription and analysis are downstream.
- All capture surfaces share one state machine and one durable draft model.
- Native behavior requires XCTest plus physical-device validation.
