#!/usr/bin/env node
/**
 * Release-validation script (SEC-01).
 *
 * NOT wired into CI — deliberately. It curls a *deployed* Hosting URL, and
 * CI has no deployed-URL secret to give it that wouldn't just be the public
 * prod URL anyway (fine to hardcode, but the check is only meaningful
 * *after* a deploy has gone out, which is exactly the moment CI has already
 * finished). Run it by hand (or paste into a post-deploy checklist step)
 * right after `firebase deploy --only hosting`:
 *
 *   node scripts/check-security-headers.mjs
 *   node scripts/check-security-headers.mjs https://staging-url.web.app
 *
 * Exit code: 0 = every required header present with an acceptable value,
 * 1 = something is missing/wrong (see the printed detail).
 */

const DEFAULT_URL = 'https://echo-vault-app.web.app/';

const REQUIRED_HEADERS = [
  {
    name: 'content-security-policy',
    check: (value) => {
      if (!value) return 'missing';
      const mustContain = [
        "default-src 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        'connect-src',
        'firestore.googleapis.com',
        'identitytoolkit.googleapis.com',
      ];
      const missing = mustContain.filter((needle) => !value.includes(needle));
      return missing.length ? `missing directive fragment(s): ${missing.join(', ')}` : null;
    },
  },
  {
    name: 'referrer-policy',
    check: (value) => (value === 'strict-origin-when-cross-origin' ? null : `unexpected value: ${value}`),
  },
  {
    name: 'permissions-policy',
    check: (value) => {
      if (!value) return 'missing';
      const mustContain = ['camera=()', 'microphone=(self)', 'geolocation=(self)'];
      const missing = mustContain.filter((needle) => !value.includes(needle));
      return missing.length ? `missing directive(s): ${missing.join(', ')}` : null;
    },
  },
  {
    name: 'x-content-type-options',
    check: (value) => (value === 'nosniff' ? null : `unexpected value: ${value}`),
  },
  {
    name: 'x-frame-options',
    check: (value) => (value === 'DENY' ? null : `unexpected value: ${value}`),
  },
];

async function main() {
  const url = process.argv[2] || DEFAULT_URL;
  console.log(`[check-security-headers] Fetching ${url} ...`);

  let response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (error) {
    console.error(`[check-security-headers] Request failed: ${error.message}`);
    process.exit(1);
  }

  const problems = [];
  for (const { name, check } of REQUIRED_HEADERS) {
    const value = response.headers.get(name);
    const problem = check(value);
    if (problem) {
      problems.push(`  - ${name}: ${problem}`);
    } else {
      console.log(`[check-security-headers] OK   ${name}`);
    }
  }

  if (problems.length > 0) {
    console.error('[check-security-headers] FAILED — problems found:');
    console.error(problems.join('\n'));
    process.exit(1);
  }

  console.log('[check-security-headers] All required security headers present and well-formed.');
}

main().catch((error) => {
  console.error('[check-security-headers] Unexpected failure:', error);
  process.exit(1);
});
