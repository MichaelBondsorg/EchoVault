import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  User, Bell, Heart, Shield, Download, LogOut,
  ChevronRight, Smartphone, Brain, Users, Loader2,
  FileJson, AlertTriangle
} from 'lucide-react';
import BackfillPanel from '../components/settings/BackfillPanel';
import { exportDiagnosticJSON } from '../utils/diagnosticExport';

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
  entries = [],
  onOpenHealthSettings,
  onOpenNexusSettings,
  onOpenSafetyPlan,
  onOpenExport,
  onOpenEntityManagement,
  onRequestNotifications,
  onLogout,
  notificationPermission,
}) => {
  // INT-002: Loading state for settings items
  const [loadingItem, setLoadingItem] = useState(null);
  const [diagnosticResult, setDiagnosticResult] = useState(null);

  // Handle diagnostic export
  const handleDiagnosticExport = () => {
    try {
      const summary = exportDiagnosticJSON(entries, { userId: user?.uid });
      setDiagnosticResult(summary);
    } catch (error) {
      console.error('Diagnostic export failed:', error);
      setDiagnosticResult({ error: error.message });
    }
  };

  // Wrap handlers with loading feedback
  const handleItemClick = async (itemKey, handler) => {
    if (!handler) return;
    setLoadingItem(itemKey);
    // Small delay to show loading indicator before modal opens
    await new Promise(r => setTimeout(r, 100));
    handler();
    // Clear loading after a short delay (modal will be open by then)
    setTimeout(() => setLoadingItem(null), 300);
  };

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
          icon: Users,
          label: 'People & Things',
          description: 'Edit names, relationships, and entities',
          onClick: onOpenEntityManagement,
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
            {section.items.map((item, index) => {
              const isLoading = loadingItem === item.label;
              return (
                <motion.button
                  key={item.label}
                  onClick={() => handleItemClick(item.label, item.onClick)}
                  disabled={!item.onClick || isLoading}
                  className={`
                    w-full px-4 py-3
                    flex items-center gap-3
                    ${index !== section.items.length - 1 ? 'border-b border-white/10' : ''}
                    ${item.onClick ? 'hover:bg-white/20 active:bg-white/30' : 'opacity-70'}
                    ${isLoading ? 'opacity-80' : ''}
                    transition-colors
                    text-left
                  `}
                  whileTap={item.onClick && !isLoading ? { scale: 0.99 } : {}}
                >
                  {/* INT-002: Show loading spinner when item is being opened */}
                  <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                    {isLoading ? (
                      <Loader2 size={20} className="text-primary-600 animate-spin" />
                    ) : (
                      <item.icon size={20} className="text-primary-600" />
                    )}
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
                  {item.onClick && !isLoading && (
                    <ChevronRight size={20} className="text-warm-400" />
                  )}
                  {isLoading && (
                    <span className="text-xs text-primary-500 font-medium">Loading...</span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Data Enrichment Section */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-warm-400 uppercase tracking-wider px-1">
          Data
        </h3>
        <BackfillPanel />

        {/* Diagnostic Export */}
        <div className="bg-white/30 backdrop-blur-sm border border-white/20 rounded-2xl overflow-hidden p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <FileJson size={20} className="text-amber-600" />
            </div>
            <div className="flex-1">
              <span className="font-medium text-warm-800">Diagnostic Export</span>
              <p className="text-sm text-warm-500">Export all entry data as JSON for troubleshooting</p>
            </div>
          </div>

          <motion.button
            onClick={handleDiagnosticExport}
            disabled={entries.length === 0}
            className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-warm-300 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors"
            whileTap={{ scale: 0.98 }}
          >
            <Download size={18} />
            Export {entries.length} Entries as JSON
          </motion.button>

          {/* Show summary after export */}
          {diagnosticResult && !diagnosticResult.error && (
            <div className="text-xs bg-white/50 rounded-lg p-3 space-y-1">
              <p className="font-medium text-warm-700">Export Summary:</p>
              <div className="grid grid-cols-2 gap-1 text-warm-600">
                <span>Total entries:</span>
                <span className="font-mono">{diagnosticResult.totalEntries}</span>
                <span>With mood score:</span>
                <span className="font-mono">{diagnosticResult.entriesWithMoodScore}</span>
                <span>With health data:</span>
                <span className="font-mono">{diagnosticResult.entriesWithHealthContext}</span>
                <span>With environment:</span>
                <span className="font-mono">{diagnosticResult.entriesWithEnvironmentContext}</span>
                <span>With tags:</span>
                <span className="font-mono">{diagnosticResult.entriesWithTags}</span>
                <span>With themes:</span>
                <span className="font-mono">{diagnosticResult.entriesWithThemes}</span>
              </div>
              {diagnosticResult.warning && (
                <div className="mt-2 flex items-start gap-2 text-amber-700 bg-amber-50 rounded p-2">
                  <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{diagnosticResult.warning}</span>
                </div>
              )}
            </div>
          )}

          {diagnosticResult?.error && (
            <div className="text-xs bg-red-50 text-red-600 rounded-lg p-3">
              Export failed: {diagnosticResult.error}
            </div>
          )}
        </div>
      </div>

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
