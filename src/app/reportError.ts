/**
 * In-memory error log. There is no console output (lint forbids it) and no telemetry, so errors
 * caught by boundaries and boot tasks are kept here for a future "Diagnostics" view in Settings.
 */

export interface RecordedError {
  at: number
  message: string
  detail?: string
}

const MAX = 50
const errors: RecordedError[] = []

/** Anything can be thrown (`throw null`, a string, a rejected object); this always yields a real Error. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string' && value !== '') return new Error(value)
  if (typeof value === 'object' && value !== null) {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string' && message !== '') return new Error(message)
    try {
      return new Error(JSON.stringify(value))
    } catch {
      /* circular or otherwise unserialisable: fall through */
    }
  }
  return new Error(value === undefined || value === null ? 'Unknown error' : String(value))
}

export function recordError(error: unknown, detail?: string): void {
  errors.push({ at: Date.now(), message: toError(error).message, ...(detail ? { detail } : {}) })
  if (errors.length > MAX) errors.shift()
}

export function getRecordedErrors(): readonly RecordedError[] {
  return errors
}
