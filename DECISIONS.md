# Decisions

One dated bullet per decision: what we decided, then why. Newest entries go at the bottom of their section.

## Hosting, deploy, tooling

- **2026-09-29 — Deploy to Netlify, not GitHub Pages.** The repo is private on a free GitHub plan, which rules out Pages. Netlify's free tier serves private repos.
  - Vite uses `base: '/'`.
  - The site URL is one constant, `APP_ORIGIN = https://forge-study-app.netlify.app`, defined in `extension/src/shared/config.ts` and re-exported by `src/config.ts`.
- **2026-09-29 — Deploy mechanism.**
  - The coordinator deploys with the Netlify connector or CLI.
  - `.github/workflows/deploy.yml` also deploys with `npx netlify-cli deploy --prod --dir dist` on push to `main`, but only when the `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` repo secrets exist (the user adds them).
  - If the user connects the repo through Netlify's Git integration instead, delete `deploy.yml` to avoid double deploys.
  - Nothing is published from the branch until the coordinator deploys it or the user merges to `main`.
- **2026-09-29 — `netlify.toml` holds build, SPA rewrite and cache headers.**
  - Build: `npm run build`, publish `dist`, `NODE_VERSION=22`.
  - SPA rewrite: `/* /index.html 200`.
  - Cache: `Cache-Control: immutable` for `/assets/*`; `no-cache` for `/`, `/index.html`, `/sw.js` and `/manifest.webmanifest`.
  - A missing `/assets/*` file returns a real 404 (`/404.html`), via a rule placed above the SPA rewrite. Redirects only apply where no file exists (no `force`), so existing assets are served normally. Without it, a tab left open across a deploy gets `index.html` in place of a JavaScript chunk and fails with a MIME-type error.
- **2026-09-29 — Security headers come from one file, `security-headers.mjs`.** A 15-line Vite plugin writes it to `dist/_headers`, and the same object feeds `vite preview` headers. Playwright therefore runs under the production CSP, and the header list can't drift between two files.
  - The CSP is `default-src 'self'`.
  - `style-src` adds `'unsafe-inline'`: some libraries inject `<style>` elements or style attributes, and with `script-src 'self'` it cannot run script. React `style` props alone would not need it.
  - `font-src` adds `data:`, because Vite inlines small font subsets as data URIs.
  - `worker-src 'self'` only: workers are separate built files (`new Worker(new URL(...))`), never `blob:` or `?worker&inline`.
  - `img-src` adds `data:`, `blob:` and `https://icons.duckduckgo.com`.
  - `frame-ancestors 'none'`.
  - The theme bootstrap is an external `/theme-init.js`, so no inline scripts are needed.
- **2026-09-29 — Extension releases stay on GitHub Actions.** Releases work on private repos. Download links need the user to be logged in to GitHub, which is fine for a single user.
- **2026-09-29 — No Playwright MCP here, so verification uses a Playwright script.** `npm run shoot` runs `scripts/shoot.spec.ts` through the Playwright test runner, which gives TypeScript without `tsx`.
  - It serves the preview build, fixes the clock and seeds sample data.
  - It saves light/dark × 1440/375 PNGs to the git-ignored `screenshots/`. Agents review them with Read.
  - Curated shots for the README are committed under `docs/screenshots/` in Phase 13.
- **2026-09-29 — Pin `@playwright/test` to exactly `1.56.1`.** The environment ships chromium-1194 in `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`) for that version. Never run `playwright install` locally; CI may install its own browser if e2e is ever added there.
- **2026-09-29 — CI (`ci.yml`) runs typecheck, lint, unit tests and build on every push and PR. e2e runs only in agent sessions.** This keeps the private repo within its 2,000 free Actions minutes.
- **2026-09-29 — Node scripts are plain `.mjs`; Playwright handles `.ts` specs.** This avoids adding `tsx` or `ts-node`.
- **2026-09-29 — PWA icons are rasterized from `favicon.svg` by `scripts/icons.mjs` using Playwright's Chromium.** This avoids `sharp` and `@vite-pwa/assets-generator`.
- **2026-09-29 — Lighthouse runs in Phase 13 via `npx lighthouse` with `CHROME_PATH` pointing to the bundled Chromium.** It is a one-off audit, so it isn't added as a dependency.
- **2026-09-29 — Subagents live in `.claude/agents/` and are invoked by type** (architect, designer, builder, reviewer, helper) with the `model:` from their frontmatter. Phase 0 ran through the general-purpose agent with an opus override because the session hadn't loaded the new types yet; they are loaded from Phase 1 on.
  - Parallel builders get disjoint file-ownership lists (PLAN §6).
  - Edits to shared files are serialized by the coordinator.

