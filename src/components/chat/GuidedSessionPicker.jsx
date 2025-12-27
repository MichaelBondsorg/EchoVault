import React from 'react';
import {
  Sun,
  Moon,
  Heart,
  Target,
  Brain,
  Wind,
  Calendar,
  PartyPopper,
  MessageCircle,
  Clock,
  ChevronRight,
} from 'lucide-react';

// Session definitions matching the relay server
const GUIDED_SESSIONS = [
  {
    id: 'morning_checkin',
    name: 'Morning Check-in',
    description: 'Start your day with intention and clarity',
    icon: Sun,
    estimatedMinutes: 5,
    timeOfDay: ['morning'],
    gradient: 'from-amber-400 to-orange-500',
  },
  {
    id: 'evening_reflection',
    name: 'Evening Reflection',
    description: 'Process your day and find closure',
    icon: Moon,
    estimatedMinutes: 8,
    timeOfDay: ['evening', 'night'],
    gradient: 'from-indigo-400 to-purple-600',
  },
  {
    id: 'gratitude_practice',
    name: 'Gratitude Practice',
    description: 'Cultivate appreciation for the good in your life',
    icon: Heart,
    estimatedMinutes: 5,
    timeOfDay: ['morning', 'evening'],
    gradient: 'from-pink-400 to-rose-500',
  },
  {
    id: 'goal_setting',
    name: 'Goal Setting',
    description: 'Define and work towards meaningful goals',
    icon: Target,
    estimatedMinutes: 10,
    timeOfDay: ['morning', 'afternoon'],
    gradient: 'from-green-400 to-emerald-600',
    comingSoon: true,
  },
  {
    id: 'emotional_processing',
    name: 'Emotional Processing',
    description: 'Work through difficult feelings safely',
    icon: Brain,
    estimatedMinutes: 15,
    gradient: 'from-cyan-400 to-blue-600',
    comingSoon: true,
  },
  {
    id: 'stress_release',
    name: 'Stress Release',
    description: 'Let go of tension and find calm',
    icon: Wind,
    estimatedMinutes: 10,
    gradient: 'from-teal-400 to-cyan-600',
    comingSoon: true,
  },
];

const getCurrentTimeOfDay = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
};

const GuidedSessionPicker = ({ onSelectSession, onOpenChat }) => {
  const timeOfDay = getCurrentTimeOfDay();

  // Sort sessions: suggested first, then by estimated time
  const sortedSessions = [...GUIDED_SESSIONS].sort((a, b) => {
    const aIsSuggested = a.timeOfDay?.includes(timeOfDay);
    const bIsSuggested = b.timeOfDay?.includes(timeOfDay);

    if (aIsSuggested && !bIsSuggested) return -1;
    if (!aIsSuggested && bIsSuggested) return 1;

    // Coming soon sessions go last
    if (a.comingSoon && !b.comingSoon) return 1;
    if (!a.comingSoon && b.comingSoon) return -1;

    return a.estimatedMinutes - b.estimatedMinutes;
  });

  const suggestedSession = sortedSessions.find(
    (s) => s.timeOfDay?.includes(timeOfDay) && !s.comingSoon
  );

  return (
    <div className="px-6 py-4">
      {/* Suggested session highlight */}
      {suggestedSession && (
        <div className="mb-6">
          <p className="text-white/60 text-sm mb-2">Suggested for {timeOfDay}</p>
          <button
            onClick={() => onSelectSession(suggestedSession.id)}
            className={`w-full p-4 rounded-2xl bg-gradient-to-br ${suggestedSession.gradient} shadow-lg flex items-center gap-4`}
          >
            <div className="w-14 h-14 rounded-xl bg-white/20 flex items-center justify-center">
              <suggestedSession.icon size={28} className="text-white" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-white font-semibold text-lg">{suggestedSession.name}</h3>
              <p className="text-white/80 text-sm">{suggestedSession.description}</p>
              <div className="flex items-center gap-1 mt-1 text-white/70 text-xs">
                <Clock size={12} />
                <span>~{suggestedSession.estimatedMinutes} min</span>
              </div>
            </div>
            <ChevronRight size={24} className="text-white/60" />
          </button>
        </div>
      )}

      {/* Open chat option */}
      <div className="mb-4">
        <button
          onClick={onOpenChat}
          className="w-full p-4 rounded-xl bg-white/10 hover:bg-white/15 transition-colors flex items-center gap-4"
        >
          <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center">
            <MessageCircle size={24} className="text-white/80" />
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-white font-medium">Open Conversation</h3>
            <p className="text-white/60 text-sm">Chat freely about anything</p>
          </div>
          <ChevronRight size={20} className="text-white/40" />
        </button>
      </div>

      {/* All sessions */}
      <div className="space-y-3">
        <p className="text-white/60 text-sm">Guided Sessions</p>
        {sortedSessions
          .filter((s) => s.id !== suggestedSession?.id)
          .map((session) => {
            const Icon = session.icon;
            return (
              <button
                key={session.id}
                onClick={() => !session.comingSoon && onSelectSession(session.id)}
                disabled={session.comingSoon}
                className={`w-full p-3 rounded-xl flex items-center gap-3 transition-colors ${
                  session.comingSoon
                    ? 'bg-white/5 opacity-50 cursor-not-allowed'
                    : 'bg-white/10 hover:bg-white/15'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br ${session.gradient}`}
                >
                  <Icon size={20} className="text-white" />
                </div>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <h4 className="text-white font-medium text-sm">{session.name}</h4>
                    {session.comingSoon && (
                      <span className="text-xs px-2 py-0.5 bg-white/10 rounded-full text-white/50">
                        Coming soon
                      </span>
                    )}
                  </div>
                  <p className="text-white/50 text-xs">{session.description}</p>
                </div>
                <div className="flex items-center gap-1 text-white/40 text-xs">
                  <Clock size={12} />
                  <span>{session.estimatedMinutes}m</span>
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
};

export default GuidedSessionPicker;
