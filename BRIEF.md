# Build "Forge" — a premium focus, study & long-term goal app

You are building a personal productivity app for me. I'm using Claude Code on the web (my laptop is closed), so work in a GitHub repo, commit often, and deploy so I can use it from any device. Read this whole brief before writing code. Build it in the phases at the bottom and don't skip the verification steps.

The bar for quality: it should feel like **Notion, Linear and Things 3 had a baby**. It should be calm, dense with information without feeling cluttered, keyboard-first, and fast. It should never look like a template, a Bootstrap page or a generic "AI dashboard" with purple gradients.

---

## 1. Product overview

Forge has 4 jobs:
1. **Protect focus.** It blocks distracting sites (Instagram, TikTok, etc.) during focus sessions using a companion Chrome extension.
2. **Plan the day.** Tasks, focus sessions and a clear "what do I do right now" view.
3. **Break big goals into daily steps.** Example: a WGU bachelor's degree (1+ year). The app turns it into courses → milestones → small daily tasks, schedules them, and rebalances when I fall behind.
4. **Make progress feel rewarding.** XP, levels, streaks, badges, custom rewards I can "buy", and a visual world that grows as I finish work.

Single user (me). No login. Works offline.

---

## 2. Tech stack (keep it lean)

- **Vite + React + TypeScript** (strict mode)
- **Styling:** plain CSS with CSS custom properties (design tokens) + CSS modules. No Tailwind, no UI kit. The design system in section 3 *is* the UI kit.
- **Storage:** IndexedDB via **Dexie** (years of sessions and tasks will outgrow localStorage). Every table has `id`, `createdAt` and `updatedAt`.
- **Icons:** `lucide-react` only.
- **Drag & drop:** `@dnd-kit/core` + `@dnd-kit/sortable`
- **Dates:** native `Intl` + `Temporal` polyfill or `date-fns`. Pick one and stick with it.
- **Tests:** Vitest for logic, Playwright for end-to-end.
- **PWA:** `vite-plugin-pwa` (installable, works offline).
- **Deploy:** GitHub Pages through a GitHub Actions workflow on push to `main`.
- Don't add any other dependency without writing one line in `DECISIONS.md` explaining why a few lines of code couldn't do it.

---

## 3. Design system — this is the most important section

### 3.1 Principles
- **Content first.** Chrome (borders, backgrounds, shadows) should almost disappear. Hierarchy comes from typography and spacing, not boxes.
- **Quiet by default, alive on interaction.** Hover shows controls, focus rings are crisp, and actions give instant feedback.
- **One accent color**, used sparingly: the primary action, the active state and progress.
- **Every screen has a well-designed empty state, loading state and error state.**
- **Keyboard-first:** every main action has a shortcut, and the command palette reaches everything.

### 3.2 Color tokens (define on `:root`, dark mode via `[data-theme="dark"]` + `prefers-color-scheme`)
Light (warm neutral, Notion-like):
```
--bg:            #FFFFFF
--bg-sidebar:    #F7F7F5
--bg-hover:      rgba(55,53,47,0.06)
--bg-active:     rgba(55,53,47,0.09)
--bg-elevated:   #FFFFFF
--text:          #37352F
--text-muted:    rgba(55,53,47,0.65)
--text-faint:    rgba(55,53,47,0.45)
--border:        rgba(55,53,47,0.09)
--border-strong: rgba(55,53,47,0.16)
--accent:        #2383E2
--accent-soft:   rgba(35,131,226,0.10)
--success:       #0F7B6C
--warning:       #D9730D
--danger:        #E03E3E
--xp:            #CB912F   (gold, used for XP/rewards only)
--shadow-pop:    0 0 0 1px rgba(15,15,15,.05), 0 3px 6px rgba(15,15,15,.10), 0 9px 24px rgba(15,15,15,.20)
```
Dark:
```
--bg: #191919  --bg-sidebar: #202020  --bg-elevated: #252525
--text: rgba(255,255,255,0.87)  --text-muted: rgba(255,255,255,0.55)  --text-faint: rgba(255,255,255,0.35)
--border: rgba(255,255,255,0.08)  --bg-hover: rgba(255,255,255,0.055)
```
Plus Notion-style tag colors (gray, brown, orange, yellow, green, blue, purple, pink, red) with a soft background + text pair for each, in both themes. Check that all text meets WCAG AA contrast.

