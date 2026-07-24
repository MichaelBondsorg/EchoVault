import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCurrentWeather, getDailyWeatherHistory } from '../weather.js';
import { getSunTimes } from '../sunTimes.js';

// PRIV-02: full device-precision coordinates must never leave the device.
// Every request-building function here must round latitude/longitude to 2
// decimal places (~1.1km) BEFORE constructing the fetch() URL.
const FULL_PRECISION_LAT = 37.774929812345;
const FULL_PRECISION_LNG = -122.419415987654;

const okJsonResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

describe('coordinate rounding before third-party requests (PRIV-02)', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      okJsonResponse({
        current: { temperature_2m: 20, relative_humidity_2m: 50, weather_code: 0, cloud_cover: 10, is_day: 1 },
        current_units: { temperature_2m: '°C' },
        timezone: 'America/Los_Angeles',
        daily: {
          time: ['2026-07-20'],
          weather_code: [0],
          temperature_2m_max: [70],
          temperature_2m_min: [55],
          sunshine_duration: [3600],
          daylight_duration: [7200],
        },
        status: 'OK',
        results: {
          sunrise: '2026-07-20T13:00:00+00:00',
          sunset: '2026-07-21T03:00:00+00:00',
          solar_noon: '2026-07-20T20:00:00+00:00',
          civil_twilight_begin: '2026-07-20T12:30:00+00:00',
          civil_twilight_end: '2026-07-21T03:30:00+00:00',
          day_length: 50400,
        },
      })
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const calledUrl = () => fetchSpy.mock.calls[0][0];

  it('getCurrentWeather rounds lat/lng to 2 decimal places in the request URL', async () => {
    await getCurrentWeather(FULL_PRECISION_LAT, FULL_PRECISION_LNG);

    const url = new URL(calledUrl());
    expect(url.searchParams.get('latitude')).toBe('37.77');
    expect(url.searchParams.get('longitude')).toBe('-122.42');
    // Full-precision digits must not appear anywhere in the request.
    expect(calledUrl()).not.toContain('774929812345');
    expect(calledUrl()).not.toContain('419415987654');
  });

  it('getDailyWeatherHistory rounds lat/lng to 2 decimal places in the request URL', async () => {
    await getDailyWeatherHistory(FULL_PRECISION_LAT, FULL_PRECISION_LNG, 7);

    const url = new URL(calledUrl());
    expect(url.searchParams.get('latitude')).toBe('37.77');
    expect(url.searchParams.get('longitude')).toBe('-122.42');
    expect(calledUrl()).not.toContain('774929812345');
  });

  it('getSunTimes rounds lat/lng to 2 decimal places in the request URL', async () => {
    await getSunTimes(FULL_PRECISION_LAT, FULL_PRECISION_LNG, new Date('2026-07-20T12:00:00.000Z'));

    const url = new URL(calledUrl());
    expect(url.searchParams.get('lat')).toBe('37.77');
    expect(url.searchParams.get('lng')).toBe('-122.42');
    expect(calledUrl()).not.toContain('774929812345');
  });
});
