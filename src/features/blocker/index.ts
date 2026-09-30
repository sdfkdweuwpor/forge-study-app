/**
 * Public API of the blocker feature. Other features import from `@/features/blocker` only.
 *
 * - `useConnection()`: whether the Chrome extension is connected (and its version), live.
 * - `checkExtension()`: asks the extension again and updates `useConnection()`.
 * - `Favicon`: a site's icon over a letter avatar (the onboarding flow's site chips).
 */
export { useConnection, isConnected } from './connection'
export type { Connection } from './connection'
export { checkExtension } from './sync'
export { Favicon } from './Favicon'
