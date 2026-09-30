/**
 * Public API of the Claude plan import (Phase 5C, BRIEF §5.4).
 *
 * - `ImportGoalButton`: "Import from Claude" for the goals list; creates a new goal from JSON.
 * - `importSlots`: the `goal.panels` contribution (the import panel on the goal page).
 * - `importCommands` / `importShortcuts`: the palette entry and the `i` key.
 * - `withPlanImport(manifest)`: adds all three to a feature manifest in one call, so the goals
 *   `feature.ts` needs a single line: `export default withPlanImport(manifest)`.
 *
 * This file is imported by the app on every load, so it must not import Zod or the Dexie queries: the flow
 * (and everything with them) is loaded lazily when a panel or dialog is opened.
 */
export { ImportGoalButton } from './ImportGoalButton'
export type { ImportGoalButtonProps } from './ImportGoalButton'
export { ImportPanel } from './ImportPanel'
export { importCommands } from './commands'
export { importShortcuts } from './shortcuts'
export { importSlots, withPlanImport } from './manifest'
