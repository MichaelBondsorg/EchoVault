import { createContext, useContext, useMemo } from 'react';

const MoodBackgroundContext = createContext({ moodScore: null, moodCategory: 'unknown' });
export const useMoodBackground = () => useContext(MoodBackgroundContext);

const categoryFor = (score) => {
  if (typeof score !== 'number') return 'unknown';
  if (score >= 0.7) return 'warm';
  if (score >= 0.4) return 'balanced';
  return 'calm';
};

/** Cloud canvas: calm accent wash and bounded, reduced-motion-aware waves. */
const MoodBackgroundProvider = ({ children, moodScore = null }) => {
  const moodCategory = useMemo(() => categoryFor(moodScore), [moodScore]);
  const value = useMemo(() => ({ moodScore, moodCategory }), [moodScore, moodCategory]);

  return (
    <MoodBackgroundContext.Provider value={value}>
      <div className="cloud-background min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        {children}
      </div>
    </MoodBackgroundContext.Provider>
  );
};

export default MoodBackgroundProvider;
