import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, BookOpen, Plus, BarChart3, Settings } from 'lucide-react';
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
const BottomNavbar = ({ onNewEntry }) => {
  const location = useLocation();
  const navigate = useNavigate();

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

  const handleFabClick = async () => {
    await triggerHaptic();
    onNewEntry?.();
  };

  const handleNavClick = async (path) => {
    await triggerHaptic();
    navigate(path);
  };

  return (
    <>
      {/* Bottom Navigation Bar */}
      <motion.nav
        className="
          fixed bottom-0 left-0 right-0 z-50
          bg-[var(--card)] border-t border-[var(--border)]
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
                aria-label="New entry"
                className={`
                  w-14 h-14 -mt-6
                  rounded-full
                  bg-[var(--primary)]
                  text-white
                  shadow-glass-lg
                  flex items-center justify-center
                  transition-colors duration-200
                `}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Plus size={28} />
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
                ${isActive ? 'text-[var(--accent-deep)]' : 'text-[var(--muted-foreground)]'}
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
