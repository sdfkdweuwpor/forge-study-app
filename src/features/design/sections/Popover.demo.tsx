import { CalendarDays } from 'lucide-react'
import { Button } from '@/ui/Button'
import { Popover, PopoverBody, PopoverPanel } from '@/ui/Popover'
import type { DemoSection } from '../types'
import styles from './Overlays.demo.module.css'

function CourseCard() {
  return (
    <PopoverBody>
      <div className={styles.courseTitle}>C182 · Introduction to IT</div>
      <div className={styles.courseMeta}>Objective assessment · due Oct 14</div>
      <div className={styles.list}>
        <div className={styles.listItem}>
          <span>Units done</span>
          <span>5 of 8</span>
        </div>
        <div className={styles.listItem}>
          <span>Study time this week</span>
          <span>3h 40m</span>
        </div>
      </div>
    </PopoverBody>
  )
}

function PopoverDemo() {
  return (
    <div className={styles.stack}>
      <div className={styles.block}>
        <span className={styles.caption}>Sides (flips when there is no room)</span>
        <div className={styles.row}>
          {(['bottom', 'top', 'right', 'left'] as const).map((side) => (
            <Popover
              key={side}
              side={side}
              label={`Popover on the ${side}`}
              trigger={(p) => (
                <Button {...p} size="sm">
                  {side[0]?.toUpperCase()}
                  {side.slice(1)}
                </Button>
              )}
            >
              <PopoverBody>
                <div className={styles.courseTitle}>Opens {side}</div>
                <div className={styles.courseMeta}>Esc or a click outside closes it.</div>
              </PopoverBody>
            </Popover>
          ))}
          <Popover
            align="end"
            label="Popover aligned to the end"
            trigger={(p) => (
              <Button {...p} size="sm">
                Align end
              </Button>
            )}
          >
            <PopoverBody>
              <div className={styles.courseTitle}>Aligned to the end</div>
              <div className={styles.courseMeta}>Shifts back inside the window near an edge.</div>
            </PopoverBody>
          </Popover>
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>With content and a close action</span>
        <div className={styles.row}>
          <Popover
            label="Course details"
            trigger={(p) => (
              <Button {...p} iconLeft={<CalendarDays />}>
                C182 details
              </Button>
            )}
          >
            {({ close }) => (
              <PopoverBody>
                <CourseCard />
                <Button variant="primary" size="sm" onClick={close} data-autofocus>
                  Open course
                </Button>
              </PopoverBody>
            )}
          </Popover>
          <Popover
            defaultOpen={false}
            trigger={(p) => (
              <Button {...p} variant="ghost">
                No role (plain hint)
              </Button>
            )}
          >
            <span>Without a label the panel has no dialog role.</span>
          </Popover>
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Surface</span>
        <div className={styles.specimens}>
          <PopoverPanel inline>
            <CourseCard />
          </PopoverPanel>
        </div>
      </div>
    </div>
  )
}

const section: DemoSection = {
  id: 'popover',
  title: 'Popover',
  group: 'Overlays',
  order: 10,
  description:
    'A panel anchored to a trigger: portaled, flips and shifts to stay on screen, closes on Esc or an outside click, and returns focus to the trigger.',
  render: () => <PopoverDemo />,
}

export default section