## Dependencies beyond BRIEF §2 (each: why a few lines of code wouldn't do)

- **2026-09-29 — `dexie-react-hooks`.** It provides `useLiveQuery`. Re-implementing Dexie liveQuery subscriptions, including the cleanup and StrictMode edge cases, isn't worth it.
- **2026-09-29 — `@fontsource-variable/inter`.** *Superseded in Phase 2A by `inter-ui` (below).* It self-hosts Inter's variable woff2 with `unicode-range` subsets, so only Latin downloads.
  - Vite fingerprints the files and the PWA precaches them.
  - It is version-pinned in npm instead of hand-copied binaries.
  - The family name is `'Inter Variable'`.
- **2026-09-29 — `@dnd-kit/utilities`.** It supplies the `CSS.Transform` helper that dnd-kit's sortable examples use. It is already a transitive dependency, and listing it avoids importing an undeclared package.
- **2026-09-29 — `zod` v4.** The brief explicitly allows it. It is used only in lazy-loaded chunks (Claude plan import, backup import, templates), so it adds nothing to the initial bundle.
- **2026-09-29 — `fake-indexeddb` (dev).** It gives a real IndexedDB for Vitest, to test the Dexie schema, migrations, repos, trash, XP idempotency and snapshot restore in Node.
- **2026-09-29 — ESLint stack (dev).** `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y` and `globals`. They enforce the brief's hard rules (no `any`, no `console`), hook correctness, baseline a11y and the layer boundaries (`no-restricted-imports`, and no `Date.now()` in `src/logic`).
  - Use the newest ESLint major that all these plugins support as a peer.
- **2026-09-29 — `prettier` (dev).** It keeps formatting consistent across parallel builders at zero runtime cost. It runs via `npm run format`; lint doesn't check formatting.
- **2026-09-29 — `@types/react`, `@types/react-dom`, `@types/node`, `@types/chrome` (dev).** Types only. `@types/node` covers configs, scripts and fs in tests. `@types/chrome` covers the extension. The app declares its own ~10-line `chrome.runtime.sendMessage` type so `@types/chrome` doesn't leak into it.
- **2026-09-29 — No jsdom, happy-dom or Testing Library.** The brief asks for Vitest on logic and Playwright for UI. Pure logic and Dexie tests run in the Node environment. Add a DOM environment only if a component test becomes necessary, with a line here.
- **2026-09-29 — ESLint is pinned to v9 (`^9.39`), not v10.** `eslint-plugin-jsx-a11y@6.10` (latest) only peers ESLint up to 9, and we install without `--legacy-peer-deps`. `@eslint/js` is on v9 to match. Revisit when jsx-a11y supports v10.
- **2026-09-29 — Theme boot key.** `public/theme-init.js` reads `localStorage['forge:theme']` (`light|dark|system`) and falls back to `prefers-color-scheme`; ThemeProvider must mirror the theme to that key.
- **2026-09-29 — Versions.**
  - Runtime: vite ^8.3, @vitejs/plugin-react ^6.1, vitest ^5.0, react/react-dom ^19.3, vite-plugin-pwa ^1.3, dexie ^4.4, dexie-react-hooks ^4.4, date-fns ^4, zod ^4, lucide-react (latest), @dnd-kit/core, @dnd-kit/sortable.
  - TypeScript `~5.9`, not TS 6: ecosystem readiness.
  - Import lucide icons by name only, so tree-shaking works.
- **2026-09-29 — `inter-ui` (official Inter 4.1 build) replaces `@fontsource-variable/inter` (Phase 2A).** Fontsource ships Google Fonts' build, which strips Inter's `cv*`/`ss*`/`zero` features, so the brief's `cv11` (single-storey a) and `ss01` (open digits) did nothing. This was verified by pixel comparison.
  - `src/styles/typography.css` points one `@font-face` at `inter-ui/variable-latin/InterVariable-subset.woff2`, the official Latin subset with the wght and opsz axes. It precaches 99.7 KB, down from 7 subset files / 218 KB. Other scripts fall back per glyph to the system font.
  - It is still version-pinned in npm, and the family name stays `'Inter Variable'`. Italic is synthesised; the italic file is not shipped.
  - `font-optical-sizing: auto` uses the opsz axis, so titles and the 96 px timer get Inter Display.
  - A metric-matched `'Inter Fallback'` (Arial with size and ascent overrides) avoids layout shift during `font-display: swap`.

