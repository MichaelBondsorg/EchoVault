/**
 * Engram Type Definitions
 *
 * Central export for all TypeScript type definitions.
 * These types provide IDE support and documentation for the codebase.
 */

// Entry types
export type {
  Entry,
  EntryCategory,
  AnalysisStatus,
  AnalysisResult,
  Emotion,
  CognitivePattern,
  EntryClassification,
  HealthContext,
  EnvironmentContext,
  OfflineEntry,
  TherapeuticFramework
} from './entries';

// Signal types
export type {
  Signal,
  SignalType,
  SignalState,
  GoalState,
  InsightState,
  PatternState,
  GoalSignal,
  InsightSignal,
  PatternSignal,
  ContradictionSignal,
  StateTransition,
  TransitionContext,
  SignalExclusions,
  SignalUserFeedback,
  SignalMetadata,
  GoalMilestone,
  CreateSignalInput,
  InsightExclusion,
  ValidTransitionsMap
} from './signals';

// Health types
export type {
  HealthSource,
  HealthCorrelation,
  HealthCorrelationType,
  CorrelationStrength,
  SleepMoodCorrelation,
  HrvMoodCorrelation,
  ExerciseMoodCorrelation,
  RecoveryMoodCorrelation,
  HealthCorrelations,
  HealthDataSufficiency,
  WhoopTokens,
  HealthSettings,
  ExtractedHealthSignals,
  SleepStages
} from './health';

// User types
export type {
  AuthUser,
  UserProfile,
  UserPreferences,
  SafetyPlan,
  SupportContact,
  ProfessionalContact,
  CrisisModalState,
  UserSession,
  DeviceInfo,
  NotificationSettings,
  TherapistExportRequest,
  StreakInfo
} from './user';

// Re-export DEFAULT_SAFETY_PLAN constant
export { DEFAULT_SAFETY_PLAN } from './user';
