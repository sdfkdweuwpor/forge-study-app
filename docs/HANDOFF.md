# Handoff: where Forge stands (2026-09-30)

The cloud session stopped all its helpers here and pushed everything to `claude/sharp-thompson-tklurt`. Read this,
then `PLAN.md` (the plan and checklist) and `DECISIONS.md` (why things are the way they are), and continue.

## Status at the end of 2026-09-30

Everything below "Done and reviewed" and "In progress" is now finished, apart from the open items here. The final
check passed on this branch: typecheck, lint, 4,249 unit tests, the build (initial JS 178.4 KB gzip), 738/738 e2e
and 14/14 extension e2e, run at `--workers=4` (12 workers plus parallel helpers ran this 13 GB machine out of
memory once; keep runs at 4).

**Open, on purpose** (PLAN.md has the details):
- **5D extras:** +250 XP on course complete, the one-click catch-up on the goal page, the goal page's own timeline,
  and "Now projected … (+N days)".
- **10D:** an empty, loading and error state audit of every screen.
- **12C (optional):** PDFs through Supabase Storage.
- **Mobile Lighthouse** 85–89 on `/`, `/settings`, `/tasks` is accepted (DECISIONS "Performance (Phase 13C)").

**Next:** open the PR into `main` when the user asks. Merging deploys GitHub Pages and publishes the extension
Release.

## Sound (in progress, 2026-10-01)

Spec `docs/superpowers/specs/2026-09-30-sound-design.md`, plan `docs/superpowers/plans/2026-09-30-sound.md` (10 tasks).
Phase 1 is done and reviewed: the noise mixer (9 generated layers, one gain each), the Sound panel on the Focus
page (collapsible Lofi / Sounds / Mixes sections), the mini player (sidebar; on phones a pill while sound plays),
playback from one tab on any page, and the old single ambient control removed. Phases 2 (generated lofi, tasks
7–9) and 3 (saved mixes, start with focus, task 10) are next. Initial JS is 179.2 KB of 180.

## Done and reviewed

- **Phases 0–11** (CI green on the Phase 11 commit `67c8de6`), plus the user's planner, everyday tasks, views,
  templates and export additions.
- **13P performance at a year of data** and **Phase 13 round 1**: the visual audit at 375/768/1440 in light and dark,
  `e2e/keyboard.spec.ts` (a keyboard-only walkthrough of every route), initial JS cut to 177.7 KB gzip, and the
  carry-overs (the level indicator in the collapsed sidebar and on phones, shop rows on touch, My World Fit on phones).
- **GitHub Pages hosting**:
  - The router supports a base path. Never read `window.location.pathname`; use `currentPath()`, `appPath()` or
    `href()` from `@/app/router`.
  - `.github/workflows/pages.yml` and `scripts/pages-postbuild.mjs` (SPA `404.html`, meta CSP).
  - The extension accepts the `sdfkdweuwpor.github.io` origin.
  - The user has set repo Settings → Pages → Source to **GitHub Actions**.
  - The site goes live at https://sdfkdweuwpor.github.io/forge-study-app/ once this branch is merged into `main`.
- **Cloud sync 12B1–12B5**. Each step was built, reviewed and fixed:
  - 12B1: schema v3 and change tracking;
  - 12B2: the pure sync logic;
  - 12B3: the repo engine;
  - 12B4: transport and auth;
  - 12B5: the engine and Settings → Sync.

  The CSP already allows `https://*.supabase.co`, and the magic-link redirect already uses the base path.

## In progress: pick these up

### 1. Sync 12B6: CSP, e2e, README (PLAN §4.7.9, last row)

It was stopped partway. Files exist but are unverified: `e2e/sync.spec.ts`, `e2e/support/fakeSupabase.ts`, and the
README "Sync (optional)" section (`src/features/sync/readme.test.ts` checks that it matches `setupSql.ts`).

Finish it:

- **The two-device e2e** (two browser contexts on one fake server). It must cover:
  - setup validation;
  - sign-in with the 6-digit code;
  - first sync, which leaves a pre-sync snapshot in Settings → Snapshots;
  - an edit on A appears on B, and a delete propagates;
  - offline, then online;
  - the "project paused" message after repeated failures;
  - sign-out keeps the local data;
  - the import and restore dialogs say the change spreads to every device;
  - no XP, level-up or badge toasts for work synced from the other device.
- **The smoke guard.** `e2e/smoke.spec.ts` must check that with sync off the app makes no request to any supabase
  host.
- **The README section.** It should cover the setup steps, the SQL, the two email templates with the 6-digit code,
  the redirect URLs (the Pages one, `https://sdfkdweuwpor.github.io/forge-study-app/settings/sync`, plus localhost),
  turning sign-ups off, the §4.7.6 limitation, and erasing the cloud copy.
- Run `e2e/sync.spec.ts` and `e2e/smoke.spec.ts` with `--repeat-each=3`.

Then run a **final sync review** with three independent lenses: multi-device correctness (divergence, lost edits
outside the documented LWW limitation), security (tokens never reach logs, backups, snapshots, crash exports or the
DOM; PKCE and redirect; key validation; RLS matches §4.7.3), and data safety (the pre-sync and 25-deletion snapshots,
no wipe on any path, the outbox never loses an entry). Fix what they verify. Then tick 12B and Phase 12 in `PLAN.md`.

