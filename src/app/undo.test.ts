import { afterEach, describe, expect, it, vi } from 'vitest'
import { availableCommands } from './palette/paletteModel'
import { buildShortcutGroups } from './palette/shortcutList'
import { paletteManifest } from './palette/manifest'
import { manifests } from './registry/discover'
import { builtins } from './registry/builtins'
import type { CommandCtx, OverlayApi } from './registry/types'
import { ShortcutController, type KeyEventLike } from './shortcuts/controller'
import { canUndoNow, setUndoProbe } from './undoProbe'

const overlays: OverlayApi = { open: () => {}, close: () => {}, toggle: () => {}, isOpen: () => false }
const ctx = { overlays } as unknown as CommandCtx

const shortcut = builtins.shortcuts?.find((s) => s.id === 'app.undo')
const command = builtins.commands?.find((c) => c.id === 'command.undo')

function controller(): ShortcutController {
  const c = new ShortcutController(false)
  c.setShortcuts(builtins.shortcuts ?? [])
  c.setOverlays(overlays)
  return c
}

/** Ctrl+Z (`mod+z` off a Mac), as the key event the browser sends. */
function ctrlZ(c: ShortcutController, editable: boolean): { prevented: boolean } {
  let prevented = false
  const event: KeyEventLike = {
    key: 'z',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    isComposing: false,
    preventDefault: () => {
      prevented = true
    },
  }
  c.handleKeyDown(event, editable)
  return { prevented }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mod+z: the shortcut', () => {
  it('is registered once, global, in General, and is not allowed in inputs or under overlays', () => {
    expect(shortcut).toMatchObject({
      keys: 'mod+z',
      scope: 'global',
      group: 'General',
      description: 'Undo last action',
    })
    expect(shortcut?.allowInInputs).toBeUndefined()
    expect(shortcut?.allowInOverlays).toBeUndefined()
    expect(manifests.flatMap((m) => m.shortcuts ?? []).filter((s) => s.id === 'app.undo')).toHaveLength(1)
  })

  it('is inert until UndoHost binds it, then runs the bound handler and keeps the key from the browser', () => {
    const c = controller()
    expect(ctrlZ(c, false).prevented).toBe(false)
    const handler = vi.fn()
    c.bindHandler('app.undo', handler)
    expect(ctrlZ(c, false).prevented).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('leaves the key to a text field: the app does not undo while typing, and the field keeps its own undo', () => {
    const c = controller()
    const handler = vi.fn()
    c.bindHandler('app.undo', handler)
    expect(ctrlZ(c, true)).toEqual({ prevented: false })
    expect(handler).not.toHaveBeenCalled()
  })

  it('goes quiet under a dialog, like every other global key', () => {
    const c = controller()
    const handler = vi.fn()
    c.bindHandler('app.undo', handler)
    const leave = c.pushScope('modal')
    expect(ctrlZ(c, false).prevented).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    leave()
    ctrlZ(c, false)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('is not taken by mod+shift+z, which nothing binds', () => {
    const c = controller()
    const handler = vi.fn()
    c.bindHandler('app.undo', handler)
    c.handleKeyDown(
      {
        key: 'z',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        defaultPrevented: false,
        isComposing: false,
        preventDefault: () => {},
      },
      false,
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('invoke (what the palette command calls) reaches the same handler', () => {
    const c = controller()
    const handler = vi.fn()
    c.bindHandler('app.undo', handler)
    c.invoke('app.undo')
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('mod+z: the shortcut sheet', () => {
  it('lists "Undo last action" as its own row with its own keys, apart from every other shortcut', () => {
    const all = manifests.flatMap((m) => m.shortcuts ?? [])
    const general = buildShortcutGroups(all).find((g) => g.heading === 'General')
    const rows = general?.rows.filter((r) => r.description === 'Undo last action') ?? []
    expect(rows).toEqual([{ id: 'app.undo', description: 'Undo last action', keys: ['mod+z'], scopeLabel: null }])
    // A search for it finds that row and nothing else.
    const found = buildShortcutGroups(all, 'undo').flatMap((g) => g.rows.map((r) => r.id))
    expect(found).toEqual(['app.undo'])
  })

  it('is found by its keys too', () => {
    const all = [...(builtins.shortcuts ?? []), ...(paletteManifest.shortcuts ?? [])]
    const found = buildShortcutGroups(all, 'mod z').flatMap((g) => g.rows.map((r) => r.id))
    expect(found).toEqual(['app.undo'])
  })
})

describe('mod+z: the palette entry', () => {
  it('is called "Undo", shows the shortcut, and points at the same handler', () => {
    expect(command).toMatchObject({ title: 'Undo', shortcutId: 'app.undo' })
    const invoke = vi.fn()
    void command?.run({ ...ctx, invoke })
    expect(invoke).toHaveBeenCalledWith('app.undo')
  })

  it('is listed only while something can be undone', () => {
    const commands = command ? [command] : []
    expect(canUndoNow()).toBe(false)
    expect(availableCommands(commands, ctx)).toEqual([])

    let offers = true
    const remove = setUndoProbe(() => offers)
    expect(availableCommands(commands, ctx).map((c) => c.id)).toEqual(['command.undo'])
    offers = false
    expect(availableCommands(commands, ctx)).toEqual([])

    remove()
    offers = true
    expect(canUndoNow()).toBe(false)
  })

  it('treats a probe that throws as nothing to undo', () => {
    const remove = setUndoProbe(() => {
      throw new Error('gone')
    })
    expect(canUndoNow()).toBe(false)
    remove()
  })

  it('keeps the newest probe when an older host unmounts late', () => {
    const removeOld = setUndoProbe(() => false)
    const removeNew = setUndoProbe(() => true)
    removeOld()
    expect(canUndoNow()).toBe(true)
    removeNew()
    expect(canUndoNow()).toBe(false)
  })
})
