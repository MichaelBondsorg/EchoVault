# App Store Launch Checklist

Comprehensive checklist for preparing EchoVault for App Store and Google Play launch.

## Pre-Launch Code Quality

### Security
- [ ] No API keys exposed in client code (all in Cloud Functions/secrets)
- [ ] Firestore security rules reviewed and tested
- [ ] No `console.log` statements with sensitive data
- [ ] HTTPS enforced everywhere
- [ ] OAuth tokens properly secured

### Stability
- [ ] Crisis detection thoroughly tested
- [ ] Offline mode works correctly
- [ ] Error boundaries catch component crashes
- [ ] Cloud Functions have proper error handling
- [ ] No memory leaks in long-running sessions

### Performance
- [ ] Bundle size optimized (check with `npm run build`)
- [ ] Images optimized
- [ ] Lazy loading for heavy components
- [ ] Firestore queries use indexes

## iOS Specific

### App Store Requirements
- [ ] App icons generated (all sizes)
- [ ] Splash screen configured
- [ ] Privacy policy URL in app
- [ ] App Store description written
- [ ] Screenshots for all device sizes
- [ ] Keywords researched

### Xcode Configuration
- [ ] Bundle identifier: `com.echovault.app`
- [ ] Version number updated
- [ ] Signing configured
- [ ] Capabilities enabled (push notifications, etc.)

### Apple Guidelines
- [ ] Mental health app guidelines reviewed
- [ ] Data privacy nutrition labels prepared
- [ ] Sign in with Apple (if using social login)

## Android Specific

### Google Play Requirements
- [ ] App icons generated
- [ ] Feature graphic created
- [ ] Store listing complete
- [ ] Content rating questionnaire
- [ ] Privacy policy URL

### Android Configuration
- [ ] Package name: `com.echovault.app`
- [ ] Version code incremented
- [ ] Signing key secured
- [ ] ProGuard rules configured

### Google Guidelines
- [ ] Target SDK level current
- [ ] Permissions justified
- [ ] Data safety section completed

## Testing Checklist

### Critical Paths
- [ ] User registration/login
- [ ] Journal entry creation (voice + text)
- [ ] Entry analysis completes
- [ ] Goals can be created and transitioned
- [ ] Crisis detection triggers safety resources
- [ ] Offline entry saving works
- [ ] Data syncs when back online

### Device Testing
- [ ] iPhone (various sizes)
- [ ] iPad
- [ ] Android phone
- [ ] Android tablet
- [ ] Web (desktop)
- [ ] Web (mobile)

## Post-Launch Monitoring

- [ ] Firebase Crashlytics enabled
- [ ] Cloud Function error alerting
- [ ] Analytics tracking key events
- [ ] User feedback channel established

## Commands to Run

```bash
# Build and verify
npm run build

# Test iOS
npm run cap:build:ios

# Test Android
npm run cap:build:android

# Check Cloud Functions
firebase functions:log --project echo-vault-app
```
