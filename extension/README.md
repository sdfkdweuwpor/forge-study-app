# Forge Focus (Chrome extension)

A calm Manifest V3 site blocker for the Forge app. It redirects blocked sites (and their subdomains) to
`blocked.html`, keeps working when the app is closed, and logs every blocked attempt and unlock so the app
can show them. Plain TypeScript compiled with `tsc`, no bundler, no runtime dependencies.

It cannot block phone apps; see the main README for iOS Screen Time and Android Digital Wellbeing.

## Install

From a release: unzip `forge-extension.zip`, then

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and choose the unzipped folder (the one that contains `manifest.json`).
3. The extension ID must read `gpinhblnpebjbiodblihfpjbffacipbd`. That is what lets the app find it.

From source: `npm run build:ext`, then load `extension/dist` the same way.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build:ext` | Compiles `extension/src` to `extension/dist`, copies the pages, tokens and font, and checks the result (ID, referenced files, `.js` import extensions). |
| `npm run zip:ext` | Builds, then zips `extension/dist` to `forge-extension.zip` at the repo root with the system `zip`. |
| `npm test -- --run` | Unit tests (`extension/src/**/*.test.ts`, `scripts/extension-id.test.ts`). |
| `npx playwright test --config extension/playwright.config.ts` | Loads the built extension in Chromium and drives it. Skips with a reason if extensions cannot load. |
| `node scripts/extension-icons.mjs` | Redraws `extension/icons/*.png` from `icon.svg`. Run after the mark changes and commit the PNGs; the build only copies them because release runners have no browser. |

## Layout

- `manifest.json`, `icons/`
- `tsconfig.json` type-checks everything (including tests, no output) and is referenced from the root
  `tsconfig.json`; `tsconfig.build.json` emits `dist/js` without tests.
- `src/shared/` is pure and dependency-free, and the app imports it as `@ext/*`: `protocol.ts` (the contract),
  `domains.ts`, `schedule.ts`, `state.ts` (every rule about the stored state), `origins.ts`, `time.ts`,
  `unlock.ts`, `internal.ts`, `extensionId.ts`, `config.ts`.
- `src/background/` is the service worker (`sw.ts`, a thin `chrome.*` shell) and `rules.ts` (`buildRules`).
- `src/blocked/`, `src/popup/` are the two pages. `src/ext.css` is the shared base (font, focus ring, buttons).
- `src/lib/` holds `chrome.storage` access and a typed `getElementById`.

`dist/` has the HTML and CSS at its root, JS under `js/`, and the app's `tokens.css` and `accents.css`, so the
colours, type scale and focus ring are the app's own. Theme follows the system (`prefers-color-scheme`); the
extension does not know the theme chosen in the app.

## How blocking works

- State lives in `chrome.storage.local`: `config`, `session`, `unlocks`, `events` (newest 5,000), `dailyAttempts`
  (a local `YYYY-MM-DD` day and a count).
- **The service worker is the only writer.** The app and the pages talk to it; every change runs through one queue,
  so two writers cannot overwrite each other. Pages only read storage.
- Each rebuild installs, per blocklist domain, a `main_frame` redirect (`requestDomains` covers subdomains) to
  `blocked.html?site=<domain>#<original URL>`. The URL is in the fragment so `&` and `#` in it survive; the page
  only returns to it if it is http(s) on that domain. Allowlist prefixes become higher-priority `allow` rules.
- Rules are rebuilt when the config, the session or an unlock changes, and by a `chrome.alarms` alarm at the next
  unlock expiry, session end or schedule boundary. Modes: `focus` blocks while a session is active **and** its
  `endsAt` has not passed (so it unblocks even if the app closed first), `schedule` follows the windows, `always`.
- A schedule window belongs to the day it starts on: Tuesday 22:00 to 06:00 also covers Wednesday 04:30.
- **Emergency unlock:** 60 seconds (counted from a timestamp), the exact phrase `I choose distraction over my goals`,
  then 5 minutes for that domain, logged as an `unlock` event.
- A blocked page counts as an attempt only when it is the top frame of a fresh navigation (not a reload or a
  framed copy) and the worker confirms the domain is on the blocklist and really blocked. The referrer is **not**
  used: Chrome keeps it through a redirect, so a click from Gmail or the LMS has one.

## Message protocol (app to extension)

`chrome.runtime.sendMessage(EXTENSION_ID, message, callback)` from the Netlify origin, `http://localhost:*` or
`http://127.0.0.1:*`. Every message has `v: 1`, and the whole payload is validated (`isAppMessage` in
`src/shared/protocol.ts`); anything else gets `{ ok: false, error }`.

| Message | Reply |
| --- | --- |
| `{ v: 1, type: 'ping' }` | `{ ok: true, version }` |
| `{ v: 1, type: 'sync', config }` | `{ ok: true }` |
| `{ v: 1, type: 'session', session }` (`SessionState` or `null`) | `{ ok: true }` |
| `{ v: 1, type: 'getEvents', since }` | `{ ok: true, events, cursor }` |

`getEvents` returns events with `at > since`, oldest first; `cursor` is the newest returned `at`, or `since` when
there are none. `at` is strictly increasing, so a `since` cursor never skips an event. Event ids are stable, so
`bulkPut` is idempotent. `LIMITS` in `protocol.ts` caps list sizes (blocklist 500, allowlist 500, schedule 50,
motivation 200 lines).

```ts
chrome.runtime.sendMessage(EXTENSION_ID, { v: 1, type: 'ping' }, (reply) => { /* { ok: true, version: '1.0.0' } */ })
```

Security: the worker checks `sender.url` by parsing it (exact origin for the app; scheme and hostname for
localhost), so `http://localhost.evil.com` is refused. Any page on localhost, on any port, can talk to the
extension; that is what `externally_connectable` allows for local development.

The pages talk to the worker with `{ type: 'internal:blocked' | 'internal:unlock', domain }`
(see `src/shared/internal.ts`); the worker only accepts them from its own top-frame `blocked.html`.

## Permissions

`declarativeNetRequest`, `storage`, `alarms`, and host access to `*://*/*` (a redirect needs it, and the blocklist
is dynamic). No `tabs` permission: creating and closing a tab do not need it, and it would add a "browsing
history" warning. `blocked.html` is the only web-accessible resource, for http(s) pages only.
