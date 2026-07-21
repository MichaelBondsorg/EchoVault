import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronRight, Loader2, AlertTriangle, Download, LogOut, FileJson, Heart,
} from 'lucide-react';
import BackfillPanel from '../components/settings/BackfillPanel';
import { exportDiagnosticJSON, migrateEntriesForHealthEnrichment } from '../utils/diagnosticExport';
import { db, deleteAccountFn } from '../config/firebase';
import { getFlag } from '../config/flags';
import { Card, CardRow, Chip, SectionLabel, Switch, Button } from '../components/cloud';
import { initAccent, setAccent } from '../utils/accent';
import { initDarkMode, cleanupDarkMode, toggleDarkMode } from '../utils/darkMode';
import { useDarkMode } from '../hooks/useDarkMode';
import { useUiStore, useBackgroundMotion } from '../stores/uiStore';

// Cloud Settings accent picker options (CLOUD-DESIGN-SPEC.md §7/§5: "22px
// swatch circles"). Fill colors come from theme-invariant CSS custom
// properties (src/styles/cloud-tokens.css --swatch-*) rather than hex in
// this file, since raw hex is banned for MIGRATED files.
const ACCENT_OPTIONS = [
  { name: 'blue', var: '--swatch-blue' },
  { name: 'mauve', var: '--swatch-mauve' },
  { name: 'terracotta', var: '--swatch-terracotta' },
];

/**
 * SettingsPage - App settings and account management
 * (CLOUD-DESIGN-SPEC.md §7 Settings: profile row, HEALTH & DATA / AI &
 * PRIVACY / APP grouped Cards + SectionLabels).
 *
 * Restyle only: every handler/prop below is unchanged from the pre-Cloud
 * version. The one behavioral change is the sanctioned accent-persistence
 * consolidation (see src/utils/accent.js) — SettingsPage previously kept
 * its own owner-scoped localStorage read/write that bypassed accent.js;
 * it now calls only initAccent(uid)/setAccent(name, uid).
 *
 * The mockup's illustrative Settings screen (5f/6f) shows a much shorter,
 * icon-free list (Health sync, AI insights, Therapist export, Safety plan,
 * then APP: Accent/Dark mode/Notifications) than this real screen, which
 * has ~10 real destinations plus data-enrichment tooling. Every existing
 * item is kept and distributed across the spec's three named sections by
 * subject matter (HEALTH & DATA: health/report/reliability tooling; AI &
 * PRIVACY: AI, entities, safety, export, account deletion; APP: appearance
 * + notifications), following the mockup's plain-text-row treatment (no
 * per-row icon squares) rather than inventing icon iconography the spec
 * doesn't call for. The Data Enrichment cards (BackfillPanel, Diagnostic
 * Export, Health Migration) are richer standalone action cards, not simple
 * nav rows, so they keep an icon-square treatment — recolored onto the
 * single Cloud accent per §3 (collapsing the old honey/sage 2-hue split),
 * consistent with the C5 InsightsPage precedent.
 */
