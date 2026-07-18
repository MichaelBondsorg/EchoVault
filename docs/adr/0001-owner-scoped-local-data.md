# ADR 0001: Owner-scoped local data

- Status: Accepted
- Date: 2026-07-18

## Context

Offline entries, audio metadata/files, context caches, and consent state have used global device keys. Async work can outlive an auth session, so resolving ownership from whichever user is currently signed in is unsafe.

## Decision

Every sensitive local operation requires an explicit authenticated owner UID. The owner is part of the physical key or directory namespace. Delayed work carries the owner captured when the operation was created and rejects a mismatched current session.

Legacy records without verifiable ownership are quarantined. They are never assigned to the next user who signs in.

## Consequences

- Account switching cannot expose or upload another account's local state.
- Storage APIs become owner-aware and their callers must provide an owner.
- Logout cancels active processors but preserves recoverable work in the original owner's namespace.
- Account deletion erases only the targeted owner's namespace plus explicitly associated quarantine records.
