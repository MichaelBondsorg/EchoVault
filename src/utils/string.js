/**
 * Safely convert any value to a string
 */
export const safeString = (val) => {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && val !== null) return JSON.stringify(val);
  return "";
};

/**
 * Format structured mentions (@person:name, @place:location, etc.) for display
 * Converts @person:spencer_jones to "Spencer Jones"
 */
export const formatMentions = (text) => {
  if (typeof text !== 'string') return text;

  return text
    // Handle @person:name -> Name (capitalize and replace underscores)
    .replace(/@person:([a-z0-9_]+)/gi, (_, name) =>
      name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    )
    // Handle @place:location -> Location
    .replace(/@place:([a-z0-9_]+)/gi, (_, place) =>
      place.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    )
    // Handle @goal:description -> "description" (keep lowercase, more readable)
    .replace(/@goal:([a-z0-9_]+)/gi, (_, goal) =>
      goal.replace(/_/g, ' ')
    )
    // Handle @situation:context -> "context"
    .replace(/@situation:([a-z0-9_]+)/gi, (_, situation) =>
      situation.replace(/_/g, ' ')
    )
    // Handle @self:statement -> "statement"
    .replace(/@self:([a-z0-9_]+)/gi, (_, statement) =>
      statement.replace(/_/g, ' ')
    );
};

/**
 * Recursively remove undefined values from objects and arrays
 */
export const removeUndefined = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj
      .map(removeUndefined)
      .filter(item => item !== undefined);
  }

  const cleaned = {};
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    if (value !== undefined) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        cleaned[key] = removeUndefined(value);
      } else if (Array.isArray(value)) {
        cleaned[key] = removeUndefined(value);
      } else {
        cleaned[key] = value;
      }
    }
  });
  return cleaned;
};
