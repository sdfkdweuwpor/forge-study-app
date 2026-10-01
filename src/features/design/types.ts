import type { ReactNode } from 'react'

export type DemoGroup = 'Primitives' | 'Overlays' | 'Composites'

/**
 * Contract for `src/features/design/sections/<Component>.demo.tsx`.
 * Each demo file default-exports one `DemoSection`; the /design page
 * glob-loads them and renders each in a light and a dark column.
 */
export interface DemoSection {
  /** Stable id, e.g. 'button'. Used as the anchor on /design. */
  id: string
  /** Heading shown on /design, e.g. 'Button'. */
  title: string
  group: DemoGroup
  /** Sort order within the group (lower first). */
  order: number
  /** One line on when to use the component. */
  description?: string
  /** Renders every variant and state (hover/active/focus via `data-force`, disabled, loading…). */
  render: () => ReactNode
}
