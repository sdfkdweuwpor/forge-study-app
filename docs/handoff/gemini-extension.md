# Handoff prompt: Forge Chrome extension (Phase 9B)

Paste everything below the line into Gemini. It needs access to the GitHub repo
`sdfkdweuwpor/forge-study-app` (Gemini CLI or Jules with GitHub connected), because it
must read a few existing files and push to its own branch.

---

You are building one self-contained part of an existing app called **Forge**: its
**Chrome extension (Manifest V3) site blocker**. Other engineers are working on the
rest of the app at the same time, so you must stay strictly inside the files listed
under "You may create or edit". Everything else is read-only for you.

## Repo and branch rules

- Repo: `sdfkdweuwpor/forge-study-app`. Start from branch `claude/sharp-thompson-tklurt`.
- Create and push to a NEW branch named `gemini/extension`. Never push to any other branch.
  Do not open a pull request.
- Before you start, read these files (read-only): `BRIEF.md` §5.8 (the full extension spec),
  `PLAN.md` §1.4 (messaging) and §6 "Phase 9", `extension/src/shared/config.ts`,
  `src/styles/tokens.css`, `src/styles/typography.css`, `package.json`,
  `vitest.config.ts`, `eslint.config.js`, `tsconfig.json`.

## You may create or edit ONLY

- `extension/**` (everything in the extension folder), **except** `extension/src/shared/config.ts`,
  which is read-only
- `scripts/build-extension.mjs`, `scripts/extension-id.mjs` (new files)
- In `package.json`: only the two scripts `"build:ext"` and `"zip:ext"` (replace their
  placeholder commands). Change nothing else in that file and add no dependencies.
- `tsconfig.json`: only add a project reference to `extension/tsconfig.json` if needed.

Do NOT touch `src/**`, `e2e/**`, any other config, or any docs. Do not add npm dependencies
(TypeScript, `@types/chrome`, Vitest, ESLint and Playwright are already installed).

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
- Everything committed and pushed to `gemini/extension`, with a short `extension/README.md`
  explaining install steps, the message protocol, and anything you were unsure about.
