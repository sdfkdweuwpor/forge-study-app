# Handoff prompt: Forge "My World" engine (Phase 8, standalone, detailed)

Paste everything below the line into a NEW Gemini chat (Pro). Say "continue" until it has
output every file, then bring the full answer back to Claude (paste or upload a .txt).

---

You are a senior TypeScript + canvas engineer. You are building one self-contained part of an
existing app called **Forge**: a calm, Notion-like study and focus app for a student working on
a WGU Computer Science degree. Your part is the **"My World" engine**: an isometric pixel-art
city drawn on `<canvas>` that grows as the user finishes tasks, focus sessions, courses and
degrees. It exists to make the user *want* to finish work, and it must never punish them.

Other engineers build the rest of the app (React page, database, tooltip UI, buttons) and will
wire your engine in. So you must follow the **exact file list, types and API** below; the
integration code is already written against them.

Read the whole prompt before writing code. Where something is not specified, choose the simplest
option and write it down in the README under "Decisions".

## 0. How to deliver (you have no repository access)

- Output EVERY file you create. For each: one line with the full path, then the COMPLETE file in one
  fenced code block. Never write "…rest unchanged", placeholders, or TODOs in place of code.
- Start your answer with the list of all file paths. Then output files in this order: types →
  prng → hash → spiral → layout → iso → sky → tests → sprites → renderer → input → mount → README.
- If the answer gets long, stop after a complete file and wait for me to say "continue".

## 1. Files (create exactly these, nothing else)

Pure logic (no DOM, no canvas, no `window`, no `Math.random`, no `Date.now()`/argument-less `new Date()`):
- `src/logic/world/types.ts`: all shared types (section 3).
- `src/logic/world/prng.ts`: `mulberry32(seed)` and helpers.
- `src/logic/world/hash.ts`: `hash32(str)` (FNV-1a 32-bit) and `rngFor(seed, id)`.
- `src/logic/world/spiral.ts`: `spiral(n)` square-spiral plot coordinates.
- `src/logic/world/layout.ts`: `buildWorld(input): WorldModel` (section 4).
- `src/logic/world/iso.ts`: isometric projection, depth sort, bounds.
- `src/logic/world/sky.ts`: `skyAt(minutesSinceMidnight, theme)` (section 6).
- `src/logic/world/palette.ts`: colour palettes for both themes + `shade(hex, pct)`.
- `src/logic/world/index.ts`: re-exports the public pure API.
- Tests: `src/logic/world/prng.test.ts`, `hash.test.ts`, `spiral.test.ts`, `layout.test.ts`,
  `iso.test.ts`, `sky.test.ts`, `palette.test.ts`.

Engine (canvas allowed, no React, no global DOM queries; only the canvas you are given and its
`ownerDocument`/`ownerDocument.defaultView` for listeners and `devicePixelRatio`):
- `src/features/world/engine/sprites.ts`: procedural pixel sprites (section 7), `fillRect` only.
- `src/features/world/engine/renderer.ts`: layered rendering + caches (section 8).
- `src/features/world/engine/input.ts`: pan/zoom/hover/tap/keyboard (section 9).
- `src/features/world/engine/mount.ts`: public API `mountWorld` (section 10).
- `src/features/world/engine/README.md`: how it works + "Decisions" + anything unsure.

## 2. Code rules (CI rejects violations)

- TypeScript 5.9 `strict` with `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`, no `as unknown as`,
  no non-null `!`, no `console.*`, no `eslint-disable`.
- ES modules; relative imports within `src/logic/world/`. The engine imports pure code via the path
  alias `@/logic/world` (e.g. `import { buildWorld } from '@/logic/world'`).
- No npm dependencies. Vitest for tests (`import { describe, it, expect } from 'vitest'`).
  Tests run with `TZ=America/New_York`. Build dates in tests with local constructors,
  e.g. `new Date(2026, 8, 29, 12, 0).getTime()` (month is 0-based).
