import { matchChord, parseKeys, type Chord, type KeyLike } from '@/lib/keys'
import { dayOf } from '@/logic/dates'
import type { CommandCtx, OverlayApi, ScopeId, ShortcutDef } from '../registry/types'
import { navigate } from '../router/router'

/** Sequences like `g t` must finish within this window (PLAN §5.2). */
export const SEQUENCE_TIMEOUT_MS = 1000

/**
 * Scopes that belong to an overlay (`menu` is an open dropdown or popover, the lightest of them).
 * They are **blocking** by default: while one is on top of the stack, only its own shortcuts (and any
 * scope pushed above it) plus `global` shortcuts marked `allowInOverlays` may fire, so the page
 * underneath (`tasks`, `today`, ...) and the plain global keys (`q`, `g t`, `?`) go quiet. Pass
 * `{ blocking }` to `pushScope` to override this per push.
 */
export const BLOCKING_SCOPES: ReadonlySet<ScopeId> = new Set<ScopeId>([
  'modal',
  'menu',
  'palette',
  'fullscreen',
  'drawer',
])

export interface ScopeOptions {
  /** Overrides whether this scope blocks what is beneath it (default: it does for `BLOCKING_SCOPES`). */
  blocking?: boolean
  /**
   * For the shell's own overlays (the navigation drawer, the More sheet). A page scope that is pushed
   * while a pinned scope is on the stack goes *beneath* it, not on top: a lazy page whose chunk arrives
   * after the sheet was opened would otherwise land above it, and its deeper `esc` (`tasks.escape`) would
   * win over the sheet's. Other overlays' scopes (`modal`, `menu`...) still stack on top as usual.
   */
  pinned?: boolean
}

interface ScopeEntry {
  id: ScopeId
  blocking: boolean
  pinned: boolean
}

export interface KeyEventLike extends KeyLike {
  defaultPrevented: boolean
  isComposing: boolean
  /** Auto-repeat of a held key. Never fires a handler or advances a sequence. */
  repeat?: boolean
  /** 229 marks a key that belongs to an IME (some browsers do not set `isComposing` on the first key). */
  keyCode?: number
  preventDefault(): void
}

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'AltGraph',
])

type Handler = (c: CommandCtx) => void

interface Compiled {
  def: ShortcutDef
  chords: Chord[]
}

interface Candidate extends Compiled {
  /** 0 = global; otherwise 1 + index in the scope stack. Deeper wins. */
  depth: number
}

/** Can a global shortcut still fire while `top` (the id of the topmost blocking scope) is open? */
function allowedUnder(def: ShortcutDef, top: ScopeId): boolean {
  const allow = def.allowInOverlays
  return Array.isArray(allow) ? allow.includes(top) : allow === true
}

/**
 * The shortcut engine: scope stack (top wins), `g`-style sequences, input suppression and
 * component-bound handlers. Plain TypeScript (no React) so it can be tested with fake events;
 * ShortcutProvider owns one instance and forwards window keydown events to it.
 *
 * Which shortcuts are live is decided in one place (`candidates`):
 * - A shortcut in a page scope (`tasks`, `today`...) needs that scope on the stack; the deepest wins.
 * - The topmost **blocking** scope (an overlay: modal, palette, drawer, full-screen) hides everything
 *   beneath it. Only shortcuts of that scope, of scopes pushed above it, and `global` shortcuts with
 *   `allowInOverlays` stay live. This is also how Esc resolves: the overlay's own `esc` (or the
 *   global `app.escape`) runs, and a page's `esc` (`tasks.escape`) only gets it once no overlay is open.
 */
