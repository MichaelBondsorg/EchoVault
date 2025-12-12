import React from 'react';
import ReactDOM from 'react-dom/client';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import App from './App.jsx';
import './index.css';

// Initialize native features when running on a native platform
const initializeApp = async () => {
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
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Run initialization after render
initializeApp();
