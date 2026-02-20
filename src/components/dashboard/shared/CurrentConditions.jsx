import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Sun, Moon, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog, CloudDrizzle, CloudSun, CloudMoon,
  Thermometer, Sunset, RefreshCw, MapPin
} from 'lucide-react';
import { getEnvironmentContext, checkLocationPermission } from '../../../services/environment';

// Weather icon mapping
const getWeatherIcon = (condition, isDay = true) => {
  const icons = {
    clear: isDay ? Sun : Moon,
    mostly_clear: isDay ? Sun : Moon,
    partly_cloudy: isDay ? CloudSun : CloudMoon,
    overcast: Cloud,
    foggy: CloudFog,
    drizzle: CloudDrizzle,
    rain: CloudRain,
    heavy_rain: CloudRain,
    snow: CloudSnow,
    heavy_snow: CloudSnow,
    rain_showers: CloudRain,
    snow_showers: CloudSnow,
    thunderstorm: CloudLightning
  };
  return icons[condition] || Cloud;
};

/**
 * CurrentConditions - Live environment widget for dashboard
 *
 * Shows current weather, temperature, and daylight info
 * Refreshes on mount and can be manually refreshed
 */
const CurrentConditions = ({ compact = false }) => {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchConditions = async () => {
    setLoading(true);
    setError(null);

    try {
      // Check location permission first
      const permission = await checkLocationPermission();
      if (permission.denied) {
        setError('Location access needed for weather');
        setLoading(false);
        return;
      }

      const data = await getEnvironmentContext();
      if (data?.available) {
        setContext(data);
        setLastUpdated(new Date());
      } else {
        setError(data?.error || 'Could not get conditions');
      }
    } catch (err) {
      setError('Failed to load conditions');
      console.warn('CurrentConditions error:', err);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchConditions();
  }, []);

  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-warm-400 ${compact ? 'text-xs' : 'text-sm'}`}>
        <RefreshCw className="animate-spin" size={compact ? 12 : 14} />
        <span>Loading conditions...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center gap-2 text-warm-400 ${compact ? 'text-xs' : 'text-sm'}`}>
        <MapPin size={compact ? 12 : 14} />
        <span>{error}</span>
      </div>
    );
  }

  if (!context) return null;

  const weather = context.weather;
  const sunTimes = context.sunTimes;
  const WeatherIcon = getWeatherIcon(weather?.condition, weather?.isDay !== false);

  if (compact) {
    // Compact version for tight spaces
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="flex items-center gap-1 bg-lavender-50 dark:bg-lavender-900/30 text-lavender-700 dark:text-lavender-300 px-2 py-1 rounded-full">
          <WeatherIcon size={12} />
          {weather?.temperature !== undefined && (
            <span className="font-medium">{Math.round(weather.temperature)}°</span>
          )}
          {weather?.conditionLabel && (
            <span className="text-lavender-600 dark:text-lavender-400">{weather.conditionLabel}</span>
          )}
        </span>
        {context.daylightRemaining !== null && context.daylightRemaining > 0 && context.daylightRemaining < 3 && (
          <span className="flex items-center gap-1 text-honey-600 dark:text-honey-400">
            <Sunset size={12} />
            {context.daylightRemaining.toFixed(1)}h left
          </span>
        )}
      </div>
    );
  }

  // Full version
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-r from-lavender-50 to-sage-50 dark:from-lavender-900/30 dark:to-sage-900/30 rounded-xl p-3 border border-lavender-100 dark:border-lavender-800"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Weather Icon & Temp */}
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-white/60 dark:bg-hearth-800/60 flex items-center justify-center">
              <WeatherIcon size={22} className="text-lavender-600 dark:text-lavender-400" />
            </div>
            <div>
              {weather?.temperature !== undefined && (
                <div className="text-xl font-bold text-lavender-800 dark:text-lavender-200">
                  {Math.round(weather.temperature)}°
                </div>
              )}
              {weather?.conditionLabel && (
                <div className="text-xs text-lavender-600 dark:text-lavender-400">{weather.conditionLabel}</div>
              )}
            </div>
          </div>

          {/* Sun Times */}
          {sunTimes && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-warm-500 dark:text-warm-400 border-l border-lavender-200 dark:border-lavender-700 pl-3 ml-1">
              {sunTimes.sunriseLocal && (
                <span className="flex items-center gap-1">
                  <Sun size={12} className="text-honey-500 dark:text-honey-400" />
                  {sunTimes.sunriseLocal}
                </span>
              )}
              {sunTimes.sunsetLocal && (
                <span className="flex items-center gap-1">
                  <Sunset size={12} className="text-terra-500 dark:text-terra-400" />
                  {sunTimes.sunsetLocal}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Daylight remaining warning */}
        {context.daylightRemaining !== null && context.daylightRemaining > 0 && context.daylightRemaining < 2 && (
          <div className="text-xs text-honey-600 dark:text-honey-400 bg-honey-50 dark:bg-honey-900/30 px-2 py-1 rounded-full flex items-center gap-1">
            <Sunset size={12} />
            {context.daylightRemaining.toFixed(1)}h of daylight left
          </div>
        )}

        {/* Refresh button */}
        <button
          onClick={fetchConditions}
          className="text-lavender-400 hover:text-lavender-600 dark:text-lavender-500 dark:hover:text-lavender-300 transition-colors p-1"
          title="Refresh conditions"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Light context indicator */}
      {context.lightContext && context.lightContext !== 'daylight' && (
        <div className="mt-2 text-xs text-warm-500">
          {context.lightContext === 'dark' && '🌙 After dark'}
          {context.lightContext === 'low_light' && '☁️ Low light conditions'}
          {context.lightContext === 'fading' && '🌅 Daylight fading'}
        </div>
      )}
    </motion.div>
  );
};

export default CurrentConditions;
