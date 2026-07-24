import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, Loader2, LogIn, Brain, Share,
  User as UserIcon, Briefcase, X, Mail, Apple, Eye, EyeOff, Shield
} from 'lucide-react';

// UI Components
import { celebrate, Modal, ModalHeader, ModalBody, Badge, MoodBadge, BreathingLoader } from './components/ui';
import { Button, Pebble, LinenWaveBackground } from './components/cloud';

// Config
import {
  auth, db,
  onAuthStateChanged, signOut, signInWithCustomToken,
  GoogleAuthProvider, signInWithPopup, signInWithCredential, OAuthProvider,
  exchangeGoogleTokenFn, exchangeAppleTokenFn,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile,
  // MFA support
  getMultiFactorResolver, PhoneAuthProvider, PhoneMultiFactorGenerator,
  TotpMultiFactorGenerator, RecaptchaVerifier,
  collection, addDoc, query, orderBy, onSnapshot,
  Timestamp, deleteDoc, doc, updateDoc, limit, setDoc,
  runTransaction, increment
} from './config/firebase';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
  APP_COLLECTION_ID, CURRENT_CONTEXT_VERSION,
  DEFAULT_SAFETY_PLAN
} from './config/constants';
import { USE_FUSED_TRANSCRIPTION } from './config/ai';
import { initFlags, getFlag } from './config/flags';

// Utils
import { safeString, removeUndefined, formatMentions } from './utils/string';
import { buildOfflineSyncPayload } from './services/offline/offlineSyncPayload';
import { safeDate, formatDateForInput, getTodayForInput, parseDateInput, getDateString, getISOYearWeek } from './utils/date';
import { sanitizeEntry } from './utils/entries';

// Services
import { generateEmbedding, findRelevantMemories, transcribeAudioWithTone, transcribeEntryFused } from './services/ai';
import { audioVault } from './services/audio/audioVault';
import {
  classifyEntry, analyzeEntry, generateInsight, extractEnhancedContext,
  performLocalAnalysis, getAnalysisStrategy
} from './services/analysis';
import { checkCrisisKeywords, checkWarningIndicators, checkLongitudinalRisk } from './services/safety';
import { retrofitEntriesInBackground } from './services/entries';
import { buildCoreEntry } from './services/entries/buildCoreEntry';
import { runPostSaveEnrichment } from './services/entries/enrichmentRunner';
import { runPostSavePipelines } from './services/entries/postSavePipeline';
import { hasTextMeaningfullyChanged, buildMeaningfulEditFields } from './services/entries/entryCorrectionFields';
import { queueEntry, resetStuckSyncing } from './services/offline';
import { initializeSyncOrchestrator, triggerSync } from './services/sync/syncOrchestrator';
import { ownerStorageKey } from './services/storage/ownerScopedStorage';
import {
  grantAiConsent as grantAiConsentToServer,
  revokeAiConsent as revokeAiConsentToServer,
  declineAiConsent as declineAiConsentToServer,
  flushConsentOutbox,
} from './services/consent/consentService';
import { clearOwnerCaches } from './services/storage/clearOwnerCaches';
import { quarantineLegacySessionBuffer, sweepLegacyVoiceTranscripts } from './services/memory/sessionBuffer';
import { deleteNativeDraft, recoverNativeDrafts } from './services/capture/nativeCaptureAdapter';
import { prepareDurableRecording } from './services/capture/prepareDurableRecording';
import {
  createOperation,
  advance as advanceOperation,
  completeOperation,
  abandonOperation,
  markNeedsAttention,
  findByRecordingId,
} from './services/capture/operationStore';
import { resumeIncompleteOperations } from './services/capture/resumeOperations';
import { recordStage, STAGES } from './services/telemetry/captureTelemetry';
import { inferCategory } from './services/prompts';
import { getActiveReflectionPrompts, dismissReflectionPrompt } from './services/prompts/activePrompts';
import { getLastCaptureSpaceId } from './services/spaces/spacesService';
import { detectTemporalContext, needsConfirmation, formatEffectiveDate } from './services/temporal';
import { handleEntryDateChange, calculateStreak, shouldCelebrateNewStreak } from './services/dashboard';
import { processEntrySignals } from './services/signals/processEntrySignals';
import { updateSignalStatus, batchUpdateSignalStatus } from './services/signals';
import { runEntryPostProcessing } from './services/background';
import { getEntryHealthContext, handleWhoopOAuthSuccess, batchEnrichEntries } from './services/health';
import { getEntryEnvironmentContext, getCurrentLocation } from './services/environment';
import { updateInsightsForNewEntry } from './services/nexus/orchestrator';

// Hooks
import { useIOSMeta } from './hooks/useIOSMeta';
import { useNotifications } from './hooks/useNotifications';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useWakeLock } from './hooks/useWakeLock';
import { useBackgroundAudio } from './hooks/useBackgroundAudio';

// Zustand Stores
import {
  useAuthStore,
  useUiStore,
  useEntriesStore,
  useSafetyStore,
  useSignalsStore,
  useReportsStore,
  resetAllStores
} from './stores';

// Components
import {
  CrisisSoftBlockModal, DailySummaryModal, EntryInsightsPopup,
  MarkdownLite, GetHelpButton, HamburgerMenu,
} from './components';
import WhatsNewModal from './components/shared/WhatsNewModal';
import AiConsentModal from './components/modals/AiConsentModal';
import PendingAudioBanner from './components/shared/PendingAudioBanner';
// Heavy screens are code-split via the lazy wrappers (aliased so JSX usage is
// unchanged). UnifiedConversation was imported here but only rendered in
// AppLayout — the dead import is dropped and it's lazy-loaded there instead.
import {
  ReportListWithSuspense,
  ReportViewerWithSuspense,
  NexusSettingsWithSuspense as NexusSettings,
  EntityManagementPageWithSuspense as EntityManagementPage,
  InsightsPanelWithSuspense as InsightsPanel,
  CrisisResourcesScreenWithSuspense as CrisisResourcesScreen,
  SafetyPlanScreenWithSuspense as SafetyPlanScreen,
  DecompressionScreenWithSuspense as DecompressionScreen,
  StreakCelebrationWithSuspense as StreakCelebration,
  TherapistExportScreenWithSuspense as TherapistExportScreen,
  HealthSettingsScreenWithSuspense as HealthSettingsScreen,
} from './components/lazy';

import DetectedStrip from './components/entries/DetectedStrip';

// Zen & Bento Components
import { AppLayout } from './components/zen';
import QuickLogModal from './components/zen/QuickLogModal';

// PDF export uses `loadJsPDF` from `./utils/pdf` (dynamic `import('jspdf')`,
// SEC-01) via TherapistExportScreen/sessionPrep — this file never generates
// PDFs directly, so no loader lives here. (Previously a byte-for-byte
// duplicate CDN-injecting loader was defined here but never called; removed
// as dead code rather than converted.)

// Analysis functions (classifyEntry, analyzeEntry, generateInsight, etc.) imported from services/analysis


