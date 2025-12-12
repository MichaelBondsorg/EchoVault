# EchoVault Technical Debt Roadmap

*Code cleanup, architectural improvements, and non-feature work*

---

## Technical Debt User Stories

| Phase | Category | Item | User Story | Acceptance Criteria | Technical Implementation Notes |
|-------|----------|------|------------|---------------------|-------------------------------|
| **Phase 0: Critical Security** | Security | Rotate Exposed Firebase API Key | As a security-conscious developer, I want all API keys removed from source code so that credentials cannot be leaked from version control. | • Firebase API key rotated in console • All keys moved to environment variables • `.env.example` contains only placeholder values • No secrets in git history • Firebase App Check enabled | • Rotate key immediately in Firebase Console • Move config to `import.meta.env.VITE_*` variables • Update `.env.example` with placeholders only • Consider using git-filter-repo to scrub history • Enable App Check for additional protection |
| **Phase 0: Critical Security** | Security | Backend Proxy for AI APIs | As a security-conscious developer, I want AI API calls routed through a backend so that API keys are never exposed in browser network traffic. | • OpenAI/Gemini calls go through backend proxy • API keys stored server-side only • Rate limiting enforced at proxy level • Request logging enabled | • Create minimal Node.js/Express proxy OR use Firebase Cloud Functions • Endpoints: `/api/gemini`, `/api/openai`, `/api/transcribe` • Store keys in Firebase environment config • Add rate limiting middleware |
| **Phase 1: Code Organization** | Architecture | Extract Modal Components | As a developer, I want modal components extracted into separate files so that I can test, modify, and reuse them independently. | • 6+ modal components in `/src/components/modals/` • Each modal < 200 lines • Props documented with JSDoc • Zero functionality changes | • Extract: `CrisisSoftBlockModal`, `CrisisResourcesScreen`, `SafetyPlanScreen`, `DecompressionScreen`, `DailySummaryModal`, `ExportModal`, `InsightsPanel` • Create `/src/components/modals/index.js` barrel export • Update App.jsx imports |
| **Phase 1: Code Organization** | Architecture | Extract Input Components | As a developer, I want input/recording components extracted so that voice and text input logic is isolated and testable. | • Input components in `/src/components/input/` • `RecordingInput`, `TextInput`, `NewEntryButton` extracted • Recording state management encapsulated • Props interface documented | • Extract recording logic with `useRecording` hook • Create `RecordingInput.jsx` (~150 lines) • Create `TextInput.jsx` (~80 lines) • Move timer/waveform UI to separate components |
| **Phase 1: Code Organization** | Architecture | Extract Insight Components | As a developer, I want analysis/visualization components extracted so that mood heatmap and insights can be developed independently. | • Components in `/src/components/insights/` • `MoodHeatmap`, `JournalAssistant`, `VoiceConversation` extracted • Each component self-contained • Memoization applied | • Extract `MoodHeatmap.jsx` with React.memo • Extract `JournalAssistant.jsx` (~300 lines) • Extract `VoiceConversation.jsx` (~400 lines) • Create `MarkdownLite.jsx` as shared utility |
| **Phase 1: Code Organization** | Architecture | Create Shared Modal Wrapper | As a developer, I want a reusable Modal component so that modal styling is consistent and DRY. | • `Modal.jsx` wrapper component created • Handles backdrop, close behavior, animations • Used by all 6+ modals • Supports different sizes (sm, md, lg, xl) | • Create `/src/components/Modal.jsx` • Props: `isOpen`, `onClose`, `size`, `title`, `children` • Include backdrop click-to-close • Add Framer Motion enter/exit animations • Migrate existing modals to use wrapper |
| **Phase 1: Code Organization** | Architecture | Organize Folder Structure | As a developer, I want a clear folder structure so that I can find files predictably and onboard new developers easily. | • `/src/components/` with subdirectories • `/src/context/` for React Context • `/src/pages/` for top-level screens • `/src/types/` for TypeScript/JSDoc types • README documents structure | • Create: `components/`, `context/`, `pages/`, `types/`, `prompts/` • Move App.jsx content to appropriate locations • Create `/src/components/index.js` barrel exports • Add `ARCHITECTURE.md` documenting structure |
| **Phase 2: State Management** | Architecture | Implement Auth Context | As a developer, I want authentication state in React Context so that any component can access user info without prop drilling. | • `AuthContext` provides user, loading state • `useAuth()` hook for consuming • Auth listener in provider only • All components use context, not props | • Create `/src/context/AuthContext.jsx` • Move `onAuthStateChanged` listener to provider • Export `useAuth` hook • Update all components using `user` prop to use hook |
| **Phase 2: State Management** | Architecture | Implement Journal Context | As a developer, I want journal entries in React Context so that entries, category, and filters are accessible app-wide. | • `JournalContext` provides entries, category, filters • Firestore listener in provider • `useJournal()` hook for consuming • Entry CRUD operations exposed | • Create `/src/context/JournalContext.jsx` • Move Firestore `onSnapshot` to provider • Expose: `entries`, `category`, `setCategory`, `addEntry`, `updateEntry` • Remove entries prop drilling |
| **Phase 2: State Management** | Architecture | Implement Safety Context with Reducer | As a developer, I want safety state managed with useReducer so that crisis detection flows are predictable and testable. | • `SafetyContext` with reducer pattern • Actions: `SHOW_CRISIS_MODAL`, `SET_RISK_LEVEL`, etc. • State machine for crisis flow • Easily testable dispatch actions | • Create `/src/context/SafetyContext.jsx` • Define `safetyReducer` with typed actions • State: `{ showCrisisModal, riskLevel, userResponse, showResources }` • Replace useState calls with dispatch |
| **Phase 2: State Management** | Architecture | Reduce App.jsx to Router Only | As a developer, I want App.jsx to only handle routing/layout so that it's under 200 lines and easy to understand. | • App.jsx < 200 lines • Only contains: providers, router, layout • All features in separate components • No business logic in App.jsx | • Wrap app in context providers • Create `MainLayout.jsx` for header/navigation • Create `JournalView.jsx` for main content • Create `PromptScreen.jsx` for entry creation • App.jsx becomes pure composition |
| **Phase 3: Testing** | Quality | Set Up Testing Framework | As a developer, I want a testing framework installed so that I can write unit and integration tests. | • Vitest configured and working • React Testing Library installed • MSW for API mocking • `npm test` runs all tests • Coverage reporting enabled | • Install: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `msw` • Create `vitest.config.js` • Create `/src/test/setup.js` • Add test scripts to package.json |
| **Phase 3: Testing** | Quality | Unit Tests for Safety Module | As a developer, I want the crisis detection module fully tested so that safety-critical code is verified. | • 100% coverage on `/src/services/safety/` • Tests for keyword detection edge cases • Tests for longitudinal risk calculation • Tests for null/empty inputs | • Create `/src/services/safety/__tests__/index.test.js` • Test `checkCrisisKeywords` with various inputs • Test `checkLongitudinalRisk` with mock entries • Test `checkWarningIndicators` patterns |
| **Phase 3: Testing** | Quality | Unit Tests for AI Services | As a developer, I want AI service modules tested so that API error handling is verified. | • Tests for `gemini.js`, `openai.js`, `embeddings.js` • Mock API responses with MSW • Test retry logic • Test error code handling | • Create MSW handlers for Gemini/OpenAI endpoints • Test success responses • Test 429 rate limit handling • Test 500 server error + retry • Test malformed JSON responses |
| **Phase 3: Testing** | Quality | Unit Tests for Analysis Module | As a developer, I want analysis functions tested so that LLM response parsing is verified. | • Tests for JSON extraction from LLM • Tests for mood score validation • Tests for classification mapping • Edge cases covered | • Create `/src/services/analysis/__tests__/` • Test `parseLLMJson` utility (to be extracted) • Test classification with mock responses • Test mood analysis with various inputs |
| **Phase 3: Testing** | Quality | Component Tests for Critical UI | As a developer, I want critical UI components tested so that user-facing features work correctly. | • Tests for crisis modal flow • Tests for entry submission • Tests for export functionality • User interaction tests | • Test `CrisisSoftBlockModal` button behaviors • Test entry form submission flow • Test export date range selection • Use React Testing Library user events |
| **Phase 4: Error Handling** | Reliability | Create Centralized Error Types | As a developer, I want typed errors so that error handling is consistent and debuggable. | • `APIError` class with code, status, message • Error codes defined as constants • All services throw typed errors • Error context preserved | • Create `/src/errors/APIError.js` • Define error codes: `RATE_LIMIT`, `AUTH_ERROR`, `NETWORK_ERROR`, `PARSE_ERROR` • Update all services to throw `APIError` • Add error code to all catch blocks |
| **Phase 4: Error Handling** | Reliability | Add React Error Boundary | As a user, I want the app to gracefully handle crashes so that I don't lose my work when something fails. | • Error boundary wraps main content • Friendly error UI shown on crash • "Try again" button available • Error logged for debugging | • Create `/src/components/ErrorBoundary.jsx` • Show user-friendly error message • Include "Refresh" and "Report Issue" buttons • Log error to console/monitoring service |
| **Phase 4: Error Handling** | Reliability | Implement Retry Logic for All APIs | As a user, I want API calls to retry on failure so that temporary network issues don't break the app. | • All API calls retry on 5xx errors • Exponential backoff (1s, 2s, 4s) • Max 3 retries • User notified if all retries fail | • Install `p-retry` or implement custom • Wrap all fetch calls in retry logic • Add timeout handling (30s default) • Show toast notification on final failure |
| **Phase 4: Error Handling** | Reliability | Create Unified API Client | As a developer, I want a single API client so that all HTTP calls have consistent behavior. | • Single `apiClient` module • Handles auth headers • Handles retries • Handles timeouts • Request/response logging | • Create `/src/services/api/client.js` • Methods: `get`, `post`, `postForm` • Auto-add auth headers • Integrate retry logic • Add request ID for tracing |
| **Phase 5: Performance** | Performance | Memoize All Modal Components | As a user, I want the app to feel fast so that typing and interactions are responsive. | • All modals wrapped in `React.memo` • Handler functions use `useCallback` • Computed values use `useMemo` • No unnecessary re-renders | • Add `React.memo()` to all extracted components • Wrap `onClick`, `onClose` handlers in `useCallback` • Use React DevTools Profiler to verify • Target: <16ms render time |
| **Phase 5: Performance** | Performance | Implement Code Splitting | As a user, I want the app to load quickly so that I can start journaling without waiting. | • Modals lazy-loaded with `React.lazy` • Route-based code splitting • Initial bundle < 200KB gzipped • Loading states shown | • Use `React.lazy` + `Suspense` for modals • Create loading spinner component • Split: ExportModal, VoiceConversation, SafetyPlanScreen • Add bundle analyzer to verify |
| **Phase 5: Performance** | Performance | Debounce Expensive Operations | As a user, I want smooth typing so that the app doesn't lag during input. | • Chat input debounced 300ms • Search input debounced 300ms • Embedding generation debounced • No redundant API calls | • Create `/src/hooks/useDebounce.js` • Apply to chat message input • Apply to search queries • Cancel pending requests on new input |
| **Phase 5: Performance** | Performance | Optimize Firestore Listeners | As a developer, I want efficient Firestore usage so that the app scales with many entries. | • Limit initial load to 100 entries • Paginate older entries on scroll • Differential updates (not full reload) • Unsubscribe on unmount | • Add pagination to entries query • Implement infinite scroll • Use `docChanges()` for differential updates • Add cleanup in useEffect return |
| **Phase 6: Developer Experience** | DX | Add ESLint Configuration | As a developer, I want linting so that code style is consistent and bugs are caught early. | • ESLint configured with React rules • Pre-commit hook runs lint • CI fails on lint errors • No lint warnings in codebase | • Install: `eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks` • Create `.eslintrc.cjs` with recommended rules • Add `lint` and `lint:fix` scripts • Fix all existing violations |
| **Phase 6: Developer Experience** | DX | Add Prettier Configuration | As a developer, I want auto-formatting so that code style debates are eliminated. | • Prettier configured • Format on save in VS Code • Pre-commit hook formats • CI checks formatting | • Install: `prettier`, `eslint-config-prettier` • Create `.prettierrc` • Add `format` and `format:check` scripts • Add VS Code settings recommendation |
| **Phase 6: Developer Experience** | DX | Add JSDoc Type Annotations | As a developer, I want type documentation so that I understand function contracts without reading implementation. | • All service functions have JSDoc • Prop types documented • Return types documented • IDE autocomplete works | • Add JSDoc to all `/src/services/` functions • Document all component props • Add `@typedef` for complex objects • Enable `checkJs` in jsconfig.json |
| **Phase 6: Developer Experience** | DX | Create Architecture Documentation | As a new developer, I want architecture docs so that I can understand the codebase quickly. | • `ARCHITECTURE.md` explains structure • Component diagram included • Data flow documented • API contracts documented | • Create `/docs/ARCHITECTURE.md` • Document folder structure and conventions • Add Mermaid diagrams for data flow • Document Context API usage • Add component relationship diagram |
| **Phase 7: CI/CD** | DevOps | Expand CI Pipeline | As a developer, I want CI to run tests and checks so that bugs are caught before merge. | • CI runs on all PRs • Lint check passes • Tests pass with >80% coverage • Build succeeds • Security scan passes | • Update `.github/workflows/ci.yml` • Add jobs: lint, test, build, security • Fail PR if any check fails • Add status badges to README |
| **Phase 7: CI/CD** | DevOps | Add Bundle Size Monitoring | As a developer, I want bundle size tracked so that I know when changes increase app size. | • Bundle size reported on each PR • Warning if size increases >5% • Historical tracking • Breakdown by chunk | • Install `vite-bundle-visualizer` • Add size limit configuration • Report size in PR comments • Track size over time |
| **Phase 7: CI/CD** | DevOps | Add Dependency Security Scanning | As a developer, I want dependencies scanned so that vulnerable packages are detected. | • npm audit runs in CI • Snyk or similar scans PRs • High/critical vulnerabilities block merge • Weekly automated scans | • Add `npm audit` to CI • Consider Snyk GitHub integration • Configure severity thresholds • Set up Dependabot for updates |
| **Phase 8: Future** | Architecture | Migrate to TypeScript | As a developer, I want TypeScript so that I have compile-time type checking and better refactoring support. | • All files converted to .tsx/.ts • Strict mode enabled • No `any` types • Full IDE IntelliSense | • Install TypeScript and types • Start with `/src/types/` definitions • Convert services first, then components • Enable strict mode incrementally |
| **Phase 8: Future** | Architecture | Extract Prompts to Config | As a developer, I want LLM prompts in separate files so that they can be versioned, tested, and A/B tested. | • All system prompts in `/src/prompts/` • Prompt builders are pure functions • Prompts versioned • Easy to modify without code changes | • Create `/src/prompts/` directory • Extract: `journalAssistant.js`, `analysis.js`, `classification.js` • Use template literals with variable injection • Add prompt unit tests |
| **Phase 8: Future** | Performance | Implement Vector Database | As a developer, I want vector search in a proper DB so that RAG scales beyond 1000 entries. | • Embeddings stored in Pinecone/Weaviate • Similarity search < 100ms • No in-memory embedding storage • Scales to 10K+ entries | • Choose: Pinecone (managed) or Weaviate (self-host) • Create embedding ingestion pipeline • Update RAG to query vector DB • Remove in-memory similarity calculation |
| **Phase 8: Future** | Reliability | Add Offline Support | As a user, I want to journal offline so that I can use the app without internet. | • Entries saved locally when offline • Sync when connection restored • Offline indicator shown • No data loss | • Implement Service Worker with Workbox • Cache entries in IndexedDB • Queue writes when offline • Sync on reconnection • Show offline/syncing status |

