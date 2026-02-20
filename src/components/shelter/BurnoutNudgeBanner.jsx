/**
 * BurnoutNudgeBanner Component
 *
 * A soft-block pattern that nudges users toward Shelter Mode when
 * burnout risk is detected. Uses escalating urgency instead of
 * auto-triggering, respecting user autonomy.
 *
 * Escalation Ladder:
 * 1. First detection: Dismissable banner
 * 2. Second dismissal: Slightly more urgent
 * 3. Third dismissal: Requires acknowledgment checkbox
 * 4. Continued pattern: Logs for later reflection
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Heart, Clock, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { getRiskLevelInfo } from '../../services/burnout';

const BurnoutNudgeBanner = ({
  burnoutRisk,
  onEnterShelter,
  onDismiss,
  onAcknowledge,
  dismissCount = 0
}) => {
  const [expanded, setExpanded] = useState(false);
  const [acknowledgmentRequired, setAcknowledgmentRequired] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const riskInfo = getRiskLevelInfo(burnoutRisk.riskLevel);
  const isCritical = burnoutRisk.riskLevel === 'critical';
  const isHigh = burnoutRisk.riskLevel === 'high';

  // After 2 dismissals, require acknowledgment
  useEffect(() => {
    if (dismissCount >= 2 && (isCritical || isHigh)) {
      setAcknowledgmentRequired(true);
    }
  }, [dismissCount, isCritical, isHigh]);

  const handleDismiss = () => {
    if (acknowledgmentRequired && !acknowledged) {
      // Can't dismiss without acknowledgment
      return;
    }

    if (onDismiss) {
      onDismiss({
        riskLevel: burnoutRisk.riskLevel,
        riskScore: burnoutRisk.riskScore,
        acknowledged,
        dismissCount: dismissCount + 1
      });
    }
  };

  const handleEnterShelter = () => {
    if (onEnterShelter) {
      onEnterShelter({
        triggeredBy: 'burnout_nudge',
        riskLevel: burnoutRisk.riskLevel,
        riskScore: burnoutRisk.riskScore
      });
    }
  };

  const getBannerStyles = () => {
    if (isCritical) {
      return 'bg-gradient-to-r from-red-900/90 to-red-800/90 border-red-500 dark:border-red-600';
    }
    if (isHigh) {
      return 'bg-gradient-to-r from-terra-900/90 to-honey-900/90 border-terra-500 dark:border-terra-600';
    }
    return 'bg-gradient-to-r from-honey-800/90 to-honey-900/90 border-honey-500 dark:border-honey-600';
  };

  const getIconColor = () => {
    if (isCritical) return 'text-red-400';
    if (isHigh) return 'text-terra-400';
    return 'text-honey-400';
  };

  const getMessage = () => {
    if (isCritical) {
      return {
        title: 'Burnout Alert',
        subtitle: 'Your signals suggest you\'re reaching a critical threshold.',
        cta: 'We strongly recommend taking a break to decompress.'
      };
    }
    if (isHigh) {
      return {
        title: 'High Stress Detected',
        subtitle: 'Multiple burnout indicators are elevated.',
        cta: 'Consider taking some time for yourself.'
      };
    }
    return {
      title: 'Stress Building',
      subtitle: 'We\'ve noticed some concerning patterns.',
      cta: 'A short break might help prevent burnout.'
    };
  };

  const message = getMessage();

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={`
          rounded-xl border-2 backdrop-blur-sm shadow-lg
          ${getBannerStyles()}
          p-4 mb-4
        `}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-full bg-black/20 ${getIconColor()}`}>
            <AlertTriangle size={24} />
          </div>

          <div className="flex-1">
            <h3 className="font-semibold text-white text-lg">{message.title}</h3>
            <p className="text-white/80 text-sm mt-1">{message.subtitle}</p>
          </div>

          {/* Dismiss button (only if not requiring acknowledgment) */}
          {!acknowledgmentRequired && (
            <button
              onClick={handleDismiss}
              className="p-1 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors"
              aria-label="Dismiss"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Detected Signals */}
        {burnoutRisk.signals && burnoutRisk.signals.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-white/70 text-sm hover:text-white transition-colors"
            >
              {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showDetails ? 'Hide' : 'Show'} detected signals
            </button>

            <AnimatePresence>
              {showDetails && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-wrap gap-2 mt-2"
                >
                  {burnoutRisk.signals.map((signal, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-black/30 rounded-full text-xs text-white/90"
                    >
                      {signal.replace(/_/g, ' ')}
                    </span>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Call to Action */}
        <p className="text-white/90 text-sm mt-3">{message.cta}</p>

        {/* Acknowledgment Checkbox (after multiple dismissals) */}
        {acknowledgmentRequired && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 p-3 bg-black/30 rounded-lg"
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-white/30 bg-black/30 text-honey-500 focus:ring-honey-500"
              />
              <span className="text-white/90 text-sm">
                I understand I may be at risk for burnout and choose to continue journaling
              </span>
            </label>
          </motion.div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 mt-4">
          <button
            onClick={handleEnterShelter}
            className={`
              flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg
              font-medium transition-all
              ${isCritical
                ? 'bg-white text-red-900 hover:bg-white/90'
                : 'bg-white/20 text-white hover:bg-white/30 border border-white/30'
              }
            `}
          >
            <Shield size={18} />
            Enter Shelter Mode
          </button>

          <button
            onClick={handleDismiss}
            disabled={acknowledgmentRequired && !acknowledged}
            className={`
              flex items-center justify-center gap-2 py-3 px-4 rounded-lg
              font-medium transition-all
              ${acknowledgmentRequired && !acknowledged
                ? 'bg-white/5 text-white/30 cursor-not-allowed'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
              }
            `}
          >
            Keep Journaling
          </button>
        </div>

        {/* Risk Score Indicator */}
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>Burnout Risk Score</span>
            <span className="font-mono">{Math.round(burnoutRisk.riskScore * 100)}%</span>
          </div>
          <div className="mt-1 h-1.5 bg-black/30 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${burnoutRisk.riskScore * 100}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className={`h-full rounded-full ${
                isCritical ? 'bg-red-500' :
                isHigh ? 'bg-terra-500' :
                'bg-honey-500'
              }`}
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default BurnoutNudgeBanner;
