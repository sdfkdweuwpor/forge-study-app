import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'
import { normalizeKeys, parseKeys } from '@/lib/keys'
import { ROUTES, type RouteName } from '../router/routes'
import type { SlotId } from './slots'
import type {
  CommandDef,
  DomainHandler,
  FeatureManifest,
  SearchProvider,
  ShortcutDef,
  SlotContribution,
} from './types'

export interface Registry {
  manifests: readonly FeatureManifest[]
  pages: ReadonlyMap<RouteName, LazyExoticComponent<ComponentType>>
  commands: readonly CommandDef[]
  shortcuts: readonly ShortcutDef[]
  search: readonly SearchProvider[]
  providers: readonly { order: number; component: ComponentType<{ children: ReactNode }> }[]
  domainHandlers: readonly DomainHandler[]
  slots(id: SlotId): readonly SlotContribution[]
}

/** Problems that make a manifest set invalid. The registry test fails on any of them. */
export function validateManifests(manifests: readonly FeatureManifest[]): string[] {
  const problems: string[] = []
  const featureIds = new Set<string>()
  const routeOwners = new Map<RouteName, string>()
  const commandIds = new Map<string, string>()
  const shortcutIds = new Map<string, string>()
  const bindings = new Map<string, string>() // `${scope}|${normalizedKeys}` → shortcut id
  const slotIds = new Map<string, string>() // `${slot}|${id}` → feature id

  for (const m of manifests) {
    if (featureIds.has(m.id)) problems.push(`Duplicate feature id "${m.id}"`)
    featureIds.add(m.id)

    for (const name of Object.keys(m.routes ?? {}) as RouteName[]) {
      if (!(name in ROUTES)) {
        problems.push(`${m.id}: unknown route "${name}"`)
        continue
      }
      const owner = routeOwners.get(name)
      if (owner !== undefined)
        problems.push(`Route "${name}" is registered by both ${owner} and ${m.id}`)
      else routeOwners.set(name, m.id)
    }

    for (const c of m.commands ?? []) {
      const prev = commandIds.get(c.id)
      if (prev !== undefined)
        problems.push(`Command "${c.id}" is defined by both ${prev} and ${m.id}`)
      else commandIds.set(c.id, m.id)
    }

    for (const s of m.shortcuts ?? []) {
      const prev = shortcutIds.get(s.id)
      if (prev !== undefined)
        problems.push(`Shortcut id "${s.id}" is defined by both ${prev} and ${m.id}`)
      else shortcutIds.set(s.id, m.id)

      const key = `${s.scope}|${normalizeKeys(s.keys)}`
      const clash = bindings.get(key)
      if (clash !== undefined) {
        problems.push(
          `Keys "${s.keys}" in scope "${s.scope}" are bound by both ${clash} and ${s.id}`,
        )
      } else bindings.set(key, s.id)
    }

    for (const sl of m.slots ?? []) {
      const key = `${sl.slot}|${sl.id}`
      const prev = slotIds.get(key)
      if (prev !== undefined)
        problems.push(
          `Slot contribution "${sl.id}" in ${sl.slot} is defined by both ${prev} and ${m.id}`,
        )
      else slotIds.set(key, m.id)
    }
  }

  // A key that is both a complete binding and the first step of a sequence is ambiguous within a scope.
  const all = manifests.flatMap((m) => m.shortcuts ?? [])
  for (const a of all) {
    const chordsA = parseKeys(a.keys)
    if (chordsA.length !== 1) continue
    for (const b of all) {
      if (a === b || a.scope !== b.scope) continue
      const chordsB = parseKeys(b.keys)
      if (
        chordsB.length > 1 &&
        normalizeKeys(a.keys) === normalizeKeys(b.keys.split(/\s+/)[0] ?? '')
      ) {
        problems.push(
          `Keys "${a.keys}" (${a.id}) are also the prefix of "${b.keys}" (${b.id}) in scope "${a.scope}"`,
        )
      }
    }
  }

  for (const m of manifests) {
    for (const c of m.commands ?? []) {
      if (c.shortcutId !== undefined && !shortcutIds.has(c.shortcutId)) {
        problems.push(`Command "${c.id}" points at unknown shortcut "${c.shortcutId}"`)
      }
    }
  }

  return problems
}

export function buildRegistry(manifests: readonly FeatureManifest[]): Registry {
  const pages = new Map<RouteName, LazyExoticComponent<ComponentType>>()
  for (const m of manifests) {
    for (const [name, page] of Object.entries(m.routes ?? {}) as [
      RouteName,
      LazyExoticComponent<ComponentType>,
    ][]) {
      if (!pages.has(name)) pages.set(name, page)
    }
  }
  const slotMap = new Map<SlotId, SlotContribution[]>()
  for (const m of manifests) {
    for (const c of m.slots ?? []) {
      const list = slotMap.get(c.slot) ?? []
      list.push(c)
      slotMap.set(c.slot, list)
    }
  }
  for (const list of slotMap.values()) list.sort((a, b) => a.order - b.order)

  return {
    manifests,
    pages,
    commands: manifests.flatMap((m) => m.commands ?? []),
    shortcuts: manifests.flatMap((m) => m.shortcuts ?? []),
    search: manifests.flatMap((m) => m.search ?? []),
    providers: manifests.flatMap((m) => m.providers ?? []).sort((a, b) => a.order - b.order),
    domainHandlers: manifests.flatMap((m) => m.domainHandlers ?? []),
    slots: (id) => slotMap.get(id) ?? [],
  }
}
