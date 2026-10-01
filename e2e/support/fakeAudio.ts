import type { Page } from '@playwright/test'

/**
 * Records what the sound mixer builds, on the real Web Audio of the test browser (nothing is heard in a
 * headless run). `window.__audio.layers` is how many layer graphs are connected to the master bus right now:
 * the master bus is the first gain the engine makes, and a layer is whatever connects to it and has not
 * disconnected. `contexts` counts the AudioContexts made, so a tab that must stay silent can prove it.
 */
export async function recordAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const layers = new Set<AudioNode>()
    const masters = new WeakSet<AudioNode>()
    const state = { contexts: 0 }
    Object.defineProperty(window, '__audio', {
      value: {
        get layers() {
          return layers.size
        },
        get contexts() {
          return state.contexts
        },
      },
    })
    const proto = BaseAudioContext.prototype
    const createGain = proto.createGain
    const firstGain = new WeakSet<BaseAudioContext>()
    proto.createGain = function (this: BaseAudioContext) {
      const g = createGain.call(this)
      if (!firstGain.has(this)) {
        firstGain.add(this)
        masters.add(g)
        state.contexts += 1
      }
      return g
    }
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown
    AudioNode.prototype.connect = function (this: AudioNode, dest: unknown, ...rest: unknown[]) {
      if (masters.has(dest as AudioNode)) layers.add(this)
      return connect.call(this, dest, ...rest)
    } as typeof AudioNode.prototype.connect
    const disconnect = AudioNode.prototype.disconnect as (this: AudioNode, ...a: unknown[]) => void
    AudioNode.prototype.disconnect = function (this: AudioNode, ...args: unknown[]) {
      if (args.length === 0 || masters.has(args[0] as AudioNode)) layers.delete(this)
      disconnect.apply(this, args)
    } as typeof AudioNode.prototype.disconnect
  })
}

/** For the "this browser has no Web Audio" case. */
export async function removeAudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'AudioContext')
    Reflect.deleteProperty(window, 'webkitAudioContext')
  })
}

export const layerCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __audio: { layers: number } }).__audio.layers)

export const contextCount = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __audio: { contexts: number } }).__audio.contexts)
