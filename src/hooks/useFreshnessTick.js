import { useState, useEffect } from 'react';

/**
 * Shared "the world may have moved on" signal for surfaces whose correctness
 * depends on wall-clock time (a Firestore `targetAt`/`now` boundary, a
 * day-count reset at midnight) but that otherwise sit quietly mounted with no
 * other reason to re-render.
 *
 * Returns a `tick` number that increments:
 *   - whenever the document becomes visible (`visibilitychange` ->
 *     'visible' — e.g. the tab/app is foregrounded after being backgrounded
 *     or the OS put it to sleep), and
 *   - every `intervalMs` while the document stays visible (a boundary can be
 *     crossed — midnight, a `targetAt`, a snooze expiring — without the tab
 *     ever losing focus).
 *
 * Consumers read a fresh `Date.now()` (or re-key a subscription) whenever
 * `tick` changes; they should NOT try to derive a timestamp from `tick`
 * itself (it is just a change signal, not a clock).
 *
 * Originally the due-open-loop refresh logic lived inline in
 * `OpenLoopsWidget` (I2); this is that same pattern extracted so every
 * consumer (the widget's due AND upcoming subscriptions, `useNexusInsights`'
 * Insight Budget gate) shares one implementation instead of drifting copies.
 *
 * @param {number} [intervalMs=300000] interval while visible, in ms (default 5 minutes)
 * @returns {number} tick — starts at 0, increments over time; never decreases
 */
export function useFreshnessTick(intervalMs = 300000) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') bump();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') bump();
    }, intervalMs);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(intervalId);
    };
  }, [intervalMs]);

  return tick;
}

export default useFreshnessTick;