- Small pure functions, named exports, no default exports, no classes needed (plain objects +
  closures are fine).

## 3. Types (`types.ts`, copy exactly, you may ADD helpers but not change these)

```ts
export type ISODate = string // 'YYYY-MM-DD' (local date)
export type Theme = 'light' | 'dark'

export interface WorldInput {
  seed: number // constant per user, e.g. 1337
  tasks: readonly { id: string; title: string; completedAt: number; goalTitle?: string | null }[]
  focusDays: readonly { day: ISODate; minutes: number }[] // counted focus minutes per local day
  courses: readonly { id: string; code: string | null; title: string; completedAt: number; goalTitle: string }[]
  goals: readonly { id: string; title: string; completedAt: number; kind: 'degree' | 'certification' | 'skill' | 'custom' }[]
  streakDays: number // current streak length, 0 if none
}

export type Kind =
  | 'house' | 'tree' | 'lamp'            // 1×1, earned by tasks
  | 'block'                              // 1×1 tall building, earned by focus hours (floors)
  | 'landmark'                           // 2×2, earned by a finished course
  | 'monument'                           // 2×2, earned by a finished non-degree goal
  | 'castle'                             // 3×3, earned by a finished degree goal
  | 'road' | 'grass' | 'decor'           // scenery, not earned

export interface Placed {
  id: string        // stable: 'task:<taskId>', 'block:<n>', 'course:<id>', 'goal:<id>', 'road:<x>:<y>', 'grass:<x>:<y>', 'decor:<x>:<y>'
  kind: Kind
  x: number; y: number // grid cell of the footprint's top-left (integers, may be negative)
  w: number; h: number // footprint in cells
  floors: number       // 0 except 'block' (1..6) and landmark/castle/monument (fixed art heights: 4/5/2)
  variant: number      // 0..7 seeded variety
  label: string | null // e.g. 'C182 Tower'
  earnedFrom: string | null // tooltip text, e.g. 'Finished "Read chapter 4"'
  earnedAt: number | null   // epoch ms
}

export interface WorldModel {
  earned: readonly Placed[]  // houses, trees, lamps, blocks, landmarks, monuments, castles (depth-sorted back→front)
  scenery: readonly Placed[] // grass, roads, decor (depth-sorted back→front)
  bounds: { minX: number; minY: number; maxX: number; maxY: number } // in cells, inclusive, covers all allocated plots
  stats: { tiles: number; floors: number; landmarks: number; streakLevel: 0 | 1 | 2 | 3 | 4 }
}
```

## 4. Layout algorithm (`layout.ts`), deterministic and append-stable

### 4.1 Randomness
- `mulberry32(seed: number): () => number`, standard algorithm:
  `a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296`.
  **Test vector:** `mulberry32(1)` first three values ≈ `0.6270739406, 0.0027357212, 0.5274470400`.
- `hash32(s)`: FNV-1a 32-bit over UTF-16 code units (`h = 0x811c9dc5; h ^= code; h = Math.imul(h, 0x01000193) >>> 0`).
  **Test vectors:** `hash32('abc') === 0x1a47e90b`, `hash32('1337:task:t1') === 0x744aa8ab`.
- `rngFor(seed, id) = mulberry32(hash32(`${seed}:${id}`))`. Every item's random choices come ONLY from
  its own `rngFor(seed, item.id)`, never from a shared stream, so order changes elsewhere can't change it.
- Helpers in prng.ts: `int(rng, min, maxInclusive)`, `pick(rng, arr)`, `chance(rng, p)`.

### 4.2 Plots and the spiral
- The world is a grid of **plots**. Each plot is 4×4 cells. Plots are separated by 1-cell roads, so the
  period is 5: plot `(px, py)` covers cells `x ∈ [px*5, px*5+3]`, `y ∈ [py*5, py*5+3]`.
