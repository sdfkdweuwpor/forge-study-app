/**
 * Sound and notifications for the focus feature (Phase 4B). The focus manifest registers:
 *   slots:     `settings.sections` → SoundSection, `focus.aside` (or the Focus page) → AmbientControl,
 *              `focus.afterSession` → NotifyPrompt
 *   shortcuts: soundShortcuts     commands: soundCommands (register both; a command points at a shortcut)
 * and calls `alertSessionEnd(settings, …)` when a session finishes.
 */
export { SoundSection } from './SoundSection'
export { AmbientControl, type AmbientControlProps } from './AmbientControl'
export { NotifyPrompt } from './NotifyPrompt'
export { soundShortcuts, soundCommands, AMBIENT_SHORTCUT_ID } from './commands'
export { alertSessionEnd, planSessionEndAlert, type SessionEndMessage } from './sessionEnd'
export { chooseAmbient, toggleAmbient, toggleSounds } from './actions'
export { useSoundSettings, useAmbientKind, useNotifyPermission, type SoundSettings } from './hooks'
