import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandCtx, OverlayApi, ShortcutDef } from '../registry/types'
import { SEQUENCE_TIMEOUT_MS, ShortcutController, type KeyEventLike } from './controller'

const overlays: OverlayApi = {
  open: () => {},
  close: () => {},
  toggle: () => {},
  isOpen: () => false,
}

function press(
  c: ShortcutController,
  key: string,
  opts: Partial<KeyEventLike> & { editable?: boolean } = {},
): { prevented: boolean } {
  const { editable = false, ...rest } = opts
  let prevented = false
  c.handleKeyDown(
    {
      key,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      isComposing: false,
      preventDefault: () => {
        prevented = true
      },
      ...rest,
    },
    editable,
  )
  return { prevented }
}

function make(defs: ShortcutDef[], mac = false): ShortcutController {
  const c = new ShortcutController(mac)
  c.setShortcuts(defs)
  c.setOverlays(overlays)
  return c
}

const def = (id: string, keys: string, extra: Partial<ShortcutDef> = {}): ShortcutDef => ({
  id,
  keys,
  description: id,
  group: 'Test',
  scope: 'global',
  ...extra,
})

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('ShortcutController', () => {
  it('fires a direct run and prevents default', () => {
    const run = vi.fn()
    const c = make([def('a', 'q', { run })])
    expect(press(c, 'q').prevented).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toMatchObject({
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it('ignores single keys while typing, unless allowInInputs', () => {
    const q = vi.fn()
    const k = vi.fn()
    const c = make([def('q', 'q', { run: q }), def('k', 'mod+k', { run: k, allowInInputs: true })])
    press(c, 'q', { editable: true })
    press(c, 'k', { editable: true, ctrlKey: true })
    expect(q).not.toHaveBeenCalled()
    expect(k).toHaveBeenCalledTimes(1)
  })

  it('completes `g t` within the window and ignores it after the timeout', () => {
    const go = vi.fn()
    const c = make([def('go', 'g t', { run: go })])
    press(c, 'g')
    press(c, 't')
    expect(go).toHaveBeenCalledTimes(1)

    press(c, 'g')
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS + 1)
    press(c, 't')
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('treats a non-continuation as a fresh press', () => {
    const q = vi.fn()
    const c = make([def('go', 'g t', { run: () => {} }), def('q', 'q', { run: q })])
    press(c, 'g')
    press(c, 'q')
    expect(q).toHaveBeenCalledTimes(1)
  })

  it('maps mod to ⌘ on Mac and Ctrl elsewhere', () => {
    const run = vi.fn()
    const mac = make([def('t', 'mod+\\', { run })], true)
    press(mac, '\\', { ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
    press(mac, '\\', { metaKey: true })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('only fires scoped shortcuts while their scope is on the stack, and deeper scopes win', () => {
    const global = vi.fn()
    const tasks = vi.fn()
    const c = make([def('g', 'x', { run: global }), def('t', 'x', { run: tasks, scope: 'tasks' })])
    press(c, 'x')
    expect([global.mock.calls.length, tasks.mock.calls.length]).toEqual([1, 0])

    const pop = c.pushScope('tasks')
    expect(c.getScopes()).toEqual(['tasks'])
    press(c, 'x')
    expect([global.mock.calls.length, tasks.mock.calls.length]).toEqual([1, 1])

    pop()
    expect(c.getScopes()).toEqual([])
    press(c, 'x')
    expect([global.mock.calls.length, tasks.mock.calls.length]).toEqual([2, 1])
  })

  it('suppresses global shortcuts under an overlay scope, except allowInOverlays ones', () => {
    const q = vi.fn()
    const esc = vi.fn()
    const typing = vi.fn()
    const c = make([
      def('q', 'q', { run: q }),
      def('esc', 'esc', { run: esc, allowInOverlays: true }),
      // Being allowed in inputs is not the same as being allowed under an overlay.
      def('typing', 'mod+j', { run: typing, allowInInputs: true }),
    ])
    c.pushScope('modal')
    press(c, 'q')
    press(c, 'Escape')
    press(c, 'j', { ctrlKey: true })
    expect(q).not.toHaveBeenCalled()
    expect(typing).not.toHaveBeenCalled()
    expect(esc).toHaveBeenCalledTimes(1)
  })
  it('leaves a def inert (and the key untouched) until a handler is bound; latest handler wins', () => {
    const c = make([def('app.toggle', 'mod+\\', { allowInInputs: true })])
    expect(press(c, '\\', { ctrlKey: true }).prevented).toBe(false)

    const first = vi.fn()
    const second = vi.fn()
    const off1 = c.bindHandler('app.toggle', first)
    const off2 = c.bindHandler('app.toggle', second)
    press(c, '\\', { ctrlKey: true })
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([0, 1])

    off2()
    press(c, '\\', { ctrlKey: true })
    expect(first).toHaveBeenCalledTimes(1)

    off1()
    expect(press(c, '\\', { ctrlKey: true }).prevented).toBe(false)
  })

  it('invoke runs the bound handler with a command context that can invoke others', () => {
    const inner = vi.fn()
    const c = make([def('outer', 'o'), def('inner', 'i')])
    c.bindHandler('inner', inner)
    c.bindHandler('outer', (ctx: CommandCtx) => ctx.invoke('inner'))
    c.invoke('outer')
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('ignores events that were already handled or are part of IME composition', () => {
    const run = vi.fn()
    const c = make([def('q', 'q', { run })])
    press(c, 'q', { defaultPrevented: true })
    press(c, 'q', { isComposing: true })
    expect(run).not.toHaveBeenCalled()
  })

  it('ignores IME keys (keyCode 229) and events without a string key', () => {
    const run = vi.fn()
    const c = make([def('q', 'q', { run })])
    press(c, 'q', { keyCode: 229 })
    // A synthetic event (browser autofill) can lack `key`.
    const broken = { ...({} as KeyEventLike), key: undefined as unknown as string }
    expect(() =>
      c.handleKeyDown(
        {
          ...broken,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
          altKey: false,
          defaultPrevented: false,
          isComposing: false,
          preventDefault: () => {},
        },
        false,
      ),
    ).not.toThrow()
    expect(run).not.toHaveBeenCalled()
  })

  it('does not re-run a shortcut on key auto-repeat, but keeps the browser default suppressed', () => {
    const run = vi.fn()
    const c = make([def('a', 'q', { run })])
    expect(press(c, 'q').prevented).toBe(true)
    expect(press(c, 'q', { repeat: true }).prevented).toBe(true)
    expect(press(c, 'q', { repeat: true }).prevented).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    // Keys nobody owns are left alone.
    expect(press(c, 'z', { repeat: true }).prevented).toBe(false)
  })

  it('holding `g` does not become `g g`', () => {
    const goGoals = vi.fn()
    const goToday = vi.fn()
    const c = make([def('goals', 'g g', { run: goGoals }), def('today', 'g t', { run: goToday })])
    press(c, 'g')
    press(c, 'g', { repeat: true })
    press(c, 'g', { repeat: true })
    expect(goGoals).not.toHaveBeenCalled()
    // The sequence is still pending, so the real second key completes it.
    press(c, 't')
    expect(goToday).toHaveBeenCalledTimes(1)
  })

  it('does not complete a sequence with a repeated second key', () => {
    const go = vi.fn()
    const c = make([def('go', 'g t', { run: go })])
    press(c, 'g')
    press(c, 't', { repeat: true })
    expect(go).not.toHaveBeenCalled()
  })

  it('matches by physical key on a non-Latin layout, including in sequences', () => {
    const palette = vi.fn()
    const go = vi.fn()
    const c = make([
      def('palette', 'mod+k', { run: palette, allowInInputs: true }),
      def('go', 'g t', { run: go }),
    ])
    press(c, 'л', { ctrlKey: true, code: 'KeyK' })
    expect(palette).toHaveBeenCalledTimes(1)
    press(c, 'п', { code: 'KeyG' })
    press(c, 'е', { code: 'KeyT' })
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('treats ⌥-modified letters on a Mac by their physical key', () => {
    const run = vi.fn()
    const c = make([def('alt-k', 'alt+k', { run })], true)
    press(c, '˚', { altKey: true, code: 'KeyK' })
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('blocking scopes', () => {
  const tasksDefs = (): {
    defs: ShortcutDef[]
    complete: () => number
    escape: () => number
    appEsc: () => number
  } => {
    const complete = vi.fn()
    const escape = vi.fn()
    const appEsc = vi.fn()
    return {
      defs: [
        def('tasks.complete', 'x', { scope: 'tasks', run: complete }),
        def('tasks.escape', 'esc', { scope: 'tasks', run: escape }),
        def('app.escape', 'esc', { run: appEsc, allowInInputs: true, allowInOverlays: true }),
      ],
      complete: () => complete.mock.calls.length,
      escape: () => escape.mock.calls.length,
      appEsc: () => appEsc.mock.calls.length,
    }
  }

  it.each(['modal', 'menu', 'palette', 'fullscreen', 'drawer'] as const)(
    'a %s scope hides the page scopes beneath it, and they come back when it closes',
    (overlay) => {
      const t = tasksDefs()
      const c = make(t.defs)
      c.pushScope('tasks')
      press(c, 'x')
      expect(t.complete()).toBe(1)

      const close = c.pushScope(overlay)
      press(c, 'x')
      expect(t.complete()).toBe(1)

      close()
      press(c, 'x')
      expect(t.complete()).toBe(2)
    },
  )

  it('keeps the browser default for a page key that an overlay has hidden', () => {
    const t = tasksDefs()
    const c = make(t.defs)
    c.pushScope('tasks')
    c.pushScope('palette')
    expect(press(c, 'x').prevented).toBe(false)
  })

  it('lets the overlay own shortcuts, and scopes pushed above it, fire', () => {
    const own = vi.fn()
    const inner = vi.fn()
    const c = make([
      def('modal.next', 'mod+enter', { scope: 'modal', run: own }),
      def('goal.rebalance', 'shift+r', { scope: 'goal', run: inner }),
    ])
    c.pushScope('tasks')
    c.pushScope('modal')
    press(c, 'Enter', { ctrlKey: true })
    expect(own).toHaveBeenCalledTimes(1)

    // A scope opened inside the dialog belongs to the dialog.
    c.pushScope('goal')
    press(c, 'R', { shiftKey: true })
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('only the top overlay counts: a scope under a second overlay stays hidden', () => {
    const a = vi.fn()
    const b = vi.fn()
    const c = make([
      def('drawer.k', 'k', { scope: 'drawer', run: a }),
      def('palette.k', 'k', { scope: 'palette', run: b }),
    ])
    c.pushScope('drawer')
    c.pushScope('palette')
    press(c, 'k')
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([0, 1])
  })

  it('Esc closes the overlay first: a page esc does not swallow the global one', () => {
    const t = tasksDefs()
    const c = make(t.defs)
    c.pushScope('tasks')

    // No overlay: the page owns Esc (clear the selection, close the peek).
    press(c, 'Escape')
    expect([t.escape(), t.appEsc()]).toEqual([1, 0])

    // The drawer is open: the global Esc closes it, the page's does not run.
    const closeDrawer = c.pushScope('drawer')
    expect(press(c, 'Escape').prevented).toBe(true)
    expect([t.escape(), t.appEsc()]).toEqual([1, 1])

    // Closed again: back to the page.
    closeDrawer()
    press(c, 'Escape')
    expect([t.escape(), t.appEsc()]).toEqual([2, 1])
  })

  describe('a pinned overlay (the drawer and the More sheet)', () => {
    it('keeps a page scope that mounts after it opened beneath it, so its esc cannot win', () => {
      const t = tasksDefs()
      const c = make(t.defs)
      // The sheet is open before the lazy page has mounted...
      const closeDrawer = c.pushScope('drawer', { pinned: true })
      // ...and then the page's scope arrives.
      c.pushScope('tasks')
      expect(c.getScopes()).toEqual(['tasks', 'drawer'])

      press(c, 'x')
      expect(t.complete()).toBe(0)
      expect(press(c, 'Escape').prevented).toBe(true)
      expect([t.escape(), t.appEsc()]).toEqual([0, 1])

      // Closed: the page has the keyboard.
      closeDrawer()
      press(c, 'x')
      expect(t.complete()).toBe(1)
      press(c, 'Escape')
      expect([t.escape(), t.appEsc()]).toEqual([1, 1])
    })

    it('without pinning, the same late page scope sits on top (why the option exists)', () => {
      const t = tasksDefs()
      const c = make(t.defs)
      c.pushScope('drawer')
      c.pushScope('tasks')
      expect(c.getScopes()).toEqual(['drawer', 'tasks'])
      press(c, 'Escape')
      expect([t.escape(), t.appEsc()]).toEqual([1, 0])
    })

    it('still lets an overlay opened over it stack on top, and a page scope goes under both', () => {
      const c = make([])
      c.pushScope('today')
      c.pushScope('drawer', { pinned: true })
      c.pushScope('modal')
      c.pushScope('tasks')
      expect(c.getScopes()).toEqual(['today', 'tasks', 'drawer', 'modal'])
    })

    it('leaves the order alone when nothing is pinned, and when the pinned scope has gone', () => {
      const c = make([])
      const close = c.pushScope('drawer', { pinned: true })
      close()
      c.pushScope('today')
      c.pushScope('tasks')
      expect(c.getScopes()).toEqual(['today', 'tasks'])
    })
  })

  it('Esc reaches the global handler even while typing in an overlay input', () => {
    const t = tasksDefs()
    const c = make(t.defs)
    c.pushScope('tasks')
    c.pushScope('palette')
    press(c, 'Escape', { editable: true })
    expect([t.escape(), t.appEsc()]).toEqual([0, 1])
  })

  it('a stacked overlay resolves Esc to its own shortcut before the global one', () => {
    const drawerEsc = vi.fn()
    const paletteEsc = vi.fn()
    const c = make([
      def('drawer.esc', 'esc', { scope: 'drawer', run: drawerEsc }),
      def('palette.esc', 'esc', { scope: 'palette', run: paletteEsc }),
    ])
    c.pushScope('drawer')
    const closePalette = c.pushScope('palette')
    press(c, 'Escape')
    expect([drawerEsc.mock.calls.length, paletteEsc.mock.calls.length]).toEqual([0, 1])
    closePalette()
    press(c, 'Escape')
    expect([drawerEsc.mock.calls.length, paletteEsc.mock.calls.length]).toEqual([1, 1])
  })

  it('allowInOverlays can name the overlays it stays live under', () => {
    const toggle = vi.fn()
    const c = make([def('toggle', 'mod+\\', { run: toggle, allowInOverlays: ['drawer'] })])
    c.pushScope('modal')
    press(c, '\\', { ctrlKey: true })
    expect(toggle).not.toHaveBeenCalled()

    const c2 = make([def('toggle', 'mod+\\', { run: toggle, allowInOverlays: ['drawer'] })])
    c2.pushScope('drawer')
    press(c2, '\\', { ctrlKey: true })
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('a non-overlay scope does not block, and `blocking` overrides the default either way', () => {
    const page = vi.fn()
    const c = make([
      def('t.x', 'x', { scope: 'tasks', run: page }),
      def('g', 'q', { run: () => {} }),
    ])
    c.pushScope('tasks')
    c.pushScope('calendar')
    press(c, 'x')
    expect(page).toHaveBeenCalledTimes(1)

    // A custom panel can opt in to blocking...
    const off = c.pushScope('review', { blocking: true })
    press(c, 'x')
    expect(page).toHaveBeenCalledTimes(1)
    off()

    // ...and a `modal` that is really a passive toast can opt out.
    c.pushScope('modal', { blocking: false })
    press(c, 'x')
    expect(page).toHaveBeenCalledTimes(2)
  })

  it('removes the scope it pushed, even when the same scope is on the stack twice', () => {
    const c = make([])
    const first = c.pushScope('modal')
    const second = c.pushScope('modal')
    const seen: number[] = []
    c.subscribe(() => seen.push(c.getScopes().length))

    first()
    expect(c.getScopes()).toEqual(['modal'])
    first() // A second call is a no-op and does not notify.
    second()
    expect(c.getScopes()).toEqual([])
    expect(seen).toEqual([1, 0])
  })

  it('a sequence is not started under an overlay that hides it', () => {
    const go = vi.fn()
    const c = make([def('go', 'g t', { run: go })])
    c.pushScope('drawer')
    press(c, 'g')
    press(c, 't')
    expect(go).not.toHaveBeenCalled()
  })
})
