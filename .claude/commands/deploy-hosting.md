# Deploy to Firebase Hosting

Build and deploy the frontend to Firebase Hosting.

## Steps

1. Run the production build: `npm run build`
2. Verify the build completed without errors
3. Check the `dist/` directory was created
4. Deploy to Firebase: `firebase deploy --only hosting --project echo-vault-app`
5. Verify the deployment at https://echo-vault-app.web.app

## Pre-deployment Checklist

- [ ] All environment variables in .env are correct
- [ ] No console.log statements with sensitive data
- [ ] Build completes without warnings
- [ ] Test critical paths manually if possible
