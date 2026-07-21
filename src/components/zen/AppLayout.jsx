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

    // Load dismissed questions from localStorage
    const dismissedKey = `reflections_dismissed_${category}`;
    let dismissed = new Set();
    try {
      const stored = localStorage.getItem(dismissedKey);
      if (stored) dismissed = new Set(JSON.parse(stored));
    } catch (e) { /* ignore */ }

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
  }, [entries, category]);

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

  // Function to dismiss a reflection prompt (add to localStorage)
  const dismissReflectionPrompt = (prompt) => {
    if (!prompt || !category) return;
    const key = `reflections_dismissed_${category}`;
    try {
      const stored = localStorage.getItem(key);
      const dismissed = stored ? JSON.parse(stored) : [];
      const promptKey = prompt.toLowerCase();
      if (!dismissed.includes(promptKey)) {
        dismissed.push(promptKey);
        localStorage.setItem(key, JSON.stringify(dismissed));
      }
    } catch (e) {
      console.error('Failed to dismiss reflection:', e);
    }
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
          // handleAudioWrapper's own return value, which is just a boolean
          // ('saved' vs not) — never a usable entry id. This is what
          // EntryComposer's onEntrySaved (e.g. OpenLoopsWidget's "Answer"
          // flow -> answerLoop) actually receives.
          let savedEntryId = null;
          await handleEntrySubmitted(onAudioSubmit, base64, mime, {
            ...options,
            onEntryRef: (id) => { savedEntryId = id; },
          });
          return savedEntryId;
        }}
        onTextSave={async (text) => {
          // Same real-id capture as onVoiceSave above — saveEntry's own
          // return value here is the sentinel string 'saved'/'deferred',
          // never an entry id.
          let savedEntryId = null;
          await handleEntrySubmitted(onTextSubmit, text, null, {
            onEntryRef: (id) => { savedEntryId = id; },
          });
          return savedEntryId;
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