### 3.3 Typography
- UI font: **Inter** (self-hosted, `font-feature-settings: "cv11","ss01"`), fallback `ui-sans-serif, -apple-system, "Segoe UI"`.
- Numbers (timer, XP, stats): `font-variant-numeric: tabular-nums`.
- Scale: 12 / 14 (base UI) / 16 (body) / 20 / 24 / 32 / 40 (page titles, weight 700, letter-spacing -0.02em).
- Line height 1.5 for body, 1.2 for headings.
- The timer uses a large display size (e.g. 96px, weight 600, tabular numbers).

### 3.4 Spacing, radius, layout
- 4px spacing scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Radius: 4px (inputs, tags), 6px (buttons, menu items), 10px (cards, popovers), 14px (modals).
- Page content max width 900px, centered, with generous top padding (like a Notion page).
- Sidebar 240px, resizable (200–400), collapsible with `Ctrl/Cmd + \`.

### 3.5 Motion
- Durations: 120ms (hover/press), 200ms (popovers), 280ms (page and modal transitions). Easing `cubic-bezier(0.2, 0, 0, 1)`.
- Task complete: the checkbox fills, a strikethrough animates across, a small "+15 XP" floats up in gold and fades, then the row slides out after 600ms (with an Undo toast).
- Level up: a centered, tasteful full-screen moment (confetti made of small squares in the tag colors, lasting under 1.5s) plus a sound.
- Respect `prefers-reduced-motion`: fall back to opacity-only transitions.

### 3.6 Core components (build these first, in `src/ui/`, and use them everywhere)
Button (primary / secondary / ghost / danger; sm / md), IconButton, Input, Textarea (auto-grow), Checkbox (round for tasks, square for settings), Tag/Pill, Dropdown menu, Popover, Tooltip (with shortcut hints like `⌘K`), Modal, Toast (with Undo), Progress bar, Progress ring, Tabs, Segmented control, Toggle, Date picker (native input styled to match), Empty state (icon + title + one line + action), Skeleton loader, Kbd (shows a key), Command palette.

Every interactive element has hover, active, focus-visible and disabled states. Make a `/design` route that shows every component in every state in both themes. This is how you check your own work.

### 3.7 Signature Notion-like interactions
- **Command palette** (`Cmd/Ctrl + K`): fuzzy search across tasks, goals and pages, plus actions ("Start focus", "New task", "Toggle theme").
- **Quick add** (`Q` or `Cmd+Enter` anywhere): a one-line task input with natural-language parsing: `Read chapter 4 tomorrow 2p #C182 !high ~2` → due tomorrow at 2pm, tag C182, high priority, 2 pomodoros. Show the parsed pieces as live chips while I type.
- **Inline editing everywhere:** click a title to edit it. No "edit" modals for simple fields.
- **Slash menu** in notes (`/todo`, `/heading`, `/divider`, `/callout`) for the goal and course notes pages.
- **Page icons + covers:** each goal/course page has an emoji icon and an optional cover (gradient presets or an uploaded image), like Notion.
- **Hover-reveal handles:** a `⋮⋮` drag handle and `…` menu appear on row hover.
- **Breadcrumbs** at the top: `Goals / WGU B.S. Computer Science / C182 Intro to IT`.

### 3.8 Responsive / mobile
- ≥1024px: sidebar + content (+ optional right panel for the timer).
- 640–1023px: sidebar becomes an overlay drawer.
- <640px: bottom tab bar (Today, Focus, Goals, Progress, More), a floating "+" button for quick add, 16px side padding, 44px minimum tap targets, and no horizontal scrolling anywhere.

### 3.9 Accessibility
Semantic HTML, full keyboard navigation, visible focus rings (2px accent, 2px offset), `aria-live` for the timer and toasts, labels on every icon button, and a reduced-motion setting.

---

## 4. Information architecture (sidebar)

```
[Forge logo]           [search ⌘K]
  ☀️  Today
  ⏱  Focus
  ✅  Tasks          (Inbox, Upcoming, All, Completed)
  🎯  Goals          (expandable tree: goal → courses/milestones)
  🏙  My World
  📈  Progress
  🎁  Rewards
  ─────────
  🛡  Blocker
  ⚙️  Settings
[Level 7 ▓▓▓▓░░ 1,240/1,800 XP]   [🔥 12]
```

---

## 5. Features in detail

### 5.1 Today (home)
- Greeting with the date ("Good morning — Tuesday, Sept 29").
- **"Now" card:** the single next task + a big "Start focus" button.
- Today's tasks grouped as *From your goals* / *Your tasks* / *Rolled over* (in amber, with the number of days overdue).
- Daily goal ring (e.g. 4 of 6 pomodoros) + streak flame + XP earned today.
- Upcoming milestone countdown ("C182 target: 12 days").
- A 14-day mini heatmap.

