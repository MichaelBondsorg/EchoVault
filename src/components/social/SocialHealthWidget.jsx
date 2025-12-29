/**
 * Social Health Widget Component
 *
 * Dashboard widget showing social connection health:
 * - Work/personal connection balance meter
 * - Connection timeline visualization
 * - Quick actions for reaching out
 * - Isolation risk indicator
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Briefcase,
  Heart,
  MessageCircle,
  Phone,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertCircle,
  ChevronRight,
  Sparkles,
  Edit2
} from 'lucide-react';

import { analyzeSocialHealth, getSocialTimeline, getSocialQuickActions } from '../../services/social/socialTracker';
import { generateConnectionNudge } from '../../services/social/connectionNudges';
import RelationshipCorrectionModal from './RelationshipCorrectionModal';

const SocialHealthWidget = ({ userId, burnoutRisk, currentMood }) => {
  const [socialHealth, setSocialHealth] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  // Relationship correction modal state
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState(null);

  useEffect(() => {
    loadSocialData();
  }, [userId]);

  const loadSocialData = async () => {
    setLoading(true);
    try {
      const health = await analyzeSocialHealth(userId);
      setSocialHealth(health);

      const timelineData = await getSocialTimeline(userId, 14);
      setTimeline(timelineData);
    } catch (error) {
      console.error('Failed to load social data:', error);
    }
    setLoading(false);
  };

  // Generate nudge based on current context
  const nudge = useMemo(() => {
    if (!socialHealth?.available) return null;
    return generateConnectionNudge(socialHealth, {
      burnoutRisk,
      currentMood
    });
  }, [socialHealth, burnoutRisk, currentMood]);

  // Calculate balance percentage (0 = all work, 100 = all personal)
  const balancePercentage = useMemo(() => {
    if (!socialHealth?.available) return 50;
    const total = socialHealth.uniqueWorkPeople + socialHealth.uniquePersonalPeople;
    if (total === 0) return 50;
    return Math.round((socialHealth.uniquePersonalPeople / total) * 100);
  }, [socialHealth]);

  // Handle opening correction modal for a person
  const handleCorrectionClick = useCallback((person) => {
    setSelectedPerson(person);
    setCorrectionModalOpen(true);
  }, []);

  // Handle category saved - refresh data
  const handleCategorySaved = useCallback((personName, newCategory) => {
    // Refresh social data to reflect the new categorization
    loadSocialData();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-warm-200 p-4 flex items-center justify-center h-32">
        <RefreshCw className="w-5 h-5 animate-spin text-warm-400" />
      </div>
    );
  }

  // No data state
  if (!socialHealth?.available) {
    return (
      <div className="bg-warm-50 rounded-2xl border border-warm-200 p-4">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-warm-400" />
          <p className="text-warm-600 text-sm">
            Keep journaling to see connection patterns
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl border border-warm-200 overflow-hidden"
    >
      {/* Header */}
      <div className="p-4 border-b border-warm-100">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-warm-800 flex items-center gap-2">
            <Users size={18} className="text-warm-500" />
            Connection Health
          </h3>
          {socialHealth.riskLevel !== 'healthy' && (
            <span className={`text-xs px-2 py-1 rounded-full ${
              socialHealth.riskLevel === 'high'
                ? 'bg-rose-100 text-rose-600'
                : socialHealth.riskLevel === 'moderate'
                  ? 'bg-amber-100 text-amber-600'
                  : 'bg-green-100 text-green-600'
            }`}>
              {socialHealth.riskLevel === 'healthy' ? 'Healthy' : `${socialHealth.riskLevel} risk`}
            </span>
          )}
        </div>

        {/* Balance Meter */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-warm-500">
            <span className="flex items-center gap-1">
              <Briefcase size={12} /> Work
            </span>
            <span className="flex items-center gap-1">
              Personal <Heart size={12} />
            </span>
          </div>

          <div className="relative h-3 bg-warm-100 rounded-full overflow-hidden">
            {/* Work portion (left) */}
            <div
              className="absolute left-0 top-0 h-full bg-blue-400 rounded-l-full"
              style={{ width: `${100 - balancePercentage}%` }}
            />
            {/* Personal portion (right) */}
            <div
              className="absolute right-0 top-0 h-full bg-rose-400 rounded-r-full"
              style={{ width: `${balancePercentage}%` }}
            />
            {/* Center marker */}
            <div className="absolute left-1/2 top-0 h-full w-0.5 bg-warm-300 transform -translate-x-1/2" />
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-blue-600 font-medium">
              {socialHealth.uniqueWorkPeople} people
            </span>
            <span className="text-warm-400">
              {balancePercentage < 40 ? 'Work-heavy' :
                balancePercentage > 60 ? 'Good balance!' : 'Balanced'}
            </span>
            <span className="text-rose-600 font-medium">
              {socialHealth.uniquePersonalPeople} people
            </span>
          </div>
        </div>
      </div>

      {/* Mini Timeline */}
      {timeline.length > 0 && (
        <div className="px-4 py-3 border-b border-warm-100">
          <p className="text-xs text-warm-500 mb-2">Last 14 days</p>
          <div className="flex items-end gap-1 h-8">
            {timeline.slice(-14).map((day, idx) => {
              const maxHeight = 24;
              const workHeight = Math.min((day.work / 3) * maxHeight, maxHeight);
              const personalHeight = Math.min((day.personal / 3) * maxHeight, maxHeight);

              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-px">
                  <div
                    className="w-full bg-rose-300 rounded-t-sm"
                    style={{ height: `${personalHeight}px` }}
                  />
                  <div
                    className="w-full bg-blue-300 rounded-b-sm"
                    style={{ height: `${workHeight}px` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Isolation Alert */}
      {socialHealth.isolationRisk && (
        <div className="px-4 py-3 bg-rose-50 border-b border-rose-100">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-rose-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-rose-700">
                Only {socialHealth.uniquePersonalPeople} personal connections mentioned
              </p>
              <p className="text-xs text-rose-600 mt-0.5">
                Social support is key to resilience
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Neglected Connections */}
      {socialHealth.neglectedConnections?.length > 0 && (
        <div className="p-4 border-b border-warm-100">
          <p className="text-xs text-warm-500 mb-2">Haven't mentioned in a while:</p>
          <div className="flex flex-wrap gap-2">
            {socialHealth.neglectedConnections.slice(0, 3).map(person => (
              <button
                key={person.name}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-warm-100 hover:bg-warm-200 rounded-full text-sm text-warm-700 transition-colors"
              >
                <span className="capitalize">{person.name}</span>
                <span className="text-xs text-warm-500">{person.daysSince}d</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="p-4">
        <p className="text-xs text-warm-500 mb-2">Quick actions:</p>
        <div className="flex flex-wrap gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm transition-colors">
            <MessageCircle size={14} />
            Text someone
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-sm transition-colors">
            <Phone size={14} />
            Quick call
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-sm transition-colors">
            <Calendar size={14} />
            Plan hangout
          </button>
        </div>
      </div>

      {/* Positive Reinforcement */}
      {socialHealth.riskLevel === 'healthy' && !socialHealth.isolationRisk && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl">
            <Sparkles size={16} className="text-green-500" />
            <p className="text-sm text-green-700">
              Your social connections look healthy!
            </p>
          </div>
        </div>
      )}

      {/* Ambiguous Connections - Allow correction */}
      {socialHealth.categorized?.ambiguous?.length > 0 && (
        <div className="px-4 pb-4 border-t border-warm-100 pt-3">
          <p className="text-xs text-warm-500 mb-2 flex items-center gap-1">
            <Edit2 size={12} />
            Help us categorize:
          </p>
          <div className="flex flex-wrap gap-2">
            {socialHealth.categorized.ambiguous.slice(0, 3).map(person => (
              <button
                key={person.name}
                onClick={() => handleCorrectionClick(person)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 hover:bg-purple-100 rounded-full text-sm text-purple-700 transition-colors"
              >
                <span className="capitalize">{person.name}</span>
                <Edit2 size={12} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Relationship Correction Modal */}
      <RelationshipCorrectionModal
        isOpen={correctionModalOpen}
        onClose={() => {
          setCorrectionModalOpen(false);
          setSelectedPerson(null);
        }}
        person={selectedPerson}
        currentCategory={selectedPerson?.category}
        userId={userId}
        onCategorySaved={handleCategorySaved}
      />
    </motion.div>
  );
};

/**
 * Compact version for smaller spaces
 */
export const SocialHealthCompact = ({ socialHealth }) => {
  if (!socialHealth?.available) return null;

  const balancePercentage = (() => {
    const total = socialHealth.uniqueWorkPeople + socialHealth.uniquePersonalPeople;
    if (total === 0) return 50;
    return Math.round((socialHealth.uniquePersonalPeople / total) * 100);
  })();

  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-warm-200">
      <Users size={18} className="text-warm-500" />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-warm-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 to-rose-400"
              style={{
                width: `${balancePercentage}%`,
                marginLeft: `${100 - balancePercentage}%`
              }}
            />
          </div>
          <span className={`text-xs font-medium ${
            socialHealth.isolationRisk ? 'text-rose-600' : 'text-warm-500'
          }`}>
            {socialHealth.uniquePersonalPeople}/{socialHealth.uniqueWorkPeople + socialHealth.uniquePersonalPeople}
          </span>
        </div>
      </div>
      {socialHealth.isolationRisk && (
        <AlertCircle size={16} className="text-rose-500" />
      )}
    </div>
  );
};

export default SocialHealthWidget;
