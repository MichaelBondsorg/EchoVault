# Deploy Firebase Cloud Functions

Deploy the Cloud Functions to Firebase.

## Steps

1. First, check for any TypeScript/syntax errors in the functions code
2. Review the changes being deployed: `git diff functions/`
3. Run the deployment: `cd functions && firebase deploy --only functions --project echo-vault-app`
4. Verify deployment was successful
5. Check the Firebase console logs for any runtime errors

## Important Notes

- Functions use Node.js 20 runtime
- Secrets must be set separately via `firebase functions:secrets:set`
- The functions/index.js file is a monolith - changes affect all functions
- Timeout: Most functions have 2-minute timeout, transcription has 9 minutes
