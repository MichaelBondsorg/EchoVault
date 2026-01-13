import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Sun, Sparkles, BarChart3, Target, CheckSquare, Calendar, GitBranch } from 'lucide-react';
import { WIDGET_DEFINITIONS } from '../../hooks/useDashboardLayout';

// Map widget IDs to icons
const WIDGET_ICONS = {
  hero_card: Sun,
  prompt_card: Sparkles,
  quick_stats: BarChart3,
  mood_heatmap: Calendar,
  ongoing_stories: GitBranch,
  goals: Target,
  tasks: CheckSquare,
};

/**
 * WidgetDrawer - Bottom sheet for adding widgets to dashboard
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether drawer is visible
 * @param {function} props.onClose - Callback to close drawer
 * @param {Array} props.availableWidgets - Widget IDs available to add
 * @param {function} props.onAddWidget - Callback when widget is added
 */
const WidgetDrawer = ({
  isOpen,
  onClose,
  availableWidgets = [],
  onAddWidget,
}) => {
  const scrollRef = useRef(null);
  const startYRef = useRef(0);

  // Lock body scroll when drawer is open to prevent background scrolling
  useEffect(() => {
    if (isOpen) {
      // Save current scroll position and lock body
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';

      return () => {
        // Restore scroll position when closing
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [isOpen]);

  // Handle touch move to prevent scroll bleed at boundaries
  const handleTouchStart = useCallback((e) => {
    startYRef.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const currentY = e.touches[0].clientY;
    const deltaY = startYRef.current - currentY;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;

    // At the top and trying to scroll up
    const atTop = scrollTop <= 0 && deltaY < 0;
    // At the bottom and trying to scroll down
    const atBottom = scrollTop + clientHeight >= scrollHeight && deltaY > 0;

    // Prevent default only when at boundaries to stop background scroll
    if (atTop || atBottom) {
      e.preventDefault();
    }
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            className="
              fixed bottom-0 left-0 right-0 z-50
              bg-white/90 backdrop-blur-xl
              rounded-t-3xl
              shadow-glass-lg
              max-h-[70vh]
              overflow-hidden
            "
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25 }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-warm-300 rounded-full" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3 border-b border-warm-100">
              <h2 className="font-display font-bold text-lg text-warm-800">
                Add Widget
              </h2>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-warm-100 transition-colors"
              >
                <X size={20} className="text-warm-500" />
              </button>
            </div>

            {/* Widget List */}
            <div
              ref={scrollRef}
              className="p-4 overflow-y-auto"
              style={{
                maxHeight: 'calc(70vh - 100px)',
                WebkitOverflowScrolling: 'touch',
                overscrollBehavior: 'contain',
              }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
            >
              {availableWidgets.length > 0 ? (
                <div className="space-y-3">
                  {availableWidgets.map((widgetId) => {
                    const widget = WIDGET_DEFINITIONS[widgetId];
                    if (!widget) return null;

                    const Icon = WIDGET_ICONS[widgetId] || Plus;

                    return (
                      <motion.button
                        key={widgetId}
                        onClick={() => {
                          onAddWidget?.(widgetId);
                          onClose();
                        }}
                        className="
                          w-full p-4
                          bg-white/50 hover:bg-white/80
                          border border-white/30
                          rounded-2xl
                          flex items-center gap-4
                          transition-colors
                          text-left
                        "
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                      >
                        {/* Icon */}
                        <div className="
                          w-12 h-12
                          bg-primary-100
                          rounded-xl
                          flex items-center justify-center
                        ">
                          <Icon size={24} className="text-primary-600" />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-warm-800">
                            {widget.name}
                          </h3>
                          <p className="text-sm text-warm-500 truncate">
                            {widget.description}
                          </p>
                        </div>

                        {/* Add indicator */}
                        <div className="
                          w-8 h-8
                          bg-primary-500
                          rounded-full
                          flex items-center justify-center
                        ">
                          <Plus size={18} className="text-white" />
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <p className="text-warm-500">
                    All widgets are already on your dashboard!
                  </p>
                  <p className="text-warm-400 text-sm mt-2">
                    Remove some to add them again.
                  </p>
                </div>
              )}
            </div>

            {/* Safe area padding */}
            <div className="h-[env(safe-area-inset-bottom)]" />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default WidgetDrawer;
