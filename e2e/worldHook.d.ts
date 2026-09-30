/**
 * The sample-data build (`?seed=`) exposes where My World draws each item, so specs and screenshot scripts
 * can hover a known tile. `src/features/world/WorldPage.tsx` declares the same shape for the app.
 */
export {}

declare global {
  interface Window {
    __forgeWorld?: {
      pointOf(id: string): { x: number; y: number } | null
      ids(): string[]
      stats(): { tiles: number; floors: number; landmarks: number; streakLevel: number } | null
    }
  }
}
