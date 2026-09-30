# Forge — Execution Plan

> `BRIEF.md` is the source of truth. This file covers **how** we build it. `DECISIONS.md` explains the reasons behind non-obvious choices.
> Branch: `claude/sharp-thompson-tklurt` · Deploy: **Netlify** (`https://forge-study-app.netlify.app`, single constant `APP_ORIGIN`).
> Extension ID (stable, from the manifest `key`): **`gpinhblnpebjbiodblihfpjbffacipbd`**.

---

## 1. Architecture overview

### 1.1 Layers (imports flow downward only; enforced by ESLint `no-restricted-imports`)

```
app/        shell: router, registries, layout, providers, palette, shortcuts, boot
  ↓ (only via import.meta.glob of features/*/feature.ts)
features/   one folder per feature: pages, feature components, queries, manifest
  ↓
ui/         design-system components (no data access)      lib/  browser helpers (audio, notify, download, keys)
  ↓                                                          ↓
db/         Dexie schema, types, repos (writes), hooks (reads), domain events
  ↓
logic/      PURE functions: no React, Dexie, DOM or Date.now(); time is injected; Vitest-tested
```

| Layer | May import | Must not import |
|---|---|---|
| `src/logic/**` | `date-fns`, `zod`, `import type` from `@/db/types`, `@ext/*` (pure shared) | react, dexie, `@/db/*` (except types), `@/app`, `@/features`, `@/ui`, `@/lib`, `window`/`document`/`localStorage`, `Date.now()`, `new Date()` with no args |
| `src/db/**` | dexie, `@/logic`, `@/lib/ids` | `@/app`, `@/features`, `@/ui`; React only in `src/db/hooks/**` |
| `src/ui/**` | react, lucide-react, @dnd-kit, `@/lib`, `@/logic` (tagColor, blocks) | `@/db`, `@/features`, `@/app` |
| `src/features/<f>/**` | `@/ui`, `@/db/types`, `@/db/repos/*`, `@/db/hooks/*`, `@/logic`, `@/lib`, `@/app/registry` + router API, **other features only via `@/features/<x>` (their `index.ts`)** | deep imports into other features (`@/features/*/*`); `@/db/db` except in `queries.ts` files |
| `src/app/**` | everything above | direct feature imports (use the registry) |

### 1.2 State
- **Dexie is the store.** Reads go through `useLiveQuery` (dexie-react-hooks), wrapped in typed hooks: shared ones in `src/db/hooks/`, feature-specific ones in `src/features/<f>/queries.ts`. There is no Redux or Zustand and no duplicated in-memory copies.
- **Writes only go through repo functions** in `src/db/repos/*.ts`. Components never call `db.x.put` directly. Repos run multi-table changes in one `db.transaction`. For reversible actions they return an `undo()` so the UI can pass it to a Toast.
- **Domain events** (`src/db/events.ts`): after a transaction commits, repos `emit()` events such as `task.completed`, `task.uncompleted`, `session.ended`, `milestone.completed`, `goal.changed` and `day.started`. Features subscribe through `domainHandlers` in their manifest to keep derived data in sync (streakDays, badges, daily-goal XP). Handlers are idempotent and never throw (errors are caught and reported). Derived data can always be rebuilt from history in `onAppStart`.
- **React contexts hold UI state only**: `ThemeProvider` (applies `data-theme`/`data-accent`/`data-reduced-motion`), `ToastProvider` (queue plus Undo), `OverlayProvider` (palette, quick add, shortcut sheet, full-screen focus), `ShortcutProvider` (scope stack) and `TimerProvider` (from the focus feature: ticking view of the running session). Device-local UI prefs such as sidebar width/collapsed and the last tasks layout live in `localStorage` via `src/lib/localPrefs.ts` (every access wrapped in try/catch).
- **Time:** `useNow(granularity)` / `useToday()` in `src/app/hooks/` re-render at minute or midnight boundaries. The logic layer always receives `now: number` or `today: ISODate` as arguments.

### 1.3 Timer survives refresh
- A running focus **or break** is a `sessions` row with `status: 'running' | 'paused'`, `startedAt`, `pausedMs` and `pausedAt`. There is never a counter. `remaining = planned − (now − startedAt − pausedMs − (pausedAt ? now − pausedAt : 0))`, computed by the pure `logic/timer.ts`.
- On load, `sessions.reconcileRunning(now)` does one of two things. If the planned end has passed while the tab was closed, it finishes the session at `startedAt + planned + pausedMs` (counted if ≥80%) and queues the "Done with this task?" dialog. Otherwise `TimerProvider` resumes the display.
- Ticks come from a tiny module Web Worker (`features/focus/timerWorker.ts`, 250 ms). Workers aren't throttled like hidden-tab main-thread timers. Every tick recomputes from timestamps. Phase end triggers the chime, a Notification and the next pomodoro phase (a `kind: 'break'` session row, so the whole cycle survives refresh). Only one row may be `running|paused` at a time; the repo enforces this.

### 1.4 App ↔ extension messaging
- Shared, dependency-free protocol: `extension/src/shared/protocol.ts` (message types, `PROTOCOL_VERSION`, guards) and `extension/src/shared/config.ts` (`APP_ORIGIN`, `APP_URL`, `DEFAULT_EXTENSION_ID`, `EXTENSION_ZIP_URL`). The app imports both via the `@ext/*` alias, and `src/config.ts` re-exports them.
- App side (`features/blocker/bridge.ts`): `chrome.runtime.sendMessage(extensionId, msg, cb)` with a 1.5 s timeout. The ID is `settings.blocker.extensionIdOverride ?? DEFAULT_EXTENSION_ID`. If `window.chrome?.runtime?.sendMessage` doesn't exist, the extension isn't installed or the origin doesn't match.
- Messages (all carry `v: 1`):
  - `ping` → `{ok, version}`
  - `sync` (full config: blocklist, allowlist, mode, schedule windows, motivation lines)
  - `session` (`{active, endsAt, taskTitle} | null`, sent on every start/pause/resume/end)
  - `getEvents {since}` → `{events: BlockEvent[], cursor}`
- A `BlockerSync` provider watches the active session and the blocker settings/blocklist through liveQuery and pushes changes. That makes it decoupled from the focus feature. On app start, on `visibilitychange` and every 60 s it pulls events and `bulkPut`s them into `blockEvents`. Event ids come from the extension, so this is idempotent.
- The extension keeps everything in `chrome.storage.local`, so blocking works with the app closed. The service worker rebuilds DNR dynamic rules on config/session/unlock change and at schedule boundaries (`chrome.alarms`). `onMessageExternal` checks `sender.url` against the allowed origins.
- `externally_connectable.matches`: `https://forge-study-app.netlify.app/*`, `http://localhost/*`, `http://127.0.0.1/*`. Netlify deploy previews won't match, and the Blocker page says so.

### 1.5 Plug-in shell (so parallel builders rarely touch shared files)
- `src/app/router/routes.ts` holds the **complete typed route table for all phases**, written in Phase 1. Features never edit it.
- Each feature has `src/features/<f>/feature.ts` exporting a `FeatureManifest`. The shell auto-discovers them with `import.meta.glob('../../features/*/feature.ts', { eager: true })`. Pages are `React.lazy`, so each route gets its own chunk.
- A route without a registered page renders `<Placeholder phase={n}/>`. A registry test fails on duplicate route owners, command ids or shortcut keys within a scope.
- **Slots** let a feature add UI to another feature's page without editing it. For example, flashcards adds a panel to the course page, blocker adds a section to Progress, and each feature adds its own Settings section.

```ts
// src/app/registry/types.ts (Phase 1 contract)
export interface FeatureManifest {
  id: string;                                         // = folder name
  routes?: Partial<Record<RouteName, LazyExoticComponent<ComponentType>>>;
  commands?: CommandDef[];                            // command palette actions
  shortcuts?: ShortcutDef[];                          // listed automatically in the "?" sheet
  search?: SearchProvider[];                          // palette search (tasks, goals, courses…)
  slots?: SlotContribution[];
  providers?: { order: number; component: ComponentType<{ children: ReactNode }> }[];
  domainHandlers?: DomainHandler[];
  onAppStart?: (ctx: { now: number; today: ISODate }) => Promise<void>; // on load + midnight rollover
}
export interface CommandDef { id: string; title: string; group: CommandGroup; icon?: LucideIcon;
  keywords?: string[]; shortcutId?: string; when?: (c: CommandCtx) => boolean; run: (c: CommandCtx) => void | Promise<void> }
export interface ShortcutDef { id: string; keys: string /* 'mod+k' | 'q' | 'g t' | 'shift+s' | '?' */;
  description: string; group: string; scope: 'global' | ScopeId; allowInInputs?: boolean; run?: (c: CommandCtx) => void }
// Component-bound behaviour: useShortcutHandler('tasks.complete', fn) + useShortcutScope('tasks')
export interface SearchProvider { id: string; group: string; search(q: string, limit: number): Promise<SearchResult[]> }
export interface SlotContribution<S extends SlotId = SlotId> { slot: S; id: string; order: number; component: ComponentType<SlotProps[S]> }
```

**Slot ids (fixed in Phase 1, `sidebar.rail` and `more.footer` added in Phase 13; props in parentheses):** `sidebar.footer`, `sidebar.rail`, `more.footer`, `sidebar.timer`, `sidebar.nav.tasks`, `sidebar.nav.goals`, `shell.rightPanel`, `global.overlays`, `today.header`, `today.now`, `today.main`, `today.aside`, `focus.aside`, `focus.afterSession ({sessionId})`, `goal.header ({goalId})`, `goal.panels ({goalId})`, `course.panels ({goalId, courseId})`, `progress.sections`, `rewards.tabs`, `blocker.sections`, `settings.sections`.

**ScopeIds:** `today`, `tasks`, `calendar`, `focus`, `fullscreen`, `goal`, `course`, `review`, `cards`, `modal`, `palette`, `drawer`. When an overlay opens it pushes a scope, and the top scope wins. The overlay scopes (`modal`, `palette`, `fullscreen`, `drawer`) are **blocking**: while one is on top, only its own shortcuts, scopes pushed above it and `global` shortcuts with `allowInOverlays` (`esc`, `mod+k`) fire, so page keys never leak through and Esc closes the overlay before the page. Shortcuts are ignored in inputs, textareas and contentEditable unless `allowInInputs` is set.

---

## 2. File tree

```
/
├─ BRIEF.md  PLAN.md  DECISIONS.md  README.md
├─ package.json  package-lock.json  .nvmrc(22)  .gitignore  .prettierrc
├─ index.html                     # loads /theme-init.js (sync, no inline script → strict CSP)
├─ netlify.toml                   # build, SPA rewrite, cache headers
├─ security-headers.mjs           # single source for CSP etc. → dist/_headers + vite preview headers
├─ vite.config.ts  vitest.config.ts  eslint.config.js
├─ tsconfig.json (refs)  tsconfig.app.json  tsconfig.node.json
├─ playwright.config.ts           # e2e (webServer: build + preview :4173)
├─ playwright.shoot.config.ts     # screenshots (npm run shoot)
├─ public/  theme-init.js  favicon.svg  icons/(pwa-192.png, pwa-512.png, maskable-512.png)
├─ .github/workflows/
│   ├─ ci.yml                     # push/PR: typecheck, lint, test, build
│   ├─ deploy.yml                 # push to main → netlify-cli deploy --prod (skips if secrets missing)
│   └─ extension-release.yml      # push to main (extension/**) + dispatch → forge-extension.zip Release
├─ scripts/
│   ├─ shoot.spec.ts              # screenshot runner (light/dark × 1440/375; 768 in P13)
│   ├─ shots/<feature>.ts         # per-feature shot lists (auto-discovered; no shared edits)
│   ├─ build-extension.mjs        # tsc output + static files + Inter woff2 + tokens.css → extension/dist
│   ├─ extension-id.mjs           # prints ID derived from manifest key (sanity check)
│   └─ icons.mjs                  # rasterises public/favicon.svg → PWA PNGs with Playwright
├─ e2e/  fixtures.ts (seed + clock)  smoke.spec.ts  tasks.spec.ts  focus.spec.ts  goals.spec.ts …
├─ extension/
│   ├─ manifest.json  tsconfig.json
│   ├─ pages/ blocked.html blocked.css popup.html popup.css
│   ├─ icons/
│   └─ src/ sw.ts  rules.ts  storage.ts  alarms.ts  blocked.ts  popup.ts
│       └─ shared/ protocol.ts  config.ts  domains.ts  schedule.ts  (+ *.test.ts; pure, imported by app via @ext)
└─ src/
   ├─ main.tsx                    # font + css imports, ?seed handling, createRoot
   ├─ config.ts                   # re-exports @ext/config (APP_ORIGIN, DEFAULT_EXTENSION_ID…)
   ├─ vite-env.d.ts
   ├─ app/
   │   ├─ App.tsx  ErrorBoundary.tsx  boot.ts  NotFound.tsx  Placeholder.tsx
   │   ├─ router/ routes.ts  match.ts(+test)  location.ts  router.tsx (RouterProvider, Link, navigate, href, useRoute, useQuery)
   │   ├─ registry/ types.ts  slots.ts  index.ts  Slot.tsx  registry.test.ts
   │   ├─ shortcuts/ ShortcutProvider.tsx  ShortcutSheet.tsx  useShortcut.ts
   │   ├─ palette/ CommandPalette.tsx  paletteModel.ts
   │   ├─ layout/ Shell.tsx  Sidebar.tsx  SidebarNav.tsx  nav.ts  TabBar.tsx  MoreSheet.tsx  Drawer.tsx  RightPanel.tsx (+ .module.css)
   │   ├─ providers/ ThemeProvider.tsx  OverlayProvider.tsx
   │   └─ hooks/ useNow.ts  useToday.ts  useMediaQuery.ts
   ├─ db/
   │   ├─ types.ts  schema.ts  db.ts  defaults.ts  events.ts  db.test.ts
   │   ├─ migrations/ README.md (how to add vN)  v2.ts  v3.ts (sync, §4.7.4)
   │   ├─ sync/ tracking.ts stamp.ts remoteApply.ts   # P12: outbox middleware (§4.7.4), always installed, pass-through when off
   │   ├─ repos/ settings tasks xp trash sessions goals rewards badges progress blocker backup snapshots
   │   │         flashcards resources files checkins assessments parking rituals reviews templates views .ts
   │   └─ hooks/ useSettings useTasks useGoals useActiveSession useXp useStreak .ts
   ├─ logic/                      # pure + *.test.ts beside each
   │   ├─ dates.ts  fuzzy.ts  quickAdd.ts  recurrence.ts  taskQuery.ts  today.ts  tagColor.ts  blocks.ts
   │   ├─ timer.ts  xp.ts  badges.ts  streaks.ts  stats.ts  insights.ts  readiness.ts
   │   ├─ scheduler/ types.ts estimates.ts topo.ts capacity.ts schedule.ts catchUp.ts diff.ts index.ts fixtures.ts scheduler.test.ts diff.test.ts
   │   ├─ planImport/ schema.ts parse.ts jsonPositions.ts (+ tests)
   │   ├─ backup.ts  retention.ts  sm2.ts  cardImport.ts  ics.ts
   │   └─ world/ prng.ts layout.ts (+ tests)
   ├─ ui/                         # one folder per component: X.tsx X.module.css index.ts
   │   ├─ Button IconButton Input Textarea Checkbox Tag Kbd Tooltip Toggle SegmentedControl Tabs
   │   ├─ ProgressBar ProgressRing Skeleton EmptyState Popover Dropdown Modal Toast DatePicker
   │   ├─ CommandPalette(presentational) Breadcrumbs PageHeader(icon+cover+title) BlockEditor
   │   ├─ charts/ (P7: BarChart Heatmap Histogram Sparkline)
   │   └─ index.ts
   ├─ styles/ tokens.css  tags.css  accents.css  reset.css  global.css  typography.css  motion.css  contrast.test.ts
   ├─ lib/ ids.ts keys.ts localPrefs.ts download.ts clipboard.ts notify.ts fullscreen.ts platform.ts events.ts audio/(context noise chime).ts
   ├─ data/sample/ wguBsCs.ts  starterTasks.ts        # realistic WGU data (C182, C172, C779, D278, C959, C867, C949)
   ├─ dev/seed.ts                                      # lazy; ?seed=wgu|empty
   └─ features/
       ├─ design/ feature.ts DesignPage.tsx sections/*.demo.tsx (glob-discovered)
       ├─ today/ tasks/ quickadd/ focus/ goals/ gamification/ progress/ world/ blocker/
       ├─ settings/ onboarding/ parking/ checkins/ safety/ flashcards/ readiness/ resources/
       └─ rituals/ calendar/ templates/ sync/(P12)
           each: feature.ts  index.ts (public API)  queries.ts  *.tsx  *.module.css
```

---

## 3. Data model (Dexie, DB name `forge`, schema **v1 = complete**)

### 3.1 Conventions
- `id: string` (`crypto.randomUUID()` via `lib/ids.ts`), except where a natural key is better: `settings.id='app'`, `streakDays.id=ISODate`, `badges.id=BadgeId`, `weeklyReviews.id=weekStart`, `rituals.id='${kind}:${day}'`, `blockEvents.id` = the extension's uuid.
- `createdAt`/`updatedAt` are epoch ms. Dexie `creating` and `updating` hooks in `db.ts` fill them when missing, so restore and trash-restore keep the original values.
- **Calendar days are `ISODate` strings (`'YYYY-MM-DD'`, local)**. Instants are epoch ms. Never use `new Date('YYYY-MM-DD')` because it parses as UTC. Use `logic/dates.ts` (date-fns `parseISO`/`format`).
- IndexedDB can't index `null`, `undefined` or booleans. Nullable fields such as `dueDate` simply drop out of the index. Booleans are filtered in JS; don't index them.

### 3.2 TypeScript interfaces (`src/db/types.ts`, type-only)

