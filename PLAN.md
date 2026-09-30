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

**Slot ids (fixed in Phase 1; props in parentheses):** `sidebar.footer`, `sidebar.timer`, `sidebar.nav.tasks`, `sidebar.nav.goals`, `shell.rightPanel`, `global.overlays`, `today.header`, `today.now`, `today.main`, `today.aside`, `focus.aside`, `focus.afterSession ({sessionId})`, `goal.header ({goalId})`, `goal.panels ({goalId})`, `course.panels ({goalId, courseId})`, `progress.sections`, `rewards.tabs`, `blocker.sections`, `settings.sections`.

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
   │   ├─ migrations/ README.md (how to add vN)   # future: v2.ts …
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
  sync: { enabled: boolean; url: string | null; anonKey: string | null; lastSyncAt: Millis | null };
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
  - Done: the level meter is one line over its bar, with a tooltip in the shop's words. The level-up has a 64px headline, a denser backdrop and `--confetti-*` tokens. Unaffordable rewards show a gold progress bar, phone rows keep Redeem inline, and the redeem confirmation is a phone bottom sheet (`Modal phoneLayout`). Locked badges share the card surface, with light-mode glyphs darkened (`--locked-glyph-filter`); phones get a single column; the tooltip uses 12-hour time. History lists same-instant purchases in a fixed order (monotonic `createdAt`), and each tab has its own error boundary. Screenshots are in `screenshots/6d/`. The shell has no collapsed rail, so a collapsed sidebar shows no level badge.

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
- [ ] **7D [D] Review** of charts and heatmap visuals in both themes.

### Phase 8 — My World
- [x] **8A [B] World.** Owns `src/logic/world/**` and tests, and `src/features/world/**`.
  - `mulberry32` PRNG seeded from a constant.
  - Stable spiral placement: tiles are placed in completion order and existing ones never move.
  - Content: task → house/tree/lamp; focus hour → building floor; course → named landmark; degree → castle.
  - Streak adds animated details (lights, people, birds).
  - Isometric canvas renderer (DPR-aware), day/night from real time, hover/tap tooltip (what and when), PNG export, reduced-motion.
  - Tests: determinism, and append-stability.
  - Done: `logic/world/` (`types`, `prng`, `hash`, `spiral`, `layout`, `iso`, `sky`, `palette`, `camera`, `nav`, `ambient`, `text`; 11 test files, incl. the spec vectors, the 300-input no-overlap property test, order independence, append-stability, iso round-trip, depth sort); `features/world/engine/` (`sprites`, `canvasKit`, `renderer`, `input`, `mount`, README; sprite tests); `features/world/{WorldPage, WorldTooltip, LegendPopover, queries, feature}`; `db/repos/world.ts` (`ensureWorldSeed`, `loadWorldRows`, tests) with `settings.world.seed`; `e2e/world.spec.ts` (+ `worldHook.d.ts`), `scripts/shots/world.ts`, `screenshots/8a/`. 2,000 tasks and a 100-day streak: loads in under 2 s and pans at frame rate. Shell edits: `Shell.module.css` (full-bleed `world` route), scope `world`, `lib/download.ts` (`downloadBlob`), `playwright.shoot.config.ts` (`E2E_PORT`/`E2E_OUT`). Shortcuts `=` `-` `0` `e` on the page; palette "Zoom in / Zoom out / Fit / Export My World as PNG". Decisions in DECISIONS.md "My World".
- [ ] **8B [D] Art direction** review and palette pass (tokens only).

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
- [ ] **10A [B] Onboarding** (∥ 10B, 10C). Owns `src/features/onboarding/**` and `src/data/sample/**`.
  - 4 skippable steps: name + daily goal → distracting sites → optional first goal (WGU sample) → install extension.
  - Ends on Today with 3 starter tasks. Gate: `settings.onboardedAt`.
- [ ] **10B [B] Settings & data** (∥). Owns `src/features/settings/**`, `src/logic/backup.ts` and test, and `src/db/repos/backup.ts` with a fake-indexeddb round-trip test.
  - Sections: theme, accent (6), timers, daily goal, week start, sounds and volume, notifications, reduced motion.
  - Data: export JSON; import (validate → pre-import snapshot → migrate → replace); reset with typed confirmation; weekly backup reminder toast.
