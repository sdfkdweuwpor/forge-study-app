/**
 * Builds the Chrome extension into `extension/dist/` (a folder Chrome can load unpacked).
 *
 *   node scripts/build-extension.mjs          build
 *   node scripts/build-extension.mjs --zip    build, then zip dist/ to forge-extension.zip in the repo root
 *
 * 1. Compiles extension/src with plain `tsc` (extension/tsconfig.build.json: no tests) to dist/js.
 * 2. Copies the manifest, pages, styles, the committed PNG icons, the app's design tokens
 *    (src/styles/tokens.css + accents.css) and the Inter font file.
 * 3. Checks the result: the manifest key still hashes to DEFAULT_EXTENSION_ID, every file the
 *    manifest and the pages point at exists, and every relative import in dist/js has the `.js`
 *    extension the browser needs (tsc does not add or check it).
 *
 * No browser is needed: the icons are rasterized once by `scripts/extension-icons.mjs` and committed,
 * so this runs on a plain CI runner. The zip uses the system `zip` (present on ubuntu runners).
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deriveExtensionId } from './extension-id.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'extension', 'dist')
const zipPath = join(root, 'forge-extension.zip')

function fail(message) {
  process.stderr.write(`build:ext: ${message}\n`)
  process.exit(1)
}

const ICON_SIZES = [16, 32, 48, 128]

/** [source relative to the repo root, destination relative to dist] */
const COPIES = [
  ['extension/manifest.json', 'manifest.json'],
  ['extension/src/blocked/blocked.html', 'blocked.html'],
  ['extension/src/blocked/blocked.css', 'blocked.css'],
  ['extension/src/popup/popup.html', 'popup.html'],
  ['extension/src/popup/popup.css', 'popup.css'],
  ['extension/src/ext.css', 'ext.css'],
  ['src/styles/tokens.css', 'tokens.css'],
  ['src/styles/accents.css', 'accents.css'],
  [
    'node_modules/inter-ui/variable-latin/InterVariable-subset.woff2',
    'fonts/InterVariable-subset.woff2',
  ],
  ...ICON_SIZES.map((size) => [`extension/icons/${size}.png`, `icons/${size}.png`]),
]

function compile() {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  const result = spawnSync(process.execPath, [tsc, '-p', 'extension/tsconfig.build.json'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) fail('TypeScript compilation failed.')
}

function copyStatic() {
  for (const [from, to] of COPIES) {
    const source = join(root, from)
    if (!existsSync(source)) {
      const hint = from.startsWith('extension/icons/')
        ? ' Run `node scripts/extension-icons.mjs` once and commit the PNGs.'
        : ' Run `npm ci` if it is a node_modules file.'
      fail(`missing ${from}.${hint}`)
    }
    const target = join(dist, to)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(source, target)
  }
}

/** Every file under `dir`, as sorted paths relative to it, using `/`. */
function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort()
}

function manifestPaths(manifest) {
  const paths = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...(manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources),
  ]
  return paths.filter((p) => typeof p === 'string')
}

/** Local `href`/`src` targets of an HTML page (no scheme, no leading slash). */
function pageAssets(html) {
  return [...html.matchAll(/\b(?:href|src)="([^"#?]+)"/g)]
    .map((match) => match[1])
    .filter((target) => !/^[a-z]+:|^\//i.test(target))
}

async function verify() {
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))

  const { DEFAULT_EXTENSION_ID } = await import(
    pathToFileURL(join(dist, 'js/shared/config.js')).href
  )
  const id = deriveExtensionId(manifest.key)
  if (id !== DEFAULT_EXTENSION_ID) {
    fail(
      `manifest key gives extension ID ${id}, but DEFAULT_EXTENSION_ID is ${DEFAULT_EXTENSION_ID}.`,
    )
  }

  const missing = new Set()
  for (const path of manifestPaths(manifest)) if (!existsSync(join(dist, path))) missing.add(path)
  for (const page of ['blocked.html', 'popup.html']) {
    for (const asset of pageAssets(readFileSync(join(dist, page), 'utf8'))) {
      if (!existsSync(join(dist, asset))) missing.add(`${asset} (used by ${page})`)
    }
  }
  const css = readFileSync(join(dist, 'ext.css'), 'utf8')
  for (const [, url] of css.matchAll(/url\('([^']+)'\)/g)) {
    if (!existsSync(join(dist, url))) missing.add(`${url} (used by ext.css)`)
  }
  if (missing.size > 0) fail(`files referenced but not built: ${[...missing].join(', ')}`)

  // Browsers do not resolve extensionless module specifiers.
  const specifier = /\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g
  for (const file of listFiles(dist).filter((f) => f.startsWith('js/') && f.endsWith('.js'))) {
    for (const [, target] of readFileSync(join(dist, file), 'utf8').matchAll(specifier)) {
      if (!target.endsWith('.js')) fail(`${file} imports "${target}" without a .js extension.`)
      if (!existsSync(join(dirname(join(dist, file)), target)))
        fail(`${file} imports "${target}", which was not built.`)
    }
  }
  return { id, version: manifest.version }
}

function zipDist() {
  const files = listFiles(dist)
  rmSync(zipPath, { force: true })
  // The file list goes in on stdin, sorted, so the zip has manifest.json at its root and a stable order.
  const result = spawnSync('zip', ['-X', '-q', zipPath, '-@'], {
    cwd: dist,
    input: `${files.join('\n')}\n`,
    encoding: 'utf8',
  })
  if (result.error && result.error.code === 'ENOENT') {
    fail(
      'the `zip` command was not found. Install it (Debian/Ubuntu: `sudo apt-get install zip`; macOS ships with it) and run `npm run zip:ext` again.',
    )
  }
  if (result.error) fail(`could not run zip: ${result.error.message}`)
  if (result.status !== 0) fail(`zip exited with status ${result.status}: ${result.stderr.trim()}`)
  return files.length
}

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
compile()
copyStatic()
const { id, version } = await verify()
process.stdout.write(
  `built extension/dist (Forge Focus ${version}, id ${id}, ${listFiles(dist).length} files)\n`,
)

if (process.argv.includes('--zip')) {
  const count = zipDist()
  process.stdout.write(`wrote ${relative(root, zipPath)} (${count} files)\n`)
}
