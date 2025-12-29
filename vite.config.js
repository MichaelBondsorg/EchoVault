import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Don't bundle iOS-only plugins for web builds
      external: [
        '@flomentumsolutions/capacitor-health-extended'
      ]
    }
  },
  // Handle external modules during dev
  optimizeDeps: {
    exclude: ['@flomentumsolutions/capacitor-health-extended']
  }
});
