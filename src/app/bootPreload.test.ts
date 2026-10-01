import { lazy, type ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { preloadForRoute, preloadLazy, preloadOverlays } from './bootPreload'
import { buildRegistry } from './registry/registry'
import type { FeatureManifest } from './registry/types'

const Nothing: ComponentType = () => null

/** A lazy component whose loader is a spy, so a test can see when (and how often) it was started. */
function spyLazy(): { component: ReturnType<typeof lazy>; load: ReturnType<typeof vi.fn> } {
  const load = vi.fn(() => Promise.resolve({ default: Nothing }))
  return { component: lazy(load), load }
}

describe('preloadLazy', () => {
  it('starts the loader once and says when the component has arrived', async () => {
    const { component, load } = spyLazy()
    const arrived = preloadLazy(component)
    expect(load).toHaveBeenCalledTimes(1)
    expect(arrived).toBeInstanceOf(Promise)
    await arrived
    // Loaded: nothing left to wait for, and asking again does not load it again.
    expect(preloadLazy(component)).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('ignores anything that is not a lazy component', () => {
    expect(preloadLazy(null)).toBeNull()
    expect(preloadLazy(undefined)).toBeNull()
    expect(preloadLazy(Nothing)).toBeNull()
    expect(preloadLazy({})).toBeNull()
  })

  it('never rejects: a chunk that fails to load is left for the render that needs it', async () => {
    const load = vi.fn(() => Promise.reject(new Error('chunk gone')))
    const component = lazy(load)
    await expect(preloadLazy(component)).resolves.toBeUndefined()
    // The failure is kept on the lazy object, so rendering it still reports it.
    expect(() => preloadLazy(component)).not.toThrow()
  })
})

describe('preloadForRoute and preloadOverlays', () => {
  function registryWithLoaders() {
    const page = spyLazy()
    const otherPage = spyLazy()
    const header = spyLazy()
    const sidebar = spyLazy()
    const settingsSection = spyLazy()
    const overlay = spyLazy()
    const manifests: FeatureManifest[] = [
      {
        id: 'today',
        routes: { today: page.component as never },
        slots: [
          { slot: 'today.header', id: 'today.header.a', order: 1, component: header.component },
          { slot: 'sidebar.footer', id: 'today.footer', order: 1, component: sidebar.component },
          { slot: 'global.overlays', id: 'today.overlay', order: 1, component: overlay.component },
        ],
      },
      {
        id: 'settings',
        routes: { settings: otherPage.component as never },
        slots: [
          {
            slot: 'settings.sections',
            id: 'settings.section.a',
            order: 1,
            component: settingsSection.component,
          },
        ],
      },
    ]
    return {
      registry: buildRegistry(manifests),
      page,
      otherPage,
      header,
      sidebar,
      settingsSection,
      overlay,
    }
  }

  it('fetches the page, the slots it draws and the shell’s slots, and nothing else', async () => {
    const { registry, page, otherPage, header, sidebar, settingsSection, overlay } =
      registryWithLoaders()
    await preloadForRoute(registry, '/')
    expect(page.load).toHaveBeenCalledTimes(1)
    expect(header.load).toHaveBeenCalledTimes(1)
    expect(sidebar.load).toHaveBeenCalledTimes(1)
    // Another page, its slots and the overlay hosts wait until they are needed.
    expect(otherPage.load).not.toHaveBeenCalled()
    expect(settingsSection.load).not.toHaveBeenCalled()
    expect(overlay.load).not.toHaveBeenCalled()
  })

  it('follows the address, whatever the route', async () => {
    const { registry, page, otherPage, header, settingsSection } = registryWithLoaders()
    await preloadForRoute(registry, '/settings/appearance')
    expect(otherPage.load).toHaveBeenCalledTimes(1)
    expect(settingsSection.load).toHaveBeenCalledTimes(1)
    expect(page.load).not.toHaveBeenCalled()
    expect(header.load).not.toHaveBeenCalled()
  })

  it('resolves for an address no page is registered for', async () => {
    const { registry } = registryWithLoaders()
    await expect(preloadForRoute(registry, '/definitely/not/a/page')).resolves.toBeUndefined()
  })

  it('fetches the overlay hosts in the background, and a cancel stops it', async () => {
    vi.useFakeTimers()
    // `whenIdle` reads `window`; in this node test the global object stands in for it (no idle callback, so the
    // job runs as soon as its delay is over).
    vi.stubGlobal('window', globalThis)
    try {
      const { registry, overlay } = registryWithLoaders()
      const cancel = preloadOverlays(registry)
      expect(overlay.load).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(overlay.load).toHaveBeenCalledTimes(1)
      cancel()

      const again = registryWithLoaders()
      const cancelAgain = preloadOverlays(again.registry)
      cancelAgain()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(again.overlay.load).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
