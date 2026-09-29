import { Skeleton } from '@/ui/Skeleton'
import type { DemoSection } from '../types'
import { Block, Stack, demo } from './Primitives.kit'
import styles from './Skeleton.demo.module.css'

function SkeletonDemo() {
  return (
    <Stack>
      <Block caption="A Today list while it loads (the region carries aria-busy, the bones are hidden)">
        <div className={demo.stage} aria-busy="true" aria-label="Loading tasks">
          {[0.7, 0.45, 0.6].map((w, i) => (
            <div key={i} className={styles.row}>
              <Skeleton variant="circle" width={18} />
              <Skeleton width={`${w * 100}%`} />
              <Skeleton variant="block" width={44} height={18} className={styles.tag} />
            </div>
          ))}
        </div>
      </Block>

      <Block caption="Variants: text (lines sit on the line height), block, circle">
        <div className={demo.split}>
          <div className={styles.text}>
            <Skeleton lines={3} />
          </div>
          <Skeleton variant="block" height={96} />
          <div className={styles.profile}>
            <Skeleton variant="circle" width={40} />
            <div className={styles.grow}>
              <Skeleton width="60%" />
              <Skeleton width="40%" />
            </div>
          </div>
        </div>
      </Block>
    </Stack>
  )
}

const section: DemoSection = {
  id: 'skeleton',
  title: 'Skeleton',
  group: 'Primitives',
  order: 140,
  description: 'Loading placeholders shaped like the content. The shimmer becomes a pulse with reduced motion.',
  render: () => <SkeletonDemo />,
}

export default section
