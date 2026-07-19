import type { CapacitorConfig } from '@capacitor/cli';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const config: CapacitorConfig = {
  appId: 'com.echovault.engram',
  appName: 'Engram',
  webDir: 'dist',
  // Server configuration for development
  server: {
    // Uncomment for live reload during development:
    // url: 'http://localhost:5173',
    // cleartext: true,
    androidScheme: 'https',
  },
  ios: {
    // 'never' + viewport-fit=cover: the web layer owns safe-area spacing via
    // env(safe-area-inset-*); 'automatic' would stack native scroll insets on
    // top of the CSS padding and skew fixed-bar positioning.
    contentInset: 'never',
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
      // 'native' resizes the whole webview frame, so fixed/inset-0 surfaces
      // (chat, drawers, bottom bars) track the visible area above the
      // keyboard. 'body' left the frame full-height and WKWebView auto-
      // scrolled instead, detaching composers and opening blank gaps.
      resize: 'native',
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