- Plots are allocated in **square-spiral order** from the centre: `spiral(n)` returns the n-th plot
  coordinate. **Test:** the first 13 are
  `(0,0) (1,0) (1,1) (0,1) (-1,1) (-1,0) (-1,-1) (0,-1) (1,-1) (2,-1) (2,0) (2,1) (2,2)`.
  (Ring r ≥ 1 starts at `(r, -(r-1))`, goes down (+y) to `(r, r)`, left to `(-r, r)`, up to `(-r, -r)`,
  right to `(r, -r)`.) Must be O(1) or O(√n) per call, not O(n²).
- A plot counter `nextPlot` starts at 0. `allocate()` returns `spiral(nextPlot++)`.

### 4.3 Event stream
Build one chronological list of **earn events**, sorted by `(at ascending, id ascending)`:
- each task → `{ id: 'task:'+id, at: completedAt }`
- each finished course → `{ id: 'course:'+id, at: completedAt }`
- each finished goal → `{ id: 'goal:'+id, at: completedAt }` (kind 'degree' ⇒ castle, else monument)
- focus floors: sort `focusDays` by day, accumulate minutes; every time the running total crosses a
  multiple of 60, a floor is earned at `at = local noon of that day` (use `new Date(y, m-1, d, 12).getTime()`).
  Floor k (0-based) belongs to block `b = Math.floor(k / 6)`. The FIRST floor of each block creates an
  event `{ id: 'block:'+b, at }`; later floors of that block only increase its `floors` and update
  `earnedAt` (they do not move it). A day with 150 minutes after 0 earns floors 0 and 1 on the same day.
- Ignore tasks/courses/goals with non-finite `completedAt`. Deduplicate by id (first wins).

### 4.4 Placement
- Small items (house, tree, lamp, block; 1×1) fill the current **small plot** at these 8 slot offsets,
  in this order: `(0,0) (2,0) (0,2) (2,2) (1,3) (3,1) (3,3) (1,1)`. When all 8 are used, the small plot
  becomes `allocate()` again. The first small item allocates the first small plot lazily.
- Large items allocate a **fresh plot each** (`allocate()`), never sharing with small items:
  landmark and monument occupy offset `(1,1)` with 2×2; castle occupies `(0,0)` with 3×3.
- This makes the layout **append-stable**: if new events have `at` ≥ every existing event, all
  existing placements are unchanged. (Document that back-dated imports may reshuffle.)
- Task tile choice from `rngFor(seed, 'task:'+id)`: 60% house, 25% tree, 15% lamp. `variant = int(rng,0,7)`.
- Labels: landmark → `code ? code + ' Tower' : truncate(title, 22) + ' Hall'`; monument → `truncate(goal.title, 26)`;
  castle → `truncate(goal.title, 26)`; others → `null`. `truncate` adds '…'.
- `earnedFrom`: task → `Finished "${title}"` (+ ` · ${goalTitle}` when present); block →
  `${floors} focus hour${floors===1?'':'s'}`; landmark → `Completed ${code ?? ''} ${title}`.trim();
  monument/castle → `Reached goal: ${title}`. `earnedAt` = the event time (for blocks, the latest floor).

### 4.5 Scenery
- For every allocated plot: every cell of the plot gets a `grass` item (id `grass:x:y`).
- Roads: every cell `(x, y)` with `x mod 5 === 4` or `y mod 5 === 4` (use a true modulo for negatives)
  that is 8-adjacent to an allocated plot cell gets a `road` item; `variant` encodes direction:
  0 = runs along x, 1 = along y, 2 = crossing.
- Decor: for every allocated plot, `rngFor(seed, 'plot:'+px+':'+py)` places 0–2 `decor` trees on plot
  cells that are NOT slot offsets and NOT inside a large item's footprint (so decor never blocks
  future small items).
- Scenery is never earned and has `earnedFrom = null`.

### 4.6 Depth sort and bounds (`iso.ts`)
- Sort key for drawing back→front: `(x + w - 1) + (y + h - 1)` ascending, then `x + y` ascending,
  then kind order `grass < road < decor < lamp < tree < house < block < monument < landmark < castle`, then id.