export class ShortcutController {
  private compiled: Compiled[] = []
  private entries: readonly ScopeEntry[] = []
  private scopes: readonly ScopeId[] = []
  private readonly handlers = new Map<string, Handler[]>()
  private readonly listeners = new Set<() => void>()
  private pending: KeyLike[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private overlays: OverlayApi | null = null

  constructor(private readonly mac: boolean) {}

  setShortcuts(shortcuts: readonly ShortcutDef[]): void {
    this.compiled = shortcuts.map((def) => ({ def, chords: parseKeys(def.keys) }))
  }

  setOverlays(overlays: OverlayApi): void {
    this.overlays = overlays
  }

  // ── Scope stack (observable) ────────────────────────────────────────────────────────────────
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getScopes = (): readonly ScopeId[] => this.scopes

  pushScope = (scope: ScopeId, options: ScopeOptions = {}): (() => void) => {
    const entry: ScopeEntry = {
      id: scope,
      blocking: options.blocking ?? BLOCKING_SCOPES.has(scope),
      pinned: options.pinned === true,
    }
    // A page scope arriving under a pinned overlay belongs to the page beneath it, whenever it mounted.
    const under = entry.blocking || entry.pinned ? -1 : this.entries.findIndex((e) => e.pinned)
    this.setEntries(
      under === -1
        ? [...this.entries, entry]
        : [...this.entries.slice(0, under), entry, ...this.entries.slice(under)],
    )
    return () => {
      if (this.entries.includes(entry)) this.setEntries(this.entries.filter((e) => e !== entry))
    }
  }

  private setEntries(entries: readonly ScopeEntry[]): void {
    this.entries = entries
    this.scopes = entries.map((e) => e.id)
    this.notify()
  }

  private notify(): void {
    this.listeners.forEach((l) => l())
  }

  // ── Handlers ────────────────────────────────────────────────────────────────────────────────
  bindHandler = (id: string, fn: Handler): (() => void) => {
    this.handlers.set(id, [...(this.handlers.get(id) ?? []), fn])
    return () => {
      const rest = (this.handlers.get(id) ?? []).filter((h) => h !== fn)
      if (rest.length > 0) this.handlers.set(id, rest)
      else this.handlers.delete(id)
    }
  }

  /** Runs a shortcut's bound handler (or its `run`) by id, whether or not its keys were pressed. */
  invoke = (id: string): void => {
    const def = this.compiled.find((c) => c.def.id === id)?.def
    const fn = this.handlers.get(id)?.at(-1) ?? def?.run
    fn?.(this.makeCtx())
  }

  private makeCtx(): CommandCtx {
    const now = Date.now()
    if (!this.overlays) throw new Error('ShortcutController: overlays not set')
    return { now, today: dayOf(now), navigate, overlays: this.overlays, invoke: this.invoke }
  }

  private actionable(def: ShortcutDef): boolean {
    return def.run !== undefined || this.handlers.has(def.id)
  }

  /** Index of the topmost blocking scope (the overlay in front), or -1 when the page has the keyboard. */
  private topBlocking(): number {
    return this.entries.findLastIndex((e) => e.blocking)
  }

  private candidates(editable: boolean): Candidate[] {
    const overlay = this.topBlocking()
    const overlayId = this.entries[overlay]?.id
    const out: Candidate[] = []
    for (const c of this.compiled) {
      const { def } = c
      if (editable && !def.allowInInputs) continue
      let depth = 0
      if (def.scope !== 'global') {
        const at = this.entries.findLastIndex((e) => e.id === def.scope)
        // Not on the stack, or hidden beneath the overlay that is in front.
        if (at === -1 || at < overlay) continue
        depth = at + 1
      } else if (overlayId !== undefined && !allowedUnder(def, overlayId)) {
        continue
      }
      if (this.actionable(def)) out.push({ ...c, depth })
    }
    return out
  }

  private clearPending(): void {
    this.pending = []
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  dispose(): void {
    this.clearPending()
  }

  private static best(list: Candidate[]): Candidate | undefined {
    return list.reduce<Candidate | undefined>(
      (a, b) => (a === undefined || b.depth > a.depth ? b : a),
      undefined,
    )
  }

  private fire(def: ShortcutDef, e: KeyEventLike): void {
    const fn = this.handlers.get(def.id)?.at(-1) ?? def.run
    if (!fn) return
    e.preventDefault()
    fn(this.makeCtx())
  }

  /** Does this key continue the pending sequence, or start/complete a binding? Used to keep repeats from leaking to the browser. */
  private consumes(list: Candidate[], e: KeyEventLike): boolean {
    if (this.pending.length > 0 && this.matchSequence(list, e)) return true
    return list.some((c) => c.chords[0] !== undefined && matchChord(c.chords[0], e, this.mac))
  }

  private matchSequence(list: Candidate[], e: KeyLike): Candidate | undefined {
    const seq = [...this.pending, e]
    return ShortcutController.best(
      list.filter(
        (c) =>
          c.chords.length === seq.length &&
          c.chords.every((chord, i) => {
            const step = seq[i]
            return step !== undefined && matchChord(chord, step, this.mac)
          }),
      ),
    )
  }

  /** Feed one keydown. `editable` = focus is in a text field, so single keys must not fire. */
  handleKeyDown(e: KeyEventLike, editable: boolean): void {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return
    // Synthetic or autofill events can arrive without a string key.
    if (typeof e.key !== 'string' || MODIFIER_KEYS.has(e.key)) return
    const list = this.candidates(editable)

    if (e.repeat) {
      // Holding `g` must not become `g g`, and holding a shortcut must not run it again. Keep the
      // browser default suppressed for keys we own, and leave the sequence state alone.
      if (this.consumes(list, e)) e.preventDefault()
      return
    }

    if (this.pending.length > 0) {
      const hit = this.matchSequence(list, e)
      this.clearPending()
      if (hit) {
        this.fire(hit.def, e)
        return
      }
      // Not a continuation: treat this key as a fresh press.
    }

    const single = ShortcutController.best(
      list.filter(
        (c) => c.chords.length === 1 && c.chords[0] && matchChord(c.chords[0], e, this.mac),
      ),
    )
    if (single) {
      this.fire(single.def, e)
      return
    }

    const startsSequence = list.some(
      (c) => c.chords.length > 1 && c.chords[0] && matchChord(c.chords[0], e, this.mac),
    )
    if (startsSequence) {
      e.preventDefault()
      this.pending = [
        {
          key: e.key,
          ...(e.code !== undefined ? { code: e.code } : {}),
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
        },
      ]
      this.timer = setTimeout(() => this.clearPending(), SEQUENCE_TIMEOUT_MS)
    }
  }
}
