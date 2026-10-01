# Sound: generated lofi + noise mixer — design

Status: draft for review (2026-09-30)

## What the user asked for

- Lofi music in about 10 styles, generated in the app (no recordings, no streaming).
- A noise mixer: rain, wind, campfire crackle and more, each with its own level.
- Music and noises **layered** together, saved as presets.
- Plays **anytime, on any page**, not only during focus.
- An **organized panel, not sloppy**: pressing the Lofi section expands its list of styles.

Success: you pick "Tokyo night" plus light rain plus campfire in a few clicks, it keeps playing while you move around the
app, it sounds pleasant for hours without obvious loops, and the app stays fast and works offline.

Honest limit: generated lofi is a pleasant background bed. It will not sound like a produced album.

## Lists

**Lofi styles (10):** Classic lofi · Rainy day · Coffee shop · Tokyo night · Synthwave · Electronic · Jazz hop ·
Sleepy piano · Chillhop morning · Space ambient.

**Noise layers (9 sliders):** Rain · Heavy rain & thunder · Wind · Campfire · Café chatter · Ocean waves · Forest
birds · Creek · Noise (white / pink / brown, one slider with a colour switch).

Today's three ambient sounds (brown, rain, café) become layers, so nothing a user set up is lost.

## The panel (Focus page, "Sound" card)

One card with three collapsible sections, each with a one-line header that summarises its state when closed:

```
Sound                                            [▶ Play]  [Master ▬▬▬▬○]
───────────────────────────────────────────────────────────────────────────
▸ Lofi        Tokyo night · 60%                                   (closed)
▾ Sounds      Rain 40% · Campfire 25%                              (open)
    Rain            ▬▬▬▬○─────────   40%
    Heavy rain      ○────────────    off
    Wind            ○────────────    off
    Campfire        ▬▬▬○──────────   25%
    …
▸ Mixes       3 saved                                             (closed)
```

- **Lofi**: pressing the header expands a grid of the 10 styles (name + small icon + one-word mood). One is
  selected; picking another crossfades. A music volume slider and an "Off" chip sit above the grid.
- **Sounds**: one row per layer: name, slider, value. "Reset" sets all to off.
- **Mixes**: saved presets as chips; "Save current mix…" names one (max 12). Delete/rename via each chip's menu,
  with Undo.
- Section open/closed state is remembered per device. Keyboard: headers are buttons (`aria-expanded`), sliders are
  native range inputs with labels, everything reachable by Tab.
- Phones: the same card, full width; the style grid wraps to two columns.

**Mini player** in the sidebar footer (and above the tab bar on phones): play/pause, the current style or "Sounds",
and a volume popover. It is the "anytime, any page" control; clicking its name opens the Focus page's Sound card.

## Architecture

All in `src/lib/audio/` (below features in the layer rules), extending today's engine (one AudioContext, limiter,
unlock on first gesture):

| Unit | Does | Depends on |
|---|---|---|
| `music/styles.ts` | Pure data: per style tempo, swing, key, chord pool, drum pattern, instruments, texture. | nothing |
| `music/composer.ts` | Pure: from a style and a seed, yields note events bar by bar (chord progression with variation, melody fragments, drum hits, fills every 8 bars). No Web Audio. | `styles` |
| `music/instruments.ts` | Small synths from oscillators and noise: keys (FM Rhodes-like), pad, bass, kick, snare, hat, vinyl crackle, tape wobble. | engine |
| `music/player.ts` | Schedules the composer's events ~2 bars ahead with a look-ahead timer; start, stop, crossfade style. | composer, instruments |
| `noises/*.ts` | One generator per layer: looped noise buffers through filters plus sparse random events (drops, crackles, birds, thunder). Reuses today's `ambient.ts` approach. | engine, `noise.ts` |
| `mixer.ts` | Buses: music, one gain per layer, master; smooth ramps; layers at 0 are disconnected (no CPU). | engine |

The music code (`music/*`) is a separate chunk loaded on first Play, so startup JavaScript does not grow.

**Playback owner:** one tab plays (today's `ambientElection`), the others show the same state. Playing continues across
routes because the player lives in the app shell's `global.overlays` slot, not in the Focus page.

## Data

Additive, so no schema version bump (older devices ignore it):

```ts
settings.sound.mixer?: {
  music: { style: LofiStyle | 'off'; volume: number }   // 0..1
  layers: Partial<Record<NoiseLayer, number>>           // 0..1, missing = off
  noiseColor: 'white' | 'pink' | 'brown'
  master: number
  withFocus: boolean        // start sound when a focus session starts
  presets: { id: string; name: string; mix: MixSnapshot }[]   // max 12
}
```

- When `mixer` is absent it is derived from today's `ambient` / `ambientVolume`, so existing users keep their sound.
- The mix and presets sync like other settings (they are preferences). **Whether sound is playing right now** and
  which sections are open are device-only (sync's device paths), so pressing Play on the laptop never starts the phone.
- Validation at the boundary: volumes clamped to 0..1, unknown styles/layers dropped, preset names trimmed to 40 chars.

## Error handling

- Audio blocked until a gesture: Play is a gesture, so it just works; the "start with focus" path uses today's
  `armAudioUnlock()` and shows nothing if the browser still refuses.
- No Web Audio (very old browser): the card says sound isn't available here; nothing else changes.
- A generator throwing never breaks the app: the mixer drops that layer and records the error once.

## Testing

- **Unit (Node):** composer: every style stays in key and in tempo range, same seed gives same events, 30 minutes of
  events never repeat an 8-bar phrase exactly; mixer math (ramps, clamps); settings derivation from old `ambient`;
  preset validation.
- **e2e:** a fake AudioContext records the graph: the panel expands Lofi, picks a style, sets two layers, saves and
  reapplies a mix, the mini player pauses it, navigation keeps it playing, a second tab does not double it.
- **Budget:** initial JS stays ≤ 180 KB gzip (music chunk is lazy); a CPU check that the full mix stays under ~5% of
  a core in Chromium's performance profile.

## Out of scope

Recorded or streamed music, user-uploaded sounds, per-task sound profiles, an equalizer, timers that fade sound out
(the existing session end already stops "with focus" sound).

## Build order (each step reviewed and pushed)

1. Mixer + noise layers + migration of today's ambient, with the new panel's Sounds section and the mini player.
2. Composer + instruments + the 10 styles, and the Lofi section.
3. Mixes (presets), "start with focus", polish and the e2e.
