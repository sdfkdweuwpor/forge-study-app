/**
 * Generated sound for Forge: a soft chime and the sound mixer, all synthesised with the Web
 * Audio API (no audio files). Nothing runs on import; the AudioContext is created on first use.
 *
 * `playLevelUp()` (Phase 6) is a warm rising arpeggio for the level-up moment, built from the same pieces.
 */
export { playChime, DEFAULT_CHIME_VOLUME } from './chime'
export { playLevelUp, DEFAULT_LEVEL_UP_VOLUME } from './levelUp'
export { applyMix, stopMix, playingLayers, isMixPlaying } from './mixer'
export {
  unlockAudio,
  armAudioUnlock,
  audioSupported,
  contextStatus,
  subscribeAudio,
  type ContextStatus,
} from './engine'
export { volumeToGain, clamp01 } from './envelope'
