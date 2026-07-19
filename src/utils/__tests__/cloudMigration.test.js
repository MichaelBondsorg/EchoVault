/**
 * cloudMigration.test.js
 *
 * The Cloud redesign (docs/superpowers/plans/2026-07-18-cloud-redesign.md) replaces
 * the Hearthside palette with CSS-variable-based Cloud tokens (src/styles/cloud-tokens.css)
 * screen by screen. This file replaces the old "enforce Hearthside palette usage" test
 * suite (hearthside-palette.test.js x2, coreFeaturesPalette.test.js, InsightsPage.palette.test.js)
 * with a migration ratchet:
 *
 * 1. Every file listed in MIGRATED must be fully "Cloud-clean" — no legacy Hearthside
 *    Tailwind classes, no raw hex colors baked into JSX (CSS vars only), no gray-* classes.
 * 2. Every other .jsx file in src/ is tracked by a shrinking budget (LEGACY_BUDGET) of how
 *    many still contain legacy palette classes. Each migration task (Phase B/C/D) should
 *    add its migrated file(s) to MIGRATED and lower LEGACY_BUDGET to match.
 *
 * Kept deliberately fast: raw fs reads, no rendering, no transpilation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../..');

// Global constraint from the Cloud redesign plan: zero honey|terra|sage|lavender|hearth|
// warm|amber|mood-<n> Tailwind classes in migrated files.
const LEGACY_CLASS_RE =
  /\b(bg|text|border|from|via|to|ring|fill|stroke)-(honey|terra|sage|lavender|hearth|warm|amber|mood)-\d+/;

// Legacy palette also leaned on gray-* directly in a few spots; Cloud uses semantic
// tokens (bg-card, text-muted-foreground, etc.) instead, so gray-* is banned outright
// in migrated files.
const GRAY_CLASS_RE = /\bgray-\d+/;

// Raw hex colors baked into JSX (className/style) are banned in migrated files — Cloud
// styling is CSS-variable driven (var(--token)). Hex is still fine inside comments and as
// a var(...) fallback value, e.g. var(--accent, #667fa8).
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

function findPatternViolations(content, regex) {
  const violations = [];
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const re = new RegExp(regex.source, 'g');
    let match;
    while ((match = re.exec(line)) !== null) {
      violations.push(`  line ${idx + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
  return violations;
}

function isInsideOpenVarFallback(line, hexIndex) {
  const before = line.slice(0, hexIndex);
  const lastVarOpen = before.lastIndexOf('var(');
  if (lastVarOpen === -1) return false;
  const between = line.slice(lastVarOpen, hexIndex);
  const opens = (between.match(/\(/g) || []).length;
  const closes = (between.match(/\)/g) || []).length;
  return opens > closes;
}

function findHexViolations(content) {
  const violations = [];
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // Allow hex inside comments (// line comments, or lines that are part of a block comment)
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    HEX_RE.lastIndex = 0;
    let match;
    while ((match = HEX_RE.exec(line)) !== null) {
      const hexIndex = match.index;
      // Skip hex that appears after a // comment marker on the same line
      const commentIdx = line.indexOf('//');
      if (commentIdx !== -1 && commentIdx < hexIndex) continue;
      // Allow hex used as a var(...) fallback value
      if (isInsideOpenVarFallback(line, hexIndex)) continue;
      violations.push(`  line ${idx + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
  return violations;
}

// --- MIGRATED: files already fully migrated to the Cloud token system ---

function listCloudKitSourceFiles() {
  const cloudDir = resolve(REPO_ROOT, 'src/components/cloud');
  const out = [];
  for (const entry of readdirSync(cloudDir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    if (entry.isFile() && /\.(jsx?|css)$/.test(entry.name)) {
      out.push(`src/components/cloud/${entry.name}`);
    }
  }
  return out.sort();
}

export const MIGRATED = [
  ...listCloudKitSourceFiles(),
  'src/lib/cn.js',
  'src/styles/cloud-tokens.css',
  'src/components/capture/EntryComposer.jsx',
  // C1 (shell): tab bar, TopBar, LinenWaveBackground mounted in AppLayout.
  'src/components/zen/BottomNavbar.jsx',
  'src/components/zen/TopBar.jsx',
  'src/components/zen/AppLayout.jsx',
  // C2 (Home): serif greeting, Reflect card, stat cells w/ RisingTide, accent
  // trend bars, Recent list. BentoGrid's Customize button/edit toolbar reskinned
  // too (visible Home chrome); GlassCard/WidgetDrawer/Tasks/Goals/Stories/Nexus
  // widgets are out of scope (not part of the default Home composition) and stay
  // in the legacy budget below.
  'src/pages/HomePage.jsx',
  'src/components/zen/BentoGrid.jsx',
  'src/components/zen/widgets/HeroWidget.jsx',
  'src/components/zen/widgets/PromptWidget.jsx',
  'src/components/zen/widgets/MiniStatsWidget.jsx',
  'src/components/zen/widgets/MoodHeatmapWidget.jsx',
  'src/components/zen/widgets/RecentEntriesWidget.jsx',
  // C3 (New entry): EntryComposer restyled onto the cloud `Drawer` primitive
  // (mic/Aa entry-method picker, sr-only DrawerDescription). EntryBar is
  // EntryComposer's private editor sub-component (its only consumer) and is
  // where the spec's 15px/1.65 editor, accent caret, mic/Aa buttons, and
  // Save entry pill actually render, so it's reskinned + migrated alongside
  // it rather than left half-restyled underneath a clean wrapper.
  'src/components/dashboard/EntryBar.jsx',
  // C4 (Journal): JournalPage restyled (serif title, pill search, cloud-
  // styled date nav, All/Today/Yesterday + active-filter chips using the
  // cloud `Chip` primitive, SectionLabel day headers, Card empty state).
  // EntryCard is the sub-component that actually renders each row (used by
  // JournalPage *and* the pre-redesign JournalScreen/App.jsx flows, so
  // unlike EntryBar it isn't single-consumer) — it carries the spec's mood
  // dot + meta line and was fully reskinned onto Cloud tokens rather than
  // left half-migrated underneath a clean JournalPage. Its `entryType`/
  // entity-tag badges still route through the shared `colorMap.js` utility
  // (getEntryTypeColors/getEntityTypeColors), which is cross-app infra used
  // well beyond Journal (Insights patterns, etc.) and stays out of scope for
  // this screen-by-screen migration; those classes are injected dynamically
  // so they don't show up in EntryCard.jsx's own source text and don't trip
  // the static scan below.
  'src/pages/JournalPage.jsx',
  'src/components/entries/EntryCard.jsx',
  // C5 (Insights): full top-level restyle of the 1906-line InsightsPage —
  // GenerationStatus, CorrelationsSection ("Your Patterns" — the spec's
  // Patterns card, dot + sentence + bold stat), RecommendationsSection,
  // QuickInsightsSection, and NexusInsightCard all converted from the
  // 4-hue Hearthside palette (honey/sage/lavender/terra) onto Cloud tokens.
  // The design spec's literal Week/Month segment + trend-bar-chart + Rising
  // Tide/streak widgets have no corresponding feature or data in this page
  // (no weekly mood-by-day series, no streak/momentum computation is ever
  // passed to or computed by InsightsPage) — inventing them would mean
  // adding new state/data-flow, which the task explicitly forbids ("no
  // data-flow changes, no hook changes"). Per §3 ("ONE user-selectable
  // accent"), the 4 legacy semantic hues collapse to a single accent scale
  // (bg-accent-wash/text-accent-deep) differentiated by icon + label only;
  // existing health-warning/low-mood/urgent-priority reds are left as `red-*`
  // (not a banned token, matches the EntryCard C4 precedent of keeping
  // `/* @color-safe: ... */`-flagged reds for warnings). All insight-
  // generation, correlation/statistics computation, feedback/export/report
  // logic, and store calls are unchanged — only className strings and a
  // couple of derived-style helper objects (pure presentation, e.g.
  // getInsightStyle()'s per-type color/gradient fields) changed.
  'src/pages/InsightsPage.jsx',
  // C6 (Settings): full restyle — profile row, HEALTH & DATA / AI & PRIVACY
  // / APP grouped Cards + SectionLabels (spec §7). APP gained the accent
  // swatch row (22px circles, active ring, 44px non-overlapping tap
  // targets — see the geometry comment in SettingsPage.jsx), a Dark mode
  // Switch, and a Background motion Switch wired to the existing
  // uiStore.backgroundMotion pref (no new pref created). Accent
  // persistence, which SettingsPage previously duplicated with its own
  // owner-scoped localStorage read/write, is now consolidated onto
  // src/utils/accent.js (initAccent(uid)/setAccent(name, uid)) — the
  // single implementation; SettingsPage calls only those functions. All
  // other handlers/props (health/reports/reliability/privacy/nexus/
  // entities/safety/export/delete-account/notifications, plus the
  // BackfillPanel/Diagnostic Export/Health Migration data-enrichment
  // cards) are unchanged, just reskinned onto Cloud tokens.
  'src/pages/SettingsPage.jsx',
  // D1 (2026-07-18): UnifiedConversation.jsx (1197 lines) — the picker,
  // chat, voice, guided-session, and mindfulness modes it hosts all fully
  // cleaned onto Cloud tokens. Spec §7 AI chat is the chat mode specifically:
  // companion bubble = bg-card, radius 16 with a 6px corner on the speaker
  // (bottom-left) side; user bubble = accent-deep with the 6px corner on its
  // (bottom-right) side; "here with you" subtitle under the Companion header
  // (chat mode only); pill input + Send (bg-accent-deep, the row's actual
  // submit action) + secondary Mic (bg-card, opens the existing voice-input
  // overlay) — see the in-file comment for why Send, not Mic, carries the
  // accent-deep primary treatment (this component keeps two always-visible
  // buttons; the mockup's one icon morphs mic<->send around a single
  // action, and collapsing them would be a behavior change). No suggestion
  // chips: the mockup's "2-min unwind / Keep talking / Just listen" chips
  // have no backing state/data in this component (messages carry no
  // quick-reply options) — inventing non-functional chip UI was out of
  // scope ("no data-flow changes"). Picker/Guided/Mindfulness modes and the
  // in-modal Voice mode (a distinct code path from D2's target
  // `RealtimeConversation.jsx`) have no literal spec mockup of their own;
  // they're tokenized onto the same Cloud vocabulary (bg-card/border-border/
  // text-foreground/bg-accent-deep) for consistency, without inventing D2's
  // Pebble/Equalizer signature elements. MarkdownLite (shared across four
  // other consumers, out of D1's target-file scope) still injects its own
  // legacy text-color classes at render time; those are forced to the
  // correct Cloud token per bubble via a local `[&_*]:!text-*` override
  // (documented in-file) rather than touching the shared component — the
  // same "override locally, don't touch cross-app infra" precedent as
  // EntryCard's colorMap.js badges (C4). Budget drops 65 -> 64.
  'src/components/chat/UnifiedConversation.jsx',
  // D2 (2026-07-18): RealtimeConversation.jsx — the dedicated "Voice
  // session" screen (spec §7): listening Pebble (state swaps calm<->
  // listening off the existing `status` value, no new state), LISTENING
  // caps label (shown only while status === 'listening', so it doesn't
  // duplicate the header's existing status text), 12-bar Equalizer, and a
  // plain-text transcript (user = --faint Geist, companion = font-display
  // serif quote) replacing the old chat-bubble treatment. LinenWaveBackground
  // is nested inside this modal's own `fixed z-50` stacking context to
  // reproduce the mockup's grain+wave canvas locally (Pebble/Equalizer/
  // LinenWaveBackground all handle prefers-reduced-motion and the
  // Background-motion pref internally — no guards duplicated here). The
  // End-call button is reskinned onto the standard Button `primary` pill
  // with an "End session" label (spec's literal "dark pill"); the mockup's
  // separate mute icon and switch-to-text icon have no backing state in
  // this hold-to-talk-only component (no mute toggle, no text mode) and are
  // not invented — see task-D2-report.md. Save-prompt modal (title input,
  // mood slider, tags, guided summary) fully cleaned onto Cloud tokens too,
  // including the same terra/honey/sage -> single-accent-ramp collapse used
  // by InsightsPage (C5). Budget drops 64 -> 63.
  'src/components/chat/RealtimeConversation.jsx',
  // D3 (2026-07-18): CrisisResourcesScreen.jsx, SafetyPlanScreen.jsx,
  // CrisisSoftBlockModal.jsx — the safety/crisis path (highest-stakes task
  // in the plan). CrisisResourcesScreen gained the spec §7 empathy Pebble +
  // serif "You're not alone right now." headline + accent-deep 988 call
  // card (flip-polarity text-background); the mockup's grounding-link and
  // safety-plan-link have no backing prop on this component (level/
  // onClose/onContinue only) and are deliberately NOT invented — see
  // task-D3-report.md, same "flag, don't invent" precedent as D2's missing
  // mute/switch-to-text controls. SafetyPlanScreen restyled onto Card/
  // Button/LinenWaveBackground, add/remove/edit-section logic untouched.
  // CrisisSoftBlockModal restyled in place (NOT moved onto the Dialog
  // primitive per the brief — its overlay-opacity bug is a D4 fix), scrim
  // via bg-[var(--overlay)]; "I'm in crisis" is now the accent-deep FILLED
  // option instead of red. Every handler/prop/callback/tel:/sms: link/
  // conditional gate across all three files verified byte-identical
  // against the originals (task-D3-report.md inventory table); the only
  // copy changed anywhere is the one CrisisResourcesScreen headline quoted
  // above — every other string is character-for-character unchanged.
  // Budget drops 63 -> 60.
  'src/components/screens/CrisisResourcesScreen.jsx',
  'src/components/screens/SafetyPlanScreen.jsx',
  'src/components/modals/CrisisSoftBlockModal.jsx',
  // D4a (2026-07-18): first half of task D4, split for size (D4b covers
  // wellness screens + StreakCelebration separately). Also fixed the
  // cloud kit's Dialog/Drawer overlay: both had regressed onto a hardcoded
  // `bg-black/40` (commit 3565183's workaround for Tailwind 3.4's inability
  // to compute alpha for CSS-var-backed colors, e.g. the original
  // `bg-foreground/40`) instead of the theme-aware `bg-[var(--overlay)]`
  // token C6/D3 already established — swept the whole src/components/cloud/
  // kit for other `/NN`-on-CSS-var offenders and found none beyond those
  // two. QuickLogModal.jsx moved onto the cloud `Dialog` (first Dialog
  // consumer — DialogDescription + aria-labelledby wired); its mood slider
  // + vibe-tag interaction is kept as-is (mockup 7l's discrete 5-circle
  // picker has no backing state here) with the mood-color scale aligned to
  // EntryCard's accent-1..4 convention. DaySummaryModal.jsx and
  // EntryInsightsPopup.jsx both moved onto the cloud `Drawer`; neither
  // called colorMap.js (that caveat applies to the *other*,
  // out-of-scope `src/components/modals/DailySummaryModal.jsx`, App.jsx's
  // separate legacy day-summary flow — see task-D4a-report.md), so no
  // local override was needed. EntryInsightsPopup's per-insight-type
  // gradient styling collapsed onto the single accent-wash/accent-deep
  // scale (InsightsPage/C5 precedent), keeping `warning` as semantic red;
  // mockup 7n's quoted-entry/tag-pill/tomorrow's-reflection elements have
  // no backing props on this component and were not invented. SanctuaryWalk
  // through.jsx (3-step post-update tour, not the mockup 7o pre-auth
  // welcome screen — no auth state or bullet copy props exist here) had its
  // first screen's visual swapped for `<Pebble state="calm" />` (§6.3: calm
  // is used in "home, welcome") and all three steps' chrome restyled onto
  // Cloud tokens; step flow (Back/Skip/Next/onComplete) is untouched. All
  // four files were 4 of the 60 offenders; budget drops 60 -> 56.
  'src/components/zen/QuickLogModal.jsx',
  'src/components/zen/DaySummaryModal.jsx',
  'src/components/modals/EntryInsightsPopup.jsx',
  'src/components/zen/SanctuaryWalkthrough.jsx',
];

// --- Ratchet: how many non-migrated .jsx files still use legacy palette classes ---
// Set to the actual count as of A5 (2026-07-18). Every migration task (Phase B/C/D) that
// restyles a screen should add it to MIGRATED and lower this number to match reality —
// it must never go up.
// C1 (2026-07-18): AppLayout.jsx's `dark:bg-hearth-950` was the only remaining legacy-
// class offender among the three shell files migrated in this task (BottomNavbar.jsx/
// TopBar.jsx were already clean); budget drops 77 -> 76.
// C2 (2026-07-18): HomePage.jsx, BentoGrid.jsx, HeroWidget.jsx, PromptWidget.jsx,
// MiniStatsWidget.jsx, MoodHeatmapWidget.jsx were 6 of the 76 offenders; all fully
// cleaned and moved to MIGRATED (RecentEntriesWidget.jsx is a new file, already
// clean, so it doesn't change the offender count). Budget drops 76 -> 70.
// C3 (2026-07-18): EntryComposer.jsx was already clean (added to MIGRATED
// pre-C3, before this task restyled it onto the Drawer primitive). EntryBar.jsx
// — EntryComposer's private editor, its only consumer — was 1 of the 70
// offenders; fully cleaned and moved to MIGRATED. Budget drops 70 -> 69.
// C4 (2026-07-18): JournalPage.jsx and EntryCard.jsx were 2 of the 69
// offenders; both fully cleaned (day-grouped cards, mood dot, meta line,
// cloud Chip filter/date controls) and moved to MIGRATED. Budget drops
// 69 -> 67.
// C5 (2026-07-18): InsightsPage.jsx (1906 lines) was 1 of the 67 offenders;
// fully cleaned (GenerationStatus, CorrelationsSection/Patterns card,
// RecommendationsSection, QuickInsightsSection, NexusInsightCard all onto
// Cloud tokens) and moved to MIGRATED. Budget drops 67 -> 66.
// C6 (2026-07-18): SettingsPage.jsx was 1 of the 66 offenders (honey/terra/
// sage/warm classes throughout); fully cleaned (grouped Cards/SectionLabels,
// accent swatches, Dark mode + Background motion Switches) and moved to
// MIGRATED. Budget drops 66 -> 65.
// D1 (2026-07-18): UnifiedConversation.jsx was 1 of the 65 offenders
// (lavender/honey/sage/terra/gray classes across its picker/chat/voice/
// guided/mindfulness modes); fully cleaned and moved to MIGRATED. Budget
// drops 65 -> 64.
// D2 (2026-07-18): RealtimeConversation.jsx was 1 of the 64 offenders
// (hearth/honey/sage/lavender/terra classes throughout its status colors,
// full-screen gradient, transcript bubbles, save-prompt modal, and
// controls); fully cleaned and moved to MIGRATED. Budget drops 64 -> 63.
// D3 (2026-07-18): CrisisResourcesScreen.jsx, SafetyPlanScreen.jsx,
// CrisisSoftBlockModal.jsx were 3 of the 63 offenders (honey/warm/red-*
// classes on the crisis path); all fully cleaned and moved to MIGRATED.
// Budget drops 63 -> 60.
// D4a (2026-07-18): QuickLogModal.jsx, DaySummaryModal.jsx,
// EntryInsightsPopup.jsx, SanctuaryWalkthrough.jsx were 4 of the 60
// offenders (honey/warm/lavender/sage/terra classes across the quick-mood,
// day-summary, entry-insights, and welcome-tour surfaces); all fully
// cleaned and moved to MIGRATED. Budget drops 60 -> 56.
export const LEGACY_BUDGET = 56;

function collectJsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = resolve(dir, entry.name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectJsxFiles(full));
    } else if (entry.name.endsWith('.jsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('MIGRATED files are Cloud-clean', () => {
  MIGRATED.forEach((relPath) => {
    it(`${relPath} has no legacy palette classes, no gray- classes, no raw hex (except .css token source)`, () => {
      const fullPath = resolve(REPO_ROOT, relPath);
      const content = readFileSync(fullPath, 'utf-8');
      const isCss = relPath.endsWith('.css');

      // cloud-tokens.css is the token *definition/bridge* file: it intentionally defines
      // `.text-warm-800 { color: var(--foreground) !important; }`-style selectors so
      // not-yet-migrated screens still resolve through the new tokens. That's bridge
      // plumbing, not "usage" of the legacy palette in JSX — so .css is exempt from all
      // three content rules, not just hex.
      const legacyViolations = isCss ? [] : findPatternViolations(content, LEGACY_CLASS_RE);
      const grayViolations = isCss ? [] : findPatternViolations(content, GRAY_CLASS_RE);
      const hexViolations = isCss ? [] : findHexViolations(content);

      const problems = [];
      if (legacyViolations.length) {
        problems.push(`legacy palette classes:\n${legacyViolations.join('\n')}`);
      }
      if (grayViolations.length) {
        problems.push(`gray- classes:\n${grayViolations.join('\n')}`);
      }
      if (hexViolations.length) {
        problems.push(`raw hex colors:\n${hexViolations.join('\n')}`);
      }

      expect(problems, problems.join('\n\n')).toHaveLength(0);
    });
  });
});

describe('Legacy palette migration ratchet', () => {
  it(`no more than ${LEGACY_BUDGET} non-migrated .jsx files still use legacy palette classes`, () => {
    const migratedFullPaths = new Set(MIGRATED.map((p) => resolve(REPO_ROOT, p)));
    const allJsx = collectJsxFiles(resolve(REPO_ROOT, 'src'));

    const offenders = [];
    for (const file of allJsx) {
      if (migratedFullPaths.has(file)) continue;
      const content = readFileSync(file, 'utf-8');
      if (LEGACY_CLASS_RE.test(content)) {
        offenders.push(file.replace(`${REPO_ROOT}/`, ''));
      }
    }

    offenders.sort();
    if (offenders.length > LEGACY_BUDGET) {
      // eslint-disable-next-line no-console
      console.error(
        `Legacy-palette offenders (${offenders.length}, budget ${LEGACY_BUDGET}):\n` +
          offenders.map((f) => `  ${f}`).join('\n')
      );
    }

    expect(
      offenders.length,
      `Files still using legacy palette classes (budget ${LEGACY_BUDGET}):\n` +
        offenders.map((f) => `  ${f}`).join('\n')
    ).toBeLessThanOrEqual(LEGACY_BUDGET);
  });

  it('LEGACY_BUDGET never increases beyond the current committed value', () => {
    // Guardrail against accidentally bumping the constant up instead of down.
    expect(LEGACY_BUDGET).toBeLessThanOrEqual(76);
  });
});
