import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, BookOpen, Plus, BarChart3, Settings, Mic, Type, Sparkles, X } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

/**
 * BottomNavbar - Translucent bottom navigation with expandable FAB
 *
 * @param {Object} props
 * @param {function} props.onVoiceEntry - Callback for voice entry
 * @param {function} props.onTextEntry - Callback for text entry
 * @param {function} props.onQuickMood - Callback for quick mood log
 */
const BottomNavbar = ({ onVoiceEntry, onTextEntry, onQuickMood }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [fabExpanded, setFabExpanded] = useState(false);

  const triggerHaptic = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await Haptics.impact({ style: ImpactStyle.Light });
      } catch (e) {
        // Haptics not available
      }
    }
  };

  const navItems = [
    { path: '/', icon: Home, label: 'Home' },
    { path: '/journal', icon: BookOpen, label: 'Journal' },
    { type: 'fab' }, // Center FAB placeholder
    { path: '/insights', icon: BarChart3, label: 'Insights' },
    { path: '/settings', icon: Settings, label: 'Settings' },
  ];

  const fabActions = [
    { icon: Mic, label: 'Voice', color: 'bg-primary-500', action: onVoiceEntry },
    { icon: Type, label: 'Text', color: 'bg-secondary-500', action: onTextEntry },
    { icon: Sparkles, label: 'Quick Mood', color: 'bg-accent', action: onQuickMood },
  ];

  const handleFabClick = async () => {
    await triggerHaptic();
    setFabExpanded(!fabExpanded);
  };

  const handleFabAction = async (action) => {
    await triggerHaptic();
    setFabExpanded(false);
    action?.();
  };

  const handleNavClick = async (path) => {
    await triggerHaptic();
    navigate(path);
  };

  return (
    <>
      {/* Backdrop when FAB is expanded */}
      <AnimatePresence>
        {fabExpanded && (
          <motion.div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFabExpanded(false)}
          />
        )}
      </AnimatePresence>

      {/* FAB Expanded Actions */}
      <AnimatePresence>
        {fabExpanded && (
          <motion.div
            className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
          >
            {fabActions.map((action, index) => (
              <motion.button
                key={action.label}
                onClick={() => handleFabAction(action.action)}
                className={`
                  flex items-center gap-3 px-4 py-3
                  ${action.color} text-white
                  rounded-full shadow-glass-md
                  font-medium text-sm
                `}
                initial={{ opacity: 0, y: 20, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.8 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <action.icon size={20} />
                {action.label}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation Bar */}
      <motion.nav
        className="
          fixed bottom-0 left-0 right-0 z-50
          bg-white/20 backdrop-blur-lg
          px-2 py-2
          pb-[calc(env(safe-area-inset-bottom)+8px)]
          flex items-center justify-around
        "
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        {navItems.map((item, index) => {
          // Center FAB
          if (item.type === 'fab') {
            return (
              <motion.button
                key="fab"
                onClick={handleFabClick}
                className={`
                  w-14 h-14 -mt-6
                  rounded-full
                  ${fabExpanded ? 'bg-warm-600' : 'bg-gradient-to-br from-primary-500 to-primary-600'}
                  text-white
                  shadow-glass-lg
                  flex items-center justify-center
                  transition-colors duration-200
                `}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                animate={fabExpanded ? { rotate: 45 } : { rotate: 0 }}
              >
                {fabExpanded ? <X size={24} /> : <Plus size={28} />}
              </motion.button>
            );
          }

          // Regular nav item
          const isActive = location.pathname === item.path;
          return (
            <motion.button
              key={item.path}
              onClick={() => handleNavClick(item.path)}
              className={`
                flex flex-col items-center gap-1 p-2
                transition-colors duration-200
                ${isActive ? 'text-primary-600' : 'text-warm-500'}
              `}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-xs font-medium">{item.label}</span>
            </motion.button>
          );
        })}
      </motion.nav>
    </>
  );
};

export default BottomNavbar;
