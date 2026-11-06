import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    svelte(),
    VitePWA({
      // The app asks before switching to a new version (src/web/lib/pwa.svelte.ts),
      // so an update never reloads a half-filled form.
      registerType: 'prompt',
      injectRegister: false,
      // Cloudflare Access sits in front of everything: without the session cookie the
      // manifest request is redirected to the login page and Chrome refuses to install.
      useCredentials: true,
      includeAssets: ['icon.svg'],
      manifest: {
        id: '/',
        name: 'RackNotes · Теренен опис',
        short_name: 'RackNotes',
        lang: 'bg',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F2F4F3',
        theme_color: '#13232B',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}']
      }
    })
  ],
  build: { outDir: 'dist', sourcemap: true }
});
