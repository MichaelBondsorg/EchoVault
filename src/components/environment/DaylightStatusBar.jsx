/**
 * DaylightStatusBar Component
 *
 * A compact status bar showing current daylight conditions.
 * Helps users understand light availability at a glance.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { Sun, Sunrise, Sunset, Moon, Cloud, CloudRain } from 'lucide-react';

const DaylightStatusBar = ({
  environmentContext,
  compact = false
}) => {
  if (!environmentContext?.available) {
    return null;
  }

  const {
    lightContext,
    daylightRemaining,
    sunTimes,
    weather
  } = environmentContext;

  // Determine icon and status
  const getStatus = () => {
    if (!lightContext) {
      return { icon: Sun, label: 'Unknown', color: 'warm' };
    }

    switch (lightContext) {
      case 'daylight':
        if (weather?.condition === 'overcast' || weather?.condition === 'rain') {
          return {
            icon: weather.condition === 'rain' ? CloudRain : Cloud,
            label: weather.condition === 'rain' ? 'Rainy' : 'Overcast',
            color: 'blue',
            subtext: daylightRemaining ? `${Math.round(daylightRemaining)}h daylight left` : null
          };
        }
        return {
          icon: Sun,
          label: 'Daylight',
          color: 'amber',
          subtext: daylightRemaining ? `${Math.round(daylightRemaining)}h remaining` : null
        };

      case 'fading':
        const minutes = daylightRemaining ? Math.round(daylightRemaining * 60) : null;
        return {
          icon: Sunset,
          label: 'Fading light',
          color: 'orange',
          subtext: minutes ? `${minutes} min left` : 'Sun setting soon'
        };

      case 'low_light':
        return {
          icon: Cloud,
          label: 'Low light',
          color: 'slate',
          subtext: 'Overcast conditions'
        };

      case 'dark':
        return {
          icon: Moon,
          label: 'After dark',
          color: 'indigo',
          subtext: sunTimes?.sunriseLocal ? `Sunrise ${sunTimes.sunriseLocal}` : null
        };

      default:
        return { icon: Sun, label: 'Unknown', color: 'warm' };
    }
  };

  const status = getStatus();
  const IconComponent = status.icon;

  const colorClasses = {
    amber: 'bg-honey-100 text-honey-700 border-honey-200 dark:bg-honey-900/30 dark:text-honey-300 dark:border-honey-800',
    orange: 'bg-terra-100 text-terra-700 border-terra-200 dark:bg-terra-900/30 dark:text-terra-300 dark:border-terra-800',
    blue: 'bg-lavender-100 text-lavender-700 border-lavender-200 dark:bg-lavender-900/30 dark:text-lavender-300 dark:border-lavender-800',
    slate: 'bg-warm-100 text-warm-700 border-warm-200 dark:bg-warm-800/30 dark:text-warm-300 dark:border-warm-700',
    indigo: 'bg-lavender-200 text-lavender-800 border-lavender-300 dark:bg-lavender-900/40 dark:text-lavender-300 dark:border-lavender-700',
    warm: 'bg-warm-100 text-warm-700 border-warm-200 dark:bg-warm-800/30 dark:text-warm-300 dark:border-warm-700'
  };

  const iconColorClasses = {
    amber: 'text-honey-500 dark:text-honey-400',
    orange: 'text-terra-500 dark:text-terra-400',
    blue: 'text-lavender-500 dark:text-lavender-400',
    slate: 'text-warm-500 dark:text-warm-400',
    indigo: 'text-lavender-600 dark:text-lavender-400',
    warm: 'text-warm-500 dark:text-warm-400'
  };

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border ${colorClasses[status.color]}`}>
        <IconComponent size={12} className={iconColorClasses[status.color]} />
        <span className="font-medium">{status.label}</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border ${colorClasses[status.color]}`}
    >
      <div className="w-8 h-8 rounded-lg bg-white/50 dark:bg-white/10 flex items-center justify-center">
        <IconComponent size={18} className={iconColorClasses[status.color]} />
      </div>

      <div className="flex-1">
        <p className="text-sm font-medium">{status.label}</p>
        {status.subtext && (
          <p className="text-xs opacity-75">{status.subtext}</p>
        )}
      </div>

      {/* Visual daylight indicator */}
      {daylightRemaining !== undefined && daylightRemaining > 0 && (
        <div className="w-16">
          <div className="h-1.5 bg-white/50 dark:bg-white/10 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, (daylightRemaining / 12) * 100)}%` }}
              transition={{ duration: 0.5 }}
              className={`h-full rounded-full ${
                daylightRemaining < 1 ? 'bg-terra-400 dark:bg-terra-500' :
                daylightRemaining < 3 ? 'bg-honey-400 dark:bg-honey-500' :
                'bg-sage-400 dark:bg-sage-500'
              }`}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default DaylightStatusBar;
