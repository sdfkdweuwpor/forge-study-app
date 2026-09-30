/**
 * Messages between the extension's own pages (blocked.html, popup) and its service worker. They
 * exist so every storage write happens in one place, the worker, where writes are queued one at a
 * time. Not part of the app contract (see protocol.ts).
 */

export type InternalMessage =
  /** A blocked page loaded in a tab: log it and count a win. */
  | { type: 'internal:blocked'; domain: string }
  /** The unlock flow finished: grant 5 minutes for the domain and log it. */
  | { type: 'internal:unlock'; domain: string }

export type InternalResponse = { ok: true } | { ok: false; error: string }

export function isInternalMessage(x: unknown): x is InternalMessage {
  if (typeof x !== 'object' || x === null) return false
  const m = x as Record<string, unknown>
  return (m['type'] === 'internal:blocked' || m['type'] === 'internal:unlock') && typeof m['domain'] === 'string'
}