```ts
export type ID = string; export type ISODate = string; export type HHmm = string; export type Millis = number;
export interface Base { id: ID; createdAt: Millis; updatedAt: Millis }
export type Priority = 0 | 1 | 2 | 3 | 4;                         // none, low, med, high, urgent
export type TagColor = 'gray'|'brown'|'orange'|'yellow'|'green'|'blue'|'purple'|'pink'|'red';
export type AccentId = 'blue'|'teal'|'green'|'orange'|'pink'|'graphite';
export interface DateRange { start: ISODate; end: ISODate; label?: string }   // inclusive
export interface Block { id: ID; type: 'p'|'h1'|'h2'|'h3'|'bullet'|'todo'|'callout'|'divider'; text: string; checked?: boolean; emoji?: string }
export type Cover = { kind: 'gradient'; preset: string } | { kind: 'image'; fileId: ID; posY: number };
export interface Subtask { id: ID; title: string; done: boolean }
export interface RecurrenceRule { freq: 'daily'|'weekdays'|'weekly'|'custom'; interval: number; byWeekday: number[] } // 0=Sun

export interface Task extends Base {
  title: string; notes: Block[]; status: 'todo'|'doing'|'done'; priority: Priority;
  dueDate: ISODate | null; dueTime: HHmm | null;
  estimatePomodoros: number | null; estimateMinutes: number | null;     // scheduler chunks set both
  tags: string[];
  goalId: ID | null; milestoneId: ID | null; unitId: ID | null;
  source: 'user'|'schedule'|'flashcards'|'ritual'|'template'|'onboarding';
  scheduleKey: string | null; schedulePinned: boolean; skippedOn: ISODate | null; orderInDay: number;
  subtasks: Subtask[]; recurrence: RecurrenceRule | null; seriesId: ID | null;
  order: number; boardOrder: number;                                     // fractional indexing
  startedAt: Millis | null; completedAt: Millis | null; completedDay: ISODate | null;
}
export interface Availability { minutesByWeekday: [number, number, number, number, number, number, number]; daysOff: DateRange[] }
export interface WguTerm { id: ID; label: string; start: ISODate; end: ISODate }
export interface GoalProjection { end: ISODate | null; slipDays: number | null; feasible: boolean;
  catchUpMinutes: number | null; requiredMinutesPerStudyDay: number | null; issues: string[]; computedAt: Millis }
export interface Goal extends Base {
  title: string; icon: string; cover: Cover | null; kind: 'degree'|'certification'|'skill'|'custom';
  status: 'active'|'paused'|'done'|'archived'; startDate: ISODate; targetDate: ISODate | null;
  availability: Availability; terms: WguTerm[]; notes: Block[]; order: number;
  baselineEnd: ISODate | null; projection: GoalProjection | null;       // cache written by rebalanceGoal
  lastRebalancedOn: ISODate | null; completedAt: Millis | null;
}
export interface Milestone extends Base {                                // "course"
  goalId: ID; kind: 'course'|'milestone'; code: string | null; title: string; icon: string | null; cover: Cover | null;
  status: 'todo'|'active'|'done'; order: number; prerequisiteIds: ID[]; estimateHours: number; dueDate: ISODate | null;
  cus: number | null; courseType: 'OA'|'PA'|'OA+PA' | null; termId: ID | null; notes: Block[];
  projectedStart: ISODate | null; projectedEnd: ISODate | null; completedAt: Millis | null;
}
export interface Unit extends Base { goalId: ID; milestoneId: ID; title: string; order: number;
  estimateMinutes: number | null; difficulty: 1 | 2 | 3; status: 'todo'|'done'; completedAt: Millis | null }
export interface Session extends Base {
  kind: 'focus'|'break'; mode: 'pomodoro'|'custom'|'stopwatch'; status: 'running'|'paused'|'completed'|'abandoned';
  taskId: ID | null; goalId: ID | null; milestoneId: ID | null;           // denormalised at start
  day: ISODate; startedAt: Millis; endedAt: Millis | null; plannedMinutes: number | null; // null = stopwatch
  pausedMs: number; pausedAt: Millis | null; actualMinutes: number | null;
  round: number; interrupted: boolean; counted: boolean; note: string | null;
}
export interface StreakDay extends Base { /* id = day */ day: ISODate; focusMinutes: number; focusSessions: number;
  pomodoros: number; tasksDone: number; dailyGoalTarget: number; dailyGoalHit: boolean; qualified: boolean; xp: number }
export type XpSource = 'task'|'session'|'course'|'dailyGoal'|'streak'|'ritual'|'adjustment';
export interface XpEvent extends Base { at: Millis; day: ISODate; source: XpSource; amount: number; // negative = reversal
  key: string; refId: ID | null; note: string | null }                  // key e.g. 'task:<id>', 'dailyGoal:<day>'
export type BadgeId = 'first-focus'|'early-bird'|'night-owl'|'streak-7'|'streak-30'|'streak-100'|'deep-work'
  |'first-course'|'term-complete'|'hours-100'|'comeback';
export interface Badge extends Base { /* id = BadgeId */ unlockedAt: Millis; context: string | null }
export interface Reward extends Base { title: string; icon: string; price: number; description: string; archived: boolean; order: number }
export interface Redemption extends Base { rewardId: ID; rewardTitle: string; price: number; at: Millis; day: ISODate; refundedAt: Millis | null }
export interface BlocklistEntry extends Base { kind: 'block'|'allow'; domain: string; pattern: string | null; // allow: 'youtube.com/watch?v=…' or path prefix
  enabled: boolean; isDefault: boolean; note: string | null }
export interface BlockEvent extends Base { at: Millis; day: ISODate; kind: 'attempt'|'unlock'; domain: string; minutes: number | null }
export interface ParkingItem extends Base { text: string; sessionId: ID | null; status: 'open'|'done'|'converted'; taskId: ID | null }
export interface CheckIn extends Base { sessionId: ID | null; at: Millis; day: ISODate; hour: number; weekday: number; focus: 1|2|3|4|5; mood: string | null }
export interface Assessment extends Base { goalId: ID; milestoneId: ID; kind: 'preassessment'|'oa'|'pa'; date: ISODate;
  scorePct: number | null; passed: boolean | null; areas: { name: string; scorePct: number }[]; notes: string }
export interface Flashcard extends Base { goalId: ID; milestoneId: ID; front: string; back: string; tags: string[];
  ease: number; intervalDays: number; repetitions: number; lapses: number; dueDate: ISODate; lastReviewedAt: Millis | null; suspended: boolean }
export interface Resource extends Base { goalId: ID; milestoneId: ID; kind: 'link'|'pdf'|'note'; title: string;
  url: string | null; fileId: ID | null; status: 'toRead'|'done'; notes: string; order: number }
export interface StoredFile extends Base { name: string; mime: string; size: number; blob: Blob }
export interface Snapshot extends Base { day: ISODate; reason: 'daily'|'manual'|'pre-import'|'pre-restore'|'pre-reset';
  schemaVersion: number; sizeBytes: number; data: string }              // JSON of BackupFile (files excluded)
export interface TrashItem extends Base { entityTable: TableName; entityId: ID; title: string; expiresAt: Millis;
  payload: Partial<Record<TableName, unknown[]>> }                       // the entity + cascaded children
export interface WorldTile extends Base { x: number; y: number; kind: string; variant: number; sourceKind: string; sourceId: ID; earnedAt: Millis } // optional cache
export interface SavedView extends Base { name: string; icon: string; layout: 'list'|'board'|'calendar';
  filter: TaskFilter; sort: TaskSort; groupBy: 'date'|'project'|'none'; order: number }   // TaskFilter/TaskSort from logic/taskQuery (type-only)
export interface Ritual extends Base { /* id = kind:day */ day: ISODate; kind: 'morning'|'evening'; top3: ID[]; reflection: string; completedAt: Millis | null }
export interface WeeklyReview extends Base { /* id = weekStart */ weekStart: ISODate; wins: string; blockers: string; completedAt: Millis | null }
export interface Template extends Base { kind: 'task'|'goal'; name: string; icon: string; payload: unknown /* validated by zod on use */ }
export interface BlockWindow { days: number[]; start: HHmm; end: HHmm }
export interface Settings extends Base {                                // singleton, id = 'app'
  profile: { name: string }; onboardedAt: Millis | null;
  appearance: { theme: 'light'|'dark'|'system'; accent: AccentId; reducedMotion: 'system'|'on'|'off' };
  weekStartsOn: 0 | 1;
  timer: { pomodoroMin: number; shortBreakMin: number; longBreakMin: number; longBreakEvery: number; customMin: number; autoStartBreaks: boolean; autoStartFocus: boolean };
  dailyGoalPomodoros: number;
  sound: { enabled: boolean; volume: number; chime: boolean; ambient: 'none'|'brown'|'rain'|'cafe'; ambientVolume: number };
  notifications: { enabled: boolean; promptedAt: Millis | null };
  blocker: { mode: 'focus'|'schedule'|'always'|'off'; schedule: BlockWindow[]; motivation: string[];
             extensionIdOverride: string | null; lastSyncedAt: Millis | null; eventsCursor: Millis };
  scheduling: { globalDaysOff: DateRange[]; defaultStudyStart: HHmm; bestHour: number | null; lastDailyRunDay: ISODate | null };
  backup: { lastExportAt: Millis | null; remindWeekly: boolean };
  tagColors: Record<string, TagColor>; lastCelebratedLevel: number;
  sync: { enabled: boolean; url: string | null; anonKey: string | null; lastSyncAt: Millis | null }; // removed in v3: moved to the device-local `syncState` table (§4.7.4)
}
```
Defaults live in `src/db/defaults.ts`: 25/5/15 every 4, custom 50, daily goal 6, weekStartsOn 1, theme `system`, accent `blue`, the default blocklist from brief §5.8, and 5 sample motivation lines. `repos/settings.ensureSettings()` creates the row on first open.

### 3.3 Indexes (`src/db/schema.ts`)

```ts
export const SCHEMA_VERSION = 1;
export const STORES_V1 = {
  settings: 'id',
  tasks: 'id, status, dueDate, completedDay, goalId, milestoneId, unitId, scheduleKey, seriesId, *tags, [status+dueDate], [goalId+status]',
  goals: 'id, status, order',
  milestones: 'id, goalId, status, code, termId, [goalId+order]',
  units: 'id, goalId, milestoneId, [milestoneId+order]',
  sessions: 'id, status, day, startedAt, taskId, goalId, milestoneId, [kind+day]',
  streakDays: 'id',
  xpEvents: 'id, at, day, source, key',
  badges: 'id, unlockedAt',
  rewards: 'id, order',
  redemptions: 'id, at, rewardId',
  blocklist: 'id, domain, kind',
  blockEvents: 'id, at, day, kind, domain',
  parkingLot: 'id, status, sessionId, createdAt',
  checkIns: 'id, sessionId, day',
  assessments: 'id, goalId, milestoneId, [milestoneId+kind]',
  flashcards: 'id, goalId, milestoneId, dueDate, [milestoneId+dueDate]',
  resources: 'id, goalId, milestoneId, status',
  files: 'id',
  snapshots: 'id, day, createdAt, reason',
  trash: 'id, expiresAt, entityTable, createdAt',
  worldTiles: 'id, sourceId',
  savedViews: 'id, order',
  rituals: 'id, day, kind',
  weeklyReviews: 'id',
  templates: 'id, kind',
} as const;
export type TableName = keyof typeof STORES_V1;
```

**Relationships:** Goal 1–n Milestone 1–n Unit. Tasks link to goal, milestone and unit (nullable). Sessions link to task, goal and milestone. Assessments, flashcards and resources link to milestone and goal. Resource links to a file. Redemption links to a reward. CheckIn and ParkingItem link to a session. Deleting a goal cascades to its milestones, units, goal tasks, assessments, flashcards, resources and files, all in **one** trash entry.

### 3.4 Migrations
- **v2 (planner) is §4.6, applied in 5G** (`migrations/v2.ts`; the recipe and version table are in `migrations/README.md`).
- **v3 (cloud sync) is §4.7.4, applied in 12B1** (`migrations/v3.ts`: `syncOutbox`, `syncState`, `settings.sync` removed).
- `db.version(1).stores(STORES_V1)`. **Never edit a released version string.** To add a v2, create `src/db/migrations/v2.ts` exporting `STORES_V2_DELTA` (only the changed tables, with `null` to drop one) and `upgradeV2(tx)`. Then add `db.version(2).stores(STORES_V2_DELTA).upgrade(upgradeV2)` in `db.ts`, bump `SCHEMA_VERSION`, and add `migrateBackupV1toV2()` in `logic/backup.ts` so old backup files and snapshots still import.
- Every migration needs a fake-indexeddb test that opens a v(N−1) DB seeded with a fixture, reopens it at vN, and asserts the upgraded rows.

### 3.5 Trash, undo, snapshots
- **Trash means moving the row, not a soft-delete flag.** `repos/trash.moveToTrash(table, id)` gathers the entity and its cascade, writes one `TrashItem` (`expiresAt = now + 30 d`) and deletes the originals, all in one transaction. `restoreFromTrash(id)` does `bulkPut`s back with ids and timestamps preserved. Queries never need to filter deleted rows. `purgeExpired(now)` runs in `onAppStart`. XP events are never trashed.
- **Undo:** repos return `undo()`. For delete it is restore-from-trash. For complete it is uncomplete plus an XP reversal event. For move it is the previous values.
- **Snapshots:** `onAppStart` writes a `daily` snapshot if none exists for today. Retention (`logic/retention.ts`) keeps the 7 newest `daily` snapshots and the 3 newest of the other reasons. Snapshots store the `BackupFile` JSON without file blobs. Restore validates, migrates, writes a `pre-restore` snapshot, then clears and `bulkPut`s all tables in one transaction.
- **Backup file** (`logic/backup.ts`): `{ app: 'forge', format: 1, schemaVersion, exportedAt, tables: Record<TableName, unknown[]> }`. Files are included as base64 only when "Include PDFs" is checked. It is Zod-validated on import.

### 3.6 XP, levels, streaks (derived; never stored as counters)
- **XP amounts** (`logic/xp.ts`):
  - Task: `10 + 5×estimatePomodoros + (high 5 | urgent 10)`.
  - Session: 1 XP per focused minute, **only if counted**. Counted means `actual ≥ 0.8×planned`, or ≥10 min for stopwatch.
  - Course 250. Daily goal 25, once per day. Streak 7/30/100 gives 100/500/2000, once per streak run. Evening shutdown 10.
- Awards are idempotent by `key`: the repo skips if the net sum for that key is already > 0. Undo appends a **negative** event with the same key.
- `lifetimeXp = Σ amount`, `spentXp = Σ redemptions.price where refundedAt = null`, `balance = lifetime − spent`.
- **Levels:** you start at level 1. Advancing from level n to n+1 costs `round(100·n^1.5)` (L1→2: 100, L7→8: 1852), which matches the brief's "Level 7 … /1,800 XP". `levelFromXp(total) → {level, into, cost, progress}`.
- **streakDays** is a rebuildable daily aggregate. It is updated by domain handlers and rebuilt from sessions and tasks by `progress.rebuildDays(from)`. `dailyGoalTarget` is snapshotted per day. `qualified = focusSessions ≥ 1 || dailyGoalHit`.
- **Streak freeze:** the freeze is computed by `logic/streaks.ts`, not stored. It allows at most one auto-freeze per week (by `weekStartsOn`), applied to a single missed day. A frozen day doesn't add to the count but doesn't break it. Today not yet qualified doesn't break the streak.

---

## 4. Scheduler & rebalancing (`src/logic/scheduler/`, architect-owned)

### 4.1 Contract
```ts
export interface SchedUnit { id: string; title: string; order: number; remainingMinutes: number; chunkSeqStart: number }
export interface SchedCourse { id: string; code: string | null; title: string; order: number;
  status: 'todo'|'active'|'done'; prerequisiteIds: string[]; units: SchedUnit[] }
export interface ScheduleInput {
  today: ISODate; startDate?: ISODate;          // default today; wizard may pass a future goal.startDate
  targetDate: ISODate | null; baselineEnd: ISODate | null;
  courses: SchedCourse[]; availability: Availability;   // goal availability + global days off merged by caller
  reservedMinutes: Record<ISODate, number>;     // pinned tasks + today's done/skipped goal minutes
  options?: Partial<{ minChunk: number; maxChunk: number; grain: number; horizonDays: number; maxCatchUp: number }>;
}                                               // defaults 25, 90, 5, 1095, 240
export interface PlannedChunk { key: string /* `${unitId}:${seq}` */; date: ISODate; minutes: number;
  courseId: string; unitId: string; seq: number; seqTotal: number; title: string; orderInDay: number }
export type SchedulerIssue = { code: 'PREREQ_CYCLE'; courseIds: string[] } | { code: 'UNKNOWN_PREREQ'; courseId: string; prerequisiteId: string }
  | { code: 'NO_AVAILABILITY' } | { code: 'HORIZON_EXCEEDED'; unscheduledMinutes: number } | { code: 'TARGET_IN_PAST' };
export interface ScheduleResult { chunks: PlannedChunk[]; windows: { courseId: string; start: ISODate; end: ISODate; minutes: number }[];
  totalMinutes: number; projectedEnd: ISODate | null; slipDays: number | null; feasible: boolean; issues: SchedulerIssue[] }
export interface CatchUp { extraMinutesPerStudyDay: number | null; requiredMinutesPerStudyDay: number | null;
  studyDaysLeft: number; suggestedTargetDate: ISODate | null }

buildSchedule(input): ScheduleResult
suggestCatchUp(input, result): CatchUp | null       // only when targetDate set and not feasible
resolveUnitEstimates(course, units): number[]      // units without estimates share the course's leftover hours equally
computeRemaining(units, doneTasks, pinnedTasks): Map<unitId, {remainingMinutes, chunkSeqStart}>
diffSchedule(existingOpenTasks, chunks): { insert: PlannedChunk[]; update: {id, date, minutes, title, orderInDay}[]; remove: ID[] }
```

**As built (5A), additions to the contract above** (import everything from `@/logic/scheduler`; the repo side is `rebalanceGoal`/`computeRemaining` in `@/db/repos/goals`):
- `SchedUnit.usedSeqs?` (chunk numbers held by done/pinned chunks; new chunks take the smallest free ones) and `SchedUnit.deferredMinutes?` (skipped today: may not land on `today`).
- `ScheduleInput.pinned?: {date, minutes, courseId}[]`: pinned work consumes its day and counts toward `projectedEnd` and the course window. `reservedMinutes` holds only today's done/skipped minutes.
- `diffSchedule(goalScheduledTasks, chunks, {today, pinnedIds?})` → `{ insert, update: {id, chunk, changes}[], remove, trash, keep }`. `trash` = unneeded chunks carrying user content (detached, then trashed); `keep` = done tasks and active pins.
- `suggestCatchUp(input, result?)` measures against `targetDate ?? baselineEnd` (the same reference as `slipDays`).
- `projectedEnd` is `null` when `NO_AVAILABILITY` or `HORIZON_EXCEEDED`.
- `planGoal(rows, today)` (rows → input, result, catchUp, diff, projection, courseDates, work) and `goalWork(rows)` compose the pieces; the wizard preview can call `planGoal` with draft rows and no tasks.

### 4.2 Algorithm (deterministic, pure)
1. **Prepare.**
   - If every `minutesByWeekday` is ≤ 0: return `NO_AVAILABILITY`, with no chunks and not feasible (unless nothing remains).
   - Set `minEff = min(minChunk, max weekday minutes)`, so 20 min/day availability still makes progress.
   - Round each unit's remaining minutes up to `grain`.
   - A course with no units gets one synthetic unit (`id = courseId`, title "Study session").
2. **Order courses** (`topo.ts`). Skip `done` courses. Use Kahn's algorithm with priority `(status==='active' first, order, code, id)`.
   - A prerequisite pointing at a done course counts as satisfied.
   - An unknown prerequisite raises `UNKNOWN_PREREQ` and is ignored.
   - A cycle raises `PREREQ_CYCLE` with its members, which are then appended in `(order, code)` order so the preview is still useful.
   - Units are sorted by `(order, id)`. The result is **one queue**: courses run sequentially and a prerequisite's work always comes first.
3. **Walk the days** from `max(today, startDate)` for up to `horizonDays`.
   - A day's capacity is `minutesByWeekday[weekday]`, or 0 if the day falls inside any `daysOff` range. Subtract `reservedMinutes[day]`, then floor to `grain`.
   - Fill the day:
   ```
   while queue not empty and cap > 0:
     u = head; if cap < minEff and u.rem > cap: break
     take = min(maxChunk, u.rem, cap); rest = u.rem − take
     if 0 < rest < minEff and (u.rem − minEff) ≥ minEff: take = u.rem − minEff   // avoid a tiny tail
     emit chunk(day, u, take, orderInDay++); cap −= take; u.rem −= take; if u.rem == 0: shift
   ```
   Invariants:
   - Each day's sum is ≤ its capacity (never above the daily max).
   - Every chunk is within [minEff, maxChunk], except a unit's **final** chunk, which may be shorter.
   - Nothing is placed on a zero-capacity day.
   - The sum of chunk minutes equals the total remaining (unless the horizon is exceeded).
4. **Finish.**
   - `seq = chunkSeqStart + i + 1` and `seqTotal = chunkSeqStart + nChunks(unit)`. `key = unitId:seq`, which stays stable because completed chunks keep their numbers.
   - Title: `"C182 · Operating systems (2/4)"`.
   - Build course windows from the first and last chunk dates.
   - `projectedEnd` is the last chunk date, or null if nothing remains.
   - `slipDays = diffDays(projectedEnd, targetDate ?? baselineEnd)`.
   - `feasible` = no `NO_AVAILABILITY`/`HORIZON_EXCEEDED` issue and (`targetDate == null || projectedEnd ≤ targetDate`).
   - Raise `TARGET_IN_PAST` if targetDate < today and work remains.
5. **Catch-up** (`catchUp.ts`).
   - `studyDaysLeft` counts days in `[start, targetDate]` with a positive weekday capacity that aren't days off.
   - `extraMinutesPerStudyDay`: the smallest X in 5, 10, … ≤ `maxCatchUp` for which re-running with `+X` on every weekday that already has capacity > 0 is feasible. This is a linear search, so it's correct even if feasibility isn't monotonic. It is null if no X works. It drives the "Add 20 min/day to catch up" button.
   - `requiredMinutesPerStudyDay`: start at `ceil(remaining / studyDaysLeft)` rounded up to grain, then +grain until a uniform per-study-day capacity is feasible. It is capped at 960, and null if impossible or if `studyDaysLeft = 0` (then the UI says to add study days). The wizard shows it as "≈ 2.5 h/day would make it work".
   - `suggestedTargetDate = projectedEnd`.

### 4.3 Materialising & rebalancing (`db/repos/goals.ts → rebalanceGoal(goalId, {now, reason})`, architect-owned)
- Scheduled chunks are **real tasks** with `source: 'schedule'`, `scheduleKey`, `estimateMinutes`, `estimatePomodoros = max(1, round(min/25))`, `dueDate` and `orderInDay`. They show up on Today, Board, Calendar and .ics like any other task.
- Inputs the repo computes:
  - Remaining per unit = estimate − done-chunk minutes − pinned open-chunk minutes.
  - Reserved minutes = pinned open tasks per date (with date ≥ today) + today's minutes of this goal's tasks completed or skipped today.
  - Availability = the goal's plus `settings.scheduling.globalDaysOff`.
