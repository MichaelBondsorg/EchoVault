/**
 * Premium Entitlement Service Tests
 *
 * Tests for isPremium, checkEntitlement, and feature flag resolution.
 * Uses dynamic import mocking to avoid Firebase initialization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PREMIUM_FEATURES,
  isKnownFeature,
  requiresPremium,
} from '../features';

// We test the pure feature flag functions directly.
// For isPremium and checkEntitlement, we test the logic by mocking getSubscription.

describe('Feature Definitions', () => {
  it('marks reports.weekly as free (not in PREMIUM_FEATURES)', () => {
    expect(PREMIUM_FEATURES['reports.weekly']).toBeUndefined();
  });

  it('marks reports.monthly as premium', () => {
    expect(PREMIUM_FEATURES['reports.monthly']).toBe(true);
  });

  it('marks reports.quarterly as premium', () => {
    expect(PREMIUM_FEATURES['reports.quarterly']).toBe(true);
  });

  it('marks reports.annual as premium', () => {
    expect(PREMIUM_FEATURES['reports.annual']).toBe(true);
  });

  it('marks voice.insights as premium', () => {
    expect(PREMIUM_FEATURES['voice.insights']).toBe(true);
  });

  it('marks prompts.gaps as premium', () => {
    expect(PREMIUM_FEATURES['prompts.gaps']).toBe(true);
  });

  it('marks guided.insight_exploration as premium', () => {
    expect(PREMIUM_FEATURES['guided.insight_exploration']).toBe(true);
  });
});

describe('isKnownFeature', () => {
  it('recognizes all known features', () => {
    expect(isKnownFeature('reports.weekly')).toBe(true);
    expect(isKnownFeature('reports.monthly')).toBe(true);
    expect(isKnownFeature('reports.quarterly')).toBe(true);
    expect(isKnownFeature('reports.annual')).toBe(true);
    expect(isKnownFeature('voice.insights')).toBe(true);
    expect(isKnownFeature('prompts.gaps')).toBe(true);
    expect(isKnownFeature('guided.insight_exploration')).toBe(true);
  });

  it('rejects unknown features', () => {
    expect(isKnownFeature('unknown.feature')).toBe(false);
    expect(isKnownFeature('')).toBe(false);
    expect(isKnownFeature('reports')).toBe(false);
  });
});

describe('requiresPremium', () => {
  it('returns false for free features', () => {
    expect(requiresPremium('reports.weekly')).toBe(false);
  });

  it('returns true for premium features', () => {
    expect(requiresPremium('reports.monthly')).toBe(true);
    expect(requiresPremium('voice.insights')).toBe(true);
    expect(requiresPremium('prompts.gaps')).toBe(true);
  });

  it('returns false for unknown features', () => {
    expect(requiresPremium('nonexistent')).toBe(false);
  });
});

// Mock the dynamic imports used by isPremium and checkEntitlement
const mockGetDoc = vi.fn();
const mockDoc = vi.fn(() => 'mock-ref');

vi.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  getDoc: (...args) => mockGetDoc(...args),
}));

vi.mock('../../../config/firebase', () => ({
  db: {},
}));

vi.mock('../../../config/constants', () => ({
  APP_COLLECTION_ID: 'test-collection',
}));

describe('isPremium', () => {
  let isPremium;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to get fresh module with mocks
    const mod = await import('../index');
    isPremium = mod.isPremium;
  });

  it('returns true for user with active premium subscription', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        status: 'active',
        plan: 'monthly',
        expiresAt: null,
      }),
    });

    expect(await isPremium('user1')).toBe(true);
  });

  it('returns true for user with trialing subscription', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        status: 'trialing',
        expiresAt: null,
      }),
    });

    expect(await isPremium('user1')).toBe(true);
  });

  it('returns false for user with no subscription document', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => false,
    });

    expect(await isPremium('user1')).toBe(false);
  });

  it('returns false for user with expired subscription', async () => {
    const pastDate = new Date('2020-01-01');
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        status: 'active',
        expiresAt: { toDate: () => pastDate },
      }),
    });

    expect(await isPremium('user1')).toBe(false);
  });

  it('returns true for cancelled but not yet expired subscription', async () => {
    const futureDate = new Date(Date.now() + 86400000); // tomorrow
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        status: 'cancelled',
        expiresAt: { toDate: () => futureDate },
      }),
    });

    expect(await isPremium('user1')).toBe(true);
  });

  it('returns false for cancelled and expired subscription', async () => {
    const pastDate = new Date('2020-01-01');
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        status: 'cancelled',
        expiresAt: { toDate: () => pastDate },
      }),
    });

    expect(await isPremium('user1')).toBe(false);
  });

  it('returns false for cancelled subscription with no expiresAt', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        status: 'cancelled',
        expiresAt: null,
      }),
    });

    expect(await isPremium('user1')).toBe(false);
  });

  it('returns false for expired status', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        status: 'expired',
        expiresAt: null,
      }),
    });

    expect(await isPremium('user1')).toBe(false);
  });

  it('returns false for null/undefined userId', async () => {
    expect(await isPremium(null)).toBe(false);
    expect(await isPremium(undefined)).toBe(false);
    expect(await isPremium('')).toBe(false);
  });

  it('handles Firestore errors gracefully', async () => {
    mockGetDoc.mockRejectedValue(new Error('Network error'));

    expect(await isPremium('user1')).toBe(false);
  });
});

describe('checkEntitlement', () => {
  let checkEntitlement;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../index');
    checkEntitlement = mod.checkEntitlement;
  });

  it('allows free features for any user', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });

    const result = await checkEntitlement('user1', 'reports.weekly');
    expect(result).toEqual({ entitled: true, reason: 'free_feature' });
  });

  it('blocks premium features for free users', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });

    const result = await checkEntitlement('user1', 'reports.monthly');
    expect(result).toEqual({ entitled: false, reason: 'premium_required' });
  });

  it('allows premium features for premium users', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ status: 'active', expiresAt: null }),
    });

    const result = await checkEntitlement('user1', 'reports.monthly');
    expect(result).toEqual({ entitled: true, reason: 'premium_active' });
  });

  it('returns not entitled for unknown feature keys', async () => {
    const result = await checkEntitlement('user1', 'unknown.feature');
    expect(result).toEqual({ entitled: false, reason: 'unknown_feature' });
  });
});
