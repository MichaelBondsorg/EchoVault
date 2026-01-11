import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

/**
 * QuickLogModal - Simplified mood logging from top bar mood orb
 *
 * Contains:
 * - Mood slider (0-1 range)
 * - 5 high-frequency "Current Vibe" tags
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {function} props.onClose - Callback to close modal
 * @param {function} props.onSave - Callback with { moodScore, vibeTags }
 */
const QuickLogModal = ({ isOpen, onClose, onSave }) => {
  const [moodScore, setMoodScore] = useState(0.5);
  const [selectedVibes, setSelectedVibes] = useState([]);

  const vibeTags = [
    { id: 'energized', emoji: '\u26A1', label: 'Energized' },
    { id: 'foggy', emoji: '\u2601\uFE0F', label: 'Foggy' },
    { id: 'grateful', emoji: '\u{1F64F}', label: 'Grateful' },
    { id: 'anxious', emoji: '\u{1F630}', label: 'Anxious' },
    { id: 'peaceful', emoji: '\u{1F33F}', label: 'Peaceful' },
  ];

  const triggerHaptic = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await Haptics.impact({ style: ImpactStyle.Light });
      } catch (e) {
        // Haptics not available
      }
    }
  };

  const handleVibeToggle = async (vibeId) => {
    await triggerHaptic();
    setSelectedVibes(prev =>
      prev.includes(vibeId)
        ? prev.filter(v => v !== vibeId)
        : [...prev, vibeId]
    );
  };

  const handleSave = async () => {
    await triggerHaptic();
    onSave?.({
      moodScore,
      vibeTags: selectedVibes,
      timestamp: new Date(),
    });
    // Reset state
    setMoodScore(0.5);
    setSelectedVibes([]);
    onClose();
  };

  const handleClose = () => {
    setMoodScore(0.5);
    setSelectedVibes([]);
    onClose();
  };

  // Get mood label based on score
  const getMoodLabel = (score) => {
    if (score >= 0.8) return 'Great';
    if (score >= 0.6) return 'Good';
    if (score >= 0.4) return 'Okay';
    if (score >= 0.2) return 'Low';
    return 'Struggling';
  };

  // Get mood color based on score
  const getMoodColor = (score) => {
    if (score >= 0.8) return 'text-mood-great';
    if (score >= 0.6) return 'text-mood-good';
    if (score >= 0.4) return 'text-mood-neutral';
    if (score >= 0.2) return 'text-mood-low';
    return 'text-mood-struggling';
  };

  // Get slider track gradient
  const getSliderGradient = () => {
    return 'linear-gradient(to right, #a5b4fc, #93c5fd, #fcd34d, #6ee7b7, #10b981)';
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
          />

          {/* Modal Container - centered using flex */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              className="
                w-full max-w-sm
                bg-white/90 backdrop-blur-xl
                border border-white/30
                rounded-3xl
                shadow-glass-lg
                overflow-hidden
                pointer-events-auto
              "
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25 }}
            >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/20">
              <h2 className="font-display font-bold text-lg text-warm-800">
                Quick Check-in
              </h2>
              <button
                onClick={handleClose}
                className="p-2 rounded-full hover:bg-warm-100 transition-colors"
              >
                <X size={20} className="text-warm-500" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-6">
              {/* Mood Slider */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-warm-600">
                    How are you feeling?
                  </span>
                  <span className={`text-lg font-bold ${getMoodColor(moodScore)}`}>
                    {getMoodLabel(moodScore)}
                  </span>
                </div>

                {/* Custom slider */}
                <div className="relative">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={moodScore}
                    onChange={(e) => setMoodScore(parseFloat(e.target.value))}
                    className="
                      w-full h-3 rounded-full appearance-none cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none
                      [&::-webkit-slider-thumb]:w-6
                      [&::-webkit-slider-thumb]:h-6
                      [&::-webkit-slider-thumb]:rounded-full
                      [&::-webkit-slider-thumb]:bg-white
                      [&::-webkit-slider-thumb]:shadow-lg
                      [&::-webkit-slider-thumb]:border-2
                      [&::-webkit-slider-thumb]:border-warm-200
                      [&::-webkit-slider-thumb]:cursor-pointer
                      [&::-moz-range-thumb]:w-6
                      [&::-moz-range-thumb]:h-6
                      [&::-moz-range-thumb]:rounded-full
                      [&::-moz-range-thumb]:bg-white
                      [&::-moz-range-thumb]:shadow-lg
                      [&::-moz-range-thumb]:border-2
                      [&::-moz-range-thumb]:border-warm-200
                      [&::-moz-range-thumb]:cursor-pointer
                    "
                    style={{
                      background: getSliderGradient(),
                    }}
                  />
                </div>

                {/* Mood labels */}
                <div className="flex justify-between text-xs text-warm-400">
                  <span>Struggling</span>
                  <span>Great</span>
                </div>
              </div>

              {/* Vibe Tags */}
              <div className="space-y-3">
                <span className="text-sm font-medium text-warm-600">
                  Current vibe (optional)
                </span>
                <div className="flex flex-wrap gap-2">
                  {vibeTags.map((vibe) => {
                    const isSelected = selectedVibes.includes(vibe.id);
                    return (
                      <motion.button
                        key={vibe.id}
                        onClick={() => handleVibeToggle(vibe.id)}
                        className={`
                          px-3 py-2 rounded-full
                          text-sm font-medium
                          transition-all duration-200
                          ${isSelected
                            ? 'bg-primary-100 text-primary-700 border-2 border-primary-300'
                            : 'bg-warm-100 text-warm-600 border-2 border-transparent hover:bg-warm-200'
                          }
                        `}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <span className="mr-1">{vibe.emoji}</span>
                        {vibe.label}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/20">
              <motion.button
                onClick={handleSave}
                className="
                  w-full py-3 px-4
                  bg-gradient-to-r from-primary-500 to-primary-600
                  text-white font-bold
                  rounded-2xl
                  shadow-soft
                  flex items-center justify-center gap-2
                "
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <Check size={20} />
                Save Check-in
              </motion.button>
            </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default QuickLogModal;
