import { BOARD_COLUMNS } from '@/logic/boardColumns'
import { Skeleton } from '@/ui/Skeleton'
import styles from './Board.module.css'

const TITLE_WIDTHS = ['82%', '64%', '73%']

/** Placeholder columns while tasks load. */
export function BoardSkeleton() {
  return (
    <div className={styles.board} role="status" aria-busy="true" aria-label="Loading board">
      {BOARD_COLUMNS.map((column, c) => (
        <div key={column.id} className={styles.column}>
          <div className={styles.header}>
            <Skeleton width={56} />
          </div>
          <div className={styles.cards}>
            {Array.from({ length: c === 1 ? 1 : 3 }, (_, i) => (
              <div key={i} className={styles.skeletonCard}>
                <Skeleton width={TITLE_WIDTHS[(i + c) % TITLE_WIDTHS.length]} />
                <div className={styles.skeletonMeta}>
                  <Skeleton width={36} />
                  <Skeleton width={28} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
