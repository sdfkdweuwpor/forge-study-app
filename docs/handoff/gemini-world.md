# Handoff prompt: Forge "My World" engine (Phase 8, standalone)

Paste everything below the line into a NEW Gemini chat (Pro). Say "continue" until it has
output every file, then bring the full answer back to Claude (paste or upload a .txt).

---

You are building one self-contained part of an existing app called **Forge**, a calm,
Notion-like study and focus app. Your part is the **"My World" engine**: an isometric pixel
city drawn on `<canvas>` that grows as the user finishes tasks, focus sessions, courses and
degrees. The goal is to make the user *want* to finish tasks. Other engineers build the rest of
the app (the React page, the database, the UI), and one of them will wire your engine into it.

## How to deliver (you have no repo access)

You cannot read or push to the repository. Everything you need is in this prompt.
Output EVERY file you create, each as: a line with its full path, then the COMPLETE file
content in one code block. No partial snippets, no "rest unchanged". Start with a list of all
file paths. If the answer gets long, stop after a complete file and wait for "continue".

## Files you create (and nothing else)

- `src/logic/world/prng.ts`: seeded PRNG (`mulberry32`) + helpers (`int(min,max)`, `pick`, `chance`).
- `src/logic/world/types.ts`: all input/output types below.
- `src/logic/world/layout.ts`: **pure** `buildWorld(input: WorldInput): WorldModel`.
- `src/logic/world/iso.ts`: pure isometric math (grid ↔ screen, depth sort, hit-test polygons).
- `src/logic/world/sky.ts`: pure day/night colours from a local time (`skyAt(minutesSinceMidnight, theme)`).
- `src/logic/world/*.test.ts`: Vitest tests (import `describe/it/expect` from `vitest`).
- `src/features/world/engine/renderer.ts`: canvas drawing; **no React**, no DOM access beyond the
  canvas passed in.
- `src/features/world/engine/sprites.ts`: pixel-art sprites drawn procedurally with `fillRect`
  (no image files).
- `src/features/world/engine/mount.ts`: the public imperative API (below).
- `src/features/world/engine/README.md`: short notes, including anything you were unsure about.

## Code rules (CI rejects violations)

- TypeScript `strict` + `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`, no `console.*`,
  no non-null `!` assertions.
- `src/logic/world/**` must be PURE: no DOM, no `window`, no `Date.now()` or `new Date()` without
  arguments, no `Math.random()`. All time and randomness is injected. The engine files may use the
  canvas API and `requestAnimationFrame`.
- No npm dependencies. Tests run with `TZ=America/New_York`.

## Input (built by the app from its database; you only consume it)

```ts
export type ISODate = string // 'YYYY-MM-DD' (local date)
export interface WorldInput {
  seed: number                       // constant per user, e.g. 1337
  tasks: { id: string; title: string; completedAt: number /* epoch ms */; goalTitle?: string | null }[]
  focusDays: { day: ISODate; minutes: number }[]           // counted focus minutes per day
  courses: { id: string; code: string | null; title: string; completedAt: number; goalTitle: string }[]
  goals: { id: string; title: string; completedAt: number; kind: 'degree' | 'certification' | 'skill' | 'custom' }[]
  streakDays: number                 // current streak length (0 if none)
}
```

## Rules for growth (from the product brief)

- Each completed task places ONE small tile: a house, a tree or a lamp post (seeded choice;
  houses the most common).
- Each full focus hour adds ONE building floor. Focus minutes accumulate across days, so every 60
  minutes in total adds a floor to the current "tower block". A block gets a new building after 6
  floors.
- Each finished course adds a named **landmark** (e.g. "C182 Tower"): a bigger sprite,
  2×2 tiles, with a small label shown on hover.
- A finished degree (goal `kind === 'degree'`) adds a **castle/university** (3×3). Other finished
  goals add a monument (2×2).
- **Deterministic:** the same input always gives exactly the same world (seeded by `seed` +
  item ids, never by array index or time).
- **Append-stable:** items are placed in completion order on a stable outward spiral from the
  centre. Adding new completions must NEVER move existing items. Test this: build with N items,
  then with N+10, and the first N placements are identical.
- **No punishment:** missing days never removes anything.
- **Streak adds life:** ≥3 days gives lit windows at night; ≥7 adds a few walking people; ≥14 adds
  birds; ≥30 adds a small fountain or fireworks at night. Animations are subtle.
- Leave pleasant empty space: roads/paths between plots (a simple road grid every N tiles), a
  little grass texture, and occasional seeded trees on empty edge tiles for charm, marked as
  `decor` (not earned).

## Output model (pure)

