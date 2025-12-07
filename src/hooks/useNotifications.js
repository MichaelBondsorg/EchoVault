import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for managing push notification permissions
 */
export const useNotifications = () => {
  const [permission, setPermission] = useState('default');

  useEffect(() => {
    if ('Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

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

  return { permission, requestPermission };
};

export default useNotifications;
