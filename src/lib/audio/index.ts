/**
 * Generated sound for Forge: a soft chime and three ambient beds, all synthesised with the Web
 * Audio API (no audio files). Nothing runs on import; the AudioContext is created on first use.
 *
 * Phase 6 adds `playLevelUp()`: put it in its own file next to `chime.ts`, build it from the same
 * `getContext()` / `outputNode()` / `bellCurve()` pieces, and export it here.
 */
export { playChime, DEFAULT_CHIME_VOLUME } from './chime'
export {
  startAmbient,
  setAmbientVolume,
  stopAmbient,
  isAmbientPlaying,
  ambientKind,
  type AmbientKind,
} from './ambient'
export {
  unlockAudio,
  armAudioUnlock,
  audioSupported,
  contextStatus,
  subscribeAudio,
  type ContextStatus,
} from './engine'
export { volumeToGain, clamp01 } from './envelope'
