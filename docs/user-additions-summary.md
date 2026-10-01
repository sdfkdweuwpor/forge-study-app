# Summary: Goal Breakdown Planner, everyday tasks, views, templates, export

Built on top of the existing app. The working goals list, goal pages, course pages and Claude import
were kept and extended. Only the old minimal goal-creation modal was removed; the planner replaced it.
All checks pass: typecheck, lint, 2,314 unit tests, build, and 357 end-to-end tests.

## What was added

### 1. Goal Breakdown Planner (`/goals/new`)
- **7-step flow:** Start → When → Availability → Effort → Review → Preview → Confirm. The draft survives a refresh.
- **Inputs:**
  - Paste a syllabus or course list. It is parsed locally for WGU course lists, Week/Module/Chapter/Unit
    lines and assessment lines with dates and hours.
  - Upload a PDF. Text is extracted locally with pdf.js, which is loaded only when you upload.
  - A photo goes via Claude: copy the prompt, attach the photo in Claude, paste the JSON back. The app
    can't read images offline.
  - Type a big goal instead of pasting a syllabus.
- **Target date:** pick a date, or choose "As fast as possible".
- **Availability:**
  - pick days, set several time windows per weekday, and copy windows to all days
  - session length 25–90 minutes
  - blackout date ranges
  - rotating shift patterns (presets such as 3-on/4-off and 2-2-3, with an anchor date)
  - a live "≈ X h/week" readout
- **Effort:**
  - enter hours, or CUs × your multiplier (hours per CU)
  - adjust with a self-rating: know it 0.5, somewhat 0.8, new 1.0
  - the resulting minutes show live
- **Review screen:**
  - edit, reorder (mouse or keyboard) and delete courses, units and assessments, each with exact Undo
  - mark units optional, which makes them the cut-scope candidates
  - "We couldn't read these lines" lets you add missed lines
  - nothing is scheduled until you confirm
- **Scheduling (pure module):**
  - units are split into session-sized tasks placed in your time windows
  - weekly milestones
  - spaced reviews before each assessment (−7/−3/−1 study days)
  - a practice-test checkpoint before each exam
  - a 12% buffer by default (adjustable 10–15%)
- **Feasibility:** if the plan doesn't fit, a calm card offers three choices. Each option is checked by
  re-running the planner before it is shown.
  - Add N min on study days
  - Move finish to date
  - Cut optional units
- **Falling behind:**
  - missed tasks roll forward automatically each day and the projected finish updates
  - if you fall far behind, meaning a slip of more than 7 days, more than 15% of remaining work, past
    the target, or past an exam, a banner offers choices with Undo; the plan is never rewritten silently
- **Life happened:** a button on the goal page. Say which days this week are gone, or reduce the
  week to X%. You see a preview of what moves, then Confirm, with Undo.
- **Plan settings:** edit windows, shift pattern, session length, buffer and multiplier for an existing
  goal, with Undo.

### 2. Everyday tasks
- **Quick add** understands "gym tomorrow 6am", "pay bill Fri", "pay bill due Fri", "renew passport by
  Oct 30" and "call mom sat 30m". Chips show *Do* vs *Due* and the length. A test asserts adding a task
  takes under 3 s.
- Separate **Do date/time and length** and **Deadline** fields on every task. Deadlines show a small calm
  chip (amber only on the day itself). After the date passes it reads "Was due Tue", never red.
- **Auto-schedule before deadline**, an opt-in per task. Suggested times appear in a card with Accept,
  Accept all or Dismiss, plus Undo. Slots are re-checked before they are applied. The hours it uses are
  set in **Settings → Everyday task hours**.

### 3. Views
- **Today:**
  - plan sessions and everyday tasks in one time-ordered list, with a "Grouped" toggle
  - a ▶ start-focus button on every task
  - a "Time today / This week" card with minutes per goal
  - "Carried over" is a quiet, collapsible section (it replaced "N days overdue")
- **Week:**
  - time blocks you can drag between days and times, or resize from the bottom edge (15-min snap)
  - the keyboard works too (Alt+arrows, Alt+Shift+↑/↓)
  - deadline markers in each day header
  - a 3-day view on phones
