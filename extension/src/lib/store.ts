/**
 * The only module that reads or writes `chrome.storage.local`. Pages use `loadState` to read;
 * writes go through `saveChanges`, which only the service worker calls (PLAN: every write is
 * serialized in one place).
 */
import { normalizeState, STATE_KEYS, type ExtensionState } from '../shared/state.js'

/** Reads and validates everything. Malformed stored values fall back to their defaults. */
export async function loadState(): Promise<ExtensionState> {
  return normalizeState(await chrome.storage.local.get([...STATE_KEYS]))
}

/** Writes only the top-level keys whose value changed (compared by reference), so a config change does not rewrite 5,000 events. */
export async function saveChanges(previous: ExtensionState, next: ExtensionState): Promise<void> {
  const patch: Partial<ExtensionState> = {}
  let changed = false
  for (const key of STATE_KEYS) {
    if (previous[key] !== next[key]) {
      Object.assign(patch, { [key]: next[key] })
      changed = true
    }
  }
  if (changed) await chrome.storage.local.set(patch)
}
