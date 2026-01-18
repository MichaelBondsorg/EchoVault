import { useState, useMemo, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

// Zen components
import MoodBackgroundProvider from './MoodBackgroundProvider';
import TopBar from './TopBar';
import BottomNavbar from './BottomNavbar';
import CompanionNudge from './CompanionNudge';
import QuickLogModal from './QuickLogModal';
import DaySummaryModal from './DaySummaryModal';
import SanctuaryWalkthrough from './SanctuaryWalkthrough';
import { FABTooltip, useZenTooltips } from './ZenTooltips';

// Pages
import { HomePage, JournalPage, InsightsPage, SettingsPage } from '../../pages';

// Screens (modals that overlay the entire app)
import UnifiedConversation from '../chat/UnifiedConversation';

// Entry components
import EntryBar from '../dashboard/EntryBar';

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
  onRequestNotifications,
  onLogout,

  // Entry bar context
  setEntryPreferredMode,
  setReplyContext,
  replyContext,
  entryPreferredMode,
  onAudioSubmit,
  onTextSubmit,
  processing,

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
  const [entryMode, setEntryMode] = useState('text'); // 'voice' or 'text'
  const [isFreshEntry, setIsFreshEntry] = useState(true); // true = FAB entry, false = responding to prompt
  const [currentPrompt, setCurrentPrompt] = useState(null); // Track prompt being answered for auto-dismiss
  const [daySummary, setDaySummary] = useState({ isOpen: false, date: null, dayData: null }); // Day summary modal

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

  // Handler for responding to a reflection prompt (from Reflect card)
  // This DOES use the replyContext and shows "[Replying to ...]"
  const handlePromptResponse = (prompt, mode = 'text') => {
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
  };

  // Handler for successful entry submission - dismisses prompt if responding to one
  const handleEntrySubmitted = async (submitFn, ...args) => {
    try {
      await submitFn?.(...args);
      // If this was a response to a reflection prompt, dismiss it
      if (currentPrompt && !isFreshEntry) {
        dismissReflectionPrompt(currentPrompt);
      }
      handleCloseEntryModal();
    } catch (e) {
      console.error('Entry submission failed:', e);
      handleCloseEntryModal();
    }
  };

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
    if (!entries || entries.length === 0) return 0.5;

    // Find the most recent entry with a mood score
    const recentWithMood = entries.find(e =>
      e.analysis?.mood_score !== undefined &&
      e.analysis?.mood_score !== null
    );

    return recentWithMood?.analysis?.mood_score ?? 0.5;
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
    <MoodBackgroundProvider moodScore={latestMoodScore}>
      {/* Main content area - scrollable with padding for fixed bars */}
      {/* LAY-002: Increased bottom padding to prevent nav overlap */}
      <main
        className="
          min-h-screen
          pt-[calc(env(safe-area-inset-top)+60px)]
          pb-[calc(env(safe-area-inset-bottom)+100px)]
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
                onOpenHealthSettings={onShowHealthSettings}
                onOpenNexusSettings={onShowNexusSettings}
                onOpenEntityManagement={onShowEntityManagement}
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
        onClick={() => setShowCompanion(true)}
        hasNewInsight={false}
      />

      <BottomNavbar
        onVoiceEntry={handleVoiceClick}
        onTextEntry={handleTextClick}
        onQuickMood={handleOpenQuickMood}
      />

      {/* Quick Log Modal */}
      <QuickLogModal
        isOpen={showQuickLog}
        onClose={() => setShowQuickLog(false)}
        onSave={onQuickMoodSave}
      />

      {/* Entry Modal (Voice/Text from FAB) */}
      <AnimatePresence>
        {showEntryModal && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[60]"
              style={{ minHeight: '100dvh' }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onTouchEnd={handleCloseEntryModal}
              onClick={handleCloseEntryModal}
            />

            {/* Entry Bar Modal - iOS safe positioning */}
            <motion.div
              className="fixed left-4 right-4 z-[60]"
              style={{
                bottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))',
                WebkitOverflowScrolling: 'touch',
              }}
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
            >
              <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-glass-lg overflow-hidden">
                <EntryBar
                  embedded={true}
                  onVoiceSave={(base64, mime) => handleEntrySubmitted(onAudioSubmit, base64, mime)}
                  onTextSave={(text) => handleEntrySubmitted(onTextSubmit, text)}
                  loading={processing}
                  preferredMode={entryMode}
                  promptContext={isFreshEntry ? null : replyContext}
                  onClearPrompt={handleCloseEntryModal}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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
    </MoodBackgroundProvider>
  );
};

export default AppLayout;
