# Cloud Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax. Authoritative design source: `docs/design/cloud/CLOUD-DESIGN-SPEC.md` (spec §N references below) + reference mockups `docs/design/cloud/engram-redesign-mockups.dc.html` (grep by screen name; file's tail is truncated). This plan deliberately references the spec instead of inlining pixel values — the spec is the single source of truth; implementers read the relevant § before coding.

**Goal:** Complete the Hearthside → Cloud visual migration on branch `redesign/cloud` (base: main @5182982, which already contains `src/styles/cloud-tokens.css`, `cloud-motion.css`, partial bridge).

**Architecture:** Extend the existing Cloud token layer to full spec; add self-hosted fonts (privacy rule: no Google Fonts — enforced by `src/utils/__tests__/fontLoading.test.js`, keep that invariant, bundle via @fontsource instead); build the accent switcher; add a minimal shadcn-style primitive kit (`src/components/cloud/`) on Radix+vaul with a `cn()` util, coexisting with the legacy `src/components/ui/` during migration; then migrate screens per spec §7; replace legacy palette-lint tests with a migration ratchet.

**Global constraints:**
- Never touch `src/services/safety/` logic or crisis keyword data; crisis SCREEN restyling is allowed (spec §7 "Never red/alarming") with copy exactly per spec.
- `index.html` must never load remote fonts (privacy invariant).
- Every migrated file: zero `honey|terra|sage|lavender|hearth|warm|amber|mood-\d` Tailwind classes, zero raw hex in JSX styling (CSS vars only).
- `prefers-reduced-motion` + the "Background motion" toggle gate ALL ambient animation (spec §1, §6.1).
- Dark mode is first-class: every task verifies both themes ×3 accents.
- Min hit targets 44px.
- `npm test` + `npm run build` green at every commit; commit per task.

## Phase A — Foundation & guardrails
- **A1 Fonts**: add `@fontsource/geist-sans` (400/500/600/700) + `@fontsource/newsreader` (400/500/600 + italics) npm deps; import in `src/index.css`; update `fontLoading.test.js` to keep forbidding remote fonts AND assert the fontsource imports exist. Verify Newsreader/Geist actually render (build output includes woff2).
- **A2 Tokens to full spec**: reconcile `src/styles/cloud-tokens.css` against spec §2–§3 exactly (add missing `--divider`, `--faint`, `--accent-1..4`, `--accent-d1..d4`, `--accent-wash-dark`, `--accent-wave-dark`; verify hex parity); wire semantic Tailwind colors (`background,card,border,divider,foreground,secondary-foreground,muted-foreground,faint,primary,destructive,accent,accent-deep,accent-wash` → `var(--*)`) in `tailwind.config.js` so `bg-card`/`text-muted-foreground` etc. work; complete `cloud-motion.css` keyframes per §6.4 with reduced-motion guards.
- **A3 Accent switcher**: `src/utils/accent.js` (init/get/set, `data-accent` on documentElement, localStorage `engram-accent`, default `blue`) mirroring `darkMode.js` conventions + tests; init at startup next to dark-mode init.
- **A4 Cloud primitive kit**: deps `clsx tailwind-merge @radix-ui/react-dialog @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-checkbox vaul`; `src/lib/cn.js`; components in `src/components/cloud/`: `Card`, `Button` (primary/outline pill per §5), `Switch`, `Tabs` (pill segment), `Chip`, `Drawer` (vaul, radius-24 top, 36×4 handle), `Dialog` (radius 22), `Checkbox`, `SectionLabel` (§4 label row). Render tests for each (both themes).
- **A5 Lint ratchet**: DELETE `hearthside-palette` tests + `coreFeaturesPalette` + `InsightsPage.palette` + `colorMap`-string sweeps that enforce legacy classes; ADD `src/utils/__tests__/cloudMigration.test.js`: a `MIGRATED` file list — every listed file must pass the migrated-file constraints above; a `LEGACY_ALLOWLIST` for everything else (shrinks per task; ratchet asserts the allowlist only ever shrinks via a committed count). Update `cssComponents.test.js`/`tailwindTokens.test.js` to Cloud reality.

