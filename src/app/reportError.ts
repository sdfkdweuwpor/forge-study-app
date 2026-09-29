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

export function recordError(error: unknown, detail?: string): void {
  const message = error instanceof Error ? error.message : String(error)
  errors.push({ at: Date.now(), message, ...(detail ? { detail } : {}) })
  if (errors.length > MAX) errors.shift()
}

export function getRecordedErrors(): readonly RecordedError[] {
  return errors
}