### 2. Phase 13 round 2 (partial and unreviewed edits are in the tree)

- **Keyboard and a11y defects.** Partly built, not reviewed. It touches `src/app/{UndoHost.tsx,undoProbe.ts}`,
  `src/app/layout/{Shell,TabBar,RouteAnnouncer}.tsx`, `pageKey.ts`, `useBottomBarScrollPadding.ts`, `src/ui/Toast/*`
  (`runUndo.ts`), `builtins.ts`, `StreakFlame.tsx`, `parking/TodayCard.tsx` and several e2e specs. The goals:
  - the phone tab bar never hides the focused element (scroll-padding);
  - the Rewards tabs keep focus;
  - the Progress Tab order matches the visual order;
  - **mod+z** undoes the latest toast's Undo through the same path as its button (not inside inputs, with a palette
    "Undo" and an entry in the "?" sheet);
  - StreakFlame closes the tablet drawer;
  - the parking card's "Press P" hint shows only on hover-capable wide screens.

  Turn each `expectDefect(...)` tracker in `e2e/keyboard.spec.ts` into a normal assertion once its defect is fixed.
  Review it before committing.
- **Mobile performance.** Not started in code. Lighthouse mobile is 47–74 (target ≥ 90), caused by CLS of about 0.2
  from the Today header card and the Tasks list root, plus 300–700 ms of TBT. Desktop `/tasks` is 88–89 (CLS 0.13).
  Measure with `scripts/perf/lighthouse.mjs`. Reclaim about 6 KB of initial JS in `src/db`: `progress.ts` imports
  `badges.ts` (about 3.8 KB). `db.ts` statically imports `migrations/v2` (about 2.5 KB), but a Dexie `upgrade()` must
  never await a dynamic import, so leave that one unless it can stay synchronous. Check the budget with
  `node scripts/perf/initial-js.mjs dist` (≤ 180 KB; aim for ≤ 172 to leave room).
- **Test health.** Not started. The full e2e run must be green before the PR.
  - `e2e/everyday.spec.ts`, "Accept suggested times" command: it does `goto` then presses Ctrl+K at once, and the
    palette never opens. Use `gotoApp`.
  - `e2e/trash.spec.ts:135` fails even on `67c8de6`. At most 3 toasts show at once, so the "forever" toast waits
    behind older Undo toasts. Decide whether that is a test bug or an app bug.
  - `e2e/blocker-extension.spec.ts` has a reproduced failure.
  - Flakes under load, to make deterministic (no sleeps, no retries, no skips): blockeditor typing and the "delayed
    save" test; planner "life happened" and the Plan settings number field (typed `0.515` instead of `0.5`); design
    reduced motion; import; the rewards drag.

### 3. Smaller open items

- **The Length control at 320 px with touch** is 38 px too wide: seven 44 px segments need 324 px. It needs a product
  or TSX change (shorter labels, or a different control on very narrow screens).
- **Board cards:** the grip and … menu float 2 px over a title's second line. Accepted; noted in the 13A report.
- **Missing screenshots:** there is no 768 px viewport in `scripts/shoot.spec.ts`, and there are no screenshots of the
  sync states yet.

## Then finish (13D and delivery)

1. **Final README** (Phase 13D):
   - copy curated screenshots into the committed `docs/screenshots/`;
   - the live Pages URL;
   - PWA install on a phone;
   - extension install from Releases;
   - backup and restore;
   - the WGU import prompt;
   - the optional sync section.
2. Tick every box in `PLAN.md`.
3. Run everything; it must all be green:
   ```
   npm run typecheck
   npm run lint
   npm test -- --run
   npm run build
   npx playwright test --workers=12
   ```
   Also run the extension config: `npm run e2e` runs both.
4. Make one normal commit **without** `[skip ci]`, so CI runs on GitHub, and wait for it to be green.
5. Open the PR into `main` (the user will ask for it). Merging deploys GitHub Pages and publishes the extension
   Release (`forge-extension.zip`), because the manifest changed.

## Conventions (keep them)

- **Commits:**
  - Commit and push after each finished piece.
  - WIP checkpoints use `[skip ci]`.
  - Never put a model name in commits or PRs.
  - Never commit a secret-shaped string (`sb_secret_…`, JWT-looking tokens, private keys). GitHub push protection
    blocks it, and the repo is public. Build fake keys at runtime.
- **Code rules:**
  - Layers: logic → db → ui/lib → features → app (ESLint enforces it).
  - Features never import `@/db/sync/*`.
  - No `any`, no `console.*`.
  - No new dependencies without a DECISIONS entry.
  - No guilt mechanics, and every destructive action has Undo.
- **Tests:**
  - Isolated e2e runs: `E2E_PORT=<port> E2E_OUT=dist-e2e-<port> npx playwright test <specs>`.
  - Seeded data: build with `VITE_ENABLE_SEED=1` and open `?seed=wgu`, `?seed=empty` or `?seed=wgu-year`.
  - No fixed sleeps in tests, and never skip or quarantine a test to get green.
- **Parallel helpers:** give each one its own files and its own port. When helpers run in parallel, review each
  piece before committing it.
