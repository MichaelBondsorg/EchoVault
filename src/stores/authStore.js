/**
 * Auth Store
 *
 * Manages authentication state including user, login modes, and MFA.
 * Extracted from App.jsx to reduce complexity and improve maintainability.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * @typedef {'signin' | 'signup' | 'reset' | 'mfa'} AuthMode
 */

const initialState = {
  // Core auth
  user: null,

  // Auth UI state
  authMode: 'signin',
  email: '',
  password: '',
  displayName: '',
  showPassword: false,
  authLoading: false,
  authError: '',
  showEmailForm: false,

  // MFA state
  mfaResolver: null,
  mfaCode: '',
  mfaHint: ''
};

export const useAuthStore = create(
  devtools(
    (set, get) => ({
      ...initialState,

      // ============================================
      // USER ACTIONS
      // ============================================

      /**
       * Set the authenticated user
       */
      setUser: (user) => set({ user }, false, 'auth/setUser'),

      /**
       * Clear user on logout
       */
      clearUser: () => set({ user: null }, false, 'auth/clearUser'),

      // ============================================
      // AUTH MODE ACTIONS
      // ============================================

      /**
       * Set auth mode (signin, signup, reset, mfa)
       */
      setAuthMode: (authMode) => set({ authMode, authError: '' }, false, 'auth/setAuthMode'),

      /**
       * Toggle between signin and signup
       */
      toggleAuthMode: () => {
        const current = get().authMode;
        const newMode = current === 'signin' ? 'signup' : 'signin';
        set({ authMode: newMode, authError: '' }, false, 'auth/toggleAuthMode');
      },

      /**
       * Switch to password reset mode
       */
      switchToReset: () => set({ authMode: 'reset', authError: '' }, false, 'auth/switchToReset'),

      /**
       * Switch to MFA mode
       */
      switchToMfa: (resolver, hint = '') => set({
        authMode: 'mfa',
        mfaResolver: resolver,
        mfaHint: hint,
        authError: ''
      }, false, 'auth/switchToMfa'),

      // ============================================
      // FORM FIELD ACTIONS
      // ============================================

      setEmail: (email) => set({ email }, false, 'auth/setEmail'),
      setPassword: (password) => set({ password }, false, 'auth/setPassword'),
      setDisplayName: (displayName) => set({ displayName }, false, 'auth/setDisplayName'),
      toggleShowPassword: () => set(
        (state) => ({ showPassword: !state.showPassword }),
        false,
        'auth/toggleShowPassword'
      ),
      setShowEmailForm: (show) => set({ showEmailForm: show }, false, 'auth/setShowEmailForm'),

      // ============================================
      // MFA ACTIONS
      // ============================================

      setMfaCode: (mfaCode) => set({ mfaCode }, false, 'auth/setMfaCode'),

      clearMfaState: () => set({
        mfaResolver: null,
        mfaCode: '',
        mfaHint: ''
      }, false, 'auth/clearMfaState'),

      // ============================================
      // LOADING & ERROR ACTIONS
      // ============================================

      setAuthLoading: (loading) => set({ authLoading: loading }, false, 'auth/setAuthLoading'),
      setAuthError: (error) => set({ authError: error }, false, 'auth/setAuthError'),
      clearAuthError: () => set({ authError: '' }, false, 'auth/clearAuthError'),

      // ============================================
      // COMPOSITE ACTIONS
      // ============================================

      /**
       * Start auth process (set loading, clear error)
       */
      startAuth: () => set({ authLoading: true, authError: '' }, false, 'auth/startAuth'),

      /**
       * Complete auth process with error
       */
      authFailed: (error) => set({
        authLoading: false,
        authError: error
      }, false, 'auth/authFailed'),

      /**
       * Complete auth process successfully
       */
      authSuccess: () => set({
        authLoading: false,
        authError: '',
        email: '',
        password: '',
        displayName: '',
        showEmailForm: false
      }, false, 'auth/authSuccess'),

      /**
       * Reset all auth form state
       */
      resetAuthForm: () => set({
        authMode: 'signin',
        email: '',
        password: '',
        displayName: '',
        showPassword: false,
        authLoading: false,
        authError: '',
        showEmailForm: false,
        mfaResolver: null,
        mfaCode: '',
        mfaHint: ''
      }, false, 'auth/resetAuthForm'),

      /**
       * Full reset on logout
       */
      reset: () => set(initialState, false, 'auth/reset')
    }),
    { name: 'auth-store' }
  )
);

// Selector hooks for common patterns
export const useUser = () => useAuthStore((state) => state.user);
export const useIsAuthenticated = () => useAuthStore((state) => state.user !== null);
export const useAuthLoading = () => useAuthStore((state) => state.authLoading);
export const useAuthError = () => useAuthStore((state) => state.authError);
