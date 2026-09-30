import { Route } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureManifest } from '@/app/registry'
import { href, navigateToUrl } from '@/app/router'
import { cycleZoom } from './zoom'

const onRoadmap = (): boolean => window.location.pathname.replace(/\/$/, '') === '/roadmap'

/**
 * The Roadmap: one lane per active goal over the coming months. `g r` is Rewards, so "Go to Roadmap" is
 * `g m`. `z` cycles the zoom (3, 6, 12 months) while the page is open.
 */
const manifest: FeatureManifest = {
  id: 'roadmap',
  routes: { roadmap: lazy(() => import('./RoadmapPage')) },
  shortcuts: [
    {
      id: 'go.roadmap',
      keys: 'g m',
      description: 'Go to Roadmap',
      group: 'Navigation',
      scope: 'global',
      run: () => navigateToUrl(href('roadmap')),
    },
    {
      id: 'roadmap.cycleZoom',
      keys: 'z',
      description: 'Roadmap: cycle zoom (3, 6, 12 months)',
      group: 'Roadmap',
      scope: 'global',
      run: () => {
        if (onRoadmap()) cycleZoom()
      },
    },
  ],
  commands: [
    {
      id: 'command.go.roadmap',
      title: 'Go to Roadmap',
      group: 'Go to',
      icon: Route,
      keywords: ['open', 'navigate', 'roadmap', 'timeline', 'gantt', 'months', 'projected finish'],
      shortcutId: 'go.roadmap',
      run: () => navigateToUrl(href('roadmap')),
    },
    {
      id: 'command.roadmap.zoom',
      title: 'Roadmap: change zoom',
      group: 'View',
      icon: Route,
      keywords: ['3 months', '6 months', '12 months', 'timeline', 'zoom'],
      shortcutId: 'roadmap.cycleZoom',
      when: onRoadmap,
      run: () => cycleZoom(),
    },
  ],
}

export default manifest
