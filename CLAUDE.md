# EchoVault - Claude Code Project Guide

## Working with Me (Michael)

### My Background
- **Solo developer** - I'm the only person working on this codebase
- **Product-focused** - I understand technical concepts but prefer clear explanations over jargon
- **Active development** - Building toward App Store launch soon

### How I Want Claude to Work

**Communication Style:**
- Provide detailed explanations of what you're doing and why
- Explain technical concepts when they come up
- Be proactive - identify issues, suggest improvements, flag concerns

**Code Changes:**
- Be conservative - ask before making significant changes
- **NEVER commit automatically** - stage changes and explain them, let me review first
- When in doubt, ask rather than assume

**Git Workflow:**
- Work on feature branches, never push directly to `main`
- `main` branch triggers automatic deployments via GitHub Actions
- I'll review changes before committing, then merge to main to deploy

**Focus Areas:**
- Signal lifecycle (goals, insights, patterns) is my current primary focus
- Debugging is my biggest pain point - help me understand what's happening

**Safety-Critical Code:**
- You CAN modify crisis detection and safety code
- You MUST explain thoroughly what you're changing and why
- Always preserve the core safety functionality

---

## Project Status Tracking

### Living Project State

**File:** `PROJECT_STATUS.md` (root directory)

This file tracks current project state, decisions, and priorities. It's the "living" complement to this technical reference.

- **CLAUDE.md** = How the codebase works (mostly static)
- **PROJECT_STATUS.md** = Where we are and what we've decided (updated frequently)

**At the start of every session**, read both files to understand:
1. Technical context (CLAUDE.md)
2. Current priorities and recent decisions (PROJECT_STATUS.md)

### When to Update PROJECT_STATUS.md

**Before creating a PR**, check if any of these sections need updates:

| Section | Update When... |
|---------|----------------|
| **Active Work** | Work items completed, new items started, status changed |
| **Recent Decisions** | Any significant decision made during session |
| **Parked Ideas** | We discussed and explicitly rejected an approach |
| **Known Issues** | Discovered new tech debt, bugs, or problems |
| **Session Notes** | Major design sessions or architectural discussions |
| **User Feedback Log** | Any feedback received from users |

### What Counts as a "Decision"

**Log it if:**
- We chose between multiple viable approaches
- We decided NOT to build something (and why)
- We changed or reversed a previous decision
- We made an architectural choice that constrains future work
- We set a threshold, default, or policy (e.g., "mood gate at 50%")

**Don't log:**
- Routine implementation choices
- Bug fixes
- Minor refactors
- Obvious decisions with no real alternatives

### Decision Log Format

Keep entries minimal. One row per decision.

```markdown
| Date | Decision | Why | Revisit If |
|------|----------|-----|------------|
| 2026-01-14 | Use Firestore transactions for thread updates | Prevent race conditions on rapid entries | Performance issues at scale |
```

The **"Revisit If"** column is important — it tells future sessions when this decision should be reconsidered.

### PR Checklist

Before marking a PR ready for review:

- [ ] Code changes tested locally
- [ ] No temporary/debug code left in
- [ ] Console.logs removed (or intentional and documented)
- [ ] **PROJECT_STATUS.md updated** (if applicable)
  - [ ] Active Work reflects current state
  - [ ] Any decisions logged with rationale
  - [ ] New tech debt documented
- [ ] Commit messages are descriptive

### Session Handoff

When ending a significant work session (especially if work is incomplete):

1. **Update Active Work** with current status
2. **Add Session Notes** if context would help the next session
3. **Stage changes** but let Michael review before committing

This ensures the next session (whether tomorrow or next week) can pick up without re-discovering context.

---

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

### Signal Lifecycle State Machine (Primary Focus Area)

The signal lifecycle system (`src/services/signals/signalLifecycle.js`) is the heart of EchoVault's intelligence. It transforms AI observations into actionable, user-manageable items.

**What is a Signal?**
A signal is an AI-detected observation from journal entries: a goal the user mentioned, a pattern in their behavior, or an insight about their emotional state.

**Signal Types:**

| Type | Purpose | Example |
|------|---------|---------|
| `goal` | User intentions/commitments | "I want to exercise more" |
| `insight` | Behavioral observations | "You tend to feel anxious on Mondays" |
| `pattern` | Recurring behaviors | "Sleep quality correlates with mood" |
| `contradiction` | Conflicting goals/behaviors | Says wants to relax but overcommits |

**State Transitions (Immutable Rules):**

```
GOALS:
  proposed ──→ active ──→ achieved (terminal)
      │           │
      │           ├──→ abandoned (terminal)
      │           │
      │           └──→ paused ──→ active
      │                   │
      └───────────────────┴──→ abandoned (terminal)

INSIGHTS:
  pending ──→ verified ──→ actioned (terminal)
      │           │
      │           └──→ dismissed (terminal)
      │
      └──→ dismissed (terminal)
      │
      └──→ actioned (terminal)

PATTERNS:
  detected ──→ confirmed ──→ resolved (terminal)
      │            │
      │            └──→ rejected (terminal)
      │
      └──→ rejected (terminal)
```

