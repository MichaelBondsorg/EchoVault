import { motion } from 'framer-motion';
import {
  User, Bell, Heart, Shield, Download, LogOut,
  ChevronRight, Smartphone, Brain
} from 'lucide-react';

/**
 * SettingsPage - App settings and account management
 *
 * Settings categories:
 * - Account (profile, sign out)
 * - Notifications
 * - Health integrations
 * - Safety plan
 * - Export data
 */
const SettingsPage = ({
  user,
  onOpenHealthSettings,
  onOpenNexusSettings,
  onOpenSafetyPlan,
  onOpenExport,
  onRequestNotifications,
  onLogout,
  notificationPermission,
}) => {
  const settingsSections = [
    {
      title: 'Account',
      items: [
        {
          icon: User,
          label: 'Profile',
          description: user?.email || 'Not signed in',
          onClick: null, // Future: profile editing
        },
      ],
    },
    {
      title: 'Preferences',
      items: [
        {
          icon: Bell,
          label: 'Notifications',
          description: notificationPermission === 'granted' ? 'Enabled' : 'Tap to enable',
          onClick: notificationPermission !== 'granted' ? onRequestNotifications : null,
          badge: notificationPermission !== 'granted' ? 'Off' : null,
        },
        {
          icon: Brain,
          label: 'Nexus Insights',
          description: 'Control AI pattern detection',
          onClick: onOpenNexusSettings,
        },
        {
          icon: Smartphone,
          label: 'Health Integration',
          description: 'Whoop / Apple Health / Google Fit',
          onClick: onOpenHealthSettings,
        },
      ],
    },
    {
      title: 'Safety & Privacy',
      items: [
        {
          icon: Shield,
          label: 'Safety Plan',
          description: 'Your support resources',
          onClick: onOpenSafetyPlan,
        },
        {
          icon: Download,
          label: 'Export for Therapist',
          description: 'Download your entries',
          onClick: onOpenExport,
        },
      ],
    },
  ];

  return (
    <motion.div
      className="px-4 pb-8 space-y-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Page Title */}
      <div className="pt-2">
        <h2 className="font-display font-bold text-xl text-warm-800">
          Settings
        </h2>
      </div>

      {/* Settings Sections */}
      {settingsSections.map((section) => (
        <div key={section.title} className="space-y-2">
          <h3 className="text-xs font-bold text-warm-400 uppercase tracking-wider px-1">
            {section.title}
          </h3>
          <div className="bg-white/30 backdrop-blur-sm border border-white/20 rounded-2xl overflow-hidden">
            {section.items.map((item, index) => (
              <motion.button
                key={item.label}
                onClick={item.onClick}
                disabled={!item.onClick}
                className={`
                  w-full px-4 py-3
                  flex items-center gap-3
                  ${index !== section.items.length - 1 ? 'border-b border-white/10' : ''}
                  ${item.onClick ? 'hover:bg-white/20 active:bg-white/30' : 'opacity-70'}
                  transition-colors
                  text-left
                `}
                whileTap={item.onClick ? { scale: 0.99 } : {}}
              >
                <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                  <item.icon size={20} className="text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-warm-800">{item.label}</span>
                    {item.badge && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-warm-500 truncate">{item.description}</p>
                </div>
                {item.onClick && (
                  <ChevronRight size={20} className="text-warm-400" />
                )}
              </motion.button>
            ))}
          </div>
        </div>
      ))}

      {/* Sign Out Button */}
      <motion.button
        onClick={onLogout}
        className="
          w-full py-3 px-4
          bg-red-50 border border-red-100
          text-red-600 font-medium
          rounded-2xl
          flex items-center justify-center gap-2
          hover:bg-red-100 transition-colors
        "
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <LogOut size={18} />
        Sign Out
      </motion.button>

      {/* App Version */}
      <p className="text-center text-xs text-warm-400">
        EchoVault v2.0 (Zen & Bento)
      </p>
    </motion.div>
  );
};

export default SettingsPage;
