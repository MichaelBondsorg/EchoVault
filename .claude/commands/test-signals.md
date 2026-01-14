# Run Signal Lifecycle Tests

Run the signal lifecycle tests to verify state machine integrity.

## Command

```bash
npx vitest run src/services/signals/__tests__/signalLifecycle.test.js
```

## What This Tests

- Goal state transitions (proposed → active → achieved/abandoned/paused)
- Insight state transitions (pending → verified/dismissed/actioned)
- Pattern state transitions (detected → confirmed/rejected/resolved)
- Terminal state detection
- Invalid transition rejection

## When to Run

- After modifying `src/services/signals/signalLifecycle.js`
- After changing goal/insight/pattern processing logic
- Before deploying changes to signal-related features
