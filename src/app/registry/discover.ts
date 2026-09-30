import { buildRegistry, validateManifests, type Registry } from './registry'
import { paletteManifest } from '../palette/manifest'
import { pwaManifest } from '../pwa/manifest'
import { builtins } from './builtins'
import type { FeatureManifest } from './types'

/** Auto-discovers every `src/features/<name>/feature.ts` (PLAN §1.5). Pages stay lazy: only manifests load eagerly. */
const modules = import.meta.glob<{ default: FeatureManifest }>('../../features/*/feature.ts', {
  eager: true,
})

/** [folder name, manifest] pairs, sorted by folder for a deterministic order. */
export const discovered: readonly (readonly [string, FeatureManifest])[] = Object.entries(modules)
  .map(([path, mod]) => [path.split('/').at(-2) ?? path, mod.default] as const)
  .sort(([a], [b]) => a.localeCompare(b))

export const manifests: readonly FeatureManifest[] = [
  builtins,
  paletteManifest,
  pwaManifest,
  ...discovered.map(([, m]) => m),
]

// Only the registry test reads this. The annotation lets a production build drop the check (and the validator
// with it) instead of running it, for nothing, at every start.
export const registryProblems: readonly string[] = /* @__PURE__ */ validateManifests(manifests)

export const registry: Registry = buildRegistry(manifests)
