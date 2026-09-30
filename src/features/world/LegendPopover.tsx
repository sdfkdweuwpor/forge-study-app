import { Info } from 'lucide-react'
import { Button, IconButton, Popover, PopoverBody } from '@/ui'
import { CONTROLS, LEGEND, STREAK_PERKS } from '@/logic/world'
import styles from './WorldPage.module.css'

/** What earns what, and what a streak adds. Says once that nothing is ever taken away. */
export function LegendPopover({ compact = false }: { compact?: boolean }) {
  return (
    <Popover
      label="What earns what"
      side="bottom"
      align="end"
      trigger={(p) =>
        compact ? (
          <IconButton label="Legend" icon={<Info />} {...p} />
        ) : (
          <Button variant="ghost" size="sm" iconLeft={<Info />} {...p}>
            Legend
          </Button>
        )
      }
    >
      <PopoverBody>
        <div className={styles.legend}>
          <h2 className={styles.legendTitle}>What earns what</h2>
          <dl className={styles.legendList}>
            {LEGEND.map((row) => (
              <div key={row.kind} className={styles.legendRow}>
                <dt>{row.name}</dt>
                <dd>{row.earns}</dd>
              </div>
            ))}
          </dl>
          <h2 className={styles.legendTitle}>A streak adds life</h2>
          <dl className={styles.legendList}>
            {STREAK_PERKS.map((row) => (
              <div key={row.days} className={styles.legendRow}>
                <dt>{row.days} days</dt>
                <dd>{row.perk}</dd>
              </div>
            ))}
          </dl>
          <h2 className={styles.legendTitle}>Moving around</h2>
          <dl className={styles.legendList}>
            {CONTROLS.map((row) => (
              <div key={row.how} className={styles.legendRow}>
                <dt>{row.how}</dt>
                <dd>{row.does}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.legendNote}>Nothing here ever goes away. A quiet day only lets the lights rest.</p>
        </div>
      </PopoverBody>
    </Popover>
  )
}