- `bounds` covers all allocated plots plus the surrounding road ring.
- `stats.tiles` = number of task items; `floors` = sum of block floors; `landmarks` = landmarks +
  monuments + castles; `streakLevel` = 0 (<3), 1 (≥3), 2 (≥7), 3 (≥14), 4 (≥30).

## 5. Isometric math (`iso.ts`)
- Base tile at zoom 1: `TILE_W = 32`, `TILE_H = 16` (2:1). Screen of cell (x, y) top corner:
  `sx = (x - y) * TILE_W / 2`, `sy = (x + y) * TILE_H / 2`. Provide `toScreen`, `toGrid` (floor), and
  `footprintPolygon(p)` (4 points of the footprint diamond). Test the round-trip for 100 random cells.
- `spriteBox(p, zoom)` returns the on-screen rectangle including height (`floors * FLOOR_PX` where
  `FLOOR_PX = 10`), used for hit-testing and culling.

## 6. Sky and time (`sky.ts`)
`skyAt(minutes, theme) → { phase: 'night' | 'dawn' | 'day' | 'dusk'; top: string; bottom: string; ambient: number; windowsLit: boolean }`
- Night 20:30–05:00, dawn 05:00–07:30, day 07:30–18:00, dusk 18:00–20:30. Interpolate colours linearly
  within dawn/dusk (`ambient` 0 = full day, 1 = full night; `windowsLit` when ambient > 0.5).
- Calm colours, no neon. Day light theme: top `#DCEBF5` → bottom `#F4F1EA`. Night: top `#141A26` →
  bottom `#2A2F3A`. Dusk mid: top `#E8C9A8` → bottom `#F2E3D0`. Dark theme uses slightly deeper variants
  (define them). **Tests:** 12:00 → day, ambient 0; 23:00 → night, ambient 1, windowsLit; 19:15 → dusk
  with 0 < ambient < 1; monotonic ambient between 18:00 and 20:30 (sample every 5 min).

## 7. Sprites (`sprites.ts`), pixel art drawn with `fillRect` at integer coordinates
Draw each sprite relative to its footprint's bottom-centre anchor, at `zoom` ∈ {1,2,3,4} (multiply
every pixel size by zoom). Isometric solid shading: **top face** = `shade(base, +8)`, **left face** = base,
**right face** = `shade(base, -12)`. Outline one shade darker (`shade(base, -28)`), 1 px at zoom 1.

Palette (`palette.ts`): 9 named hues, each with `bg` (walls/light) and `text` (roofs/dark) per theme:
- Light: gray #e9e8e5/#64615c · brown #f5e4db/#7a5a49 · orange #ffe2ca/#8b541c · yellow #f6e7bf/#7f5b1d ·
  green #d8efdc/#396d46 · blue #d5ecfb/#24678d · purple #ede2fb/#715391 · pink #fcdfea/#91496b · red #ffdedb/#9a4541
- Dark: gray #363533/#adaba7 · brown #41322a/#c0a699 · orange #482f18/#cda27d · yellow #423305/#c2a77d ·
  green #263b2a/#8fb696 · blue #233846/#84b1cf · purple #3a3046/#b6a1d1 · pink #462d37/#d399b2 · red #4a2c29/#dc9892
- Grass: light `#CFE3C4`/`#C4DBB8` checker; dark `#23302A`/`#1F2B25`. Road: light `#D9D6CF`, dash `#F4F1EA`;
  dark `#3A3936`, dash `#55534F`. Gold accent (landmark spires, castle flags only): `#BE8226`.
  Window lit: `#F2C66D`; window unlit: `shade(wall, -20)`.
- `shade(hex, pct)`: lighten (+) / darken (−) in HSL lightness by pct points, clamp 0–100. Tests.

