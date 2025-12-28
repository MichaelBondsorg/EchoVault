/**
 * LightContextNudge Component
 *
 * A subtle nudge that appears contextually when:
 * - User is writing an entry during limited daylight
 * - Weather is suitable for outdoor activity
 * - User has high indoor time patterns
 *
 * Non-intrusive, dismissible, and timing-aware.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Sunrise, Clock, X, ChevronRight } from 'lucide-react';

const LightContextNudge = ({
  environmentContext,
  indoorRisk,
  show,
  onDismiss,
  onAccept
}) => {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Delay showing the nudge to not interrupt the writing flow
  useEffect(() => {
    if (show && !dismissed) {
      const timer = setTimeout(() => setVisible(true), 3000);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [show, dismissed]);

  if (!visible || dismissed) {
    return null;
  }

  // Determine the right message based on context
  const getNudgeContent = () => {
    const { lightContext, daylightRemaining, weather } = environmentContext || {};

    // Fading daylight - urgent but gentle
    if (lightContext === 'fading' && daylightRemaining !== undefined) {
      const minutes = Math.round(daylightRemaining * 60);
      return {
        icon: Sunrise,
        title: 'Daylight fading',
        message: `About ${minutes} minutes of daylight left. A quick walk could help.`,
        action: 'Get outside',
        priority: 'high'
      };
    }

    // Low light weather but still daytime
    if (weather?.isLowLight && lightContext === 'daylight') {
      return {
        icon: Sun,
        title: 'Overcast day',
        message: 'Even on cloudy days, outdoor light is 10-20x brighter than indoor.',
        action: 'Take a break outside',
        priority: 'medium'
      };
    }

    // High indoor time pattern
    if (indoorRisk?.riskLevel === 'high') {
      return {
        icon: Clock,
        title: 'Indoor pattern noticed',
        message: indoorRisk.recommendation?.message || 'Consider adding some outdoor time today.',
        action: 'Plan outdoor time',
        priority: 'medium'
      };
    }

    // General daytime nudge for indoor risk
    if (indoorRisk?.riskLevel === 'medium' && lightContext === 'daylight') {
      return {
        icon: Sun,
        title: 'Good conditions outside',
        message: 'Conditions are good for outdoor time if you can take a break.',
        action: 'Maybe later',
        priority: 'low'
      };
    }

    return null;
  };

  const content = getNudgeContent();

  if (!content) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    setVisible(false);
    onDismiss?.();
  };

  const handleAccept = () => {
    setDismissed(true);
    setVisible(false);
    onAccept?.();
  };

  const IconComponent = content.icon;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className={`fixed bottom-20 left-4 right-4 mx-auto max-w-sm rounded-2xl shadow-soft-lg overflow-hidden ${
          content.priority === 'high'
            ? 'bg-gradient-to-r from-amber-500 to-orange-500'
            : content.priority === 'medium'
              ? 'bg-gradient-to-r from-blue-500 to-sky-500'
              : 'bg-gradient-to-r from-warm-500 to-warm-600'
        }`}
      >
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <IconComponent size={20} className="text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium text-white text-sm">
                  {content.title}
                </h4>
                <button
                  onClick={handleDismiss}
                  className="text-white/60 hover:text-white p-0.5 -mt-0.5"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-white/80 text-xs mt-1">
                {content.message}
              </p>

              {content.priority !== 'low' && (
                <button
                  onClick={handleAccept}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-white bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-colors"
                >
                  {content.action}
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default LightContextNudge;
