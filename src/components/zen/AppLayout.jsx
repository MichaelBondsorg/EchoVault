import { useState, useMemo, useEffect, useCallback } from 'react';
import { Routes, Route } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react';

// Zen components
import TopBar from './TopBar';
import BottomNavbar from './BottomNavbar';
import { LinenWaveBackground } from '../cloud';
import CompanionNudge from './CompanionNudge';
import QuickLogModal from './QuickLogModal';
import DaySummaryModal from './DaySummaryModal';
import SanctuaryWalkthrough from './SanctuaryWalkthrough';
import { FABTooltip, useZenTooltips } from './ZenTooltips';

// Pages
import { HomePage, JournalPage, InsightsPage, SettingsPage } from '../../pages';

// Screens (modals that overlay the entire app)
import { UnifiedConversationWithSuspense as UnifiedConversation } from '../lazy';

import EntryComposer from '../capture/EntryComposer';
import CaptureReliabilityCenter from '../capture/CaptureReliabilityCenter';
import CapturedToast from '../capture/CapturedToast';
import PrivacyCenter from '../privacy/PrivacyCenter';
import SpaceManager from '../spaces/SpaceManager';
import InsightControlCenter from '../insights/InsightControlCenter';
import RecipesScreen from '../reflections/RecipesScreen';
import SessionPrepScreen from '../reflections/SessionPrepScreen';
import ExperimentsScreen from '../experiments/ExperimentsScreen';
import { getFlag } from '../../config/flags';
// PRIV-01: shared owner-scoped dismissed-prompt helpers (previously this
// file had its own copy of this logic against an unowned global key — see
// src/services/prompts/activePrompts.js's header comment).
import { getDismissedPromptKeys, dismissReflectionPrompt as dismissReflectionPromptForOwner } from '../../services/prompts/activePrompts';

/**
 * AppLayout - Main application shell with Zen & Bento navigation
 *
 * Provides:
 * - Mood-reactive animated background
 * - Translucent TopBar with mood orb
 * - Bottom navigation with expandable FAB
 * - Companion nudge (AI assistant shortcut)
 * - Route-based page rendering
 * - Sanctuary walkthrough (first-time user experience)
 *
 * @param {Object} props - All props passed from App.jsx
 */