### 5.2 Focus sessions
- Modes: Pomodoro (default 25/5, long break 15 every 4 rounds; all adjustable), custom length, and open-ended stopwatch.
- Link a session to a task (optional). When it ends, ask "Done with this task?" → Yes / Keep going / Add note.
- **Full-screen focus mode** (`F`): only the timer, the current task name and a subtle progress ring. Nothing else.
- Optional ambient sound (brown noise, rain, café) made with the Web Audio API (generated, no audio files).
- Soft chime at the end + browser notification (ask permission once, nicely).
- The timer survives a page refresh (store the start timestamp, not a counter).
- Session log: start, end, task, planned vs. actual minutes, interrupted yes/no.
- Tell the extension when a session starts and ends (see 5.8).

### 5.3 Tasks
Fields: title, notes (rich text), due date/time, priority (none/low/med/high/urgent), estimate in pomodoros, tags, goal/course link, subtasks, recurring rule (daily / weekdays / weekly / custom), status (todo/doing/done), completedAt.

Views: **List** (grouped by date or by project), **Board** (todo / doing / done, drag between columns), **Calendar** (week view, drag to reschedule). Sorting, filtering and saved views like Notion databases.

### 5.4 Goals → daily tasks (the core of the app)
Structure: **Goal → Courses/Milestones → Units → Daily tasks.**

Creating a goal (a clean multi-step modal wizard):
1. Name, icon, cover, target end date.
2. Add milestones/courses: name, code (e.g. C182), estimated effort in hours, optional order/prerequisites, optional list of units/chapters.
3. Availability: study days per week, hours per day (can differ per weekday), days off/vacations.
4. Preview: a timeline (Gantt-style bars per course) + "At this pace you'll finish on X". Warn in red if the target is impossible and suggest how many hours/day would make it work.

**Scheduling algorithm** (put it in `src/logic/scheduler.ts`, pure functions, fully unit-tested):
- Split each course into units, then units into daily chunks of ≤ 1 day's available hours (tasks of 25–90 min each).
- Schedule courses in order (respect prerequisites) across the available days only.
- **Rebalance** when a day is missed or tasks are skipped: push unfinished work forward and spread it over the remaining days, but never above the daily max. If the end date slips, show it clearly on the goal page ("Now projected: Mar 14 (+9 days)") with a one-click "Add 20 min/day to catch up" suggestion.
- Mark a course complete early → the schedule pulls future work forward.
- Tests must cover: normal schedule, missed day, missed week, completing early, vacation days, impossible deadline, prerequisites.

**Import plan from Claude:** a panel on the goal page with (a) a copy button for a prompt template I paste into Claude with my course outline, and (b) a textarea where I paste the JSON result. Validate it against a schema (with Zod or hand-written checks), show a preview and errors per line, then import. Document the schema in the UI.

**WGU-specific touches:** fields for term start/end (6-month terms), competency units (CUs) per course, course type (OA exam / PA project), and a "CUs completed this term" progress bar.

Goal page layout (Notion style): cover + icon + title, progress bar (% of hours done), projected finish date, timeline, course list as a database table (status, CUs, hours, due), and a free-form notes area with the slash menu.

### 5.5 Gamification
- **XP:** task done = 10 + 5 × estimated pomodoros (priority bonus: high +5, urgent +10); focus session = 1 XP per minute focused; finish a course = 250; daily goal hit = 25; streak milestones 7/30/100 days = 100/500/2000.
- **Levels:** XP needed for level n = `round(100 * n^1.5)`. Show the level + progress bar in the sidebar footer.
- **Badges** (grid with locked/unlocked states, unlock date, a short description; locked ones in grayscale with a hint): First Focus, Early Bird (session before 8am), Night Owl, 7-Day Streak, 30-Day Streak, 100-Day Streak, Deep Work (4 sessions in one day), First Course Complete, Term Complete, 100 Hours Focused, Comeback (restart a streak after a break).
- **Rewards shop:** I create rewards with an XP price ("30 min gaming — 300 XP", "Order takeout — 1,500 XP"). Buying spends XP (spent XP ≠ lifetime XP; levels use lifetime XP). History of what I redeemed.
- Keep the anti-cheat simple: a focus session only counts if it lasted ≥ 80% of the planned time.

### 5.6 My World (build as you complete)
An isometric pixel city drawn on `<canvas>` (or SVG). The goal is to make me *want* to finish tasks.
- Each completed task places a small tile (house, tree, lamp post) and each focus hour adds a building floor.
- Each finished course adds a named **landmark** ("C182 Tower"). A finished degree adds a castle/university.
- A day/night cycle based on the real time of day. Missing a day doesn't destroy anything (no punishment), but a streak adds animated details (lights, people, birds).
- Hover/tap a building to see what it was earned from and when.
- Growth is deterministic, generated from the completion history with a seeded random generator, so it's always rebuilt the same way from the data.
- Export as a PNG to share.

