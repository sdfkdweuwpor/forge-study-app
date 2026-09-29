/** The mark's drawing on a 64-unit grid (4-unit steps, so it stays crisp at 16 and 32px). */
const TILE_RADIUS = 14
const F_PATH = 'M16 12h28v8H24v8h40v8H24v16h-8z'

/**
 * The Forge mark: a bold F on a black tile whose middle arm breaks out through the tile's edge,
 * breaking through procrastination. Same drawing as public/favicon.svg. Colours come from the
 * --logo-* tokens: in dark themes a 1px --border-strong ring outlines the tile, and the arm breaks
 * the ring too.
 */
export function Logo({ size = 22 }: { size?: number }) {
  // The ring is the tile's outer 1 CSS px: a full tile underneath, the tile inset by 1px on top.
  const ring = 64 / size
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx={TILE_RADIUS} fill="var(--logo-ring)" />
      <rect
        x={ring}
        y={ring}
        width={64 - 2 * ring}
        height={64 - 2 * ring}
        rx={TILE_RADIUS - ring}
        fill="var(--logo-tile)"
      />
      <path fill="var(--logo-mark)" d={F_PATH} />
    </svg>
  )
}
