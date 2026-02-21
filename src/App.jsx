import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic, Loader2, LogIn, Activity, Brain, Share,
  User as UserIcon, Briefcase, X, Mail, Apple, Eye, EyeOff, Shield
} from 'lucide-react';

// UI Components
import { celebrate, Button, Modal, ModalHeader, ModalBody, Badge, MoodBadge, BreathingLoader } from './components/ui';

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
  runTransaction
} from './config/firebase';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
  APP_COLLECTION_ID, CURRENT_CONTEXT_VERSION,
  DEFAULT_SAFETY_PLAN
} from './config/constants';

// Utils
import { safeString, removeUndefined, formatMentions } from './utils/string';
import { safeDate, formatDateForInput, getTodayForInput, parseDateInput, getDateString, getISOYearWeek } from './utils/date';
import { sanitizeEntry } from './utils/entries';

// Services
import { generateEmbedding, findRelevantMemories, transcribeAudioWithTone } from './services/ai';
import {
  classifyEntry, analyzeEntry, generateInsight, extractEnhancedContext,
  performLocalAnalysis, getAnalysisStrategy
} from './services/analysis';
import { checkCrisisKeywords, checkWarningIndicators, checkLongitudinalRisk } from './services/safety';
import { retrofitEntriesInBackground } from './services/entries';
import { queueEntry, getSyncStatus } from './services/offline';
import { inferCategory } from './services/prompts';
import { getActiveReflectionPrompts, dismissReflectionPrompt } from './services/prompts/activePrompts';
import { detectTemporalContext, needsConfirmation, formatEffectiveDate } from './services/temporal';
import { handleEntryDateChange, calculateStreak } from './services/dashboard';
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
  CrisisSoftBlockModal, DailySummaryModal, WeeklyReport, InsightsPanel, EntryInsightsPopup,
  CrisisResourcesScreen, SafetyPlanScreen, DecompressionScreen, TherapistExportScreen, JournalScreen, HealthSettingsScreen,
  MoodHeatmap,
  MarkdownLite, GetHelpButton, HamburgerMenu,
  DayDashboard, EntryBar
} from './components';
import UnifiedConversation from './components/chat/UnifiedConversation';
import NexusSettings from './components/settings/NexusSettings';
import EntityManagementPage from './pages/EntityManagementPage';
import WhatsNewModal from './components/shared/WhatsNewModal';
import { ReportListWithSuspense, ReportViewerWithSuspense } from './components/lazy';

// Dashboard Enhancement Components
import { QuickStatsBar, GoalsProgress, WeeklyDigest, SituationTimeline, ReflectionPrompts } from './components/dashboard/shared';
import DetectedStrip from './components/entries/DetectedStrip';

// Zen & Bento Components
import { AppLayout } from './components/zen';
import QuickLogModal from './components/zen/QuickLogModal';

// --- PDF LOADER (lazy-loads jsPDF from CDN) ---
let jsPDFPromise = null;
const loadJsPDF = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('PDF export is only available in the browser'));
  }
  if (window.jspdf && window.jspdf.jsPDF) {
    return Promise.resolve(window.jspdf.jsPDF);
  }
  if (jsPDFPromise) return jsPDFPromise;

  jsPDFPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jspdf]');
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error('jsPDF global not found after script load'));
      });
      existing.addEventListener('error', () => reject(new Error('Failed to load jsPDF script')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.async = true;
    script.dataset.jspdf = 'true';
    script.onload = () => {
      if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jsPDF global not found after script load'));
    };
    script.onerror = () => reject(new Error('Failed to load jsPDF script'));
    document.body.appendChild(script);
  });
  return jsPDFPromise;
};

// Analysis functions (classifyEntry, analyzeEntry, generateInsight, etc.) imported from services/analysis


