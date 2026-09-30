import type { Page } from '@playwright/test'

/** One screenshot target. Captured for light/dark × 1440×900 and 375×812. */
export interface Shot {
  /** File-name fragment, e.g. `today` or `tasks-board`. */
  name: string
  /** App path incl. query, e.g. `/?seed=wgu` or `/goals?seed=empty`. */
  path: string
  /** Optional selector to wait for before capturing (default: first child of #root). */
  waitFor?: string
  /** Optional interaction before capturing (open a menu, type in the palette…). */
  prepare?: (page: Page) => Promise<void>
  /** Capture the full scrollable page instead of the viewport. */
  fullPage?: boolean
  /** Capture only this element (a close-up), e.g. `figure:has(#heat)`. Taken at 2x device pixels. */
  element?: string
}

/** Default export of every `scripts/shots/<feature>.ts`. */
export interface ShotList {
  feature: string
  shots: Shot[]
}
