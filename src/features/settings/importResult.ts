/**
 * An import ends with a reload (so timers, caches and every screen start from the new data), and a toast
 * cannot outlive a reload. The count is left in sessionStorage for `SettingsHost` to announce afterwards.
 */
const KEY = 'forge:import-result'

export interface ImportNotice {
  items: number
  skippedFiles: number
}

export function rememberImport(notice: ImportNotice): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(notice))
  } catch {
    /* storage unavailable: the import worked, only the toast is lost */
  }
}

/** The notice left by the last import, once. */
export function takeImportNotice(): ImportNotice | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (raw === null) return null
    window.sessionStorage.removeItem(KEY)
    const value: unknown = JSON.parse(raw)
    if (
      typeof value === 'object' &&
      value !== null &&
      'items' in value &&
      typeof value.items === 'number' &&
      'skippedFiles' in value &&
      typeof value.skippedFiles === 'number'
    ) {
      return { items: value.items, skippedFiles: value.skippedFiles }
    }
  } catch {
    /* unreadable: nothing to announce */
  }
  return null
}