## Architecture

- **2026-09-29 — Routing uses a hand-written history router with typed routes, not react-router.** Netlify's SPA rewrite plus the PWA `navigateFallback` make clean paths safe, and they read better in breadcrumbs and shared links.
  - The router is about 150 lines. We only need a route table, params, an optional last segment, `Link`, `navigate`, `href`, `useRoute` and `useQuery`.
  - All URL access sits in `router/location.ts`. Switching to hash routing, for a host without rewrites, is a contained change.
  - `vite dev` and `vite preview` already fall back to `index.html`.
- **2026-09-29 — The complete route table is central, and features auto-register through `import.meta.glob('features/*/feature.ts')` manifests.** These provide routes, commands, shortcuts, search, slots, providers, domain handlers and `onAppStart`. Parallel builders then almost never edit the same file, links stay type-safe, and every route is lazy-loaded.
- **2026-09-29 — Named UI slots** (e.g. `course.panels`, `today.aside`, `settings.sections`). A later phase can add UI to another feature's page without editing it, which matters most for the 9 parallel extras in Phase 11.
- **2026-09-29 — Dexie liveQuery hooks are the store. Writes go only through `src/db/repos/*`. Contexts hold UI state only.** There is one source of truth, no cache invalidation, and no Redux or Zustand.
- **2026-09-29 — Domain events are emitted after commit (`src/db/events.ts`), and features subscribe to them.** This decouples derived data (streakDays, badges, daily-goal XP) from the core writes, and derived data can be rebuilt from history in `onAppStart`. The core XP award stays inside the task or session transaction, so undo is exact.
- **2026-09-29 — Layer rules are enforced by lint.** `logic/` is pure: no React, Dexie or DOM, and time is injected. `ui/` has no data access. Features import other features only through `index.ts`. That keeps logic testable and boundaries honest when many agents edit.
- **2026-09-29 — Use date-fns v4, not Temporal.** It is tree-shakeable and stable with no polyfill.
  - Calendar days are local `'YYYY-MM-DD'` strings; instants are epoch ms.
  - Never use `new Date('YYYY-MM-DD')`, because it parses as UTC.
  - Tests run with `TZ=America/New_York` to exercise DST.
- **2026-09-29 — TypeScript `strict` plus `noUncheckedIndexedAccess`.** The scheduler and stats index arrays heavily, and this catches off-by-one and undefined bugs at compile time.
- **2026-09-29 — IDs come from `crypto.randomUUID()`.** It is available in secure contexts (Netlify HTTPS, localhost) and needs no dependency. Natural keys are used where they're more robust: settings `'app'`, streakDays by day, badges by badge id, rituals `kind:day`, weekly reviews by week start, block events by extension uuid. These make idempotent upserts trivial.

## Data model

- **2026-09-29 — Schema v1 defines every table up front: the 21 in BRIEF §6 plus 5 extra.** The extras are `savedViews` (Notion-like saved views, §5.3), `rituals` (§5.11), `weeklyReviews` (§5.7), `templates` (§5.11) and `files` (PDF blobs kept apart, so resource lists and snapshots stay light). Later phases then almost never need a migration.
- **2026-09-29 — Migrations are append-only.** Never edit a released version string. Each new version gets its own `migrations/vN.ts`, a matching backup-file migrator, and a fake-indexeddb upgrade test. Old backups and snapshots must always restore.
- **2026-09-29 — Timestamps are stamped by Dexie `creating`/`updating` hooks, which only fill missing values.** Builders can't forget them, and restore and trash-restore keep the original timestamps.
- **2026-09-29 — Booleans and nullable fields are never used as index keys.** IndexedDB can't index booleans, `null` or `undefined`. Nullable dates simply drop out of the index; booleans are filtered in JS.
- **2026-09-29 — Trash moves the record, and its cascade, into a `trash` row with a JSON payload and a 30-day expiry, instead of a `deletedAt` flag.** No query ever has to remember to filter out deleted rows, and restore is one `bulkPut`.
- **2026-09-29 — `xpEvents` is append-only.**
  - Undo writes a negative event with the same `key`.
  - Awards are idempotent per key: skip if the key's net is > 0.
  - Lifetime XP is the sum of all events. Balance is lifetime minus unrefunded redemptions. Levels use lifetime XP.
  - This follows the brief: XP must never drift and must be auditable.