- [ ] **10C [B] PWA** (∥). Owns the `vite-plugin-pwa` block in `vite.config.ts`, `scripts/icons.mjs`, `public/icons/**` and `e2e/offline.spec.ts`.
  - `registerType: 'prompt'` with an "Update ready — reload" toast (never auto-reload mid-session).
  - Precache the app shell and fonts; `navigateFallback: '/index.html'`.
  - Manifest: `start_url: '/'`, standalone, theme colors.
  - Offline e2e: load, go offline, reload, the app works.
- [ ] **10D [D] State audit.** Empty, loading and error states on every screen; fix list; screenshots.

### Phase 11 — Extras (three waves of three parallel builders; everything plugs in via slots)
- [ ] **Wave A**
  - **11a [B] Parking lot** (`features/parking`, `repos/parking.ts`): `p` during focus opens a tiny input; review list in `focus.afterSession`; convert to task.
  - **11b [B] Check-ins** (`features/checkins`, `repos/checkins.ts`, `logic/insights.ts` + test): focus 1–5 + mood after a session; best hours/days in `progress.sections`; sets `settings.scheduling.bestHour`, which is used as the default `dueTime` for the first goal chunk of the day.
  - **11c [B] Safety** (`features/safety`, `repos/snapshots.ts`, list/purge additions in `repos/trash.ts`, `logic/retention.ts` + test): Trash page (restore/purge), 30-day purge, daily snapshot keeping 7, restore in `settings.sections`, polished ErrorBoundary with export.
- [ ] **Wave B**
  - **11d [B] Flashcards** (`features/flashcards`, `repos/flashcards.ts`, `logic/{sm2,cardImport}.ts` + tests): SM-2 (grades Again=1, Hard=3, Good=4, Easy=5; EF floor 1.3); CSV/JSON import; review route; a daily "Review 18 C182 cards, ~10 min" task (source `flashcards`); `course.panels`.
  - **11e [B] WGU readiness** (`features/readiness`, `repos/assessments.ts`, `logic/readiness.ts` + test): pre-assessment scores per competency area, weak areas (<70% highlighted), "Ready for OA?" (latest PA ≥ 80% and all units done), OA/PA attempt log; `course.panels`.
  - **11f [B] Resources** (`features/resources`, `repos/{resources,files}.ts`): links, PDFs (Blob in `files`, open in a new tab), notes, to-read/done; `course.panels`.
- [ ] **Wave C**
  - **11g [B] Rituals** (`features/rituals`, `repos/rituals.ts`): Morning plan (top 3, check goal work, set daily goal); Evening shutdown (review, move undone with one click, one-line reflection, +10 XP).
  - **11h [B] Calendar export** (`features/calendar`, `logic/ics.ts` + test): RFC 5545 with CRLF, 75-octet folding, escaping, stable UIDs `<taskId>@forge`, all-day milestones, timed study blocks from `dueTime` or stacked from `defaultStudyStart`. Download `.ics` and "Copy calendar text" (a live subscribe URL needs a server; see DECISIONS).
  - **11i [B] Templates** (`features/templates`, `repos/templates.ts`, `src/data/templates/**`): WGU degree term, Learn a skill in 90 days, Certification exam prep; task templates for routines; used by the wizard and onboarding.
- [ ] **11j [R]** One review per wave; e2e for flashcards review and trash restore.

### Phase 12 — Optional cloud sync (only if 0–11 are solid and the user wants it)
- [ ] **12A [A] Design:** decide on `@supabase/supabase-js`, lazy-loaded, vs plain `fetch`. Add tombstones as schema **v3** (v2 is the planner schema, §4.6). Per-record last-write-wins on `updatedAt`, with the limitation documented. RLS policy SQL goes in the README. CSP `connect-src` gets the Supabase origin.
- [ ] **12B [B] Implement** `features/sync` (magic-link login, settings section, push/pull, conflict tests in `logic/sync.ts`). The app must work 100% without it.

### Phase 13 — Polish
- [ ] **13A [D]** Every route at 375, 768 and 1440 in light and dark with seeded data; fix list.
- [ ] **13B [B]** Keyboard-only walkthrough in `e2e/keyboard.spec.ts`; fix focus traps and order.
- [ ] **13C [B]** Lighthouse with `npx lighthouse` (no dependency) against the preview using `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`: Performance ≥ 90, Accessibility ≥ 95. Bundle budget: initial JS ≤ 180 KB gzip.
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
