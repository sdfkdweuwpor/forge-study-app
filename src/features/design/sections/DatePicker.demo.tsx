import { useState } from 'react'
import { DatePicker } from '@/ui/DatePicker'
import type { DemoSection } from '../types'
import styles from './Composites.demo.module.css'

// A fixed "today" (a Tuesday) keeps the quick-pick chips stable across screenshots.
const TODAY = '2026-09-29'

function Demo() {
  const [due, setDue] = useState<string | null>('2026-10-02')
  const [start, setStart] = useState<string | null>(null)
  const [startTime, setStartTime] = useState<string | null>(null)
  const [review, setReview] = useState<string | null>('2026-10-15')
  const [reviewTime, setReviewTime] = useState<string | null>('14:00')

  return (
    <div className={styles.stack}>
      <div className={styles.block}>
        <span className={styles.caption}>Date with quick picks</span>
        <DatePicker label="Due date" value={due} onChange={setDue} quickPicks today={TODAY} />
        <span className={styles.value}>
          Value: <strong>{due ?? 'none'}</strong>
        </span>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Date and time, empty</span>
        <DatePicker
          label="Start"
          value={start}
          onChange={setStart}
          withTime
          time={startTime}
          onTimeChange={setStartTime}
          quickPicks={['today', 'tomorrow']}
          today={TODAY}
        />
        <span className={styles.value}>
          Value:{' '}
          <strong>
            {start ?? 'none'} {startTime ?? ''}
          </strong>
        </span>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Date and time, filled</span>
        <DatePicker
          label="Review"
          value={review}
          onChange={setReview}
          withTime
          time={reviewTime}
          onTimeChange={setReviewTime}
          today={TODAY}
        />
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>States</span>
        <div className={styles.row}>
          <div className={styles.cell}>
            <span className={styles.note}>Hover</span>
            <DatePicker
              label="Hover"
              value="2026-10-02"
              onChange={() => undefined}
              data-force="hover"
            />
          </div>
          <div className={styles.cell}>
            <span className={styles.note}>Focus</span>
            <DatePicker
              label="Focus"
              value="2026-10-02"
              onChange={() => undefined}
              data-force="focus"
            />
          </div>
          <div className={styles.cell}>
            <span className={styles.note}>Disabled</span>
            <DatePicker
              label="Disabled"
              value="2026-10-02"
              onChange={() => undefined}
              quickPicks
              today={TODAY}
              disabled
            />
          </div>
          <div className={styles.cell}>
            <span className={styles.note}>Error</span>
            <DatePicker
              label="Exam date"
              value="2026-09-01"
              onChange={() => undefined}
              max="2026-08-31"
              error="Pick a day before Aug 31"
            />
          </div>
          <div className={styles.cell}>
            <span className={styles.note}>Small</span>
            <DatePicker label="Small" value={null} onChange={() => undefined} size="sm" />
          </div>
        </div>
      </div>
    </div>
  )
}

const section: DemoSection = {
  id: 'date-picker',
  title: 'Date picker',
  group: 'Composites',
  order: 10,
  description:
    'Native date and time inputs styled like Input, with a clear button and optional Today / Tomorrow / Next week chips. Values are YYYY-MM-DD and HH:mm.',
  render: () => <Demo />,
}

export default section
