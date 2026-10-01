import { useState } from 'react'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Modal, ModalPanel, type ModalSize } from '@/ui/Modal'
import type { DemoSection } from '../types'
import styles from './Overlays.demo.module.css'

type Which = 'confirm' | 'form' | 'long' | 'sticky' | null

const UNITS: ReadonlyArray<readonly [string, string]> = [
  ['Unit 1 · Computer basics', 'Done'],
  ['Unit 2 · Hardware and software', 'Done'],
  ['Unit 3 · Networks and the internet', 'Done'],
  ['Unit 4 · Operating systems', 'In progress'],
  ['Unit 5 · Security', 'Not started'],
  ['Unit 6 · Databases', 'Not started'],
  ['Unit 7 · Programming basics', 'Not started'],
  ['Unit 8 · Data and information', 'Not started'],
  ['Unit 9 · Careers in IT', 'Not started'],
  ['Unit 10 · Ethics and law', 'Not started'],
  ['Unit 11 · Emerging technology', 'Not started'],
  ['Unit 12 · Exam review', 'Not started'],
]

function ModalDemo() {
  const [open, setOpen] = useState<Which>(null)
  const close = () => setOpen(null)

  return (
    <div className={styles.stack}>
      <div className={styles.block}>
        <span className={styles.caption}>
          Focus is trapped, the page behind does not scroll, and focus returns to the button
        </span>
        <div className={styles.row}>
          <Button onClick={() => setOpen('confirm')}>Small: confirm</Button>
          <Button onClick={() => setOpen('form')}>Medium: form</Button>
          <Button onClick={() => setOpen('long')}>Large: long content</Button>
          <Button variant="ghost" onClick={() => setOpen('sticky')}>
            Esc and scrim disabled
          </Button>
        </div>
        <span className={styles.note}>
          Below 640px a modal becomes a full-screen sheet; a short confirmation can ask for a bottom
          sheet instead (<code>phoneLayout=&quot;sheet&quot;</code>, used by “Small: confirm”).
        </span>
      </div>

      <Modal
        open={open === 'confirm'}
        onClose={close}
        size="sm"
        phoneLayout="sheet"
        title="Move “C779 Web Development Foundations” to trash?"
        description="Its 14 tasks and 3 notes go with it. You can restore it for 30 days."
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="danger" onClick={close} data-autofocus>
              Move to trash
            </Button>
          </>
        }
      >
        <span className={styles.note}>Completed XP stays in your history.</span>
      </Modal>

      <Modal
        open={open === 'form'}
        onClose={close}
        size="md"
        title="New goal"
        description="What are you working towards?"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={close}>
              Create goal
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <Input label="Name" defaultValue="Pass D278 Scripting and Programming" />
          <Input label="Target date" type="date" defaultValue="2026-11-20" />
        </div>
      </Modal>

      <Modal
        open={open === 'long'}
        onClose={close}
        size="lg"
        title="C182 · Introduction to IT"
        description="12 units. The body scrolls; the title and actions stay put."
        footer={
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        }
      >
        <div className={styles.list}>
          {UNITS.map(([unit, status]) => (
            <div key={unit} className={styles.listItem}>
              <span>{unit}</span>
              <span>{status}</span>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={open === 'sticky'}
        onClose={close}
        size="sm"
        closeOnEsc={false}
        closeOnScrim={false}
        showClose={false}
        title="Discard this session?"
        description="Esc and the scrim are off here. Choose one of the buttons."
        footer={
          <>
            <Button onClick={close} data-autofocus>
              Keep working
            </Button>
            <Button variant="danger" onClick={close}>
              Discard
            </Button>
          </>
        }
      >
        <span className={styles.note}>25 minutes of focus on D278 will not be saved.</span>
      </Modal>

      <div className={styles.block}>
        <span className={styles.caption}>Surface, by size</span>
        <div className={styles.specimens}>
          {(['sm', 'md'] as const satisfies readonly ModalSize[]).map((size) => (
            <ModalPanel
              key={size}
              inline
              size={size}
              title={size === 'sm' ? 'Delete goal?' : 'Rename course'}
              description={
                size === 'sm' ? 'This cannot be undone.' : 'Shown in the sidebar and on Today.'
              }
              onClose={close}
              footer={
                <>
                  <Button>Cancel</Button>
                  <Button variant={size === 'sm' ? 'danger' : 'primary'}>
                    {size === 'sm' ? 'Delete' : 'Save'}
                  </Button>
                </>
              }
            >
              {size === 'md' ? (
                <Input label="Course name" defaultValue="Introduction to IT" />
              ) : (
                <span className={styles.note}>7 tasks will be removed with it.</span>
              )}
            </ModalPanel>
          ))}
        </div>
      </div>
    </div>
  )
}

const section: DemoSection = {
  id: 'modal',
  title: 'Modal',
  group: 'Overlays',
  order: 30,
  description:
    'A dialog over a scrim: focus trap, scroll lock, aria-modal, labelled by its title. Sizes sm, md and lg; a full-screen sheet on phones.',
  render: () => <ModalDemo />,
}

export default section
