import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Don't bundle native-only plugins for web builds
      external: [
        '@flomentumsolutions/capacitor-health-extended',
        'capacitor-google-fit',
        '@nickmjones/capacitor-healthkit'
      ]
    }
  },
  // Handle external modules during dev
  optimizeDeps: {
    exclude: [
      '@flomentumsolutions/capacitor-health-extended',
      'capacitor-google-fit',
      '@nickmjones/capacitor-healthkit'
    ]
  }
});