- **Pins:** editing a scheduled task's date or time by hand sets `schedulePinned = true`, and the rebalancer leaves it alone. A pin expires once its date is in the past, so a missed pinned task goes back into the pool.
- Apply `diffSchedule` over the goal's **open, unpinned** scheduled tasks by key in one transaction. Matching keys update date, minutes, title and orderInDay (keeping id, notes and tags). New keys insert. Missing keys are deleted (hard delete; they are regenerated, not user data). Then write `goal.projection`, the milestones' `projectedStart/End`, and `lastRebalancedOn = today`. `baselineEnd` is set when the wizard plan is accepted.
- **Triggers:**
  - `onAppStart`/midnight rollover for goals with `lastRebalancedOn < today`. This covers missed days: past-dated open chunks are still remaining work and move forward.
  - Wizard accept, and edits to goal, course, unit or availability.
  - Course or unit completed early. Its remaining work becomes 0, so later work is pulled forward.
  - Task skip (`skippedOn = today`, which reserves its minutes today so it moves on).
  - "Apply catch-up" (adds X to each study weekday, then rebalances).
  - The manual "Rebalance now" command.
- **Multiple goals** are scheduled independently, each with its own availability (a documented limitation).

### 4.4 Required tests (`scheduler.test.ts`, `diff.test.ts`; TZ=America/New_York)
- **Normal:** 2 courses, Mon–Fri 60 and Sat 120. No chunks on Sundays, all invariants hold, the hand-computed `projectedEnd` matches, and output is deterministic (two runs deep-equal).
- **Missed day:** yesterday's chunks are undone. No chunk is dated before today, minutes are conserved, the end moves by exactly one study day, and `diffSchedule` updates dates without insert or remove.
- **Missed week:** the correct `slipDays`. `extraMinutesPerStudyDay` = X, where X is feasible and X−5 is not.
- **Completing early:** course A is marked done at 50%. There are no A chunks, B starts earlier, and `projectedEnd` moves earlier.
- **Vacation:** a daysOff range gets zero chunks, and the end is pushed by the number of study days inside the range. Global days off are merged.
- **Impossible deadline:** `feasible=false`. `requiredMinutesPerStudyDay` is verified (feasible at R, infeasible at R−5). `studyDaysLeft=0` returns null. `TARGET_IN_PAST` is raised.
- **Prerequisites:** B requires A while A has a higher `order`, so A comes first. The chain C→B→A works. A cycle yields `PREREQ_CYCLE` and still schedules. `UNKNOWN_PREREQ` is raised. A prerequisite on a done course is satisfied.
- **Extras:**
  - Tail avoidance: 100 min with a 120 cap gives 75+25.
  - Units shorter than 25 min are allowed.
  - `minEff` applies with 20 min/day.
  - `NO_AVAILABILITY` and `HORIZON_EXCEEDED`.
  - Reserved minutes are respected.
  - A skipped task leaves today.
  - `chunkSeqStart` gives stable keys.
  - `diffSchedule` ignores done and pinned tasks.
  - `resolveUnitEstimates`.
  - No duplicate or missing days across the DST changes on 2026-11-01 and 2027-03-14.

### 4.5 Goal Breakdown Planner (slot-level; `src/logic/scheduler/`, architect-owned)
`buildSchedule` / `planGoal` / `diffSchedule` (§4.1–4.4, day-level) stay as they are and keep serving v1 goals until the v2 wiring (5G) switches `rebalanceGoal` over. The planner places session-sized items into concrete time slots. Everything is imported from `@/logic/scheduler`; text parsing is `@/logic/planParse`.

```ts
// Availability v2 (windows.ts)
capacityForDate(av: AvailabilityV2, date: ISODate): TimeWindow[]      // shift pattern or weekday, blackouts, DST
fromLegacyAvailability(av: Availability, { studyStart?, sessionMinutes? }): AvailabilityV2
addMinutesToWindows(av, minutes): AvailabilityV2                     // what the add-time option applies
shiftCycle(runs, onDays, offDays), SHIFT_PRESETS                     // '3on4off' '4on3off' '4on4off' '5on2off' '2-2-3'
// Effort and splitting (effort.ts, split.ts)
estimateUnitMinutes({ hours?, cus?, cuHoursMultiplier?, selfRating? }): number | null   // know .5 · somewhat .8 · new 1
splitMinutes(total, rules): number[]      pieceSize(remaining, free, rules): number | null
// Planning (planner.ts, milestones.ts, feasibility.ts)
planStudy(input: PlannerInput): PlannerResult
  // { items: PlanItem[], projectedEnd, buffer: {pct, minutes, bufferedEnd}, pace: {mode, minutesPerStudyDay},
  //   totals, courseWindows, slipDays, fits, issues }
checkFeasibility(input, reference?): FeasibilityResult
  // { fits, shortfallMinutes, projectedEnd, bufferedEnd, options: { addTime: {extraMinutesPerStudyDay, suggestion},
  //   moveDate: {earliestFeasibleDate}, cutScope: {candidates: [{unitId, minutes, reason}], suggestedCut, cutMinutes} } }
// Live plan (reflow.ts, planDiff.ts)
rollForward(live: LivePlanInput): RollForwardResult     // { items, change, status, autoApply, proposals }
behindStatus(live): BehindStatus                         // onTrack | slightlyBehind | farBehind + reasons
replanWeek(live, { weekStart, today, blockedDays?, capacityFactor? }): WeekProposal
diffPlanItems(current, next, cutUnitIds?): PlanChange   // { moved, added, removed } by key
// Everyday tasks (autoSlot.ts)
autoSlotTasks(tasks, busy, availability, now): AutoSlotResult[]   // {taskId, doDate, startTime} | {taskId, reason}
```

- **Items and keys.** Kinds `study | review | practiceTest | assessment | milestone`. Keys: `${unitId}:${seq}` (unchanged), `extra:${unitOrCourseId}:${n}` (readiness review), `review:${assessmentId}:${n}`, `practice:${assessmentId}`, `assessment:${assessmentId}`, `milestone:${weekStart}`.
- **Placement.** Courses in prerequisite order as one queue. Each item takes the earliest free slot after the previous one, with a 10-min break when there is room. Nothing crosses a window end or overlaps busy time, pins or booked assessments. Study is split as it is placed: a target-length session when the window has room, otherwise a piece of at least 25 min that fills the window and never leaves less than 25. A unit that fits in one session stays whole.
- **Assessments.** A dated one sits on its date: a booked time blocks its slot, otherwise it is a day marker. Its reviews go −7/−3/−1 study days before it (scaled to the gap and deduplicated) and its practice test −2 (exams only); a quiz gets −1 and a project −2. An undated one goes on the first study day after its course's work, and its extras are due at the matching point of that work.
- **Pace and buffer.** With no target (ASAP) every free slot is used. With a target the pace is the smallest verified one (token bucket, capped at pace + the longest item) whose plan ends, buffer included, by the target. The buffer is 12 % of planned work (10–15 % in the UI), reserved as free time after the last item. The plan `fits` when `bufferedEnd ≤ target`, no study lands on or after a dated assessment, and nothing is blocked.
- **Live plan.** Roll-forward only moves items: push-only, order and pace kept. A slightly-behind plan applies it automatically. A far-behind plan (slip > 7 days against the baseline, missed > 15 % of remaining work, past the target, or study after a dated exam) returns proposals instead and applies nothing: `rollForward`, `extendDate`, `addTime`, `cutScope` and `spread`, each verified. "Life happened" (`replanWeek`) is always a proposal.
- **Hooks.** `extraReviewMinutes` on `PlannerUnit`/`PlannerCourse` (readiness) and `PlannerInput.blockedSlots` (calendar sync, and everyday tasks with a do time).
- **Tests** (TZ=America/New_York): `windows.test.ts`, `planner.test.ts` (including a 12-course year in < 50 ms; it measures about 10–16 ms paced and 3–5 ms ASAP), `reflow.test.ts`, `feasibility.test.ts`, `autoSlot.test.ts`, and `planParse/parse.test.ts` (5 syllabus formats plus typed goals).

### 4.6 Schema v2 (planner) — to apply in 5G, after the parallel builders land
One Dexie version bump, following §3.4: `src/db/migrations/v2.ts` exports `STORES_V2_DELTA` and `upgradeV2(tx)`, `db.version(2).stores(STORES_V2_DELTA).upgrade(upgradeV2)`, `SCHEMA_VERSION = 2`, and a pure `migrateBackupV1toV2()` in `logic/backup.ts` shares the row mapping so old backups and snapshots still import. (Sync tombstones move to v3.)

**Field additions** (`src/db/types.ts`; new fields are non-optional in the types, and filled by the upgrade):
```ts
export type TaskKind = 'task' | 'study' | 'review' | 'practiceTest' | 'assessment' | 'milestone'
export interface TaskSync {                  // calendar-sync hook (not built)
  provider: 'google' | 'caldav' | 'ics'; calendarId: string | null; externalId: string
  etag: string | null; lastSyncedAt: Millis | null; direction: 'push' | 'pull' | 'both' }
interface Task {                             // + existing fields
  doDate: ISODate | null        // when I plan to do it: Today, Upcoming, Calendar and "Rolled over" read this
  doTime: HHmm | null           // planned start (a slot); null = any time that day
  durationMinutes: number | null  // length of the planned slot (plan items: the piece length)
  // dueDate / dueTime stay: the hard deadline only. "Overdue" (red) = dueDate < today; "Rolled over" (amber) = doDate < today
  autoSlot: boolean             // everyday task with a due date and no do date: may be placed by autoSlotTasks
  kind: TaskKind                // 'task' for everyday tasks; the PlanItemKind for planner items
  assessmentId: ID | null       // plannedAssessments row for review / practiceTest / assessment items
  sync: TaskSync | null
}
export interface TimeWindow { start: HHmm; end: HHmm }         // same shape as the planner's TimeWindow
interface GoalPlanning {
  sessionMinutes: number                                       // 25–90, default 50
  weekly: TimeWindow[][]                                       // 7 entries, 0 = Sunday
  shiftPattern: { anchor: ISODate; cycle: (TimeWindow[] | null)[] } | null
  bufferPct: number                                            // 0.10–0.15, default 0.12
  cuHoursMultiplier: number                                    // default 15
  asap: boolean               // true: full speed, targetDate is only checked; false: paced to targetDate (forced true when targetDate is null)
  paceMinutesPerStudyDay: number | null                        // the accepted plan's pace (roll-forward keeps it)
}
interface Goal { planning: GoalPlanning }                       // availability.daysOff stays the blackout list;
                                                                // availability.minutesByWeekday becomes a mirror of the windows (repo keeps it in sync)
interface Milestone { selfRating: SelfRating | null }            // for a course without units
interface Unit {
  selfRating: SelfRating | null
  estimateSource: 'hours' | 'cus' | 'course' | 'import' | 'parsed'   // how estimateMinutes was derived
  baseEstimateMinutes: number | null                                // before the self-rating factor (so a re-rating recomputes)
  optional: boolean                                                 // cut-scope hint
}
interface Session { /* goalId already exists (denormalised at start); v2 only indexes it: [goalId+day] */ }
interface Flashcard {                                          // FSRS hook (not built); SM-2 fields stay
  scheduler: 'sm2' | 'fsrs'
  fsrs: { stability: number; difficulty: number; elapsedDays: number; scheduledDays: number;
          reps: number; lapses: number; state: 'new' | 'learning' | 'review' | 'relearning'; lastReview: Millis | null } | null
  noteRef: NoteRef | null }
export interface NoteRef { kind: 'goal' | 'course' | 'task' | 'resource'; id: ID; blockId: ID | null }
```

**New tables:**
```ts
interface PlannedAssessment extends Base {   // the plan's exams/projects/quizzes (attempt logs stay in `assessments`)
  goalId: ID; milestoneId: ID | null; kind: 'exam' | 'project' | 'quiz'; title: string
  date: ISODate | null; time: HHmm | null; durationMinutes: number | null
  status: 'planned' | 'done' | 'skipped'; completedAt: Millis | null; order: number
  source: 'user' | 'syllabus' | 'import' | 'wgu' }
interface PlanProposal extends Base {        // pending confirmations; nothing is applied until accepted
  goalId: ID | null                          // null = everyday tasks (auto-slot)
  kind: 'rollForward' | 'extendDate' | 'addTime' | 'cutScope' | 'spread' | 'lifeHappened' | 'aiSuggestion'
  status: 'pending' | 'accepted' | 'dismissed' | 'stale'; computedFor: ISODate
  title: string; detail: string; apply: unknown /* ProposalApply, zod-validated on accept */
  preview: PlanChange; baseRevision: string  // hash of the open plan items it was computed from: if the plan changed, recompute
  decidedAt: Millis | null }
interface PracticeQuestion extends Base {    // hook (not built)
  goalId: ID; milestoneId: ID; unitId: ID | null; prompt: string; choices: string[] | null; answer: string
  explanation: string; tags: string[]; source: 'user' | 'import'; noteRef: NoteRef | null; suspended: boolean }
interface QuestionAttempt extends Base {     // the wrong-answer queue: requeueOn set on a miss, cleared when answered right
  questionId: ID; goalId: ID; milestoneId: ID; at: Millis; day: ISODate; correct: boolean; answer: string
  requeueOn: ISODate | null }
interface Readiness extends Base {           // id = milestoneId or unitId; feeds PlannerUnit/Course.extraReviewMinutes
  goalId: ID; milestoneId: ID; unitId: ID | null; score: number /* 0–1 */; extraReviewMinutes: number
  inputs: { paPct: number | null; cardRetention: number | null; questionAccuracy: number | null; unitsDonePct: number }
  computedAt: Millis }
```

**Stores delta** (`STORES_V2_DELTA`):
```ts
tasks: 'id, status, dueDate, doDate, completedDay, goalId, milestoneId, unitId, scheduleKey, seriesId, kind, assessmentId, *tags, [status+dueDate], [status+doDate], [goalId+status], [goalId+kind]',
sessions: 'id, status, day, startedAt, taskId, goalId, milestoneId, [kind+day], [goalId+day]',
plannedAssessments: 'id, goalId, milestoneId, date, [goalId+order]',
planProposals: 'id, goalId, status, createdAt',
practiceQuestions: 'id, goalId, milestoneId, unitId',
questionAttempts: 'id, questionId, milestoneId, day, requeueOn',
readiness: 'id, goalId, milestoneId',
```

