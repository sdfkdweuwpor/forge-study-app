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

  it('suppresses global shortcuts under an overlay scope, except allowInInputs ones', () => {
    const q = vi.fn()
    const esc = vi.fn()
    const c = make([
      def('q', 'q', { run: q }),
      def('esc', 'esc', { run: esc, allowInInputs: true }),
    ])
    c.pushScope('modal')
    press(c, 'q')
    press(c, 'Escape')
    expect(q).not.toHaveBeenCalled()
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
