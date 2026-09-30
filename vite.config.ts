import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { securityHeaders, toHeadersFile } from './security-headers.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))

/** Writes dist/_headers from security-headers.mjs so Netlify serves the same headers as preview. */
function securityHeadersFile(): Plugin {
  let outDir = 'dist'
  return {
    name: 'forge:security-headers-file',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async writeBundle() {
      await writeFile(resolve(outDir, '_headers'), toHeadersFile(securityHeaders))
    },
  }
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  base: '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      // The new worker waits until the person taps "Reload" in the update toast (src/app/pwa); it never
      // takes over an open tab, so a running focus session is not interrupted.
      registerType: 'prompt',
      // Registration is ours (src/app/pwa/register.ts) so the update prompt can be deferred.
      injectRegister: false,
      // The PNG icons are precached by the glob below; no second entry for each.
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Forge',
        short_name: 'Forge',
        description: 'Plan, focus and finish your degree.',
        categories: ['productivity', 'education'],
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // Both are the light theme's page background: the splash screen and the title bar then match
        // the first paint. Dark mode is handled at runtime by the two media-specific <meta
        // name="theme-color"> tags in index.html, which win over this member once the page is open.
        // (The logo's #111111 tile is the icon background, not a UI colour.)
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/monochrome-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome',
          },
        ],
        // Long-press / right-click the installed icon. `/focus` has no `?start=1`: a session needs a
        // task or a mode chosen first, so it opens the Focus page. `?quickadd=1` is handled by
        // src/app/pwa/LaunchActions.tsx.
        shortcuts: [
          { name: 'Today', short_name: 'Today', url: '/' },
          { name: 'Start focus', short_name: 'Focus', url: '/focus' },
          { name: 'Quick add', short_name: 'Add task', url: '/?quickadd=1' },
        ],
      },
      workbox: {
        // The app shell, every JS/CSS chunk, fonts, SVG and the PNG icons (also used by notifications).
        globPatterns: ['**/*.{js,css,html,svg,woff2,png}'],
        // The static 404 page is only for missing /assets/* files (see netlify.toml); never serve it from the precache.
        // pdf.js (~430 KB) and its worker (~1.2 MB, a .mjs the glob above never matches) are only for the
        // planner's "upload a PDF"; they are cached the first time they are used instead of at install.
        // The /design component gallery is a developer page, so its chunk is not worth installing.
        globIgnores: ['404.html', '**/pdf-*.js', '**/DesignPage-*'],
        cleanupOutdatedCaches: true,
        // The first install takes over the page that registered it, so it works offline without a
        // reload. Updates still wait (skipWaiting stays off): see registerType.
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/pdf[.-][^/]*\.m?js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'forge-pdf', expiration: { maxEntries: 4 } },
          },
          {
            // Blocker favicons (img-src allows this origin). Cross-origin <img> is a no-cors request, so
            // the responses are opaque (status 0) and must be allowed into the cache explicitly.
            urlPattern: ({ url }) => url.origin === 'https://icons.duckduckgo.com',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'forge-favicons',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
        navigateFallback: '/index.html',
        // Never answer these navigations with the app shell: hashed assets (a missing one must stay a
        // 404, see netlify.toml) and the extension zip download.
        navigateFallbackDenylist: [/^\/assets\//, /\.zip$/, /^\/404\.html$/],
      },
    }),
    securityHeadersFile(),
  ],
  resolve: {
    alias: {
      '@ext': resolve(root, 'extension/src/shared'),
      '@': resolve(root, 'src'),
    },
  },
  build: {
    rolldownOptions: {
      treeshake: {
        moduleSideEffects: [{ test: /[\\/]src[\\/].*\.tsx?$/, sideEffects: false }],
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173, strictPort: true, headers: securityHeaders },
})