export default function App() {
  console.log('[Engram] App component rendering...');
  useIOSMeta();
  const { permission, requestPermission } = useNotifications();
  const { isOnline, wasOffline, clearWasOffline } = useNetworkStatus();
  const { requestWakeLock, releaseWakeLock } = useWakeLock();
  const { backupAudio, clearBackup, isProcessing: isBackgroundProcessing } = useBackgroundAudio();

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
    entryInsightsPopup, openEntryInsights, closeEntryInsights
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
    offlineQueue, setOfflineQueue,
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
      if (processing || isBackgroundProcessing) {
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
  }, [processing, isBackgroundProcessing]);

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
  }, []);

  // Deep link handler for OAuth callbacks (Whoop integration)
  useEffect(() => {
    const handleDeepLink = async (event) => {
      try {
        const url = new URL(event.url);
        console.log('[Engram] Deep link received:', url.toString());

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

  // Process offline queue when back online
  useEffect(() => {
    const processOfflineQueue = async () => {
      if (!isOnline || !wasOffline || offlineQueue.length === 0 || !user) return;

      console.log(`Processing ${offlineQueue.length} offline entries...`);
      clearWasOffline();

      for (const offlineEntry of offlineQueue) {
        try {
          // OPTIMIZED: Skip embedding generation, let Firestore trigger handle it
          const embedding = null;

          // Prepare entry data for Firestore
          const entryData = {
            text: offlineEntry.text,
            category: offlineEntry.category,
            analysisStatus: 'pending',
            embedding,
            createdAt: Timestamp.fromDate(offlineEntry.createdAt),
            effectiveDate: Timestamp.fromDate(offlineEntry.effectiveDate || offlineEntry.createdAt),
            userId: user.uid,
            signalExtractionVersion: 1
          };

          if (offlineEntry.safety_flagged) {
            entryData.safety_flagged = true;
            if (offlineEntry.safety_user_response) {
              entryData.safety_user_response = offlineEntry.safety_user_response;
            }
          }

          if (offlineEntry.has_warning_indicators) {
            entryData.has_warning_indicators = true;
          }

          // Save to Firestore
          const ref = await addDoc(
            collection(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries'),
            entryData
          );

          console.log(`Saved offline entry: ${offlineEntry.offlineId}`);

          // Generate signals for offline entry (non-blocking)
          // Note: We don't show DetectedStrip for offline entries since user may have
          // recorded this entry hours/days ago - signals are just saved for calendar view
          (async () => {
            try {
              const result = await processEntrySignals(
                { id: ref.id, userId: user.uid, createdAt: offlineEntry.createdAt },
                offlineEntry.text,
                1  // Initial extraction version
              );
              if (result?.signals?.length > 0) {
                console.log(`[Signals] Generated ${result.signals.length} signals for offline entry: ${ref.id}`);
              }
            } catch (signalError) {
              console.error('[Signals] Failed to generate signals for offline entry:', signalError);
            }
          })();

          // Run analysis in background (same as online flow)
          (async () => {
            try {
              const recent = entries.slice(0, 5);
              const related = []; // No embedding yet - will be added by Firestore trigger
              const pendingPrompts = getActiveReflectionPrompts(entries, offlineEntry.category);

              const classification = await classifyEntry(offlineEntry.text);
              const [analysis, insight, enhancedContext] = await Promise.all([
                analyzeEntry(offlineEntry.text, classification.entry_type),
                classification.entry_type !== 'task' ? generateInsight(offlineEntry.text, related, recent, entries, pendingPrompts) : Promise.resolve(null),
                classification.entry_type !== 'task' ? extractEnhancedContext(offlineEntry.text, recent) : Promise.resolve(null)
              ]);

              // Auto-dismiss addressed prompts
              if (insight?.addressedPrompts?.length > 0) {
                insight.addressedPrompts.forEach(prompt => {
                  dismissReflectionPrompt(prompt, offlineEntry.category);
                });
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
                context_version: CURRENT_CONTEXT_VERSION,
                analysis: {
                  mood_score: analysis?.mood_score,
                  framework: analysis?.framework || 'general'
                }
              };

              if (enhancedContext?.continues_situation) {
                updateData.continues_situation = enhancedContext.continues_situation;
              }
              if (enhancedContext?.goal_update?.tag) {
                updateData.goal_update = enhancedContext.goal_update;
              }
              if (classification.extracted_tasks?.length > 0) {
                // extracted_tasks already comes as [{text: "...", completed: false}] from Cloud Function
                updateData.extracted_tasks = classification.extracted_tasks;
              }
              if (analysis?.cbt_breakdown) updateData.analysis.cbt_breakdown = analysis.cbt_breakdown;
              if (analysis?.act_analysis) updateData.analysis.act_analysis = analysis.act_analysis;
              if (analysis?.vent_support) updateData.analysis.vent_support = analysis.vent_support;
              if (analysis?.celebration) updateData.analysis.celebration = analysis.celebration;
              if (analysis?.task_acknowledgment) updateData.analysis.task_acknowledgment = analysis.task_acknowledgment;
              if (insight?.found) updateData.contextualInsight = insight;

              await updateDoc(ref, removeUndefined(updateData));
            } catch (error) {
              console.error('Analysis failed for offline entry:', error);
              await updateDoc(ref, {
                title: offlineEntry.text.substring(0, 50) + (offlineEntry.text.length > 50 ? '...' : ''),
                tags: [],
                analysisStatus: 'complete',
                entry_type: 'reflection',
                analysis: { mood_score: 0.5, framework: 'general' }
              });
            }
          })();
        } catch (error) {
          console.error('Failed to save offline entry:', error);
        }
      }

      // Clear the offline queue
      setOfflineQueue([]);
    };

    processOfflineQueue();
  }, [isOnline, wasOffline, offlineQueue, user, entries, clearWasOffline]);

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
      setUser(user);
    });
  }, []);

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

  /**
   * Check if text has meaningfully changed (not just typos/punctuation/whitespace)
   * Only triggers re-extraction if the semantic content is different
   */
  const hasTextMeaningfullyChanged = useCallback((oldText, newText) => {
    if (!oldText || !newText) return true;

    // Normalize: lowercase, collapse whitespace, remove punctuation
    const normalize = (text) => text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // Remove punctuation
      .replace(/\s+/g, ' ')       // Collapse whitespace
      .trim();

    const oldNorm = normalize(oldText);
    const newNorm = normalize(newText);

    // Exact match after normalization = no meaningful change
    if (oldNorm === newNorm) return false;

    // Calculate word-level difference
    const oldWords = oldNorm.split(' ').filter(w => w.length > 0);
    const newWords = newNorm.split(' ').filter(w => w.length > 0);

    // If word counts differ by more than 2, meaningful
    if (Math.abs(oldWords.length - newWords.length) > 2) return true;

    // Count words that are different
    const oldSet = new Set(oldWords);
    const newSet = new Set(newWords);
    const addedWords = [...newSet].filter(w => !oldSet.has(w));
    const removedWords = [...oldSet].filter(w => !newSet.has(w));

    // More than 2 words added or removed = meaningful
    return (addedWords.length + removedWords.length) > 2;
  }, []);

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
        await runTransaction(db, async (transaction) => {
          const entryDoc = await transaction.get(entryRef);
          const currentVersion = entryDoc.data()?.signalExtractionVersion || 1;
          updates.signalExtractionVersion = currentVersion + 1;
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

  const handleCrisisResponse = useCallback(async (response) => {
    setCrisisModal(null);

    if (response === 'okay') {
      if (pendingEntry) {
        await doSaveEntry(pendingEntry.text, pendingEntry.safetyFlagged, response);
        setPendingEntry(null);
      }
    } else if (response === 'support') {
      setCrisisResources('support');
    } else if (response === 'crisis') {
      setCrisisResources('crisis');
      setPendingEntry(null);
    }
  }, [pendingEntry]);

  const handleCrisisResourcesContinue = useCallback(async () => {
    setCrisisResources(null);
    if (pendingEntry) {
      await doSaveEntry(pendingEntry.text, pendingEntry.safetyFlagged, 'support');
      setPendingEntry(null);
    }
  }, [pendingEntry]);

  const doSaveEntry = async (textInput, safetyFlagged = false, safetyUserResponse = null, temporalContext = null, voiceTone = null) => {
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
      }

      // Queue with the new offline manager
      const offlineEntry = await queueEntry({
        text: finalTex,
        category: cat,
        createdAt: now.toISOString(),
        effectiveDate: effectiveDate.toISOString(),
        localAnalysis,
        healthContext,
        environmentContext,
        voiceTone,
        safety_flagged: safetyFlagged || undefined,
        safety_user_response: safetyUserResponse || undefined,
        has_warning_indicators: hasWarning || undefined,
        platform
      });

      // Also add to local state for immediate UI update
      setOfflineQueue(prev => [...prev, {
        ...offlineEntry,
        // Include local analysis in display
        analysis: localAnalysis ? {
          mood_score: localAnalysis.mood_score,
          framework: 'local'
        } : null,
        entry_type: localAnalysis?.entry_type || 'reflection',
        title: localAnalysis?.title || finalTex.substring(0, 50) + '...'
      }]);

      setProcessing(false);
      setReplyContext(null);
      return;
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
        analysisStatus: 'pending',
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

      // Store future mentions for follow-up prompts
      if (temporalContext?.futureMentions?.length > 0) {
        entryData.futureMentions = temporalContext.futureMentions.map(mention => ({
          targetDate: Timestamp.fromDate(mention.targetDate),
          event: mention.event,
          sentiment: mention.sentiment,
          phrase: mention.phrase,
          confidence: mention.confidence,
          isRecurring: mention.isRecurring || false,
          recurringPattern: mention.recurringPattern || null
        }));
      }

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

      setProcessing(false);
      setReplyContext(null);

      // Signal extraction (non-blocking, parallel to analysis)
      // This extracts temporal signals for the DetectedStrip UI
      (async () => {
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
      })();

      // Nexus 2.0 insight update (non-blocking, parallel)
      // Updates thread associations and marks insights as stale for regeneration
      (async () => {
        try {
          console.log('[Nexus] Updating insights for new entry:', ref.id);
          await updateInsightsForNewEntry(
            user.uid,
            ref.id,
            finalTex,
            0.5  // Sentiment placeholder, will be updated after analysis
          );
          console.log('[Nexus] Incremental insights updated');
        } catch (nexusError) {
          // Nexus failure shouldn't break the app
          console.error('[Nexus] Insight update failed:', nexusError);
        }
      })();

      // Analysis pipeline (existing logic)
      (async () => {
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
            console.log('[EntityResolution] Name corrections applied:', entityResolution.corrections);
            console.log('[EntityResolution] Original:', finalTex.substring(0, 100) + '...');
            console.log('[EntityResolution] Corrected:', textForAnalysis.substring(0, 100) + '...');
          }

          console.log('Entry classification:', classification);

          // Get active reflection prompts for AI detection of answered prompts
          const pendingPrompts = getActiveReflectionPrompts(entries, cat);
          console.log('[Analysis] Pending prompts for detection:', pendingPrompts.length);

          console.time('⏱️ AI Analysis (parallel)');
          const [analysis, insight, enhancedContext] = await Promise.all([
            analyzeEntry(textForAnalysis, classification.entry_type),
            classification.entry_type !== 'task' ? generateInsight(textForAnalysis, related, recent, entries, pendingPrompts) : Promise.resolve(null),
            classification.entry_type !== 'task' ? extractEnhancedContext(textForAnalysis, recent) : Promise.resolve(null)
          ]);
          console.timeEnd('⏱️ AI Analysis (parallel)');

          console.log('Analysis complete:', { analysis, insight, classification, enhancedContext });

          // Auto-dismiss addressed prompts based on AI detection
          if (insight?.addressedPrompts?.length > 0) {
            console.log('[Analysis] AI detected addressed prompts:', insight.addressedPrompts);
            insight.addressedPrompts.forEach(prompt => {
              dismissReflectionPrompt(prompt, cat);
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

          console.log('Final updateData to save:', JSON.stringify(updateData, null, 2));

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
          console.error('Analysis failed, marking entry as complete with fallback values:', error);

          try {
            const fallbackData = {
              analysis: {
                mood_score: 0.5,
                framework: 'general'
              },
              title: finalTex.substring(0, 50) + (finalTex.length > 50 ? '...' : ''),
              tags: [],
              analysisStatus: 'complete',
              entry_type: 'reflection'
            };

            const cleanedFallbackData = removeUndefined(fallbackData);
            await updateDoc(ref, cleanedFallbackData);
          } catch (fallbackError) {
            console.error('Even fallback update failed:', fallbackError);
          }
        }
      })();
    } catch (e) {
      console.error('Save failed:', e);
      // Provide more helpful error message based on error type
      const errorMessage = e.code === 'permission-denied'
        ? 'Save failed: Permission denied. Please sign in again.'
        : e.code === 'unavailable' || e.message?.includes('network')
        ? 'Save failed: Network error. Please check your connection and try again.'
        : 'Save failed. Please try again.';
      alert(errorMessage);
      setProcessing(false);
    }
  };

  const saveEntry = async (textInput, voiceTone = null) => {
    if (!user) return;
    setProcessing(true);
    console.log('[SaveEntry] Starting save process, text length:', textInput.length, 'hasVoiceTone:', !!voiceTone);

    // Check for crisis keywords first (safety priority)
    const hasCrisis = checkCrisisKeywords(textInput);
    if (hasCrisis) {
      console.log('[SaveEntry] Crisis keywords detected, showing modal');
      setPendingEntry({ text: textInput, safetyFlagged: true, voiceTone });
      setCrisisModal(true);
      setProcessing(false);
      return;
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
      await doSaveEntry(textInput, false, null, temporal.detected ? temporal : null, voiceTone);
    } catch (e) {
      console.error('Temporal detection failed, saving normally:', e);
      await doSaveEntry(textInput, false, null, null, voiceTone);
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

  const handleAudioWrapper = async (base64, mime) => {
    console.log('[Transcription] handleAudioWrapper called');
    console.log('[Transcription] Audio data received:', {
      base64Length: base64?.length || 0,
      mime,
      estimatedSizeKB: Math.round((base64?.length || 0) / 1024)
    });

    if (!base64 || base64.length < 100) {
      console.error('[Transcription] Invalid audio data received');
      alert('No audio data received. Please try recording again.');
      return;
    }

    setProcessing(true);

    // Request wake lock to prevent iOS from killing the request during long transcriptions
    const wakeLockAcquired = await requestWakeLock();
    console.log('[Transcription] Wake lock acquired:', wakeLockAcquired);

    // Save audio to localStorage as backup before attempting transcription
    // This prevents data loss if transcription fails
    const audioBackupKey = `echov_audio_backup_${Date.now()}`;
    try {
      // Only backup if audio is not too large (< 10MB to avoid localStorage limits)
      if (base64.length < 10 * 1024 * 1024) {
        localStorage.setItem(audioBackupKey, JSON.stringify({ base64, mime, timestamp: Date.now() }));
        console.log('[Transcription] Audio backed up to localStorage:', audioBackupKey);
      } else {
        console.log('[Transcription] Audio too large for localStorage backup:', base64.length);
      }
    } catch (backupError) {
      console.warn('[Transcription] Could not backup audio to localStorage:', backupError.message);
    }

    try {
      console.log('[Transcription] Starting transcription+tone API call...');
      const startTime = Date.now();
      const result = await transcribeAudioWithTone(base64, mime);
      console.log('[Transcription] API call completed in', Date.now() - startTime, 'ms');

      // Handle error codes (string responses)
      if (typeof result === 'string') {
        if (result === 'API_RATE_LIMIT') {
          alert("Too many requests - please wait a moment and try again");
          setProcessing(false);
          releaseWakeLock();
          return;
        }

        if (result === 'API_AUTH_ERROR') {
          alert("API authentication error - please check settings");
          setProcessing(false);
          releaseWakeLock();
          return;
        }

        if (result === 'API_BAD_REQUEST') {
          alert("Audio format not supported - please try recording again");
          setProcessing(false);
          releaseWakeLock();
          try { localStorage.removeItem(audioBackupKey); } catch (e) {}
          return;
        }

        if (result.startsWith('API_')) {
          alert("Transcription failed after multiple attempts. Please check your network connection and try again. Your recording has been saved locally.");
          setProcessing(false);
          releaseWakeLock();
          return;
        }
      }

      const { transcript, toneAnalysis } = result;
      console.log('[Transcription] Result:', {
        transcriptPreview: transcript?.substring?.(0, 100),
        hasToneAnalysis: !!toneAnalysis,
        toneEnergy: toneAnalysis?.energy,
        toneMood: toneAnalysis?.moodScore?.toFixed(2)
      });

      if (!transcript) {
        alert("Transcription failed - please try again. Your recording has been saved locally.");
        setProcessing(false);
        releaseWakeLock();
        return;
      }

      if (transcript.includes("NO_SPEECH")) {
        alert("No speech detected - please try speaking closer to the microphone");
        setProcessing(false);
        releaseWakeLock();
        try { localStorage.removeItem(audioBackupKey); } catch (e) {}
        return;
      }

      // Transcription successful - clear the backup
      console.log('[Transcription] Success! Clearing backup and saving entry...');
      try { localStorage.removeItem(audioBackupKey); } catch (e) {}

      // Pass voice tone analysis to saveEntry
      console.log('[Transcription] Calling saveEntry with transcript length:', transcript.length, 'voiceTone:', !!toneAnalysis);
      await saveEntry(transcript, toneAnalysis);
      console.log('[Transcription] saveEntry completed');
    } catch (error) {
      console.error('[Transcription] handleAudioWrapper error:', error);
      console.error('[Transcription] Error details:', {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        stack: error?.stack?.substring?.(0, 500)
      });
      alert("An error occurred during transcription. Your recording has been saved locally. Please try again.");
      setProcessing(false);
    } finally {
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
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gradient-to-br from-warm-50 to-honey-50">
        <motion.div
          className="h-16 w-16 bg-gradient-to-br from-honey-600 to-honey-700 rounded-3xl flex items-center justify-center mb-4 shadow-soft-lg rotate-3"
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 3 }}
          transition={{ type: "spring", damping: 15 }}
        >
          <Activity className="text-white"/>
        </motion.div>
        <h1 className="text-2xl font-display font-bold mb-6 text-warm-800">
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
                    className="w-full flex gap-2 items-center justify-center px-4 py-3 rounded-xl font-medium transition-all bg-black text-white hover:bg-gray-800 active:scale-[0.98]"
                  >
                    <Apple size={18}/> Sign in with Apple
                  </button>
                )}

                {/* Sign in with Google */}
                <button
                  onClick={handleSignIn}
                  className="w-full flex gap-2 items-center justify-center px-4 py-3 rounded-xl font-medium transition-all bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 active:scale-[0.98] shadow-sm"
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
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-warm-200"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-gradient-to-br from-warm-50 to-honey-50 text-warm-500">or</span>
                  </div>
                </div>

                {/* Email Sign-In Button */}
                <button
                  onClick={() => {
                    setShowEmailForm(true);
                    setAuthMode('signin');
                    setAuthError('');
                  }}
                  className="w-full flex gap-2 items-center justify-center px-4 py-3 rounded-xl font-medium transition-all text-warm-700 hover:bg-warm-100 active:scale-[0.98]"
                >
                  <Mail size={18}/> Continue with Email
                </button>
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
                      <div className="h-12 w-12 bg-honey-100 rounded-full flex items-center justify-center">
                        <Shield className="text-honey-600" size={24}/>
                      </div>
                    </div>
                    <h2 className="text-lg font-semibold text-center text-warm-800">
                      Two-Factor Authentication
                    </h2>
                    <p className="text-sm text-center text-warm-600">
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
                      className="w-full px-4 py-3 rounded-lg border border-warm-200 focus:border-honey-500 focus:ring-2 focus:ring-honey-200 outline-none transition-all text-center text-2xl tracking-widest font-mono"
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
                      className="w-full text-center text-sm text-warm-500 hover:text-warm-700"
                    >
                      ← Back to sign in
                    </button>
                  </form>
                ) : (
                  /* Email/Password Form */
                  <form onSubmit={handleEmailAuth} className="space-y-3">
                    <h2 className="text-lg font-semibold text-center text-warm-800">
                      {authMode === 'signup' ? 'Create Account' : authMode === 'reset' ? 'Reset Password' : 'Sign In'}
                    </h2>

                    {authMode === 'signup' && (
                      <input
                        type="text"
                        placeholder="Name (optional)"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg border border-warm-200 focus:border-honey-500 focus:ring-2 focus:ring-honey-200 outline-none transition-all"
                      />
                    )}

                    <input
                      type="email"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full px-4 py-2 rounded-lg border border-warm-200 focus:border-honey-500 focus:ring-2 focus:ring-honey-200 outline-none transition-all"
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
                          className="w-full px-4 py-2 pr-10 rounded-lg border border-warm-200 focus:border-honey-500 focus:ring-2 focus:ring-honey-200 outline-none transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-400 hover:text-warm-600"
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
                          className="text-honey-600 hover:underline"
                        >
                          Need an account? Sign up
                        </button>
                        <br/>
                        <button
                          type="button"
                          onClick={() => { setAuthMode('reset'); setAuthError(''); }}
                          className="text-warm-500 hover:underline"
                        >
                          Forgot password?
                        </button>
                      </>
                    )}
                    {authMode === 'signup' && (
                      <button
                        type="button"
                        onClick={() => { setAuthMode('signin'); setAuthError(''); }}
                        className="text-honey-600 hover:underline"
                      >
                        Already have an account? Sign in
                      </button>
                    )}
                    {authMode === 'reset' && (
                      <button
                        type="button"
                        onClick={() => { setAuthMode('signin'); setAuthError(''); }}
                        className="text-honey-600 hover:underline"
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
                    className="w-full text-center text-sm text-warm-500 hover:text-warm-700"
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
      onLogout={() => {
        resetAllStores();
        signOut(auth);
      }}

      // Entry bar context (for prompts)
      setEntryPreferredMode={setEntryPreferredMode}
      setReplyContext={setReplyContext}
      replyContext={replyContext}
      entryPreferredMode={entryPreferredMode}
      onAudioSubmit={handleAudioWrapper}
      onTextSubmit={saveEntry}
      processing={processing}

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

      {/* Decompression Screen */}
      <AnimatePresence>
        {showDecompression && <DecompressionScreen onClose={() => setShowDecompression(false)} />}
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
          {offlineQueue.length > 0 && ` (${offlineQueue.length} pending)`}
        </div>
      )}

      {/* Crisis Soft Block Modal */}
      {crisisModal && (
        <CrisisSoftBlockModal
          onResponse={handleCrisisResponse}
          onClose={() => {
            setCrisisModal(null);
            setPendingEntry(null);
          }}
        />
      )}

      {/* Crisis Resources Screen */}
      {crisisResources && (
        <CrisisResourcesScreen
          level={crisisResources}
          onClose={() => {
            setCrisisResources(null);
            setPendingEntry(null);
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

      {/* What's New Modal - shows once after feature updates */}
      <WhatsNewModal />
    </AppLayout>
  );
}
