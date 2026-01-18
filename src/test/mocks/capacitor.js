/**
 * Mock for @capacitor/core
 *
 * Provides mock implementations of Capacitor APIs for testing.
 */

export const Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => 'web',
  isPluginAvailable: () => false,
  convertFileSrc: (path) => path,
};

export const registerPlugin = (name) => {
  return {
    // Generic mock that returns resolved promises
    echo: async (options) => options,
  };
};

export default {
  Capacitor,
  registerPlugin,
};
