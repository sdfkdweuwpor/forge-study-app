import { lazy } from 'react'
import { Palette } from 'lucide-react'
import type { FeatureManifest } from '@/app/registry'

/**
 * The /design page: every `src/ui` component in every state, in both themes. The page and all demos
 * load lazily with the route, so none of it is in the main bundle.
 */
const manifest: FeatureManifest = {
  id: 'design',
  routes: { design: lazy(() => import('./DesignPage')) },
  commands: [
    {
      id: 'command.go.design',
      title: 'Go to Design system',
      group: 'Go to',
      icon: Palette,
      keywords: ['components', 'ui', 'tokens', 'theme', 'accent', 'kit'],
      run: (c) => c.navigate('design'),
    },
  ],
}

export default manifest