- **2026-09-29 — Levels: advancing from level n to n+1 costs `round(100·n^1.5)`, starting at level 1 with 0 XP.** This matches the brief's sidebar mock ("Level 7 … /1,800", and L7→8 = 1,852).
- **2026-09-29 — `streakDays` is a rebuildable daily aggregate cache. The streak freeze is computed, not stored.** The day's daily-goal target is snapshotted so later settings changes don't rewrite history. At most 1 freeze per week (by `weekStartsOn`). A frozen day keeps the streak but doesn't add to it.
- **2026-09-29 — Breaks are stored as `sessions` rows (`kind: 'break'`), and timers are always computed from timestamps.** The whole pomodoro cycle survives a refresh. Stats filter on `kind = 'focus'`.
- **2026-09-29 — Timer ticks run in a module Web Worker.** Hidden-tab main-thread timers are throttled to about once a minute, which would make the chime and notification late.
- **2026-09-29 — Anti-cheat:** a session counts if it reaches 80% of planned time. Stopwatch sessions have no plan, so they count at 10 minutes or more.
- **2026-09-29 — Priority is stored as a number (0 none to 4 urgent).** It sorts and compares for free. Labels are mapped in logic.
- **2026-09-29 — Subtasks are an embedded checklist array on the task, not separate task rows.** This matches Things/Notion checklists and keeps queries simple.
- **2026-09-29 — Notes (task, goal, course) are a small `Block[]` model with a hand-made block editor and slash menu.** The brief asks for `/todo /heading /divider /callout` only, which doesn't justify a rich-text dependency.
- **2026-09-29 — Device-specific UI prefs (sidebar width/collapsed, last tasks layout, a theme mirror for no-flash boot) live in `localStorage` behind try/catch. Everything else lives in the `settings` row.** Those prefs shouldn't sync between laptop and phone.
- **2026-09-29 — Sample data comes from `?seed=wgu|empty`, which lazy-imports `src/dev/seed.ts`, and only in builds compiled with `VITE_ENABLE_SEED=1`.** It is used for screenshots and e2e (realistic WGU data: C182, C172, C779, D278, C959, C867, C949).
  - `npm run dev` and both Playwright `webServer` commands set the flag. A deployed build never has it: the seed module is dropped from the bundle and `?seed=` is ignored (and stripped from the address). A crafted link therefore can't replace anyone's data, whether or not the database already holds any.
  - Never set `VITE_ENABLE_SEED` in Netlify's environment.
- **2026-09-29 — `TaskFilter`/`TaskSort` live in `src/db/types.ts`, not `logic/taskQuery`.** `SavedView` needs them, and `db` must not depend on `logic` for types; `logic/taskQuery` imports them from `@/db/types` instead.
- **2026-09-29 — Tables are typed `Table<T, ID, NewRow<T>>`.** `add`/`put` accept rows without `createdAt`/`updatedAt` because the hooks stamp them; reads always return full rows.
- **2026-09-29 — Stamping edge cases.** An explicit `updatedAt` in a change is kept (sync/import); a `put()` that omits `createdAt` keeps the stored one; an empty diff is not stamped. `ForgeDB(name, clock)` takes an injectable clock for tests.
- **2026-09-29 — New settings fields need no Dexie migration.** `ensureSettings()` (boot) backfills keys missing from `defaultSettingsData()` into the stored row; `getSettings()`/`useSettings()` apply the same backfill in memory and never write.
- **2026-09-29 — `useSettings()` is `undefined` only while loading; with no row it returns factory defaults.** "No row" means a fresh install, where defaults are the truth, and the shell can distinguish loading from loaded.
- **2026-09-29 — `updateSettings(patch)` merge rules:** plain objects merge key by key (including `tagColors`), arrays replace, `undefined` is ignored, `null` sets null, and `id`/timestamps can't be patched. Removing a tag color will need a dedicated repo function (Phase 3).
- **2026-09-29 — Event bus mechanics.** `emit()` inside a transaction queues on the *root* Dexie transaction's `complete` event and is dropped on abort; outside a transaction it dispatches on a microtask. Handlers run under `Dexie.ignoreTransaction` so they can open their own transactions. `settleDomainEvents()` awaits everything in flight (tests, boot). `DomainHandler` is a union over event types, built with `defineHandler()`.
- **2026-09-29 — `newId()` falls back to `crypto.getRandomValues` when `randomUUID` is missing.** `randomUUID` needs a secure context, and the dev server is sometimes opened over a LAN IP from a phone.

## Scheduler