Sprites (sizes at zoom 1):
- **grass**: footprint diamond, checker by `(x+y) % 2`, plus 0–2 seeded 1-px speckles.
- **road**: diamond in road colour, a 2-px dash line centred along its direction (variant).
- **house** (variant picks hue from [brown, orange, yellow, red, blue, pink, gray, green]): walls 14 px
  tall on the diamond, pitched roof 9 px in the hue's `text` colour, a 3×5 door on the left face, one 3×3
  window per face (lit at night), 1-px chimney on variant ≥ 4.
- **tree**: trunk 2×5 brown text; canopy = 3 stacked blobs (8×5, 10×5, 6×4) in green bg/text two-tone;
  variant 6–7 = autumn (orange hue).
- **lamp**: 1-px pole 14 px tall, head 3×2 in lit colour; at night draw a soft 5×3 glow (alpha 0.35) and
  subtle flicker (only when motion allowed).
- **block**: a tower of `floors` floors, each 10 px, wall hue by variant from [gray, blue, brown, purple],
  a 2-px roof ledge, windows: 2 per face per floor (2×3 px), lit at night with probability
  `0.35 + 0.15*streakLevel` (seeded per window, stable).
- **landmark** (2×2): 4-floor tower 44 px tall, wall `gray.bg`, trim `gray.text`, clock/emblem 4×4 on the
  front, gold spire 8 px with a 1-px flag. The `label` is NOT drawn on canvas (the app shows tooltips).
- **monument** (2×2): stone plaza (gray) + obelisk 3×24 px with a gold cap, two tiny trees.
- **castle** (3×3): curtain wall 16 px, 4 corner towers 26 px with crenellations (2×2 notches),
  central keep 34 px, arched gate, two gold flags.
- **people** (streak ≥ 7, motion on): 1×3 px figures in muted hues walking along road cells,
  seeded routes, speed ≈ 6 px/s at zoom 1; at most `min(12, tiles/5)` people.
- **birds** (streak ≥ 14, motion on, day/dusk only): 3-px "v" shapes crossing the sky every ~20 s.
- **fountain** (streak ≥ 30): on the first monument/landmark plaza: small animated water pixels;
  at night 1–2 tiny fireworks bursts per minute (motion on only).

