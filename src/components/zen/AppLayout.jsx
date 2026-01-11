import { useState, useMemo, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

// Zen components
import MoodBackgroundProvider from './MoodBackgroundProvider';
import TopBar from './TopBar';
import BottomNavbar from './BottomNavbar';
import CompanionNudge from './CompanionNudge';
import QuickLogModal from './QuickLogModal';
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
  const [showQuickLog, setShowQuickLog] = useState(false);
  const [showCompanion, setShowCompanion] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [showEntryModal, setShowEntryModal] = useState(false);

  // Show entry modal when replyContext is set (from FAB)
  useEffect(() => {
    if (replyContext) {
      setShowEntryModal(true);
    }
  }, [replyContext]);

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
      <main
        className="
          min-h-screen
          pt-[calc(env(safe-area-inset-top)+60px)]
          pb-[calc(env(safe-area-inset-bottom)+80px)]
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
                setEntryPreferredMode={setEntryPreferredMode}
                setReplyContext={setReplyContext}
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
                onShowFullInsights={onShowInsights}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                user={user}
                onOpenHealthSettings={onShowHealthSettings}
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
        onVoiceEntry={onVoiceEntry}
        onTextEntry={onTextEntry}
        onQuickMood={() => setShowQuickLog(true)}
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
              className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowEntryModal(false);
                setReplyContext(null);
              }}
            />

            {/* Entry Bar Modal */}
            <motion.div
              className="fixed inset-x-4 bottom-24 z-50"
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
            >
              <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-glass-lg overflow-hidden">
                <EntryBar
                  onAudio={async (base64, mime) => {
                    await onAudioSubmit?.(base64, mime);
                    setShowEntryModal(false);
                    setReplyContext(null);
                  }}
                  onText={async (text) => {
                    await onTextSubmit?.(text);
                    setShowEntryModal(false);
                    setReplyContext(null);
                  }}
                  processing={processing}
                  preferredMode={entryPreferredMode}
                  replyContext={replyContext}
                  onClearReply={() => {
                    setShowEntryModal(false);
                    setReplyContext(null);
                  }}
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

      {/* Additional modals passed from App.jsx */}
      {children}
    </MoodBackgroundProvider>
  );
};

export default AppLayout;