- **2026-09-29 — Courses are scheduled sequentially from one queue, in topological prerequisite order.** Priority is: active course first, then `order`, then code. This matches how WGU students take courses (one at a time) and makes prerequisites automatic. A cycle is reported and ordering falls back to `order`, so the preview still renders.
- **2026-09-29 — Chunk rules.**
  - Chunks are 25–90 min, in 5-min steps, and a day never goes over its capacity.
  - Tiny tails are avoided by leaving one 25-min final chunk. When that isn't possible, a short final chunk is accepted.
  - If a user's whole week is under 25 min/day, the minimum chunk drops to their largest daily capacity (`minEff`), so a schedule can't stall.
- **2026-09-29 — The schedule is materialized as real `tasks` (`source: 'schedule'`) and reconciled by `diffSchedule` on a stable `scheduleKey = unitId:seq`.** Goal work then appears in Today, Board, Calendar and .ics with no special cases, and user notes on chunks survive rebalances.
- **2026-09-29 — Manual date edits pin a scheduled task, and the rebalancer leaves pinned tasks alone.** Pins expire once their date has passed. This respects the user's choices without letting stale pins block progress.
- **2026-09-29 — Rebalance runs automatically at the first app open each day, and on edits, early completion, skip and catch-up.** Skipped tasks reserve their minutes for today so they move forward.
- **2026-09-29 — Catch-up is found by linear search in 5-min steps.** "Add X min/day" is the smallest X that is actually verified by re-running the scheduler. "Required h/day" is a verified uniform capacity. Both are correct even where the chunking makes feasibility non-monotonic.
- **2026-09-29 — Availability is per goal, and multiple goals don't share one capacity pool.** This is a documented limitation that keeps the algorithm simple. Global days off apply to all goals.
- **2026-09-29 — The slip ("+9 days") is measured against `targetDate`, or against the accepted plan's `baselineEnd` when there's no target.** The brief shows slip relative to a promise.

## Extension

- **2026-09-29 — The manifest has a fixed public `key`, which gives the stable ID `gpinhblnpebjbiodblihfpjbffacipbd`.** The app needs a known ID for `chrome.runtime.sendMessage(EXTENSION_ID, …)`. The private key was discarded because unpacked loading doesn't need it. The Blocker page allows overriding the ID. A unit test asserts that the key hashes to `DEFAULT_EXTENSION_ID`.
- **2026-09-29 — `externally_connectable.matches` = `https://forge-study-app.netlify.app/*`, `http://localhost/*`, `http://127.0.0.1/*`.** Localhost patterns match any port. The service worker also checks `sender.url`. Netlify deploy previews don't match, and the Blocker page says so.
- **2026-09-29 — The extension is written in TypeScript and compiled with plain `tsc` to ES modules, with no bundler.** The service worker is `type: module`; pages load `<script type="module">`.
  - The shared pure code (`extension/src/shared/`) is imported by the app via `@ext/*` and tested by the app's Vitest.
  - The extension has no runtime dependencies (messages use hand-written guards).
