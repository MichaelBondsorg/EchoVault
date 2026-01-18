// Error Boundary
export { default as ErrorBoundary } from './ErrorBoundary';

// Modals
export { CrisisSoftBlockModal, DailySummaryModal, WeeklyReport, InsightsPanel, EntryInsightsPopup } from './modals';

// Screens
export { CrisisResourcesScreen, SafetyPlanScreen, DecompressionScreen, TherapistExportScreen, PromptScreen, JournalScreen, HealthSettingsScreen } from './screens';

// Chat
export { Chat, RealtimeConversation } from './chat';

// Entries
export { EntryCard, MoodHeatmap } from './entries';

// Input
export { VoiceRecorder, TextInput, NewEntryButton } from './input';

// UI
export { MarkdownLite, GetHelpButton, HamburgerMenu } from './ui';

// Dashboard
export { DayDashboard, EntryBar } from './dashboard';

// Lazy-loaded components for code splitting
export {
  LazyHealthSettingsScreen,
  LazyJournalScreen,
  LazyTherapistExportScreen,
  LazySafetyPlanScreen,
  LazyCrisisResourcesScreen,
  LazyDecompressionScreen,
  LazyEntityManagementPage,
  LazyNexusSettings,
  LazyWeeklyReport,
  LazyInsightsPanel,
  withSuspense,
  LoadingFallback,
  // Pre-wrapped versions with Suspense
  HealthSettingsScreenWithSuspense,
  JournalScreenWithSuspense,
  TherapistExportScreenWithSuspense,
  SafetyPlanScreenWithSuspense,
  CrisisResourcesScreenWithSuspense,
  DecompressionScreenWithSuspense,
  EntityManagementPageWithSuspense,
  NexusSettingsWithSuspense,
  WeeklyReportWithSuspense,
  InsightsPanelWithSuspense
} from './lazy';
