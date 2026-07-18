import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, BookOpen, Plus, BarChart3, Settings } from 'lucide-react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

/**
 * BottomNavbar - Cloud tab bar: Home, Journal, [+], Insights, Settings.
 *
 * Spec: docs/design/cloud/CLOUD-DESIGN-SPEC.md §5 (Tab bar) + §7 (Home).
 * Center item is a 48px raised FAB (`bg-primary` — `--primary` light /
 * `--accent-btn` dark, aliased in cloud-tokens.css). Active item = accent
 * (icon + label). Bar itself is `bg-card` with a `border-border` top hairline
 * and safe-area bottom padding; all touch targets are >=44px.
 *
 * @param {Object} props
 * @param {function} props.onNewEntry - Callback for the center New Entry FAB
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
    <motion.nav
      className="
        fixed bottom-0 left-0 right-0 z-50
        bg-card border-t border-border
        px-2 py-2
        pb-[calc(env(safe-area-inset-bottom)+8px)]
        flex items-end justify-around
      "
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {navItems.map((item) => {
        // Center FAB — raised 48px circle, primary token (accent-btn in dark).
        if (item.type === 'fab') {
          return (
            <motion.button
              key="fab"
              type="button"
              onClick={handleFabClick}
              aria-label="New entry"
              className="
                w-12 h-12 -mt-[18px]
                rounded-full
                bg-primary text-primary-foreground
                shadow-lg
                flex items-center justify-center
                transition-colors duration-200
              "
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Plus size={22} strokeWidth={2.2} />
            </motion.button>
          );
        }

        // Regular nav item
        const isActive = location.pathname === item.path;
        return (
          <motion.button
            key={item.path}
            type="button"
            onClick={() => handleNavClick(item.path)}
            aria-current={isActive ? 'page' : undefined}
            className={`
              flex flex-col items-center justify-center gap-1
              min-w-[44px] min-h-[44px] px-2 py-1
              transition-colors duration-200
              ${isActive ? 'text-accent-deep' : 'text-muted-foreground'}
            `}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <item.icon size={21} strokeWidth={isActive ? 2.2 : 2} />
            <span className="text-[10.5px] font-medium">{item.label}</span>
          </motion.button>
        );
      })}
    </motion.nav>
  );
};

export default BottomNavbar;
