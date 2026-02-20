import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowRight, Home, BarChart3, BookOpen, Settings2, Plus, Check } from 'lucide-react';

/**
 * SanctuaryWalkthrough - 3-screen welcome modal for new Zen & Bento UI
 *
 * Appears on first launch after the update to guide users through:
 * 1. The Vision - Welcome to a quieter space
 * 2. The Migration - Where things moved
 * 3. Your Bento - How to customize
 */
const SanctuaryWalkthrough = ({ isOpen, onComplete, onSkip }) => {
  const [currentScreen, setCurrentScreen] = useState(0);

  const screens = [
    {
      id: 'vision',
      title: 'Welcome to a quieter space',
      description: "We've redesigned Engram to focus on the present moment. Your sanctuary is now calmer, cleaner, and completely yours to shape.",
      visual: (
        <div className="relative w-48 h-48 mx-auto">
          {/* Zen-style animated circles */}
          <motion.div
            className="absolute inset-0 rounded-full bg-gradient-to-br from-honey-200 to-lavender-200 opacity-30"
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-4 rounded-full bg-gradient-to-br from-honey-100 to-lavender-100 opacity-50"
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          />
          <motion.div
            className="absolute inset-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring' }}
          >
            <Sparkles size={48} className="text-honey-500" />
          </motion.div>
        </div>
      ),
    },
    {
      id: 'migration',
      title: "Your data hasn't moved far",
      description: "Your stats and stories are now organized in the navigation below. Everything you've captured is still here, just a tap away.",
      visual: (
        <div className="space-y-3 w-full max-w-xs mx-auto">
          {[
            { icon: Home, label: 'Home', desc: 'Your customizable dashboard', active: true },
            { icon: BookOpen, label: 'Journal', desc: 'All your entries & timeline' },
            { icon: BarChart3, label: 'Insights', desc: 'Stats, trends & patterns' },
            { icon: Settings2, label: 'Settings', desc: 'Preferences & safety' },
          ].map((item, i) => (
            <motion.div
              key={item.label}
              className={`flex items-center gap-3 p-3 rounded-xl ${item.active ? 'bg-honey-100 border border-honey-200' : 'bg-white/50'}`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${item.active ? 'bg-honey-500 text-white' : 'bg-warm-100 text-warm-500'}`}>
                <item.icon size={20} />
              </div>
              <div>
                <p className={`font-medium text-sm ${item.active ? 'text-honey-700' : 'text-warm-700'}`}>{item.label}</p>
                <p className="text-xs text-warm-400">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      ),
    },
    {
      id: 'bento',
      title: 'This is your vault',
      description: 'Make it as simple or as detailed as you need. Tap "Customize" at the bottom of your feed to add, remove, or rearrange widgets.',
      visual: (
        <div className="w-full max-w-xs mx-auto">
          {/* Animated Bento grid preview */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Greeting', size: 'col-span-2', color: 'from-amber-100 to-orange-100' },
              { label: 'Prompts', size: 'col-span-2', color: 'from-purple-100 to-pink-100' },
            ].map((widget, i) => (
              <motion.div
                key={widget.label}
                className={`${widget.size} p-3 rounded-xl bg-gradient-to-br ${widget.color} border border-white/50`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.15 }}
              >
                <p className="text-xs font-medium text-warm-600">{widget.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Add widget animation */}
          <motion.div
            className="mt-3 p-2 rounded-xl border-2 border-dashed border-honey-300 bg-honey-50/50 flex items-center justify-center gap-2 text-honey-600"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0.5, 1] }}
            transition={{ delay: 0.8, duration: 2, repeat: Infinity }}
          >
            <Plus size={16} />
            <span className="text-xs font-medium">Add Widget</span>
          </motion.div>
        </div>
      ),
    },
  ];

  const currentData = screens[currentScreen];
  const isLastScreen = currentScreen === screens.length - 1;

  const handleNext = () => {
    if (isLastScreen) {
      onComplete?.();
    } else {
      setCurrentScreen(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentScreen > 0) {
      setCurrentScreen(prev => prev - 1);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {/* Backdrop */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-br from-warm-900/80 to-warm-800/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />

        {/* Modal */}
        <motion.div
          className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden"
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 20 }}
        >
          {/* Progress dots */}
          <div className="flex justify-center gap-2 pt-6">
            {screens.map((_, i) => (
              <motion.div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${i === currentScreen ? 'bg-honey-500' : 'bg-warm-200'}`}
                animate={{ scale: i === currentScreen ? 1.2 : 1 }}
              />
            ))}
          </div>

          {/* Content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentScreen}
              className="p-6 pt-4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {/* Visual */}
              <div className="mb-6">
                {currentData.visual}
              </div>

              {/* Text */}
              <div className="text-center mb-6">
                <h2 className="font-display font-bold text-xl text-warm-800 mb-2">
                  {currentData.title}
                </h2>
                <p className="text-warm-500 text-sm leading-relaxed">
                  {currentData.description}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Actions */}
          <div className="px-6 pb-6 flex gap-3">
            {currentScreen > 0 ? (
              <button
                onClick={handleBack}
                className="flex-1 py-3 px-4 text-warm-500 font-medium rounded-xl hover:bg-warm-100 transition-colors"
              >
                Back
              </button>
            ) : (
              <button
                onClick={onSkip}
                className="flex-1 py-3 px-4 text-warm-400 font-medium rounded-xl hover:bg-warm-100 transition-colors"
              >
                Skip
              </button>
            )}
            <motion.button
              onClick={handleNext}
              className="flex-1 py-3 px-4 bg-honey-500 hover:bg-honey-600 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {isLastScreen ? (
                <>
                  <Check size={18} />
                  Get Started
                </>
              ) : (
                <>
                  Next
                  <ArrowRight size={18} />
                </>
              )}
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default SanctuaryWalkthrough;
