import { useState, useMemo } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';

// Zen components
import MoodBackgroundProvider from './MoodBackgroundProvider';
import TopBar from './TopBar';
import BottomNavbar from './BottomNavbar';
import CompanionNudge from './CompanionNudge';
import QuickLogModal from './QuickLogModal';

// Pages
import { HomePage, JournalPage, InsightsPage, SettingsPage } from '../../pages';

// Screens (modals that overlay the entire app)
import UnifiedConversation from '../chat/UnifiedConversation';

/**
 * AppLayout - Main application shell with Zen & Bento navigation
 *
 * Provides:
 * - Mood-reactive animated background
 * - Translucent TopBar with mood orb
 * - Bottom navigation with expandable FAB
 * - Companion nudge (AI assistant shortcut)
 * - Route-based page rendering
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

      {/* Additional modals passed from App.jsx */}
      {children}
    </MoodBackgroundProvider>
  );
};

export default AppLayout;
