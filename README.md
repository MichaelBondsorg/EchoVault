# Engram

A mental health journaling application that helps users process emotions, track patterns, set goals, and receive AI-powered therapeutic insights.

## Features

- **Voice & Text Journaling** - Record thoughts via voice or text with AI transcription
- **Crisis Detection** - Automatic safety monitoring with therapeutic resources
- **Pattern Recognition** - AI-identified behavioral and emotional patterns
- **Goal Tracking** - Lifecycle-managed goals with progress insights
- **Real-time Voice Conversations** - AI-powered therapeutic chat
- **Health Integration** - Whoop API for biometric context
- **Therapeutic Frameworks** - ACT, CBT, DBT, and RAIN methodologies

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS
- **Mobile**: Capacitor (iOS & Android)
- **Backend**: Firebase Cloud Functions
- **Database**: Firestore
- **AI**: Gemini (analysis), GPT-4o (chat), Whisper (transcription)
- **Voice**: Cloud Run WebSocket relay server

## Quick Start

### Prerequisites

- Node.js 20+
- Firebase CLI (`npm install -g firebase-tools`)
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/michaelbond92/Engram.git
cd Engram

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your Firebase credentials

# Start development server
npm run dev
```

### Environment Variables

```bash
VITE_FIREBASE_API_KEY=your-api-key
VITE_GOOGLE_WEB_CLIENT_ID=your-oauth-client-id
VITE_GOOGLE_IOS_CLIENT_ID=your-ios-client-id
VITE_GOOGLE_IOS_SERVER_CLIENT_ID=your-ios-server-client-id
```

### Firebase Setup

```bash
# Login to Firebase
firebase login

# Set Cloud Function secrets
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set OPENAI_API_KEY
```

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Deploy frontend
firebase deploy --only hosting

# Deploy Cloud Functions
cd functions && firebase deploy --only functions
```

### Mobile Development

```bash
# iOS
npm run cap:ios

# Android
npm run cap:android
```

## Project Structure

```
├── src/
│   ├── components/    # React components
│   ├── services/      # Business logic (27 modules)
│   ├── hooks/         # Custom React hooks
│   ├── pages/         # Page components
│   ├── config/        # Firebase config, constants
│   └── utils/         # Utility functions
├── functions/         # Firebase Cloud Functions
├── relay-server/      # Voice relay server (Cloud Run)
├── android/           # Android native app
└── ios/               # iOS native app
```

## Documentation

- [CLAUDE.md](./CLAUDE.md) - Claude Code project guide
- [SETUP.md](./SETUP.md) - Detailed setup instructions
- [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) - Privacy policy

## CI/CD

GitHub Actions workflows handle deployment:

| Workflow | Trigger | Target |
|----------|---------|--------|
| `firebase-hosting.yml` | Push to main | Firebase Hosting |
| `deploy-functions.yml` | Push to main (functions changes) | Cloud Functions |
| `deploy-relay-server.yml` | Push to main (relay-server changes) | Cloud Run |

## License

Proprietary - All rights reserved
