/**
 * `/design` state demos force a pseudo-state on a component's root with `data-force`
 * ("hover", "active", "focus", or several separated by spaces). Component CSS styles
 * `[data-force~='hover']` exactly like `:hover`, and so on; global.css already draws the focus
 * ring for `[data-force~='focus']`. Never set it in product code.
 */
export type ForceState = 'hover' | 'active' | 'focus'

export interface ForceProps {
  'data-force'?: ForceState | `${ForceState} ${ForceState}`
}
