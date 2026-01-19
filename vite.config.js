import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

export default defineConfig(({ mode }) => {
  const isProduction = mode === 'production';
  const isAnalyze = mode === 'analyze';

  return {
    // Resolve aliases for native-only modules (stub in web)
    resolve: {
      alias: {
        'capacitor-google-fit': path.resolve(__dirname, 'src/test/mocks/capacitorGoogleFit.js'),
        '@nickmjones/capacitor-healthkit': path.resolve(__dirname, 'src/test/mocks/capacitorGoogleFit.js'),
      }
    },

    plugins: [
      react(),
      // Bundle analyzer - only in analyze mode
      isAnalyze && visualizer({
        filename: 'dist/stats.html',
        open: true,
        gzipSize: true,
        brotliSize: true,
        template: 'treemap' // or 'sunburst', 'network'
      })
    ].filter(Boolean),

    build: {
      rollupOptions: {
        // Don't bundle native-only plugins for web builds
        external: [
          '@flomentumsolutions/capacitor-health-extended',
          'capacitor-google-fit',
          '@nickmjones/capacitor-healthkit',
          '@capgo/capacitor-social-login',
          '@capacitor-firebase/crashlytics'
        ],
        output: {
          // Manual chunk splitting for better caching
          manualChunks: {
            // Vendor chunks
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/functions'],
            'vendor-ui': ['framer-motion', 'lucide-react'],
            // Feature chunks (code splitting)
            'feature-dnd': ['@dnd-kit/core', '@dnd-kit/sortable'],
            'feature-flow': ['@xyflow/react']
          }
        }
      },
      // Target modern browsers for smaller bundle
      target: 'es2020',
      // Source maps for production debugging (but not in final release)
      sourcemap: !isProduction,
      // Chunk size warning threshold
      chunkSizeWarningLimit: 500
    },

    // Strip console.log and debugger in production
    esbuild: {
      drop: isProduction ? ['console', 'debugger'] : [],
      // Keep error boundaries and critical logs
      pure: isProduction ? ['console.log', 'console.debug', 'console.trace'] : []
    },

    // Handle external modules during dev
    optimizeDeps: {
      exclude: [
        '@flomentumsolutions/capacitor-health-extended',
        'capacitor-google-fit',
        '@nickmjones/capacitor-healthkit',
        '@capgo/capacitor-social-login',
        '@capacitor-firebase/crashlytics'
      ]
    },

    // Define environment variables
    define: {
      __DEV__: !isProduction
    }
  };
});
