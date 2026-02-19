/**
 * useNudgeOrchestrator Hook
 *
 * Integrates the NudgeOrchestrator service with the dashboard.
 * Handles async fetching, caching, and user interactions with nudges.
 *
 * Key features:
 * - Memoized to prevent re-renders during dashboard updates
 * - Debounced to avoid rapid nudge recalculation
 * - Tracks user responses for future optimization
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { orchestrateNudges, recordNudgeResponse } from '../services/nudges/nudgeOrchestrator';

/**
 * useNudgeOrchestrator - Dashboard integration for wellness nudges
 *
 * @param {Object} options
 * @param {string} options.userId - Current user ID
 * @param {Object|null} options.burnoutRisk - From useBurnoutRisk hook
 * @param {Object|null} options.socialHealth - From analyzeSocialHealth
 * @param {Object|null} options.anticipatoryEvent - From shouldShowAnticipatorySupport
 * @param {Object|null} options.valueGap - From value alignment service
 * @param {Object|null} options.pendingReflection - From checkForPendingFollowUps
 * @param {Object|null} options.gapPrompt - From generateGapPrompt (gap detector)
 * @param {boolean} options.enabled - Whether nudges are enabled (default true)
 *
 * @returns {Object} Current nudge state and handlers
 */
export const useNudgeOrchestrator = ({
  userId,
  burnoutRisk = null,
  socialHealth = null,
  anticipatoryEvent = null,
  valueGap = null,
  pendingReflection = null,
  gapPrompt = null,
  enabled = true
}) => {
  const [currentNudge, setCurrentNudge] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [acted, setActed] = useState(false);

  // Track last orchestration to prevent rapid re-runs
  const lastOrchestrationRef = useRef(null);
  const debounceTimeoutRef = useRef(null);

  // Memoize all nudge inputs to detect meaningful changes
  const nudgeInputs = useMemo(() => ({
    burnoutNudge: burnoutRisk?.triggerShelterMode ? burnoutRisk : null,
    socialNudge: socialHealth?.isolationRisk || socialHealth?.isImbalanced
      ? {
        type: socialHealth.isolationRisk ? 'isolation_alert' : 'balance_nudge',
        priority: socialHealth.isolationRisk ? 'high' : 'medium',
        ...socialHealth
      }
      : null,
    anticipatoryNudge: anticipatoryEvent?.show ? anticipatoryEvent : null,
    valueNudge: valueGap?.hasSignificantGap ? valueGap : null,
    reflectionPrompt: pendingReflection?.[0] || null,
    gapPrompt: gapPrompt || null
  }), [burnoutRisk, socialHealth, anticipatoryEvent, valueGap, pendingReflection, gapPrompt]);

  // Check if inputs have meaningfully changed
  const inputsHash = useMemo(() => {
    return JSON.stringify({
      burnout: !!nudgeInputs.burnoutNudge,
      social: nudgeInputs.socialNudge?.type,
      anticipatory: !!nudgeInputs.anticipatoryNudge,
      value: !!nudgeInputs.valueNudge,
      reflection: !!nudgeInputs.reflectionPrompt,
      gap: !!nudgeInputs.gapPrompt
    });
  }, [nudgeInputs]);

  // Orchestrate nudges when inputs change (debounced)
  useEffect(() => {
    if (!enabled || !userId) {
      setCurrentNudge(null);
      return;
    }

    // Skip if inputs haven't meaningfully changed
    if (lastOrchestrationRef.current === inputsHash) {
      return;
    }

    // Clear any pending debounce
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Debounce orchestration by 500ms to prevent rapid re-runs
    debounceTimeoutRef.current = setTimeout(async () => {
      setLoading(true);

      try {
        const result = await orchestrateNudges(nudgeInputs, userId);
        lastOrchestrationRef.current = inputsHash;

        // Only update if not already dismissed/acted
        if (!dismissed && !acted) {
          setCurrentNudge(result);
        }
      } catch (error) {
        console.error('Failed to orchestrate nudges:', error);
        setCurrentNudge(null);
      }

      setLoading(false);
    }, 500);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [userId, enabled, inputsHash, nudgeInputs, dismissed, acted]);

  // Handle user dismissing a nudge
  const dismissNudge = useCallback(async (reason = 'dismissed') => {
    if (!currentNudge || !userId) return;

    setDismissed(true);
    setCurrentNudge(null);

    await recordNudgeResponse(userId, currentNudge._orchestrator?.type, 'dismissed');
  }, [currentNudge, userId]);

  // Handle user acting on a nudge
  const actOnNudge = useCallback(async (action) => {
    if (!currentNudge || !userId) return;

    setActed(true);

    await recordNudgeResponse(userId, currentNudge._orchestrator?.type, 'acted');

    // Return action for the calling component to execute
    return action;
  }, [currentNudge, userId]);

  // Handle user postponing a nudge
  const postponeNudge = useCallback(async () => {
    if (!currentNudge || !userId) return;

    setDismissed(true);
    setCurrentNudge(null);

    await recordNudgeResponse(userId, currentNudge._orchestrator?.type, 'postponed');
  }, [currentNudge, userId]);

  // Reset state (e.g., when user navigates away and back)
  const resetNudgeState = useCallback(() => {
    setDismissed(false);
    setActed(false);
    lastOrchestrationRef.current = null;
  }, []);

  return {
    // Current nudge to display (or null)
    nudge: currentNudge,

    // Loading state for initial orchestration
    isLoading: loading,

    // Whether user has interacted with nudge this session
    hasInteracted: dismissed || acted,

    // Orchestration metadata
    orchestratorInfo: currentNudge?._orchestrator || null,

    // Actions
    dismissNudge,
    actOnNudge,
    postponeNudge,
    resetNudgeState,

    // Debug info
    debug: {
      inputsHash,
      allNudges: nudgeInputs,
      suppressed: currentNudge?._orchestrator?.suppressed || 0
    }
  };
};

export default useNudgeOrchestrator;