**`upgradeV2(tx)`** (one transaction; the same mapping in `migrateBackupV1toV2`):
1. **Tasks.** Every task gets `doDate = dueDate` and `doTime = dueTime`, `durationMinutes = estimateMinutes`, `autoSlot = false`, `assessmentId = null` and `sync = null`. v1 had a single date that meant "the day to do it" (quick add's "tomorrow 2p"), so `dueDate`/`dueTime` are then cleared: no v1 task claims a deadline it never had. `kind`: `'study'` for `source: 'schedule'`, `'review'` for `'flashcards'`, else `'task'`. Scheduler chunks keep `scheduleKey`, and v2 planner items get `dueDate` = their assessment date.
2. **Goals.** `planning = { sessionMinutes: 50, weekly: fromLegacyAvailability(availability, { studyStart: settings.scheduling.defaultStudyStart }).weekly, shiftPattern: null, bufferPct: 0.12, cuHoursMultiplier: 15, asap: targetDate === null, paceMinutesPerStudyDay: null }`.
3. **Units.** `selfRating = null`, `optional = false`, `baseEstimateMinutes = estimateMinutes`, `estimateSource = estimateMinutes === null ? 'course' : 'hours'`. **Milestones:** `selfRating = null`, and for each course whose `courseType` is OA / PA / OA+PA, undated `plannedAssessments` rows are created ("Objective assessment", exam; "Performance assessment", project; `source: 'wgu'`).
4. **Flashcards.** `scheduler = 'sm2'`, `fsrs = null`, `noteRef = null`.
5. `TableName` / `TableRows`, the goal trash cascade (plus plannedAssessments, planProposals, practiceQuestions, questionAttempts, readiness), backup Zod schemas and `defaults.ts` (`settings.scheduling.taskWindows`: every day 09:00–21:00 for auto-slot) are updated in the same step.

**Test:** a fake-indexeddb test that opens a v1 DB seeded with the WGU sample, reopens it at v2 and asserts the rows above, plus a `migrateBackupV1toV2` round trip.

**As built (5G), additions to the design above:**
- The upgrade keeps `createdAt`/`updatedAt` (the timestamp hook skips the native `versionchange` transaction), maps trash payloads (`trashToV2`), and creates the WGU planned assessments with ids `${courseId}:oa|pa` (done when the course is). `settings.scheduling.taskWindows` is filled by the upgrade and by `ensureSettings()`.
- A task with a deadline and no do date is planned for its deadline (`planDay = doDate ?? dueDate`) in Today, the lists, the board and the calendar. "Overdue" is gone from the UI: a past do date is "Carried over … from Tue" (neutral), and a deadline is a calm "Due Fri" chip, amber only on the due day.
- `rebalanceGoal`: plan items become tasks by key (`diffPlanTasks`: study matched per unit with the skip passes, everything else by exact key); everyday tasks with a do time (and other goals' sessions) are blocked slots; a session finished today keeps its slot blocked; a session skipped today takes its length off the end of today; a planned assessment is done when its item is checked off or its course is done. `planning.paceMinutesPerStudyDay` stores the accepted pace. Titles and minutes-based editors keep `planning.weekly` and `availability.minutesByWeekday` in step (`logic/goalPlanning.ts`).
- Proposals store `apply` (validated on accept by `parseProposalApply`) with the items for move-only kinds (roll forward, "life happened"); `baseRevision` is `planRevision` of the open items. Applying marks the goal's other pending proposals stale; Undo restores the goal, units, plan tasks and proposals.


### 4.7 Cloud sync (Phase 12) — design (12A, 2026-09-30), built in 12B

**In one paragraph.** Sync is off by default and nothing about it runs until it is switched on. The person brings their own free Supabase project: URL and anon (publishable) key go into Settings → Sync and stay on the device. Forge talks to it with plain `fetch` (no SDK): GoTrue for magic-link or email-code sign-in, PostgREST for one generic table `forge_rows` protected by row-level security. Locally, schema **v3** adds `syncOutbox` (one entry per changed record, written by a Dexie middleware that sees every write, deletes included) and `syncState` (this device's config, session and cursor). Conflicts resolve **per record, last write wins** on a write stamp; deletes travel as tombstones; the pull cursor is a server-assigned `seq`, not a timestamp. A device's first sync is a merge, never a wipe, and starts with a `pre-sync` snapshot. The app works exactly as before with sync off, and the initial bundle grows only by the always-installed pass-through middleware (≤ 2 KB gzip).

#### 4.7.1 Client: plain `fetch`, not `@supabase/supabase-js`
- **Measured** (esbuild `--minify`, `gzip -9`, 2026-09-30): `createClient` from `@supabase/supabase-js@2.117.2` is **222 KB min / 58 KB gzip** (it instantiates auth, PostgREST, storage, realtime and functions); `@supabase/auth-js` + `@supabase/postgrest-js` alone are 121 KB / 30 KB. Lazy loading would keep it out of the entry chunk, but the PWA precaches **every** JS chunk (`globPatterns` in `vite.config.ts`), so every install would download it with sync off. A hand-written client for the endpoints below is about 300 lines, **≈ 3–4 KB gzip**, in the lazy `features/sync` chunk.
- **What we give up:** supabase-js's session storage and auto-refresh timers. We need neither: the session lives in `syncState`, and refresh is one single-flight call in the one tab that syncs (§4.7.5 leader). PKCE is 15 lines of `crypto.subtle` (`lib/pkce.ts`).
- **Headers** on every call: `apikey: <key>`, `Content-Type: application/json`, `credentials: 'omit'`, `cache: 'no-store'`. `Authorization: Bearer <access_token>` once signed in. Before sign-in, a **legacy JWT anon key** is also sent as the bearer (as supabase-js does); a **new `sb_publishable_…` key never is** (it is not a JWT; supabase-js 2.117 omits it too). Auth calls add `X-Supabase-Api-Version: 2024-01-01`, which makes GoTrue return error codes (`otp_expired`, `over_email_send_rate_limit`, …).

| Purpose | Request (base = the project URL) | Notes |
|---|---|---|
| Check the project | `GET /auth/v1/settings` | 200 and `external.email === true` → OK; 401 → wrong key; network error → wrong URL or offline. Run when the config is saved. |
| Send the link | `POST /auth/v1/otp?redirect_to=<enc>` `{ email, create_user: true, data: {}, code_challenge, code_challenge_method: 's256' }` | The email carries a PKCE link and, with the template change in §4.7.2, a code. 429 / `over_email_send_rate_limit` → calm wait message. |
| Link comes back | `POST /auth/v1/token?grant_type=pkce` `{ auth_code, code_verifier }` | The app opens at `/settings/sync?code=…` (or `?error=…&error_description=…`). |
| Code from the email | `POST /auth/v1/verify` `{ type: 'email', email, token }` | 6–10 digits. The way in for the installed iPhone app (§4.7.2). |
| Refresh | `POST /auth/v1/token?grant_type=refresh_token` `{ refresh_token }` | When `expiresAt − 60 s < now`, or once after a 401. `invalid_grant` → signed out. |
| Sign out | `POST /auth/v1/logout?scope=local` (bearer) | Best effort; tokens are deleted locally whatever it answers. |
| Server clock | `POST /rest/v1/rpc/forge_now` `{}` | Once per cycle at most hourly; skew = server − (sent + received)/2. |
| Pull | `GET /rest/v1/forge_rows?select=tbl,id,updated_at,device_id,deleted,schema_version,data,seq&seq=gt.<cursor>&order=seq.asc&limit=500` | RLS limits it to the signed-in account. |
| Push | `POST /rest/v1/forge_rows?on_conflict=user_id,tbl,id` with `Prefer: resolution=merge-duplicates,return=minimal`, body `[{ user_id, tbl, id, updated_at, device_id, deleted, schema_version, data }]` | Every object has the same keys (PostgREST bulk rule). `user_id` is the session's user id. |

#### 4.7.2 Configuration
- **Stored in `syncState`** (device-local, never synced, never in a backup, snapshot, crash export or error report): `url`, `anonKey`, `email`. Nothing is hard-coded; with no row the feature is off.
- **URL** (`logic/syncConfig.parseProjectUrl`): trimmed, a missing scheme gets `https://`, the path is dropped; it must be `https://<ref>.supabase.co` with `ref` = 20 lowercase letters or digits. Anything else (http, custom domain, self-hosted, localhost) is refused with the reason: *"Forge can only reach addresses ending in .supabase.co."* (the CSP below).
- **Key** (`parseApiKey`): a JWT whose payload has `role: 'anon'` (and, when present, `ref` equal to the URL's ref: *"This key belongs to another project."*), or `sb_publishable_…`. **Refused**, with *"This is a secret key. It must never be put in an app. Use the anon (public) key from Project Settings → API."*: a JWT with `role: 'service_role'` and any `sb_secret_…`. The anon/publishable key is public by design (RLS is the protection), so storing it is not storing a secret.
- **Redirect URL**: `${location.origin}/settings/sync`, so production is `https://forge-study-app.netlify.app/settings/sync`. The person's project needs (README): Authentication → URL Configuration → **Site URL** `https://forge-study-app.netlify.app`, **Redirect URLs** `https://forge-study-app.netlify.app/settings/sync`, `http://localhost:5173/settings/sync`, `http://localhost:4173/settings/sync`. Deploy previews are not listed; the code works there.
- **Email templates** (README): add `Or type this code in Forge: {{ .Token }}` to both **Magic Link** and **Confirm signup** (a first sign-in sends the second). Why: on iOS an installed PWA has its own storage and a link from Mail opens in Safari, which has neither the PKCE verifier nor the database, so the link cannot sign the app in. The code can. The link still works in any browser tab where it was requested.
- **Recommended after the first sign-in** (README): Authentication → Providers → Email → turn off "Allow new users to sign up". The anon key never leaves the person's devices, and RLS isolates rows anyway; this closes the project to strangers who might guess its URL.
- **CSP** (`security-headers.mjs`): `connect-src 'self' https://icons.duckduckgo.com https://*.supabase.co`. A CSP is a static response header written at build time; it cannot be derived from a URL typed into the app later. `https://*.supabase.co` covers every hosted project and nothing else (no `wss:`: realtime is not used). The cost: custom domains and self-hosted Supabase cannot sync (validation says so up front). Playwright mocks must therefore use a `https://<20 chars>.supabase.co` origin, because `page.route` sees a request only after the CSP allowed it.

#### 4.7.3 Server schema: one generic table
**Why one table.** Forge syncs 26 Dexie tables and adds tables and fields with every schema version. One table per Dexie table would mean 26 tables, 104 policies and a server migration in the person's project for every Forge release; a generic `jsonb` row means the server never migrates (each row carries `schema_version` and clients migrate on read, §4.7.5). We lose server-side querying of fields, which nothing needs. Last-write-wins, the clock clamp and the change cursor live in the database, so a client bug or an old client cannot overwrite newer data.

**The SQL** (verbatim; README "Set up sync" and the Settings "Copy setup SQL" button carry exactly this text, `features/sync/setupSql.ts` holds it and a test checks the README matches). Verified 2026-09-30 on PostgreSQL 16 with a Supabase shim (`auth.users`, `auth.uid()` from `request.jwt.claims`, roles `anon`/`authenticated`): runs twice cleanly; an older stamp is skipped (`INSERT 0 0`), a tie goes to the larger device id, the same stamp from the same device (a retried push) is accepted, a stamp far in the future is capped at +5 min, a tombstone nulls `data`, another account sees 0 rows and cannot insert or update into this one, `anon` is denied; two concurrent pushes serialize (the second waits and gets the larger `seq`, a reader in between sees neither), and opposite-order upserts of the same rows do not deadlock.

```sql
-- Forge cloud sync: run once in your Supabase project's SQL editor. Safe to run again.
-- One table holds every synced Forge row as JSON. Row-level security keeps each account's rows private.

create table if not exists public.forge_rows (
  user_id        uuid        not null references auth.users (id) on delete cascade,
  tbl            text        not null check (char_length(tbl) between 1 and 64),
  id             text        not null check (char_length(id) between 1 and 200),
  updated_at     bigint      not null,  -- last-write-wins stamp: ms since 1970, from the device that wrote it
  device_id      text        not null check (char_length(device_id) between 1 and 64),
  deleted        boolean     not null default false,  -- a tombstone: the row was deleted
  schema_version integer     not null check (schema_version > 0),
  data           jsonb,                  -- the Forge row; null once deleted
  seq            bigint      not null default 0,  -- change cursor, set by the trigger below
  modified_at    timestamptz not null default now(),  -- server time of the last accepted write
  primary key (user_id, tbl, id),
  constraint forge_rows_data_check check (deleted or data is not null)
);

create sequence if not exists public.forge_rows_seq;

create index if not exists forge_rows_user_seq on public.forge_rows (user_id, seq);

-- Every write goes through here: an older write never replaces a newer one, a clock that runs far
-- ahead cannot win for long, and `seq` follows commit order so a pull never misses a row.
create or replace function public.forge_rows_accept()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A stamp more than five minutes ahead of the server is capped there.
  new.updated_at := least(
    new.updated_at,
    (extract(epoch from clock_timestamp()) * 1000)::bigint + 300000
  );
  if tg_op = 'UPDATE' then
    -- Last write wins. Equal stamps go to the larger device id, so every device agrees.
    if (new.updated_at, new.device_id) < (old.updated_at, old.device_id) then
      return null;  -- keep the stored row
    end if;
  end if;
  -- One writer per account at a time: `seq` is handed out in commit order.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  new.seq := nextval('public.forge_rows_seq');
  new.modified_at := now();
  if new.deleted then
    new.data := null;
  end if;
  return new;
end;
$$;

drop trigger if exists forge_rows_accept on public.forge_rows;
create trigger forge_rows_accept
  before insert or update on public.forge_rows
  for each row execute function public.forge_rows_accept();

-- The server's clock, so Forge can tell you when a device's clock is off.
create or replace function public.forge_now()
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select (extract(epoch from now()) * 1000)::bigint;
$$;

alter table public.forge_rows enable row level security;

drop policy if exists forge_rows_select on public.forge_rows;
create policy forge_rows_select on public.forge_rows
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists forge_rows_insert on public.forge_rows;
create policy forge_rows_insert on public.forge_rows
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists forge_rows_update on public.forge_rows;
create policy forge_rows_update on public.forge_rows
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists forge_rows_delete on public.forge_rows;
create policy forge_rows_delete on public.forge_rows
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.forge_rows from anon;
revoke all on sequence public.forge_rows_seq from anon;
revoke all on function public.forge_now() from anon, public;
grant select, insert, update, delete on table public.forge_rows to authenticated;
grant usage on sequence public.forge_rows_seq to authenticated;
grant execute on function public.forge_now() to authenticated;
```
Notes for the builder: the `BEFORE INSERT` trigger fires for every proposed row *before* the conflict check, so the advisory lock is always taken before any row lock (that is why opposite-order pushes cannot deadlock); keep every client write an upsert. `seq` has gaps (an upsert draws twice); only its order matters. Tombstones are kept forever: a tombstone is ~100 bytes, and purging them would let a device that was offline longer than the purge window bring deleted rows back. The README also gives the one-liner to erase the cloud copy by hand (`delete from public.forge_rows where user_id = auth.uid();` run while signed in, or by user id in the dashboard); Forge has no button for it.

#### 4.7.4 Local schema v3
**Stores delta** (`src/db/migrations/v3.ts`; `SCHEMA_VERSION = 3`):
```ts
export const STORES_V3_DELTA = {
  syncOutbox: '[tbl+id], at',   // one entry per changed record; `at` = the write stamp (push order)
  syncState: 'id',              // one row, id = 'device'
} as const
```
**Types** (`src/db/types.ts`). Neither table extends `Base`, and `installTimestampHooks` skips them (by name).
```ts
export interface SyncOutboxEntry { tbl: SyncTableName; id: ID; at: Millis }   // no payload: push reads the row
export interface SyncSession { accessToken: string; refreshToken: string; expiresAt: Millis; userId: string; email: string }
export interface SyncError { kind: SyncErrorKind; message: string; at: Millis }
export type SyncErrorKind = 'offline' | 'server' | 'rateLimited' | 'signedOut' | 'setup' | 'forbidden' | 'tooLarge' | 'updateNeeded' | 'snapshot'
export interface SyncStateRow {
  id: 'device'
  enabled: boolean                      // tracking + engine on
  url: string | null; anonKey: string | null; email: string | null
  session: SyncSession | null
  pendingLogin: { email: string; codeVerifier: string; requestedAt: Millis } | null
  deviceId: string | null               // newId() at every enable; the LWW tie-break and the echo filter
  accountUserId: string | null          // the account this device last merged with; another one → bootstrap again
  phase: 'off' | 'bootstrap' | 'steady'
  pullCursor: number                    // last applied server seq
  maxSeenStamp: Millis                  // highest remote stamp seen (≤ server time + 5 min)
  lastSyncAt: Millis | null; lastAttemptAt: Millis | null; lastError: SyncError | null
  clockSkewMs: number | null            // server − device
}
export type SnapshotReason = 'daily' | 'manual' | 'pre-import' | 'pre-restore' | 'pre-reset' | 'pre-sync'   // SNAPSHOT_KEEP['pre-sync'] = 5
// Settings loses `sync` (it moves to syncState): device config must not ride in a synced row.
```
**Upgrade** (`upgradeV3(tx)`): `settings.filter(has sync).modify(s => { delete s.sync })` (only rows that still carry it, so a second run writes nothing); create nothing else (both tables start empty; with no `syncState` row sync is off). `logic/schemaV3.ts` holds `settingsToV3` and `logic/backup.ts` gains `migrateBackupV2toV3` (strips `settings.sync`, drops `syncOutbox`/`syncState` if a file has them) plus the step in `migrateBackup`. `BACKUP_CONTEXT.ignoredTables` adds `syncOutbox` and `syncState`.

**Which tables sync** (`logic/syncTables.ts`, tiny, in the initial chunk because the middleware needs it):

| Syncs (26) | Why / special rule |
|---|---|
| `tasks goals milestones units rewards redemptions blocklist parkingLot checkIns assessments flashcards resources savedViews rituals weeklyReviews templates plannedAssessments practiceQuestions questionAttempts` | Ordinary records, per-record LWW. |
| `settings` | The singleton syncs **minus device paths** `appearance` (theme, accent, reduced motion: a phone in dark mode next to a laptop in light mode is common; user decision 2026-09-30), `notifications`, `blocker.extensionIdOverride`, `blocker.lastSyncedAt`, `blocker.eventsCursor`, `backup.lastRemindedAt` (`SETTINGS_DEVICE_PATHS`). A write that changes only device paths is not enqueued (the blocker's 60 s event pull must not push the settings row and overwrite the other device's real changes). On apply, local device paths are kept. `onboardedAt` never goes from set to null (earliest non-null wins). `lastCelebratedLevel`, `world.seed`, `rewardsSeeded`, `blocker.blocklistSeeded` and `scheduling.lastDailyRunDay` sync on purpose (one celebration, one city, no reseeding, one daily roll-forward). |
| `sessions` | Only final rows. A `running`/`paused` row is not pushed (its entry is dropped); it is pushed when it ends. Only one running row per device stays true, and no device finishes another device's timer. |
| `xpEvents` | Append-only: **union by id**. Rows are immutable, so LWW on one id only ever resolves a *deterministic-id* collision (next bullet), which is the intended dedupe. |
| `badges` | Natural id (`BadgeId`): two devices unlocking the same badge collide and LWW keeps one. Also reconciled from history after a pull. |
| `blockEvents` | Append-only, ids from the extension (so the phone sees "You tried Instagram 7 times"). A re-put of an existing id is not enqueued. |
| `planProposals` | Synced so a proposal computed on one device can be accepted on the other; applying one already marks the goal's other pending proposals stale, which also retires a duplicate computed offline elsewhere. |
| `trash` | Synced so the Trash (and Restore) is the same everywhere. Blobs in a payload (`files` of a resource or course) are replaced by the backup's `{ __blob, type, size }` marker on push; bytes never leave the device (below). |

| Never syncs (7) | Why |
|---|---|
| `files` | PDF bytes (≤ 50 MB each) do not belong in `jsonb`, and Supabase Storage would add a bucket, policies and a second transfer path for a first version. The resource row syncs; on the other device it shows the existing "File missing" state, which says, while sync is on, "This PDF isn't on this device. PDFs stay on the device they were added on." Storage is the recorded follow-up (12C, optional). |
| `snapshots` | Whole-data copies, per device. |
| `streakDays`, `worldTiles`, `readiness` | Derived caches, rebuilt from synced history (§4.7.5 "After a pull"). |
| `syncOutbox`, `syncState` | This device's sync bookkeeping. |

**Deterministic ids for once-per-key awards** (`repos/xp.ts`): `awardXp` and `reverseXp` give the event `id = xpEventId(key, n)` = `` `xp:${key}#${n}` ``, `n` = how many events that key already has on this device. Two devices that both pay `dailyGoal:2026-10-01` offline both write `xp:dailyGoal:2026-10-01#0`, which collapses to one +25 instead of +50; award #0 → undo #1 → award #2 is the same state machine everywhere. Existing uuid events keep their ids. `appendXpEvent` (no key logic) keeps `newId()`. Starter rewards get ids `starter-reward:<i>` (like the blocklist's `defaultId(domain)`), so two devices seeding the shop collide instead of doubling.

**The tracking middleware** (`src/db/sync/tracking.ts`, installed in the `ForgeDB` constructor with `this.use(syncTracking)`; level 10, i.e. above Dexie's hooks at 2 and observability at 0). Prototyped on dexie 4.4.6 + fake-indexeddb on 2026-09-30; all of the following was checked:
```ts
// sketch; the real one is typed with DBCore types and has no `any`
create(down) { return { ...down,
  transaction(stores, mode, opts) {                       // widen rw transactions that touch a synced table
    const track = mode === 'readwrite' && trackingOn() && stores.some(isSyncTable)
    const tx = down.transaction(track ? [...stores, 'syncOutbox'] : stores, mode, opts)
    if (track) tracked.add(tx)                             // WeakSet<object>
    return tx },
  table(name) { const t = down.table(name); if (!isSyncTable(name)) return t
    return { ...t, async mutate(req) {
      if (!tracked.has(req.trans) || isRemoteApply(req.trans)) return t.mutate(req)
      const keys = await keysOf(t, req)                   // add/put: req.keys ?? values[i].id; delete: req.keys;
                                                          // deleteRange (clear(), where().delete()): query primary keys first
      const filtered = await filterKeys(name, req, keys)  // settings: synced projection changed?; append-only: key is new?
      const res = await t.mutate(req)
      if (filtered.length) await down.table('syncOutbox').mutate({ trans: req.trans, type: 'put',
        values: filtered.map((id) => ({ tbl: name, id, at: nextStamp() })) })
      notifyTrackedWrite()                                // the engine's debounce (no-op when no engine)
      return res } } } } }
```
**As built (12B1):** `mutate` is written as `.then` chains on the promises the lower layers return, never `async`/`await` before calling down: Dexie's own hooks (level 2) and cache (level 0) middlewares read the transaction from Dexie's zone (`PSD.trans`), which Dexie promises keep in their callbacks and a native `await` loses (it crashed the hooks middleware in the first build). Reads that must see the rows before the write (the settings comparison, append-only existence, the keys of a `deleteRange`) are issued before the mutation in the same transaction, which IndexedDB runs in order. A key whose operation failed in a bulk write is not queued. The tracker is one `SyncTracker` per `ForgeDB` (`db.syncTracker`), with its own flag and stamp floor, so tests can open several databases.
- `req.trans` **is** `tx.idbtrans` (Dexie hands the top of the stack to `table.core.mutate`), so `markRemoteApply(tx.idbtrans)` (a `WeakSet`) switches tracking off for the sync's own writes; the same marker is visible to the `updating` hook, which must also **not stamp** `updatedAt` inside a remote-apply transaction (a remote row keeps its own).
- `clear()` arrives as `deleteRange` and `where(…).delete()` as `deleteRange`/`delete`; both produce entries. Nested transactions reuse the parent's `idbtrans`, so they are tracked once. Upgrade transactions are never created through `transaction()`, so migrations are not tracked. An aborted transaction rolls its outbox entries back with it.
- Writes to `syncOutbox` go through `down`, i.e. through Dexie's observability layer: `useLiveQuery(() => db.syncOutbox.count())` updates (the pending count in Settings).
- **Off means pass-through:** with tracking off, `transaction()` does not widen and `mutate` returns at the first check. That check and a 20-line module are the only sync code in the initial bundle.
- **The flag** is read in `db.on('ready')` (Dexie holds other queries until it resolves) from `syncState.get('device')?.enabled`, and changed in other tabs through a `BroadcastChannel('forge:sync')` `{ type: 'tracking', on }` message. The enabling tab waits 1 s after broadcasting before the first cycle reads the tables.
- **The stamp clock** (`nextStamp`): `max(Date.now(), lastStamp + 1, maxSeenStamp + 1)`, strictly increasing per tab, seeded at ready from `syncState.maxSeenStamp` and the outbox's largest `at`. It is a Lamport-style hybrid clock: an edit made after seeing another device's change always carries a larger stamp than that change, whatever this device's clock says.

**How every delete becomes a tombstone.** There is no local tombstone table: a delete writes an outbox entry, and at push time a record whose row is gone is sent as `deleted: true`. The server keeps the tombstone.

| Path | What reaches the outbox | Effect elsewhere |
|---|---|---|
| Ordinary delete (`delete`, `bulkDelete`, plan tasks removed by `writePlanDiff`) | entry per key → tombstone | row deleted |
| Move to Trash (`moveToTrash`) | tombstones for the entity and its cascade + a put for the new `trash` row | gone there too, and in its Trash |
| Restore from Trash | puts for the restored rows (stamp = now, although they keep their old `updatedAt`) + tombstone for the `trash` row | back there too; before deleting its local `trash` row, the apply moves any real Blobs in that row's payload into `files` when a resource still points at them (`filesInTrash` rule), so PDF bytes on the deleting device are never lost |
| Purge / Delete forever / Empty trash | tombstones for `trash` rows | gone from that Trash |
| Snapshot restore, backup import | `clear()` → tombstones for everything, then puts for every restored row; one entry per key survives (coalesced) | **replaces the data on every synced device** (the dialogs say so when sync is on) |
| Reset | none: `resetAllData` first turns sync off on this device (tracking off in all tabs, outbox and `syncState` cleared), then clears | the other devices and the cloud copy keep everything |
| A remote tombstone applied here | none (remote-apply transaction) | — |

**Does every write set `updatedAt`?** Yes for LWW's purposes, because LWW does not read it: the stamp is the outbox's write time. The audit found writes that deliberately keep or set a non-current `updatedAt`, all fine under this design: trash restore, snapshot restore and backup import (original timestamps, DECISIONS "Stamping edge cases"), block events (`updatedAt: e.at`, `repos/blocker.ts`), XP events (`updatedAt: at`, `repos/xp.ts`), migrations (not stamped), and sample seeds. Every other update is stamped by the `updating` hook. `updatedAt` is used by sync only as the stamp of a device's **first** push (bootstrap, §4.7.5).

**Migration test plan** (`src/db/migrations/v3.test.ts`, the v2 test is the template): open a v2 database seeded with the WGU sample, a settings row with `sync: { enabled: false, … }` and a trash row holding a PDF Blob; reopen with `ForgeDB` → both new tables exist and are empty, `settings.sync` is gone, every `updatedAt` is unchanged, the trash Blob is intact, and running the upgrade again changes nothing; `migrateBackupV2toV3` of the same tables equals what the database holds; a v1 backup fixture still imports through v2 → v3; a v3 backup has no `syncOutbox`/`syncState`.

#### 4.7.5 Algorithm
**Types shared by the engine, the transport and the fake** (`logic/sync.ts`, type-only parts):
```ts
export interface Stamp { at: Millis; device: string }
export interface PushRow { tbl: SyncTableName; id: string; updatedAt: Millis; deviceId: string; deleted: boolean; schemaVersion: number; data: unknown }
export interface ServerRow extends PushRow { seq: number }
export interface SyncServer {                          // Supabase transport in features/sync; in-memory fake in src/test
  push(rows: readonly PushRow[]): Promise<void>        // throws SyncTransportError
  pull(afterSeq: number, limit: number): Promise<ServerRow[]>
  serverTime(): Promise<Millis>
}
export class SyncTransportError extends Error { kind: SyncErrorKind; status: number | null; retryAfterMs: number | null }
export function newer(a: Stamp, b: Stamp): boolean     // a.at > b.at || (a.at === b.at && a.device > b.device): the SQL rule
```

**A cycle** (`db/repos/sync.ts → runSyncCycle(server, { now })`, one at a time):
1. Read `syncState`. `phase === 'bootstrap'` → the first sync (below) and stop.
2. **Push** until the outbox is empty: read up to 200 entries ordered by `at` (parents usually precede children, so other devices rarely see a task before its goal); build rows by reading each record now (missing → tombstone; `toServerRow` applies the settings projection, trash Blob markers and "running sessions are not pushed"); cut batches at ~1 MB of JSON (a single row over 8 MB is skipped with a `tooLarge` error naming it). After a 2xx, **compare-and-delete** in one transaction: an entry is removed only if its `at` still equals the pushed stamp, so an edit made during the request stays queued. A rejected (older) write needs nothing: the newer server row arrives with the pull.
3. **Pull** pages of 500 from `pullCursor` until a page is short. Each page is applied in **one** Dexie transaction over the synced tables + `syncOutbox` + `syncState` + `files`, marked remote-apply, which also advances `pullCursor` and `maxSeenStamp`: data and cursor move together, so a crash re-pulls at most one page. `yieldToMain()` between pages.
4. Write `lastSyncAt`, clear `lastError`; emit `sync.applied` once (below).

**Why `seq` and not a timestamp cursor.** A client clock cannot order other devices' writes, and even server `now()` is the transaction *start*, so a transaction that started earlier can commit later and be skipped by a cursor that already passed its time. `seq` is drawn under a per-account advisory lock inside the writing transaction, so for one account seq order is commit order: when a row with seq *n* is visible, every row with a smaller seq already is. Rows written in one push share `modified_at`, another reason not to page on it. `modified_at` is kept for humans debugging in the dashboard.

**Apply rules** (`logic/sync.ts → decideApply`, pure; `self` = this device's id, `pending` = the outbox entry for the key if any):

| Mode | Local state | Decision |
|---|---|---|
| steady | pending entry | `newer(remote, {at: pending.at, device: self})` → apply and drop the entry; else skip (ours is newer; it will push and win on the server) |
| steady | no entry, `remote.device === self` | skip (echo of our own push; the local row is at least as new) |
| steady | no entry | apply (the server only serves winners, and a row with no entry is the last synced version) |
| bootstrap | pending entry | as steady |
| bootstrap | no entry, row absent | apply (a tombstone: nothing to do) |
| bootstrap | no entry, row present | `newer(remote, {at: row.updatedAt, device: self})` → apply; else skip (the row is queued at the end of the bootstrap) |
| bootstrap | `settings`, remote exists | apply: a new device adopts the settings of the account (device paths and the `onboardedAt` rule still hold) |

Applying a row: `schemaVersion < SCHEMA_VERSION` → migrate it with the backup migrators (`migrateRows(tbl, [data], from)`); `> SCHEMA_VERSION` → stop before writing that page, `lastError = updateNeeded` ("Another device runs a newer Forge…"), the cursor stays. `data` that is not an object with a string `id` equal to the key is skipped and counted. `settings` goes through `mergeRemoteSettings(local, remote)`; a tombstone deletes the row (with the Trash Blob rescue above); anything else is `put` as is.

**First sync of a device** (`phase: 'bootstrap'`, set by every enable and by a sign-in to a different account):
1. **Pre-sync snapshot**: `takeSnapshot('pre-sync', { skipIfEmpty: true })`. If it fails, nothing syncs (`lastError = snapshot`).
2. `pullCursor = 0`; pull everything with the bootstrap rules, keeping an in-memory index `key → Stamp` of every remote row (≈ 10 k entries at a year of study) and the signatures of remote seed rows.
3. **Seed duplicates**: local rows that only exist because this device seeded them, and that the account already has, are deleted locally *without* tombstones: untouched starter rewards (`updatedAt === createdAt`, a starter title) when the account has a reward of that title; untouched onboarding starter tasks (`source: 'onboarding'`, `todo`, `updatedAt === createdAt`) when the account has an onboarding task of that title; blocklist entries whose `(kind, domain, pattern)` the account already has under another id. Pure: `seedDuplicates(localRows, remoteSignatures)`. Seed rows with a **fixed id** (`starter-reward:N`, `default:<domain>`) are not duplicates but collide by id; while untouched (`accountWinsOverSeed`) the account's version of the row, live or deleted, replaces them whatever the stamps say, since a fresh seed is always newer than what the owner did elsewhere.
4. **Queue what this device adds**: every local synced row with no outbox entry whose key is absent remotely, or whose `{at: updatedAt, device: self}` is newer than the remote stamp, gets an entry with `at = row.updatedAt` (not now: a phone's week-old default must not beat the laptop's yesterday edit). `settings` is queued only when the account had none. **Rows identical in content to the account's are not queued** (12B2 review fix): while pulling, call `noteIdenticalRow(identical, prepareRemoteRow(…), localRowAfterApply)` for every row and pass `identical` (required) to `planBootstrapQueue`; the set comes from content equality, not "keys applied this run", so a restarted bootstrap still skips adopted rows.
5. Push everything; `phase = 'steady'`. Interrupted anywhere → the next cycle starts the bootstrap again from step 2 (every step is idempotent; step 1 is skipped once a `pre-sync` snapshot was taken for this `deviceId`).

This is a merge, never a wipe: the only local rows a first sync deletes are rows the other side deleted *later* than this device last changed them (and seed duplicates), and the snapshot holds the before state.

**A second safety snapshot**: before applying any page with ≥ 25 tombstones, if none was taken in this cycle, a `pre-sync` snapshot is written first (`needsSafetySnapshot(page)`). That covers an import, snapshot restore or big delete made on the other device.

**Clock skew.** Stamps come from device clocks, so a device whose clock is behind loses to earlier edits made elsewhere. Four guards: the hybrid stamp (an edit made after seeing a change beats it); the server caps any stamp at its own time + 5 min (a phone set to 2030 cannot win for years); `maxSeenStamp` only takes remote stamps ≤ server time + 5 min; and `forge_now()` measures skew, and Settings says *"This device's clock is 7 minutes behind. Sync keeps the newest change by time, so set the clock to update automatically."* when |skew| > 2 min.

**After a pull: derived data and events.** Dexie live queries refresh by themselves (the apply writes go through the observability layer, also across tabs). Domain events for single actions (`task.completed`, …) are **not** emitted for remote rows: their handlers pay XP and show toasts for things done on *this* device. Instead `sync.applied { tables: TableName[]; goalIds: ID[] }` is emitted once per cycle (new member of `DomainEvent`) and handled idempotently:
- progress: the start-up streak check (`syncProgressAtStart`'s full compare, 25–60 ms at a year) rebuilds `streakDays`;
- badges: `reconcileBadges`;
- goals: `healDuplicatePlanTasks(goalIds)`: a goal with two open plan tasks sharing a `scheduleKey` (both devices re-planned offline) is re-planned once with `reason: 'sync'`; `diffPlanTasks` keeps the older (`byAge`) and removes the other, the same one on every device. Nothing else re-plans on a pull (two devices re-planning each other's results with different `now` could ping-pong);
- gamification: in the **apply transaction** itself, a page that brought `xpEvents` raises `settings.lastCelebratedLevel` to the current level (untracked), so XP earned on the laptop never plays the level-up moment on the phone. 12B checks every watcher that announces something (level-up, `BadgeUnlockToaster`, `StreakToaster`, celebrations) and makes each ignore rows that arrived by sync (asserted in e2e).
- goals' `onAppStart` schedules `runDailyPlanning` behind `waitForStartupSync(8000)` (`db/repos/syncGate.ts`, a few lines; resolves at once when sync is off) and returns at once, so the device that opens second each day usually adopts the first one's roll-forward (`lastDailyRunDay` syncs) instead of computing its own. It must not await the gate in the start-up chain: `runAppStart` runs features one after another and `goals` sorts before `sync`, so an awaiting hook would keep the engine from starting for the whole 8 s.

**Triggers and the main thread** (`features/sync/engine.ts`):
- Runs only when `syncState.enabled`; the feature's `onAppStart` returns at once otherwise (it reads the in-memory tracking flag, no I/O), and imports the engine chunk only when on.
- **One tab syncs**: the leader holds `navigator.locks.request('forge:sync', …)` for its lifetime (the next tab takes over when it closes; without Web Locks every tab runs). This matters for refresh-token rotation. Other tabs track writes and send "Sync now" to the leader over `BroadcastChannel('forge:sync')`. Status is read by every tab from `syncState` and `syncOutbox.count()` through live queries.
- When: at start (`whenIdle`, after first paint); 3 s after a tracked write (debounced, at most 30 s of waiting); on `visibilitychange` to visible and on window `focus` when the last cycle is > 30 s old; on `online`; every 5 min while visible; **Sync now** (resets the backoff). On `visibilitychange` to hidden, a push-only flush with `fetch(…, { keepalive: true })` when the pending rows fit in 60 KB and the token is valid (a phone that is put away still sends its last changes). A trigger during a cycle sets `again` and runs one more cycle after it.
- Budgets: a steady cycle with ≤ 50 changed rows ≤ 30 ms of main-thread work; a 500-row page apply ≤ 60 ms in Chrome; the first sync of `wgu-year` never blocks input for more than one page. Tracking on must keep `db/repos/budgets.test.ts`'s budgets (`rebalanceGoal` < 300 ms, `completeTask` < 100 ms): add tracking-on variants.

**Errors and backoff** (`classifySyncError`, pure: status + PostgREST/GoTrue code → kind):

| Kind | From | Then |
|---|---|---|
| offline | `TypeError` from fetch, `navigator.onLine === false` | wait for `online`, else backoff |
| server | 5xx, 520–540 (a paused free project), timeouts (20 s `AbortSignal.timeout`) | backoff 15 s, 1 min, 5 min, 15 min (cap), ±20 % jitter; reset on success |
| rateLimited | 429 | backoff, at least `Retry-After` or 1 min |
| signedOut | refresh answers `invalid_grant`/400, or 401 after a refresh | stop; tracking stays on and the outbox keeps growing until the person signs in again |
| setup | `PGRST205` / `42P01` (table missing), `PGRST202` (`forge_now` missing) | stop until Sync now; show "Run the setup SQL" with the copy button |
| forbidden | `42501` / 403 | stop; "The table's access rules are missing. Run the setup SQL again." |
| tooLarge | 413 | halve the batch and retry; one row alone → report it, and leave it out only once the server took other rows in the cycle (same for a 4xx content refusal); otherwise keep every entry and fail |
| updateNeeded | a newer `schema_version` in a page | stop; "Reload Forge to update" (the PWA update toast path) |

**Turning it off.** "Sign out and stop syncing": tracking off in every tab, best-effort `logout`, then `syncState` keeps `url`, `anonKey` and `email` and resets everything else (`enabled: false`, `session: null`, `phase: 'off'`, `pullCursor: 0`, `deviceId: null`), and the outbox is cleared. Local data is untouched and so is the cloud copy. Turning sync on again is a new first sync with a new `deviceId` (writes made while it was off were not tracked; the bootstrap compares them by `updatedAt`).

#### 4.7.6 The documented limitation (README "What sync can't do", and the same text, shorter, in the Settings disclosure)
- **One record, one winner.** When the same item changes on two devices before they sync, the change made later (by the devices' clocks) wins **for the whole item**. Edit a task's title on the laptop and its date on the phone, both offline, and one of the two edits is lost. Notes, checklists and tags are part of their task, goal or course. Settings are one item.
- **Delete versus edit.** An item deleted on one device and edited later on another comes back. Edited first and deleted later, it stays deleted (it is still in that device's Trash for 30 days).
- **XP is a log, not a counter.** XP events are added, never overwritten, so XP from both devices adds up. The same award paid on two devices offline (a daily goal, a course, a streak milestone, a finished task) counts once. A task finished on one device while its completion is undone on the other can leave its XP and its checkbox disagreeing until you tick it again.
- **Spending is not checked across devices.** Buying rewards on two devices offline can take the balance below zero.
- **Rebuilt on each device, never synced:** streak days, My World's city (it grows from the synced history, so it is the same), levels and balances (from the XP log), readiness. Plan tasks two devices both re-planned offline can show twice for a moment; the next sync removes the duplicate.
- **Clocks matter.** Keep "set time automatically" on; Forge warns when a device is more than 2 minutes off.
- **PDFs stay on the device they were added on.** Their resource rows sync and say where the file is.
- **A running timer shows on the other device when it ends.**
- **Import, snapshot restore** replace the data on every synced device; **Reset** erases only this device and turns sync off.

#### 4.7.7 UI: Settings → Sync (`settings.sections`, contribution id `sync`, lazy, order 65, after Export & calendar)
One section, no new route (`/settings/sync` already exists in the table). Copy is plain and calm: no red unless something needs the person, no counts of what is missing, nothing that nags.

| State | Shows |
|---|---|
| Off, not set up | "Keep Forge the same on your laptop and phone, through your own free Supabase project. Forge works fully without it." · **Set up sync** (reveals the form) · link "How to set up Supabase" (README anchor). |
| Setting up | **Project URL** (`https://abcdefghijklmnopqrst.supabase.co`), **Anon (public) key** (a password-style field with Show; help: "This key is meant to be public. Never paste the service-role or secret key."), each validated on blur with the one-line reasons of §4.7.2; **Check connection** (`/auth/v1/settings`); **Copy setup SQL**. Then **Email** + **Send sign-in link**. |
| Waiting for the email | "We sent a sign-in link to ana@example.com. Open it on this device. In the phone app, type the code from the email instead." · **Code** field (numeric, `autocomplete="one-time-code"`) + **Sign in** · **Send again** (disabled for 60 s with the seconds shown) · **Use another email**. A link opened where it was not requested says: "This link was opened in a different browser than the one that asked for it. Type the code from the email instead, or send a new link from here." |
| First sync | "Bringing this device together with your cloud copy… Nothing is deleted: where both have a change, the newer one is kept. A snapshot was taken first." with a quiet progress count. |
| On | Status line (`aria-live="polite"`, changes only on state change): "Synced · just now" / "Synced · 12 minutes ago" / "3 changes waiting" / "Offline. Changes will sync when you're back online." / "Trying again in 5 minutes." · **Sync now** · details: account email, this device's last sync time, the clock warning when needed · **Sign out and stop syncing** · disclosure "What sync can't do" (§4.7.6). |
| Needs attention | Signed out: "Sign in again to keep syncing. Your changes are kept on this device." with the email prefilled. Setup: "The forge_rows table isn't there yet. Run the setup SQL in your project." + copy button. Update needed: "Another device runs a newer Forge. Reload to update this one; sync picks up where it left off." + Reload. Paused project (repeated 5xx): "Your Supabase project may be paused. Free projects pause after a week without use; restore it from the Supabase dashboard." |

- "Sign out and stop syncing" confirms in a small dialog: "Forge stops syncing on this device. Everything stays on this device, and your cloud copy stays in your Supabase project." (Cancel focused).
- The import, snapshot-restore and reset dialogs gain one line when sync is on (`useSyncOn()` from `db/hooks/useSyncState.ts`): import/restore "Sync is on: this also replaces the data on your other devices."; reset "Sync will be turned off on this device. Your other devices and the cloud copy keep their data."
- Onboarding's first step gains a quiet link "Already use Forge on another device? Set up sync first." (`/settings/sync`), so a phone can skip seeding.
- Palette: "Sync now" (only while on), "Sync settings". No new shortcut.
- The magic link lands on `/settings/sync?code=…`: the section exchanges it, removes `code` from the address (`replace`), shows the first-sync state, and the page scrolls to it (the existing slug behaviour).

#### 4.7.8 Testing
- **Pure, exhaustive** (`logic/sync.test.ts`, `logic/syncConfig.test.ts`, `logic/syncTables.test.ts`):
  - `newer` is a strict total order equal to the SQL rule (ties, same device, equal stamps).
  - `decideApply`: every row of the table in §4.7.5, as a table-driven test over mode × pending × echo × tombstone × row present × tie.
  - Settings: device paths kept on apply and stripped on push; a device-only change is "unchanged"; `onboardedAt` rule; bootstrap adopt.
  - `toServerRow`: trash Blob markers (nested in a goal cascade), running/paused sessions → not pushed, JSON round trip equals the row.
  - `seedDuplicates`, `xpEventId`, `needsSafetySnapshot`, batching by bytes (≤ 1 MB, one oversized row alone), backoff schedule and jitter bounds, `classifySyncError` for every status/code of §4.7.5, `migrateRows` from v1/v2, newer-schema detection.
  - Config: URL forms (no scheme, trailing path, uppercase, http, custom domain, localhost, 19/21-char refs), keys (anon JWT, anon JWT for another ref, service-role JWT, `sb_publishable_`, `sb_secret_`, garbage, whitespace).
  - **Model-based property test** (`logic/syncModel.test.ts`): 2–3 simulated devices (a `Map` of rows + a pending map each) and `logic/syncServerModel.ts` (the SQL rules in TS: clamp, LWW, seq), 500 random interleavings of edits, deletes, pushes, partial pushes and pulls with random clock offsets; after everyone syncs twice, every replica equals the server and every key holds the `newer`-maximal write.
- **Middleware** (`src/db/sync/tracking.test.ts`, fake-indexeddb): exactly the expected keys for `add`, `put`, `bulkPut`, `update`, `modify`, `delete`, `bulkDelete`, `where().delete()`, `clear()`, `moveToTrash` + restore + purge, `importBackup`, `restoreSnapshot`, `rebalanceGoal`; local tables never; tracking off → no entries and no widened scope; remote-apply transaction → no entries and no `updatedAt` stamping; an upgrade → none; a device-only settings change → none; a re-put of an existing block event → none; an aborted transaction → none; stamps strictly increase.
- **Repo engine** (`db/repos/sync.test.ts`, fake-indexeddb + `src/test/fakeSyncServer.ts` implementing `SyncServer` over `syncServerModel`, with switches for offline, failing the next N calls, 413 and a newer `schema_version`; two devices simulated in one database by `src/test/devices.ts`, which saves and loads every table, `syncOutbox` and `syncState` included, inside a remote-apply transaction): first sync into an empty device; first sync of two devices with data (merge, nothing lost, settings adopted, seed duplicates gone, a `pre-sync` snapshot exists); concurrent edit (later stamp wins on both); edit vs delete both ways; trash move/restore/purge round trips with a PDF Blob that survives on the device that had it; import on A replaces B and B took a safety snapshot; reset on A leaves B and the server untouched; a push interrupted after the server committed (retry is harmless); an edit during a push stays queued; crash mid-pull (cursor and data consistent); newer schema stops without advancing; running session not pushed until it ends; `dailyGoal` paid on both devices counts once; plan-task duplicates healed after `sync.applied`; no level-up for synced XP; `waitForStartupSync` resolves at once when off.
- **Migration**: §4.7.4.
- **e2e** (`e2e/sync.spec.ts`; `e2e/support/fakeSupabase.ts` serves `https://forgetestforgetestfo.supabase.co` through `page.route`, GoTrue and PostgREST subsets over the same `syncServerModel`, one instance per test, shared by two browser contexts):
  - Sync off (also added to `smoke.spec.ts`): a full walk makes **no request** to `*.supabase.co`, and the sync engine chunk is never requested.
  - Set up: bad URL, service-role key and secret key messages; Check connection; send link (asserts the PKCE body and `redirect_to`); open `/settings/sync?code=…` → signed in, first sync, the seeded server rows appear on Today; the address loses `code`.
  - Code sign-in path; an expired link message; 429 on "Send again".
  - Two devices (two contexts): A adds and completes a task → B sees it done, XP once; B edits, A pulls; both offline edit the same task → the later wins on both; A trashes a goal → B's Trash has it, restore on B → back on A.
  - Offline: `route.abort` → "Offline…", pending count, recovers on `online`; Sync now.
  - Sign out keeps every row; reset with sync on leaves the fake server's rows.
  - Every spec still fails on console errors and page errors (`e2e/fixtures.ts`).
- **Bundle**: `npm run build` before/after: the entry chunk grows ≤ 2 KB gzip; the sync chunk is lazy.
- **SQL**: the text in README equals `setupSql.ts` (unit test). It was checked by hand on PostgreSQL 16 (above); there is no Postgres in CI.

#### 4.7.9 Work breakdown (12B)
Order matters: 12B1 touches shared data files and runs alone; 12B2 ∥ 12B4 after it; 12B3 after 12B2; 12B5–12B6 after 12B3 and 12B4.
Layer rule: features reach the sync data layer only through `@/db/repos/sync`, `@/db/repos/syncGate` and `@/db/hooks/useSyncState` (never `@/db/sync/*`); `logic/sync.ts` stays pure (no `fetch`, no `Date.now()`, no `crypto`).

| Step | Owner | Owns (creates or edits) | Accept |
|---|---|---|---|
| **12B1 Schema v3 + tracking** (alone, first) | [B], architect reviews the middleware | `src/db/migrations/{v3.ts,v3.test.ts,README.md}`, `src/db/{schema,types,db,defaults}.ts`, `src/db/sync/{tracking,tracking.test,stamp,remoteApply}.ts`, `src/logic/{syncTables,syncTables.test,schemaV3}.ts`, `src/logic/{backup,retention}.ts` (+ tests: v2→v3, `pre-sync` keep), `src/db/repos/{backup,xp,rewards}.ts` (+ tests: local tables out of backups, reset stops sync, deterministic XP and starter ids), `src/db/repos/settings.test.ts` (`sync` gone) | typecheck, lint, all unit tests; migration and middleware tests of §4.7.8; budgets with tracking on; entry chunk ≤ +2 KB gzip |
| **12B2 Pure sync logic** | [B] | `src/logic/{sync,syncConfig,syncServerModel}.ts` + `{sync,syncConfig,syncModel}.test.ts` | every pure case of §4.7.8, property test green in < 2 s |
| **12B3 Repo engine** | [B] | `src/db/repos/{sync,syncGate}.ts` + `sync.test.ts`, `src/db/hooks/useSyncState.ts`, `src/db/events.ts` (`sync.applied`), `src/test/{fakeSyncServer,devices}.ts`; handlers: `features/progress/handlers.ts`, `features/gamification/{handlers,badgeHandlers}.ts`, `features/goals/feature.ts` (gate + heal) | the repo scenarios of §4.7.8 |
| **12B4 Transport + auth** | [B] | `src/lib/pkce.ts` (+ test), `src/features/sync/supabase/{http,auth,rest}.ts` | unit tests for request building (pure parts in `logic/sync.ts`: URLs, bodies, headers per key kind) |
| **12B5 Engine + UI** | [B] | `src/features/sync/{feature,index,engine,leader,status,setupSql}.ts`, `SyncSection*.tsx`/`.module.css`, `SetupForm*`, `SignIn*`, `SyncStatus*`, `SyncLimits*`; one-line edits in `features/settings` (the import/restore/reset dialog lines), `features/onboarding` (the link), `features/resources` (the "PDFs stay on the device they were added on" wording) | screenshots light/dark × 1440/375 of each state (`scripts/shots/sync.ts`), designer glance |
| **12B6 CSP, docs, e2e** | [B] then [H] for README | `security-headers.mjs`, `e2e/{sync.spec.ts,support/fakeSupabase.ts}`, `e2e/smoke.spec.ts` (no-request guard), README "Sync (optional)": setup steps, the SQL, email templates, redirect URLs, sign-ups off, the limitation, erasing the cloud copy | §7 protocol green; reviewer pass [R] |

Follow-up, not in 12B: **12C (optional)** PDFs through Supabase Storage (bucket `forge-files`, object path `<uid>/<fileId>`, `storage.objects` RLS on the first path segment, upload on create, download on open; the CSP already allows the host).

---

## 5. Routes & keyboard shortcuts

### 5.1 Routes (`src/app/router/routes.ts`; history API; `:param?` = optional last segment)
| Name | Path | Owner feature | Phase |
|---|---|---|---|
| today | `/` | today | 3 |
| focus | `/focus` | focus | 4 |
| tasks | `/tasks/:list?` (inbox·upcoming·all·completed; query `layout=list\|board\|calendar`, `group`, `sort`, `tag`, `peek=<id>`) | tasks | 3 |
| taskView | `/tasks/views/:viewId` (saved view) | tasks | 3 |
| task | `/task/:taskId` | tasks | 3 |
| goals | `/goals` | goals | 5 |
| goalNew | `/goals/new` (wizard modal over list; refresh-safe) | goals | 5 |
| goal | `/goals/:goalId` | goals | 5 |
| course | `/goals/:goalId/courses/:courseId` | goals | 5 |
| cardReview | `/goals/:goalId/courses/:courseId/review` | flashcards | 11 |
| world | `/world` | world | 8 |
| progress | `/progress` | progress | 7 |
| weeklyReview | `/review/:weekStart?` | progress | 7 |
| rewards | `/rewards/:tab?` (shop·badges·history) | gamification | 6 |
| blocker | `/blocker` | blocker | 9 |
| settings | `/settings/:section?` (general·appearance·focus·blocker·data·sync) | settings | 1→10 |
| trash | `/trash` | safety | 11 |
| ritual | `/rituals/:kind` (morning·evening) | rituals | 11 |
| welcome | `/welcome` | onboarding | 10 |
| design | `/design` | design | 2 |
| notFound | `*` | app | 1 |

API: `href(name, params?, query?)`, `navigate(name, params?, {replace, query})`, `<Link to params query>` (plain `<a href>` whose modified clicks still open a new tab), `useRoute()` → `{name, params}`, `useQuery()`. Scroll goes to top on push. The document title is set per route.

### 5.2 Keyboard shortcuts (`mod` = ⌘ on macOS, Ctrl elsewhere; sequences have a 1 s window)
| Keys | Action | Scope | Phase |
|---|---|---|---|
| `mod+k`, `/` | Command palette (`/` opens it in search mode) | global (mod+k also in inputs) | 3 |
| `q`, `mod+enter` | Quick add (mod+enter submits instead when a modal form is open) | global | 3 |
| `?` | Shortcut sheet | global | 3 |
| `mod+\` | Toggle sidebar | global (in inputs too) | 1 |
| `esc` | Close overlay / exit full-screen / clear selection | all | 1 |
| `mod+z` | Undo last action (latest undo toast) | global (not in inputs) | 3 |
| `g t` `g f` `g i` `g u` `g a` `g g` `g w` `g p` `g r` `g b` `g s` | Go to Today, Focus, Inbox, Upcoming, All tasks, Goals, World, Progress, Rewards, Blocker, Settings | global | 1 |
| `shift+s` | Start focus on the "Now" task | global | 4 |
| `f` | Full-screen focus mode | global | 4 |
| `p` | Park a thought (only while a session runs) | global, focus, fullscreen | 11 |
| `space` / `enter` / `shift+n` / `m` / `1` `2` `3` | Start-pause / finish now / skip to next phase / mute ambient / mode pomodoro-custom-stopwatch | focus, fullscreen | 4 |
| `j` `k` or `↓` `↑` | Move selection | today, tasks | 3 |
| `x` | Complete or uncomplete the selected task | today, tasks | 3 |
| `enter` / `e` | Open task peek / edit title inline | today, tasks | 3 |
| `n` | New task inline in the current list / new goal on Goals | tasks, goal | 3/5 |
| `0`–`4` | Priority none…urgent | tasks | 3 |
| `t` / `m` / `d` / `#` | Due today / due tomorrow / pick date / edit tags | tasks | 3 |
| `s` | Start focus on the selected task | today, tasks | 4 |
| `alt+↑` `alt+↓` | Move the task up or down (keyboard alternative to drag) | tasks | 3 |
| `v l` `v b` `v c` | Switch layout to list, board or calendar | tasks | 3 |
| `mod+backspace` | Move the selected item to Trash (with undo) | tasks, goal | 3 |
| `←` `→` / `t` | Previous or next week / this week | calendar | 3 |
| `shift+r` | Rebalance now | goal | 5 |
| `i` | Import plan from Claude | goal | 5 |
| `space` then `1` `2` `3` `4` | Show answer, then Again / Hard / Good / Easy | cards | 11 |
| `mod+s` | Save the weekly review / ritual | review | 7/11 |
| `mod+enter` | Next step or finish in wizards and modal forms | modal | 3 |

Palette commands (grow per phase): Go to each page, New task, Start focus, Stop session, Start break, Toggle theme, Toggle sidebar, Toggle reduced motion, Show shortcuts, New goal, Import plan from Claude, Rebalance goals, Morning plan, Evening shutdown, Weekly review, Open trash, Export data, Download calendar (.ics), Park a thought. The palette also searches tasks, goals, courses and pages.

---

## 6. Phase checklist

Legend: **[A]** architect (opus) · **[D]** designer (opus) · **[B]** builder (sonnet) · **[R]** reviewer (sonnet) · **[H]** helper (haiku). `∥` = can run in parallel. **Owns** = the files that agent may create or edit; anything else needs a minimal edit that is reported. Each phase ends with the §7 protocol.

### Phase 0 — Plan
- [x] [A] `PLAN.md`, `DECISIONS.md`.

### Phase 1 — Foundation
- [x] **1A [B] Scaffold** (first, alone). Owns the root configs, `index.html`, `public/theme-init.js`, `src/main.tsx`, `src/vite-env.d.ts`, `netlify.toml`, `security-headers.mjs`, `.github/workflows/{ci,deploy}.yml`, `playwright*.config.ts`, `scripts/shoot.spec.ts`, `e2e/fixtures.ts`, `.gitignore`.
  - Exact deps from DECISIONS; `@playwright/test` pinned to `1.56.1`; never run `playwright install`.
  - Scripts: `dev`, `build` (`tsc -b && vite build`), `preview` (`vite preview --port 4173 --strictPort`), `typecheck` (`tsc -b`), `lint`, `test` (`TZ=America/New_York vitest`), `e2e`, `shoot`, `build:ext`, `zip:ext`, `format`.
  - TS: strict and `noUncheckedIndexedAccess`; aliases `@/`→`src/`, `@ext/`→`extension/src/shared/`.
  - ESLint flat config with the §1.1 layer rules, `no-explicit-any` and `no-console` as errors, react-hooks and jsx-a11y.
  - Vite plugin that writes `dist/_headers` from `security-headers.mjs`; `preview.headers` uses the same object.
  - Accept: `npm run typecheck && npm run lint && npm test -- --run && npm run build` pass; `npm run shoot` writes 4 PNGs of a hello page.
- [x] **1B [A] Data layer** (after 1A; ∥ 1C). Owns `src/db/{types,schema,db,defaults,events}.ts`, `src/db/repos/settings.ts`, `src/db/hooks/useSettings.ts`, `src/db/migrations/README.md`, `src/lib/ids.ts`, `src/logic/dates.ts` and their tests.
  - Accept (fake-indexeddb): all 26 tables open at v1; stamping hooks set and preserve timestamps; `ensureSettings` is idempotent; the event bus emits after commit; DST-safe `dates.ts` tests pass.
- [x] **1C [B] App shell** (∥ 1B; codes against the §3.2 Settings type and `useSettings()`). Owns `src/app/**`, `src/lib/{keys,localPrefs,platform}.ts`, `src/styles/{tokens,reset,global}.css` (brief tokens verbatim, extended by D in P2), `src/features/*/feature.ts` stubs (Placeholder routes), and `scripts/shots/shell.ts`.
  - Router with tests for matching and params.
  - Registry with `registry.test.ts`.
  - ShortcutProvider (`mod+\`, `g *`, `esc`).
  - Shell:
    - Sidebar is 240 px, resizable 200–400 and collapsible.
    - 640–1023 px: overlay drawer.
    - <640 px: bottom tab bar (Today, Focus, Goals, Progress, More) and a "+" FAB stub.
  - ThemeProvider mirrors theme to `localStorage` for no-flash boot.
  - Minimal root ErrorBoundary with "Export my data" (raw dump of all tables).
  - Hello Today page and a minimal Settings page with the theme select (replaced in P10).
  - Accept: every route renders its Placeholder with no console errors; the tab bar shows at 375; the sidebar toggles.
- [x] **1D [B] e2e smoke** (after 1B+1C). `e2e/smoke.spec.ts` visits every route, fails on console errors, checks theme switching and the mobile tab bar.
- [x] **1E [H] README** skeleton: what it is, dev commands, deploy notes.
- [ ] **1F Deploy (coordinator)** — ⏸ site created (`forge-study-app`, id `ae292093-4753-4fcf-886c-48bf406e202b`), but this cloud environment's egress policy blocks `api.netlify.com`/`*.netlify.app`; waiting on the user to allow those hosts or link the repo in Netlify's UI. Netlify site `forge-study-app`. A deep-link reload (`/goals/x`) serves the SPA, security headers are present, and the user is told about the optional `NETLIFY_AUTH_TOKEN`/`NETLIFY_SITE_ID` secrets.

### Phase 2 — Design system
- [x] **2A [D] Tokens & type** (first). Owns `src/styles/**` and the font import in `main.tsx`.
  - All brief colors in light and dark. Token selectors must work on **any element** (`:root, [data-theme=light]` / `[data-theme=dark]` + `prefers-color-scheme`), so `/design` can show both themes side by side.
  - 9 tag colors × bg/text × 2 themes; 6 accent presets (`data-accent`); spacing, radius, type scale, motion (`--dur-1/2/3`, `--ease`); focus ring; reduced-motion overrides.
  - Self-hosted Inter with `cv11`/`ss01`: the official `inter-ui` Latin subset, because Fontsource's Google build strips those features (DECISIONS).
  - `contrast.test.ts` parses the token files and asserts WCAG AA for every text/background pair, compositing rgba over its background.
- [x] **2B [D] Primitives** (after 2A): Button, IconButton, Input, Textarea (auto-grow), Checkbox (round/square), Tag, Kbd, Tooltip (with Kbd hints), Toggle, SegmentedControl, Tabs, ProgressBar, ProgressRing, Skeleton, EmptyState.
  - Each covers hover, active, focus-visible, disabled and `[data-force=hover|active|focus]` for demos.
  - Each has a demo file `src/features/design/sections/<X>.demo.tsx`.
- [x] **2C [B] Overlays** (∥ 2B, after 2A): Popover, Dropdown, Modal, and Toast plus ToastProvider with Undo and `aria-live`. Each owns its `src/ui/<X>/` folder and demo file.
- [x] **2D [B] Composites** (∥ 2B/2C): DatePicker (styled native date/time), CommandPalette (presentational), Breadcrumbs, PageHeader (emoji icon + gradient/image cover + editable title; cover presets without purple-blue gradients). Owns `src/ui/<X>/` and the demos.
- [x] **2E [B] `/design` page.** Owns `src/features/design/{feature.ts,DesignPage.tsx}`. It glob-loads the sections and renders each in light and dark columns, plus a theme and reduced-motion toggle.
- [x] **2F [D] Review.** Screenshot `/design` (both themes, 1440 and 375), compare with brief §3 honestly and fix. Accept: contrast test green, all 21 §3.6 components present, the designer signs off.

### Phase 3 — Tasks, Today, quick add, command palette
- [x] **3A [B] Tasks core** (wave 1). Owns `src/db/repos/{tasks,xp,trash}.ts`, `src/db/hooks/useTasks.ts`, `src/logic/{xp(task/session fns only),recurrence,taskQuery,tagColor}.ts` and their tests, and `src/features/tasks/**` except `views/Board*`, `views/Calendar*`, `SavedViews*`.
  - Repo API: `createTask`, `updateTask`, `completeTask→{xp,undo}` (XP event in the same transaction; the next recurring instance is created), `uncompleteTask`, `skipTask`, `moveTask`, `trashTask→{undo}`.
  - UI:
    - TaskRow with a hover `⋮⋮` handle and `…` menu.
    - Complete animation: checkbox fill, strikethrough, gold "+15 XP" float, slide-out after 600 ms, Undo toast.
    - Inline title edit.
    - Lists: Inbox, Upcoming, All, Completed, grouped by date or project, with sort and filter bar.
    - Task peek and page: all brief §5.3 fields, subtasks and recurrence. Notes use `BlockEditor` from 3C.
  - Shortcuts: `j k x e enter n 0-4 t m d # alt+↑↓ mod+backspace`. Search provider: tasks.
- [x] **3B [B] Quick add + palette** (wave 1). Owns `src/logic/{quickAdd,fuzzy}.ts` and tests, `src/features/quickadd/**`, `src/app/palette/**` and `src/app/shortcuts/ShortcutSheet.tsx`.
  - The parser handles `#tag`, `!low|med|high|urgent`, `~N`, today/tomorrow/weekdays/`next week`/`in N days`/dates, `2p`/`2:30pm`/`14:00`/`noon`, `every day|weekday|monday`, and `"quoted literal"`. It returns the title plus token spans for live chips, and a course link when a tag matches a known course code.
  - The brief's example must parse exactly (test).
  - Palette: fuzzy search over commands and search providers, recent items, groups.
  - `?` sheet lists all registered shortcuts.
- [x] **3C [B] BlockEditor** (wave 1). Owns `src/ui/BlockEditor/**` and `src/logic/blocks.ts` (inline `**bold**`/`*italic*`/`` `code` ``/links, tested).
  - Block types p/h1–h3/bullet/todo/callout/divider.
  - Slash menu (`/todo /heading /divider /callout /bullet`).
  - Keys: enter splits, backspace merges, arrows move between blocks.
- [x] **3D [B] Board + Calendar + saved views** (wave 2, after 3A). Owns `src/features/tasks/views/{Board*,Calendar*}`, `src/features/tasks/SavedViews*` and `src/db/repos/views.ts`.
  - Board: dnd-kit todo/doing/done columns with keyboard sensor and announcements.
  - Calendar: week view, drag to reschedule (pins scheduled tasks), `← → t`.
  - Saved views CRUD in the sidebar Tasks sub-nav slot.
- [x] **3E [B] Today** (wave 2, after 3A). Owns `src/features/today/**` and `src/logic/today.ts` (groupToday, pickNow; tests).
  - Greeting and date.
  - Now card with a Start focus button (wired in P4).
  - Groups: From your goals / Your tasks / Rolled over (amber + days overdue); completed today collapsed.
  - Slots `today.header/now/main/aside` rendered.
  - Empty, loading and error states.
- [x] **3F [B] e2e**: `e2e/{tasks,today}.spec.ts`.
  - Quick-add the brief example and assert the chips and task.
  - Complete, then undo (XP net 0).
  - Palette finds the task.
  - Keyboard drag on the board.
  - Calendar reschedule.
  - Also: inline title edit, `j/k/x`, trash with undo, and the shortcut-scope fix (blocking overlay scopes; regressions for the palette, dialogs, drawer and More sheet).

### Phase 4 — Focus timer
- [x] **4A [B] Timer & sessions** (∥ 4B). Owns `src/logic/timer.ts` and test, `src/db/repos/sessions.ts`, `src/db/hooks/useActiveSession.ts` and `src/features/focus/**`.
  - Modes: pomodoro 25/5 with long break 15 every 4 (all from settings), custom, stopwatch.
  - Worker ticks; `reconcileRunning`; XP (1/min, counted rule) in the same transaction; `session.ended` event.
  - Focus page: 96 px/600 tabular timer, ring, task link picker.
  - End dialog: "Done with this task?" → Yes / Keep going / Add note.
  - `F` full-screen overlay (timer + task name + subtle ring only) and the Fullscreen API.
  - Session log: start, end, task, planned vs actual, interrupted.
  - Slot contributions:
    - `sidebar.timer`: mini timer.
    - `today.header`: daily goal ring (pomodoros today / goal) and XP today.
    - `today.now`: Start focus hook-up.
  - Shortcuts: `shift+s f space enter shift+n 1 2 3 s`.
- [x] **4B [B] Sound & notifications** (∥ 4A). Owns `src/lib/audio/**`, `src/lib/notify.ts` and `src/features/focus/sound/**` (SoundSection for `settings.sections`, NotifyPrompt). 4A registers both in `focus/feature.ts`.
  - Generated brown noise, rain and café via Web Audio, plus a soft chime.
  - Notification permission asked once, gently, after the first completed session.
  - Contract with 4A: `playChime()`, `startAmbient(kind, vol)`, `stopAmbient()`, `notify(title, body)`.
- [x] **4C [B] e2e** `focus.spec.ts` with `page.clock`: fast-forward to the end (dialog shows, XP granted); reload mid-session keeps the remaining time; a session stopped at 50% is not counted.
  - Done: 24 tests. The clock starts at 09:30 (`page.clock.install`, pinned with `setSystemTime` once the page has loaded) and runs in real time; `fastForward` jumps the page's `Date.now()`; a reload freezes it with `setFixedTime` so the remaining time can be checked exactly. Covers the pomodoro to its end (dialog, +25 XP, log row 9:30–9:55, break offered), Yes, reload mid-session and paused, stop at 50%, pause and resume, full screen (`f`, Esc, focus trap and return, idle break label), stopwatch, `shift+s` from Today, the mini timer (sidebar and phone pill), the dialog after a refresh and in a second tab, Undo after an early stop, the break, skip break and the custom length.
  - Review nits fixed with it (20): exact 80% rule and 4 h stopwatch cap (`logic/timer.ts`), `endedAt` capped at the planned end and `reopenSession` (`repos/sessions.ts`), end-dialog queue and cross-tab sync, one elected tab plays the ambient bed, the audio unlocks only with sounds on, per-session notification tag, a PNG notification icon (`scripts/icons.mjs`, `npm run icons`), and the a11y and layout fixes in the focus screens.

### Phase 5 — Goals, scheduler, rebalancing, Claude import
- [x] **5A [A] Scheduler** (∥ 5B, 5C). Owns `src/logic/scheduler/**` and `rebalanceGoal`/`computeRemaining` wiring in `src/db/repos/goals.ts` (the section marked `// scheduling`). Implements §4 exactly with all §4.4 tests.
  - Done: 61 pure tests (`scheduler.test.ts`, `diff.test.ts`: every §4.4 case plus DST, per-weekday hours, pins, skip, idempotency, a 250-plan chunk-bounds property test, determinism, a 12-course year in ~1–4 ms) and 11 fake-indexeddb tests (`src/db/repos/goals.scheduling.test.ts`, including adopting the WGU sample's hand-written chunks by key).
- [x] **5B [B] Goals UI** (∥ 5A; codes against the §4.1 contract). Owns `src/features/goals/**` except `import/` and `src/db/repos/goals.ts` CRUD (cascade trash).
  - Goals list.
  - Wizard steps 1–3 (name/icon/cover/target; courses with code, CUs, OA/PA, hours, prereqs and units; per-weekday availability and days off; WGU terms).
  - Goal page: cover, icon, title, progress bar (% of hours), course database table (status, CUs, hours, due), BlockEditor notes.
  - Course page, breadcrumbs, and the `sidebar.nav.goals` tree.
- [x] **5C [B] Claude import** (∥ 5A, 5B). Owns `src/logic/planImport/**` (Zod schema, JSON line mapping, mapping to entities; tests) and `src/features/goals/import/**`.
  - Copy-prompt button with the template.
  - Paste textarea; per-line errors; preview table; import.
  - The schema is documented in the UI, generated from the schema.
  - Done: pure `parsePlan` (fence and prose tolerant, line and column of every syntax and schema error), `planToOps` (create or merge, idempotent, never deletes), `toPlanDraft` for the Goal Breakdown Planner review screen, and the prompt and schema reference generated from the Zod schema. The panel (`goal.panels`, `i`, palette) and `ImportGoalButton` (new goal) preview first and write only on the Import click, with Undo. Tests: 75 pure, 9 fake-indexeddb (`importPlan.test.ts`), 7 manifest, and `e2e/import.spec.ts` (13).
  - Open: `ImportGoalButton` is hosted by the `/design` demo (`PlanImport.demo.tsx`) until the goals list places it, then delete the demo and re-point `openNewGoalImport` in the e2e. Assessments in the JSON are validated and previewed but not stored (no table fits them).
- [ ] **5D [B] Integration** (after 5A and 5B).
  - Wizard step 4 preview: SVG Gantt timeline, "At this pace you'll finish on X", red impossible warning with h/day.
  - Goal page: "Now projected: Mar 14 (+9 days)" and the one-click catch-up.
  - Rebalance triggers and `onAppStart`.
  - `today.aside`: milestone countdown. Course complete gives +250 XP. "CUs completed this term" bar.
  - Shortcuts `n shift+r i`.
- [ ] **5E [B] e2e** `goals.spec.ts`: wizard with WGU sample → chunks appear on Today; import JSON with an error shows the line number; completing a course early moves the projection earlier.
- [x] **5F [A] Goal Breakdown Planner logic** (§4.5). Owns `src/logic/scheduler/{plannerTypes,windows,effort,split,slotBook,planner,milestones,feasibility,planDiff,reflow,autoSlot,plannerFixtures}.ts` and their tests, plus `src/logic/planParse/**`. Pure; no schema change. 65 new scheduler tests and 13 parse tests.
- [x] **5G [A] Schema v2 + wiring** (after 5B/5C land). Apply §4.6 (migration, backup migration, tests). Add a rows → `PlannerInput` adapter and a `diffPlanTasks` over `doDate/doTime/durationMinutes`; switch `rebalanceGoal` to `planStudy`. At first open each day, `rollForward` applies only when `autoApply`; otherwise it writes `planProposals`.
  - Done: `db/migrations/v2.ts` + pure `logic/schemaV2.ts` (shared by `logic/backup.ts` `migrateBackupV1toV2`); `STORES` = v1 + deltas; trash cascade and payloads cover the new tables. `logic/scheduler/goalSlots.ts` (`planGoalSlots`, `goalPlannerInput`, `goalLivePlan`) and `planTasks.ts` (`diffPlanTasks`, `planItemFields`, `currentPlanItems`, `planRevision`); `rebalanceGoal` runs the slot planner; `db/repos/planning.ts` (load rows, write a diff); `db/repos/proposals.ts` (`rollForwardGoal`, `proposeReplanWeek`, `applyProposal`/`dismissProposal` with Undo, `pendingProposals`, `runDailyPlanning` wired to the goals feature's `onAppStart`). Every `dueDate` consumer reads `doDate` (via `logic/taskDates.planDay`); "Carried over" with "from Tue"; a calm deadline chip; quick add `due/by/deadline`. Hooks: `logic/readinessPlan.ts`, `logic/practice.ts` (`wrongAnswerQueue`). Tests: migration (fake-indexeddb, v1 WGU sample), repos (scheduling, proposals, trash, tasks), pure (adapter, diff, hooks, mapping).
  - Left for 5H: the proposals banner and "Life happened" UI (the repo API is ready), the auto-slot toggle and applying `autoSlotTasks`, planning windows/shift/session/buffer editors (the minutes editors keep `planning.weekly` in step through `logic/goalPlanning.ts`), storing plan-import assessments in `plannedAssessments`.
- [ ] **5H [B] Planner UI** (after 5G). Paste/upload → `parsePlanText` → a review screen (edit, reorder, delete, self-rating, "We couldn't read these lines", and templates or the Claude prompt when `needsBreakdown`). Then availability windows, shift pattern, session length and buffer; a preview with feasibility and its three choices; the goal page's behind banner with proposals; "Life happened"; the task do-date/deadline split and the auto-slot toggle. PDF/photo upload is text extraction only (a dependency decision for 5H, recorded in DECISIONS).

### Phase 6 — Gamification
- [x] **6A [B] XP & levels** (∥ 6B, 6C). Owns `src/logic/xp.ts` (levels section), `src/db/hooks/useXp.ts` and `src/features/gamification/{feature.ts,Level*,XpFloat*,LevelUp*,handlers.ts}`.
  - `sidebar.footer` level meter ("Level 7 ▓▓▓░ 1,240/1,852 XP").
  - Level-up moment: square confetti in tag colors, under 1.5 s, sound, reduced-motion opacity fallback; watcher uses `lastCelebratedLevel`.
  - Daily-goal +25 handler.
- [x] **6B [B] Rewards shop** (∥). Owns `src/db/repos/rewards.ts` and `src/features/gamification/{Rewards*,Redemption*}`. Covers CRUD, buy (confirm, balance check, undo), history, and the `/rewards` tabs.
  - Done: `logic/rewards.ts` (price parsing, affordability, reorder plan, month totals; tests), `db/repos/rewards.ts` (`createReward`, `updateReward`, `archiveReward`/`unarchiveReward`, `reorderRewards`, `redeemReward` with `InsufficientXpError`, `refundRedemption`, `seedStarterRewards`; fake-indexeddb tests) and `db/hooks/useRewards.ts`. `features/gamification/{Rewards.feature.ts,RewardsPage,RewardsShop,RewardsCard,RewardsNewRow,RewardsInline,RewardsIconPicker,RewardsSortable,RewardsRedeemDialog,RewardsArchived,RewardsBalance,RewardsStates,RewardsActions,RewardsShortcuts,RedemptionHistory}`, `e2e/rewards.spec.ts`, `scripts/shots/rewards.ts`. Keys: `n` (scope `rewards`); palette: "New reward", "Go to Rewards shop", "Go to Redemption history".
- [x] **6C [B] Badges** (∥). Owns `src/logic/badges.ts` and test, `src/db/repos/badges.ts` and `src/features/gamification/Badge*`.
  - Definitions:
    - Early bird: session started before 08:00.
    - Night owl: session started 22:00–03:59.
    - Deep work: ≥4 counted sessions in one day.
    - Hours-100: ≥6000 counted minutes.
    - Comeback: qualifying again after an unfrozen break that ended a streak of ≥3.
    - Term complete: all courses in a term done.
  - Grid shows locked (grayscale + hint) and unlocked (date) states.
  - Handlers plus an `onAppStart` reconcile.
  - Done: `logic/badges.ts` (`evaluateBadges`, `BADGES`, `computeStreakForBadges` seam for 7A, display helpers; 76 tests incl. DST and re-evaluation stability), `db/repos/badges.ts` (`reconcileBadges`, `watchStreakDays`) and `db/hooks/useBadges.ts`, `features/gamification/{Badges.feature.ts,badgeHandlers.ts,BadgeUnlockToaster,BadgesGrid,BadgeCard,BadgeRecent (RecentBadges)}` (exported from `index.ts`), `e2e/badges.spec.ts`, `scripts/shots/badges.ts`. Palette: "Go to Badges".
- [x] **6D [D] Review** of the level-up moment, badges and shop screenshots.
  - Done: the level meter is one line over its bar, with a tooltip in the shop's words. The level-up has a 64px headline, a denser backdrop and `--confetti-*` tokens. Unaffordable rewards show a gold progress bar, phone rows keep Redeem inline, and the redeem confirmation is a phone bottom sheet (`Modal phoneLayout`). Locked badges share the card surface, with light-mode glyphs darkened (`--locked-glyph-filter`); phones get a single column; the tooltip uses 12-hour time. History lists same-instant purchases in a fixed order (monotonic `createdAt`), and each tab has its own error boundary. Screenshots are in `screenshots/6d/`. The shell has no collapsed rail, so a collapsed sidebar shows no level badge. *Phase 13 carry-over done: a level ring beside the open button (`sidebar.rail`), a level row in the phone's More sheet (`more.footer`), tighter shop rows on touch.*

### Phase 7 — Streaks, Progress, charts, weekly review
- [x] **7A [B] Streaks** (∥ 7B). Owns `src/logic/streaks.ts` and test, `src/db/repos/progress.ts`, `src/db/hooks/useStreak.ts` and `src/features/progress/{feature.ts,handlers.ts,Streak*}`.
  - streakDays handlers, `rebuildDays`, streak milestone XP.
  - Slots: sidebar flame 🔥 (`sidebar.footer`); `today.header` streak; `today.aside` 14-day mini heatmap.
  - Done: `logic/streaks.ts` (`computeStreak`, `isDayQualified`, `SCAN_DAYS`; 34 tests incl. freezes, week starts, DST, keys and a 400-day timing check) and `logic/streakDays.ts` (pure row building); `db/repos/progress.ts` (`rebuildDays`, `refreshDay`, `rebuildAll`, `needsFullRebuild`, `loadStreak`, `reconcileStreakMilestones`, tests on fake-indexeddb); `db/hooks/useStreak.ts` (`useStreak(today)`); `features/progress/{feature.ts (merges *.feature.ts), Streaks.feature.ts, handlers.ts, StreakFlame, StreakToaster}`; `computeStreakForBadges` now runs the engine. Today's streak stat and 14-day heatmap (❄️ on frozen days) read real data. `e2e/streaks.spec.ts`, `scripts/shots/streaks.ts`, `screenshots/7a/`. Palette: "Show streak" (`g p`).
- [x] **7B [B] Charts + Progress page** (∥ 7A; mock data until 7A lands). Owns `src/ui/charts/**`, `src/logic/stats.ts` and test, and `src/features/progress/{ProgressPage*,sections/*}`.
  - Year heatmap (❄️ on frozen days).
  - Charts: focus minutes per day (30 d), tasks per week, time per goal/course, hour histogram, estimate accuracy.
  - Hand-made SVG with `<title>`/`<desc>` and a visually hidden data table.
  - Done: `ui/charts/` (`ChartFrame`, `BarChart`, `Heatmap`, `HourHistogram`, `HBarList`, `AccuracyScatter`, `Sparkline`, pure `scale.ts`/`nav.ts`/`cluster.ts` with tests; exported from `ui/index.ts`); `logic/stats.ts` and `statsLabels.ts` (58 + 9 tests incl. DST, the autumn repeated hour and the spring missing hour); `features/progress/{ProgressPage*, queries.ts (+test), sections/*}` registered through `ProgressPage.feature.ts`; chart specimens in `/design` (Composites, "Charts"); `data/sample/progressSample.ts`; `e2e/progress.spec.ts` (+ `progressHistory.ts`), `scripts/shots/progress.ts`, `screenshots/7b/`. Shell edit: scope `progress` (`registry/types.ts`, `palette/shortcutList.ts`). Shortcuts `v g` / `v c`; palette "Show time per goal / course".
- [x] **7C [B] Weekly review** (after 7A). Owns `src/db/repos/reviews.ts` and `src/features/progress/WeeklyReview*`.
  - Wins, hours per goal, streak, "what got in the way?", and next week's plan preview.
  - Sunday prompt in `today.aside`.
  - Done: `logic/weeklyReview.ts` (`buildWeeklyReview`, `isReviewDay`, `resolveReviewWeek`; 36 tests incl. New York weekdays, both DST Sundays and the badge window), `db/repos/reviews.ts` (`saveReviewNote`, idempotent `completeWeeklyReview` +10 XP under `review:<weekStart>`, `loadReviewInput`; 17 tests on fake-indexeddb), `features/progress/{WeeklyReview.feature.ts, WeeklyReviewPage, WeeklyReviewNote (autosave), WeeklyReviewNextWeek, WeeklyReviewPrompt (`today.aside`), WeeklyReviewData/States}`, `e2e/weekly-review.spec.ts` (+ `reviewWeek.ts` seed), `scripts/shots/review.ts`, `screenshots/7c/`. Route `/review/:weekStart?`; palette "Weekly review"; `g v` (`g w` is My World's), `[` / `]` and `shift+d` on the page.
  - Integration fixes (same pass): the daily-goal toast e2e flake (the seeding page's start-up paid the goal; test now writes while the app is closed), one celebration queue (`logic/celebrations.ts`, `app/celebrate.ts`: streak XP + badge are one toast, nothing shows over the level-up moment), the More-sheet Esc flake (`pinned` drawer scope), and the extension specs out of the main Playwright config.
- [x] **7D [D] Review** of charts and heatmap visuals in both themes.
  - Done: one heat ramp as tokens (`--chart-heat-0..4`, `--chart-bar*`, per-theme knobs; ≥ 1.35:1 per step in every accent, checked in `contrast.test.ts`) shared by the year and 14-day heatmaps; 3:1 bars; the hour axis labels restored (`visibleTicks`); a drawn snowflake in neutral ink; tooltips stay out of the chart title; 2px datum ring; the estimate takeaway under its title in counts; phone sections stretch; warmer wins; flame tooltip "Your best yet". Screenshots in `screenshots/7d/` (incl. a 2x heatmap close-up). Decisions in DECISIONS.md "Chart and Progress review (7D)".

### Phase 8 — My World
- [x] **8A [B] World.** Owns `src/logic/world/**` and tests, and `src/features/world/**`.
  - `mulberry32` PRNG seeded from a constant.
  - Stable spiral placement: tiles are placed in completion order and existing ones never move.
  - Content: task → house/tree/lamp; focus hour → building floor; course → named landmark; degree → castle.
  - Streak adds animated details (lights, people, birds).
  - Isometric canvas renderer (DPR-aware), day/night from real time, hover/tap tooltip (what and when), PNG export, reduced-motion.
  - Tests: determinism, and append-stability.
  - Done: `logic/world/` (`types`, `prng`, `hash`, `spiral`, `layout`, `iso`, `sky`, `palette`, `camera`, `nav`, `ambient`, `text`; 11 test files, incl. the spec vectors, the 300-input no-overlap property test, order independence, append-stability, iso round-trip, depth sort); `features/world/engine/` (`sprites`, `canvasKit`, `renderer`, `input`, `mount`, README; sprite tests); `features/world/{WorldPage, WorldTooltip, LegendPopover, queries, feature}`; `db/repos/world.ts` (`ensureWorldSeed`, `loadWorldRows`, tests) with `settings.world.seed`; `e2e/world.spec.ts` (+ `worldHook.d.ts`), `scripts/shots/world.ts`, `screenshots/8a/`. 2,000 tasks and a 100-day streak: loads in under 2 s and pans at frame rate. Shell edits: `Shell.module.css` (full-bleed `world` route), scope `world`, `lib/download.ts` (`downloadBlob`), `playwright.shoot.config.ts` (`E2E_PORT`/`E2E_OUT`). Shortcuts `=` `-` `0` `e` on the page; palette "Zoom in / Zoom out / Fit / Export My World as PNG". Decisions in DECISIONS.md "My World".
- [x] **8B [D] Art direction** review and palette pass (tokens only).
  - Done: a calm dark-theme day and dusk sky, a lighter dark soil edge and walls, a gentler night overlay, AA tooltip date. Screenshots in `screenshots/8b/`. Open: phone "Fit" cannot show a grown city whole (integer zoom; see DECISIONS.md "Art direction pass (8B)"). *Phase 13 carry-over done: Fit shows the whole city at 375 and 768 (whole zoom first, a fraction only when none fits); see DECISIONS.md "Fit".*

### Phase 9 — Chrome extension + Blocker
- [ ] **9A [A] Protocol** (first, small). Owns `extension/src/shared/{protocol,config}.ts`: message types, guards, `APP_ORIGIN`, `DEFAULT_EXTENSION_ID`.
- [x] **9B [B] Extension** (∥ 9C) — from Gemini draft, reworked. Owns `extension/**` except `shared/{protocol,config}.ts`, and `scripts/{build-extension,extension-id}.mjs`.
  - Manifest:
    - MV3 with `"key"` = the public key in §8.
    - Permissions `declarativeNetRequest`, `storage`, `alarms`, `tabs`; host_permissions `*://*/*` (needed for redirects).
    - `web_accessible_resources: blocked.html`; `externally_connectable` as in §1.4.
    - `background.service_worker: sw.js` (type module); `action.default_popup`.
  - DNR dynamic rules: `requestDomains` + `main_frame` redirect to `/blocked.html?site=`; allow-exceptions at higher priority.
  - Modes: focus-only / schedule / always.
  - Emergency unlock: 60 s wait, the exact phrase, 5 min for that domain, logged.
  - `blocked.html` uses the app tokens and Inter: site, time left, current task, "Back to work", random motivation line.
  - Popup: status, time left, today's attempts, "Open Forge".
  - `shared/{domains,schedule}.ts` tests; a test that the manifest `key` hashes to `DEFAULT_EXTENSION_ID` and the origins match `APP_ORIGIN`.
- [x] **9C [B] App Blocker** (∥ 9B). Owns `src/db/repos/blocker.ts` and `src/features/blocker/**`.
  - Status: connected / not installed + install steps + ID override + deploy-preview note.
  - Mode and schedule editor; blocklist with favicons (letter fallback offline); allowlist; motivation lines editor.
  - Bridge; BlockerSync provider; event pulls.
  - "You tried Instagram 7 times today — that's 7 wins" (`today.aside` + page).
  - Unlock log section in `progress.sections`.
- [x] **9D [H] Release + docs.** `.github/workflows/extension-release.yml` (`npm ci && npm run zip:ext`, `gh release create extension-v<manifest version> forge-extension.zip`, or `upload --clobber` if the tag exists). README install steps (chrome://extensions → Developer mode → Load unpacked) and the phone note (iOS Screen Time / Android Digital Wellbeing links).
- [ ] **9E [B] e2e.** Try `launchPersistentContext` with `--load-extension=extension/dist`: instagram.com redirects to blocked.html offline, and `ping` from `localhost:4173` works. If extensions can't load headless here, record that in DECISIONS and rely on unit tests plus manual steps.

### Phase 10 — Onboarding, empty states, settings, data, PWA
- [x] **10A [B] Onboarding** (∥ 10B, 10C). Owns `src/features/onboarding/**` and `src/data/sample/**`.
  - 4 skippable steps: name + daily goal → distracting sites → optional first goal (WGU sample) → install extension.
  - Ends on Today with 3 starter tasks. Gate: `settings.onboardedAt`.
- [x] **10B [B] Settings & data** (∥). Owns `src/features/settings/**`, `src/logic/backup.ts` and test, and `src/db/repos/backup.ts` with a fake-indexeddb round-trip test.
  - Sections: theme, accent (6), timers, daily goal, week start, sounds and volume, notifications, reduced motion.
  - Data: export JSON; import (validate → pre-import snapshot → migrate → replace); reset with typed confirmation; weekly backup reminder toast.
  - Done: `features/settings/` (page with sticky section nav and `/settings/<slug>` deep links; Appearance with accent swatches and live preview, Focus, Calendar, Data, Blocker link; `SettingsHost` runs palette/`o b` exports, the import toast and the weekly reminder), `logic/backup.ts` (file format, validation, migration path, base64 files, reminder rules; 42 tests), `db/repos/backup.ts` (one-transaction export and replace, safety copy, reset; fake-indexeddb round trip and rollback tests), `e2e/settings.spec.ts`, `scripts/shots/settings.ts`. New: `settings.backup.lastRemindedAt`. Shortcuts `o b`, `o r`. Decisions in DECISIONS.md "Settings & data". Phase 11c adds its Snapshots list as slot contribution `safety.snapshots`.
- [x] **10C [B] PWA** (∥). Owns the `vite-plugin-pwa` block in `vite.config.ts`, `scripts/icons.mjs`, `public/icons/**` and `e2e/offline.spec.ts`.
  - `registerType: 'prompt'` with an "Update ready — reload" toast (never auto-reload mid-session).
  - Precache the app shell and fonts; `navigateFallback: '/index.html'`.
  - Manifest: `start_url: '/'`, standalone, theme colors.
  - Offline e2e: load, go offline, reload, the app works.
- [ ] **10D [D] State audit.** Empty, loading and error states on every screen; fix list; screenshots.

### Phase 11 — Extras (three waves of three parallel builders; everything plugs in via slots)
- [x] **Wave A**
  - [x] **11a [B] Parking lot** (`features/parking`, `repos/parking.ts`): `p` during focus opens a tiny input; review list in `focus.afterSession`; convert to task.
    - Done: `p` in the `focus` and `fullscreen` scopes and globally while a focus session runs, palette "Park a thought" / "Review parked thoughts"; end-dialog list (collapsible; Convert to task, Done, Delete, each with Undo); a Today aside card instead of a `/parking` route; buttons in the Focus aside and under the mini timer for touch. `e2e/parking.spec.ts`, `scripts/shots/parking.ts`. Decisions in DECISIONS.md "Parking lot & check-ins".
  - [x] **11b [B] Check-ins** (`features/checkins`, `repos/checkins.ts`, `logic/insights.ts` + test): focus 1–5 + mood after a session; best hours/days in `progress.sections`; sets `settings.scheduling.bestHour`, which the planner uses as the preferred start of the first study session of a day.
    - Done: "How was your focus?" in the end dialog (radiogroup, keys 1–5, optional mood), "When you focus best" card on Progress (needs 3 ratings in an hour), `bestHour` recomputed on every save, and `PlannerSettings.preferredStartMinutes` in `placeStudy` (a paced plan only, never at the cost of planned minutes; `preferredStart.test.ts`). `e2e/checkins.spec.ts`.
  - [x] **11c [B] Safety** (`features/safety`, `repos/snapshots.ts`, list/purge additions in `repos/trash.ts`, `logic/retention.ts` + test): Trash page (restore/purge), 30-day purge, daily snapshot keeping 7, restore in `settings.sections`, polished ErrorBoundary with export.
    - Done: `/trash` (grouped by type, search, Restore with Undo, Delete forever, typed Empty trash; a task trashed before its goal restores the goal too), `o t` / `o s` and palette entries, the calendar-day 30-day expiry and once-a-day purge, the idle daily snapshot (7 automatic, 5 of every other kind, gzip, no file bytes), Settings → Snapshots (list, Restore with a pre-restore snapshot and Undo, Download, Take snapshot now), the crash screen's Export/Copy details/Snapshots link. `e2e/trash.spec.ts`, `e2e/snapshots.spec.ts`, `scripts/shots/safety.ts`. Decisions in DECISIONS.md "Safety net".
- [x] **Wave B**
  - [~] **11d [B] Flashcards** *(deferred: hooks only, per the user's feature request of 2026-09-30; see DECISIONS › Phase 11 scope)* (`features/flashcards`, `repos/flashcards.ts`, `logic/{sm2,cardImport}.ts` + tests): SM-2 (grades Again=1, Hard=3, Good=4, Easy=5; EF floor 1.3); CSV/JSON import; review route; a daily "Review 18 C182 cards, ~10 min" task (source `flashcards`); `course.panels`.
  - [~] **11e [B] WGU readiness** *(deferred: hooks only, same reason)* (`features/readiness`, `repos/assessments.ts`, `logic/readiness.ts` + test): pre-assessment scores per competency area, weak areas (<70% highlighted), "Ready for OA?" (latest PA ≥ 80% and all units done), OA/PA attempt log; `course.panels`.
  - [x] **11f [B] Resources** (`features/resources`, `repos/{resources,files}.ts`, `logic/resources.ts` + test): links, PDFs (Blob in `files`, open in a new tab), notes, to-read/done; `course.panels`.
    - Done: the "Resources" panel on the course page (`course.panels`, order 30, lazy): links (http/https only, `rel="noopener noreferrer"`, title from host and path), PDFs (file button, drop on the panel or paste; 50 MB, real `%PDF-` bytes, stored as `application/pdf` in `files`; size shown; open through an object URL in a tab opened at the click, revoked after 60 s, download when blocked; a "space is running low" dialog before saving), plain-text notes; inline add and edit forms; to read / done checkbox with muted done rows; All · To read · Done tabs with counts (opens on To read while anything waits); reorder by drag or from the keyboard; delete to the Trash with Undo (the file goes with it; the Trash page restores a resource together with its course); loading, empty and error states, a toast on failure; a "File missing" row for a PDF that is not on the device. Palette: "Resources" search (lands on the course page at that row) and "Add a link / a PDF / a note to this course"; key `a` on a course page. Tests: 46 pure (`logic/resources.test.ts`), 33 on fake-indexeddb (`db/repos/resources.test.ts`, incl. course and goal trash cascades with bytes) and 7 (`files.test.ts`), `e2e/resources.spec.ts` (21), `scripts/shots/resources.ts`. Decisions in DECISIONS.md "Resources".
- [x] **Wave C**
  - [x] **11g [B] Rituals** (`features/rituals`, `repos/rituals.ts`): Morning plan (top 3, check goal work, set daily goal); Evening shutdown (review, move undone with one click, one-line reflection, +10 XP).
    - Done: `features/rituals/` (Morning plan and Evening shutdown as three-step dialogs, the gentle prompt and the pinned Top 3 in `today.header`, reflections in `progress.sections`, Rituals and Routines in `settings.sections`, the `/rituals/:kind` link), `repos/rituals.ts` (top 3, reflection, one-transaction `moveTasksToDay` with an exact undo, `completeEvening` +10 XP once per day and idempotent through undo), `logic/rituals.ts` (prompt rules, wording, dismissal; reuses `groupToday`/`oneListToday`), new setting `settings.rituals` (`prompts`, `morningUntil`, `eveningFrom`). Palette "Morning plan", "Evening shutdown", "Add routine…", "Save today’s tasks as a routine…"; shortcuts `w m`, `w e`, `w r`. Tests: `repos/rituals.test.ts`, `logic/rituals.test.ts`, `e2e/rituals.spec.ts`, `scripts/shots/rituals.ts`. Decisions in DECISIONS.md "Rituals".
  - [x] **11h [B] Calendar export** (`features/calendar`, `logic/ics.ts` + test): RFC 5545 with CRLF, 75-octet folding, escaping, stable UIDs `<taskId>@forge`, all-day milestones, timed study blocks from `dueTime` or stacked from `defaultStudyStart`. Download `.ics` and "Copy calendar text" (a live subscribe URL needs a server; see DECISIONS).
    - Done early, with the user's feature request (export): `logic/export/{ics,calendarEvents}.ts` + tests (CRLF, folding, escaping, stable UIDs, all-day milestones and assessments, timed study blocks, optional deadlines) and `features/export` (Settings → Export & calendar, `o i`, with download and copy of the calendar text). No `features/calendar` folder.
  - [x] **11i [B] Templates** (`features/templates`, `repos/templates.ts`, `src/data/templates/**`): WGU degree term, Learn a skill in 90 days, Certification exam prep; task templates for routines; used by the wizard and onboarding.
    - Done (by the 11g builder): the **routine task templates**. `repos/templates.ts` (task templates only: save, rename, delete and apply, each with Undo; the payload is validated with Zod in `logic/routines.ts`), two built-in starters ("Study day", "Weekly reset"), "Add routine…" in the palette and in Morning plan step (a), a "Routines" section in Settings. The goal templates were done earlier with the user's feature request as `PlanDraft`s in `logic/goalTemplates.ts` (WGU term, Certification, Semester course, Personal project, each tested to fit its own finish), offered on the planner's Start step and by onboarding's first-goal step (`?template=`); they live in code, not in the `templates` table.
- [x] **11j [R]** One review per wave; e2e for flashcards review and trash restore.
  - Done: wave A (11a–c) and wave B (11f, 11g) each had a reviewer pass; no blockers, and every should-fix and nit was fixed (trashed PDFs survive a snapshot restore; a refused Undo says why via `UndoRefusedError`; undo-twice, midnight and bundle fixes in rituals; touch targets and link validation in resources). Trash restore is covered by `e2e/trash.spec.ts`; the flashcards e2e is moot while 11d stays a hook. Full e2e on a quiet machine: 527/529, the two failures were a real keyboard-resize race (fixed: nudges read the stored task and run in turn) and a test that tried to catch a transient "saving" (now recorded with a MutationObserver).

### Phase 12 — Optional cloud sync (only if 0–11 are solid and the user wants it)
- [x] **12A [A] Design** (2026-09-30): **§4.7**. Plain `fetch` (supabase-js measured at 58 KB gzip and would be precached for everyone); the person's own project (URL + anon/publishable key in `syncState`); one `forge_rows` table with RLS, a last-write-wins trigger, a stamp clamp and a commit-ordered `seq` cursor (SQL verified on PostgreSQL 16); schema v3 = `syncOutbox` (Dexie middleware, tombstones included) + `syncState`; per-record LWW on a hybrid write stamp; first sync = merge with a `pre-sync` snapshot; files, snapshots and derived caches never sync; CSP `connect-src https://*.supabase.co`. Decisions in DECISIONS.md "Cloud sync (Phase 12A)".
- [ ] **12B [B] Implement** in the six steps of §4.7.9 (12B1 schema v3 + tracking, alone first — **done 2026-09-30 by the architect**: v3 migration and tests, `db/sync/{tracking,remoteApply}.ts` + `tracking.test.ts`, `logic/{syncTables,schemaV3}.ts`, deterministic XP and starter-reward ids, backup/reset changes, tracking-on budgets; entry JS +1.45 KB gzip; 12B2 pure logic ∥ 12B4 transport; 12B3 repo engine; 12B5 engine + Settings UI; 12B6 CSP, e2e, README). The app must work 100% without it, and the entry chunk grows ≤ 2 KB gzip.
  - [x] **12B1** schema v3 + tracking (architect; finished and reviewed in the sync workflow): `db/sync/{stamp,tracking,remoteApply}.ts`, strictly increasing outbox stamps across tabs, the `seen` broadcast, `defaultSyncState()`, lossless idempotent v2→v3 (fixture test), tracking-on budgets. Everything `index.html` loads: +1.7 KB gzip for 12B1 (entry chunk itself −49 B).
  - [x] **12B2** pure logic: `logic/{sync,syncConfig,syncServerModel}.ts` + 223 tests incl. four seeded property tests (~1.1 s). Review blocker fixed: bootstrap no longer re-queues rows it just adopted.
  - [x] **12B4** transport + auth: `lib/pkce.ts` (RFC 7636 vector), `logic/syncRequests.ts` (pure request building; moved out of `logic/sync.ts` to avoid a clash with 12B2), `features/sync/supabase/{http,auth,rest}.ts`; 162 tests with a fake fetch. Text is scrubbed of lone surrogates and NUL before a push (jsonb refuses them). Untested against a live Supabase project.
  - [x] **12B3** repo engine: `db/repos/{sync,syncGate,syncHeal}.ts` (+ `sync.test.ts`, 68 scenarios incl. two-device and budgets), `db/hooks/useSyncState.ts`, `sync.applied` in `db/events.ts`, `logic/syncApply.ts`, `src/test/{fakeSyncServer,devices}.ts`; handlers in progress, badges and goals. Entry JS +333 B gzip. Decisions in DECISIONS.md "Cloud sync (Phase 12B3)".
  - [ ] **12B5** engine + Settings UI, **12B6** CSP, e2e, README.
- [ ] **12C (optional, later)** PDFs through Supabase Storage (§4.7.9 follow-up).

### Phase 13 — Polish
- [ ] **13A [D]** Every route at 375, 768 and 1440 in light and dark with seeded data; fix list.
- [ ] **13B [B]** Keyboard-only walkthrough in `e2e/keyboard.spec.ts`; fix focus traps and order.
- [ ] **13C [B]** Lighthouse with `npx lighthouse` (no dependency) against the preview using `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`: Performance ≥ 90, Accessibility ≥ 95. Bundle budget: initial JS ≤ 180 KB gzip.
- [x] **13P [A] Performance at a year of study** (done early, 2026-09-30): `?seed=wgu-year` (2,000 finished + ~300 open sessions on one goal); budgets in `src/db/repos/budgets.test.ts` (CPU, `src/test/timing.ts`) and `e2e/perf.spec.ts` (Chrome thread time): start interactive < 1.5 s, `rebalanceGoal` < 300 ms, a completion painted < 100 ms. Structural sharing of live queries, progressive task lists, per-row completion motion. See DECISIONS › Performance.
- [x] **13E [B] Carry-overs from 6B, 6D and 8B** (gamification, world, layout; done 2026-09-30): the level where the sidebar is not (ring beside the open button, row in the More sheet, same `useXp()`), Shop rows tightened on `(pointer: coarse)` with 44 px targets kept, and My World Fit that shows the whole city at 375 and 768. Specs: `e2e/gamification-level.spec.ts`, `e2e/rewards.spec.ts`, `e2e/world.spec.ts`, `src/logic/world/camera.test.ts`. Decisions in DECISIONS.md "Phase 13 carry-overs" and "Fit".
- [ ] **13D [H]** README final: screenshots copied to the committed `docs/screenshots/`, PWA install on phone, extension install, backup/restore, WGU import prompt. Tick every box in this file.

---

## 7. Verification protocol (every phase, before commit)

1. **Static:** `npm run typecheck` · `npm run lint` · `npm test -- --run`. All green; no `any` and no `console.*`.
2. **Build:** `npm run build`. No warnings about chunk size over budget; check new dependencies against DECISIONS.
3. **e2e:** `npm run e2e`. The webServer builds and serves `vite preview` on :4173 with production headers (CSP). Specs fail on any `console.error` or `pageerror`, which `e2e/fixtures.ts` hooks for every test.
4. **Screenshots:** `SHOOT=<feature,…> npm run shoot`.
   - Playwright opens `http://localhost:4173/?seed=wgu` (or `?seed=empty` for empty states) with `page.clock` fixed at `2026-09-29T09:30` America/New_York.
   - It captures light and dark (`colorScheme`) × 1440×900 and 375×812 into git-ignored `screenshots/<phase>/<feature>-<route>-<theme>-<w>.png`. Phase 13 adds 768.
   - Shot lists live in `scripts/shots/<feature>.ts`.
5. **Look at them.** The designer (UI-heavy phases) or reviewer opens the PNGs with Read and checks brief §3 and §9 honestly: tokens only, hierarchy from type and spacing, hover/focus states, empty/loading/error states, no horizontal scroll at 375, 44 px tap targets. Fix, then reshoot.
6. **Reviewer pass** [R] on the diff; fix every BLOCKER.
7. **Docs:** tick the boxes here, add dated bullets to DECISIONS for any new choice or dependency, and have [H] update the README when user-facing.
8. **Commit + push** to `claude/sharp-thompson-tklurt` (one commit per sub-task is fine, at least one per phase). Deploy to Netlify for the user to try (production deploy by the coordinator, or `deploy.yml` on merge to `main`).

**Subagent invocation:** the coordinator spawns the typed agents from `.claude/agents/` (architect/designer → opus, builder/reviewer → sonnet, helper → haiku). Parallel builders get disjoint **Owns** lists from §6. If a shared file must change, the coordinator serializes that edit.

---

## 8. Constants to carry into code

```
APP_ORIGIN           = https://forge-study-app.netlify.app      (extension/src/shared/config.ts; src/config.ts re-exports)
DEFAULT_EXTENSION_ID = gpinhblnpebjbiodblihfpjbffacipbd
EXTENSION_ZIP_URL    = https://github.com/sdfkdweuwpor/forge-study-app/releases/latest/download/forge-extension.zip (private repo → needs GitHub login)
Dev/preview origins  = http://localhost:5173, http://localhost:4173 (both match http://localhost/*)
```
Extension manifest `"key"` (public key only; the private key was discarded because unpacked loading doesn't need it):
```
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtzlniRJfA7SNvBCwMwTedIzTiprS7b3UoM+HTo3Og9aDBYycXih7YNq1Jfr1282dFEO2R7R9qaGX99aXijiVf6XaxkGcjCb4o3jF60EX3d8+WtID8EJ8wGhkyAXKvHfeEC8kEIsefGdcsSx8ypG/M/FIuvhg5xoZHQ32mIfn7CNHkKSPGFFJuZRZiselXkMiJ3uizEUsGKdOG0WvZ3jt026PyhuRD5974Hpxl3pYZQ24/CX5FFIlVu7MdemdFwJ2HuUGJWmy7S6vXNjA+O6hGyl0UOq00NEHcdxvPgQf06WcAXTDYlccvdwffG7AUKc1EsZC+a4JIGsr538LEb26ZwIDAQAB
```
Check: `base64 -d key | sha256sum | head -c32 | tr 0-9a-f a-p` → `gpinhblnpebjbiodblihfpjbffacipbd` (verified 2026-09-29).
