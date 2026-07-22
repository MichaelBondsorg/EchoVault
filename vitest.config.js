import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mock native modules for testing
      '@capacitor/core': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor-firebase/crashlytics': path.resolve(__dirname, './src/test/mocks/crashlytics.js'),
      '@capacitor/app': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor/browser': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor/geolocation': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor/haptics': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor/keyboard': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor/preferences': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor/splash-screen': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor/status-bar': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capgo/capacitor-social-login': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor/push-notifications': path.resolve(__dirname, './src/test/mocks/capacitor.js'),
      '@capacitor/filesystem': path.resolve(__dirname, './src/test/mocks/filesystem.js'),
    }
  },
  test: {
    // Use jsdom for DOM testing
    environment: 'jsdom',

    // Setup files run before each test file
    setupFiles: ['./src/test/setup.js'],

    // Global test utilities (describe, it, expect)
    globals: true,

    // Include patterns. All functions/src unit tests run under the root vitest
    // config via glob (pure/properly-mocked modules). The emulator-only
    // firestoreRules suite is excluded below and runs under the rules config.
    include: [
      'src/**/*.{test,spec}.{js,jsx,ts,tsx}',
      'functions/src/**/__tests__/**/*.test.js',
      'scripts/__tests__/**/*.test.js',
    ],

    // Exclude patterns. firestoreRules.test.js needs the Firestore emulator and
    // runs only via `npm run test:rules`, never in the jsdom root suite.
    exclude: [
      'node_modules',
      'dist',
      'ios',
      'android',
      '**/functions/src/__tests__/firestoreRules.test.js',
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.test.{js,jsx}',
        'src/**/*.spec.{js,jsx}',
        'src/main.jsx',
        'src/config/firebase.js'
      ],
      // Minimum coverage thresholds (lowered for initial setup)
      thresholds: {
        statements: 10,
        branches: 10,
        functions: 10,
        lines: 10
      }
    },

    // Reporter configuration
    reporters: ['default'],

    // Timeout for tests
    testTimeout: 10000,

    // Mock Firebase for all tests
    server: {
      deps: {
        inline: ['firebase']
      }
    }
  }
});