- **2026-09-29 — Blocking uses DNR dynamic rules.** `requestDomains` covers subdomains; each rule is a `main_frame` redirect to `/blocked.html?site=`. Allowlist exceptions are higher-priority `allow` rules.
  - Redirects need host permissions (`*://*/*`), and `blocked.html` must be in `web_accessible_resources`.
  - Blocked attempts are counted when `blocked.html` loads (`onRuleMatchedDebug` isn't reliable).
- **2026-09-29 — Emergency unlock is scoped to the blocked domain for 5 minutes, and every unlock is logged as a `blockEvent`.** This matches the brief's honesty goal without disabling all blocking.
- **2026-09-29 — Blocker favicons come from `icons.duckduckgo.com`, with a letter-avatar fallback when offline.** Showing favicons needs a lookup service. DuckDuckGo needs no key, and the fallback keeps it working offline.

## Features & UX

- **2026-09-29 — PWA uses `registerType: 'prompt'`.** It shows an "Update ready — reload" toast and never auto-reloads, so an active focus session isn't interrupted.
- **2026-09-29 — Calendar export offers an `.ics` download plus "Copy calendar text". There is no live subscription URL.** A subscribable URL needs a server. If Phase 12 sync lands, Supabase storage could host one.
- **2026-09-29 — PDFs are stored as Blobs in `files` and opened in a new tab via object URL, not embedded in iframes.** This avoids CSP/plugin issues. Snapshots exclude blobs, and JSON export includes them only on request.
- **2026-09-29 — Cloud sync (Phase 12) is deferred.** Supabase with last-write-wins on `updatedAt`, tombstones as schema v2, and lazy-loaded so it costs nothing when off. We'll decide on `@supabase/supabase-js` vs plain fetch at that point. The app works fully without it.
- **2026-09-29 — A lazy chunk that fails to load (usually after a deploy) reloads the tab once, then offers "Reload".** `RouteErrorView` recognises the browser's dynamic-import failure messages (`logic/chunkError.ts`) and calls `location.reload()` at most once per 30 s per tab, guarded by `sessionStorage['forge:chunk-reload-at']`; if storage is unavailable it never reloads on its own. "Try again" is not offered for these, because `React.lazy` caches the rejected import.
- **2026-09-29 — Startup and database failures render a full-screen recovery page, never a blank one.** `app/start.tsx` boots, then renders once. A rejected boot shows "Forge could not start", and a boot still pending after 10 s shows "taking a while" (an IndexedDB open blocked by another tab hangs silently; if boot finishes later, the app replaces the screen). Both offer Reload and a raw JSON export. Another tab upgrading or deleting the database (`versionchange`, handled in `boot.ts`, not `db.ts`) closes this tab's connection for good and shows "Forge was updated in another tab". Uncaught errors and unhandled rejections go to `recordError`.
- **2026-09-29 — Storage.** Boot asks `navigator.storage.persist()` once, without waiting for it. The raw export reads all tables in one read transaction and embeds attached files as base64 only while they total under 50 MB, otherwise it lists them and says so in `notes`.
- **2026-09-29 — Navigation is announced.** After a pathname change (not on first load, not on query-only changes) focus moves to the page `<h1>` (or `<main>`) and a polite live region announces the page title. Focus is left alone when the page already put it somewhere (an autofocused field) or a modal holds it.

## Design system

- **2026-09-29 — Theme tokens work on any element (Phase 2A).** The selectors are `:root, [data-theme='light']`, `[data-theme='dark']`, and a `prefers-color-scheme: dark` block for `:root:not([data-theme])` / `[data-theme='system']`. That block repeats the dark values, and `contrast.test.ts` fails if the two drift. This lets `/design` nest a dark column inside a light page.
  - Accent presets set raw `--_accent-*-l/-d` values on `[data-accent]`. Each theme block maps them to the public `--accent*` tokens, so the mapping re-resolves inside a nested theme. To preview an accent on a sub-tree, set both `data-accent` and `data-theme` on it.
  - Colour tokens are literal hex or `rgba()` only, so the test can parse and composite them. Shorthands that reference theme colours (such as `--focus-ring`) are declared on `:root, [data-theme]` so they resolve per theme.
- **2026-09-29 — Colour naming and contrast tiers (WCAG AA, enforced by `src/styles/contrast.test.ts`).** The surfaces are `--bg`, `--bg-sidebar` and `--bg-elevated`, each plain, with `--bg-hover` and with `--bg-active`.
  - `--text` and `--text-muted` reach at least 4.5:1 on every surface. Use them for all small text, including placeholders and keyboard hints.
  - `--text-faint` reaches at least 3:1. Use it only for large text (≥ 24 px, or ≥ 18.66 px at weight 700), icons, disabled text and decorative separators.
  - `--{accent,success,warning,danger,xp}` are for fills, icons, bars and rings, at least 3:1.
  - `--{…}-text` is coloured text, at least 4.5:1 on the surfaces and on its own `--{…}-soft` tint.
  - `--accent-contrast` is text on an `--accent` or `--accent-hover` fill, at least 4.5:1.
  - `--bg-inverse` with `--text-inverse` and `--text-inverse-muted` is for tooltips and toasts.
  - `--border` and `--border-strong` are decorative hairlines, not held to 3:1. Controls are identified by their label or text and by the focus ring.
- **2026-09-29 — Minimal colour changes to meet AA.** The rest of the brief's values are unchanged.
  - Light `--text-muted`: 0.65 → 0.72 alpha. The brief's value is 4.2:1 on white.
  - `--text-faint`: light 0.45 → 0.56, dark 0.35 → 0.38, to reach 3:1.
  - Blue accent: `#2383E2` → `#2376D4`, because white text on the brief's blue was 3.9:1.
  - Light `--xp`: `#CB912F` → `#BE8226`, so it reaches 3:1 as a fill.
  - Warning, danger and XP get darker `-text` variants in light mode.
  - Shell edits: the tab-bar labels, the sidebar `Ctrl K` hint, the placeholder "Coming soon" line and the phone date on Today moved from faint to muted. `--on-accent` was renamed `--accent-contrast`.
- **2026-09-29 — Six accent presets, following `AccentId`: blue (default), teal, green, orange, pink and graphite.** Graphite replaces the suggested red, because red would read as `--danger`.
  - A colour accent uses one fill in both themes. White text needs 4.5:1 on it and the fill needs 3:1 against `#252525`, which leaves a narrow window.
  - Hover is darker. Dark mode gets a lighter `--accent-text` and a stronger `--accent-soft`.
  - Graphite is near-black with white text in light mode, and light grey with `#191919` text in dark mode.
- **2026-09-29 — Tag colours are opaque soft backgrounds with same-hue text, at least 5:1 in both themes.** `--tag-<name>-text` doubles as the colour for dots, icons and confetti (at least 3:1 on the page).
- **2026-09-29 — Reduced motion collapses the movement tokens and adds a safety net.** It applies under `[data-reduced-motion='on']`, and under `prefers-reduced-motion` unless the attribute is `off`.
  - `--shift-1/2/3` become 0 and `--scale-in`/`--scale-press` become 1, so components that build their transforms from these tokens become opacity-only.
  - Everything else finishes its transitions and animations instantly. Elements whose motion is already token-based opt out with `data-motion="opacity"` and keep their fades (toasts, "+15 XP", the level-up moment).
  - Delays are kept, because they are timing (tooltip delay, the 600 ms slide-out), not motion.
- **2026-09-29 — Global styles load from one entry, `src/styles/index.css`.** The order is typography, tokens, accents, tags, reset, global, motion. The extension (Phase 9) needs `tokens.css`, `accents.css` and the Inter file. `/design` state demos can force the focus ring with `[data-force~='focus']`.
- **2026-09-29 — Primitives (Phase 2B) share a few conventions.**
  - State rules only swap private `--_*` variables, so `:hover`, `:active` and `[data-force~='hover|active|focus']` (the `/design` demos) stay identical. Hover rules sit inside `@media (hover: hover)` so a tap on a phone does not leave a control stuck in hover; the `data-force` twins sit outside it.
  - Coarse pointers get a 44 px hit area through an invisible `::after` (Checkbox grows its invisible native input instead), so controls keep their dense visual size.
  - Shared helpers live in `src/ui/internal/` (`cx`, `useMergedRef`, `useControllable`, the roving-focus `nextIndex`, `useIndicator` for sliding thumbs/underlines, the `ForceProps` type). They are internal: the `src/ui` barrel should not export them.
  - React 19 passes `ref` as a prop, so components spread it through `...rest` instead of using `forwardRef`.
- **2026-09-29 — The danger Button is outlined, not filled.** White on `--danger` is under 4.5:1, and deeper red tints push `--danger-text` below it too. Rest is `--danger-text` with a 45 % `--danger` hairline; hover and press add `--danger-soft`, which the contrast test already covers.
- **2026-09-29 — Interactive tags tint by at most 8 %.** Mixing a tag's text colour into its background by 10 % or more drops some hues under 4.5:1 (computed for all 18 pairs). Hover uses 5 % plus a hairline, press 8 % (worst case 4.52:1).
- **2026-09-29 — New tokens: `--bg-raised`, `--skeleton`, `--skeleton-shine`.** `--bg-raised` is a control lifted off a tinted track (the segmented-control thumb): white in light, `#383838` in dark, because `--bg-elevated` (`#252525`) is darker than a tinted track in dark mode. `contrast.test.ts` checks `--text`/`--text-muted` (4.5:1) and `--text-faint` (3:1) on it. The skeleton pair is a bone and the band that sweeps across it; the band is white in both themes but much weaker in dark.
- **2026-09-29 — Tooltip is hand-positioned with a pure `place()` function (unit-tested), rendered in a portal, and copies the trigger's `data-theme`, `data-accent` and `data-reduced-motion`.** It opens on hover after 500 ms and at once on keyboard focus (`:focus-visible`), never on touch; Esc, pointer down, blur and scroll close it, and the pointer can move onto it (WCAG 1.4.13). While one tooltip is open or just closed, the next opens without delay and replaces it, like macOS. IconButton's tooltip repeats its name, so it is not wired as `aria-describedby`; the shortcut goes to `aria-keyshortcuts` instead.
- **2026-09-29 — Checkbox completion hook.** Becoming checked (not mounting checked) plays a fill from the rim inward, a small pop and a drawn tick, then fires `onCheckAnimationEnd`, which Phase 3 chains into the strikethrough, "+XP" and slide-out. With reduced motion the fill is instant, the tick fades, and the callback still fires. `--cb-color` recolours one instance (priority).
- **2026-09-29 — Kbd formats specs itself (`ui/Kbd/format.ts`) instead of `lib/keys.formatKeys`.** macOS orders modifiers the Apple way (⇧⌘S, not ⌘⇧S) and uses ↩/⌫; sequences keep their chords apart ("G then T"); screen readers get words ("Command K"), and `ariaKeyShortcuts()` builds `aria-keyshortcuts` values.
- **2026-09-29 — `/design` (Phase 2E) conventions.**
  - Each demo renders in a column that sets its own `data-theme`, `data-accent` and `data-reduced-motion`, so tokens resolve per column; the column is an isolated stacking context so a specimen's `z-index` cannot paint over the sticky bars. Overlays portal to `<body>` but copy those attributes from the trigger, so a modal opened in the dark column is dark.
  - Layout follows viewport width, not container width (container queries apply layout containment, which would change how specimens position): columns side by side from 1120 px (the sidebar takes 240 px), a sticky toolbar and table-of-contents rail from 1440 px, and a one-line sticky "Jump to" bar below that (static on tablets, where the shell's open-sidebar button sits in the corner). The shell opts `/design` out of the 900 px reading width with `data-route` on `pageOuter`.
  - The reduced-motion switch only adds motion reduction. When Settings or the device already asks for it, the switch shows on and is disabled, because `[data-reduced-motion='on']` on `<html>` cannot be undone from a sub-tree.
  - `ToastProvider` sits in `App.tsx` between the shortcuts and the feature providers, so `useToast()` works everywhere. Its region (`role="region"` "Notifications" with a polite and an assertive live region) is rendered on every page; the Toast demo uses `inline` providers, so `/design` has more than one.
  - `src/ui/index.ts` exports components, hooks and public types only. `Popover` and `Tooltip` both export a `Side` type, so they appear as `PopoverSide` and `TooltipSide`; `computePosition`, `place`, and the menu, palette-navigation and ring-math helpers stay behind their folders. Shell code imports `@/ui/<Name>` directly so the main bundle does not pull in the whole barrel.
  - The e2e and smoke horizontal-overflow checks ignore boxes inside their own horizontal scroller (the Tabs list) when the scroller itself ends inside the viewport.
- **2026-09-29 — Design review 2F.** Screenshots of `/design` and the shell at 1440 and 375 in both themes, plus a touch-emulated tap-target audit, compared with BRIEF §3 and §9. The notable fixes:
  - Touch: text fields (Input, like DatePicker already) grow to 44 px on coarse pointers, and so do Tabs, because their list scrolls sideways and would clip an invisible hit area. Icon-only segments become 44 px wide, and interactive tags get a 44 px hit area. On phones, the modal sheet's footer actions are 44 px tall. Buttons keep their dense visuals with invisible 44 px hit areas.
  - Consistency: the DatePicker text inset matches Input (10 / 8 px). Breadcrumb links use the 6 px control radius. CommandPalette and PageHeader use the shared `Skeleton` instead of their own shimmers, so colours, timing and the reduced-motion pulse match. The palette keeps its fade under reduced motion. Every hover style in the builder components (DatePicker chips, Breadcrumbs, PageHeader, sidebar, /design rail) sits behind `@media (hover: hover)`, and raw weights and radii became tokens.
  - Motion: popovers enter from 4 px (`--shift-1`), not 8, a nudge rather than a slide, and the checkbox pop uses `--dur-3`. Dark `--scrim` goes from 0.55 to 0.62, so the page behind a modal or palette recedes more.
  - Conscious exceptions: the always-editable PageHeader title shows a blinking accent caret instead of the 2 px ring (Notion-like; a caret satisfies WCAG 2.4.7). Menu rows draw their ring inset, and the palette's search field has no ring, because the highlighted row is the focus there. Cover gradient presets keep literal colours, because they are content and not theme. The command palette opens in 200 ms rather than the 280 ms modal duration, so it feels instant. The Settings theme `<select>` is still native until P10.
- **2026-09-29 — The Forge mark is "breach": a white upward chevron on a black tile that has just punched through a bar, leaving it split with sheared edges** — breaking through procrastination. Chosen by the user over the designer's pick ("breakout", an F whose middle arm breaks the tile edge) and a bolt concept. Geometric on a 4-unit grid, crisp at 16 px, no accent colour (`--logo-tile/-mark/-ring`). In dark themes a 1 px `--border-strong` ring outlines the tile; `public/favicon.svg` does the same via `prefers-color-scheme`.
