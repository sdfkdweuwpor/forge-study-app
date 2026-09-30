import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants as zlibConstants, createBrotliCompress, createGzip } from 'node:zlib'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa'
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

const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/

/**
 * `vite preview` sends every file as it is, while Netlify sends brotli or gzip. Measured without that, a
 * preview delivers about three times the bytes a visitor downloads, so a Lighthouse run against it (or any
 * load-time figure taken from it) says more about the missing compression than about the app. This
 * compresses the text responses of `vite preview` the same way (brotli, else gzip). It changes nothing in
 * the build, in `vite dev` or on Netlify.
 */
function previewCompression(): Plugin {
  return {
    name: 'forge:preview-compression',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const accepted = String(req.headers['accept-encoding'] ?? '')
        const encoding = accepted.includes('br') ? 'br' : accepted.includes('gzip') ? 'gzip' : null
        if (req.method !== 'GET' || encoding === null || req.headers.range !== undefined) {
          next()
          return
        }
        const send = {
          writeHead: res.writeHead.bind(res) as (status: number) => ServerResponse,
          write: res.write.bind(res) as (chunk: Buffer) => boolean,
          end: res.end.bind(res) as () => ServerResponse,
        }
        res.writeHead = ((status: number, ...rest: unknown[]) => {
          const extra = rest.find(
            (r): r is OutgoingHttpHeaders => typeof r === 'object' && r !== null,
          )
          if (extra) {
            for (const [name, value] of Object.entries(extra)) {
              if (value !== undefined) res.setHeader(name, value)
            }
          }
          const type = String(res.getHeader('content-type') ?? '')
          const length = Number(res.getHeader('content-length') ?? Infinity)
          const worthIt = status === 200 && COMPRESSIBLE.test(type) && length > 1024
          if (worthIt && !res.hasHeader('content-encoding')) {
            const packer =
              encoding === 'br'
                ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
                : createGzip({ level: 6 })
            res.removeHeader('content-length')
            res.setHeader('content-encoding', encoding)
            res.setHeader('vary', 'Accept-Encoding')
            packer.on('data', (chunk: Buffer) => void send.write(chunk))
            packer.on('end', () => void send.end())
            // The response is written through `packer`, so its backpressure is what `pipe()` must wait for.
            packer.on('drain', () => void res.emit('drain'))
            res.write = ((chunk: Buffer | string) => packer.write(chunk)) as ServerResponse['write']
            res.end = ((chunk?: Buffer | string) => {
              packer.end(chunk)
              return res
            }) as ServerResponse['end']
          }
          return send.writeHead(status)
        }) as ServerResponse['writeHead']
        next()
      })
    },
  }
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }

const applied = new WeakSet<object>()
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The manifest URLs, the worker's app-shell fallback and its denylist all name paths, so they depend on the
 * base the build is served under: `/` on Netlify, `/forge-study-app/` on GitHub Pages (`vite build --base
 * /forge-study-app/`). The options below are written from the app's root (`/`, `/focus`); vite-plugin-pwa calls
 * this once Vite has resolved the base, command-line flags included, and the paths get the base here.
 */
function applyBase(config: ResolvedConfig, options: Partial<VitePWAOptions>): void {
  if (applied.has(options)) return // the paths below are prefixed in place, so never twice
  applied.add(options)
  const { base } = config // always starts and ends with `/`
  const at = (path: string): string => `${base}${path.replace(/^\//, '')}`
  const { manifest, workbox } = options
  if (manifest) {
    if (manifest.id) manifest.id = at(manifest.id)
    if (manifest.start_url) manifest.start_url = at(manifest.start_url)
    if (manifest.scope) manifest.scope = at(manifest.scope)
    manifest.icons = manifest.icons?.map((icon) => ({ ...icon, src: at(icon.src) }))
    manifest.shortcuts = manifest.shortcuts?.map((shortcut) => ({
      ...shortcut,
      url: at(shortcut.url),
    }))
  }
  if (workbox) {
    workbox.navigateFallback = at('/index.html')
    // Never answer these navigations with the app shell: hashed assets (a missing one must stay a 404, see
    // netlify.toml), the extension zip download and the 404 page itself. They match `url.pathname`, which
    // includes the base.
    workbox.navigateFallbackDenylist = [
      new RegExp(`^${escapeRegExp(at('/assets/'))}`),
      /\.zip$/,
      new RegExp(`^${escapeRegExp(at('/404.html'))}$`),
    ]
  }
}

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
        // Paths from the app's root; `applyBase` adds the base (see above).
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
        // `navigateFallback` (the app shell) and `navigateFallbackDenylist` are set by `applyBase`.
      },
      integration: { configureOptions: applyBase },
    }),
    securityHeadersFile(),
    previewCompression(),
  ],
  resolve: {
    alias: {
      '@ext': resolve(root, 'extension/src/shared'),
      '@': resolve(root, 'src'),
    },
  },
  build: {
    // Every browser the app supports has `<link rel="modulepreload">`, so the polyfill is dead weight.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        // Everything the first page load needs goes into two files: the libraries (React, Dexie, the icons
        // in use) and the app. Left to its default the bundler makes one chunk for every combination of
        // entry points that shares a module, about 150 small files for the first load, which costs more in
        // requests, stylesheets and compression than the bytes saved. The lazy pages keep the default split,
        // except for the two kinds of module every page draws from and none depends on (icons and the small
        // components in `src/ui`): each page then fetches those as one file instead of a dozen. A group never
        // pulls in its dependencies (`includeDependenciesRecursively`): a bucket that did would make every
        // page that uses one icon download the editor, the drag and drop code and the charts.
        codeSplitting: {
          groups: [
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, tags: ['$initial'], priority: 3 },
            { name: 'app', tags: ['$initial'], priority: 2 },
            {
              name: 'icons',
              test: /[\\/]lucide-react[\\/]/,
              minShareCount: 2,
              includeDependenciesRecursively: false,
              priority: 1,
            },
            {
              name: 'ui',
              test: /[\\/]src[\\/]ui[\\/](?!BlockEditor|charts|CommandPalette)/,
              minShareCount: 2,
              includeDependenciesRecursively: false,
              priority: 1,
            },
          ],
        },
      },
      treeshake: {
        // App source has no module that does its work merely by being imported, and its barrels (`@/ui`,
        // a feature's `index.ts`) re-export far more than any one importer uses. Declaring that lets the
        // bundler drop an import whose exports nobody reads, instead of keeping the whole module (and its
        // dependencies) in the first download for the sake of a side effect it cannot rule out.
        moduleSideEffects: [{ test: /[\\/]src[\\/].*\.tsx?$/, sideEffects: false }],
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173, strictPort: true, headers: securityHeaders },
})
