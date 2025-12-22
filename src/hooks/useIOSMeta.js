import { useEffect } from 'react';

/**
 * Helper to add a meta tag only if it doesn't already exist
 */
const addMetaTagIfMissing = (name, content) => {
  // Check if the meta tag already exists in the document
  const existing = document.querySelector(`meta[name="${name}"]`);
  if (existing) {
    return null; // Tag already exists, don't add duplicate
  }

  const meta = document.createElement('meta');
  meta.name = name;
  meta.content = content;
  document.head.appendChild(meta);
  return meta;
};

/**
 * Hook to ensure iOS/PWA-specific meta tags are present
 * These tags are typically already in index.html, but this hook
 * ensures they exist for dynamically rendered scenarios (e.g., SSR hydration)
 */
export const useIOSMeta = () => {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Add standard PWA capability tag (for modern browsers)
    const mobileMeta = addMetaTagIfMissing('mobile-web-app-capable', 'yes');

    // Add Apple-specific tags (for Safari)
    const appleMeta = addMetaTagIfMissing('apple-mobile-web-app-capable', 'yes');
    const styleMeta = addMetaTagIfMissing('apple-mobile-web-app-status-bar-style', 'black-translucent');

    // Cleanup only tags that were dynamically added by this hook
    return () => {
      if (mobileMeta && document.head.contains(mobileMeta)) {
        document.head.removeChild(mobileMeta);
      }
      if (appleMeta && document.head.contains(appleMeta)) {
        document.head.removeChild(appleMeta);
      }
      if (styleMeta && document.head.contains(styleMeta)) {
        document.head.removeChild(styleMeta);
      }
    };
  }, []);
};

export default useIOSMeta;