## Phase B — Signature components (spec §6, all in `src/components/cloud/`)
- **B1 `LinenWaveBackground`**: §6.1 exactly (gradient canvas, feTurbulence grain w/ explicit background-size, 2400px wave layer, 11/15/19s alternate); mounted once in `AppLayout` behind pages; gated by new `backgroundMotion` pref (uiStore + localStorage + Settings toggle later) and `prefers-reduced-motion`.
- **B2 `Pebble`**: §6.3 — `<Pebble state size />`, 6 states, CSS-only blob, accent-aware, dark variant, empathy-brow rule (inner ends UP), reduced-motion = static. Tests: renders each state, correct class per state.
- **B3 `RisingTide`**: §6.2 stat-card widget. Plus `Equalizer` (12-bar, staggered `eq`) and `Confetti` pips (rise) helpers for later screens.

## Phase C — Shell & core screens (spec §7 + mockups; migrate = restyle in place, add file to MIGRATED list)
- **C1 Shell**: `BottomNavbar` → 5-item tab bar w/ raised 48px center `+` (`--primary` light / `--accent-btn` dark), active = accent; `TopBar`; `AppLayout` canvas hosts `LinenWaveBackground`.
- **C2 Home**: `HomePage` + zen widgets reskin to §7-Home composition (serif greeting, Reflect card w/ Write+Speak, 3 stat cells incl `RisingTide`, mood-trend bar card, Recent list). Keep `useDashboardLayout` machinery; reskin the default widgets rather than removing customization.
- **C3 New entry**: `EntryComposer` → cloud `Drawer` with §7-New-entry details (context chip, 15px/1.65 editor, blinking accent caret, mic + Aa, Save pill).
- **C4 Journal**: `JournalPage` day-grouped cards, mood dots, meta line format.
- **C5 Insights**: `InsightsPage` top-level restyle (Week/Month `Tabs`, trend bars accent scale, tide+streak cells, Patterns card). File is 1906 lines — restyle sections, do NOT refactor logic.
- **C6 Settings**: `SettingsPage` grouped Cards + section labels; APP section gains Accent swatch row (22px circles, ring), Dark mode `Switch`, **Background motion** `Switch`.

## Phase D — Conversational & wellness screens
- **D1 AI chat**: `UnifiedConversation` bubbles/chips/input per §7-AI-chat (companion = white card radius 16/6, user = accent-deep, "here with you" subtitle).
- **D2 Voice session**: `RealtimeConversation` — listening Pebble, LISTENING caps, `Equalizer`, transcript styles, control row per §7.
- **D3 Safety screens**: `CrisisResourcesScreen` (empathy Pebble, serif headline, 988 accent-deep card, never red) + `SafetyPlanScreen` + `CrisisSoftBlockModal` restyle. Copy verbatim from spec; behavior untouched.
- **D4 Wellness + modals**: `DecompressionScreen`/`BreathingExercise`/`GroundingExercise` (resting Pebble, slow motion), `QuickLogModal` → `Dialog`, `DaySummaryModal` + `EntryInsightsPopup` → `Drawer`, `SanctuaryWalkthrough` welcome (calm Pebble), NEW `StreakCelebration` full-screen post-save per §7 (celebrating Pebble, serif headline, dot tracker, Keep-going CTA, therapist share link) wired where `celebrate()` fires today.

## Phase E — Native salvage + wrap
- **E1 Widget port**: re-add `EngramWidget` WidgetKit target onto this branch's pbxproj via the scripted approach (npm `xcode` pkg — see `.superpowers/sdd/` history; node-xcode's addTarget auto-creates the embed phase, do NOT add a second one); `widgetURL` → `engram://new-entry?mode=record`; Info.plist + settings identical to the superseded branch (`feat/instant-capture-ios` has all files to copy).
- **E2 Wrap**: What's New bump (Cloud redesign entry), PROJECT_STATUS decisions, migration ratchet shows all Phase C/D files MIGRATED, full suite + build green, device build + install.

**Execution notes:** per-task implementer (sonnet) + reviewer gates as established; reviewers verify against spec § text, both themes, and the ratchet. InsightsPage (C5) and UnifiedConversation (D1) are the two largest/riskiest files — extra care, no logic changes.
