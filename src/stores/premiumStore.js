/**
 * Premium Store
 *
 * Manages client-side premium/subscription state.
 * Sources subscription data from Firestore via the premium service.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const initialState = {
  isPremium: false,
  subscription: null,
  loading: false,
  lastChecked: null,
};

export const usePremiumStore = create(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchSubscription: async (userId, force = false) => {
        const { lastChecked } = get();

        // Skip if recently checked (within TTL) and not forced
        if (!force && lastChecked && (Date.now() - lastChecked.getTime()) < CACHE_TTL_MS) {
          return;
        }

        set({ loading: true }, false, 'premium/fetchStart');

        try {
          const { getSubscription, derivePremiumFromSubscription } = await import('../services/premium');
          const subscription = await getSubscription(userId);
          const premium = derivePremiumFromSubscription(subscription);

          set({
            isPremium: premium,
            subscription,
            loading: false,
            lastChecked: new Date(),
          }, false, 'premium/fetchComplete');
        } catch (e) {
          console.error('[premiumStore] Failed to fetch subscription:', e);
          set({ loading: false }, false, 'premium/fetchError');
        }
      },

      checkFeature: async (userId, featureKey) => {
        const { checkEntitlement } = await import('../services/premium');
        return checkEntitlement(userId, featureKey);
      },

      setPremiumStatus: (isPremium, subscription) => {
        set({ isPremium, subscription, lastChecked: new Date() }, false, 'premium/setStatus');
      },

      clearPremiumState: () => set(initialState, false, 'premium/clear'),
    }),
    { name: 'premium-store' }
  )
);

// Selector hooks
export const useIsPremium = () => usePremiumStore((state) => state.isPremium);
export const usePremiumLoading = () => usePremiumStore((state) => state.loading);
export const useSubscription = () => usePremiumStore((state) => state.subscription);
