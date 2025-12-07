import { useEffect } from 'react';

/**
 * Hook to set iOS-specific meta tags for PWA support
 */
export const useIOSMeta = () => {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const meta = document.createElement('meta');
    meta.name = 'apple-mobile-web-app-capable';
    meta.content = 'yes';
    document.head.appendChild(meta);

    const style = document.createElement('meta');
    style.name = 'apple-mobile-web-app-status-bar-style';
    style.content = 'black-translucent';
    document.head.appendChild(style);

    return () => {
      if (document.head.contains(meta)) document.head.removeChild(meta);
      if (document.head.contains(style)) document.head.removeChild(style);
    };
  }, []);
};

export default useIOSMeta;