export default function App() {
  console.log('[Engram] App component rendering...');
  useIOSMeta();
  const { requestWakeLock, releaseWakeLock } = useWakeLock();
  // backupAudio/clearBackup/isProcessing are unused here (audio backup is now
  // owned by audioVault); isProcessing never existed on this hook's return
  // value, so the old `isBackgroundProcessing` binding was always falsy.
  useBackgroundAudio();

  // ============================================
  // ZUSTAND STORES (migrated from useState)
  // ============================================

  // Auth Store
  const {
    user, setUser,
    authMode, setAuthMode,
    email, setEmail,
    password, setPassword,
    displayName, setDisplayName,
    showPassword, toggleShowPassword,
    authLoading, setAuthLoading,
    authError, setAuthError,
    showEmailForm, setShowEmailForm,
    mfaResolver, setMfaResolver: setMfaResolverStore,
    mfaCode, setMfaCode,
    mfaHint, setMfaHint: setMfaHintStore,
    startAuth, authFailed, authSuccess, resetAuthForm,
    switchToMfa, clearMfaState
  } = useAuthStore();

  const { isOnline, pendingCount: offlinePendingCount } = useNetworkStatus({
    ownerUid: user?.uid,
  });

  // Register for push notifications once we know who the user is. Previously
  // useNotifications() was called with no userId, so token registration never
  // fired — no fcm_tokens were written and the app could never send a reminder.
  // This one-line fix activates the entire (already-built) notification backend.
  const { permission, requestPermission } = useNotifications(user?.uid);

  // First-run AI-processing consent (Apple 5.1.2(i)). We must disclose and get
  // permission before sending journal/health data to third-party AI. The modal
  // gates the app on first run until acknowledged; consent is recorded per
  // device (localStorage) and to Firestore for audit.
  const AI_CONSENT_VERSION = '1';
  const [needsAiConsent, setNeedsAiConsent] = useState(false);
  const [aiProcessingEnabled, setAiProcessingEnabled] = useState(false);
  const [aiConsentSaving, setAiConsentSaving] = useState(false);

  // Context Space capture pill (PRD R1 Context Spaces, plan task 9). Default
  // is unscoped (null); when the flag is on, lazily restore the last space
  // the user EXPLICITLY selected (Michael's product decision — never
  // auto-select, only remember an explicit choice). EntryBar/EntryComposer
  // read+set this via props; doSaveEntry below reads it via closure.
  const [captureSpaceId, setCaptureSpaceId] = useState(null);

  // True once the fire-and-forget initFlags(db) call below has resolved
  // (success or caught failure — see flags.js, it never rejects). getFlag()
  // is synchronous and always usable, but it silently falls back to
  // FLAG_DEFAULTS until this resolves; effects that gate one-time behavior
  // on a flag (e.g. the captureSpaceId restore effect below) must wait for
  // this, or a cold start where initFlags is still in flight reads a false
  // default for `contextSpaces` and — since that effect's deps don't
  // otherwise change — never gets a chance to re-check once the real value
  // arrives (M1 fix).
  const [flagsReady, setFlagsReady] = useState(false);

  useEffect(() => {
    if (!user?.uid) {
      setNeedsAiConsent(false);
      setAiProcessingEnabled(false);
      return;
    }
    try {
      const accepted = localStorage.getItem(ownerStorageKey(user.uid, 'consent/aiVersion'));
      const declined = localStorage.getItem(ownerStorageKey(user.uid, 'consent/aiDeclinedVersion'));
      const enabled = accepted === AI_CONSENT_VERSION;
      setAiProcessingEnabled(enabled);
      setNeedsAiConsent(!enabled && declined !== AI_CONSENT_VERSION);
    } catch {
      setAiProcessingEnabled(false);
      setNeedsAiConsent(true);
    }
  }, [user?.uid]);

  const handleAiConsent = async () => {
    setAiConsentSaving(true);
    // Fail-closed, server-authoritative consent: local marker + legacy
    // localStorage keys are written synchronously inside the service, and
    // the grantAiProcessing callable is queued in a retryable outbox so a
    // network failure here can never silently drop the user's grant.
    if (user?.uid) {
      await grantAiConsentToServer(user.uid);
    }
    setAiProcessingEnabled(true);
    setNeedsAiConsent(false);
    setAiConsentSaving(false);
  };

  const continueWithoutAi = async () => {
    if (!user?.uid) return;
    setAiConsentSaving(true);
    // Fail-closed, server-authoritative consent: handled as a revoke (no
    // server-side "declined" state exists). The previous raw setDoc here
    // wrote `consentVersion`/`declinedAt`, keys firestore.rules' settings/consent
    // allowlist rejects — the write silently failed on every decline, and
    // consentGate's missing-doc default then left AI enabled server-side.
    await declineAiConsentToServer(user.uid);
    setAiProcessingEnabled(false);
    setNeedsAiConsent(false);
    setAiConsentSaving(false);
  };

  const revokeAiConsent = async () => {
    if (!user?.uid) return;
    // Fail-closed: the service flips the local marker synchronously before
    // any network call, and never re-enables it if revokeAiProcessing fails —
    // the outbox retries on next launch/online/visible instead.
    await revokeAiConsentToServer(user.uid);
    setAiProcessingEnabled(false);
    setNeedsAiConsent(false);
  };

  // Wrapper functions for store setters that need to accept full objects
  const setMfaResolver = (resolver) => setMfaResolverStore(resolver);
  const setMfaHint = (hint) => setMfaHintStore(hint);
  const setShowPassword = () => toggleShowPassword(); // UI uses setShowPassword(!showPassword) pattern

  // UI Store
  const {
    view, setView,
    category: cat, setCategory: setCat,
    showDecompression, showDecompressionModal, hideDecompressionModal,
    showSafetyPlan, showSafetyPlanModal, hideSafetyPlanModal,
    showExport, showExportModal, hideExportModal,
    showInsights, showInsightsPanel, hideInsightsPanel,
    showJournal, showJournalScreen, hideJournalScreen,
    showHealthSettings, showHealthSettingsScreen, hideHealthSettingsScreen,
    showNexusSettings, showNexusSettingsScreen, hideNexusSettingsScreen,
    showEntityManagement, showEntityManagementScreen, hideEntityManagementScreen,
    showQuickLog, showQuickLogModal, hideQuickLogModal,
    dailySummaryModal, openDailySummary, closeDailySummary,
    entryInsightsPopup, openEntryInsights, closeEntryInsights,
    streakCelebration, openStreakCelebration, closeStreakCelebration
  } = useUiStore();

  // Compatibility setters for UI store
  const setShowDecompression = (show) => show ? showDecompressionModal() : hideDecompressionModal();
  const setShowSafetyPlan = (show) => show ? showSafetyPlanModal() : hideSafetyPlanModal();
  const setShowExport = (show) => show ? showExportModal() : hideExportModal();
  const setShowInsights = (show) => show ? showInsightsPanel() : hideInsightsPanel();
  const setShowJournal = (show) => show ? showJournalScreen() : hideJournalScreen();
  const setShowHealthSettings = (show) => show ? showHealthSettingsScreen() : hideHealthSettingsScreen();
  const setShowNexusSettings = (show) => show ? showNexusSettingsScreen() : hideNexusSettingsScreen();
  const setShowEntityManagement = (show) => show ? showEntityManagementScreen() : hideEntityManagementScreen();
  const setShowQuickLog = (show) => show ? showQuickLogModal() : hideQuickLogModal();
  const setDailySummaryModal = (data) => data ? openDailySummary(data) : closeDailySummary();
  const setEntryInsightsPopup = (data) => data ? openEntryInsights(data) : closeEntryInsights();

  // Entries Store
  const {
    entries, setEntries,
    processing, setProcessing,
    replyContext, setReplyContext, clearReplyContext,
    entryPreferredMode, setEntryPreferredMode,
    retrofitProgress, setRetrofitProgress
  } = useEntriesStore();

  // Safety Store
  const {
    safetyPlan, setSafetyPlan,
    crisisModal, setCrisisModal: setCrisisModalStore,
    crisisResources, showCrisisResources, hideCrisisResources,
    pendingEntry, setPendingEntry, clearPendingEntry,
    startCrisisFlow, endCrisisFlow
  } = useSafetyStore();

  // Compatibility setters for safety store
  const setCrisisModal = (data) => setCrisisModalStore(data);
  const setCrisisResources = (data) => data ? showCrisisResources(data) : hideCrisisResources();

  // Signals Store
  const {
    detectedSignals, setDetectedSignals,
    showDetectedStrip, showStrip, hideStrip,
    signalExtractionEntryId, setSignalExtractionEntryId,
    handleSignalDetection, dismissStrip, completeSignalHandling
  } = useSignalsStore();

  // Compatibility setters for signals store
  const setShowDetectedStrip = (show) => show ? showStrip() : hideStrip();

  // Warn user if they try to close/navigate away while processing audio
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (processing) {
        e.preventDefault();
        e.returnValue = 'Audio is being processed. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && processing) {
        console.log('[Engram] App backgrounded while processing audio - processing will continue');
        // Audio backup is already in localStorage, so it can be recovered
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [processing]);

  // Cleanup stale audio backups on app startup (older than 24 hours)
  useEffect(() => {
    try {
      const now = Date.now();
      const ONE_DAY = 24 * 60 * 60 * 1000;
      const keysToRemove = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('echov_audio_backup_')) {
          try {
            const data = JSON.parse(localStorage.getItem(key));
            if (data.timestamp && (now - data.timestamp) > ONE_DAY) {
              keysToRemove.push(key);
            }
          } catch (e) {
            // Invalid data, remove it
            keysToRemove.push(key);
          }
        }
      }

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log('Cleaned up stale audio backup:', key);
      });

      if (keysToRemove.length > 0) {
        console.log(`Cleaned up ${keysToRemove.length} stale audio backup(s)`);
      }
    } catch (e) {
      console.warn('Error cleaning up audio backups:', e);
    }

    // Sweep the durable audio vault for recordings past the retention window.
    if (user?.uid) {
      audioVault.cleanupExpired(user.uid).then(n => n && console.log(`[audioVault] cleaned ${n} expired recording(s)`));
      if (Capacitor.isNativePlatform()) {
        recoverNativeDrafts(
          user.uid,
          // saveRecording now returns { id } / { error }; recoverNativeDrafts
          // expects an id string (or null) to decide whether the draft was
          // durably adopted before deleting it.
          (base64, mime) => audioVault.saveRecording(user.uid, base64, mime).then((r) => r?.id ?? null)
          // No 3rd {activeDraftId} arg here on purpose: this effect runs at
          // launch/login with no visibility into EntryBar's live capture
          // session (that state is private to EntryBar, not lifted here).
          // The adapter covers that gap itself via a module-level "recording
          // started recently" fallback (see nativeCaptureAdapter.ts) — real
          // per-draft precision, if ever reachable from a call site, is
          // still available via the options param.
        ).then((count) => count && console.log(`[Capture] recovered ${count} interrupted recording(s)`))
          .catch((error) => console.warn('[Capture] recovery scan failed:', error?.message));
      }

      // Resume voice-capture operations interrupted by an app kill/crash. The
      // durable operationStore is the source of truth; each incomplete op is
      // finished idempotently (duplicate-delivery guarded by the entry's
      // operationId, so a resume never creates a second entry). Runs on every
      // platform (web recordings can be interrupted too).
      resumeIncompleteOperations({
        ownerUid: user.uid,
        db,
        handleAudioRetry: async (recordingId, opId) => {
          const rec = await audioVault.getRecording(user.uid, recordingId);
          if (!rec) return;
          // Voice Chapters (flag: voiceChapters): mirror PendingAudioBanner's
          // retryAll (src/components/shared/PendingAudioBanner.jsx) — forward
          // markers/durationMs from the vault entry so a launch-time crash
          // resume doesn't drop chapters the user already tapped. Omitted
          // (not stuffed as empty) when the entry has none.
          const chapterExtras = {
            ...(rec.markers && rec.markers.length ? { markers: rec.markers } : {}),
            ...(rec.durationMs != null ? { durationMs: rec.durationMs } : {}),
          };
          await handleAudioWrapper(rec.base64, rec.mime, {
            existingRecordingId: recordingId,
            operationId: opId,
            ...chapterExtras,
          });
        },
      }).then((s) => s && (s.resumed || s.completed || s.needsAttention)
        && console.log('[Capture] resume summary:', s))
        .catch((error) => console.warn('[Capture] resume scan failed:', error?.message));
    }
  }, [user?.uid]);

  // Fail-closed AI consent outbox: retry any queued revoke/grant callable
  // that couldn't reach the server when the user acted (offline, cold start,
  // transient failure). Flushed on app launch, whenever we come back online,
  // and whenever the app returns to the foreground — local state already
  // reflects the user's choice, this just keeps the server in sync.
  useEffect(() => {
    if (!user?.uid) return;
    flushConsentOutbox(user.uid);

    const handleOnline = () => flushConsentOutbox(user.uid);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') flushConsentOutbox(user.uid);
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.uid]);

  // Deep link handler for OAuth callbacks (Whoop integration)
  useEffect(() => {
    const handleDeepLink = async (event) => {
      try {
        const url = new URL(event.url);
        console.log('[Engram] Deep link received:', url.toString());

        if (url.host === 'new-entry') {
          const requested = url.searchParams.get('mode');
          window.dispatchEvent(new CustomEvent('engram:open-entry', {
            detail: { mode: requested === 'record' || requested === 'voice' ? 'voice' : 'text' },
          }));
          return;
        }

        if (url.host === 'talk') {
          window.dispatchEvent(new CustomEvent('engram:open-companion'));
          return;
        }

        // Handle OAuth success callback
        if (url.host === 'auth-success') {
          const provider = url.searchParams.get('provider');
          if (provider === 'whoop') {
            console.log('[Engram] Whoop OAuth success');
            await handleWhoopOAuthSuccess();
            // Refresh health settings if open
            if (showHealthSettings) {
              setShowHealthSettings(false);
              setTimeout(() => setShowHealthSettings(true), 100);
            }
          }
        }

        // Handle OAuth error callback
        if (url.host === 'auth-error') {
          const provider = url.searchParams.get('provider');
          const error = url.searchParams.get('error');
          console.error(`[Engram] OAuth error for ${provider}:`, error);
        }
      } catch (error) {
        console.error('[Engram] Error handling deep link:', error);
      }
    };

    // Listen for deep links
    const listener = CapacitorApp.addListener('appUrlOpen', handleDeepLink);

    return () => {
      listener.then(l => l.remove());
    };
  }, [showHealthSettings]);

  // Initialize the offline sync orchestrator once we have a user.
  //
  // This drains the PERSISTENT offline queue (Capacitor Preferences, survives
  // app restart). The previous handler drained an in-memory queue that was lost
  // on app kill AND threw a TypeError (Timestamp.fromDate on an ISO string),
  // silently dropping every offline entry on reconnect. Reconnect syncing is
  // wired in useNetworkStatus (handleNetworkChange + triggerSync); it simply
  // never ran because the orchestrator was never initialized.
  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;

    // Write a queued offline entry to Firestore. Idempotent: the doc id is
    // derived from the offlineId, so a re-sync after a lost network ack
    // overwrites the same doc instead of creating a duplicate. Analysis is left
    // 'pending' and completed by the server-side pipeline / watchdog.
    const saveEntry = async (entryData) => {
      const entriesCol = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', uid, 'entries');
      const ref = entryData.offlineId
        ? doc(entriesCol, entryData.offlineId)
        : doc(entriesCol);

      const data = buildOfflineSyncPayload(entryData);

      // setDoc (not addDoc) with the offlineId-derived id makes the sync
      // idempotent — a duplicate delivery overwrites rather than duplicates.
      await setDoc(ref, data);
      return { id: ref.id, analysis: entryData.localAnalysis || null };
    };

    const cleanup = initializeSyncOrchestrator({
      ownerUid: uid,
      saveEntry,
      onComplete: (results) => {
        if (results?.succeeded > 0) {
          console.log('[Sync] Drained', results.succeeded, 'offline entries');
        }
      },
    });

    (async () => {
      try {
        // Recover entries stranded mid-sync by a previous app kill.
        await resetStuckSyncing(uid);
      } catch (e) {
        console.warn('[Sync] resetStuckSyncing failed:', e);
      }
      // Drain anything left over from a previous session if we're online.
      if (navigator.onLine) {
        triggerSync().catch(e => console.warn('[Sync] Initial sync failed:', e));
      }
    })();

    return cleanup;
  }, [user?.uid]);

  // Auth
  useEffect(() => {
    console.log('[Engram] Setting up auth listener...');
    const init = async () => {
      if (typeof window !== 'undefined' && typeof window.__initial_auth_token !== 'undefined' && window.__initial_auth_token) {
        try {
          console.log('[Engram] Found initial auth token, signing in...');
          await signInWithCustomToken(auth, window.__initial_auth_token);
        } catch (error) {
          console.error('[Engram] Auth error:', error);
        }
      }
    };
    init();
    return onAuthStateChanged(auth, (user) => {
      console.log('[Engram] Auth state changed:', user ? `User: ${user.uid}` : 'No user');
      if (user) {
        // PRIV-01: quarantine (delete, never adopt) the legacy unowned
        // session-buffer key at login, in addition to the same sweep this
        // module already runs once at import/app-startup — see
        // sessionBuffer.js's own comment.
        quarantineLegacySessionBuffer();
        // PRIV-01: sweep legacy unowned voice transcripts (pre-session keys,
        // one per session) at login, in addition to the same sweep at module
        // load. Idempotent: safe to call on every login even if already
        // swept at startup.
        sweepLegacyVoiceTranscripts();
        // Fire-and-forget: feature flags must never block first paint.
        // getFlag() falls back to defaults/localStorage until this
        // resolves. Triggered here (not before auth) because config/flags
        // requires an authenticated read per firestore.rules — firing it
        // earlier would read unauthenticated, get denied, and (pre-fix)
        // permanently lock the session onto defaults. initFlags never
        // rejects (see flags.js), so this .then always fires and flips
        // flagsReady — the signal effects gated on a flag value can depend
        // on to re-check once the real value has actually loaded (M1 fix).
        initFlags(db).then(() => setFlagsReady(true));
      }
      setUser(user);
    });
  }, []);

  // Context Space capture pill: lazily restore the last EXPLICITLY-selected
  // space once we know who's signed in. Fire-and-forget, never blocks first
  // paint; with contextSpaces off (or no user) this simply stays null —
  // zero behavior change for anyone not using Spaces.
  //
  // Depends on flagsReady (M1 fix): on a cold start, auth can resolve before
  // initFlags(db) does, so the first run of this effect can see
  // getFlag('contextSpaces') still on its FLAG_DEFAULTS fallback (false)
  // even when the remote doc has it on. Without flagsReady in the deps, uid
  // doesn't change again and this effect would never get a second chance to
  // check the real value — the restore silently never happens for that
  // session. Adding flagsReady re-runs the effect exactly once more, right
  // after flags actually finish loading.
  useEffect(() => {
    if (!user?.uid || !flagsReady || !getFlag('contextSpaces')) return undefined;
    let cancelled = false;
    getLastCaptureSpaceId(db, user.uid)
      .then((id) => { if (!cancelled) setCaptureSpaceId(id); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid, flagsReady]);

  // Data Feed
  useEffect(() => {
    if (!user) return;
    // Increased from 100 to 1000 to allow more entries for export and analytics
    const q = query(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'), orderBy('createdAt', 'desc'), limit(1000));
    return onSnapshot(q, snap => {
      const safeData = snap.docs.map(doc => {
        try {
          return sanitizeEntry(doc.id, doc.data());
        } catch (error) {
          console.error('Failed to sanitize entry:', doc.id, error);
          return null;
        }
      }).filter(Boolean);
      setEntries(safeData);
    });
  }, [user]);

  // Background retrofit for enhanced context extraction
  const retrofitStarted = useRef(false);
  // retrofitProgress and setRetrofitProgress from Zustand entriesStore

  useEffect(() => {
    if (!user || entries.length === 0 || retrofitStarted.current) return;

    const needsRetrofit = entries.some(e => (e.context_version || 0) < CURRENT_CONTEXT_VERSION);
    if (!needsRetrofit) return;

    retrofitStarted.current = true;

    const timeoutId = setTimeout(() => {
      console.log('Starting background retrofit of entries...');
      retrofitEntriesInBackground(
        entries,
        user.uid,
        db,
        (processed, total) => setRetrofitProgress({ processed, total })
      ).then(() => {
        setRetrofitProgress(null);
      }).catch(err => {
        console.error('Retrofit failed:', err);
        setRetrofitProgress(null);
      });
    }, 3000);

    return () => clearTimeout(timeoutId);
  }, [user, entries]);

  // Background health enrichment for web entries (runs on mobile only)
  const healthEnrichmentStarted = useRef(false);

  useEffect(() => {
    if (!user || entries.length === 0 || healthEnrichmentStarted.current) return;

    // Only run on native platforms
    const platform = Capacitor.getPlatform();
    if (platform !== 'ios' && platform !== 'android') return;

    // Check if any entries need health enrichment
    const needsEnrichment = entries.some(e =>
      e.needsHealthContext === true ||
      (e.createdOnPlatform === 'web' && !e.healthContext && !e.healthEnrichmentAttempted)
    );

    if (!needsEnrichment) return;

    healthEnrichmentStarted.current = true;

    // Delay to let app fully initialize first
    const timeoutId = setTimeout(async () => {
      console.log('[Engram] Starting background health enrichment...');
      try {
        const result = await batchEnrichEntries(entries, 20);
        console.log('[Engram] Health enrichment complete:', result);
      } catch (err) {
        console.error('[Engram] Health enrichment failed:', err);
      }
    }, 5000);

    return () => clearTimeout(timeoutId);
  }, [user, entries]);

  // Load Safety Plan (Phase 0)
  useEffect(() => {
    if (!user) return;
    const safetyPlanRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'safetyPlan', 'plan');
    return onSnapshot(safetyPlanRef, (snap) => {
      if (snap.exists()) {
        setSafetyPlan({ ...DEFAULT_SAFETY_PLAN, ...snap.data() });
      } else {
        setSafetyPlan(DEFAULT_SAFETY_PLAN);
      }
    });
  }, [user]);

  // Save Safety Plan handler
  const updateSafetyPlan = useCallback(async (newPlan) => {
    if (!user) return;
    const safetyPlanRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'safetyPlan', 'plan');
    const planData = removeUndefined({
      ...newPlan,
      updatedAt: Timestamp.now()
    });
    try {
      await setDoc(safetyPlanRef, planData, { merge: true });
      setSafetyPlan(newPlan);
    } catch (e) {
      console.error('Failed to save safety plan:', e);
    }
  }, [user]);

  // Longitudinal risk check (Phase 0 - Tier 3)
  useEffect(() => {
    if (!user || entries.length < 3) return;
    const hasRisk = checkLongitudinalRisk(entries);
    if (hasRisk) {
      console.log('Longitudinal risk detected - consider showing proactive support');
    }
  }, [user, entries]);

  // Self-healing: Backfill embeddings for entries that are missing them
  useEffect(() => {
    if (!user || entries.length === 0) return;

    const backfillMissingEmbeddings = async () => {
      const entriesWithoutEmbedding = entries.filter(
        e => !e.embedding || !Array.isArray(e.embedding) || e.embedding.length === 0
      );

      if (entriesWithoutEmbedding.length === 0) return;

      console.log(`Found ${entriesWithoutEmbedding.length} entries without embeddings, backfilling...`);

      const MAX_BACKFILL_PER_SESSION = 5;
      const toBackfill = entriesWithoutEmbedding.slice(0, MAX_BACKFILL_PER_SESSION);

      for (const entry of toBackfill) {
        if (!entry.text || entry.text.trim().length === 0) continue;

        try {
          const embedding = await generateEmbedding(entry.text);
          if (embedding) {
            await updateDoc(
              doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', entry.id),
              { embedding }
            );
            console.log(`Backfilled embedding for entry ${entry.id}`);
          }
        } catch (e) {
          console.error(`Failed to backfill embedding for entry ${entry.id}:`, e);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (entriesWithoutEmbedding.length > MAX_BACKFILL_PER_SESSION) {
        console.log(`${entriesWithoutEmbedding.length - MAX_BACKFILL_PER_SESSION} entries still need embeddings (will process on next session)`);
      }
    };

    const timeoutId = setTimeout(backfillMissingEmbeddings, 2000);
    return () => clearTimeout(timeoutId);
  }, [user, entries.length]);

  // Filter and sort entries by effectiveDate (or createdAt if not set)
  const visible = useMemo(() => {
    const filtered = entries.filter(e => e.category === cat);
    // Sort by effectiveDate if available, otherwise createdAt (descending - newest first)
    return filtered.sort((a, b) => {
      const dateA = a.effectiveDate || a.createdAt;
      const dateB = b.effectiveDate || b.createdAt;
      return dateB - dateA;
    });
  }, [entries, cat]);

  // hasTextMeaningfullyChanged: check if text has meaningfully changed (not
  // just typos/punctuation/whitespace) — only triggers re-extraction if the
  // semantic content is different. Moved to services/entries/entryCorrectionFields.js
  // (plan task C4) so it has direct unit coverage without mounting App.jsx;
  // it's a pure function (no closures), so the plain import binding is a
  // stable reference across renders — safe to use directly in the
  // handleEntryUpdate dependency array below.

  // Handle entry update with date change cache invalidation
  // Options parameter keeps control logic separate from data (Fix A: Control Coupling)
  // FIX: Use runTransaction to atomically read and increment signalExtractionVersion
  const handleEntryUpdate = useCallback(async (entryId, updates, options = {}) => {
    if (!user) return;

    const entryRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', entryId);
    const entry = entries.find(e => e.id === entryId);

    // Only increment signalExtractionVersion if text has meaningfully changed
    // This prevents re-extraction on typo fixes, tag edits, or punctuation changes
    if (updates.text !== undefined) {
      const oldText = entry?.text || '';
      if (hasTextMeaningfullyChanged(oldText, updates.text)) {
        console.log('[handleEntryUpdate] Text meaningfully changed, using transaction for version increment, runId:post-fix');

        // FIX: Use runTransaction to atomically read current version from Firestore and increment
        // This prevents race conditions on concurrent edits
        //
        // Correction invalidation (plan task C4): a meaningful text edit also
        // bumps entryInputVersion (increment sentinel — the server
        // onEntryUpdate trigger keys off `after.entryInputVersion >
        // before.entryInputVersion` to idempotently re-run analysis), and
        // marks the entry's derived data stale until recompute finishes.
        await runTransaction(db, async (transaction) => {
          const entryDoc = await transaction.get(entryRef);
          const currentVersion = entryDoc.data()?.signalExtractionVersion || 1;
          Object.assign(updates, buildMeaningfulEditFields({
            nextSignalExtractionVersion: currentVersion + 1,
            increment,
          }));
          console.log(`[handleEntryUpdate] Incrementing version ${currentVersion} -> ${currentVersion + 1}, runId:post-fix`);
          transaction.update(entryRef, updates);
        });

        // Handle date change cache invalidation after transaction
        if (options.dateChanged) {
          const { oldDate, newDate } = options.dateChanged;
          const category = entry?.category || cat;
          handleEntryDateChange(user.uid, entryId, oldDate, newDate, category)
            .then(result => console.log('Cache invalidation complete:', result))
            .catch(err => console.error('Cache invalidation failed:', err));
        }
        return; // Transaction already applied updates
      } else {
        console.log('Text change is minor (typo/punctuation), skipping re-extraction');
      }
    }

    // Non-text changes or minor text changes - use regular update
    await updateDoc(entryRef, updates);

    // Check if this is a date change that needs cache invalidation
    if (options.dateChanged) {
      const { oldDate, newDate } = options.dateChanged;
      const category = entry?.category || cat;

      // Invalidate caches in the background
      handleEntryDateChange(user.uid, entryId, oldDate, newDate, category)
        .then(result => {
          console.log('Cache invalidation complete:', result);
        })
        .catch(err => {
          console.error('Cache invalidation failed:', err);
        });
    }
  }, [user, entries, cat, hasTextMeaningfullyChanged]);

  // Persist a crisis-flagged pending entry exactly once, regardless of how the
  // user exits the crisis flow. We NEVER discard the entry a user wrote at their
  // most vulnerable moment — crisis resources are shown *in addition to* saving,
  // never instead of it. Cleared optimistically before the await so concurrent
  // exit paths can't double-save. voiceTone (captured on the pending entry) is
  // forwarded so crisis-flagged voice entries don't lose their tone data.
  const persistPendingEntry = useCallback(async (safetyUserResponse) => {
    const entry = pendingEntry;
    if (!entry) return;
    setPendingEntry(null);
    try {
      // No onEntryRef here (see doSaveEntry's jsdoc): this is the deferred
      // crisis-confirm save, resolved on a separate screen/turn after the
      // composer that originally captured the entry has already closed and
      // cleared its onEntrySaved callback — there is no live listener left
      // to hand a real id to by the time this runs.
      const result = await doSaveEntry(
        entry.text,
        entry.safetyFlagged ?? true,
        safetyUserResponse,
        null,
        entry.voiceTone ?? null,
        entry.rawTranscript ?? null,
        entry.operationId ?? null,
        null,
        entry.chapters ?? null,
        entry.durationMs ?? null
      );
      // The recording (if this crisis entry came from voice) was deliberately
      // left unlinked in the vault until the entry actually existed — link it
      // now so the recovery banner stops showing it as unsaved.
      if (result === 'saved' && entry.recordingId) {
        await audioVault.linkEntry(user.uid, entry.recordingId, 'saved');
      }
      // Complete the capture op now that the deferred crisis entry is durable
      // (it was left at 'transcribing' when the crisis modal deferred the save).
      if (result === 'saved' && entry.operationId) {
        await advanceOperation(user.uid, entry.operationId, 'entry_saved').catch(() => {});
        await recordStage(user.uid, entry.operationId, STAGES.ENTRY_SAVED);
        await completeOperation(user.uid, entry.operationId).catch(() => {});
        await recordStage(user.uid, entry.operationId, STAGES.COMPLETE);
      }
    } catch (e) {
      console.error('Failed to persist crisis-flagged entry:', e);
    }
  }, [pendingEntry]);

  const handleCrisisResponse = useCallback(async (response) => {
    setCrisisModal(null);

    // Always save the flagged entry. For 'support'/'crisis' we also surface the
    // resources screen, but the save happens here so the entry survives no
    // matter how the user leaves the resources screen.
    if (response === 'support') {
      setCrisisResources('support');
    } else if (response === 'crisis') {
      setCrisisResources('crisis');
    }
    await persistPendingEntry(response);
  }, [persistPendingEntry]);

  const handleCrisisResourcesContinue = useCallback(async () => {
    setCrisisResources(null);
    // Entry was already persisted in handleCrisisResponse; save here only if it
    // somehow wasn't (defensive — no-op when pendingEntry is already null).
    await persistPendingEntry('support');
  }, [persistPendingEntry]);

  const doSaveEntry = async (
    textInput,
    safetyFlagged = false,
    safetyUserResponse = null,
    temporalContext = null,
    voiceTone = null,
    rawTranscript = null,
    operationId = null,
    // Optional, additive side-channel: fired with the real Firestore doc id
    // the moment addDoc resolves (online paths only — never awaited, never
    // changes this function's own 'saved'/'deferred' return contract that
    // existing callers, e.g. handleAudioWrapper's `saveResult === 'saved'`
    // check, rely on). Lets a caller (AppLayout, for the OpenLoopsWidget
    // "Answer" flow) learn the actual new entry id without this function's
    // return value ever needing to carry it.
    onEntryRef = null,
    // Voice Chapters (Task 14, flag: voiceChapters) — additive: server-
    // validated chapters array (or null) + this recording's total duration.
    // Only meaningful on the core-first save path (buildCoreEntry); the
    // legacy inline-entryData branches below don't build chapters (dormant —
    // coreFirstSave defaults on).
    chapters = null,
    durationMs = null
  ) => {
    if (!user) return;

    console.time('⏱️ TOTAL: Save entry to Firestore');

    let finalTex = textInput;
    if (replyContext) {
      finalTex = `[Replying to: "${replyContext}"]\n\n${textInput}`;
    }

    const hasWarning = checkWarningIndicators(finalTex);

    // TEMPORAL REDESIGN: Always use current date for effectiveDate.
    // Temporal attribution is now handled by signals, not by backdating entries.
    // effectiveDate is kept for backwards compatibility with old entries.
    const now = new Date();
    const effectiveDate = now;  // Always current date - signals handle temporal attribution

    console.log('Saving entry with:', {
      hasTemporalContext: !!temporalContext,
      temporalDetected: temporalContext?.detected,
      effectiveDate: effectiveDate.toDateString(),
      hasVoiceTone: !!voiceTone,
      voiceMood: voiceTone?.moodScore?.toFixed(2),
      note: 'effectiveDate is always current date now - signals handle temporal attribution'
    });

    // Check platform for local analysis capability
    const platform = Capacitor.getPlatform();
    const isNative = platform === 'ios' || platform === 'android';
    const analysisStrategy = getAnalysisStrategy(isOnline);

    console.log('[EntryProcessor] Platform:', platform, 'Strategy:', analysisStrategy.strategy);

    // If offline, use local analysis and queue for sync
    if (!isOnline) {
      console.log('Offline: using local analysis and queuing for sync');

      // Perform local analysis for immediate feedback (iOS/Android only)
      let localAnalysis = null;
      let offlineHealthContext = null;
      if (isNative) {
        try {
          console.time('⏱️ Local Analysis');
          localAnalysis = performLocalAnalysis(finalTex, { voiceTone });
          console.timeEnd('⏱️ Local Analysis');
          console.log('[LocalAnalysis] Result:', {
            entry_type: localAnalysis.entry_type,
            mood_score: localAnalysis.mood_score,
            confidence: localAnalysis.classification_confidence
          });
        } catch (localError) {
          console.warn('[LocalAnalysis] Failed:', localError);
        }
        try {
          offlineHealthContext = await getEntryHealthContext();
        } catch (healthError) {
          console.warn('[EntrySave] Offline health context unavailable:', healthError?.message);
        }
      }

      // Queue with the new offline manager
      const offlineEntry = await queueEntry(user.uid, {
        text: finalTex,
        category: cat,
        createdAt: now.toISOString(),
        effectiveDate: effectiveDate.toISOString(),
        localAnalysis,
        healthContext: offlineHealthContext,
        environmentContext: null,
        aiProcessingConsent: aiProcessingEnabled,
        voiceTone,
        // Context Space (flag: contextSpaces) — same capture-pill selection
        // threaded into buildCoreEntry on the online path; queueEntry omits
        // it entirely when null (no null-stuffing).
        spaceId: captureSpaceId,
        transcription: rawTranscript ? {
          rawTranscript,
          cleanedTranscript: finalTex,
          schemaVersion: 1
        } : undefined,
        safety_flagged: safetyFlagged || undefined,
        safety_user_response: safetyUserResponse || undefined,
        has_warning_indicators: hasWarning || undefined,
        platform
      });

      // The entry is now durably queued in the persistent offline store
      // (offlineManager), which the sync orchestrator drains on reconnect and
      // which useNetworkStatus reflects via pendingCount. We no longer mirror it
      // into a separate in-memory queue that was lost on app restart.
      void offlineEntry;

      setProcessing(false);
      setReplyContext(null);
      return 'saved';
    }

    // Post-save AI pipeline (signal extraction + nexus insight update +
    // server analysis). Extracted verbatim so BOTH the legacy save path and
    // the core-first path (flag: coreFirstSave) fire the exact same
    // non-blocking work once the entry is durable. `localAnalysis`, `related`,
    // `recent`, and `ref` differ per path and are passed in; everything else
    // (finalTex, now, cat, user, entries, setters) is closed over.
    const firePostSaveProcessing = ({ ref, localAnalysis, related, recent }) => {
      // Signal extraction (non-blocking, parallel to analysis)
      // This extracts temporal signals for the DetectedStrip UI
      const runSignals = async () => {
        try {
          console.log('[Signals] Starting signal extraction for entry:', ref.id);
          const result = await processEntrySignals(
            { id: ref.id, userId: user.uid, createdAt: now },
            finalTex,
            1  // Initial extraction version
          );

          if (result && result.signals && result.signals.length > 0) {
            console.log('[Signals] Extracted signals:', result.signals.length, 'hasTemporalContent:', result.hasTemporalContent);

            // If signals with temporal content (not just "today"), show the DetectedStrip
            if (result.hasTemporalContent) {
              setDetectedSignals(result.signals);
              setSignalExtractionEntryId(ref.id);
              setShowDetectedStrip(true);
            }
          } else {
            console.log('[Signals] No signals extracted or simple entry');
          }
        } catch (signalError) {
          // Signal extraction failure shouldn't break the app - log and continue
          console.error('[Signals] Signal extraction failed:', signalError);
        }
      };

      // Nexus 2.0 insight update (non-blocking, parallel)
      // Updates thread associations and marks insights as stale for regeneration
      const runNexus = async () => {
        try {
          console.log('[Nexus] Updating insights for new entry:', ref.id);
          await updateInsightsForNewEntry(
            user.uid,
            ref.id,
            finalTex,
            Number.isFinite(localAnalysis?.mood_score) ? localAnalysis.mood_score : null
          );
          console.log('[Nexus] Incremental insights updated');
        } catch (nexusError) {
          // Nexus failure shouldn't break the app
          console.error('[Nexus] Insight update failed:', nexusError);
        }
      };

      // Analysis pipeline (existing logic). Skipped when the server owns
      // analysis (flag: serverAnalysisOrchestrator) — see runPostSavePipelines.
      const runAnalysisChain = async () => {
        try {
          console.time('⏱️ Classification');
          const classifyResult = await classifyEntry(finalTex);
          console.timeEnd('⏱️ Classification');

          // Extract classification and entity resolution from result
          const classification = classifyResult.classification || classifyResult;
          const entityResolution = classifyResult.entityResolution;

          // Use corrected text for subsequent analysis if entity resolution made corrections
          const textForAnalysis = entityResolution?.correctedText || finalTex;

          if (entityResolution?.corrections?.length > 0) {
            // Do not log entry content or resolved names (PII); count only.
            console.log('[EntityResolution] Name corrections applied:', entityResolution.corrections.length);
          }

          console.log('Entry classification:', classification);

          // Get active reflection prompts for AI detection of answered prompts
          const pendingPrompts = getActiveReflectionPrompts(entries, cat, user?.uid);
          console.log('[Analysis] Pending prompts for detection:', pendingPrompts.length);

          console.time('⏱️ AI Analysis (parallel)');
          const [analysis, insight, enhancedContext] = await Promise.all([
            analyzeEntry(textForAnalysis, classification.entry_type),
            classification.entry_type !== 'task' ? generateInsight(textForAnalysis, related, recent, entries, pendingPrompts) : Promise.resolve(null),
            classification.entry_type !== 'task' ? extractEnhancedContext(textForAnalysis, recent) : Promise.resolve(null)
          ]);
          console.timeEnd('⏱️ AI Analysis (parallel)');

          console.log('Analysis complete:', {
            available: !!analysis,
            hasInsight: !!insight?.found,
            entryType: classification?.entry_type,
            hasEnhancedContext: !!enhancedContext,
          });

          // Auto-dismiss addressed prompts based on AI detection
          if (insight?.addressedPrompts?.length > 0) {
            console.log('[Analysis] AI detected addressed prompts:', insight.addressedPrompts);
            insight.addressedPrompts.forEach(prompt => {
              dismissReflectionPrompt(prompt, cat, user?.uid);
            });
          }

          // Only show decompression for genuinely heavy entries, not just keyword mentions
          // Requires BOTH low mood score AND vent entry type, OR extremely low score
          const isVentEntry = classification.entry_type === 'vent';
          const isExtremelyLow = analysis?.mood_score !== null && analysis.mood_score < 0.2;
          const isLowVent = isVentEntry && analysis?.mood_score !== null && analysis.mood_score < 0.3;
          if (isExtremelyLow || isLowVent) {
            setShowDecompression(true);
          }

          const topicTags = analysis?.tags || [];
          const structuredTags = enhancedContext?.structured_tags || [];
          const contextTopicTags = enhancedContext?.topic_tags || [];
          const allTags = [...new Set([...topicTags, ...structuredTags, ...contextTopicTags])];

          const updateData = {
            title: analysis?.title || "New Memory",
            tags: allTags,
            analysisStatus: 'complete',
            entry_type: classification.entry_type,
            classification_confidence: classification.confidence,
            context_version: CURRENT_CONTEXT_VERSION
          };

          // Update entry text with corrected version if entity resolution made corrections
          // This ensures the user sees correct names (e.g., "Luna" instead of "Lunar")
          if (entityResolution?.correctedText && entityResolution?.corrections?.length > 0) {
            updateData.text = entityResolution.correctedText;
            updateData.originalText = finalTex;  // Preserve original for reference
            updateData.entityResolution = {
              corrections: entityResolution.corrections,
              appliedAt: new Date().toISOString()
            };
          }

          if (enhancedContext?.continues_situation) {
            updateData.continues_situation = enhancedContext.continues_situation;
          }

          if (enhancedContext?.goal_update?.tag) {
            updateData.goal_update = enhancedContext.goal_update;
          }

          if (classification.extracted_tasks && classification.extracted_tasks.length > 0) {
            // Cloud Function returns tasks as [{text: "...", completed: false}]
            // But apply defensive normalization to ensure correct structure
            updateData.extracted_tasks = classification.extracted_tasks.map(t => ({
              text: typeof t === 'string' ? t : (t.text || t),
              completed: t.completed ?? false
            }));
          }

          updateData.analysis = {
            mood_score: analysis?.mood_score,
            framework: analysis?.framework || 'general'
          };

          if (analysis?.cbt_breakdown && typeof analysis.cbt_breakdown === 'object' && Object.keys(analysis.cbt_breakdown).length > 0) {
            updateData.analysis.cbt_breakdown = analysis.cbt_breakdown;
          }

          if (analysis?.act_analysis && typeof analysis.act_analysis === 'object' && Object.keys(analysis.act_analysis).length > 0) {
            updateData.analysis.act_analysis = analysis.act_analysis;
          }

          if (analysis?.vent_support) {
            updateData.analysis.vent_support = analysis.vent_support;
          }

          if (analysis?.celebration && typeof analysis.celebration === 'object') {
            updateData.analysis.celebration = analysis.celebration;
          }

          if (analysis?.task_acknowledgment) {
            updateData.analysis.task_acknowledgment = analysis.task_acknowledgment;
          }

          if (insight?.found) {
            updateData.contextualInsight = insight;
          }

          console.log('Analysis update ready:', {
            status: updateData.analysisStatus,
            entryType: updateData.entry_type,
            tagCount: updateData.tags?.length || 0,
          });

          const cleanedUpdateData = removeUndefined(updateData);

          try {
            console.time('⏱️ Firestore update (analysis)');
            await updateDoc(ref, cleanedUpdateData);
            console.timeEnd('⏱️ Firestore update (analysis)');

            // Background post-processing (non-blocking)
            // Refreshes Core People cache if person mentions detected
            runEntryPostProcessing({
              userId: user.uid,
              entryContent: finalTex,
              analysis: updateData.analysis
            });

            // Show insights popup if there's meaningful content to display
            // Priority: validation > therapeutic tools > pattern insights > encouragement fallback
            const hasValidation = analysis?.cbt_breakdown?.validation ||
                                 analysis?.vent_support?.validation ||
                                 analysis?.act_analysis?.acknowledgment;
            const hasCBTTherapeutic = analysis?.cbt_breakdown?.perspective;
            const hasACT = analysis?.act_analysis?.defusion_phrase;
            const hasCelebration = analysis?.celebration?.affirmation;
            const hasVentCooldown = analysis?.vent_support?.cooldown;
            // Meaningful pattern insights (not encouragement)
            const hasUsefulInsight = insight?.found && insight?.message &&
                                    insight?.type !== 'encouragement';
            // Encouragement as fallback when nothing else is available
            const hasEncouragementFallback = insight?.found && insight?.message &&
                                            insight?.type === 'encouragement' &&
                                            !hasValidation && !hasCBTTherapeutic && !hasACT &&
                                            !hasCelebration && !hasVentCooldown;

            const shouldShowPopup = classification.entry_type !== 'task' &&
                                   (hasValidation || hasCBTTherapeutic || hasACT ||
                                    hasCelebration || hasVentCooldown || hasUsefulInsight ||
                                    hasEncouragementFallback);

            if (shouldShowPopup) {
              // Small delay so the entry appears first, then show the insight
              setTimeout(() => {
                setEntryInsightsPopup({
                  contextualInsight: insight,
                  analysis: updateData.analysis,
                  entryType: classification.entry_type
                });
              }, 500);
            }
          } catch (updateError) {
            console.error('Failed to update document:', updateError);
            throw updateError;
          }
        } catch (error) {
          console.error('Analysis failed, marking entry as failed (no fabricated mood):', error);

          try {
            // Do NOT fabricate a neutral mood_score here. Writing mood_score:0.5
            // marked 'complete' silently poisons longitudinal risk detection —
            // during an AI outage a genuinely declining user would read as a
            // flat, healthy line. Mark the entry 'failed' and omit mood_score so
            // the risk detector skips it and the pending-entry watchdog can retry.
            const fallbackData = {
              title: finalTex.substring(0, 50) + (finalTex.length > 50 ? '...' : ''),
              tags: [],
              analysisStatus: 'failed',
              analysisError: (error?.message || String(error)).slice(0, 200),
              entry_type: 'reflection'
            };

            const cleanedFallbackData = removeUndefined(fallbackData);
            await updateDoc(ref, cleanedFallbackData);
          } catch (fallbackError) {
            console.error('Even fallback update failed:', fallbackError);
          }
        }
      };

      // Signals + nexus always run (not yet server-owned). The analysis chain
      // is skipped when serverAnalysisOrchestrator is on — the server-side
      // onEntryCreatedAnalysis trigger owns classify/analyze/insight/context
      // end-to-end and publishes the same fields; the entries onSnapshot
      // listener (see the Data Feed effect above) delivers the update to the
      // UI, so no popup is shown from this client path when the flag is on.
      runPostSavePipelines({ runSignals, runNexus, runAnalysisChain, getFlag });
    };

    // Core-first save (flag: coreFirstSave): persist the DURABLE core entry
    // BEFORE any optional enrichment, so the user-visible write never blocks on
    // the temporal Gemini call or the sequential health/location/weather
    // fetches. Enrichment runs fire-and-forget afterward against capture-time
    // provenance; missing context stays null and is never fabricated. Safety
    // flags derive from TEXT (safetyFlagged / hasWarning), never enrichment, so
    // the crisis path is preserved exactly.
    if (getFlag('coreFirstSave')) {
      // Local analysis is synchronous, native-only, on-device (no network) —
      // instant, so it stays inline to feed the (unchanged) signals/nexus
      // pipeline. It is NOT written into the core object; the enrichment runner
      // persists the localAnalysis field post-save.
      let coreLocalAnalysis = null;
      if (isNative) {
        try {
          coreLocalAnalysis = performLocalAnalysis(finalTex, { voiceTone });
        } catch (localError) {
          console.warn('[LocalAnalysis] Failed, server analysis will provide results:', localError);
        }
      }

      const related = [];
      const recent = entries.slice(0, 5);

      // Capture-time provenance. coarseLocation is a point-in-time / cached
      // location attempt capped at 2000ms; on timeout it is null and the
      // enrichment runner retries a fresh fix later.
      const capturedAt = now.toISOString();
      const captureTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      let coarseLocation = null;
      try {
        coarseLocation = await Promise.race([
          getCurrentLocation(),
          new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
        ]);
      } catch {
        coarseLocation = null;
      }
      const captureContext = { capturedAt, captureTimezone, coarseLocation };

      try {
        const entryData = buildCoreEntry({
          text: finalTex,
          category: cat,
          user,
          transcription: rawTranscript ? { rawTranscript } : null,
          consentSnapshot: { aiProcessingConsent: aiProcessingEnabled },
          captureContext,
          safety: { safetyFlagged, safetyUserResponse, hasWarning },
          platform,
          voiceTone,
          // Capture-pipeline operation id — lands on the durable core entry so
          // launch resume's duplicate-delivery guard can find this entry by
          // operationId and avoid re-transcribing the same recording.
          operationId,
          // Context Space (flag: contextSpaces) — the capture pill's current
          // selection. null when unscoped/flag-off; buildCoreEntry omits the
          // field entirely in that case (same rule as category).
          spaceId: captureSpaceId,
          // Voice Chapters (Task 14, flag: voiceChapters) — server-validated
          // chapters (or null) + this recording's total duration. buildCoreEntry
          // computes char offsets and omits transcription.chapters entirely on
          // a failed offset walk; never blocks this save either way.
          chapters,
          audioDurationMs: durationMs,
        });

        console.time('⏱️ Firestore save (core-first)');
        const ref = await addDoc(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'), entryData);
        console.timeEnd('⏱️ Firestore save (core-first)');
        console.timeEnd('⏱️ TOTAL: Save entry to Firestore');
        if (onEntryRef) {
          try { onEntryRef(ref.id); } catch (_) { /* best-effort side-channel, never blocks the save */ }
        }

        // Streak celebration — identical gating to the legacy path: never
        // celebrate a safety-flagged or warning-bearing entry.
        try {
          const prevStreak = calculateStreak(entries);
          const nextStreak = calculateStreak([...entries, entryData]);
          if (shouldCelebrateNewStreak(prevStreak, nextStreak, { safetyFlagged, hasWarning })) {
            openStreakCelebration({
              currentStreak: nextStreak.currentStreak,
              previousBest: prevStreak.longestStreak
            });
          }
        } catch (streakError) {
          console.warn('[StreakCelebration] Streak computation failed:', streakError);
        }

        // The core entry is durable — dismiss the composer immediately.
        setProcessing(false);
        setReplyContext(null);

        // Post-save enrichment (fire-and-forget). Runs health / environment /
        // temporal / native-local-analysis against capture-time provenance and
        // writes them back with a single updateDoc. Never blocks, never throws.
        runPostSaveEnrichment({
          entryRef: ref,
          entryData,
          captureContext: { ...captureContext, localAnalysis: coreLocalAnalysis, voiceTone },
        });

        if (!aiProcessingEnabled) {
          console.log('[AI] Processing paused; entry stored without third-party analysis');
          return 'saved';
        }

        // Signals + nexus + server analysis — identical to the legacy path.
        firePostSaveProcessing({ ref, localAnalysis: coreLocalAnalysis, related, recent });

        return 'saved';
      } catch (e) {
        console.error('Save failed:', e);
        // Never lose the entry on a failed online save. Persist it to the
        // durable offline queue (survives app restart, syncs later) instead of
        // dropping it. Enrichment is post-save, so no context is captured here.
        let queuedLocally = false;
        try {
          await queueEntry(user.uid, {
            text: finalTex,
            category: cat,
            createdAt: now.toISOString(),
            effectiveDate: effectiveDate.toISOString(),
            healthContext: null,
            environmentContext: null,
            voiceTone,
            aiProcessingConsent: aiProcessingEnabled,
            transcription: rawTranscript ? {
              rawTranscript,
              cleanedTranscript: finalTex,
              schemaVersion: 1
            } : undefined,
            safety_flagged: safetyFlagged || undefined,
            safety_user_response: safetyUserResponse || undefined,
            has_warning_indicators: hasWarning || undefined,
            platform,
            // Context Space — this is the failed-online-save fallback queue,
            // same selection buildCoreEntry attempted above; must not be lost.
            spaceId: captureSpaceId,
          });
          queuedLocally = true;
          triggerSync().catch(() => {});
        } catch (queueErr) {
          console.error('Failed to queue entry after save failure:', queueErr);
        }

        const errorMessage = queuedLocally
          ? "Couldn't save right now — your entry is stored on this device and will sync automatically."
          : e.code === 'permission-denied'
          ? 'Save failed: Permission denied. Please sign in again.'
          : 'Save failed. Please try again.';
        alert(errorMessage);
        setProcessing(false);
        return queuedLocally ? 'saved' : undefined;
      }
    }

    // OPTIMIZED: Save entry immediately, generate embedding in background
    // This reduces user-perceived latency from ~5.9s to ~0.3s
    // Embedding will be backfilled by Firestore trigger (see functions/index.js)

    // On native platforms, perform local analysis for immediate feedback
    // This runs in parallel with entry save and provides instant mood/classification
    let localAnalysis = null;
    if (isNative) {
      try {
        console.time('⏱️ Local Analysis (native)');
        localAnalysis = performLocalAnalysis(finalTex, { voiceTone });
        console.timeEnd('⏱️ Local Analysis (native)');
        console.log('[LocalAnalysis] Immediate result:', {
          entry_type: localAnalysis.entry_type,
          mood_score: localAnalysis.mood_score?.toFixed(2),
          time_ms: localAnalysis.local_analysis_time_ms
        });
      } catch (localError) {
        console.warn('[LocalAnalysis] Failed, server analysis will provide results:', localError);
      }
    }

    // Skip embedding generation - let server-side trigger handle it
    const embedding = null;

    // Use recent entries for context instead of vector similarity
    // (Vector search requires embedding, which we'll add later)
    const related = [];
    const recent = entries.slice(0, 5);

    // Capture health context (sleep, steps, workout, stress) if available
    let healthContext = null;
    try {
      console.log('[EntrySave] Attempting to capture health context on platform:', platform);
      healthContext = await getEntryHealthContext();
      if (healthContext) {
        console.log('[EntrySave] Health context captured:', {
          source: healthContext.source,
          hasSleep: !!healthContext.sleep?.totalHours,
          hasHeart: !!healthContext.heart?.restingRate,
          hasActivity: !!healthContext.activity?.stepsToday
        });
      } else {
        console.log('[EntrySave] No health context available');
      }
    } catch (healthError) {
      // Health context is optional - don't block entry saving
      console.warn('[EntrySave] Could not capture health context:', healthError.message);
    }

    // Capture location separately (for environment backfill even if weather fails)
    let entryLocation = null;
    try {
      const locationResult = await getCurrentLocation();
      if (locationResult?.latitude && locationResult?.longitude) {
        entryLocation = {
          latitude: locationResult.latitude,
          longitude: locationResult.longitude,
          accuracy: locationResult.accuracy,
          cached: locationResult.cached || false
        };
        console.log('Location captured:', entryLocation);
      }
    } catch (locError) {
      console.warn('Could not capture location:', locError.message);
    }

    // Capture environment context (weather, light, sun times) if available
    let environmentContext = null;
    try {
      environmentContext = await getEntryEnvironmentContext();
      if (environmentContext) {
        console.log('Environment context captured:', {
          weather: environmentContext.weather,
          temp: environmentContext.temperature,
          dayWeather: environmentContext.daySummary?.condition,
          dayTempHigh: environmentContext.daySummary?.tempHigh,
          lightContext: environmentContext.lightContext
        });
      }
    } catch (envError) {
      // Environment context is optional - don't block entry saving
      console.warn('Could not capture environment context:', envError.message);
    }

    try {
      const entryData = {
        text: finalTex,
        category: cat,
        analysisStatus: aiProcessingEnabled ? 'pending' : 'disabled',
        aiProcessingConsent: aiProcessingEnabled,
        embedding,
        createdAt: Timestamp.now(),
        effectiveDate: Timestamp.fromDate(effectiveDate),
        userId: user.uid,
        // Signal extraction version - increments on each edit for race condition handling
        signalExtractionVersion: 1,
        // Platform tracking - enables health context backfill for web entries when opened on mobile
        createdOnPlatform: platform,
        needsHealthContext: !healthContext && !isNative // Flag web entries that need health data
      };

      if (rawTranscript) {
        entryData.transcription = {
          rawTranscript,
          cleanedTranscript: finalTex,
          schemaVersion: 1,
          correctedByUser: false
        };
      }

      // Store health context if available (from Apple Health / Google Fit)
      if (healthContext) {
        entryData.healthContext = healthContext;
      }

      // Store environment context if available (weather, light, sun times)
      if (environmentContext) {
        entryData.environmentContext = environmentContext;
      }

      // Store location separately (enables environment backfill even if weather fetch failed)
      if (entryLocation) {
        entryData.location = entryLocation;
      }

      // Store voice tone analysis if available (from voice recording)
      if (voiceTone) {
        entryData.voiceTone = {
          moodScore: voiceTone.moodScore,
          energy: voiceTone.energy,
          emotions: voiceTone.emotions,
          confidence: voiceTone.confidence,
          summary: voiceTone.summary,
          analyzedAt: Timestamp.now()
        };
        // Also set initial analysis mood from voice tone if confidence is high enough
        if (voiceTone.confidence >= 0.6) {
          entryData.voiceMoodScore = voiceTone.moodScore;
        }
      }

      // Store local analysis for immediate display (native platforms only)
      // Server analysis will run in background and update with richer results
      if (localAnalysis) {
        entryData.localAnalysis = {
          entry_type: localAnalysis.entry_type,
          mood_score: localAnalysis.mood_score,
          classification_confidence: localAnalysis.classification_confidence,
          sentiment_confidence: localAnalysis.sentiment_confidence,
          extracted_tasks: localAnalysis.extracted_tasks || [],
          analyzed_at: new Date().toISOString(),
          analysis_time_ms: localAnalysis.local_analysis_time_ms
        };
        // Use local results as initial analysis (will be updated by server)
        entryData.entry_type = localAnalysis.entry_type;
        entryData.title = finalTex.substring(0, 50) + (finalTex.length > 50 ? '...' : '');
        entryData.analysis = {
          mood_score: localAnalysis.mood_score,
          framework: 'local_pending_server'
        };
        // Mark that we have local analysis, server should still run
        entryData.hasLocalAnalysis = true;
      }

      // Store temporal context if detected (past reference)
      if (temporalContext?.detected && temporalContext?.reference) {
        entryData.temporalContext = {
          detected: true,
          reference: temporalContext.reference,
          originalPhrase: temporalContext.originalPhrase,
          confidence: temporalContext.confidence,
          backdated: effectiveDate.toDateString() !== now.toDateString()
        };
      }

      // futureMentions is intentionally no longer persisted (retired —
      // Open Loops replaced it in R1). temporalContext above still
      // captures the past-reference detection.

      if (safetyFlagged) {
        entryData.safety_flagged = true;
        if (safetyUserResponse) {
          entryData.safety_user_response = safetyUserResponse;
        }
      }

      if (hasWarning) {
        entryData.has_warning_indicators = true;
      }

      console.log('📝 Entry data being saved:', {
        hasHealthContext: !!entryData.healthContext,
        healthContext: entryData.healthContext,
        hasEnvironmentContext: !!entryData.environmentContext
      });
      console.time('⏱️ Firestore save');
      const ref = await addDoc(collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'), entryData);
      console.timeEnd('⏱️ Firestore save');
      console.timeEnd('⏱️ TOTAL: Save entry to Firestore');
      if (onEntryRef) {
        try { onEntryRef(ref.id); } catch (_) { /* best-effort side-channel, never blocks the save */ }
      }

      // Streak celebration (D4b, CLOUD-DESIGN-SPEC.md §7): the just-saved
      // entry isn't in `entries` yet (the Firestore onSnapshot listener that
      // populates it hasn't fired), so diff a "before" streak (current
      // `entries`) against an "after" streak (`entries` + the just-built
      // entryData) using the shared calculateStreak() helper — the same one
      // MiniStatsWidget's streak cell reads from, per the plan.
      //
      // shouldCelebrateNewStreak() (services/dashboard/index.js) owns the
      // "is this actually a new personal best, and is it safe to celebrate"
      // decision — pulled out to a pure function so the safety-adjacency
      // gate (2026-07-18 reviewer fix, CRITICAL C1 / IMPORTANT I1) has real
      // unit-test coverage without mounting this untested save flow. It
      // gates off entirely when `safetyFlagged` (this save came through the
      // crisis flow) or `hasWarning` (checkWarningIndicators(finalTex),
      // computed synchronously above — the best *available-at-save-time*
      // proxy for "heavy entry," NOT the same signal as the
      // DecompressionScreen trigger a few lines down, which is mood-score-
      // based and only resolves later in the async analysis pipeline; see
      // that function's doc comment and task-D4b-report.md for the full
      // caveat on this residual, narrower gap).
      try {
        const prevStreak = calculateStreak(entries);
        const nextStreak = calculateStreak([...entries, entryData]);
        if (shouldCelebrateNewStreak(prevStreak, nextStreak, { safetyFlagged, hasWarning })) {
          openStreakCelebration({
            currentStreak: nextStreak.currentStreak,
            previousBest: prevStreak.longestStreak
          });
        }
      } catch (streakError) {
        console.warn('[StreakCelebration] Streak computation failed:', streakError);
      }

      setProcessing(false);
      setReplyContext(null);

      if (!aiProcessingEnabled) {
        console.log('[AI] Processing paused; entry stored without third-party analysis');
        return 'saved';
      }

      firePostSaveProcessing({ ref, localAnalysis, related, recent });

      return 'saved';
    } catch (e) {
      console.error('Save failed:', e);
      // Never lose the entry on a failed online save. Persist it to the durable
      // offline queue (survives app restart, syncs on next opportunity) instead
      // of dropping it behind an alert with the composer already cleared.
      let queuedLocally = false;
      try {
        await queueEntry(user.uid, {
          text: finalTex,
          category: cat,
          createdAt: now.toISOString(),
          effectiveDate: effectiveDate.toISOString(),
          healthContext,
          environmentContext,
          voiceTone,
          aiProcessingConsent: aiProcessingEnabled,
          transcription: rawTranscript ? {
            rawTranscript,
            cleanedTranscript: finalTex,
            schemaVersion: 1
          } : undefined,
          safety_flagged: safetyFlagged || undefined,
          safety_user_response: safetyUserResponse || undefined,
          has_warning_indicators: hasWarning || undefined,
          platform,
          // Context Space — legacy (non-core-first) save-failure fallback
          // queue; must not silently drop the capture pill's selection.
          spaceId: captureSpaceId,
        });
        queuedLocally = true;
        triggerSync().catch(() => {});
      } catch (queueErr) {
        console.error('Failed to queue entry after save failure:', queueErr);
      }

      const errorMessage = queuedLocally
        ? "Couldn't save right now — your entry is stored on this device and will sync automatically."
        : e.code === 'permission-denied'
        ? 'Save failed: Permission denied. Please sign in again.'
        : 'Save failed. Please try again.';
      alert(errorMessage);
      setProcessing(false);
      return queuedLocally ? 'saved' : undefined;
    }
  };

  const saveEntry = async (textInput, voiceTone = null, options = {}) => {
    // onEntryRef: optional side-channel, see doSaveEntry's jsdoc — additive,
    // never changes this function's own 'deferred'/'saved' return contract.
    // chapters/durationMs: Voice Chapters (Task 14, flag: voiceChapters) —
    // additive, threaded straight through to buildCoreEntry; absent/null on
    // typed entries and voice entries without markers.
    const {
      recordingId, rawTranscript = null, operationId = null, onEntryRef = null,
      chapters = null, durationMs = null,
    } = options;
    if (!user) return;
    setProcessing(true);
    console.log('[SaveEntry] Starting save process, text length:', textInput.length, 'hasVoiceTone:', !!voiceTone);

    // Check for crisis keywords first (safety priority)
    const hasCrisis = checkCrisisKeywords(textInput);
    if (hasCrisis) {
      console.log('[SaveEntry] Crisis keywords detected, showing modal');
      setPendingEntry({
        text: textInput,
        rawTranscript,
        safetyFlagged: true,
        voiceTone,
        recordingId,
        // operationId travels with the deferred entry so the crisis-confirm
        // save writes it onto the entry doc and completes the capture op.
        operationId,
        // Voice Chapters (Task 14) — must survive the crisis-deferred save
        // just like rawTranscript/voiceTone above.
        chapters,
        durationMs,
      });
      setCrisisModal(true);
      setProcessing(false);
      return 'deferred';
    }

    // Core-first save (flag: coreFirstSave): temporal detection is no longer a
    // blocking pre-save Gemini call — it moved into the post-save enrichment
    // runner (see doSaveEntry). Skip the 45s temporal await entirely and go
    // straight to the durable core write.
    if (getFlag('coreFirstSave')) {
      return await doSaveEntry(textInput, false, null, null, voiceTone, rawTranscript, operationId, onEntryRef, chapters, durationMs);
    }

    // Detect temporal context (Phase 2)
    // Add timeout for mobile reliability (45s for very long entries)
    try {
      const temporalPromise = detectTemporalContext(textInput);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Temporal detection timeout')), 45000)
      );
      const temporal = await Promise.race([temporalPromise, timeoutPromise]);
      console.log('[SaveEntry] Temporal detection result:', {
        detected: temporal.detected,
        effectiveDate: temporal.effectiveDate,
        reference: temporal.reference,
        confidence: temporal.confidence,
        futureMentions: temporal.futureMentions?.length || 0,
        needsConfirm: temporal.detected ? (temporal.confidence >= 0.5 && temporal.confidence <= 0.8) : false,
        willAutoBackdate: temporal.detected && temporal.confidence > 0.8,
        reasoning: temporal.reasoning
      });

      // TEMPORAL REDESIGN: No longer backdate entries or show confirmation modal.
      // All entries are saved with current date (recordedAt).
      // Temporal attribution is now handled by signal extraction (DetectedStrip UI).
      // The temporal context is still passed to doSaveEntry for backwards compat,
      // but effectiveDate is now always set to current date.

      if (temporal.detected) {
        console.log('[SaveEntry] Temporal content detected - signals will handle attribution');
        console.log('[SaveEntry] Skipping backdate modal (deprecated) - using signal extraction instead');
      }

      // Always save with current date - signals handle temporal attribution
      return await doSaveEntry(
        textInput,
        false,
        null,
        temporal.detected ? temporal : null,
        voiceTone,
        rawTranscript,
        operationId,
        onEntryRef,
        chapters,
        durationMs
      );
    } catch (e) {
      console.error('Temporal detection failed, saving normally:', e);
      return await doSaveEntry(textInput, false, null, null, voiceTone, rawTranscript, operationId, onEntryRef, chapters, durationMs);
    }
  };

  // Handle signal confirmation (DetectedStrip)
  const handleSignalConfirmAll = useCallback(async () => {
    if (!user || detectedSignals.length === 0) return;

    try {
      const signalIds = detectedSignals.map(s => s.id).filter(Boolean);
      if (signalIds.length > 0) {
        await batchUpdateSignalStatus(signalIds, user.uid, 'verified');
        console.log('[Signals] Confirmed all signals:', signalIds.length);
      }
    } catch (error) {
      console.error('[Signals] Failed to confirm signals:', error);
    }

    setDetectedSignals([]);
    setShowDetectedStrip(false);
    setSignalExtractionEntryId(null);
  }, [user, detectedSignals]);

  const handleSignalDismiss = useCallback(async (signalId) => {
    if (!user || !signalId) return;

    try {
      await updateSignalStatus(signalId, user.uid, 'dismissed');
      console.log('[Signals] Dismissed signal:', signalId);

      // Remove from local state
      setDetectedSignals(prev => prev.filter(s => s.id !== signalId));

      // If no signals left, close the strip
      if (detectedSignals.length <= 1) {
        setShowDetectedStrip(false);
        setSignalExtractionEntryId(null);
      }
    } catch (error) {
      console.error('[Signals] Failed to dismiss signal:', error);
    }
  }, [user, detectedSignals.length]);

  const handleSignalStripClose = useCallback(() => {
    // Close without confirming - signals remain as 'active'
    setShowDetectedStrip(false);
    setDetectedSignals([]);
    setSignalExtractionEntryId(null);
  }, []);

  const handleAudioWrapper = async (base64, mime, options = {}) => {
    // onEntryRef: optional side-channel forwarded through to saveEntry/
    // doSaveEntry, see doSaveEntry's jsdoc — additive, never changes this
    // function's own boolean return contract.
    const {
      existingRecordingId, nativeDraftId, operationId: resumeOperationId, onEntryRef = null,
      // Voice Chapters (flag: voiceChapters) — present only when EntryBar
      // (fresh save) or PendingAudioBanner (retry, re-read from the vault
      // index) has them; undefined otherwise, threaded straight through to
      // the vault entry / op record with no empty-array stuffing.
      markers, durationMs,
    } = options;
    if (!aiProcessingEnabled) {
      setNeedsAiConsent(true);
      return false;
    }
    console.log('[Transcription] handleAudioWrapper called');
    console.log('[Transcription] Audio data received:', {
      base64Length: base64?.length || 0,
      mime,
      estimatedSizeKB: Math.round((base64?.length || 0) / 1024)
    });

    if (!base64 || base64.length < 100) {
      console.error('[Transcription] Invalid audio data received');
      alert('No audio data received. Please try recording again.');
      return false;
    }

    // Reentrancy guard: a second recording (or a banner "Retry now" click)
    // firing while a pipeline is already in flight must not start a second
    // transcription+save pipeline for the same or another recording.
    if (processing) {
      console.log('[Transcription] handleAudioWrapper called while already processing — ignoring');
      return false;
    }

    setProcessing(true);

    // Request wake lock to prevent iOS from killing the request during long transcriptions
    const wakeLockAcquired = await requestWakeLock();
    console.log('[Transcription] Wake lock acquired:', wakeLockAcquired);

    // Durable local backup BEFORE any network call — recordings must never
    // depend on a successful cloud round-trip. The durability invariant is
    // enforced here: if the vault write fails we BLOCK transcription and keep
    // the native draft (the previous durable copy) in place, rather than
    // proceeding with no local copy at all. The native draft is deleted ONLY
    // after the vault confirms (inside prepareDurableRecording).
    const prep = await prepareDurableRecording({
      ownerUid: user.uid,
      base64,
      mimeType: mime,
      existingRecordingId,
      audioVault,
      // Only hand off (and thereby delete) the native draft on native.
      nativeDraftId: Capacitor.isNativePlatform() ? nativeDraftId : undefined,
      deleteNativeDraft,
      markers,
      durationMs,
    });

    if (!prep.ok) {
      // Could not secure a durable local copy — do NOT transcribe. Surface the
      // same "saved locally, retry" affordance transcription failures use; the
      // recording (native draft) is untouched and still recoverable.
      console.warn('[Transcription] Durable local copy failed — blocking transcription:', prep.reason);
      if (resumeOperationId) {
        // A resumed op that still can't secure a copy: bump attempts + surface.
        await markNeedsAttention(user.uid, resumeOperationId, prep.reason).catch(() => {});
      }
      await recordStage(user.uid, resumeOperationId || null, STAGES.NEEDS_ATTENTION, { errorCode: prep.reason });
      setProcessing(false);
      releaseWakeLock();
      alert("Couldn't secure a local copy of your recording, so we didn't send it for transcription. Nothing was lost — please try again.");
      return false;
    }

    const recordingId = prep.recordingId;
    console.log('[Transcription] Audio saved to vault:', recordingId);

    // Durable operation record — the source of truth that survives an app kill
    // and drives idempotent launch resume. Reuse the existing op on a retry/
    // resume; otherwise create a fresh one now that the recording is durable.
    // Review note (task-13): markers/durationMs are only ever WRITTEN below,
    // in createOperation, when a fresh op is created. A REUSED op
    // (resumeOperationId, or one found via findByRecordingId just below)
    // keeps whatever markers it already has — this call's `options.markers`
    // is never re-applied to it. That's deliberate, not a gap: the vault
    // index entry (and the existing op record derived from it) is retry's
    // source of truth for markers, so a stale/absent `options.markers` on
    // some particular resume/retry call can never silently clobber markers
    // that were already durably recorded on the original attempt.
    let operationId = resumeOperationId || null;
    if (!operationId && existingRecordingId) {
      const existingOp = await findByRecordingId(user.uid, recordingId).catch(() => null);
      operationId = existingOp?.opId || null;
    }
    if (!operationId) {
      const op = await createOperation(user.uid, { recordingId, markers, durationMs }).catch(() => null);
      operationId = op?.opId || null;
    }
    await recordStage(user.uid, operationId, STAGES.LOCAL_READY, {});

    // Tracks whether the operation reached a definitive resting state
    // (completed, or deliberately deferred to the crisis flow). If it did NOT
    // — i.e. transcription/save failed definitively — the finally block bumps
    // attempts + marks the op needs_attention so it surfaces and the auto-retry
    // cap can eventually stop looping. An app killed mid-pipeline never reaches
    // finally, so it stays in-flight and is auto-retried on next launch.
    let operationSettled = false;
    // The real error code for a transient failure, threaded into the finally
    // block's markNeedsAttention (instead of a hardcoded string). Terminal
    // outcomes (no-speech/bad-request) don't use this — they route the op to
    // the 'abandoned' resting state inline and set operationSettled.
    let failureCode = 'transcription-failed';

    // Route a terminal (non-retryable) outcome to the 'abandoned' resting
    // state with its real error code, then settle so finally doesn't also mark
    // it needs_attention. Abandoned ops are excluded from launch resume and
    // pruned after 24h, so blank recordings never accrete as permanent items.
    const abandonForTerminalOutcome = async (code) => {
      if (operationId) {
        await abandonOperation(user.uid, operationId, code).catch(() => {});
      }
      operationSettled = true;
    };

    try {
      if (operationId) {
        await advanceOperation(user.uid, operationId, 'transcribing');
        await recordStage(user.uid, operationId, STAGES.TRANSCRIBE_START);
      }
      console.log('[Transcription] Starting transcription+tone API call...');
      const startTime = Date.now();
      const properNouns = Array.from(new Set([
        'WHOOP',
        'Engram',
        ...entries.flatMap((entry) => (entry.tags || []))
          .filter((tag) => typeof tag === 'string' && tag.startsWith('@person:'))
          .map((tag) => tag.slice('@person:'.length).replace(/_/g, ' '))
      ])).slice(0, 50);
      // Voice Chapters (Task 14, flag: voiceChapters) — markers/durationMs
      // (destructured from options above) MUST be forwarded here: this is
      // the only call site that invokes transcribeEntryFused, and its
      // markers/durationMs params (positions 5/6) are what let the server
      // build the chapters contract at all. Dropping them here silently
      // disables chapter segmentation end-to-end even though every layer
      // below (transcription.js, fusedTranscription.js, buildCoreEntry.js)
      // is fully wired — see transcription.test.js's "markers / chapters"
      // describe block for the call-contract this depends on.
      const result = USE_FUSED_TRANSCRIPTION
        ? await transcribeEntryFused(base64, mime, 3, properNouns, markers, durationMs)
        : await transcribeAudioWithTone(base64, mime);
      console.log('[Transcription] API call completed in', Date.now() - startTime, 'ms');

      // Handle error codes (string responses)
      if (typeof result === 'string') {
        if (result === 'API_RATE_LIMIT') {
          // Transient — leave in-flight/needs_attention so it can be retried.
          failureCode = 'rate-limit';
          alert("Too many requests - please wait a moment and try again");
          setProcessing(false);
          releaseWakeLock();
          return false;
        }

        if (result === 'API_AUTH_ERROR') {
          failureCode = 'auth-error';
          alert("API authentication error - please check settings");
          setProcessing(false);
          releaseWakeLock();
          return false;
        }

        if (result === 'API_BAD_REQUEST') {
          // Terminal — malformed audio won't succeed on retry.
          await abandonForTerminalOutcome('bad-request');
          alert("Audio format not supported - please try recording again");
          setProcessing(false);
          releaseWakeLock();
          return false;
        }

        if (result === 'API_NO_CONTENT') {
          // Silent/near-silent audio — terminal (retrying gets the same
          // result). Route the op to the 'abandoned' resting state so it
          // doesn't linger as a permanent needs_attention item; audio stays
          // vaulted as an orphan, same as before.
          await abandonForTerminalOutcome('no-speech');
          alert("No speech detected - please try speaking closer to the microphone");
          setProcessing(false);
          releaseWakeLock();
          return false;
        }

        if (result.startsWith('API_')) {
          // Generic API failure (network / retry-exhausted) — transient.
          failureCode = result.toLowerCase().replace(/_/g, '-');
          alert("Transcription failed after multiple attempts. Please check your network connection and try again. Your recording has been saved locally.");
          setProcessing(false);
          releaseWakeLock();
          return false;
        }
      }

      const { transcript, rawTranscript = transcript, toneAnalysis, chapters = null } = result;
      console.log('[Transcription] Result:', {
        hasToneAnalysis: !!toneAnalysis,
        toneEnergy: toneAnalysis?.energy,
        toneMood: toneAnalysis?.moodScore?.toFixed(2)
      });

      if (!transcript) {
        // Empty result with no error code — treat as transient (retryable).
        failureCode = 'empty-transcript';
        alert("Transcription failed - please try again. Your recording has been saved locally.");
        setProcessing(false);
        releaseWakeLock();
        return false;
      }

      if (transcript.includes("NO_SPEECH")) {
        // Terminal — no speech in the audio; won't change on retry.
        await abandonForTerminalOutcome('no-speech');
        alert("No speech detected - please try speaking closer to the microphone");
        setProcessing(false);
        releaseWakeLock();
        return false;
      }

      // Transcription successful - keep the raw audio for RETENTION_DAYS
      // (replay/original). Save the entry first; only link (and thereby
      // remove it from the recovery banner) once saveEntry has actually
      // completed, so a failure between here and there leaves the
      // recording correctly flagged as an orphan.
      console.log('[Transcription] Success! Saving entry...');

      // Pass voice tone analysis to saveEntry
      console.log('[Transcription] Calling saveEntry with transcript length:', transcript.length, 'voiceTone:', !!toneAnalysis);
      const saveResult = await saveEntry(transcript, toneAnalysis, {
        recordingId,
        rawTranscript,
        operationId,
        onEntryRef,
        // Voice Chapters (Task 14, flag: voiceChapters) — chapters is the raw
        // server-validated array (or null); durationMs is this recording's
        // total length, captured alongside markers (Task 13).
        chapters,
        durationMs,
      });
      console.log('[Transcription] saveEntry completed with result:', saveResult);
      // Only link (and thereby clear it from the recovery banner) once the
      // entry actually exists. When the crisis flow deferred the save,
      // recordingId travels with pendingEntry and gets linked at the
      // crisis-confirm site once the entry is actually persisted — leave it
      // as an orphan here in the meantime rather than link something that
      // doesn't exist yet.
      if (saveResult === 'saved') {
        if (operationId) {
          await advanceOperation(user.uid, operationId, 'entry_saved');
          await recordStage(user.uid, operationId, STAGES.ENTRY_SAVED);
        }
        if (recordingId) {
          await audioVault.linkEntry(user.uid, recordingId, 'saved');
          if (operationId) {
            await completeOperation(user.uid, operationId);
            await recordStage(user.uid, operationId, STAGES.COMPLETE);
          }
        }
        operationSettled = true;
      } else if (saveResult === 'deferred') {
        // Crisis flow: the entry save is deferred until the user answers the
        // crisis modal. The op is deliberately left at 'transcribing' (NOT a
        // failure); the entry carries operationId once the crisis save
        // completes, so launch resume's duplicate-delivery guard finds it and
        // completes the op without re-transcribing.
        operationSettled = true;
      }
      // The crisis-deferred case must reach the caller distinguishably from
      // a genuine failure (I1) — persistPendingEntry finishes this save on
      // a later turn with no live listener, so it is a real (eventual) save,
      // not a failure. Preserve it as the string 'deferred' instead of
      // collapsing it into the same `false` a real failure returns; the
      // `saveResult === 'saved'` / `'deferred'` checks above are unaffected,
      // they compare against `saveResult`, not this return value.
      return saveResult === 'deferred' ? 'deferred' : saveResult === 'saved';
    } catch (error) {
      console.error('[Transcription] handleAudioWrapper error:', error);
      console.error('[Transcription] Error details:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        stack: error?.stack?.substring?.(0, 500)
      });
      // Transient — record the real error code for the finally-path surface.
      failureCode = error?.code || 'transcription-error';
      alert("An error occurred during transcription. Your recording has been saved locally. Please try again.");
      setProcessing(false);
      return false;
    } finally {
      // A transient failure (network/API error, empty transcript, save
      // exception) that reached here without settling the op: bump attempts +
      // mark needs_attention with the REAL error code so it surfaces in the
      // reliability center and the auto-retry cap can eventually stop looping.
      // (Terminal no-speech/bad-request outcomes already settled to
      // 'abandoned', so this is skipped for them.)
      if (operationId && !operationSettled) {
        await markNeedsAttention(user.uid, operationId, failureCode).catch(() => {});
        await recordStage(user.uid, operationId, STAGES.NEEDS_ATTENTION, { errorCode: failureCode });
      }
      console.log('[Transcription] Releasing wake lock');
      releaseWakeLock();
    }
  };

  // Handle sign-in with logging - supports both web and native
  const handleSignIn = async () => {
    console.log('[Engram] Sign-in button clicked, attempting Google sign-in...');
    const isNative = Capacitor.isNativePlatform();

    try {
      if (isNative) {
        // Native iOS/Android: Use Capacitor social login plugin via registerPlugin
        console.log('[Engram] Using native Google Sign-In...');
        const SocialLogin = registerPlugin('SocialLogin');

        // Initialize with iOS client ID
        // Note: webClientId is needed for Firebase idToken, iosClientId for native iOS
        await SocialLogin.initialize({
          google: {
            webClientId: import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID,
            iOSClientId: import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID,
            iOSServerClientId: import.meta.env.VITE_GOOGLE_IOS_SERVER_CLIENT_ID,
          }
        });

        const response = await SocialLogin.login({
          provider: 'google',
          options: {
            scopes: ['email', 'profile']
          }
        });

        console.log('[Engram] Native sign-in response:', response);

        if (response?.result?.idToken) {
          console.log('[Engram] Got idToken, using Cloud Function to exchange for Firebase token...');

          try {
            // Use direct fetch to Cloud Function instead of httpsCallable
            // httpsCallable may also hang in WKWebView like signInWithCredential
            console.log('[Engram] Calling exchangeGoogleToken via fetch...');

            const functionUrl = 'https://us-central1-echo-vault-app.cloudfunctions.net/exchangeGoogleToken';

            const fetchResponse = await fetch(functionUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                data: { idToken: response.result.idToken }
              })
            });

            console.log('[Engram] Fetch response status:', fetchResponse.status);

            if (!fetchResponse.ok) {
              const errorText = await fetchResponse.text();
              console.error('[Engram] Cloud Function error:', errorText);
              throw new Error(`Cloud Function failed: ${fetchResponse.status} - ${errorText}`);
            }

            const exchangeResult = await fetchResponse.json();
            console.log('[Engram] Cloud Function returned:', exchangeResult.result?.user?.email);

            // Firebase callable functions wrap the response in { result: ... }
            const resultData = exchangeResult.result || exchangeResult;

            if (!resultData?.customToken) {
              console.error('[Engram] No custom token in response:', exchangeResult);
              throw new Error('Cloud Function did not return a custom token');
            }

            // Try signInWithCustomToken with initializeAuth (should work now)
            // If it still hangs, fall back to REST API
            console.log('[Engram] Signing in with custom token...');

            let signInCompleted = false;
            let signInError = null;
            let signInResult = null;

            // Start signInWithCustomToken (non-blocking)
            signInWithCustomToken(auth, resultData.customToken)
              .then((result) => {
                signInCompleted = true;
                signInResult = result;
                console.log('[Engram] signInWithCustomToken resolved! User:', result.user?.uid);
              })
              .catch((err) => {
                signInCompleted = true;
                signInError = err;
                console.error('[Engram] signInWithCustomToken rejected:', err.code, err.message);
              });

            // Wait up to 5 seconds for SDK sign-in
            console.log('[Engram] Waiting for SDK sign-in (5s timeout)...');
            for (let i = 0; i < 10; i++) {
              await new Promise(resolve => setTimeout(resolve, 500));
              if (signInCompleted || auth.currentUser) break;
            }

            // If SDK worked, we're done
            if (auth.currentUser) {
              console.log('[Engram] Sign-in successful via SDK! User:', auth.currentUser.email);
            } else if (signInCompleted && signInResult) {
              console.log('[Engram] Sign-in completed! User:', signInResult.user?.email);
            } else if (signInError) {
              throw signInError;
            } else {
              // SDK is hanging - use REST API fallback (Gemini's suggestion)
              console.log('[Engram] SDK hanging, trying REST API fallback...');

              const API_KEY = import.meta.env.VITE_FIREBASE_API_KEY;
              if (!API_KEY) {
                throw new Error('Firebase API key is required for authentication');
              }
              const restUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`;

              const restResponse = await fetch(restUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  token: resultData.customToken,
                  returnSecureToken: true,
                }),
              });

              const restData = await restResponse.json();
              console.log('[Engram] REST API response:', restData.localId ? 'success' : 'failed');

              if (restData.error) {
                throw new Error(restData.error.message);
              }

              // REST API worked - we have idToken and refreshToken
              // Store them and wait for auth state to update
              console.log('[Engram] REST API returned tokens, user:', restData.localId);

              // The auth state listener should pick up the change
              // Wait a bit more for it
              for (let i = 0; i < 10; i++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                if (auth.currentUser) {
                  console.log('[Engram] User detected after REST:', auth.currentUser.uid);
                  break;
                }
              }

              if (!auth.currentUser) {
                // Last resort: show success anyway since REST worked
                console.warn('[Engram] Auth state not updated but REST succeeded');
                alert('Sign-in successful! Please restart the app if it doesn\'t update.');
              }
            }

          } catch (fbError) {
            console.error('[Engram] Firebase auth failed:', fbError);
            console.error('[Engram] Error details:', fbError?.message, fbError?.code);

            // Handle specific Cloud Function errors
            if (fbError.code === 'functions/unauthenticated') {
              alert('Google token verification failed. Please try signing in again.');
            } else if (fbError.code === 'functions/internal') {
              alert('Server error during sign-in. Please try again.');
            } else {
              alert(`Sign-in failed: ${fbError?.message || String(fbError)}`);
            }
            throw fbError;
          }
        } else if (response?.result?.accessToken?.token) {
          // Fallback: some configurations return accessToken instead
          console.log('[Engram] No idToken, accessToken not supported with Cloud Function approach');
          alert('Sign-in configuration error. Please contact support.');
          throw new Error('accessToken sign-in not supported');
        } else {
          console.error('[Engram] No idToken or accessToken in response');
          throw new Error('No ID token or access token received from Google Sign-In');
        }
      } else {
        // Web: Use popup-based sign-in
        console.log('[Engram] Using web popup sign-in...');
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        console.log('[Engram] Sign-in successful:', result.user?.uid);
      }
    } catch (error) {
      console.error('[Engram] Sign-in error:', error.code || error.name, error.message);
      if (error.code === 'auth/popup-blocked') {
        alert('Sign-in popup was blocked. Please allow popups for this site.');
      } else if (error.code === 'auth/popup-closed-by-user') {
        console.log('[Engram] User closed the popup');
      } else if (error.code === 'auth/cancelled-popup-request') {
        console.log('[Engram] Popup request was cancelled - please try again');
      } else if (error.code === 'auth/unauthorized-domain') {
        alert('This domain is not authorized for sign-in. Please contact support.');
        console.error('[Engram] Domain not authorized. Add this domain to Firebase Console > Authentication > Settings > Authorized domains');
      } else if (error.message?.includes('cancelled') || error.message?.includes('canceled')) {
        console.log('[Engram] Sign-in was cancelled by user');
      } else if (error.message?.includes('timeout')) {
        // Already handled above, don't show another alert
        console.log('[Engram] Timeout error already handled');
      } else {
        alert(`Sign-in failed: ${error.message}`);
      }
    }
  };

  // Handle Apple Sign-In (required for iOS App Store)
  const handleAppleSignIn = async () => {
    console.log('[Engram] Sign-in button clicked, attempting Apple sign-in...');
    const isNative = Capacitor.isNativePlatform();

    try {
      if (isNative) {
        // Native iOS: Use Capacitor social login plugin
        console.log('[Engram] Using native Apple Sign-In...');
        const SocialLogin = registerPlugin('SocialLogin');

        // Initialize Apple provider
        await SocialLogin.initialize({
          apple: {
            clientId: 'com.echovault.engram', // Your app's bundle ID
            redirectUrl: 'https://echo-vault-app.firebaseapp.com/__/auth/handler'
          }
        });

        const response = await SocialLogin.login({
          provider: 'apple',
          options: {
            scopes: ['email', 'name']
          }
        });

        console.log('[Engram] Apple sign-in response:', response);

        if (response?.result?.identityToken) {
          console.log('[Engram] Got Apple identityToken, exchanging for Firebase token...');

          const functionUrl = 'https://us-central1-echo-vault-app.cloudfunctions.net/exchangeAppleToken';

          const fetchResponse = await fetch(functionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                identityToken: response.result.identityToken,
                user: response.result.user // Contains name/email on first sign-in
              }
            })
          });

          if (!fetchResponse.ok) {
            const errorText = await fetchResponse.text();
            console.error('[Engram] Cloud Function error:', errorText);
            throw new Error(`Cloud Function failed: ${fetchResponse.status}`);
          }

          const exchangeResult = await fetchResponse.json();
          const resultData = exchangeResult.result || exchangeResult;

          if (!resultData?.customToken) {
            throw new Error('No custom token received');
          }

          // Sign in with custom token
          console.log('[Engram] Signing in with custom token...');
          await signInWithCustomToken(auth, resultData.customToken);
          console.log('[Engram] Apple sign-in successful!');

        } else {
          throw new Error('No identity token received from Apple');
        }
      } else {
        // Web: Use Firebase OAuthProvider for Apple
        console.log('[Engram] Using web popup Apple sign-in...');
        const provider = new OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        await signInWithPopup(auth, provider);
        console.log('[Engram] Apple web sign-in successful!');
      }
    } catch (error) {
      console.error('[Engram] Apple sign-in error:', error);
      if (error.message?.includes('cancelled') || error.message?.includes('canceled')) {
        console.log('[Engram] Sign-in was cancelled by user');
      } else {
        alert(`Apple sign-in failed: ${error.message}`);
      }
    }
  };

  // MFA recaptcha ref (auth state is from Zustand store)
  const recaptchaVerifierRef = useRef(null);

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      if (authMode === 'signup') {
        // Create new account
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        // Update display name if provided
        if (displayName.trim()) {
          await updateProfile(userCredential.user, { displayName: displayName.trim() });
        }
        console.log('[Engram] Email sign-up successful:', userCredential.user.email);
      } else if (authMode === 'signin') {
        // Sign in to existing account
        await signInWithEmailAndPassword(auth, email, password);
        console.log('[Engram] Email sign-in successful');
      } else if (authMode === 'reset') {
        // Send password reset email
        await sendPasswordResetEmail(auth, email);
        alert('Password reset email sent! Check your inbox.');
        setAuthMode('signin');
      }
    } catch (error) {
      console.error('[Engram] Email auth error:', error.code, error.message);

      // Handle MFA required
      if (error.code === 'auth/multi-factor-auth-required') {
        console.log('[Engram] MFA required, showing verification screen');
        const resolver = getMultiFactorResolver(auth, error);
        setMfaResolver(resolver);

        // Get hint about MFA type
        const hints = resolver.hints;
        if (hints.length > 0) {
          const hint = hints[0];
          if (hint.factorId === 'phone') {
            setMfaHint(`Enter the code sent to ${hint.phoneNumber || 'your phone'}`);
          } else if (hint.factorId === 'totp') {
            setMfaHint('Enter the code from your authenticator app');
          } else {
            setMfaHint('Enter your verification code');
          }
        }

        setAuthMode('mfa');
        setAuthLoading(false);
        return;
      }

      // User-friendly error messages
      switch (error.code) {
        case 'auth/email-already-in-use':
          setAuthError('This email is already registered. Try signing in instead.');
          break;
        case 'auth/invalid-email':
          setAuthError('Please enter a valid email address.');
          break;
        case 'auth/weak-password':
          setAuthError('Password should be at least 6 characters.');
          break;
        case 'auth/user-not-found':
          setAuthError('No account found with this email. Try signing up.');
          break;
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          setAuthError('Incorrect password. Please try again.');
          break;
        case 'auth/too-many-requests':
          setAuthError('Too many attempts. Please try again later.');
          break;
        default:
          setAuthError(error.message);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  // Handle MFA verification
  const handleMfaVerify = async (e) => {
    e.preventDefault();
    if (!mfaResolver || !mfaCode) return;

    setAuthError('');
    setAuthLoading(true);

    try {
      const hint = mfaResolver.hints[0];
      let assertion;

      if (hint.factorId === 'totp') {
        // TOTP (authenticator app)
        assertion = TotpMultiFactorGenerator.assertionForSignIn(
          hint.uid,
          mfaCode
        );
      } else if (hint.factorId === 'phone') {
        // Phone SMS - would need recaptcha and verification flow
        // For now, show error as phone MFA requires more setup
        setAuthError('Phone MFA verification requires additional setup. Please contact support.');
        setAuthLoading(false);
        return;
      }

      // Complete sign-in with MFA
      await mfaResolver.resolveSignIn(assertion);
      console.log('[Engram] MFA verification successful');

      // Clear MFA state
      setMfaResolver(null);
      setMfaCode('');
      setMfaHint('');
      setAuthMode('signin');

    } catch (error) {
      console.error('[Engram] MFA verification error:', error.code, error.message);
      if (error.code === 'auth/invalid-verification-code') {
        setAuthError('Invalid code. Please try again.');
      } else if (error.code === 'auth/code-expired') {
        setAuthError('Code expired. Please sign in again.');
        setAuthMode('signin');
        setMfaResolver(null);
      } else {
        setAuthError(error.message);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  if (!user) {
    console.log('[Engram] Rendering login screen (no user)');
    const isNative = Capacitor.isNativePlatform();
    const isIOS = Capacitor.getPlatform() === 'ios';

    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center p-6 bg-background text-foreground">
        {/* Cloud canvas: same linen + wave ambient background as the app */}
        <LinenWaveBackground />
        {/* Welcome Pebble (CLOUD-DESIGN-SPEC.md §6.3: calm state on welcome) */}
        <motion.div
          className="mb-4"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", damping: 15 }}
        >
          <Pebble state="calm" size={88} />
        </motion.div>
        <h1 className="font-display font-medium text-[27px] tracking-[-0.01em] mb-6 text-foreground">
          Engram
        </h1>

        <div className="w-full max-w-xs space-y-3">
          {/* Social Sign-In Buttons */}
          <AnimatePresence mode="wait">
            {!showEmailForm ? (
              <motion.div
                key="social-buttons"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-3"
              >
                {/* Sign in with Apple - only show on native iOS for now */}
                {/* Web Apple sign-in requires additional Apple Developer setup */}
                {isIOS && (
                  <button
                    onClick={handleAppleSignIn}
                    className="w-full flex gap-2 items-center justify-center px-6 min-h-[48px] rounded-full text-sm font-semibold transition-all bg-black text-white hover:opacity-90 active:scale-[0.98]"
                  >
                    <Apple size={18}/> Sign in with Apple
                  </button>
                )}

                {/* Sign in with Google */}
                <button
                  onClick={handleSignIn}
                  className="w-full flex gap-2 items-center justify-center px-6 min-h-[48px] rounded-full text-sm font-semibold transition-all bg-card text-foreground border border-border hover:bg-divider active:scale-[0.98] shadow-sm"
                >
                  {/* @color-safe: Google brand logo colors */}
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </button>

                {/* Divider */}
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-divider" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="h-px flex-1 bg-divider" />
                </div>

                {/* Email Sign-In Button */}
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setShowEmailForm(true);
                    setAuthMode('signin');
                    setAuthError('');
                  }}
                >
                  <Mail size={18}/> Continue with Email
                </Button>

                {/* Wellness-not-therapy disclaimer (App Store / FDA framing) */}
                <p className="text-[11px] leading-relaxed text-center text-muted-foreground mt-5 px-2">
                  Engram is a general-wellness tool for self-reflection — not therapy,
                  not a medical device, and not a crisis service. If you're in crisis,
                  call or text 988.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="email-form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {authMode === 'mfa' ? (
                  /* MFA Verification Form */
                  <form onSubmit={handleMfaVerify} className="space-y-3">
                    <div className="flex justify-center mb-2">
                      <div className="h-12 w-12 bg-accent-wash rounded-full flex items-center justify-center">
                        <Shield className="text-accent-deep" size={24}/>
                      </div>
                    </div>
                    <h2 className="font-display font-medium text-xl text-center text-foreground">
                      Two-Factor Authentication
                    </h2>
                    <p className="text-sm text-center text-secondary-foreground">
                      {mfaHint || 'Enter your verification code'}
                    </p>

                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Enter 6-digit code"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      autoFocus
                      className="w-full px-4 py-3 rounded-xl border border-border bg-card text-foreground placeholder:text-[var(--text-placeholder)] focus:outline-none focus:ring-2 focus:ring-accent transition-all text-center text-2xl tracking-widest font-mono"
                    />

                    {authError && (
                      <p className="text-red-500 text-sm text-center">{authError}</p>
                    )}

                    <Button
                      type="submit"
                      variant="primary"
                      disabled={authLoading || mfaCode.length !== 6}
                      className="w-full flex gap-2 items-center justify-center"
                    >
                      {authLoading ? <Loader2 size={18} className="animate-spin"/> : <Shield size={18}/>}
                      Verify
                    </Button>

                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('signin');
                        setMfaResolver(null);
                        setMfaCode('');
                        setMfaHint('');
                        setAuthError('');
                      }}
                      className="w-full min-h-11 text-center text-sm text-muted-foreground hover:text-foreground"
                    >
                      ← Back to sign in
                    </button>
                  </form>
                ) : (
                  /* Email/Password Form */
                  <form onSubmit={handleEmailAuth} className="space-y-3">
                    <h2 className="font-display font-medium text-xl text-center text-foreground">
                      {authMode === 'signup' ? 'Create Account' : authMode === 'reset' ? 'Reset Password' : 'Sign In'}
                    </h2>

                    {authMode === 'signup' && (
                      <input
                        type="text"
                        placeholder="Name (optional)"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full min-h-11 px-4 py-2.5 rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-[var(--text-placeholder)] focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                      />
                    )}

                    <input
                      type="email"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full min-h-11 px-4 py-2.5 rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-[var(--text-placeholder)] focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                    />

                    {authMode !== 'reset' && (
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          minLength={6}
                          className="w-full min-h-11 px-4 py-2.5 pr-10 rounded-xl border border-border bg-card text-sm text-foreground placeholder:text-[var(--text-placeholder)] focus:outline-none focus:ring-2 focus:ring-accent transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-1 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-secondary-foreground"
                        >
                          {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
                        </button>
                      </div>
                    )}

                    {authError && (
                      <p className="text-red-500 text-sm text-center">{authError}</p>
                    )}

                    <Button
                      type="submit"
                      variant="primary"
                      disabled={authLoading}
                      className="w-full flex gap-2 items-center justify-center"
                    >
                      {authLoading ? <Loader2 size={18} className="animate-spin"/> : <Mail size={18}/>}
                      {authMode === 'signup' ? 'Create Account' : authMode === 'reset' ? 'Send Reset Email' : 'Sign In'}
                    </Button>

                  {/* Auth mode toggles */}
                  <div className="text-center text-sm space-y-1">
                    {authMode === 'signin' && (
                      <>
                        <button
                          type="button"
                          onClick={() => { setAuthMode('signup'); setAuthError(''); }}
                          className="min-h-11 text-accent-deep font-medium hover:underline"
                        >
                          Need an account? Sign up
                        </button>
                        <br/>
                        <button
                          type="button"
                          onClick={() => { setAuthMode('reset'); setAuthError(''); }}
                          className="min-h-11 text-muted-foreground hover:underline"
                        >
                          Forgot password?
                        </button>
                      </>
                    )}
                    {authMode === 'signup' && (
                      <button
                        type="button"
                        onClick={() => { setAuthMode('signin'); setAuthError(''); }}
                        className="min-h-11 text-accent-deep font-medium hover:underline"
                      >
                        Already have an account? Sign in
                      </button>
                    )}
                    {authMode === 'reset' && (
                      <button
                        type="button"
                        onClick={() => { setAuthMode('signin'); setAuthError(''); }}
                        className="min-h-11 text-accent-deep font-medium hover:underline"
                      >
                        Back to sign in
                      </button>
                    )}
                  </div>

                  {/* Back to social sign-in */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailForm(false);
                      setAuthError('');
                      setEmail('');
                      setPassword('');
                      setDisplayName('');
                    }}
                    className="w-full min-h-11 text-center text-sm text-muted-foreground hover:text-foreground"
                  >
                    ← Back to other sign-in options
                  </button>
                  </form>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  console.log('[Engram] Rendering main app (user logged in)');

  // Handler for quick mood log from TopBar orb
  const handleQuickMoodSave = async (quickLog) => {
    if (!user) return;
    console.log('[QuickMood] Saving quick check-in:', quickLog);

    // Create a simple entry from the quick mood log
    const vibeText = quickLog.vibeTags?.length > 0
      ? ` Feeling: ${quickLog.vibeTags.join(', ')}.`
      : '';
    const moodLabel = quickLog.moodScore >= 0.7 ? 'good' :
                      quickLog.moodScore >= 0.4 ? 'okay' : 'low';
    const entryText = `Quick check-in: Mood is ${moodLabel}.${vibeText}`;

    await saveEntry(entryText);
  };

  // Handler for voice entry from FAB
  const handleVoiceEntry = () => {
    setEntryPreferredMode('voice');
    setReplyContext("Let it out - I'm here to listen.");
  };

  // Handler for text entry from FAB
  const handleTextEntry = () => {
    setEntryPreferredMode('text');
    setReplyContext("Write what's on your mind...");
  };

  return (
    <AppLayout
      // User & Data
      user={user}
      entries={entries}
      category={cat}

      // Entry handling
      onVoiceEntry={handleVoiceEntry}
      onTextEntry={handleTextEntry}
      onQuickMoodSave={handleQuickMoodSave}
      onSaveEntry={(data) => {
        if (data?.text) {
          saveEntry(data.text);
        }
      }}

      // Navigation handlers
      onShowInsights={() => setShowInsights(true)}
      onShowSafetyPlan={() => setShowSafetyPlan(true)}
      onShowExport={() => setShowExport(true)}
      onShowHealthSettings={() => setShowHealthSettings(true)}
      onShowNexusSettings={() => setShowNexusSettings(true)}
      onShowEntityManagement={() => setShowEntityManagement(true)}
      onShowReports={() => setView('reports')}
      onRequestNotifications={requestPermission}
      onLogout={async () => {
        const uid = user?.uid;
        try {
          await signOut(auth);
        } finally {
          resetAllStores();
          await clearOwnerCaches(uid);
        }
      }}
      aiProcessingEnabled={aiProcessingEnabled}
      onRequestAiConsent={() => setNeedsAiConsent(true)}
      onRevokeAiConsent={revokeAiConsent}

      // Entry bar context (for prompts)
      setEntryPreferredMode={setEntryPreferredMode}
      setReplyContext={setReplyContext}
      replyContext={replyContext}
      entryPreferredMode={entryPreferredMode}
      onAudioSubmit={handleAudioWrapper}
      onTextSubmit={saveEntry}
      processing={processing}
      captureSpaceId={captureSpaceId}
      onCaptureSpaceIdChange={setCaptureSpaceId}

      // Quick Log Modal (state lifted to App.jsx)
      showQuickLog={showQuickLog}
      setShowQuickLog={setShowQuickLog}

      // Dashboard handlers
      onPromptClick={(prompt) => setReplyContext(prompt)}
      onToggleTask={async (taskText, entryId, taskIndex) => {
        console.log('Completing task:', taskText, 'in entry:', entryId, 'at index:', taskIndex);
        if (!user?.uid || !entryId) return;

        // Find the entry and update its extracted_tasks
        const entry = entries.find(e => e.id === entryId);
        if (!entry || !entry.extracted_tasks) return;

        const updatedTasks = [...entry.extracted_tasks];
        const task = updatedTasks[taskIndex];
        if (!task) return;

        // Mark as completed (same logic as EntryCard)
        if (typeof task === 'string') {
          updatedTasks[taskIndex] = { text: task, completed: true, completedAt: new Date().toISOString() };
        } else {
          updatedTasks[taskIndex] = {
            ...task,
            completed: true,
            completedAt: new Date().toISOString()
          };
        }

        await handleEntryUpdate(entryId, { extracted_tasks: updatedTasks });
      }}
      onStartRecording={() => {
        setEntryPreferredMode('voice');
        setReplyContext("Let it out - I'm here to listen.");
      }}
      onStartTextEntry={() => {
        setEntryPreferredMode('text');
        setReplyContext("Write what's on your mind...");
      }}
      onDayClick={(date, dayData) => setDailySummaryModal({ date, dayData })}
      onDelete={id => deleteDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id))}
      onUpdate={handleEntryUpdate}

      // Permissions
      notificationPermission={permission}
    >
      {/* Modals and overlays - passed as children to AppLayout */}

      {/* Recovery banner for recordings that never made it to a saved entry.
          Gated on !processing: a recording currently in flight through the
          pipeline isn't "unsaved" yet, and showing it here invited a Retry
          click that would race the in-flight pipeline and duplicate it. */}
      {!processing && (
        <PendingAudioBanner
          ownerUid={user?.uid}
          onRetry={(base64, mime, recordingId, chapterExtras = {}) => handleAudioWrapper(base64, mime, {
            existingRecordingId: recordingId,
            ...chapterExtras,
          })}
        />
      )}

      {/* Decompression Screen */}
      <AnimatePresence>
        {showDecompression && <DecompressionScreen onClose={() => setShowDecompression(false)} />}
      </AnimatePresence>

      {/* Streak Celebration (D4b) — mounted whenever the post-save streak
          check in doSaveEntry finds a new personal best; "Share with my
          therapist" reuses the existing Therapist Export screen. */}
      <AnimatePresence>
        {streakCelebration && (
          <StreakCelebration
            currentStreak={streakCelebration.currentStreak}
            previousBest={streakCelebration.previousBest}
            onClose={closeStreakCelebration}
            onShareWithTherapist={() => {
              closeStreakCelebration();
              setShowExport(true);
            }}
          />
        )}
      </AnimatePresence>

      {/* Retrofit Progress Indicator */}
      <AnimatePresence>
        {retrofitProgress && (
          <motion.div
            className="fixed bottom-24 left-4 right-4 z-30 flex justify-center pointer-events-none"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
          >
            <div className="bg-warm-800 text-white px-4 py-2 rounded-full shadow-soft-lg text-sm flex items-center gap-2">
              <Loader2 className="animate-spin" size={14} />
              <span className="font-body">Enhancing entries... {retrofitProgress.processed}/{retrofitProgress.total}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detected Signals Strip (temporal redesign) */}
      <AnimatePresence>
        {showDetectedStrip && detectedSignals.length > 0 && (
          <motion.div
            className="fixed bottom-24 left-4 right-4 z-40 flex justify-center"
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
          >
            <DetectedStrip
              signals={detectedSignals}
              recordedAt={new Date()}
              onConfirmAll={handleSignalConfirmAll}
              onDismiss={handleSignalDismiss}
              onClose={handleSignalStripClose}
              className="max-w-md w-full"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Offline Indicator */}
      {!isOnline && (
        <div className="fixed top-[calc(env(safe-area-inset-top)+60px)] left-0 right-0 z-50 bg-honey-500 dark:bg-honey-600 text-white px-4 py-2 text-center text-sm font-medium">
          You're offline. Entries will be saved locally and synced when you're back online.
          {offlinePendingCount > 0 && ` (${offlinePendingCount} pending)`}
        </div>
      )}

      {/* Crisis Soft Block Modal */}
      {crisisModal && (
        <CrisisSoftBlockModal
          onResponse={handleCrisisResponse}
          onClose={() => {
            // Dismissing the soft-block without choosing still saves the entry
            // (flagged) — we never silently drop it.
            setCrisisModal(null);
            persistPendingEntry(null);
          }}
        />
      )}

      {/* Crisis Resources Screen */}
      {crisisResources && (
        <CrisisResourcesScreen
          level={crisisResources}
          onClose={() => {
            // Entry already saved on the initial response; this is a defensive
            // no-op when pendingEntry is already null.
            setCrisisResources(null);
            persistPendingEntry(null);
          }}
          onContinue={handleCrisisResourcesContinue}
        />
      )}

      {/* Safety Plan Screen */}
      {showSafetyPlan && (
        <SafetyPlanScreen
          plan={safetyPlan}
          onUpdate={updateSafetyPlan}
          onClose={() => setShowSafetyPlan(false)}
        />
      )}

      {/* Daily Summary Modal */}
      {dailySummaryModal && (
        <DailySummaryModal
          date={dailySummaryModal.date}
          dayData={dailySummaryModal.dayData}
          onClose={() => setDailySummaryModal(null)}
          onDelete={id => deleteDoc(doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', id))}
          onUpdate={handleEntryUpdate}
        />
      )}

      {/* Therapist Export Screen */}
      {showExport && (
        <TherapistExportScreen
          entries={entries}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Insights Panel */}
      {showInsights && (
        <InsightsPanel
          entries={entries}
          userId={user?.uid}
          category={cat}
          onClose={() => setShowInsights(false)}
        />
      )}

      {/* Entry Insights Popup */}
      <EntryInsightsPopup
        isOpen={!!entryInsightsPopup}
        onClose={() => setEntryInsightsPopup(null)}
        contextualInsight={entryInsightsPopup?.contextualInsight}
        analysis={entryInsightsPopup?.analysis}
        entryType={entryInsightsPopup?.entryType}
      />

      {/* Health Settings Screen */}
      {showHealthSettings && (
        <HealthSettingsScreen
          onClose={() => setShowHealthSettings(false)}
        />
      )}

      {/* Nexus Settings Screen */}
      {showNexusSettings && (
        <div className="fixed inset-0 z-50 bg-warm-900/95 overflow-y-auto">
          <div className="min-h-screen">
            <div className="flex items-center justify-between p-4 border-b border-warm-700">
              <h1 className="text-lg font-semibold text-warm-100">Nexus Settings</h1>
              <button
                onClick={() => setShowNexusSettings(false)}
                className="p-2 rounded-full hover:bg-warm-800 text-warm-400"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <NexusSettings user={user} />
          </div>
        </div>
      )}

      {/* Entity Management Screen */}
      {showEntityManagement && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <EntityManagementPage
            userId={user?.uid}
            onBack={() => setShowEntityManagement(false)}
          />
        </div>
      )}

      {/* Report List View */}
      {view === 'reports' && (
        <ReportListWithSuspense
          onSelectReport={(reportId) => {
            useReportsStore.getState().setActiveReport(reportId, user?.uid);
            setView('report-detail');
          }}
          onClose={() => setView('feed')}
        />
      )}

      {/* Report Detail View */}
      {view === 'report-detail' && (
        <ReportViewerWithSuspense
          onBack={() => {
            useReportsStore.getState().clearActiveReport();
            setView('reports');
          }}
        />
      )}

      {/* What's New Modal - flag-aware, shows unseen enabled-feature entries */}
      <WhatsNewModal uid={user?.uid} />

      {/* First-run AI-processing consent (must acknowledge before using AI features) */}
      {needsAiConsent && (
        <AiConsentModal
          onAgree={handleAiConsent}
          onDecline={continueWithoutAi}
          agreeing={aiConsentSaving}
        />
      )}
    </AppLayout>
  );
}
