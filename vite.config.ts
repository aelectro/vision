import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type PluginOption } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// `npm run dev:https` serves over a locally trusted certificate so that the
// camera, service worker and PWA install flow work when the site is opened
// from a phone. Plain `npm run dev` stays on http://localhost, which browsers
// already treat as a secure context.
export default defineConfig(async ({ mode }) => {
  const https = mode === 'https'

  const plugins: PluginOption[] = [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'logo.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Vision',
        short_name: 'Vision',
        description:
          'Capture the images you see in things, then sharpen and animate them - entirely on your device.',
        theme_color: '#0b0b0f',
        background_color: '#0b0b0f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,bin}'],
        // The ONNX runtime ships multi-megabyte wasm binaries.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // Model weights are fetched from Hugging Face and cached by
        // Transformers.js in its own Cache Storage bucket. Letting Workbox
        // also cache them would double the disk cost.
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Needed to exercise install + offline behaviour during the iOS spike.
        enabled: true,
        type: 'module',
      },
    }),
  ]

  // Imported lazily: vite-plugin-mkcert pulls in undici, which refuses to load
  // on Node 20. Keeping it out of the default path means plain `dev`, `build`
  // and `test` stay usable there.
  if (https) {
    const { default: mkcert } = await import('vite-plugin-mkcert')
    plugins.push(mkcert())
  }

  return {
    // Overridden at build time when publishing to a GitHub Pages project site.
    base: process.env['VITE_BASE'] ?? '/',
    plugins,
    resolve: {
      alias: {
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    worker: {
      format: 'es' as const,
    },
    server: {
      // Required so the dev server is reachable from the phone on the LAN.
      host: true,
      port: 5173,
    },
    optimizeDeps: {
      // Transformers.js resolves its wasm backends lazily at runtime.
      exclude: ['@huggingface/transformers'],
    },
  }
})
