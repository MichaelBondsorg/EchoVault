/**
 * Value Gap Card Component
 *
 * Displays a value gap with compassionate framing and micro-commitment.
 * Non-judgmental, focused on understanding and small steps.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Heart,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Clock,
  Scale
} from 'lucide-react';

const ValueGapCard = ({ gap, index }) => {
  const [expanded, setExpanded] = useState(index === 0); // First one expanded by default
  const [commitmentAccepted, setCommitmentAccepted] = useState(false);

  const { value, label, alignmentScore, reframe } = gap;

  // Get icon based on reframe type
  const getIcon = () => {
    switch (reframe?.type) {
      case 'trade_off_acknowledgment':
        return <Scale className="w-5 h-5 text-blue-500" />;
      case 'pattern_awareness':
        return <Clock className="w-5 h-5 text-amber-500" />;
      case 'gentle_awareness':
      default:
        return <Heart className="w-5 h-5 text-rose-400" />;
    }
  };

  // Get background gradient based on type
  const getGradient = () => {
    switch (reframe?.type) {
      case 'trade_off_acknowledgment':
        return 'from-blue-50 to-sky-50 border-blue-200';
      case 'pattern_awareness':
        return 'from-amber-50 to-orange-50 border-amber-200';
      case 'gentle_awareness':
      default:
        return 'from-rose-50 to-pink-50 border-rose-200';
    }
  };

  // Get tone label
  const getToneLabel = () => {
    switch (reframe?.tone) {
      case 'understanding':
        return 'Trade-off Detected';
      case 'curious':
        return 'Pattern Noticed';
      case 'warm':
      default:
        return 'Gentle Nudge';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className={`rounded-2xl border overflow-hidden bg-gradient-to-br ${getGradient()}`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-3 text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-white/50 flex items-center justify-center flex-shrink-0">
          {getIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-warm-500">{getToneLabel()}</span>
            <span className="text-xs text-warm-400">•</span>
            <span className="text-xs text-warm-500">{Math.round(alignmentScore * 100)}% aligned</span>
          </div>
          <h4 className="font-medium text-warm-800 truncate">{label}</h4>
        </div>

        <div className="flex-shrink-0">
          {expanded ? (
            <ChevronUp className="w-5 h-5 text-warm-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-warm-400" />
          )}
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* Main message */}
              <p className="text-sm text-warm-700 leading-relaxed">
                {reframe?.message}
              </p>

              {/* Trade-off specific: Rebalance prompt */}
              {reframe?.type === 'trade_off_acknowledgment' && reframe?.rebalancePrompt && (
                <div className="bg-white/50 rounded-xl p-3">
                  <p className="text-sm font-medium text-warm-700 mb-2">
                    {reframe.rebalancePrompt.question}
                  </p>
                  <ul className="space-y-1.5">
                    {reframe.rebalancePrompt.suggestions.map((suggestion, idx) => (
                      <li key={idx} className="text-xs text-warm-600 flex items-start gap-2">
                        <ArrowRight className="w-3 h-3 mt-0.5 flex-shrink-0 text-warm-400" />
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Pattern specific: Reflection prompts */}
              {reframe?.type === 'pattern_awareness' && reframe?.reflectionPrompts && (
                <div className="bg-white/50 rounded-xl p-3">
                  <p className="text-xs font-medium text-warm-600 mb-2">Reflect on:</p>
                  <ul className="space-y-1.5">
                    {reframe.reflectionPrompts.map((prompt, idx) => (
                      <li key={idx} className="text-sm text-warm-700">
                        • {prompt}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Micro-commitment */}
              {reframe?.microCommitment && !commitmentAccepted && (
                <div className="bg-white/70 rounded-xl p-3">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-medium text-warm-600 mb-1">
                        Tiny step ({reframe.microCommitment.duration})
                      </p>
                      <p className="text-sm text-warm-800">
                        {reframe.microCommitment.action}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setCommitmentAccepted(true)}
                    className="w-full mt-3 py-2 rounded-lg bg-green-500 text-white text-sm font-medium hover:bg-green-600 transition-colors"
                  >
                    I'll try this
                  </button>
                </div>
              )}

              {/* Commitment accepted */}
              {commitmentAccepted && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-green-100 rounded-xl p-3 flex items-center gap-3"
                >
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Commitment noted!</p>
                    <p className="text-xs text-green-600">You've got this. Small steps matter.</p>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ValueGapCard;
