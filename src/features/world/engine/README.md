# My World engine

An isometric pixel-art city on a `<canvas>` that grows as work gets finished. Two halves:

- **Pure layout and maths**, in `src/logic/world/` (no DOM, no clock, no `Math.random`): the seeded
  generator, the spiral, `buildWorld`, the isometric maths, the sky, the palettes, the camera, the people,
  birds and fireworks as functions of time.
- **The canvas engine**, here: `sprites.ts` (procedural pixel sprites), `renderer.ts` (layers and caches),
  `input.ts` (pointer and keyboard), `mount.ts` (the public API), `canvasKit.ts` (off-screen layers).

`WorldPage` (`src/features/world/`) is the app around it: data, tooltip, toolbar, legend, shortcuts, export.

## The layout in ten lines

1. The world is a grid of 4x4-cell **plots** with 1-cell roads between them (period 5).
2. Plots are handed out in **square-spiral** order from the centre: `spiral(n)`, O(1).
3. Every finished task, course, goal and every first floor of a focus block is an **earn event**, sorted
   by `(time, id)`; the same id twice keeps the first.
4. Small things (house, tree, lamp, block) fill the current plot through 8 fixed slots, a checkerboard, then
   the next plot; a landmark or monument (2x2) or castle (3x3) takes a plot of its own.
5. Focus minutes add up day by day; every whole hour is a floor at local noon of that day; six floors make a
   block, and the block stays where its first floor put it.
6. A task's look (house 60%, tree 25%, lamp 15%, and its variant 0-7) comes only from its own
   `rngFor(seed, id)`, never from a shared stream.
7. Every plot cell is grass; roads run round each plot; 0-2 shrubs sit on cells that are neither a slot nor
   under a large building.
8. `earned` and `scenery` are sorted back to front: nearest cell, `x + y`, kind, id.
9. Bounds cover every plot and its road ring. Stats: tiles, floors, landmarks, streak level (3, 7, 14, 30 days).
10. The empty world has no plots at all; the app asks for `minPlots: 1` so a new user sees one plot of grass.

## Append-stability, and where it ends

Placement walks the events in time order and hands out slots and plots as it goes. So if everything new has a
time at or after everything already there, the old placements do not change: only new slots and plots come
after them. A focus block keeps its slot when floors are added to it.

It ends at **back-dated** input. A task imported with an old completion time, or a focus day added in the
past, sorts *before* later events and shifts every placement after it. That is accepted (an import is rare,
and the city is rebuilt from history), but it means a rebuilt city can differ from the one you saw. The
sorting is total, so the same history always gives the same city, whatever order the rows are read in.

## How it stays fast

- **Static layer.** Ground, roads, shrubs and every earned sprite are painted once onto an off-screen canvas
  (`OffscreenCanvas`, or a canvas from the document as a fallback). Panning blits it at a new offset. It is
  rebuilt only when the layout, the theme, the zoom or the 15-minute time bucket changes. A second layer
  holds just the lit windows and lamp heads for night.
- **Windowed cache.** If the whole world would need more than 12 million pixels (or 8192 on a side) the
  cache covers the view plus half a screen each way instead, and is rebuilt when the view leaves it. 2,000
  buildings at zoom 4 stay well inside memory.
- **Culling.** Anything whose sprite box is outside the region being painted is skipped.
- **Sprites are bitmaps.** Each sprite is painted once at 1x with `fillRect` into a small canvas and stamped
  with `drawImage` at an integer scale, smoothing off: pixel for pixel what multiplying every rect by the zoom
  gives, about fifty times cheaper.
- **Crisp pixels.** The backing store is CSS size x devicePixelRatio; one art pixel is `zoom * round(dpr)`
  device pixels; everything is drawn at whole pixels.
- **A paused loop.** No frame is scheduled at all when nothing moves (reduced motion, or no people, birds,
  fountain or night lamps), when the tab is hidden, or when the canvas is off screen. While something
  animates, frames are capped at 30 a second. A 60-second timer refreshes the sky and time bucket otherwise.
- **Hit testing** rules items out with a box compare that allocates nothing before the footprint test.

## Public API

