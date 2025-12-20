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

/**
 * Format date for HTML date input (YYYY-MM-DD in local timezone)
 */
export const formatDateForInput = (date) => {
  const d = safeDate(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Get today's date formatted for input max attribute
 */
export const getTodayForInput = () => {
  return formatDateForInput(new Date());
};

/**
 * Parse date input value to Date object (handles timezone correctly)
 * Creates date at noon local time to avoid timezone boundary issues
 */
export const parseDateInput = (dateString) => {
  if (!dateString) return new Date();
  const [year, month, day] = dateString.split('-').map(Number);
  // Create date at noon to avoid timezone issues
  return new Date(year, month - 1, day, 12, 0, 0);
};

/**
 * Get ISO week number for a date (for weekly digest invalidation)
 */
export const getISOWeek = (date) => {
  const d = safeDate(date);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

/**
 * Get ISO year-week string (e.g., "2024-W03")
 */
export const getISOYearWeek = (date) => {
  const d = safeDate(date);
  const week = getISOWeek(d);
  // ISO week year might differ from calendar year at year boundaries
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayNum = jan4.getUTCDay() || 7;
  jan4.setUTCDate(jan4.getUTCDate() + 4 - dayNum);
  const year = d.getTime() < jan4.getTime() ? d.getFullYear() - 1 : d.getFullYear();
  return `${year}-W${String(week).padStart(2, '0')}`;
};

/**
 * Get date string in YYYY-MM-DD format (local timezone)
 */
export const getDateString = (date) => {
  return formatDateForInput(date);
};