```ts
export type Kind = 'house' | 'tree' | 'lamp' | 'floor-block' | 'landmark' | 'castle' | 'monument' | 'road' | 'decor'
export interface Placed {
  id: string                 // stable, e.g. 'task:<taskId>', 'block:3', 'course:<id>'
  kind: Kind
  x: number; y: number       // grid cell (integer), top-left of footprint
  w: number; h: number       // footprint in cells
  floors?: number            // for floor-block
  variant: number            // seeded 0..n for colour/shape variety
  label?: string             // e.g. 'C182 Tower'
  earnedFrom?: string        // human text for the tooltip, e.g. 'Finished "Read chapter 4"'
  earnedAt?: number          // epoch ms
}
export interface WorldModel {
  placed: Placed[]           // already depth-sorted for drawing (back to front)
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  stats: { tiles: number; floors: number; landmarks: number; streakLevel: 0 | 1 | 2 | 3 | 4 }
}
```

## Public engine API (`mount.ts`), used by the React page

```ts
export interface MountOptions {
  theme: 'light' | 'dark'
  reducedMotion: boolean
  now: () => number                  // injected clock (the app passes Date.now)
  onHover?: (p: Placed | null, screen: { x: number; y: number }) => void
}
export interface WorldHandle {
  update(model: WorldModel): void    // re-render with a new model (no layout jump)
  setTheme(theme: 'light' | 'dark'): void
  setReducedMotion(v: boolean): void
  resize(): void                     // call on container resize; DPR-aware
  hitTest(clientX: number, clientY: number): Placed | null
  zoomTo(level: number): void        // 0.5 .. 3, with pan preserved
  exportPng(scale?: number): Promise<Blob>  // whole world incl. a small "Forge · <date>" caption
  destroy(): void                    // remove listeners, cancel animation frames
}
export function mountWorld(canvas: HTMLCanvasElement, model: WorldModel, opts: MountOptions): WorldHandle
```

- Pointer: drag to pan, wheel/pinch to zoom, hover/tap calls `onHover` (the app shows the tooltip).
  Keyboard: arrow keys pan and +/- zoom when the canvas is focused (`tabindex=0` is set by the app).
- Crisp pixels: `imageSmoothingEnabled = false`, integer scaling, device-pixel-ratio aware.
- Day/night from the real local time via `opts.now()`: sky gradient bands (no neon), sun/moon,
  window lights at night. Update about once a minute, not every frame, unless animating.
- Animations only when `reducedMotion` is false; otherwise draw a static frame.
- Performance: 1,000+ placed items must render at 60 fps while panning (cache static layers in an
  offscreen canvas; only animated bits redraw).

## Art direction (calm, like the rest of the app)

- Muted, warm pixel-art palette: no saturated neon, no purple/blue gradients. Use these app
  tag colours (light theme / dark theme) as the base palette for roofs, walls and details:
  gray #e9e8e5/#64615c · brown #f5e4db/#7a5a49 · orange #ffe2ca/#8b541c · yellow #f6e7bf/#7f5b1d ·
  green #d8efdc/#396d46 · blue #d5ecfb/#24678d · purple #ede2fb/#715391 · pink #fcdfea/#91496b ·
  red #ffdedb/#9a4541 (light bg/text pairs). Dark theme pairs: gray #363533/#adaba7 ·
  brown #41322a/#c0a699 · orange #482f18/#cda27d · yellow #423305/#c2a77d · green #263b2a/#8fb696 ·
  blue #233846/#84b1cf · purple #3a3046/#b6a1d1 · pink #462d37/#d399b2 · red #4a2c29/#dc9892.
  Grass and roads: soft greens and warm greys. Gold accents (#BE8226) only for landmarks and the castle.
- Isometric 2:1 tiles (e.g. 16×8 px base at zoom 1), outlines one shade darker, no blur, no drop
  shadows except a 1-px ground shadow.

## Tests (Vitest, pure modules only)

- PRNG determinism (same seed gives the same sequence).
- `buildWorld` determinism (deep-equal on repeated calls) and **append-stability** (see above).
- Floors: 125 focus minutes gives 2 floors; 6 floors roll over to a new block.
- Landmarks get labels from course codes ("C182 Tower"); a degree gives a castle.
- No overlaps: footprints never intersect (property test over random inputs with a seeded PRNG).
- Depth sort order is correct for overlapping footprints.
- `skyAt` gives night at 23:00, day at 12:00, and a smooth dusk.
- `iso.ts` round-trip: grid → screen → grid.

## Done means

All files above output in full, tests included, following the code rules. The React page,
tooltip, PNG download button and data queries are NOT your job.
