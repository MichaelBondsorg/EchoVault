/**
 * Social Resilience Alert Component
 *
 * Shows when isolation patterns are detected.
 * Uses gentle, non-judgmental language and offers
 * small, actionable steps to reconnect.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart,
  Scale,
  MessageCircle,
  Users,
  Phone,
  Calendar,
  X,
  ChevronRight,
  ChevronDown,
  Sparkles
} from 'lucide-react';

const ICON_MAP = {
  Heart: Heart,
  Scale: Scale,
  MessageCircle: MessageCircle,
  Users: Users
};

const COLOR_MAP = {
  rose: {
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    icon: 'bg-rose-100 text-rose-600',
    title: 'text-rose-800',
    text: 'text-rose-700',
    button: 'bg-rose-500 hover:bg-rose-600 text-white'
  },
  amber: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: 'bg-amber-100 text-amber-600',
    title: 'text-amber-800',
    text: 'text-amber-700',
    button: 'bg-amber-500 hover:bg-amber-600 text-white'
  },
  blue: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: 'bg-blue-100 text-blue-600',
    title: 'text-blue-800',
    text: 'text-blue-700',
    button: 'bg-blue-500 hover:bg-blue-600 text-white'
  },
  green: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    icon: 'bg-green-100 text-green-600',
    title: 'text-green-800',
    text: 'text-green-700',
    button: 'bg-green-500 hover:bg-green-600 text-white'
  },
  purple: {
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    icon: 'bg-purple-100 text-purple-600',
    title: 'text-purple-800',
    text: 'text-purple-700',
    button: 'bg-purple-500 hover:bg-purple-600 text-white'
  }
};

const SocialResilienceAlert = ({ nudge, onAction, onDismiss }) => {
  const [showDismissOptions, setShowDismissOptions] = useState(false);
  const [actionTaken, setActionTaken] = useState(false);

  if (!nudge) return null;

  const IconComponent = ICON_MAP[nudge.icon] || Heart;
  const colors = COLOR_MAP[nudge.color] || COLOR_MAP.blue;

  const handleAction = (action) => {
    setActionTaken(true);
    onAction?.(action);
  };

  const handleDismiss = (reason) => {
    onDismiss?.(reason);
    setShowDismissOptions(false);
  };

  // Success state after taking action
  if (actionTaken) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-green-50 rounded-2xl border border-green-200 p-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-green-800 font-medium">Nice!</p>
            <p className="text-green-600 text-sm">
              Small moments of connection add up.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${colors.bg} rounded-2xl border ${colors.border} overflow-hidden`}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colors.icon}`}>
            <IconComponent className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className={`font-medium ${colors.title}`}>
                {nudge.title}
              </h3>
              {nudge.dismissible && (
                <button
                  onClick={() => setShowDismissOptions(!showDismissOptions)}
                  className="text-warm-400 hover:text-warm-600 flex-shrink-0"
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <p className={`text-sm mt-1 ${colors.text}`}>
              {nudge.message}
            </p>
            {nudge.subMessage && (
              <p className={`text-sm mt-2 ${colors.text} opacity-80`}>
                {nudge.subMessage}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      {nudge.actions && nudge.actions.length > 0 && (
        <div className="px-4 pb-4 flex flex-wrap gap-2">
          {nudge.actions.map((action, idx) => (
            <button
              key={action.id}
              onClick={() => handleAction(action)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                idx === 0
                  ? colors.button
                  : 'bg-white/50 text-warm-600 hover:bg-white'
              }`}
            >
              {action.id === 'text' && <MessageCircle size={16} />}
              {action.id === 'call' && <Phone size={16} />}
              {action.id === 'schedule' && <Calendar size={16} />}
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Dismiss Options */}
      <AnimatePresence>
        {showDismissOptions && nudge.dismissOptions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-warm-100 bg-white/50"
          >
            <div className="p-4 space-y-2">
              <p className="text-xs text-warm-500 mb-2">
                Why are you dismissing this?
              </p>
              {nudge.dismissOptions.map(option => (
                <button
                  key={option.id}
                  onClick={() => handleDismiss(option.id)}
                  className="w-full text-left px-3 py-2 text-sm text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/**
 * Compact version for inline display
 */
export const SocialNudgeCompact = ({ nudge, onAction, onDismiss }) => {
  if (!nudge) return null;

  const IconComponent = ICON_MAP[nudge.icon] || Heart;
  const colors = COLOR_MAP[nudge.color] || COLOR_MAP.blue;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className={`${colors.bg} rounded-xl border ${colors.border} p-3`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.icon}`}>
          <IconComponent size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${colors.text} truncate`}>
            {nudge.message}
          </p>
        </div>
        <button
          onClick={() => onAction?.(nudge.actions?.[0])}
          className={`text-sm font-medium ${colors.title} hover:underline flex items-center gap-1`}
        >
          Act <ChevronRight size={14} />
        </button>
      </div>
    </motion.div>
  );
};

/**
 * Neglected connections list component
 */
export const NeglectedConnectionsList = ({ connections, onReachOut }) => {
  if (!connections || connections.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-warm-500 font-medium">
        People you haven't mentioned in a while:
      </p>
      {connections.slice(0, 3).map(person => (
        <div
          key={person.name}
          className="flex items-center justify-between p-3 bg-warm-50 rounded-xl"
        >
          <div>
            <p className="text-warm-800 font-medium capitalize">
              {person.name}
            </p>
            <p className="text-xs text-warm-500">
              {person.daysSince} days since last mention
            </p>
          </div>
          <button
            onClick={() => onReachOut?.(person)}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
          >
            <MessageCircle size={14} />
            Reach out
          </button>
        </div>
      ))}
    </div>
  );
};

export default SocialResilienceAlert;
