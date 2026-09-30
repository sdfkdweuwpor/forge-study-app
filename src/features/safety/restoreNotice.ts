/**
 * A restore ends with a reload (so timers, caches and every screen start from the restored data), and a
 * toast cannot outlive a reload. The result is left in sessionStorage for `SafetyHost` to announce after.
 */
const KEY = 'forge:restore-result'

export interface RestoreNotice {
  /** 'restore': a snapshot was restored. 'undo': that restore was taken back. */
  kind: 'restore' | 'undo'
  items: number
  /** When the restored snapshot was taken. */
  takenAt: number
  /** The snapshot of the data as it was just before, which "Undo restore" restores. */
  preRestoreId: string
}

export function rememberRestore(notice: RestoreNotice): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(notice))
  } catch {
    /* storage unavailable: the restore worked, only the toast is lost */
  }
}

/** The notice left by the last restore, once. */
export function takeRestoreNotice(): RestoreNotice | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (raw === null) return null
    window.sessionStorage.removeItem(KEY)
    const v: unknown = JSON.parse(raw)
    if (
      typeof v === 'object' &&
      v !== null &&
      'kind' in v &&
      (v.kind === 'restore' || v.kind === 'undo') &&
      'items' in v &&
      typeof v.items === 'number' &&
      'takenAt' in v &&
      typeof v.takenAt === 'number' &&
      'preRestoreId' in v &&
      typeof v.preRestoreId === 'string'
    ) {
      return { kind: v.kind, items: v.items, takenAt: v.takenAt, preRestoreId: v.preRestoreId }
    }
  } catch {
    /* unreadable: nothing to announce */
  }
  return null
}
