import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, BarChart3, FileText, Bell, MessageCircle, Phone, LogOut, BookOpen, Heart } from 'lucide-react';

const HamburgerMenu = ({
  onShowInsights,
  onShowExport,
  onRequestPermission,
  onOpenChat,
  onOpenVoice,
  onOpenJournal,
  onOpenHealthSettings,
  onLogout,
  notificationPermission
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const menuItems = [
    { icon: BookOpen, label: 'Journal', onClick: onOpenJournal, color: 'text-primary-600' },
    { icon: BarChart3, label: 'View Patterns', onClick: onShowInsights, color: 'text-warm-600' },
    { icon: FileText, label: 'Export for Therapist', onClick: onShowExport, color: 'text-warm-600' },
    { icon: MessageCircle, label: 'Text Chat', onClick: onOpenChat, color: 'text-warm-600' },
    { icon: Phone, label: 'Voice Conversation', onClick: onOpenVoice, color: 'text-primary-600' },
    { icon: Heart, label: 'Health Settings', onClick: onOpenHealthSettings, color: 'text-pink-500' },
    { icon: Bell, label: 'Notifications', onClick: onRequestPermission, color: notificationPermission === 'granted' ? 'text-primary-600' : 'text-warm-400' },
    { icon: LogOut, label: 'Sign Out', onClick: onLogout, color: 'text-red-500', hoverBg: 'hover:bg-red-50' },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="p-2 rounded-full hover:bg-warm-100 text-warm-600 transition-colors"
        title="Menu"
      >
        <Menu size={20} />
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-soft-lg border border-warm-100 py-2 z-50"
          >
            {menuItems.map((item, index) => (
              <motion.button
                key={index}
                onClick={() => {
                  item.onClick();
                  setIsOpen(false);
                }}
                whileHover={{ x: 4 }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-body ${item.color} ${item.hoverBg || 'hover:bg-warm-50'} transition-colors`}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default HamburgerMenu;
