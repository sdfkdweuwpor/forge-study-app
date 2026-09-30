/**
 * Palette commands and shortcuts have no React context, so they post a window event and
 * `ExportCommandHost` (a `global.overlays` slot) runs the export and shows the toast.
 */
export type ExportCommand = 'csv' | 'markdown' | 'ics'
export const EXPORT_EVENT = 'forge:export'

export function requestExport(kind: ExportCommand): void {
  window.dispatchEvent(new CustomEvent<ExportCommand>(EXPORT_EVENT, { detail: kind }))
}
