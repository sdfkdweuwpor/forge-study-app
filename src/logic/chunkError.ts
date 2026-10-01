/**
 * Recognising the failure a browser reports when a lazily loaded chunk is gone (typically after a
 * deploy replaced the hashed files an open tab still points at), and when it is safe to auto-reload.
 * Pure: the caller supplies the error, the stored timestamp and the clock.
 */

const CHUNK_MESSAGES: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /failed to load module script/i, // wrong MIME type (an HTML page served in place of the chunk)
  /unable to preload css/i, // Vite's CSS preload helper
  /loading (css )?chunk [\w./-]+ failed/i, // webpack-style, kept for third-party chunks
]

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === 'ChunkLoadError') return true
  return typeof message === 'string' && CHUNK_MESSAGES.some((re) => re.test(message))
}

/** An automatic reload is allowed unless one already happened within `windowMs` (prevents reload loops). */
export function canAutoReload(
  lastAttemptAt: number | null,
  now: number,
  windowMs = 30_000,
): boolean {
  if (lastAttemptAt === null || !Number.isFinite(lastAttemptAt)) return true
  return now - lastAttemptAt >= windowMs || now < lastAttemptAt
}
