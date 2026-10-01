/**
 * Sound and notifications for the focus feature. The focus manifest registers:
 *   slots:     `settings.sections` → SoundSection, `focus.aside` → SoundPanel, `sidebar.footer` → MiniPlayer,
 *              `focus.afterSession` → NotifyPrompt
 *   shortcuts: soundShortcuts     commands: soundCommands (register both; a command points at a shortcut)
 * and calls `alertSessionEnd(settings, …)` when a session finishes.
 */
export { SoundSection } from './SoundSection'
export { SoundPanel } from './SoundPanel'
export { MiniPlayer } from './MiniPlayer'
export { NotifyPrompt } from './NotifyPrompt'
export { soundShortcuts, soundCommands, AMBIENT_SHORTCUT_ID } from './commands'
export { alertSessionEnd, planSessionEndAlert, type SessionEndMessage } from './sessionEnd'
export { toggleSounds } from './actions'
export { useSoundSettings, useNotifyPermission, type SoundSettings } from './hooks'
