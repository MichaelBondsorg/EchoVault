import { PERSONAL_PROMPTS, WORK_PROMPTS } from '../config/constants';

export const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

export const getPromptsForSession = (category, smartReflections) => {
  if (smartReflections.length > 0) {
    return { type: 'smart', prompts: smartReflections.slice(0, 3) };
  }

  const bank = category === 'work' ? WORK_PROMPTS : PERSONAL_PROMPTS;

  // Track recently shown prompts in localStorage
  const recentlyShown = JSON.parse(localStorage.getItem('recentPrompts') || '[]');
  const available = bank.filter(p => !recentlyShown.includes(p.id));
  const pool = available.length >= 3 ? available : bank;
  const selected = shuffleArray(pool).slice(0, 3);

  // Update localStorage (keep last 10)
  localStorage.setItem('recentPrompts', JSON.stringify([
    ...selected.map(p => p.id),
    ...recentlyShown
  ].slice(0, 10)));

  return { type: 'standard', prompts: selected.map(p => p.text) };
};
