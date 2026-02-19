import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for managing push notification permissions and FCM token registration.
 *
 * When a userId is provided, automatically initializes the notification system
 * (token registration, deep links, timezone detection) after the user authenticates.
 *
 * @param {string|null} userId - Authenticated user ID, or null if not logged in
 */
export const useNotifications = (userId = null) => {
  const [permission, setPermission] = useState('default');
  const [token, setToken] = useState(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  // Initialize FCM when user is authenticated
  useEffect(() => {
    if (!userId || initializedRef.current) return;

    const init = async () => {
      try {
        const { initializeNotifications } = await import('../services/notifications');
        const result = await initializeNotifications(userId);
        if (result.granted) {
          setPermission('granted');
          setToken(result.token);
          initializedRef.current = true;
        }
      } catch (e) {
        console.error('[useNotifications] FCM initialization failed:', e);
      }
    };

    init();
  }, [userId]);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) {
      console.log('Notifications not supported');
      return 'denied';
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result;
    } catch (e) {
      console.error('Error requesting notification permission:', e);
      return 'denied';
    }
  }, []);

  return { permission, requestPermission, token };
};

export default useNotifications;
