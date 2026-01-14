# Add a New Service Module

Guide for creating a new service in the EchoVault architecture.

## Template

Create the service file at `src/services/{domain}/index.js`:

```javascript
/**
 * {ServiceName} Service
 *
 * Purpose: {Brief description}
 */

import { db, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy } from '../../config/firebase';

const COLLECTION_NAME = 'artifacts/echo-vault-v5-fresh/users';

/**
 * {Function description}
 * @param {string} userId - The user's ID
 * @param {Object} data - The data to process
 * @returns {Promise<Object>} The result
 */
export async function myServiceFunction(userId, data) {
  // Implementation
}

export default {
  myServiceFunction
};
```

## Checklist

1. [ ] Create service file in `src/services/{domain}/`
2. [ ] Export from `src/services/index.js`
3. [ ] If using AI, consider Cloud Function wrapper for API key security
4. [ ] Add JSDoc comments for all exported functions
5. [ ] Consider adding tests in `src/services/{domain}/__tests__/`