const AppLayout = ({
  // User & Data
  user,
  entries,
  category,

  // Entry handling
  onVoiceEntry,
  onTextEntry,
  onQuickMoodSave,
  onSaveEntry,

  // Navigation handlers
  onShowInsights,
  onShowSafetyPlan,
  onShowExport,
  onShowHealthSettings,
  onShowNexusSettings,
  onShowEntityManagement,
  onShowReports,
  onRequestNotifications,
  onLogout,
  aiProcessingEnabled,
  onRequestAiConsent,
  onRevokeAiConsent,

  // Entry bar context
  setEntryPreferredMode,
  setReplyContext,
  replyContext,
  entryPreferredMode,
  onAudioSubmit,
  onTextSubmit,
  processing,
  captureSpaceId,
  onCaptureSpaceIdChange,

  // Quick Log Modal (state lifted to App.jsx)
  showQuickLog,
  setShowQuickLog,

  // Dashboard handlers
  onPromptClick,
  onToggleTask,
  onStartRecording,
  onStartTextEntry,
  onDayClick,
  onDelete,
  onUpdate,

  // Permissions
  notificationPermission,

  // Additional modals that may be shown
  children,
}) => {
  const [showCompanion, setShowCompanion] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showReliabilityCenter, setShowReliabilityCenter] = useState(false);
  const [showPrivacyCenter, setShowPrivacyCenter] = useState(false);
  const [showSpaceManager, setShowSpaceManager] = useState(false);
  const [showControlCenter, setShowControlCenter] = useState(false);
  const [showRecipes, setShowRecipes] = useState(false);
  const [showSessionPrep, setShowSessionPrep] = useState(false);
  const [showExperiments, setShowExperiments] = useState(false);
  // Try-as-experiment prefill (R4 Phase 3 Task 2): set by handleTryExperiment
  // below, consumed once by ExperimentsScreen's own `prefill` prop (a fresh
  // mount per open — see the flag-gated mount site), cleared on every close
  // path so a later plain "New experiment" open never inherits a stale
  // prefill.
  const [experimentPrefill, setExperimentPrefill] = useState(null);
  const [entryMode, setEntryMode] = useState('text'); // 'voice' or 'text'
  const [isFreshEntry, setIsFreshEntry] = useState(true); // true = FAB entry, false = responding to prompt
  const [currentPrompt, setCurrentPrompt] = useState(null); // Track prompt being answered for auto-dismiss
  const [initialContext, setInitialContext] = useState(null); // Quiet composer context chip (e.g. open-loop "Following up: ...")
  const [onEntrySavedCallback, setOnEntrySavedCallback] = useState(null); // Fires with the saved entry id/result
  const [daySummary, setDaySummary] = useState({ isOpen: false, date: null, dayData: null }); // Day summary modal
  const [reflectionIndex, setReflectionIndex] = useState(0); // Current reflection prompt index

  // Extract reflection questions from recent entries (last 14 days)
  const reflectionQuestions = useMemo(() => {
    if (!entries || entries.length === 0) return [];

    const now = new Date();
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    // Load this owner's dismissed questions (PRIV-01: owner-scoped, never a
    // global key — see services/prompts/activePrompts.js).
    const dismissed = getDismissedPromptKeys(user?.uid, category);

    const categoryEntries = entries.filter(e => e.category === category);
    const allQuestions = [];

    categoryEntries.forEach(entry => {
      const entryDate = entry.effectiveDate || entry.createdAt;
      const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();

      if (date < twoWeeksAgo) return;

      const followUps = entry.contextualInsight?.followUpQuestions;
      if (Array.isArray(followUps) && followUps.length > 0) {
        followUps.forEach(q => {
          if (q && typeof q === 'string' && q.trim()) {
            allQuestions.push({
              question: q.trim(),
              entryId: entry.id,
              entryDate: date
            });
          }
        });
      }
    });

    // Filter dismissed and dedupe
    const seen = new Set();
    return allQuestions
      .filter(q => {
        const key = q.question.toLowerCase();
        if (seen.has(key) || dismissed.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  }, [entries, category, user?.uid]);

  // Reset reflection index when modal opens or questions change
  useEffect(() => {
    if (showEntryModal) {
      setReflectionIndex(0);
    }
  }, [showEntryModal]);

  // Navigation for reflection prompts
  const goNextReflection = useCallback(() => {
    setReflectionIndex(prev => (prev + 1) % reflectionQuestions.length);
  }, [reflectionQuestions.length]);

  const goPrevReflection = useCallback(() => {
    setReflectionIndex(prev => (prev - 1 + reflectionQuestions.length) % reflectionQuestions.length);
  }, [reflectionQuestions.length]);

  // Handler for day click from 30-day journey
  const handleDayClick = (date, dayData) => {
    setDaySummary({ isOpen: true, date, dayData });
  };

  const handleCloseDaySummary = () => {
    setDaySummary({ isOpen: false, date: null, dayData: null });
  };

  // Dismiss a reflection prompt (PRIV-01: owner-scoped, shared with
  // activePrompts.js/PromptWidget.jsx — see that module's header comment).
  const dismissReflectionPrompt = (prompt) => {
    dismissReflectionPromptForOwner(prompt, category, user?.uid);
  };

  // Direct handlers for FAB actions - show modal immediately
  // NOTE: Don't set replyContext here - FAB entries are fresh, not responses to prompts
  const handleVoiceClick = () => {
    if (!aiProcessingEnabled) {
      onRequestAiConsent?.();
      return;
    }
    setEntryMode('voice');
    setIsFreshEntry(true); // Mark as fresh entry (not a response)
    setReplyContext?.(null); // Clear any existing reply context
    setShowEntryModal(true);
  };

  const handleTextClick = () => {
    setEntryMode('text');
    setIsFreshEntry(true); // Mark as fresh entry (not a response)
    setReplyContext?.(null); // Clear any existing reply context
    setShowEntryModal(true);
  };

  // Home Screen quick actions, App Shortcuts, and deep links converge here.
  useEffect(() => {
    const openEntry = (event) => {
      const requestedMode = event.detail?.mode === 'voice' ? 'voice' : 'text';
      if (requestedMode === 'voice' && !aiProcessingEnabled) {
        onRequestAiConsent?.();
        return;
      }
      setEntryMode(requestedMode);
      setIsFreshEntry(true);
      setReplyContext?.(null);
      setShowEntryModal(true);
    };
    window.addEventListener('engram:open-entry', openEntry);
    return () => window.removeEventListener('engram:open-entry', openEntry);
  }, [aiProcessingEnabled, onRequestAiConsent, setReplyContext]);

  useEffect(() => {
    const openCompanion = () => {
      if (aiProcessingEnabled) setShowCompanion(true);
      else onRequestAiConsent?.();
    };
    window.addEventListener('engram:open-companion', openCompanion);
    return () => window.removeEventListener('engram:open-companion', openCompanion);
  }, [aiProcessingEnabled, onRequestAiConsent]);

  // Handler for responding to a reflection prompt (from Reflect card)
  // This DOES use the replyContext and shows "[Replying to ...]"
  const handlePromptResponse = (prompt, mode = 'text') => {
    if (mode === 'voice' && !aiProcessingEnabled) {
      onRequestAiConsent?.();
      return;
    }
    setEntryMode(mode);
    setIsFreshEntry(false); // Mark as response to prompt
    setCurrentPrompt(prompt); // Track for auto-dismiss after submission
    setReplyContext?.(prompt); // Set the prompt as context
    setShowEntryModal(true);
  };

  const handleCloseEntryModal = () => {
    setShowEntryModal(false);
    setIsFreshEntry(true); // Reset for next time
    setCurrentPrompt(null); // Clear tracked prompt
    setReplyContext?.(null);
    setInitialContext(null);
    setOnEntrySavedCallback(null);
  };

  // Handler for successful entry submission - dismisses prompt if responding to one
  const handleEntrySubmitted = async (submitFn, ...args) => {
    try {
      const result = await submitFn?.(...args);
      // If this was a response to a reflection prompt, dismiss it
      if (currentPrompt && !isFreshEntry) {
        dismissReflectionPrompt(currentPrompt);
      }
      handleCloseEntryModal();
      return result;
    } catch (e) {
      console.error('Entry submission failed:', e);
      handleCloseEntryModal();
    }
  };

  // Opens the composer for an open-loop "Answer" action: a quiet context
  // chip (the loop's display text) instead of the Reflect banner, and a
  // callback that's told what the save resolved to so the caller can link
  // the intent to the new entry (see OpenLoopsWidget / intentClient.answerLoop).
  const handleAnswerLoop = useCallback((loopDisplayText, onSaved) => {
    setEntryMode('text');
    setIsFreshEntry(true);
    setCurrentPrompt(null);
    setReplyContext?.(null);
    setInitialContext(loopDisplayText);
    setOnEntrySavedCallback(() => onSaved);
    setShowEntryModal(true);
  }, [setReplyContext]);

  // Try-as-experiment (R4 Phase 3 Task 2): the single handler both
  // InsightsPage's ClaimCard seam (onTryExperiment) and RecommendationsSection's
  // idea-card CTAs are wired to — sets the prefill ExperimentsScreen reads
  // on mount, then opens it. Never passed to InsightsPage when
  // `personalExperiments` is off (see the render-site gate below) so a
  // button can never open a flag-hidden screen.
  const handleTryExperiment = useCallback((templateId, tag) => {
    setExperimentPrefill({ templateId, tag });
    setShowExperiments(true);
  }, []);

  // Handler for Quick Mood - also clears any stale replyContext
  const handleOpenQuickMood = () => {
    setReplyContext?.(null); // Clear any stale context
    setShowQuickLog(true);
  };

  // Zen tooltips management
  const { shouldShowWalkthrough, markWalkthroughComplete } = useZenTooltips();

  // Check if we should show the walkthrough on mount
  useEffect(() => {
    if (shouldShowWalkthrough()) {
      // Small delay to let the app render first
      const timer = setTimeout(() => setShowWalkthrough(true), 500);
      return () => clearTimeout(timer);
    }
  }, [shouldShowWalkthrough]);

  // Handle walkthrough completion
  const handleWalkthroughComplete = () => {
    markWalkthroughComplete();
    setShowWalkthrough(false);
  };

  // Handle walkthrough skip
  const handleWalkthroughSkip = () => {
    markWalkthroughComplete();
    setShowWalkthrough(false);
  };

  // Calculate latest mood score from entries for background
  const latestMoodScore = useMemo(() => {
    if (!entries || entries.length === 0) return null;

    // Find the most recent entry with a mood score
    const recentWithMood = entries.find(e =>
      e.analysis?.mood_score !== undefined &&
      e.analysis?.mood_score !== null
    );

    return recentWithMood?.analysis?.mood_score ?? null;
  }, [entries]);

  // Filter entries by category
  const filteredEntries = useMemo(() => {
    return entries?.filter(e => e.category === category) || [];
  }, [entries, category]);

  // Get time-based greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <>
      {/* Cloud canvas: linen + wave ambient background, mounted once behind all pages. */}
      <LinenWaveBackground />

      {/* Main content area - scrollable with padding for fixed bars */}
      {/* LAY-002: Increased bottom padding to prevent nav overlap */}
      <main
        className="
          min-h-screen
          text-foreground
          pt-[calc(env(safe-area-inset-top)+72px)]
          pb-[calc(env(safe-area-inset-bottom)+112px)]
          overflow-y-auto
        "
      >
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                entries={entries}
                category={category}
                userId={user?.uid}
                user={user}
                onPromptClick={onPromptClick}
                onToggleTask={onToggleTask}
                onShowInsights={onShowInsights}
                onStartRecording={onStartRecording}
                onStartTextEntry={onStartTextEntry}
                onPromptResponse={handlePromptResponse}
                onDayClick={handleDayClick}
                onAnswerLoop={handleAnswerLoop}
              />
            }
          />
          <Route
            path="/journal"
            element={
              <JournalPage
                entries={entries}
                category={category}
                onDayClick={onDayClick}
                onEntryClick={(id) => console.log('Entry clicked:', id)}
                onDelete={onDelete}
                onUpdate={onUpdate}
              />
            }
          />
          <Route
            path="/insights"
            element={
              <InsightsPage
                entries={entries}
                category={category}
                userId={user?.uid}
                user={user}
                onTryExperiment={getFlag('personalExperiments') ? handleTryExperiment : undefined}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                user={user}
                entries={entries}
                onOpenHealthSettings={onShowHealthSettings}
                onOpenNexusSettings={onShowNexusSettings}
                onOpenEntityManagement={onShowEntityManagement}
                onOpenReports={onShowReports}
                onOpenReliability={() => setShowReliabilityCenter(true)}
                onOpenPrivacy={() => setShowPrivacyCenter(true)}
                onOpenSpaces={() => setShowSpaceManager(true)}
                onOpenControlCenter={() => setShowControlCenter(true)}
                onOpenRecipes={() => setShowRecipes(true)}
                onOpenSessionPrep={() => setShowSessionPrep(true)}
                onOpenExperiments={() => { setExperimentPrefill(null); setShowExperiments(true); }}
                onOpenSafetyPlan={onShowSafetyPlan}
                onOpenExport={onShowExport}
                onRequestNotifications={onRequestNotifications}
                onLogout={onLogout}
                notificationPermission={notificationPermission}
              />
            }
          />
        </Routes>
      </main>

      {/* Fixed navigation elements */}
      <TopBar
        greeting={getGreeting()}
        onMoodOrbClick={() => setShowQuickLog(true)}
        latestMoodScore={latestMoodScore}
      />

      <CompanionNudge
        onClick={() => aiProcessingEnabled ? setShowCompanion(true) : onRequestAiConsent?.()}
        hasNewInsight={false}
      />

      <CapturedToast />

      <BottomNavbar onNewEntry={handleTextClick} />

      {/* Quick Log Modal */}
      <QuickLogModal
        isOpen={showQuickLog}
        onClose={() => setShowQuickLog(false)}
        onSave={onQuickMoodSave}
      />

      <EntryComposer
        ownerUid={user?.uid}
        isOpen={showEntryModal}
        mode={entryMode}
        onModeChange={setEntryMode}
        onClose={handleCloseEntryModal}
        onVoiceSave={async (base64, mime, options) => {
          // Capture the REAL Firestore doc id via the onEntryRef side-channel
          // (see App.jsx doSaveEntry's jsdoc) instead of relying on
          // handleAudioWrapper's own return value, which never carries a
          // usable entry id. This is what EntryComposer's onEntrySaved (e.g.
          // OpenLoopsWidget's "Answer" flow -> answerLoop) actually receives.
          //
          // I1: OpenLoopsWidget must not close a loop when the answer entry
          // never saved, so this wrapper reports three distinct outcomes
          // instead of coercing everything to an id-or-null:
          //  - a real Firestore id string (savedEntryId fired) — success.
          //  - the sentinel 'deferred' — the save genuinely completed with no
          //    id available on this call: either the offline-queue path
          //    (handleAudioWrapper resolves `true`, no online addDoc ran) or
          //    the documented crisis-deferred flow (resolves the string
          //    'deferred' — App.jsx's persistPendingEntry finishes the save
          //    on a later turn with no live listener left to hand an id to).
          //  - `false` — the save genuinely failed or threw; the loop must
          //    stay open (see OpenLoopsWidget's handleAnswer).
          let savedEntryId = null;
          const outcome = await handleEntrySubmitted(onAudioSubmit, base64, mime, {
            ...options,
            onEntryRef: (id) => { savedEntryId = id; },
          });
          if (savedEntryId) return savedEntryId;
          return (outcome === true || outcome === 'deferred') ? 'deferred' : false;
        }}
        onTextSave={async (text) => {
          // Same real-id capture and three-outcome contract as onVoiceSave
          // above. saveEntry's own return value here is 'saved' (including
          // the offline-queue no-id case), the crisis sentinel 'deferred',
          // or undefined (no user, or a save that failed even the offline
          // fallback) — only undefined means a genuine failure.
          let savedEntryId = null;
          const outcome = await handleEntrySubmitted(onTextSubmit, text, null, {
            onEntryRef: (id) => { savedEntryId = id; },
          });
          if (savedEntryId) return savedEntryId;
          return (outcome === 'deferred' || outcome === 'saved') ? 'deferred' : false;
        }}
        processing={processing}
        aiProcessingEnabled={aiProcessingEnabled}
        onRequestAiConsent={onRequestAiConsent}
        captureSpaceId={captureSpaceId}
        onCaptureSpaceIdChange={onCaptureSpaceIdChange}
        promptContext={isFreshEntry ? null : replyContext}
        initialContext={initialContext}
        onEntrySaved={onEntrySavedCallback}
        reflection={isFreshEntry && reflectionQuestions.length > 0 ? (
          <div className="mb-3 rounded-2xl bg-[var(--accent-wash)] p-3">
            <div className="mb-1 flex items-center justify-between text-[var(--accent-deep)]">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                <MessageCircle size={14} aria-hidden="true" /> Reflect
              </span>
              {reflectionQuestions.length > 1 && <span className="text-xs">{reflectionIndex + 1} / {reflectionQuestions.length}</span>}
            </div>
            <p className="text-sm leading-relaxed text-[var(--secondary-foreground)]">{reflectionQuestions[reflectionIndex]?.question}</p>
            {reflectionQuestions.length > 1 && (
              <div className="mt-1 flex gap-1">
                <button type="button" aria-label="Previous reflection" className="cloud-icon-button" onClick={goPrevReflection}><ChevronLeft size={16} /></button>
                <button type="button" aria-label="Next reflection" className="cloud-icon-button" onClick={goNextReflection}><ChevronRight size={16} /></button>
              </div>
            )}
          </div>
        ) : null}
      />

      {showReliabilityCenter && (
        <CaptureReliabilityCenter
          ownerUid={user?.uid}
          onClose={() => setShowReliabilityCenter(false)}
          onRetryAudio={(base64, mime, recordingId) => onAudioSubmit?.(base64, mime, { existingRecordingId: recordingId })}
        />
      )}

      {showPrivacyCenter && (
        <PrivacyCenter
          entries={entries}
          aiProcessingEnabled={aiProcessingEnabled}
          onClose={() => setShowPrivacyCenter(false)}
          onManageMemory={() => { setShowPrivacyCenter(false); onShowEntityManagement?.(); }}
          onExport={() => { setShowPrivacyCenter(false); onShowExport?.(); }}
          onToggleAi={async () => {
            setShowPrivacyCenter(false);
            if (aiProcessingEnabled) await onRevokeAiConsent?.();
            else onRequestAiConsent?.();
          }}
        />
      )}

      {showSpaceManager && (
        <SpaceManager
          uid={user?.uid}
          onClose={() => setShowSpaceManager(false)}
        />
      )}

      {/* Insight Control Center (R2 Task 12) — double-gated on the flag (not
          just the nav row that's the only way to flip showControlCenter
          true), mirroring ReceiptSheet's own flag-gated mount site in
          InsightsPage.jsx. Fix C (2026-07-24 brief): mounts on EITHER
          `insightReceipts` OR `insightClaims` — rebuild is useful
          independently of receipts, and Control Center is the brief's
          preferred placement 2 for the shared rebuild action. */}
      {(getFlag('insightReceipts') || getFlag('insightClaims')) && showControlCenter && (
        <InsightControlCenter
          uid={user?.uid}
          entries={entries}
          onClose={() => setShowControlCenter(false)}
        />
      )}

      {/* Reflection Recipes (R2 Task 17) — double-gated on the flag (not
          just the nav row that's the only way to flip showRecipes true),
          mirroring Insight Control Center's own mount site above. */}
      {getFlag('reflectionRecipes') && showRecipes && (
        <RecipesScreen
          uid={user?.uid}
          entries={entries}
          onClose={() => setShowRecipes(false)}
        />
      )}

      {/* Session Prep (R2 Task 18) — double-gated on the flag (not just the
          nav row that's the only way to flip showSessionPrep true),
          mirroring Reflection Recipes' own mount site above. */}
      {getFlag('sessionPrep') && showSessionPrep && (
        <SessionPrepScreen
          uid={user?.uid}
          entries={entries}
          onClose={() => setShowSessionPrep(false)}
        />
      )}

      {/* Personal Experiments (R3 Task 6) — double-gated on the flag (not
          just the nav row that's the only way to flip showExperiments
          true), mirroring Reflection Recipes'/Session Prep's own mount
          sites above. `onShowSafetyPlan` is the existing crisis-decline
          surface reuse (App.jsx's real SafetyPlanScreen, already wired
          through this prop for every other safety-plan entry point in this
          file — see `onShowSafetyPlan={() => setShowSafetyPlan(true)}` at
          the top-level call site); `onOpenRecipes` is the medical-decline
          "Reflection Recipe" CTA, reusing the same `setShowRecipes` state
          RecipesScreen's own mount site above uses. Both close the
          Experiments screen first so only one full-screen overlay is ever
          visible at a time. */}
      {getFlag('personalExperiments') && showExperiments && (
        <ExperimentsScreen
          uid={user?.uid}
          entries={entries}
          prefill={experimentPrefill}
          onClose={() => { setShowExperiments(false); setExperimentPrefill(null); }}
          onShowSafetyPlan={() => { setShowExperiments(false); setExperimentPrefill(null); onShowSafetyPlan?.(); }}
          onOpenRecipes={() => { setShowExperiments(false); setExperimentPrefill(null); setShowRecipes(true); }}
        />
      )}

      {/* AI Companion (full screen) */}
      <AnimatePresence>
        {showCompanion && (
          <UnifiedConversation
            entries={filteredEntries}
            category={category}
            userId={user?.uid}
            onClose={() => setShowCompanion(false)}
            onSaveEntry={onSaveEntry}
          />
        )}
      </AnimatePresence>

      {/* Sanctuary Walkthrough (first-time experience) */}
      <SanctuaryWalkthrough
        isOpen={showWalkthrough}
        onComplete={handleWalkthroughComplete}
        onSkip={handleWalkthroughSkip}
      />

      {/* FAB Tooltip (shows after walkthrough) */}
      {!showWalkthrough && <FABTooltip />}

      {/* Day Summary Modal (from 30-day journey) */}
      <DaySummaryModal
        isOpen={daySummary.isOpen}
        onClose={handleCloseDaySummary}
        date={daySummary.date}
        dayData={daySummary.dayData}
        onEntryClick={(entry) => {
          handleCloseDaySummary();
          // Could navigate to entry detail or open in modal
          console.log('Entry clicked:', entry.id);
        }}
      />

      {/* Additional modals passed from App.jsx */}
      {children}
    </>
  );
};

export default AppLayout;
