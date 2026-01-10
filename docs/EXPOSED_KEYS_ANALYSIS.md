# Exposed API Keys Analysis

## Summary

This document lists all exposed API keys and credentials found in the codebase, with their exact locations and security risk assessment.

---

## 🔴 Critical: Hardcoded Firebase API Key

### Location 1: `src/config/firebase.js` (Line 16)

```javascript
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBuhwHcdxEuYHf6F5SVlWR5BLRio_7kqAg",
  // ...
};
```

**Risk Level**: ⚠️ **Medium** (Firebase API keys are designed to be public, but should still use env vars)

**Issue**: Fallback hardcoded value. If `VITE_FIREBASE_API_KEY` env var is not set, it uses the hardcoded key.

**Recommendation**: Remove the fallback hardcoded value. Fail fast if env var is missing:
```javascript
apiKey: import.meta.env.VITE_FIREBASE_API_KEY || (() => {
  throw new Error('VITE_FIREBASE_API_KEY environment variable is required');
})(),
```

---

### Location 2: `src/App.jsx` (Line 1309)

```javascript
const API_KEY = 'AIzaSyBuhwHcdxEuYHf6F5SVlWR5BLRio_7kqAg';
const restUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`;
```

**Risk Level**: ⚠️ **Medium-High**

**Issue**: Firebase API key hardcoded in REST API fallback code for authentication.

**Recommendation**: Use environment variable:
```javascript
const API_KEY = import.meta.env.VITE_FIREBASE_API_KEY;
if (!API_KEY) {
  throw new Error('Firebase API key is required for authentication');
}
const restUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`;
```

**Context**: This is used in a fallback authentication flow when the Firebase SDK hangs in WKWebView on iOS.

---

## ⚠️ Medium: Google OAuth Client IDs (Public by Design, But Should Be Configurable)

### Location 1: `src/App.jsx` (Lines 1216-1218)

```javascript
await SocialLogin.initialize({
  google: {
    webClientId: '581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com',
    iOSClientId: '581319345416-sf58st9q2hvst5kakt4tn3sgulor6r7m.apps.googleusercontent.com',
    iOSServerClientId: '581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com',
  }
});
```

**Risk Level**: ⚠️ **Low-Medium** (OAuth client IDs are meant to be public, but hardcoding makes dev/staging/prod sharing impossible)

**Issue**: Hardcoded Google OAuth client IDs make it difficult to:
- Use different client IDs for dev/staging/production
- Rotate credentials
- Share codebase without exposing your credentials

**Recommendation**: Move to environment variables:
```javascript
await SocialLogin.initialize({
  google: {
    webClientId: import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID,
    iOSClientId: import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID,
    iOSServerClientId: import.meta.env.VITE_GOOGLE_IOS_SERVER_CLIENT_ID,
  }
});
```

---

### Location 2: `capacitor.config.ts` (Lines 43-45)

```typescript
SocialLogin: {
  google: {
    webClientId: '581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com',
    iOSClientId: '581319345416-sf58st9q2hvst5kakt4tn3sgulor6r7m.apps.googleusercontent.com',
    iOSServerClientId: '581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com',
  },
},
```

**Risk Level**: ⚠️ **Low-Medium** (Same as above - OAuth client IDs are public but should be configurable)

**Issue**: Capacitor config hardcodes OAuth client IDs. Capacitor config files are typically committed to git.

**Recommendation**: Use environment variables with Capacitor's env plugin, or use a separate config file that's gitignored for production builds.

**Note**: Capacitor config doesn't support `import.meta.env` directly. You'll need to:
1. Use a build script to inject env vars, OR
2. Use `@capacitor/cli` with environment variable substitution, OR
3. Generate `capacitor.config.ts` from a template during build

---

### Location 3: `functions/index.js` (Lines 3290-3291)

```javascript
'581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com', // Web client
'581319345416-sf58st9q2hvst5kakt4tn3sgulor6r7m.apps.googleusercontent.com', // iOS client
```

**Risk Level**: ⚠️ **Low** (Server-side, but still should use env vars)

**Issue**: Hardcoded in Cloud Functions code.

**Recommendation**: Move to environment variable or Firebase Functions config:
```javascript
const WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID || functions.config().google?.web_client_id;
const IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID || functions.config().google?.ios_client_id;
```

---

## ✅ Acceptable: Firebase Project Configuration

### Location: `src/config/firebase.js` (Lines 17-21)

```javascript
authDomain: "echo-vault-app.firebaseapp.com",
projectId: "echo-vault-app",
storageBucket: "echo-vault-app.firebasestorage.app",
messagingSenderId: "581319345416",
appId: "1:581319345416:web:777247342fffc94989d8bd"
```

**Risk Level**: ✅ **None** (These are public project identifiers, not secrets)

**Status**: These are safe to commit. They're public project identifiers, not authentication secrets.

---

## 🔒 Secure: Server-Side API Keys (Correctly Handled)

### Location: `functions/index.js`

```javascript
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const openaiApiKey = defineSecret('OPENAI_API_KEY');
```

**Status**: ✅ **Correctly Secured** - Using Firebase Functions secrets