```ts
import { mountWorld } from './engine/mount'

useEffect(() => {
  const canvas = canvasRef.current
  if (!canvas) return
  const handle = mountWorld(canvas, model, {
    theme, // 'light' | 'dark'
    reducedMotion, // boolean
    now: Date.now,
    onHover: (item, at, via) => setTip(item ? { item, ...at, via } : null), // at: canvas CSS px
  })
  const observer = new ResizeObserver(() => handle.resize())
  observer.observe(canvas)
  return () => {
    observer.disconnect()
    handle.destroy()
  }
}, [])
// later: handle.update(newModel); handle.setTheme('dark'); handle.setReducedMotion(true);
// handle.zoomTo(3); handle.fit(); await handle.exportPng({ zoom: 2 })
```

`WorldHandle`: `update`, `setTheme`, `setReducedMotion`, `resize`, `hitTest(clientX, clientY)`, `zoomTo`,
`zoom`, `fit`, `clientPointOf(id)`, `exportPng`, `destroy` (idempotent). The engine sets no styles on the
canvas: the app gives it `tabindex="0"`, an `aria-label`, `width/height: 100%` and `touch-action: none`.

Input: drag pans, wheel and pinch zoom in whole steps, hover and tap call `onHover`. With the canvas
focused, arrows pan 32 px, `+`/`=`/`-` zoom, `0` fits and Escape clears the tooltip. **Enter** starts
browsing what has been built (newest first): the arrows then step through the buildings in draw order, the
view follows and `onHover` fires with `via: 'keyboard'`; Escape or Tab leaves.

## Decisions

- **Sprites are painted at 1x and stamped**, not repainted at every zoom (above). Same pixels, far cheaper.
- **Outlines are per part.** Each part of a building (walls, roof, tower, wall, keep) gets a 1 px outline
  one shade darker than itself, painted by drawing it four times offset; later parts cover earlier ones. In
  daylight the outline is pulled towards a warm grey so nine hues share one calm ink.
- **Door 3x5 and windows 3x3 follow the wall's 2:1 slope**, so their bottoms step like the wall does.
- **The obelisk is 4x24, not 3x24**, so both faces get two pixels.
- **Shrubs, not trees, are the scenery.** `decor` renders as low bushes, flowers, stones and a small fir, so
  a real tree on the map always means something earned. They are at most 9 px tall and can never be
  overdrawn by the building beside them.
- **Windows are lit by a golden-ratio sequence** (per building offset) rather than a random roll each: the
  lights are spread evenly, no tower is left dark by bad luck, and a window lit at one streak level stays lit
  at every higher one.
- **Lights are a second layer drawn after the night overlay**, so they stay bright. The overlay is
  `rgba(20, 26, 38, 0.4 * ambient)` in light theme and `0.28` in dark, which is already dark (8B).
- **People are 1x3 px** and, being on the dynamic layer, are painted over again by any building nearer the
  viewer that overlaps them (clipped to their few pixels), so they walk behind houses.
- **The fountain** stands at the right-hand edge of the first landmark's or monument's plaza. Fireworks
  (streak 30, night, motion on) burst above it.
- **Birds** fly in the sky, in screen space, in the top fifth, day and dusk only.
- **Fit view** is the largest whole zoom (1-4) that fits the world with 24 px of padding, centred; until the
  person pans or zooms, the view re-fits as the world grows and the window changes.
- **Export** draws the whole world at zoom 2 (less if a side would pass 8192 px), with a 24 px margin, the
  sky at the current time and a caption `Forge · Sep 29, 2026 · 42 tiles · 12 floors` in 12 px (times the
  zoom) Inter. No hover outline, no people.
- **The hit box is the sprite box**, refined by the footprint diamond in its lower half. Where a nearer
  building's roof stands over the middle of a footprint, that building is what you hit, as it is what you see.

## Unsure

- Whether zoom 4 is worth its memory on very large worlds with a high pixel ratio: the windowed cache keeps
  it bounded, but a full rebuild at a window edge can take a couple of frames on a slow laptop.
- Back-dated imports reshuffle the city (see above); a stored `worldTiles` cache could pin it, and the table
  exists, but it is not used yet.
- Screen readers get a text description of the world and a live line for the item being browsed, not a list
  of every building.
