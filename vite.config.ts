import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = '/scanner-app/'

export default defineConfig({
  base,
  optimizeDeps: {
    exclude: ['@techstark/opencv-js']
  },
  // Required so OpenCV dynamic imports can code-split inside the high-res worker.
  worker: {
    format: 'es'
  },
  build: {
    chunkSizeWarningLimit: 16000
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        globIgnores: ['**/opencv*.js', '**/node_modules/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /opencv.*\.js$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'opencv-runtime',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ]
      },
      manifest: {
        name: 'Scanner',
        short_name: 'Scanner',
        description: 'Scanner PWA',
        theme_color: '#0f172a',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
