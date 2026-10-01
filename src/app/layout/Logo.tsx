/** The mark's drawing on a 64-unit grid (4-unit steps, so it stays crisp at 16 and 32px). */
const TILE_RADIUS = 14
const CHEVRON_PATH = 'M32 10 50 28 44 34 32 22 20 34 14 28Z'
const BAR_PATH = 'M12 42h16l-4 8H12zM36 42h16v8H40z'

/**
 * The Forge mark ("breach"): an upward chevron that has just punched through a bar, leaving it
 * split with sheared edges: breaking through procrastination. Same drawing as public/favicon.svg.
 * Colours come from the --logo-* tokens: in dark themes a 1px --border-strong ring outlines the tile.
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
      <path fill="var(--logo-mark)" d={CHEVRON_PATH} />
      <path fill="var(--logo-mark)" d={BAR_PATH} />
    </svg>
  )
}
