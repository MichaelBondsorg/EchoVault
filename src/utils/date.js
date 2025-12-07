/**
 * Safely convert any value to a Date object
 */
export const safeDate = (val) => {
  try {
    if (!val) return new Date();
    if (val.toDate) return val.toDate(); // Firestore Timestamp
    if (val instanceof Date) return val;
    if (typeof val === 'string' || typeof val === 'number') return new Date(val);
    return new Date();
  } catch (e) {
    return new Date();
  }
};

/**
 * Format a date for display
 */
export const formatDate = (date) => {
  const d = safeDate(date);
  return d.toLocaleDateString();
};

/**
 * Format a time for display
 */
export const formatTime = (date) => {
  const d = safeDate(date);
  return d.toLocaleTimeString();
};

/**
 * Get the number of days between two dates
 */
export const daysBetween = (date1, date2) => {
  const d1 = safeDate(date1);
  const d2 = safeDate(date2);
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
};

/**
 * Check if a date is today
 */
export const isToday = (date) => {
  const d = safeDate(date);
  const today = new Date();
  return d.toDateString() === today.toDateString();
};

/**
 * Get day of week name
 */
export const getDayName = (date) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[safeDate(date).getDay()];
};
