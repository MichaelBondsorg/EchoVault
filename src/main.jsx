import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import { ErrorBoundary } from './components';
import './index.css';

console.log('[EchoVault] Starting app initialization...');

// Initialize native features when running on a native platform
const initializeApp = async () => {
  console.log('[EchoVault] Platform:', Capacitor.getPlatform(), 'isNative:', Capacitor.isNativePlatform());

  if (Capacitor.isNativePlatform()) {
    // Configure status bar for dark theme
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#1a1a2e' });
    } catch (e) {
      // Status bar may not be available on all platforms
    }

    // Hide splash screen after app loads
    await SplashScreen.hide();
  }
  console.log('[EchoVault] Native initialization complete');
};

console.log('[EchoVault] About to render React app...');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);

console.log('[EchoVault] React render called, initializing native features...');

// Run initialization after render
initializeApp();
