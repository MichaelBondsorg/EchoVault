# EchoVault → Engram Rename Implementation Plan

**Status:** Roadmap / Future Work
**Created:** January 18, 2026
**App Store Name Reserved:** "Engram" (com.echovault.engram)

---

## Overview
Comprehensive rename of the app from "EchoVault" to "Engram" across all user-facing surfaces while preserving immutable backend infrastructure.

**New Bundle ID:** `com.echovault.engram` (already reserved in App Store Connect)
**New Domain:** `theengram.app`

## Constraints (Cannot Change)
- Firebase Project ID: `echo-vault-app` (immutable)
- Firestore Collection: `echo-vault-v5-fresh` (user data exists)
- Cloud Run Service: `echovault-voice-relay-...` (deployed infrastructure)

---

## Phase 1: Configuration Files (Foundation)

### 1.1 Capacitor Config (Source of Truth)
**File:** `capacitor.config.ts`
```typescript
appId: 'com.echovault.engram'  // was: com.echovault.app
appName: 'Engram'              // was: EchoVault
```

### 1.2 Package Files
| File | Change |
|------|--------|
| `package.json` | `"name": "engram"` |
| `functions/package.json` | Update name and description |
| `relay-server/package.json` | Update name and description |

**Note:** Keep `@echovault/capacitor-health-extended` as-is (internal npm package).

---

## Phase 2: iOS Native Platform

### 2.1 Info.plist
**File:** `ios/App/App/Info.plist`
- `CFBundleDisplayName`: "EchoVault" → "Engram"
- `CFBundleURLName`: `com.echovault.engram`
- `CFBundleURLSchemes`: "echovault" → "engram"
- Update 5 permission description strings

### 2.2 Xcode Project
**File:** `ios/App/App.xcodeproj/project.pbxproj`
- `PRODUCT_BUNDLE_IDENTIFIER`: `com.echovault.engram` (Debug + Release)

### 2.3 Fastlane
| File | Change |
|------|--------|
| `ios/fastlane/Appfile` | `app_identifier("com.echovault.engram")` |
| `ios/fastlane/Fastfile` | Output names: `Engram.ipa`, `Engram-Dev.ipa` |

---

## Phase 3: Android Native Platform

### 3.1 Build Config
**File:** `android/app/build.gradle`
```gradle
namespace = "com.echovault.engram"
applicationId "com.echovault.engram"
```

### 3.2 AndroidManifest.xml
**File:** `android/app/src/main/AndroidManifest.xml`
- Deep link scheme: "echovault" → "engram"

### 3.3 String Resources
**File:** `android/app/src/main/res/values/strings.xml`
- `app_name`: "Engram"
- `title_activity_main`: "Engram"
- `package_name`: "com.echovault.engram"
- `custom_url_scheme`: "com.echovault.engram"

### 3.4 MainActivity (Requires Directory Move)
**Move file:**
```
FROM: android/app/src/main/java/com/echovault/app/MainActivity.java
TO:   android/app/src/main/java/com/echovault/engram/MainActivity.java
```
Update package declaration to `package com.echovault.engram;`

### 3.5 Fastlane
| File | Change |
|------|--------|
| `android/fastlane/Appfile` | `package_name("com.echovault.engram")` |

---

## Phase 4: Deep Links / OAuth Callbacks

### 4.1 Relay Server
**File:** `relay-server/src/index.ts`

Update 7 redirect URLs:
- `echovault://auth-success` → `engram://auth-success`
- `echovault://auth-error` → `engram://auth-error`

**Important:** After changes, redeploy relay server to Cloud Run.

### 4.2 OAuth Provider Console Updates (Manual)
- **Google OAuth Console:** Add `engram://` to authorized redirect URIs
- **Apple Developer:** Update associated domains if needed
- **Whoop Developer Portal:** Update redirect URI

---

## Phase 5: Web / PWA

| File | Changes |
|------|---------|
| `index.html` | `<title>Engram</title>` |
| `public/manifest.json` | `name`, `short_name`: "Engram" |
| `public/terms-of-service.html` | Replace "EchoVault" → "Engram", update `support@echovault.app` → `support@theengram.app`, update domain URLs |

---

## Phase 6: Source Code (User-Facing Text)

