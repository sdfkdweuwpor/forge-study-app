/**
 * Public API of the blocker feature. Other features import from `@/features/blocker` only.
 *
 * - `useConnection()`: whether the Chrome extension is connected (and its version), live.
 * - `checkExtension()`: asks the extension again and updates `useConnection()`.
 */
export { useConnection, isConnected } from './connection'
export type { Connection } from './connection'
export { checkExtension } from './sync'