### 5.7 Progress & streaks
- **Streak:** a day counts if I finish ≥ 1 full focus session OR hit the daily goal. Current + best streak. 1 automatic **streak freeze** per week (shown as a ❄️ on the heatmap).
- A GitHub-style yearly heatmap (color = focused minutes).
- Charts (hand-made SVG, clean, no chart library unless really needed): focus minutes per day (last 30 days), tasks completed per week, time per goal/course, best time of day (hour histogram), estimate accuracy (planned vs. actual pomodoros).
- A weekly review page every Sunday: wins, hours per goal, streak, a "what got in the way?" text box, and next week's plan preview.

### 5.8 Site blocker — Chrome extension (MV3), in `/extension`
A website can't block other sites, so this is a separate extension that talks to the app.
- `declarativeNetRequest` with **dynamic rules** that redirect blocked domains (and their subdomains) to an extension page `blocked.html`.
- `blocked.html` matches the app's design: the name of the blocked site, time left in the session, the current task, and a "Back to work" button. It shows a random line from my own motivation list (editable).
- Default blocklist: instagram.com, tiktok.com, youtube.com, x.com, twitter.com, reddit.com, facebook.com, snapchat.com, netflix.com, twitch.tv, pinterest.com. Editable in the app's Blocker page (with favicons) and synced to the extension.
- **Modes:** block only during focus sessions / scheduled block times (e.g. Mon–Fri 9–5) / always on.
- **Allowlist exceptions** (e.g. `youtube.com/watch?v=…` of a specific lecture, or a whole allowed channel path).
- **Emergency unlock:** wait 60 seconds, then type "I choose distraction over my goals", then get 5 minutes of access. Every unlock is logged and shown on the Progress page (so I'm honest).
- Communication: app → extension through `chrome.runtime.sendMessage` using `externally_connectable` (allow the GitHub Pages origin + localhost). The extension saves state in `chrome.storage.local` so it keeps working when the app tab is closed.
- Toolbar popup: status (focus on/off, time left), today's blocked-attempts count, a button to open the app.
- Blocked attempts are counted and shown in the app ("You tried Instagram 7 times today — that's 7 wins").
- Give me a zip in the Releases + clear install steps (chrome://extensions → Developer mode → Load unpacked).
- Phones: say in the README that the extension can't block phone apps, and link instructions for iOS Screen Time / Android Digital Wellbeing.

### 5.9 Settings
Theme (light/dark/system), accent color (6 presets), default timer lengths, daily goal, week start day, sounds on/off and volume, notification permission, reduced motion, **Export all data (JSON)**, **Import data**, **Reset** (typed confirmation), and a reminder to export a backup once a week.

### 5.10 Onboarding
The first launch has a 4-step flow (skippable): name + daily goal → pick distracting sites → optional first goal (e.g. "WGU degree" with a sample template) → install the extension. It ends on the Today page with 3 starter tasks.

### 5.11 Extras that make it work day to day
- **Distraction parking lot:** during focus, `P` opens a tiny input: "Thought/urge to check something?" Type it and it's saved to a list I review after the session, so I don't have to act on it now.
- **Daily rituals:**
  - *Morning plan* (2 min): pick today's top 3, check the auto-scheduled goal work, set the daily goal.
  - *Evening shutdown:* review what got done, move what didn't (with one click), write a one-line reflection. Completing it gives +10 XP.
- **Energy & focus check-in:** after each session, rate focus 1–5 with an optional mood emoji. The Progress page shows the best hours/days, and the scheduler can put hard tasks in my best time slots.
- **WGU exam readiness per course:**
  - Log pre-assessment (PA) scores per competency area and highlight weak areas.
  - A "Ready for OA?" indicator (e.g. PA ≥ 80% + all units done).
  - An OA/PA attempt log with dates and pass/fail.
- **Flashcards with spaced repetition** per course (SM-2 algorithm, pure function + tests).
  - Due cards appear as a daily task ("Review 18 C182 cards, ~10 min") and count toward XP.
  - Import cards from CSV/JSON pasted from Claude.
- **Resource library per course:** links, PDFs (stored in IndexedDB), notes, and each resource's status (to read / done).
- **Calendar export:** an `.ics` download (and a copy-paste link option) with the scheduled study blocks and milestone dates, for Google/Apple Calendar.
- **Safety net:**
  - Deleted items go to a Trash for 30 days, and every destructive action has Undo.
  - Automatic daily snapshot inside IndexedDB (keep the last 7) with one-click restore in Settings.
  - A React error boundary with "Export my data" on the crash screen, so I never lose data.
- **Keyboard shortcut sheet** (`?`) listing every shortcut.
- **Optional cloud sync (off by default, last phase):** Supabase (free tier) with magic-link email login to sync between laptop and phone. The app must work 100% without it. Resolve conflicts per record with `updatedAt` (last write wins) and document that limitation.
- **Templates:** starter goal templates ("WGU degree term", "Learn a skill in 90 days", "Certification exam prep") and task templates for recurring routines.

---

## 6. Data model (Dexie tables)
`tasks, goals, milestones (courses), units, sessions, streakDays, xpEvents, badges, rewards, redemptions, blocklist, blockEvents, settings, parkingLot, checkIns, assessments, flashcards, resources, snapshots, trash, worldTiles` (worldTiles is optional, since the world can be rebuilt from history).
XP comes from an append-only `xpEvents` log (source, amount, timestamp). Levels and balances are calculated from it, never stored as a counter that can drift. Include a schema version and migrations from day 1.

---

## 7. Model routing — use tokens efficiently

Create these subagents in `.claude/agents/` with a `model:` field in the frontmatter, and send each piece of work to the cheapest one that can handle it:

| Agent | model | Used for |
|---|---|---|
| `architect` | opus | Phase 0 plan, data model, the scheduler/rebalancing algorithm, anything a builder gets stuck on twice |
| `designer` | opus | The design system (tokens, components, `/design` page), reviewing screenshots of each screen against section 3 |
| `builder` | sonnet | Building features, one at a time |
| `reviewer` | sonnet | Reviewing each feature for bugs, a11y and design mismatches before commit |
| `helper` | haiku | Small edits, copy text, README/docs, searching files, running tests/lint, fixing typos |

Rules: the main session coordinates and delegates. Don't use opus for small edits. Don't use haiku for the scheduler or the extension messaging.

---

## 8. Build phases (commit + push after each; don't start the next until the checks pass)

0. **Plan** (architect): write `PLAN.md` (architecture, file tree, data model, phase checklist) and `DECISIONS.md`.
1. **Foundation:** Vite/React/TS setup, Dexie schema, routing, app shell (sidebar, mobile tab bar), theming, GitHub Pages deploy working with a "hello" page.
2. **Design system** (designer): tokens, fonts, all components in section 3.6, the `/design` page. Screenshot it in both themes with Playwright and check it against section 3.
3. **Tasks + Today + quick add + command palette.**
4. **Focus timer** + full-screen mode + sounds + notifications + session log.
5. **Goals + scheduler + rebalancing + Claude JSON import** (with full unit tests).
6. **Gamification:** XP events, levels, badges, rewards shop, level-up moment.
7. **Streaks + Progress page + charts + weekly review.**
8. **My World.**
9. **Chrome extension** + Blocker page + messaging + blocked-attempt stats.
10. **Onboarding, empty states, settings, export/import, PWA/offline.**
11. **Extras (5.11):** parking lot, rituals, check-ins, WGU readiness, flashcards (SM-2 tests), resources, .ics export, trash/snapshots/error boundary, templates.
12. **Optional cloud sync** (Supabase). Only if phases 0–11 are solid.
13. **Polish pass:** go through every screen at 375px, 768px and 1440px, in light and dark mode, with the keyboard only. Fix everything that feels off. Run Lighthouse and aim for Performance ≥ 90 and Accessibility ≥ 95.

**Verification for every phase:** use the Playwright MCP to open the deployed or local app, click through the new feature, and take screenshots (light + dark, desktop + mobile). Look at the screenshots honestly and fix anything that doesn't match the design spec before committing. Vitest must pass for all logic (scheduler, streaks, XP/levels, natural-language quick-add parser, JSON import validation, SM-2 flashcards, .ics generation, snapshot restore).

---

## 9. Don'ts
- No purple/blue gradient hero sections, no glassmorphism, no emoji overload, no drop shadows on everything, no centered-everything layouts.
- No lorem ipsum: use realistic sample data (WGU course names like C182, C779, D278).
- No `any` in TypeScript. No console errors.
- Don't store secrets or call paid APIs. The Claude integration is copy/paste only.
- Don't mark a phase done without screenshots + passing tests.

## 10. Deliverables
- Live GitHub Pages URL
- A GitHub Release with `forge-extension.zip`
- `README.md`: what it is, screenshots, how to install the PWA on my phone, how to install the extension, how to back up/restore, how to use the WGU import prompt
- `PLAN.md` with every phase checked off
