import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Shetkari Saral - FPC Procurement',
        short_name: 'Shetkari Saral',
        description: 'Offline-first collection and payment app for farmer producer companies',
        theme_color: '#1b5e20',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /\/api\/(members|centres|prices)/,
            handler: 'NetworkFirst',
            options: { cacheName: 'ref-data', networkTimeoutSeconds: 4 },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
