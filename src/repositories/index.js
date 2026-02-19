/**
 * Repositories Index
 *
 * Central export for all repository instances.
 * These repositories provide the data access layer for Firestore.
 */

// Base repository for custom extensions
export { BaseRepository } from './base';

// Domain repositories
export { entriesRepository, EntriesRepository } from './entries';
export { signalsRepository, exclusionsRepository, SignalsRepository, ExclusionsRepository } from './signals';
export { healthRepository, HealthRepository } from './health';
export { usersRepository, UsersRepository } from './users';
export { analyticsRepository, AnalyticsRepository } from './analytics';
