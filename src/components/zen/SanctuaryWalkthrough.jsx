import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Home, BarChart3, BookOpen, Settings2, Plus, Check } from 'lucide-react';
import { Pebble } from '../cloud';

/**
 * SanctuaryWalkthrough (CLOUD-DESIGN-SPEC.md §6.3 Pebble states + §7
 * "Welcome" — mockup 7o): 3-screen welcome modal for new Zen & Bento UI.
 *
 * Appears on first launch after the update to guide users through:
 * 1. The Vision - Welcome to a quieter space (calm Pebble, §6.3: "calm...
 *    used in: home, welcome")
 * 2. The Migration - Where things moved
 * 3. Your Bento - How to customize
 *
 * Restyle only — step flow, Back/Skip/Next/onComplete logic unchanged.
 * Mockup 7o is a distinct pre-auth first-run screen (Pebble + "A quiet
 * place for loud days." + Begin/"I already have an account") with no
 * equivalent in this post-update 3-step tour's props (no auth state, no
 * feature-bullet copy passed in) — only the calm Pebble mascot and the
 * Cloud token vocabulary are pulled from it; the tour's own 3-screen
 * content/copy is preserved as-is.
 */
const SanctuaryWalkthrough = ({ isOpen, onComplete, onSkip }) => {
  const [currentScreen, setCurrentScreen] = useState(0);

  const screens = [
    {
      id: 'vision',
      title: 'Welcome to a quieter space',
      description: "We've redesigned Engram to focus on the present moment. Your sanctuary is now calmer, cleaner, and completely yours to shape.",
      visual: (
        <div className="mx-auto flex h-48 w-48 items-center justify-center">
          <Pebble state="calm" size={120} />
        </div>
      ),
    },
    {
      id: 'migration',
      title: "Your data hasn't moved far",
      description: "Your stats and stories are now organized in the navigation below. Everything you've captured is still here, just a tap away.",
      visual: (
        <div className="mx-auto w-full max-w-xs space-y-3">
          {[
            { icon: Home, label: 'Home', desc: 'Your customizable dashboard', active: true },
            { icon: BookOpen, label: 'Journal', desc: 'All your entries & timeline' },
            { icon: BarChart3, label: 'Insights', desc: 'Stats, trends & patterns' },
            { icon: Settings2, label: 'Settings', desc: 'Preferences & safety' },
          ].map((item, i) => (
            <motion.div
              key={item.label}
              className={`flex items-center gap-3 rounded-xl p-3 ${
                item.active ? 'border border-accent bg-accent-wash' : 'bg-card'
              }`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  item.active ? 'bg-accent-deep text-background' : 'bg-divider text-muted-foreground'
                }`}
              >
                <item.icon size={20} aria-hidden="true" />
              </div>
              <div>
                <p className={`text-sm font-medium ${item.active ? 'text-accent-deep' : 'text-foreground'}`}>{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
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
        <div className="mx-auto w-full max-w-xs">
          {/* Animated Bento grid preview */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Greeting', size: 'col-span-2' },
              { label: 'Prompts', size: 'col-span-2' },
            ].map((widget, i) => (
              <motion.div
                key={widget.label}
                className={`${widget.size} rounded-xl border border-border bg-accent-wash p-3`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.15 }}
              >
                <p className="text-xs font-medium text-secondary-foreground">{widget.label}</p>
              </motion.div>
            ))}
          </div>

          {/* Add widget animation */}
          <motion.div
            className="mt-3 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent bg-accent-wash p-2 text-accent-deep"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0.5, 1] }}
            transition={{ delay: 0.8, duration: 2, repeat: Infinity }}
          >
            <Plus size={16} aria-hidden="true" />
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
          className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        />

        {/* Modal */}
        <motion.div
          className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card shadow-soft-xl"
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 20 }}
        >
          {/* Progress dots */}
          <div className="flex justify-center gap-2 pt-6">
            {screens.map((_, i) => (
              <motion.div
                key={i}
                className={`h-2 w-2 rounded-full transition-colors ${i === currentScreen ? 'bg-accent-deep' : 'bg-divider'}`}
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
              <div className="mb-6 text-center">
                <h2 className="cloud-title mb-2 text-xl text-foreground">
                  {currentData.title}
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {currentData.description}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Actions */}
          <div className="flex gap-3 px-6 pb-6">
            {currentScreen > 0 ? (
              <button
                type="button"
                onClick={handleBack}
                className="min-h-[44px] flex-1 rounded-full px-4 py-3 font-medium text-muted-foreground transition-colors hover:bg-divider"
              >
                Back
              </button>
            ) : (
              <button
                type="button"
                onClick={onSkip}
                className="min-h-[44px] flex-1 rounded-full px-4 py-3 font-medium text-faint transition-colors hover:bg-divider"
              >
                Skip
              </button>
            )}
            <motion.button
              type="button"
              onClick={handleNext}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-accent-deep px-4 py-3 font-medium text-background transition-opacity hover:opacity-90"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {isLastScreen ? (
                <>
                  <Check size={18} aria-hidden="true" />
                  Get Started
                </>
              ) : (
                <>
                  Next
                  <ArrowRight size={18} aria-hidden="true" />
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
