# EchoVault - Claude Code Project Guide

## Project Overview

EchoVault is a mental health journaling application (v2.0.0) that helps users process emotions, track patterns, set goals, and receive AI-powered therapeutic insights. It's a cross-platform app supporting web, iOS, and Android.

**Firebase Project ID**: `echo-vault-app`
**Firestore Collection**: `artifacts/echo-vault-v5-fresh/users/{userId}/...`

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18.2, Vite 5, Tailwind CSS 3.4 |
| Mobile | Capacitor 8 (iOS & Android) |
| Backend | Firebase Cloud Functions (Node.js 20) |
| Voice Server | Express + WebSocket on Cloud Run |
| Database | Firestore |
| Auth | Firebase Auth + Google OAuth |
| AI Models | Gemini (analysis), OpenAI GPT-4o (chat), Whisper (transcription) |
| Health | Whoop API integration |

## Directory Structure

```
/src/
├── components/     # React components (18 subdirectories)
│   ├── chat/       # Conversation UI (UnifiedConversation.jsx is main)
│   ├── dashboard/  # Analytics views
│   ├── ui/         # Reusable UI components
│   └── zen/        # Main app layout (AppLayout.jsx)
├── services/       # Business logic (27 modules)
│   ├── ai/         # AI operations (embeddings, gemini, openai, transcription)
│   ├── signals/    # Signal lifecycle management
│   ├── analysis/   # Entry classification and analysis
│   └── safety/     # Crisis detection
├── hooks/          # Custom React hooks
├── pages/          # Page components
├── config/         # Firebase config, constants
└── utils/          # Date, string, audio utilities

/functions/         # Firebase Cloud Functions (single index.js)
/relay-server/      # Voice relay server (TypeScript)
/android/           # Android native app
/ios/               # iOS native app
```

## Key Files

- `src/App.jsx` - Main app container (large file ~71KB, manages global state)
- `src/config/firebase.js` - Firebase SDK setup and callable functions
- `src/config/constants.js` - Safety keywords, prompts, AI config
- `src/services/signals/signalLifecycle.js` - Signal state machine
- `functions/index.js` - All Cloud Functions (129KB monolith)
- `relay-server/src/index.ts` - Voice relay WebSocket server
- `firestore.rules` - Database security rules

## Architecture Patterns

### Signal Lifecycle State Machine
Signals (goals, insights, patterns) follow strict state transitions:
- **Goals**: proposed → active → achieved/abandoned/paused
- **Insights**: pending → verified/dismissed/actioned
- **Patterns**: detected → confirmed/rejected/resolved

### Entry Processing Pipeline
1. Capture (voice/text) → 2. Transcription → 3. Classification → 4. Analysis → 5. Signal extraction → 6. Storage → 7. Post-processing

### Firebase Cloud Functions Pattern
Server-side AI processing via `httpsCallable`:
- `analyzeJournalEntryFn` - Entry analysis (120s timeout)
- `transcribeAudioFn` - Audio transcription (540s timeout)
- `askJournalAIFn` - Chat completions
- `executePromptFn` - Custom prompt execution

## Development Commands

```bash
# Frontend development
npm run dev              # Start Vite dev server
npm run build            # Production build

# Mobile
npm run cap:ios          # Build and open iOS in Xcode
npm run cap:android      # Build and open Android in Android Studio

# Firebase
cd functions && npm run deploy   # Deploy Cloud Functions
firebase deploy --only hosting   # Deploy frontend

# Relay Server
cd relay-server && npm run dev   # Local development
```

## CI/CD Pipelines (.github/workflows/)

| Workflow | Trigger | Deploys |
|----------|---------|---------|
| `firebase-hosting.yml` | Push to main | Firebase Hosting |
| `deploy-functions.yml` | Push to main/claude/** (functions/* changes) | Cloud Functions |
| `deploy-relay-server.yml` | Push to main (relay-server/** changes) | Cloud Run |

## Code Conventions

### Naming
- Components: PascalCase (`UnifiedConversation.jsx`)
- Services: camelCase functions, organized by domain
- Hooks: `use` prefix (`useVoiceRelay.js`)
- Constants: SCREAMING_SNAKE_CASE

### React Patterns
- Functional components with hooks
- State lifted to App.jsx for global concerns
- Custom hooks for complex logic
- Framer Motion for animations

### Firebase Patterns
- Owner-based Firestore security rules
- Cloud Functions for AI/expensive operations
- Secrets managed via `firebase functions:secrets:set`

### Styling
- Tailwind CSS utility classes
- Custom therapeutic color palette (defined in tailwind.config.js)
- Dark mode support (class-based)

## Testing

- Framework: Vitest
- Test location: `src/services/**/__tests__/`
- Run tests: `npx vitest` (when configured)
- Current coverage: Minimal (signal lifecycle tests only)

## Common Tasks

### Adding a new service
1. Create file in `src/services/{domain}/`
2. Export functions from `src/services/index.js`
3. If AI-related, consider Cloud Function for API key security

### Adding a Cloud Function
1. Add to `functions/index.js`
2. Create callable in `src/config/firebase.js`
3. Deploy: `firebase deploy --only functions:{functionName}`

### Modifying Firestore schema
1. Update `firestore.rules` if new collection
2. Consider migration for existing data
3. Update relevant service modules

## Safety Requirements

**CRITICAL**: This is a mental health app. Always:
- Preserve crisis detection logic in `src/services/safety/`
- Never remove safety keywords from `src/config/constants.js`
- Test changes to analysis that might affect crisis flagging
- Maintain therapeutic framework integrity (ACT, CBT, DBT, RAIN)

## Known Technical Debt

- [ ] `App.jsx` is oversized (71KB) - needs decomposition
- [ ] `functions/index.js` is monolithic - consider splitting
- [ ] Limited TypeScript usage (only relay-server)
- [ ] Test coverage is minimal
- [ ] No README.md for project documentation

## Environment Setup

Required environment variables (`.env`):
```bash
VITE_FIREBASE_API_KEY=...
VITE_GOOGLE_WEB_CLIENT_ID=...
VITE_GOOGLE_IOS_CLIENT_ID=...
VITE_GOOGLE_IOS_SERVER_CLIENT_ID=...
```

Cloud Functions secrets:
```bash
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set OPENAI_API_KEY
```
