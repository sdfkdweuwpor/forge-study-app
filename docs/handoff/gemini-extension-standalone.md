# Handoff prompt: Forge Chrome extension (standalone, no repo import)

Use this when Gemini can't import the repo. Paste everything below the line into Gemini.
Bring its full answer back to Claude (paste or upload), and Claude will add the files,
run the checks, and fix anything off.

---

You are building one self-contained part of an existing app called **Forge**: its
**Chrome extension (Manifest V3) site blocker**. Other engineers are working on the
rest of the app at the same time, so you must stay strictly inside the files listed
under "You may create or edit". Everything else is read-only for you.

## How to deliver (you have no repo access)

You cannot read or push to the repository. Everything you need is in this prompt.
Output EVERY file you create, each as: a line with its full path (e.g. `extension/src/sw.ts`),
then the COMPLETE file content in one code block. No partial snippets, no "rest unchanged".
Start with a list of all file paths. If the answer gets long, stop after a complete file and
wait for me to say "continue".

### Existing file you must import from (do not re-create it): `extension/src/shared/config.ts`
```ts
/** Shared constants for the app and the Chrome extension. Dependency-free. */
export const APP_ORIGIN = 'https://forge-study-app.netlify.app'
export const APP_URL = `${APP_ORIGIN}/`
export const DEFAULT_EXTENSION_ID = 'gpinhblnpebjbiodblihfpjbffacipbd'
export const EXTENSION_ZIP_URL =
  'https://github.com/sdfkdweuwpor/forge-study-app/releases/latest/download/forge-extension.zip'
```

### Project facts
- Vite + React + TypeScript app at the repo root; you only write the `extension/` folder plus
  `scripts/build-extension.mjs` and `scripts/extension-id.mjs`, and give me the two
  `package.json` script lines for `"build:ext"` and `"zip:ext"`.
- Vitest runs `extension/src/**/*.test.ts` (import `describe/it/expect` from `vitest`).
  Tests run with `TZ=America/New_York`.
- ESLint forbids `any` and `console.*`. TypeScript is strict with `noUncheckedIndexedAccess`.
- `@types/chrome` is installed. Provide `extension/tsconfig.json` (target ES2022, module ES2022,
  lib ES2022 + DOM, `types: ["chrome"]`, strict, `noUncheckedIndexedAccess`, outDir
  `extension/dist/js`).
- Design: the app's stylesheet `src/styles/tokens.css` defines CSS custom properties for light and
  dark themes (dark via `[data-theme="dark"]` and `@media (prefers-color-scheme: dark)`).
  `build-extension.mjs` must copy `src/styles/tokens.css` into `extension/dist/tokens.css`, and
  copy the font file `node_modules/inter-ui/variable-latin/InterVariable-subset.woff2`
  into `extension/dist/fonts/`. In your CSS, use only these variables:
  `--bg --bg-elevated --bg-hover --bg-active --text --text-muted --text-faint --border
  --border-strong --accent --accent-hover --accent-soft --accent-contrast --success-text
  --warning-text --xp-text --radius-sm --radius-md --radius-lg --radius-xl --space-1 --space-2
  --space-3 --space-4 --space-6 --space-8 --space-12 --space-16 --fs-12 --fs-14 --fs-16 --fs-20
  --fs-24 --fs-32 --fs-40 --fw-medium --fw-semibold --fw-bold --lh-body --lh-heading
  --tracking-title --dur-1 --dur-2 --ease --focus-ring --shadow-pop --control-h-md --tap-min`.
  Declare `@font-face { font-family: 'Inter Variable'; src: url('fonts/InterVariable-subset.woff2') format('woff2'); font-weight: 100 900; }`
  and use `font-family: 'Inter Variable', ui-sans-serif, -apple-system, 'Segoe UI', sans-serif;`
  with `font-feature-settings: 'cv11', 'ss01'`. Calm, Notion-like: no gradients, no heavy shadows,
  hierarchy from type and spacing. Respect `prefers-reduced-motion`.
