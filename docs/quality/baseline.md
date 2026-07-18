# Quality baseline

Recorded on 2026-07-18 at commit `7c009c24787a66d912b83e91c1c36c4ea67cce5a` before implementation changes.

## Passing checks

- Root Vitest: 51 files, 709 tests passed.
- Root production build: passed.
- Relay Vitest: 3 files, 39 tests passed.
- Relay typecheck: passed.
- Relay build: passed.

## Bundle baseline

- Main JavaScript: 690.98 kB minified / 189.82 kB gzip.
- Main CSS: 1,238.82 kB minified / 100.11 kB gzip.
- Firebase vendor: 485.36 kB minified / 112.44 kB gzip.

## Production dependency audit baseline

- Root: 16 vulnerabilities (10 moderate, 4 high, 2 critical).
- Functions: 21 vulnerabilities (1 low, 13 moderate, 4 high, 3 critical).
- Relay: 21 vulnerabilities (1 low, 12 moderate, 5 high, 3 critical).

## Known baseline gaps

- Firestore emulator rules suite is excluded from the normal Vitest include list.
- CI contains `npm ci || npm install` fallbacks.
- Relay deploy does not run tests/typecheck/build or candidate health checks.
- Production bundle warns that mixed static/dynamic imports prevent intended code splitting.
- Initial JS/CSS exceed the approved PRD budgets.
