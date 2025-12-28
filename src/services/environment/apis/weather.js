/**
 * Weather API Service
 *
 * Uses Open-Meteo API (free, no API key required)
 * https://open-meteo.com/
 */

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

// Weather code to condition mapping
const WEATHER_CONDITIONS = {
  0: 'clear',
  1: 'mostly_clear',
  2: 'partly_cloudy',
  3: 'overcast',
  45: 'foggy',
  48: 'foggy',
  51: 'drizzle',
  53: 'drizzle',
  55: 'drizzle',
  61: 'rain',
  63: 'rain',
  65: 'heavy_rain',
  71: 'snow',
  73: 'snow',
  75: 'heavy_snow',
  77: 'snow',
  80: 'rain_showers',
  81: 'rain_showers',
  82: 'heavy_rain',
  85: 'snow_showers',
  86: 'snow_showers',
  95: 'thunderstorm',
  96: 'thunderstorm',
  99: 'thunderstorm'
};

// Conditions that typically reduce light exposure
const LOW_LIGHT_CONDITIONS = ['overcast', 'foggy', 'rain', 'heavy_rain', 'snow', 'heavy_snow', 'thunderstorm'];

/**
 * Get current weather for a location
 *
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Object} Weather data
 */
export const getCurrentWeather = async (latitude, longitude) => {
  try {
    const params = new URLSearchParams({
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      current: 'temperature_2m,relative_humidity_2m,weather_code,cloud_cover,is_day',
      timezone: 'auto'
    });

    const response = await fetch(`${OPEN_METEO_BASE}?${params}`);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    const current = data.current;

    const weatherCode = current.weather_code;
    const condition = WEATHER_CONDITIONS[weatherCode] || 'unknown';

    return {
      temperature: current.temperature_2m,
      temperatureUnit: data.current_units?.temperature_2m || '°C',
      humidity: current.relative_humidity_2m,
      weatherCode,
      condition,
      conditionLabel: formatCondition(condition),
      cloudCover: current.cloud_cover,
      isDay: current.is_day === 1,
      isLowLight: LOW_LIGHT_CONDITIONS.includes(condition) || current.cloud_cover > 80,
      timezone: data.timezone,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Failed to fetch weather:', error);
    return null;
  }
};

/**
 * Get daily weather summary (for historical correlation)
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} days - Number of past days (max 92)
 * @returns {Array} Daily weather summaries
 */
export const getDailyWeatherHistory = async (latitude, longitude, days = 14) => {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const params = new URLSearchParams({
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunshine_duration,daylight_duration',
      timezone: 'auto',
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0]
    });

    const response = await fetch(`${OPEN_METEO_BASE}?${params}`);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    const daily = data.daily;

    return daily.time.map((date, i) => {
      const condition = WEATHER_CONDITIONS[daily.weather_code[i]] || 'unknown';
      const sunshineMins = daily.sunshine_duration[i] / 60; // Convert seconds to minutes
      const daylightMins = daily.daylight_duration[i] / 60;

      return {
        date,
        condition,
        conditionLabel: formatCondition(condition),
        tempMax: daily.temperature_2m_max[i],
        tempMin: daily.temperature_2m_min[i],
        sunshineDuration: Math.round(sunshineMins), // minutes of actual sunshine
        daylightDuration: Math.round(daylightMins), // minutes of potential daylight
        sunshinePercent: daylightMins > 0 ? Math.round((sunshineMins / daylightMins) * 100) : 0,
        isLowLight: LOW_LIGHT_CONDITIONS.includes(condition) || sunshineMins < 120 // Less than 2 hours sunshine
      };
    });
  } catch (error) {
    console.error('Failed to fetch weather history:', error);
    return [];
  }
};

/**
 * Format condition for display
 */
const formatCondition = (condition) => {
  const labels = {
    clear: 'Clear',
    mostly_clear: 'Mostly Clear',
    partly_cloudy: 'Partly Cloudy',
    overcast: 'Overcast',
    foggy: 'Foggy',
    drizzle: 'Drizzle',
    rain: 'Rain',
    heavy_rain: 'Heavy Rain',
    snow: 'Snow',
    heavy_snow: 'Heavy Snow',
    rain_showers: 'Rain Showers',
    snow_showers: 'Snow Showers',
    thunderstorm: 'Thunderstorm',
    unknown: 'Unknown'
  };
  return labels[condition] || condition;
};

/**
 * Get weather icon name (for Lucide icons)
 */
export const getWeatherIcon = (condition, isDay = true) => {
  const icons = {
    clear: isDay ? 'Sun' : 'Moon',
    mostly_clear: isDay ? 'Sun' : 'Moon',
    partly_cloudy: isDay ? 'CloudSun' : 'CloudMoon',
    overcast: 'Cloud',
    foggy: 'CloudFog',
    drizzle: 'CloudDrizzle',
    rain: 'CloudRain',
    heavy_rain: 'CloudRain',
    snow: 'CloudSnow',
    heavy_snow: 'CloudSnow',
    rain_showers: 'CloudRain',
    snow_showers: 'CloudSnow',
    thunderstorm: 'CloudLightning'
  };
  return icons[condition] || 'Cloud';
};

export default {
  getCurrentWeather,
  getDailyWeatherHistory,
  getWeatherIcon,
  WEATHER_CONDITIONS,
  LOW_LIGHT_CONDITIONS
};
