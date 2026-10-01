import type { ID } from '@/db/types'

const hex = (b: number): string => b.toString(16).padStart(2, '0')

/** RFC 4122 v4 UUID from `crypto.getRandomValues` (works in insecure contexts such as LAN http). */
function uuidFromRandomValues(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = Array.from(b, hex).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * A new random row id. `crypto.randomUUID` only exists in secure contexts (HTTPS, localhost), so
 * fall back to `getRandomValues` when the dev server is opened over a LAN IP.
 */
export function newId(): ID {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uuidFromRandomValues()
}

export const __test = { uuidFromRandomValues }
