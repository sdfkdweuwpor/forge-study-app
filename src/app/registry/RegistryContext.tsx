import { createContext, useContext, type ReactNode } from 'react'
import type { Registry } from './registry'

const RegistryContext = createContext<Registry | null>(null)

export function RegistryProvider({
  registry,
  children,
}: {
  registry: Registry
  children: ReactNode
}) {
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
}

export function useRegistry(): Registry {
  const registry = useContext(RegistryContext)
  if (!registry) throw new Error('useRegistry must be used inside <RegistryProvider>')
  return registry
}