- **Roadmap** (`/roadmap`, `g m`):
  - each goal across 3, 6 or 12 months
  - course segments, assessment markers, weekly milestone ticks and a today line
  - % complete
  - projected vs target, with the overrun shown as a soft hatched span rather than red

### 4. Templates
WGU term, Certification (CompTIA A+ Core 1), Semester course, and Personal project. Each template is
tested to fit its own default finish date.

### 5. Export (Settings → Export & calendar, or `o c`, `o m`, `o i`)
- **Tasks as CSV:** Excel-safe, with a UTF-8 BOM option and a guard against formula injection.
- **Tasks as Markdown:** grouped by date or by goal.
- **Calendar `.ics`:** study blocks, milestones, assessments and optional deadlines. Stable IDs mean a
  re-import updates events rather than duplicating them.
- All data stays local in IndexedDB, so everything works offline.

### Rules followed
- **No guilt:** no red for "behind", and no shaming copy.
- **Confirm first:** the Claude import, auto-slot suggestions and all re-plan proposals need your
  confirmation.
- **Fast entry:** adding a task stays quick.

### Hooks in the data model (not built)
Schema v2 includes:
- **Calendar sync:** a `Task.sync` field.
- **Flashcards:** `scheduler: 'fsrs'` plus `fsrs` state and `noteRef` fields.
- **Practice questions:** a `practiceQuestions` table and a `questionAttempts` table, plus a
  `wrongAnswerQueue()` helper.
- **Readiness:** a `readiness` table plus a mapping that turns readiness into extra review minutes for
  the planner.

## Files changed (by area)
- **Data:**
  - `src/db/types.ts`, `schema.ts`, `db.ts`, and `src/db/migrations/v2.ts`, which moves the old single
    date into the "do" date
  - `src/logic/schemaV2.ts`
  - `src/db/repos/{planning,proposals,planSettings,autoslot}.ts`, plus changes to `goals.ts` and `tasks.ts`
- **Planner logic:**
  - `src/logic/scheduler/**` (planner, slot placement, shift cycles, effort, split, reflow, milestones,
    feasibility, roll-forward, life-happened, auto-slot)
  - `src/logic/planParse/**`
  - `src/logic/{plannerDraft,plannerAvailability,plannerEffort,plannerPersist,plannerTimeline,pdfLines,goalTemplates,readinessPlan,practice}.ts`
- **Planner UI:** `src/features/planner/**`: steps, components, goal dialogs, `pdfText.ts`.
- **Tasks:**
  - `src/logic/{quickAdd,everydaySlots,calendarWeek,taskDates}.ts`
  - `src/features/tasks/**`: `DueEditor`, `AutoSlotSuggestions`, `EverydayHours`, the calendar views
  - `src/features/quickadd/**`
- **Today and Roadmap:**
  - `src/features/today/**`, `src/features/roadmap/**`
  - `src/logic/{roadmap,timeLogged,today}.ts`
- **Export:** `src/logic/export/**`, `src/features/export/**`, `src/lib/{download,clipboard}.ts`.
- **Tests:**
  - unit tests next to each module
  - `e2e/{planner,everyday,roadmap,export,import,today,goalsui}.spec.ts`
- **Config:** `vite.config.ts` (keeps pdf.js out of the offline precache) and `package.json` (adds `pdfjs-dist`).

## Skipped or unsure
- **Photo reading:** there is no offline OCR. It would need a large library plus about 10 MB of language
  data, so photos go through Claude instead, and the tab is labelled "Photo (via Claude)".
- **PDFs:** only PDFs with a text layer can be read (scanned PDFs → use the photo/Claude path). The first
  PDF read needs internet once, because pdf.js isn't precached.
- **Migration:** existing tasks' single date became their "do" date, not a deadline.
- **WGU term dates:** these are set when a goal is created. They aren't editable in Plan settings yet.
- **CU-budget editing:** changing one unit's hours inside a course with an hours or CU budget
  redistributes the other units instead of raising the course total.
- **Reordering and prerequisites:** a reorder that would break a prerequisite asks first via a toast with
  Undo. There is no dedicated prerequisites editor yet.
- **Flashcards:** built as hooks only (FSRS-ready). The original brief asked for SM-2 flashcards later;
  per your note they'll use FSRS when built.
