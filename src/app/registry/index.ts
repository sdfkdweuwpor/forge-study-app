/** Public API of the plug-in shell for features. Features never import the discovery module. */
export type {
  CommandCtx,
  CommandDef,
  CommandGroup,
  DomainHandler,
  FeatureManifest,
  OverlayApi,
  OverlayKind,
  ScopeId,
  SearchProvider,
  SearchResult,
  ShortcutDef,
  SlotContribution,
} from './types'
export type { SlotId, SlotProps } from './slots'
export type { Registry } from './registry'
export { Slot, useSlotCount } from './Slot'
export { useRegistry } from './RegistryContext'