const SettingsPage = ({
  user,
  entries = [],
  onOpenHealthSettings,
  onOpenNexusSettings,
  onOpenSafetyPlan,
  onOpenExport,
  onOpenEntityManagement,
  onOpenReports,
  onOpenReliability,
  onOpenPrivacy,
  onOpenSpaces,
  onRequestNotifications,
  onLogout,
  notificationPermission,
}) => {
  // INT-002: Loading state for settings items
  const [loadingItem, setLoadingItem] = useState(null);
  const [diagnosticResult, setDiagnosticResult] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [accentName, setAccentName] = useState('blue');

  const dark = useDarkMode();
  const backgroundMotion = useBackgroundMotion();
  const setBackgroundMotion = useUiStore((state) => state.setBackgroundMotion);

  // Dark mode: attach the live system-preference listener once (mirrors
  // what the old DarkModeToggle mounted here used to do — this is now the
  // only place in the app that renders a dark-mode control, so it owns the
  // init/cleanup lifecycle). The actual class + boot-time value are already
  // applied synchronously by the inline script in index.html; this just
  // wires up the "system" auto-switch listener.
  useEffect(() => {
    initDarkMode();
    return () => cleanupDarkMode();
  }, []);

  // Accent: resolve owner-scoped (if signed in) vs global persisted value
  // and apply it. Re-runs when the signed-in user changes (e.g. sign-in
  // completes after this page has already mounted).
  useEffect(() => {
    setAccentName(initAccent(user?.uid));
  }, [user?.uid]);

  const chooseAccent = (nextAccent) => {
    const applied = setAccent(nextAccent, user?.uid);
    if (applied) setAccentName(applied);
  };

  const handleDarkModeChange = (checked) => {
    toggleDarkMode(checked ? 'dark' : 'light');
  };

  // Permanently delete the account and all data (App Store / Play requirement).
  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccountFn();
      // Server deleted all data + the auth user; sign out locally.
      if (onLogout) await onLogout();
    } catch (e) {
      console.error('Account deletion failed:', e);
      setDeleteError('Something went wrong deleting your account. Please try again, or contact support if it persists.');
      setDeleting(false);
    }
  };
  const [migrationState, setMigrationState] = useState({
    running: false,
    progress: 0,
    total: 0,
    result: null
  });

  // Count entries needing migration
  const entriesNeedingMigration = entries.filter(
    e => e.createdOnPlatform === undefined || e.createdOnPlatform === null
  ).length;

  // Handle health enrichment migration
  const handleHealthMigration = async () => {
    if (!user?.uid || migrationState.running) return;

    setMigrationState({ running: true, progress: 0, total: entriesNeedingMigration, result: null });

    try {
      const result = await migrateEntriesForHealthEnrichment(
        entries,
        user.uid,
        db,
        (current, total) => {
          setMigrationState(prev => ({ ...prev, progress: current, total }));
        }
      );
      setMigrationState(prev => ({ ...prev, running: false, result }));
    } catch (error) {
      console.error('Migration failed:', error);
      setMigrationState(prev => ({
        ...prev,
        running: false,
        result: { error: error.message }
      }));
    }
  };

  // Handle diagnostic export
  const handleDiagnosticExport = () => {
    try {
      const summary = exportDiagnosticJSON(entries, { userId: user?.uid });
      setDiagnosticResult(summary);
    } catch (error) {
      console.error('Diagnostic export failed:', error);
      setDiagnosticResult({ error: error.message });
    }
  };

  // Wrap handlers with loading feedback
  const handleItemClick = async (itemKey, handler) => {
    if (!handler) return;
    setLoadingItem(itemKey);
    // Small delay to show loading indicator before modal opens
    await new Promise(r => setTimeout(r, 100));
    handler();
    // Clear loading after a short delay (modal will be open by then)
    setTimeout(() => setLoadingItem(null), 300);
  };

  const healthDataItems = [
    {
      label: 'Health Integration',
      description: 'Whoop / Apple Health / Google Fit',
      onClick: onOpenHealthSettings,
    },
    {
      label: 'Entry Reliability',
      description: 'Review saved, queued, and recoverable entries',
      onClick: onOpenReliability,
    },
    {
      label: 'Life Reports',
      description: 'Weekly, monthly & quarterly digests',
      onClick: onOpenReports,
    },
  ];

  const aiPrivacyItems = [
    {
      label: 'Privacy & AI',
      description: 'Data inventory, memory, consent, and export',
      onClick: onOpenPrivacy,
    },
    {
      label: 'Nexus Insights',
      description: 'Control AI pattern detection',
      onClick: onOpenNexusSettings,
    },
    {
      label: 'People & Things',
      description: 'Edit names, relationships, and entities',
      onClick: onOpenEntityManagement,
    },
    {
      label: 'Safety Plan',
      description: 'Your support resources',
      onClick: onOpenSafetyPlan,
    },
    {
      label: 'Export for Therapist',
      description: 'Download your entries',
      onClick: onOpenExport,
    },
    {
      label: 'Delete Account',
      description: 'Permanently erase your account and all data',
      onClick: () => setShowDeleteConfirm(true),
      destructive: true,
    },
  ];

  const notificationsItem = {
    label: 'Notifications',
    description: notificationPermission === 'granted' ? 'Enabled' : 'Tap to enable',
    onClick: notificationPermission !== 'granted' ? onRequestNotifications : null,
    badge: notificationPermission !== 'granted' ? 'Off' : null,
  };

  // Context Spaces (flag: contextSpaces) — organize entries into spaces
  // (Personal/Work/...) and scope Ask Journal to one. Flag-gated: this row
  // (and the App-group Card it lives in) is filtered out entirely when off.
  const contextSpacesItem = {
    label: 'Context Spaces',
    description: 'Organize entries into spaces and scope Ask Journal',
    onClick: onOpenSpaces,
  };
  const appNavRows = [getFlag('contextSpaces') && contextSpacesItem, notificationsItem].filter(Boolean);

  // Shared row renderer for the simple label/description/chevron nav items
  // across HEALTH & DATA, AI & PRIVACY, and the APP section's Notifications
  // row. The whole row is the tap target (native <button>, not an
  // overlay-inflated one), so there's no min-44px hit-target math needed —
  // px-4 py-3 around two lines of text already clears 44px, and it's the
  // only interactive element in the row.
  const renderNavRow = (item, isLast) => {
    const isLoading = loadingItem === item.label;
    return (
      <button
        key={item.label}
        type="button"
        onClick={() => handleItemClick(item.label, item.onClick)}
        disabled={!item.onClick || isLoading}
        className={`flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
          isLast ? '' : 'border-b border-divider'
        } ${item.onClick ? 'hover:bg-divider active:bg-divider' : ''} ${
          !item.onClick || isLoading ? 'opacity-70' : ''
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className={`text-[13.5px] font-medium ${item.destructive ? 'text-destructive' : 'text-foreground'}`}>
            {item.label}
          </p>
          <p className="truncate text-sm text-muted-foreground">{item.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {item.badge && !isLoading && <Chip>{item.badge}</Chip>}
          {isLoading ? (
            <Loader2 size={18} className="animate-spin text-muted-foreground" aria-hidden="true" />
          ) : item.onClick ? (
            <ChevronRight size={18} className="text-faint" aria-hidden="true" />
          ) : null}
        </div>
      </button>
    );
  };

  const displayName = user?.displayName || (user?.email ? user.email.split('@')[0] : 'You');
  const initial = (displayName.trim().charAt(0) || 'Y').toUpperCase();

  return (
    <motion.div
      className="px-4 pb-8 space-y-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Page Title */}
      <div className="pt-2">
        <h2 className="font-display font-medium text-[27px] leading-[1.2] tracking-[-0.01em] text-foreground">
          Settings
        </h2>
      </div>

      {/* Profile row — no onClick handler exists for profile editing yet,
          so this stays a static display row (no chevron/nav affordance) to
          avoid implying an action that doesn't exist. */}
      <Card className="flex items-center gap-3 p-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-wash text-[15px] font-semibold text-accent-deep">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email || 'Not signed in'}</p>
        </div>
      </Card>

      {/* HEALTH & DATA */}
      <div className="space-y-2">
        <SectionLabel className="px-1">Health &amp; Data</SectionLabel>
        <Card className="overflow-hidden">
          {healthDataItems.map((item, i) => renderNavRow(item, i === healthDataItems.length - 1))}
        </Card>

        <BackfillPanel entries={entries} />

        {/* Diagnostic Export */}
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-wash text-accent-deep">
              <FileJson size={20} />
            </div>
            <div className="flex-1">
              <span className="font-medium text-foreground">Diagnostic Export</span>
              <p className="text-sm text-muted-foreground">Export all entry data as JSON for troubleshooting</p>
            </div>
          </div>

          <Button onClick={handleDiagnosticExport} disabled={entries.length === 0} className="w-full">
            <Download size={18} />
            Export {entries.length} Entries as JSON
          </Button>

          {/* Show summary after export */}
          {diagnosticResult && !diagnosticResult.error && (
            <div className="text-xs bg-divider rounded-lg p-3 space-y-1">
              <p className="font-medium text-foreground">Export Summary:</p>
              <div className="grid grid-cols-2 gap-1 text-secondary-foreground">
                <span>Total entries:</span>
                <span className="font-mono">{diagnosticResult.totalEntries}</span>
                <span>With mood score:</span>
                <span className="font-mono">{diagnosticResult.entriesWithMoodScore}</span>
                <span>With health data:</span>
                <span className="font-mono">{diagnosticResult.entriesWithHealthContext}</span>
                <span>With environment:</span>
                <span className="font-mono">{diagnosticResult.entriesWithEnvironmentContext}</span>
                <span>With tags:</span>
                <span className="font-mono">{diagnosticResult.entriesWithTags}</span>
                <span>With themes:</span>
                <span className="font-mono">{diagnosticResult.entriesWithThemes}</span>
              </div>
              {diagnosticResult.warning && (
                <div className="mt-2 flex items-start gap-2 text-accent-deep bg-accent-wash rounded p-2">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{diagnosticResult.warning}</span>
                </div>
              )}
            </div>
          )}

          {diagnosticResult?.error && (
            // @color-safe: error state — not part of the single-accent system (spec §3)
            <div className="text-xs bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-lg p-3">
              Export failed: {diagnosticResult.error}
            </div>
          )}
        </Card>

        {/* Health Data Migration */}
        <Card className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-wash text-accent-deep">
              <Heart size={20} />
            </div>
            <div className="flex-1">
              <span className="font-medium text-foreground">Prepare for Health Enrichment</span>
              <p className="text-sm text-muted-foreground">
                Flag old entries for health data when you open the mobile app
              </p>
            </div>
          </div>

          {entriesNeedingMigration > 0 ? (
            <>
              <p className="text-xs text-secondary-foreground">
                {entriesNeedingMigration} entries don't have platform tracking.
                This will mark them so health data can be added when you open the mobile app.
              </p>

              <Button onClick={handleHealthMigration} disabled={migrationState.running} className="w-full">
                {migrationState.running ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Migrating... {migrationState.progress}/{migrationState.total}
                  </>
                ) : (
                  <>
                    <Heart size={18} />
                    Migrate {entriesNeedingMigration} Entries
                  </>
                )}
              </Button>
            </>
          ) : (
            <p className="text-xs text-accent-deep bg-accent-wash rounded-lg p-3">
              ✓ All entries have platform tracking. Open the mobile app to enrich web entries with health data.
            </p>
          )}

          {/* Show result after migration */}
          {migrationState.result && !migrationState.result.error && (
            <div className="text-xs bg-accent-wash text-accent-deep rounded-lg p-3 space-y-1">
              <p className="font-medium">Migration Complete!</p>
              <p>{migrationState.result.message}</p>
              <div className="grid grid-cols-2 gap-1 mt-2">
                <span>Migrated:</span>
                <span className="font-mono">{migrationState.result.migrated}</span>
                <span>Need health data:</span>
                <span className="font-mono">{migrationState.result.entriesNeedingHealth}</span>
              </div>
            </div>
          )}

          {migrationState.result?.error && (
            // @color-safe: error state — not part of the single-accent system (spec §3)
            <div className="text-xs bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-lg p-3">
              Migration failed: {migrationState.result.error}
            </div>
          )}
        </Card>
      </div>

      {/* AI & PRIVACY */}
      <div className="space-y-2">
        <SectionLabel className="px-1">AI &amp; Privacy</SectionLabel>
        <Card className="overflow-hidden">
          {aiPrivacyItems.map((item, i) => renderNavRow(item, i === aiPrivacyItems.length - 1))}
        </Card>
      </div>

      {/* APP */}
      <div className="space-y-2">
        <SectionLabel className="px-1">App</SectionLabel>
        <Card className="overflow-hidden">
          <CardRow>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-foreground">Accent color</p>
              <p className="text-sm text-muted-foreground">Choose the tone that feels most like you</p>
            </div>
            {/*
              Hit-area geometry (44px min target, non-overlapping) — same
              analysis as the C5 InsightsPage fix. Each swatch button is a
              real 22px circle (spec: "22px swatch circles"); a
              `before:-inset-[11px]` overlay inflates the invisible tap area
              to 22 + 2*11 = 44px (meets the 44px minimum). Two such
              overlays centered on dots `gap` apart overlap by
              (2*11 - gap). This row uses gap-6 (24px), so overlap =
              22 - 24 = -2px, i.e. a 2px real gap between hitboxes, not an
              overlap — unlike the pre-fix Insights bug where gap-1 (4px)
              was far less than the 20px combined inset. Any future change
              here must keep gap-6 (24px) as the floor while inset stays
              11px (22px dot).
            */}
            <div className="flex shrink-0 items-center gap-6" role="group" aria-label="Accent color">
              {ACCENT_OPTIONS.map(({ name, var: swatchVar }) => (
                <button
                  key={name}
                  type="button"
                  aria-label={`${name} accent`}
                  aria-pressed={accentName === name}
                  onClick={() => chooseAccent(name)}
                  className={`relative h-[22px] w-[22px] rounded-full before:absolute before:-inset-[11px] before:content-[''] ${
                    accentName === name ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : ''
                  }`}
                  style={{ backgroundColor: `var(${swatchVar})` }}
                />
              ))}
            </div>
          </CardRow>
          <CardRow>
            <label htmlFor="settings-dark-mode-switch" className="min-w-0 flex-1 cursor-pointer">
              <p className="text-[13.5px] font-medium text-foreground">Dark mode</p>
              <p className="text-sm text-muted-foreground">Use a quieter palette at night</p>
            </label>
            <Switch id="settings-dark-mode-switch" checked={dark} onCheckedChange={handleDarkModeChange} />
          </CardRow>
          <CardRow>
            <label htmlFor="settings-background-motion-switch" className="min-w-0 flex-1 cursor-pointer">
              <p className="text-[13.5px] font-medium text-foreground">Background motion</p>
              <p className="text-sm text-muted-foreground">Drifting wave animation behind screens</p>
            </label>
            <Switch
              id="settings-background-motion-switch"
              checked={backgroundMotion}
              onCheckedChange={setBackgroundMotion}
            />
          </CardRow>
          {appNavRows.map((item, i) => renderNavRow(item, i === appNavRows.length - 1))}
        </Card>
      </div>

      {/* Sign Out Button */}
      <Button
        variant="outline"
        onClick={onLogout}
        className="w-full border-destructive bg-[var(--destructive-wash)] text-destructive hover:bg-[var(--destructive-wash)] hover:opacity-90"
      >
        <LogOut size={18} />
        Sign Out
      </Button>

      {/* Wellness disclaimer (required framing: not therapy / not a medical device) */}
      <Card className="px-4 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed text-center">
          Engram is a general-wellness tool for self-reflection. It is not therapy,
          not a medical device, and not a crisis service, and it does not diagnose,
          treat, or prevent any condition. If you are in crisis, call or text{' '}
          <a href="tel:988" className="font-semibold text-accent-deep underline">988</a>{' '}
          (US Suicide &amp; Crisis Lifeline).
        </p>
      </Card>

      {/* App Version */}
      <p className="text-center text-xs text-faint">
        Engram v2.0
      </p>

      {/* Delete Account confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay)] p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--destructive-wash)] text-destructive">
                <AlertTriangle size={20} />
              </div>
              <h3 className="font-display font-bold text-lg text-foreground">Delete your account?</h3>
            </div>
            <p className="text-sm text-secondary-foreground mb-4">
              This permanently erases your account and <strong>all</strong> of your journal entries,
              insights, health data, and safety plan. This cannot be undone.
            </p>
            {deleteError && (
              <p className="text-sm text-destructive mb-3">{deleteError}</p>
            )}
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleDeleteAccount}
                disabled={deleting}
                // text-white (not text-background): --destructive is a fixed
                // mid-tone red-brown in both themes (spec never defines a
                // dark-mode variant), so a background-colored label would
                // flip to near-black in dark mode and fail contrast against
                // it. White stays ~5:1 in both themes.
                className="w-full bg-destructive text-white hover:opacity-90"
              >
                {deleting ? (<><Loader2 size={18} className="animate-spin" /> Deleting…</>) : 'Delete everything'}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
                disabled={deleting}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};

export default SettingsPage;