### Location: `relay-server/src/config/index.ts`

```typescript
openaiApiKey: process.env.OPENAI_API_KEY || '',
geminiApiKey: process.env.GEMINI_API_KEY || '',
```

**Status**: ✅ **Correctly Secured** - Using environment variables (should be set in deployment)

---

## 📋 Complete List of Exposed Credentials

| Credential Type | Value | Location | Risk | Status |
|----------------|-------|----------|------|--------|
| Firebase API Key | `AIzaSyBuhwHcdxEuYHf6F5SVlWR5BLRio_7kqAg` | `src/config/firebase.js:16` | Medium | ⚠️ Should use env var |
| Firebase API Key | `AIzaSyBuhwHcdxEuYHf6F5SVlWR5BLRio_7kqAg` | `src/App.jsx:1309` | Medium-High | 🔴 **Fix Required** |
| Google Web Client ID | `581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com` | `src/App.jsx:1216` | Low-Medium | ⚠️ Should use env var |
| Google iOS Client ID | `581319345416-sf58st9q2hvst5kakt4tn3sgulor6r7m.apps.googleusercontent.com` | `src/App.jsx:1217` | Low-Medium | ⚠️ Should use env var |
| Google iOS Server Client ID | `581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com` | `src/App.jsx:1218` | Low-Medium | ⚠️ Should use env var |
| Google Web Client ID | `581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com` | `capacitor.config.ts:43` | Low-Medium | ⚠️ Should use env var |
| Google iOS Client ID | `581319345416-sf58st9q2hvst5kakt4tn3sgulor6r7m.apps.googleusercontent.com` | `capacitor.config.ts:44` | Low-Medium | ⚠️ Should use env var |
| Google iOS Server Client ID | `581319345416-9h59io8iev888kej6riag3tqnvik6na0.apps.googleusercontent.com` | `capacitor.config.ts:45` | Low-Medium | ⚠️ Should use env var |

---

## 🎯 Priority Fixes

### High Priority (Security)

1. **`src/App.jsx:1309`** - Remove hardcoded Firebase API key, use env var
   - This is in client-side code used for authentication fallback
   - **Impact**: If compromised, could allow unauthorized API access

### Medium Priority (Best Practices)

2. **`src/config/firebase.js:16`** - Remove fallback hardcoded value
   - Fail fast if env var is missing
   - **Impact**: Prevents accidentally deploying with hardcoded values

3. **OAuth Client IDs** - Move to environment variables
   - Enables dev/staging/prod separation
   - **Impact**: Operational flexibility and security rotation

---

## 📝 Recommended Environment Variables

Create a `.env.example` file with:

```bash
# Firebase Configuration
VITE_FIREBASE_API_KEY=your_firebase_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=echo-vault-app.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=echo-vault-app
VITE_FIREBASE_STORAGE_BUCKET=echo-vault-app.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=581319345416
VITE_FIREBASE_APP_ID=1:581319345416:web:777247342fffc94989d8bd

# Google OAuth Client IDs
VITE_GOOGLE_WEB_CLIENT_ID=your_web_client_id.apps.googleusercontent.com
VITE_GOOGLE_IOS_CLIENT_ID=your_ios_client_id.apps.googleusercontent.com
VITE_GOOGLE_IOS_SERVER_CLIENT_ID=your_ios_server_client_id.apps.googleusercontent.com

# Relay Server (if needed in frontend)
VITE_VOICE_RELAY_URL=wss://your-relay-server.com/voice
```

---

## 🔍 How to Check for More Exposed Keys

Run these searches to find potential secrets:

```bash
# Find Firebase API keys
grep -r "AIzaSy" src/

# Find Google OAuth client IDs
grep -r "apps.googleusercontent.com" src/

# Find hardcoded credentials (general pattern)
grep -rE "(api[_-]?key|apikey|secret|password|token)\s*[:=]\s*['\"][^'\"]{20,}" src/ --ignore-case

# Find potential AWS keys
grep -rE "AKIA[0-9A-Z]{16}" src/

# Find potential private keys
grep -rE "-----BEGIN [A-Z ]+ PRIVATE KEY-----" src/
```

---

## ⚠️ Important Notes

1. **Firebase API Keys are NOT secret**: Firebase API keys are designed to be included in client-side code. They identify your Firebase project, but they're restricted by Firebase Security Rules. However, you should still:
   - Use environment variables for different environments
   - Monitor for unusual usage in Firebase Console
   - Implement proper Firestore security rules

2. **OAuth Client IDs are public**: Google OAuth client IDs are meant to be public. However, hardcoding them:
   - Makes environment separation difficult
   - Prevents easy credential rotation
   - Exposes your project structure in git history

3. **Never commit `.env` files**: Ensure `.env` and `.env.local` are in `.gitignore` (they already are ✅)

---

## ✅ Verification Steps

After fixing, verify:

1. ✅ No hardcoded API keys in `src/` directory
2. ✅ All credentials use environment variables
3. ✅ `.env.example` exists with placeholders
4. ✅ `.env` is in `.gitignore`
5. ✅ Build fails if required env vars are missing
6. ✅ Documentation explains how to set up environment variables