**Key Concepts:**
- **Terminal states**: No further transitions allowed (achieved, abandoned, dismissed, rejected, resolved, actioned)
- **State history**: Every transition is logged with timestamp and context
- **Exclusions**: Users can exclude certain pattern types from future detection
- **Side effects**: Goal termination automatically resolves related contradictions

**Firestore Collections:**
```
users/{userId}/
├── signal_states/     # All signals with lifecycle tracking
└── insight_exclusions/  # User-dismissed pattern types
```

**Key Functions:**
- `createSignalState(userId, signalData)` - Create new signal
- `transitionSignalState(userId, signalId, newState, context)` - Change state (validates transition)
- `getActiveGoals(userId)` - Get non-terminal goals
- `getPendingInsights(userId)` - Get insights awaiting user action
- `isPatternExcluded(userId, patternType)` - Check if user dismissed this pattern type

**Debugging Signal Issues:**
1. Check signal exists: `getSignalState(userId, signalId)`
2. View state history: Look at `stateHistory` array on the signal document
3. Validate transition: `isValidTransition(currentState, targetState)`
4. Check for exclusions: `getActiveExclusions(userId)`

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

### Adding Feature Announcements (What's New)

After developing significant new features, add user-facing announcements:

**1. What's New Modal (one-time popup)**

File: `src/components/shared/WhatsNewModal.jsx`

```javascript
// Increment FEATURE_VERSION to show modal again after new features
const FEATURE_VERSION = '2.1.0';  // Change this!
const STORAGE_KEY = 'echovault.lastSeenVersion';
```

To trigger the modal for all users after a feature release:
1. Open `WhatsNewModal.jsx`
2. Increment `FEATURE_VERSION` (e.g., '2.1.0' → '2.2.0')
3. Update the feature list in the modal content
4. Deploy

Users who haven't seen this version will get the popup on next visit.

**2. Page-Level Tips Banner**

For feature-specific onboarding, add dismissible tips to the relevant page.

Example pattern (see `EntityManagementPage.jsx`):
```javascript
// State with localStorage persistence
const [showTips, setShowTips] = useState(() => {
  return localStorage.getItem('featureName.tipsDismissed') !== 'true';
});

const dismissTips = () => {
  setShowTips(false);
  localStorage.setItem('featureName.tipsDismissed', 'true');
};
```

Add a help button to show tips again:
```jsx
{!showTips && (
  <button onClick={() => setShowTips(true)} title="Show tips">
    <HelpCircle size={20} />
  </button>
)}
```

**3. Testing Announcements Locally**

Reset localStorage to test as a new user:
```javascript
// In browser console:
localStorage.removeItem('echovault.lastSeenVersion')  // What's New modal
localStorage.removeItem('featureName.tipsDismissed')  // Page tips
```

**Checklist after developing features:**
- [ ] Update `WhatsNewModal.jsx` with new features (increment version)
- [ ] Add page-level tips if feature has its own screen
- [ ] Test by clearing localStorage and refreshing

## Safety Requirements

**CRITICAL**: This is a mental health app. Always:
- Preserve crisis detection logic in `src/services/safety/`
- Never remove safety keywords from `src/config/constants.js`
- Test changes to analysis that might affect crisis flagging
- Maintain therapeutic framework integrity (ACT, CBT, DBT, RAIN)

## Debugging Guide

Since debugging is a pain point, here's how to approach common issues:

### General Debugging Steps
1. **Check the console** - Most services have `console.log` statements
2. **Check Firestore** - Use Firebase Console to inspect document state
3. **Check Cloud Function logs** - `firebase functions:log`
4. **Check state history** - Signals have `stateHistory` arrays showing all transitions

### Common Issues

**Signal not transitioning:**
```javascript
// Check current state and valid transitions
import { getSignalState, isValidTransition, SIGNAL_STATES } from './services/signals/signalLifecycle';
const signal = await getSignalState(userId, signalId);
console.log('Current state:', signal.state);
console.log('Can transition to active?', isValidTransition(signal.state, SIGNAL_STATES.GOAL_ACTIVE));
```

**Entry not being analyzed:**
- Check network tab for Cloud Function call
- Verify `analyzeJournalEntryFn` response
- Check `classification` and `analysis` fields on the entry document

**Voice not working:**
- Check WebSocket connection in Network tab
- Verify relay server is running (`relay-server/src/index.ts`)
- Check `useVoiceRelay` hook for connection state

**Offline issues:**
- Check `useNetworkStatus` hook
- Verify IndexedDB in DevTools > Application
- Check pending writes in Firestore SDK

### Useful Console Commands
```javascript
// In browser console after logging in
// Get current user's signals
const user = firebase.auth().currentUser;
// Then use services to inspect state
```

## Known Technical Debt

- [ ] `App.jsx` is oversized (71KB) - needs decomposition
- [ ] `functions/index.js` is monolithic - consider splitting
- [ ] Limited TypeScript usage (only relay-server)
- [ ] Test coverage is minimal

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
