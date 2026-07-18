import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import { ErrorBoundary } from './components';
import './index.css';

console.log('[Engram] Starting app initialization...');

// Initialize native features when running on a native platform
const initializeApp = async () => {
  console.log('[Engram] Platform:', Capacitor.getPlatform(), 'isNative:', Capacitor.isNativePlatform());

  if (Capacitor.isNativePlatform()) {
    // Match status-bar content and background to the boot-time Cloud theme.
    try {
      const isDark = document.documentElement.classList.contains('dark');
      await StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark });
      await StatusBar.setBackgroundColor({ color: isDark ? '#151618' : '#F7F6F2' });
    } catch (e) {
      // Status bar may not be available on all platforms
    }

    // Hide splash screen after app loads
    await SplashScreen.hide();
  }
  console.log('[Engram] Native initialization complete');
};

console.log('[Engram] About to render React app...');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);

console.log('[Engram] React render called, initializing native features...');

// Run initialization after render
initializeApp();
