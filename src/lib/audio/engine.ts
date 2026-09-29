/**
 * The one AudioContext. Created lazily (never on import), resumed on the first user gesture, and
 * routed through a small limiter so a chime on top of a loud ambient bed can never clip.
 *
 *   sources → ambientBus (volume) ─┐
 *   chime notes ───────────────────┴→ limiter → destination
 *
 * Browsers only let audio start after a user gesture. `unlockAudio()` is meant for a click or key
 * handler (a Start button). `armAudioUnlock()` covers the case where nothing called it: it waits for
 * the next pointer or key press and unlocks then.
 */
import { volumeToGain } from './envelope'

type ContextCtor = typeof AudioContext

let ctx: AudioContext | null = null
let limiter: DynamicsCompressorNode | null = null
let ambientBus: GainNode | null = null
let ambientVolume = 0.4
let unlockArmed = false

const listeners = new Set<() => void>()

/** Calls `listener` whenever the audio state changes (context state, ambient kind). For `useSyncExternalStore`. */
export function subscribeAudio(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitAudioChange(): void {
  for (const listener of [...listeners]) listener()
}

function contextCtor(): ContextCtor | null {
  const g = globalThis as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor }
  return g.AudioContext ?? g.webkitAudioContext ?? null
}

/** Whether this browser can make sound at all. */
export function audioSupported(): boolean {
  return contextCtor() !== null
}

/** The shared context, created on first use, or `null` where Web Audio is unavailable. */
export function getContext(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx
  const Ctor = contextCtor()
  if (!Ctor) return null
  try {
    // 'playback' trades a little latency for less CPU and battery: nothing here is interactive.
    ctx = new Ctor({ latencyHint: 'playback' })
  } catch {
    ctx = null
    return null
  }
  const c = ctx
  limiter = c.createDynamicsCompressor()
  limiter.threshold.value = -10
  limiter.knee.value = 14
  limiter.ratio.value = 8
  limiter.attack.value = 0.005
  limiter.release.value = 0.25
  limiter.connect(c.destination)
  ambientBus = c.createGain()
  ambientBus.gain.value = volumeToGain(ambientVolume)
  ambientBus.connect(limiter)
  c.addEventListener('statechange', emitAudioChange)
  if (c.state !== 'running') armAudioUnlock()
  return c
}

/** Where chime notes connect. */
export function outputNode(ctxIn: AudioContext): AudioNode {
  return limiter && ctxIn === ctx ? limiter : ctxIn.destination
}

/** Where ambient graphs connect (carries the ambient volume). */
export function ambientOutput(ctxIn: AudioContext): AudioNode {
  return ambientBus && ctxIn === ctx ? ambientBus : outputNode(ctxIn)
}

/**
 * Resumes a suspended context. Resolves true once it is running. Never waits longer than `timeoutMs`
 * (a resume that needs a gesture stays pending until one arrives, and callers must not hang on it).
 */
export function resumeContext(c: AudioContext, timeoutMs = 300): Promise<boolean> {
  if (c.state === 'running') return Promise.resolve(true)
  const attempt = c.resume().then(
    () => c.state === 'running',
    () => false,
  )
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(c.state === 'running'), timeoutMs)
  })
  return Promise.race([attempt, timeout])
}

/**
 * Creates and resumes the context. Call from a user gesture (a click or key handler) so that
 * strict browsers such as Safari allow it. Resolves true when audio is ready. Never throws.
 */
export async function unlockAudio(): Promise<boolean> {
  const c = getContext()
  if (!c) return false
  return resumeContext(c)
}

/**
 * Unlocks the context on the next pointer or key press, then removes itself. Idempotent, and safe
 * to call on mount: it does nothing until the person actually interacts.
 */
export function armAudioUnlock(): void {
  if (unlockArmed || typeof document === 'undefined') return
  unlockArmed = true
  const events = ['pointerdown', 'keydown', 'touchend'] as const
  const handler = () => {
    const c = getContext()
    if (c && c.state === 'running') {
      remove()
      return
    }
    if (c) {
      void resumeContext(c).then((ok) => {
        if (ok) remove()
      })
    }
  }
  const remove = () => {
    for (const e of events) document.removeEventListener(e, handler, true)
    unlockArmed = false
  }
  for (const e of events) document.addEventListener(e, handler, { capture: true, passive: true })
}

export type ContextStatus = 'unsupported' | 'idle' | 'suspended' | 'running'

/** `idle` means no context has been created yet (no sound has been asked for). */
export function contextStatus(): ContextStatus {
  if (!audioSupported()) return 'unsupported'
  if (!ctx || ctx.state === 'closed') return 'idle'
  return ctx.state === 'running' ? 'running' : 'suspended'
}

/** Sets the ambient volume (0..1), smoothed so dragging a slider makes no zipper noise. */
export function setBusVolume(volume: number): void {
  ambientVolume = volume
  if (ctx && ambientBus) {
    ambientBus.gain.setTargetAtTime(volumeToGain(volume), ctx.currentTime, 0.04)
  }
}
