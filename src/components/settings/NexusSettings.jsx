/**
 * Nexus Settings Component
 *
 * User controls for Nexus 2.0 features
 */

import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

const NexusSettings = ({ user }) => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      if (!user?.uid) return;

      try {
        const settingsRef = doc(
          db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'settings', 'nexus'
        );

        const settingsDoc = await getDoc(settingsRef);

        if (settingsDoc.exists()) {
          setSettings(settingsDoc.data());
        } else {
          // Set defaults
          setSettings({
            features: {
              beliefDissonanceInsights: { enabled: true },
              interventionRecommendations: { enabled: true },
              narrativeArcTracking: { enabled: true },
              counterfactualInsights: { enabled: true }
            },
            preferences: {
              insightDepth: 'comprehensive',
              moodGateThreshold: 50
            }
          });
        }
      } catch (error) {
        console.error('[NexusSettings] Load failed:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [user?.uid]);

  // Save settings
  const saveSettings = async (newSettings) => {
    if (!user?.uid) return;

    setSaving(true);

    try {
      const settingsRef = doc(
        db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'settings', 'nexus'
      );

      await setDoc(settingsRef, {
        ...newSettings,
        updatedAt: Timestamp.now()
      });

      setSettings(newSettings);
    } catch (error) {
      console.error('[NexusSettings] Save failed:', error);
    } finally {
      setSaving(false);
    }
  };

  // Toggle feature
  const toggleFeature = (featureName) => {
    const newSettings = {
      ...settings,
      features: {
        ...settings.features,
        [featureName]: {
          ...settings.features[featureName],
          enabled: !settings.features[featureName]?.enabled
        }
      }
    };
    saveSettings(newSettings);
  };

  // Update preference
  const updatePreference = (prefName, value) => {
    const newSettings = {
      ...settings,
      preferences: {
        ...settings.preferences,
        [prefName]: value
      }
    };
    saveSettings(newSettings);
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin w-6 h-6 border-2 border-warm-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gradient-to-br from-lavender-500/20 to-lavender-400/20 dark:from-lavender-900/30 dark:to-lavender-800/30 rounded-xl">
          <svg className="w-6 h-6 text-lavender-400 dark:text-lavender-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-warm-100">Nexus Insights</h2>
          <p className="text-sm text-warm-400">Control how Engram analyzes your patterns</p>
        </div>
      </div>

      {/* Feature Toggles */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-warm-300 uppercase tracking-wider">
          Insight Types
        </h3>

        {/* Belief Dissonance */}
        <FeatureToggle
          title="Deep Pattern Insights"
          description="Surface patterns that might challenge your self-perception. These insights are designed to promote growth, not judgment."
          enabled={settings?.features?.beliefDissonanceInsights?.enabled}
          onToggle={() => toggleFeature('beliefDissonanceInsights')}
          badge="Recommended"
          color="amber"
        />

        {/* Intervention Recommendations */}
        <FeatureToggle
          title="Action Recommendations"
          description="Get personalized suggestions based on what has historically worked for you."
          enabled={settings?.features?.interventionRecommendations?.enabled}
          onToggle={() => toggleFeature('interventionRecommendations')}
          color="rose"
        />

        {/* Narrative Arc */}
        <FeatureToggle
          title="Narrative Arc Tracking"
          description="Track how your life stories evolve over time and identify growth patterns."
          enabled={settings?.features?.narrativeArcTracking?.enabled}
          onToggle={() => toggleFeature('narrativeArcTracking')}
          color="purple"
        />

        {/* Counterfactual */}
        <FeatureToggle
          title="'What If' Insights"
          description="Learn from days that didn't go well by identifying what might have helped."
          enabled={settings?.features?.counterfactualInsights?.enabled}
          onToggle={() => toggleFeature('counterfactualInsights')}
          color="blue"
        />
      </div>

      {/* Preferences */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-warm-300 uppercase tracking-wider">
          Preferences
        </h3>

        {/* Mood Gate */}
        <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700/50">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-sage-400 dark:text-sage-300 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-warm-200">Mood Gate</span>
                <span className="text-sm text-warm-400">
                  {settings?.preferences?.moodGateThreshold || 50}%
                </span>
              </div>
              <p className="text-sm text-warm-400 mt-1 mb-3">
                Deep pattern insights won't be shown when your mood is below this threshold
              </p>
              <input
                type="range"
                min="30"
                max="70"
                step="5"
                value={settings?.preferences?.moodGateThreshold || 50}
                onChange={(e) => updatePreference('moodGateThreshold', parseInt(e.target.value))}
                className="w-full h-2 bg-warm-700 rounded-lg appearance-none cursor-pointer accent-sage-500"
              />
              <div className="flex justify-between text-xs text-warm-500 mt-1">
                <span>More insights</span>
                <span>More protection</span>
              </div>
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-lavender-500/10 dark:bg-lavender-900/20 border border-lavender-500/20 dark:border-lavender-700/30 rounded-xl p-4">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-lavender-400 dark:text-lavender-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-lavender-200 dark:text-lavender-300">
              <p className="font-medium mb-1">About Deep Pattern Insights</p>
              <p className="text-lavender-300/80 dark:text-lavender-400/80">
                These insights identify gaps between your stated beliefs and behavioral data.
                They're framed as invitations to explore, not judgments. You can turn them off
                anytime if they don't feel helpful.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Save Indicator */}
      {saving && (
        <div className="fixed bottom-4 right-4 bg-warm-800 border border-warm-700 rounded-lg px-4 py-2 flex items-center gap-2">
          <div className="animate-spin w-4 h-4 border-2 border-warm-400 border-t-transparent rounded-full" />
          <span className="text-sm text-warm-300">Saving...</span>
        </div>
      )}
    </div>
  );
};

/**
 * Feature Toggle Component
 */
const FeatureToggle = ({ title, description, enabled, onToggle, color, badge }) => {
  const colorClasses = {
    amber: 'bg-honey-500/20 dark:bg-honey-900/30 text-honey-400 dark:text-honey-300',
    rose: 'bg-terra-500/20 dark:bg-terra-900/30 text-terra-400 dark:text-terra-300',
    purple: 'bg-lavender-500/20 dark:bg-lavender-900/30 text-lavender-400 dark:text-lavender-300',
    blue: 'bg-lavender-500/20 dark:bg-lavender-900/30 text-lavender-400 dark:text-lavender-300'
  };

  const iconColor = colorClasses[color] || colorClasses.purple;

  return (
    <div className="bg-warm-800/50 rounded-xl p-4 border border-warm-700/50">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${iconColor}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-warm-200">{title}</span>
            {badge && (
              <span className="px-2 py-0.5 text-xs bg-sage-500/20 dark:bg-sage-900/30 text-sage-400 dark:text-sage-300 rounded-full">
                {badge}
              </span>
            )}
          </div>
          <p className="text-sm text-warm-400 mt-1">{description}</p>
        </div>
        <button
          onClick={onToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-sage-500 dark:bg-sage-600' : 'bg-warm-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

export default NexusSettings;