---

## Priority Summary

### 🔴 Phase 0: Critical Security (Do Immediately)
- Rotate exposed Firebase API key
- Create backend proxy for AI APIs

### 🟠 Phase 1: Code Organization (Week 1-2)
- Extract 6+ modal components
- Extract input/recording components
- Extract insight/visualization components
- Create shared Modal wrapper
- Organize folder structure

### 🟡 Phase 2: State Management (Week 2-3)
- Implement AuthContext
- Implement JournalContext
- Implement SafetyContext with reducer
- Reduce App.jsx to router only

### 🟢 Phase 3: Testing (Week 3-4)
- Set up Vitest + RTL + MSW
- Unit tests for safety module (100% coverage)
- Unit tests for AI services
- Unit tests for analysis module
- Component tests for critical UI

### 🔵 Phase 4: Error Handling (Week 4-5)
- Create centralized error types
- Add React Error Boundary
- Implement retry logic for all APIs
- Create unified API client

### 🟣 Phase 5: Performance (Week 5-6)
- Memoize all modal components
- Implement code splitting
- Debounce expensive operations
- Optimize Firestore listeners

### ⚪ Phase 6: Developer Experience (Week 6-7)
- Add ESLint configuration
- Add Prettier configuration
- Add JSDoc type annotations
- Create architecture documentation

