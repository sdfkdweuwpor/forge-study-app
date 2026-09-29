import { matchChord, parseKeys, type Chord, type KeyLike } from '@/lib/keys'
import { dayOf } from '@/logic/dates'
import type { CommandCtx, OverlayApi, ScopeId, ShortcutDef } from '../registry/types'
import { navigate } from '../router/router'

/** Sequences like `g t` must finish within this window (PLAN §5.2). */
export const SEQUENCE_TIMEOUT_MS = 1000

/** Overlay scopes suppress global shortcuts (except those allowed in inputs, like `esc` and `mod+\`). */
const OVERLAY_SCOPES: readonly ScopeId[] = ['modal', 'palette']

export interface KeyEventLike extends KeyLike {
  defaultPrevented: boolean
  isComposing: boolean
  preventDefault(): void
}

type Handler = (c: CommandCtx) => void

interface Compiled {
  def: ShortcutDef
  chords: Chord[]
}

interface Candidate extends Compiled {
  /** 0 = global; otherwise 1 + index in the scope stack. Deeper wins. */
  depth: number
}

/**
 * The shortcut engine: scope stack (top wins), `g`-style sequences, input suppression and
 * component-bound handlers. Plain TypeScript (no React) so it can be tested with fake events;
 * ShortcutProvider owns one instance and forwards window keydown events to it.
 */
export class ShortcutController {
  private compiled: Compiled[] = []
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

  pushScope = (scope: ScopeId): (() => void) => {
    this.scopes = [...this.scopes, scope]
    this.notify()
    return () => {
      const i = this.scopes.lastIndexOf(scope)
      if (i === -1) return
      this.scopes = this.scopes.filter((_, idx) => idx !== i)
      this.notify()
    }
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

  private candidates(editable: boolean): Candidate[] {
    const top = this.scopes.at(-1)
    const overlayOpen = top !== undefined && OVERLAY_SCOPES.includes(top)
    const out: Candidate[] = []
    for (const c of this.compiled) {
      const { def } = c
      if (editable && !def.allowInInputs) continue
      let depth = 0
      if (def.scope !== 'global') {
        depth = this.scopes.lastIndexOf(def.scope) + 1
        if (depth === 0) continue
      } else if (overlayOpen && !def.allowInInputs) {
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

  /** Feed one keydown. `editable` = focus is in a text field, so single keys must not fire. */
  handleKeyDown(e: KeyEventLike, editable: boolean): void {
    if (e.defaultPrevented || e.isComposing) return
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph'].includes(e.key)) return
    const list = this.candidates(editable)

    if (this.pending.length > 0) {
      const seq = [...this.pending, e]
      const hit = ShortcutController.best(
        list.filter(
          (c) =>
            c.chords.length === seq.length &&
            c.chords.every((chord, i) => {
              const step = seq[i]
              return step !== undefined && matchChord(chord, step, this.mac)
            }),
        ),
      )
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
