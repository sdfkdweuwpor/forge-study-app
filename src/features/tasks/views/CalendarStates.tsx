import type { CSSProperties } from 'react'
import { Skeleton } from '@/ui/Skeleton'
import styles from './Calendar.module.css'

const BLOCKS: ReadonlyArray<ReadonlyArray<string>> = [
  ['72%', '58%'],
  ['64%'],
  ['80%', '52%', '66%'],
  ['60%'],
  ['70%', '48%'],
  ['56%'],
  ['62%'],
]

/** A week's worth of placeholder columns while tasks load. */
export function CalendarSkeleton({ days = 7 }: { days?: number }) {
  return (
    <section
      className={styles.root}
      aria-label="Calendar"
      style={{ '--days': days } as unknown as CSSProperties}
    >
      <div className={styles.toolbar}>
        <Skeleton width={120} />
      </div>
      <div
        className={styles.skeletonDays}
        role="status"
        aria-busy="true"
        aria-label="Loading calendar"
        style={{ '--days': days } as unknown as CSSProperties}
      >
        <span />
        {Array.from({ length: days }, (_, d) => (
          <div key={d} className={styles.skeletonCol}>
            <Skeleton width={28} />
            {(BLOCKS[d % BLOCKS.length] ?? []).map((width, i) => (
              <Skeleton key={i} variant="block" width={width} height={22} />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