- For icons, write `extension/icons/icon.svg` (a white upward chevron above a split horizontal bar,
  on a #111111 rounded square, 64x64 viewBox, e.g. chevron path `M32 10 50 28 44 34 32 22 20 34 14 28Z`
  and bar path `M12 42h16l-4 8H12zM36 42h16v8H40z`), and have `build-extension.mjs` rasterise it to
  16/32/48/128 PNGs using Playwright (`import { chromium } from 'playwright'`, already installed).

## Code rules (CI will reject violations)

- TypeScript `strict` + `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`,
  no `console.*` in shipped code.
- `npm run typecheck`, `npm run lint`, `npm test -- --run` must all pass. Tests run with
  `TZ=America/New_York`. Extension tests go in `extension/src/**/*.test.ts` (already included
  by `vitest.config.ts`).
- Plain TypeScript compiled with `tsc`; no bundler, no frameworks, no runtime dependencies.
  Output goes to `extension/dist/` (git-ignored).
- Keep pure logic (domain matching, schedule maths, rule building, protocol guards) in
  small modules with unit tests, and thin wrappers around `chrome.*` APIs.

## Fixed facts (use exactly)

- App origin: `APP_ORIGIN = 'https://forge-study-app.netlify.app'` (import from
  `extension/src/shared/config.ts`, don't copy).
- Stable extension ID: `gpinhblnpebjbiodblihfpjbffacipbd`, produced by this manifest `"key"`
  (put it in `manifest.json` verbatim):
  ```
  MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtzlniRJfA7SNvBCwMwTedIzTiprS7b3UoM+HTo3Og9aDBYycXih7YNq1Jfr1282dFEO2R7R9qaGX99aXijiVf6XaxkGcjCb4o3jF60EX3d8+WtID8EJ8wGhkyAXKvHfeEC8kEIsefGdcsSx8ypG/M/FIuvhg5xoZHQ32mIfn7CNHkKSPGFFJuZRZiselXkMiJ3uizEUsGKdOG0WvZ3jt026PyhuRD5974Hpxl3pYZQ24/CX5FFIlVu7MdemdFwJ2HuUGJWmy7S6vXNjA+O6hGyl0UOq00NEHcdxvPgQf06WcAXTDYlccvdwffG7AUKc1EsZC+a4JIGsr538LEb26ZwIDAQAB
  ```
  `scripts/extension-id.mjs` prints the ID derived from the key (SHA-256 of the base64-decoded
  key, first 32 hex chars mapped 0-f → a-p). Add a unit test asserting it equals
  `DEFAULT_EXTENSION_ID` from `config.ts`.
- `externally_connectable.matches`: `https://forge-study-app.netlify.app/*`,
  `http://localhost/*`, `http://127.0.0.1/*`.
- Default blocklist: instagram.com, tiktok.com, youtube.com, x.com, twitter.com, reddit.com,
  facebook.com, snapchat.com, netflix.com, twitch.tv, pinterest.com.

## What to build

1. **`extension/src/shared/protocol.ts`**: the dependency-free message contract the web app
   will import. Export `PROTOCOL_VERSION = 1`, TypeScript types, and runtime type guards
   (`isAppMessage(x): x is AppMessage`). Every message carries `v: 1`. Messages app → extension:
   - `{ v, type: 'ping' }` → reply `{ ok: true, version: string }`
   - `{ v, type: 'sync', config: BlockerConfig }` → reply `{ ok: true }`, where `BlockerConfig =
     { mode: 'focus' | 'schedule' | 'always', blocklist: string[], allowlist: string[]
     (URL prefixes, e.g. "youtube.com/watch?v=abc", "youtube.com/@SomeChannel"),
     schedule: { days: number[] /* 0=Sun */, start: 'HH:mm', end: 'HH:mm' }[],
     motivation: string[] }`
   - `{ v, type: 'session', session: { active: boolean, endsAt: number | null,
     taskTitle: string | null } | null }` → reply `{ ok: true }`
   - `{ v, type: 'getEvents', since: number }` → reply `{ ok: true, events: BlockEvent[],
     cursor: number }`, where `BlockEvent = { id: string (stable, unique), at: number,
     kind: 'blocked' | 'unlock', domain: string, unlockMinutes?: number }`
   - Unknown or invalid messages → `{ ok: false, error: string }`.
   The service worker must check `sender.url` against the allowed origins before acting.
2. **`manifest.json`** (MV3): name "Forge Focus", `key` above, permissions
   `declarativeNetRequest`, `storage`, `alarms`, `tabs`; `host_permissions: ["*://*/*"]`;
   `background.service_worker` (module); `action.default_popup`; `web_accessible_resources`
   for `blocked.html`; `externally_connectable` as above; icons 16/32/48/128 (generate simple
   PNGs of the Forge mark — a white upward chevron above a split bar on a #111 rounded tile;
   the SVG is in `public/favicon.svg`, render it with Playwright in `build-extension.mjs`, or
   commit PNGs).
3. **State in `chrome.storage.local`** so blocking works with the app closed: config, current
   session, unlocks (`{domain, until}`), events (cap ~5,000, drop oldest), daily attempt counts.
4. **Blocking with `declarativeNetRequest` dynamic rules**: redirect `main_frame` requests for
   each blocked domain and all its subdomains (`requestDomains`) to
   `blocked.html?site=<domain>&url=<encoded original>`. Allowlist entries become higher-priority
   `allow` rules (URL-prefix match). Active emergency unlocks exclude that domain. Rebuild rules
   whenever config, session, unlocks or the schedule boundary changes (`chrome.alarms` at the next
   schedule start/end and at unlock expiry). Modes: `focus` = block only while a session is
   active; `schedule` = during schedule windows; `always` = always. Pure function
   `buildRules(state, now) → chrome.declarativeNetRequest.Rule[]` with tests.
5. **`blocked.html` + `blocked.ts`**: calm page matching the app's design. Copy the needed CSS
   custom properties from `src/styles/tokens.css` (light + dark via `prefers-color-scheme`) and
   the Inter font file referenced in `src/styles/typography.css` into `extension/dist` during the
   build (don't hand-copy hex values). Content: the blocked site name, time left in the focus
   session (live), the current task, a big "Back to work" button (goes back, or closes the tab if
   no history), and a random line from the motivation list. Count and log each blocked attempt.
   **Emergency unlock**: a quiet link "I need access" → a 60-second countdown → then a text field
   that must exactly equal `I choose distraction over my goals` → grants 5 minutes for that
   domain → logged as an `unlock` event. No dark patterns beyond that; keep it calm.
6. **Popup** (`popup.html` + `popup.ts`): focus on/off, time left, today's blocked-attempt
   count ("7 wins today"), current mode, and an "Open Forge" button (`APP_URL`).
7. **Build**: `npm run build:ext` → `node scripts/build-extension.mjs` compiles with `tsc -p
   extension/tsconfig.json`, copies html/css/icons/fonts/manifest into `extension/dist/`.
   `npm run zip:ext` → builds, then zips `extension/dist/` to `forge-extension.zip` at the repo
   root (use Node's built-in `zlib` + a tiny zip writer, or the system `zip` command if present;
   no new npm deps).
8. **Tests** (Vitest): protocol guards, domain/subdomain matching, allowlist precedence,
   schedule windows incl. overnight windows and DST, `buildRules` for each mode, unlock expiry,
   event cursor paging, key → ID.

## Done means

- `npm run typecheck && npm run lint && npm test -- --run` pass.
- `npm run zip:ext` produces `forge-extension.zip`; loading `extension/dist` via
  chrome://extensions → Developer mode → Load unpacked shows ID `gpinhblnpebjbiodblihfpjbffacipbd`.
- All files output in full, including a short `extension/README.md` explaining install steps,
  the message protocol, and anything you were unsure about.
