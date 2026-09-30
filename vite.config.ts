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
    // Minimal for now; full PWA polish (icons, update toast, offline) lands in Phase 10.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Forge',
        short_name: 'Forge',
        description: 'Plan, focus and finish your degree.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#111111',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // The static 404 page is only for missing /assets/* files (see netlify.toml); never serve it from the precache.
        // pdf.js (~430 KB) and its worker (~1.2 MB, a .mjs the glob above never matches) are only for the
        // planner's "upload a PDF"; they are cached the first time they are used instead of at install.
        globIgnores: ['404.html', '**/pdf-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/pdf[.-][^/]*\.m?js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'forge-pdf', expiration: { maxEntries: 4 } },
          },
        ],
        navigateFallback: '/index.html',
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
  server: { port: 5173 },
  preview: { port: 4173, strictPort: true, headers: securityHeaders },
})