| File | Line | Change |
|------|------|--------|
| `src/components/zen/TopBar.jsx` | 51 | Brand name display |
| `src/App.jsx` | ~1896 | Login screen brand text |
| `src/pages/SettingsPage.jsx` | 204 | Version display |
| `src/components/screens/TherapistExportScreen.jsx` | 64 | PDF header |
| `src/components/screens/HealthSettingsScreen.jsx` | 944, 978 | Explanation text |
| `src/components/zen/SanctuaryWalkthrough.jsx` | 20 | Walkthrough text |
| `src/components/settings/NexusSettings.jsx` | 126 | Settings description |
| `src/components/shared/WhatsNewModal.jsx` | 13 | localStorage key* |

*Changing localStorage key will show "What's New" modal again - good for rebrand announcement.

**Console logs:** Leave `[EchoVault]` prefixes as-is (internal only, optional cleanup later).

---

## Phase 7: App Store Metadata

### iOS (`fastlane/metadata/ios/en-US/`)
| File | Change |
|------|--------|
| `name.txt` | "Engram" |
| `description.txt` | Replace all "EchoVault" → "Engram" |
| `marketing_url.txt` | `https://theengram.app` |
| `support_url.txt` | `https://theengram.app/support` |
| `privacy_url.txt` | `https://theengram.app/privacy` |

### Android (`fastlane/metadata/android/en-US/`)
| File | Change |
|------|--------|
| `title.txt` | "Engram" or "Engram - AI Journal" |
| `full_description.txt` | Replace all "EchoVault" → "Engram", update URLs to `theengram.app` |

---

## Phase 8: Documentation

| File | Changes |
|------|---------|
| `README.md` | Project name, clone URL |
| `CLAUDE.md` | All references |
| `SETUP.md` | Title |

### Rename Files
- `echovault-ui-issues-register.md` → `engram-ui-issues-register.md`
- `EchoVault-Nexus-2.0-Implementation-Spec.md` → `Engram-Nexus-2.0-Implementation-Spec.md`

---

## Phase 9: Verification

### Build Tests
```bash
npm run build                    # Web build
npm run cap:sync                 # Sync native projects
npm run cap:build:ios            # iOS build
npm run cap:build:android        # Android build
```

### Deep Link Tests
```bash
# iOS Simulator
xcrun simctl openurl booted "engram://auth-success?provider=whoop"

# Android Emulator
adb shell am start -a android.intent.action.VIEW -d "engram://auth-success"
```

### OAuth Flow Test
1. Fresh install on device
2. Sign in with Google
3. Sign in with Apple
4. Connect Whoop (verify `engram://` redirects)

### App Store Validation
1. Archive iOS build in Xcode
2. Upload to App Store Connect
3. Verify bundle ID matches `com.echovault.engram`

---

## Critical Files Summary

| Priority | File | Purpose |
|----------|------|---------|
| 1 | `capacitor.config.ts` | Source of truth |
| 2 | `ios/App/App/Info.plist` | iOS config |
| 3 | `android/app/build.gradle` | Android config |
| 4 | `relay-server/src/index.ts` | OAuth redirects |
| 5 | `android/.../MainActivity.java` | Requires move |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bundle ID change = "new app" | Users must re-download | Final update to old app directing to new |
| OAuth redirects break | Auth fails | Update provider consoles before release |
| Deep links fail | Auth callbacks break | Test thoroughly on devices |

---

## Rollback Plan
```bash
# Create backup before starting
git checkout -b backup/pre-engram-rename

# If issues, rollback
git checkout backup/pre-engram-rename
npm run cap:sync
```

---

## Execution Order

| Order | Phase | Risk | Dependencies |
|-------|-------|------|--------------|
| 1 | Config Files | Low | None |
| 2 | iOS Native | Medium | Phase 1 |
| 3 | Android Native | Medium | Phase 1 |
| 4 | OAuth/Deep Links | High | Phase 2-3 |
| 5 | Web/PWA | Low | Phase 1 |
| 6 | Source Code UI | Low | None |
| 7 | App Store Metadata | Low | None |
| 8 | Documentation | Low | None |
| 9 | Verification | N/A | All |

**Recommendation:** Complete Phases 1-5 together, then Phases 6-8 in follow-up.

---

## Pre-Rename Checklist

- [ ] Register/purchase `theengram.app` domain
- [ ] Set up email forwarding for `support@theengram.app`
- [ ] Create landing page at `theengram.app`
- [ ] Update OAuth provider consoles with new redirect URIs
- [ ] Back up current app configuration
- [ ] Plan user communication about rebrand
