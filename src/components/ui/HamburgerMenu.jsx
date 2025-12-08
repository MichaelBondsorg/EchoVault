import React, { useState, useEffect, useRef } from 'react';
import { Menu, BarChart3, FileText, Bell, MessageCircle, Phone, LogOut } from 'lucide-react';

const HamburgerMenu = ({
  onShowInsights,
  onShowExport,
  onRequestPermission,
  onOpenChat,
  onOpenVoice,
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
    { icon: BarChart3, label: 'View Patterns', onClick: onShowInsights, color: 'text-gray-600' },
    { icon: FileText, label: 'Export for Therapist', onClick: onShowExport, color: 'text-gray-600' },
    { icon: Bell, label: 'Notifications', onClick: onRequestPermission, color: notificationPermission === 'granted' ? 'text-indigo-600' : 'text-gray-400' },
    { icon: MessageCircle, label: 'Text Chat', onClick: onOpenChat, color: 'text-gray-600' },
    { icon: Phone, label: 'Voice Conversation', onClick: onOpenVoice, color: 'text-indigo-600' },
    { icon: LogOut, label: 'Sign Out', onClick: onLogout, color: 'text-red-500', hoverBg: 'hover:bg-red-50' },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-full hover:bg-gray-100 text-gray-600 transition-colors"
        title="Menu"
      >
        <Menu size={20} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          {menuItems.map((item, index) => (
            <button
              key={index}
              onClick={() => {
                item.onClick();
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm ${item.color} ${item.hoverBg || 'hover:bg-gray-50'} transition-colors`}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default HamburgerMenu;
