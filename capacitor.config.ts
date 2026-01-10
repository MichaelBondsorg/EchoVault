import type { CapacitorConfig } from '@capacitor/cli';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const config: CapacitorConfig = {
  appId: 'com.echovault.app',
  appName: 'EchoVault',
  webDir: 'dist',
  // Server configuration for development
  server: {
    // Uncomment for live reload during development:
    // url: 'http://localhost:5173',
    // cleartext: true,
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#1a1a2e',
    preferredContentMode: 'mobile',
  },
  android: {
    backgroundColor: '#1a1a2e',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#1a1a2e',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a2e',
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    SocialLogin: {
      google: {
        webClientId: process.env.VITE_GOOGLE_WEB_CLIENT_ID || '',
        iOSClientId: process.env.VITE_GOOGLE_IOS_CLIENT_ID || '',
        iOSServerClientId: process.env.VITE_GOOGLE_IOS_SERVER_CLIENT_ID || '',
      },
    },
  },
};

export default config;
