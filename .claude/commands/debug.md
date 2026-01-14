# Debug an Issue

Help me debug an issue in EchoVault. I'll describe the problem, and you should:

1. **Understand the problem** - Ask clarifying questions if needed
2. **Identify affected code paths** - Trace through the relevant services and components
3. **Check state** - Help me inspect Firestore documents, signal states, or component state
4. **Form hypotheses** - Suggest what might be causing the issue
5. **Propose investigation steps** - Tell me what to check in DevTools, Firebase Console, or logs

## Debugging Resources

**Console Logging:**
- Most services have `console.log` statements
- Check browser DevTools Console tab

**Firestore:**
- Firebase Console: https://console.firebase.google.com/project/echo-vault-app/firestore
- Collection path: `artifacts/echo-vault-v5-fresh/users/{userId}/...`

**Cloud Functions:**
```bash
firebase functions:log --project echo-vault-app
```

**Signal Lifecycle:**
- Check `signal_states` collection for state history
- Validate transitions with `isValidTransition()`

**Network:**
- Check Network tab for failed requests
- WebSocket connections for voice features

## Common Issue Types

- **Signal issues** → Check `src/services/signals/`
- **Entry analysis** → Check Cloud Function `analyzeJournalEntry`
- **Voice/transcription** → Check relay server and `useVoiceRelay` hook
- **UI not updating** → Check React state in App.jsx
- **Offline sync** → Check `useNetworkStatus` and IndexedDB

## What to Tell Me

Please describe:
1. What you expected to happen
2. What actually happened
3. Steps to reproduce (if known)
4. Any error messages you see
