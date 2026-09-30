import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { DomainHandler } from '@/db/events'
import type { ISODate } from '@/db/types'
import type { navigate } from '../router/router'
import type { RouteName } from '../router/routes'
import type { SlotId, SlotProps } from './slots'

/** Overlay kinds owned by OverlayProvider. Their UI is rendered by features via the `global.overlays` slot. */
export type OverlayKind = 'palette' | 'quickAdd' | 'shortcuts' | 'focusFullscreen'

export interface OverlayApi {
  open(kind: OverlayKind): void
  close(kind: OverlayKind): void
  toggle(kind: OverlayKind): void
  isOpen(kind: OverlayKind): boolean
}

export type ScopeId =
  | 'today'
  | 'tasks'
  | 'calendar'
  | 'focus'
  | 'fullscreen'
  | 'goal'
  | 'course'
  | 'review'
  | 'cards'
  | 'rewards'
  | 'progress'
  | 'blocker'
  | 'modal'
  | 'menu'
  | 'palette'
  | 'drawer'

export type CommandGroup =
  'Go to' | 'Create' | 'Focus' | 'Goals' | 'View' | 'Review' | 'Data' | 'Help'

/** What a command or shortcut handler may use. Built fresh per invocation. */
export interface CommandCtx {
  now: number
  today: ISODate
  navigate: typeof navigate
  overlays: OverlayApi
  /** Run a shortcut's bound handler by id (e.g. 'app.toggleSidebar'); no-op if nothing is bound. */
  invoke(shortcutId: string): void
}

export interface CommandDef {
  id: string
  title: string
  group: CommandGroup
  icon?: LucideIcon
  keywords?: string[]
  /** Shows this shortcut's keys next to the command. */
  shortcutId?: string
  when?: (c: CommandCtx) => boolean
  run: (c: CommandCtx) => void | Promise<void>
}

export interface ShortcutDef {
  id: string
  /** 'mod+k' | 'q' | 'g t' | 'shift+s' | '?' */
  keys: string
  description: string
  /** Heading in the "?" sheet. */
  group: string
  scope: 'global' | ScopeId
  allowInInputs?: boolean
  /**
   * `global` shortcuts only. Overlay scopes (`modal`, `palette`, `fullscreen`, `drawer`) are blocking:
   * while one is open, global keys go quiet. `true` keeps this one live under any overlay (`esc`,
   * `mod+k`); a list keeps it live only while the top overlay is one of those scopes.
   */
  allowInOverlays?: boolean | readonly ScopeId[]
  /** Direct action. Omit when a component binds the behaviour with `useShortcutHandler(id, fn)`. */
  run?: (c: CommandCtx) => void
}

export interface SearchResult {
  id: string
  title: string
  subtitle?: string
  icon?: LucideIcon
  run: (c: CommandCtx) => void
}

export interface SearchProvider {
  id: string
  group: string
  search(q: string, limit: number): Promise<SearchResult[]>
}

/** Distributive, so `SlotContribution` is a union discriminated by `slot` and each component gets its slot's props. */
export type SlotContribution<S extends SlotId = SlotId> = S extends SlotId
  ? {
      slot: S
      /** Unique within the slot. */
      id: string
      /** Ascending; ties keep manifest order. */
      order: number
      component: ComponentType<SlotProps[S]>
    }
  : never

export type { DomainHandler }

export interface FeatureManifest {
  /** Equals the folder name under src/features. */
  id: string
  routes?: Partial<Record<RouteName, LazyExoticComponent<ComponentType>>>
  commands?: CommandDef[]
  shortcuts?: ShortcutDef[]
  search?: SearchProvider[]
  slots?: SlotContribution[]
  providers?: { order: number; component: ComponentType<{ children: ReactNode }> }[]
  domainHandlers?: DomainHandler[]
  /** Runs on load and again at each local midnight. */
  onAppStart?: (ctx: { now: number; today: ISODate }) => Promise<void>
}