### ⬛ Phase 7: CI/CD (Week 7-8)
- Expand CI pipeline
- Add bundle size monitoring
- Add dependency security scanning

### 🔲 Phase 8: Future
- Migrate to TypeScript
- Extract prompts to config
- Implement Vector Database
- Add offline support

---

## Quick Wins (< 1 Day Each)

| Item | Effort | Impact |
|------|--------|--------|
| Rotate Firebase API key | 30 min | Critical |
| Add `.env.example` placeholders | 15 min | High |
| Install ESLint + basic config | 1 hr | Medium |
| Install Prettier + config | 30 min | Medium |
| Add Error Boundary wrapper | 2 hr | High |
| Create Modal wrapper component | 2 hr | Medium |
| Add `useDebounce` hook | 1 hr | Medium |

---

## Metrics to Track

| Metric | Current | Target |
|--------|---------|--------|
| App.jsx lines | 3,055 | < 200 |
| useState hooks in App.jsx | 52 | 0 |
| Test coverage | 0% | > 80% |
| Bundle size (gzipped) | ~200KB | < 150KB |
| Largest component | 3,055 lines | < 300 lines |
| ESLint errors | Unknown | 0 |
| TypeScript coverage | 0% | 100% |
| API keys in code | 1 | 0 |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Security breach from exposed key | High | Critical | Rotate immediately, enable App Check |
| Regression bugs during refactor | Medium | High | Add tests before refactoring |
| Performance degradation | Low | Medium | Profile before/after changes |
| Developer velocity drop | Medium | Medium | Document architecture, pair program |