## 8. Renderer (`renderer.ts`)
- **Layers:** (1) sky gradient over the whole canvas; (2) a cached **static layer** on an
  `OffscreenCanvas` (fallback `document.createElement('canvas')` via the canvas' ownerDocument) holding
  grass, roads, decor and all earned sprites at the current zoom and time bucket; (3) a **dynamic layer**
  drawn every frame: lamp flicker, people, birds, fountain, hover outline; (4) a night ambient overlay
  (`rgba(20,26,38, 0.45*ambient)` multiplied under lit windows so lights stay bright: draw windows' glow
  after the overlay).
- Rebuild the static cache only when the model, theme, zoom or 15-minute time bucket changes.
  Panning just blits the cache at the new offset.
- Culling: skip sprites whose `spriteBox` is outside the viewport.
- Crisp pixels: `ctx.imageSmoothingEnabled = false`; canvas backing size = CSS size × `devicePixelRatio`
  (rounded); draw at integer positions only.
- Frame loop via `requestAnimationFrame`, capped at 30 fps, and **paused** entirely (no rAF) when there is
  nothing animated (reduced motion, or no people/birds/fountain/lamps at night), when the document is
  hidden (`visibilitychange`), or when the canvas is not intersecting (use `IntersectionObserver` if
  available). Time-of-day refresh: a 60-s timer when paused.
- Performance target: 2,000 earned items + scenery at 60 fps while panning on a mid laptop.

## 9. Input (`input.ts`)
- Pointer events only (mouse, touch and pen). Drag > 4 px = pan; otherwise it's a tap/click.
- Hover (mouse) and tap (touch) call `onHover(item | null, { x, y })` with canvas-relative CSS coords;
  hit-test earned items only, front→back (reverse depth order) against `spriteBox`, then refine with the
  footprint polygon for the bottom half.
- Wheel: zoom one integer step toward the cursor (anchor point stays fixed). Pinch with two pointers:
  step zoom at ratio thresholds 1.25 / 0.8.
- Keyboard (when the canvas is focused): arrows pan 32 CSS px, `+`/`=` zoom in, `-` zoom out,
  `0` fit to view, `Escape` clears hover (`onHover(null, …)`). Do not call `preventDefault` for other keys.
- Zoom levels are integers 1–4. `zoomTo(n)` rounds and clamps.
- Initial view: "fit to view" = the largest zoom where `bounds` fits with 24 px padding (minimum 1),
  centred.

## 10. Public API (`mount.ts`)

```ts
import type { Placed, Theme, WorldModel } from '@/logic/world'
export interface MountOptions {
  theme: Theme
  reducedMotion: boolean
  now: () => number // injected clock; the app passes Date.now
  onHover?: (item: Placed | null, at: { x: number; y: number }) => void
}
export interface WorldHandle {
  update(model: WorldModel): void // keep the camera; if bounds grew, keep the same centre
  setTheme(theme: Theme): void
  setReducedMotion(value: boolean): void
  resize(): void // app calls this from a ResizeObserver
  hitTest(clientX: number, clientY: number): Placed | null // client (page) coordinates
  zoomTo(level: number): void
  fit(): void
  exportPng(opts?: { zoom?: 1 | 2 | 3 | 4; caption?: string }): Promise<Blob>
  destroy(): void // remove every listener/observer/timer and cancel rAF; idempotent
}
export function mountWorld(canvas: HTMLCanvasElement, model: WorldModel, opts: MountOptions): WorldHandle
```
- `exportPng` renders the WHOLE world (not just the viewport) to an offscreen canvas at the given zoom
  (default 2, reduced automatically so neither side exceeds 8192 px), with the sky at the current time,
  no hover outline, and a caption bottom-left in 12 px `"Inter Variable", ui-sans-serif, sans-serif`
  (default caption: `Forge · <Mon D, YYYY> · <tiles> tiles · <floors> floors`), and returns
  `canvas.toBlob` as a Promise (reject with an Error if null).
- Set no styles on the canvas except its width/height attributes; the app owns CSS and `tabindex`.

## 11. Tests (Vitest), required cases
- prng/hash test vectors above; `int`/`pick`/`chance` stay in range (1,000 draws).
- `spiral` first 13 coordinates; `spiral(n)` is unique for n < 2,000; ring structure correct.
- `buildWorld`:
  - determinism: two calls deep-equal;
  - **append-stability**: 40 tasks + 3 courses + focus days → N items; add 25 newer tasks, 1 newer course,
    1 newer degree and more focus minutes → every earlier earned item has the same `x, y, w, h, kind, variant`;
  - floors: `[{day:'2026-09-01', minutes:125}]` → one block with 2 floors;
    `[{day:'2026-09-01', minutes:300}, {day:'2026-09-02', minutes:120}]` → block 0 with 6 floors, block 1 with 1 floor;
  - labels: course code `C182` → `'C182 Tower'`; a degree goal → a `castle` 3×3; certification → `monument`;
  - **no overlaps**: property test with 300 seeded random inputs (use mulberry32) → no two earned footprints
    intersect, no decor inside a slot offset or large footprint, no earned item on a road cell;
  - order independence: shuffling the input arrays gives an identical model;
  - empty input → empty `earned`, empty `scenery`, zero stats, finite bounds (0,0,0,0).
- iso round-trip; depth-sort: an item in front (greater x+y) always sorts after an overlapping item behind it.
- sky cases above; palette `shade` clamps and round-trips hex format `#rrggbb`.

## 12. README (`src/features/world/engine/README.md`)
Explain: the layout rules in 10 lines, how append-stability works and its limit (back-dated items),
performance design (static cache, culling, paused loop), the public API with a 15-line usage example
(React `useEffect` mount/destroy + ResizeObserver + tooltip via `onHover`), and a "Decisions / Unsure" list.
