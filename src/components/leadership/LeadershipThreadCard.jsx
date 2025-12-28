/**
 * LeadershipThreadCard Component
 *
 * Displays a leadership thread with timeline of follow-ups.
 * Shows progress indicators and suggests next actions.
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  MessageCircle,
  Archive,
  Clock
} from 'lucide-react';
import { calculateThreadHealth, completeThread } from '../../services/leadership';

const PROGRESS_LABELS = {
  showed_initiative: 'Showed initiative',
  improved_communication: 'Improved communication',
  took_ownership: 'Took ownership',
  led_meeting: 'Led a meeting',
  stepped_up: 'Stepped up',
  made_progress: 'Made progress',
  growing: 'Growing',
  more_confident: 'More confident',
  handled_well: 'Handled well',
  impressed: 'Impressed you',
  proud_of: 'Made you proud',
  turned_around: 'Turned things around'
};

const CONCERN_LABELS = {
  still_struggling: 'Still struggling',
  no_improvement: 'No improvement yet',
  recurring_issue: 'Recurring issue',
  frustrated: 'Caused frustration',
  disappointed: 'Disappointment noted'
};

const LeadershipThreadCard = ({
  thread,
  userId,
  onArchive,
  onViewEntry,
  compact = false
}) => {
  const [expanded, setExpanded] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [completionNote, setCompletionNote] = useState('');

  const personName = thread.person?.replace('@person:', '') || 'Unknown';
  const health = useMemo(() => calculateThreadHealth(thread), [thread]);

  // Calculate days since initial feedback
  const daysSince = useMemo(() => {
    const initialDate = thread.initialEntry?.date?.toDate?.() ||
                        new Date(thread.initialEntry?.date);
    return Math.floor((new Date() - initialDate) / (1000 * 60 * 60 * 24));
  }, [thread.initialEntry?.date]);

  const handleArchive = async () => {
    const success = await completeThread(userId, thread.id, completionNote || null);
    if (success) {
      onArchive?.(thread.id);
      setArchiving(false);
    }
  };

  const getTrendIcon = () => {
    switch (health.trend) {
      case 'improving': return <TrendingUp size={16} className="text-green-500" />;
      case 'concerning': return <TrendingDown size={16} className="text-red-500" />;
      default: return <Minus size={16} className="text-warm-400" />;
    }
  };

  const getTrendColor = () => {
    switch (health.trend) {
      case 'improving': return 'border-green-200 bg-green-50';
      case 'concerning': return 'border-red-200 bg-red-50';
      default: return 'border-warm-200 bg-warm-50';
    }
  };

  if (compact) {
    return (
      <div className={`p-3 rounded-xl border ${getTrendColor()}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User size={14} className="text-warm-500" />
            <span className="text-sm font-medium text-warm-800">{personName}</span>
          </div>
          <div className="flex items-center gap-2">
            {getTrendIcon()}
            <span className="text-xs text-warm-500">{daysSince}d ago</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      layout
      className={`rounded-2xl border overflow-hidden ${getTrendColor()}`}
    >
      {/* Header */}
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm">
              <User size={20} className="text-warm-500" />
            </div>
            <div>
              <h3 className="font-medium text-warm-800">{personName}</h3>
              <div className="flex items-center gap-2 text-xs text-warm-500">
                <Calendar size={12} />
                <span>{daysSince} days since initial feedback</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {getTrendIcon()}
            <span className={`text-xs font-medium ${
              health.trend === 'improving' ? 'text-green-600' :
              health.trend === 'concerning' ? 'text-red-600' :
              'text-warm-500'
            }`}>
              {health.trend === 'improving' ? 'Growing' :
               health.trend === 'concerning' ? 'Needs attention' :
               'Tracking'}
            </span>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </div>

        {/* Quick stats */}
        <div className="flex gap-4 mt-3">
          <div className="text-xs">
            <span className="text-warm-500">Topics: </span>
            <span className="text-warm-700">
              {thread.initialEntry?.feedbackGiven?.join(', ') || 'General'}
            </span>
          </div>
          <div className="text-xs">
            <span className="text-warm-500">Check-ins: </span>
            <span className="text-warm-700">{thread.followUps?.length || 0}</span>
          </div>
        </div>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-white/50">
              {/* Timeline */}
              <div className="mt-4 space-y-3">
                {/* Initial entry */}
                <div className="flex gap-3">
                  <div className="w-6 flex flex-col items-center">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    {thread.followUps?.length > 0 && (
                      <div className="flex-1 w-0.5 bg-warm-200 mt-1" />
                    )}
                  </div>
                  <div className="flex-1 pb-3">
                    <p className="text-xs font-medium text-blue-600">Initial Feedback</p>
                    <p className="text-sm text-warm-700 mt-1">{thread.initialEntry?.summary}</p>
                  </div>
                </div>

                {/* Follow-ups */}
                {thread.followUps?.map((followUp, idx) => {
                  const isLast = idx === thread.followUps.length - 1;
                  const followUpDate = followUp.date?.toDate?.() || new Date(followUp.date);
                  const daysAfter = Math.floor(
                    (followUpDate - (thread.initialEntry?.date?.toDate?.() || new Date(thread.initialEntry?.date))) /
                    (1000 * 60 * 60 * 24)
                  );

                  return (
                    <div key={idx} className="flex gap-3">
                      <div className="w-6 flex flex-col items-center">
                        <div className={`w-2 h-2 rounded-full ${
                          followUp.sentiment === 'positive' ? 'bg-green-500' :
                          followUp.sentiment === 'concerning' ? 'bg-red-500' :
                          'bg-warm-400'
                        }`} />
                        {!isLast && <div className="flex-1 w-0.5 bg-warm-200 mt-1" />}
                      </div>
                      <div className="flex-1 pb-3">
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-warm-500">+{daysAfter} days</p>
                          {followUp.sentiment === 'positive' && (
                            <TrendingUp size={12} className="text-green-500" />
                          )}
                          {followUp.sentiment === 'concerning' && (
                            <TrendingDown size={12} className="text-red-500" />
                          )}
                        </div>
                        <p className="text-sm text-warm-700 mt-1">{followUp.summary}</p>

                        {/* Progress indicators */}
                        {followUp.progressIndicators?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {followUp.progressIndicators.map((indicator, i) => (
                              <span key={i} className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">
                                {PROGRESS_LABELS[indicator] || indicator}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Concern indicators */}
                        {followUp.concernIndicators?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {followUp.concernIndicators.map((indicator, i) => (
                              <span key={i} className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">
                                {CONCERN_LABELS[indicator] || indicator}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="mt-4 pt-4 border-t border-white/50">
                {!archiving ? (
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setArchiving(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-warm-600 hover:bg-white rounded-lg transition-colors"
                    >
                      <Archive size={14} />
                      Complete Thread
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-warm-600">Add an optional completion note:</p>
                    <textarea
                      value={completionNote}
                      onChange={(e) => setCompletionNote(e.target.value)}
                      placeholder="e.g., 'Promoted to senior role' or 'Moved to different team'"
                      className="w-full h-16 p-2 text-sm rounded-lg border border-warm-200 focus:border-green-400 outline-none resize-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchive();
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                      >
                        <CheckCircle size={14} />
                        Archive
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setArchiving(false);
                          setCompletionNote('');
                        }}
                        className="px-3 py-1.5 text-sm text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default LeadershipThreadCard;
