import { useState } from 'react'
import { PopoverPanel } from '@/ui/Popover'
import { CoverPicker, EmojiGrid, PageHeader, type PageCover } from '@/ui/PageHeader'
import type { DemoSection } from '../types'
import styles from './Composites.demo.module.css'

/** A quiet desk-like image as an inline SVG, so the image cover works offline. */
const DESK_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300" preserveAspectRatio="xMidYMid slice">
      <rect width="1200" height="300" fill="#d9c9ad"/>
      <rect y="190" width="1200" height="110" fill="#b89f78"/>
      <rect x="120" y="70" width="230" height="150" rx="8" fill="#f2ebdd"/>
      <rect x="150" y="98" width="170" height="10" rx="5" fill="#c9b99b"/>
      <rect x="150" y="122" width="130" height="10" rx="5" fill="#c9b99b"/>
      <rect x="150" y="146" width="150" height="10" rx="5" fill="#c9b99b"/>
      <circle cx="820" cy="150" r="64" fill="#8d9c7f"/>
      <rect x="770" y="150" width="100" height="70" rx="10" fill="#6f7f63"/>
      <rect x="930" y="110" width="150" height="110" rx="8" fill="#e8dcc4"/>
    </svg>`,
  )

const META = (
  <>
    <span>34 courses</span>
    <span>12 completed</span>
    <span>Target: Dec 2027</span>
  </>
)

function Interactive() {
  const [title, setTitle] = useState('WGU B.S. Computer Science')
  const [icon, setIcon] = useState<string | null>('🎓')
  const [cover, setCover] = useState<PageCover | null>({ kind: 'gradient', preset: 'sage' })

  return (
    <div className={styles.block}>
      <span className={styles.caption}>Editable: click the title, icon or cover</span>
      <div className={styles.page}>
        <PageHeader
          title={title}
          onTitleChange={setTitle}
          icon={icon}
          onIconChange={setIcon}
          cover={cover}
          onCoverChange={setCover}
          onUploadCover={(file) => setCover({ kind: 'image', url: URL.createObjectURL(file) })}
          subtitle="Bachelor of Science, Computer Science"
          meta={META}
        />
      </div>
      <span className={styles.value}>
        Title: <strong>{title}</strong> · Icon: <strong>{icon ?? 'none'}</strong> · Cover:{' '}
        <strong>{cover ? (cover.kind === 'gradient' ? cover.preset : 'image') : 'none'}</strong>
      </span>
    </div>
  )
}

function Demo() {
  const [course, setCourse] = useState('C182 Introduction to IT')
  const [blankIcon, setBlankIcon] = useState<string | null>(null)
  const [blankCover, setBlankCover] = useState<PageCover | null>(null)
  const [blankTitle, setBlankTitle] = useState('')
  const [pickedEmoji, setPickedEmoji] = useState<string | null>('🧠')
  const [pickedCover, setPickedCover] = useState<PageCover | null>({
    kind: 'gradient',
    preset: 'dusk-orange',
  })

  return (
    <div className={styles.stack}>
      <Interactive />

      <div className={styles.block}>
        <span className={styles.caption}>
          New page: icon and cover controls (hover state forced)
        </span>
        <div className={styles.page}>
          <PageHeader
            title={blankTitle}
            onTitleChange={setBlankTitle}
            icon={blankIcon}
            onIconChange={setBlankIcon}
            cover={blankCover}
            onCoverChange={setBlankCover}
            data-force="hover"
          />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Read-only, gradient cover, meta row</span>
        <div className={styles.page}>
          <PageHeader
            title="D278 Scripting and Programming Foundations"
            icon="💻"
            cover={{ kind: 'gradient', preset: 'slate' }}
            subtitle="Course · 4 competency units"
            meta={
              <>
                <span>Due Nov 14</span>
                <span>3 of 8 lessons</span>
              </>
            }
          />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Image cover, no icon; cover controls forced on</span>
        <div className={styles.page}>
          <PageHeader
            title={course}
            onTitleChange={setCourse}
            cover={{ kind: 'image', url: DESK_IMAGE, posY: 40 }}
            onCoverChange={() => undefined}
            onIconChange={() => undefined}
            data-force="hover"
          />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Image that fails to load</span>
        <div className={styles.page}>
          <PageHeader
            title="C779 Web Development Foundations"
            icon="🌐"
            cover={{ kind: 'image', url: '/covers/missing-cover.jpg' }}
          />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Loading</span>
        <div className={styles.page}>
          <PageHeader title="" loading />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Icon picker and cover picker (open)</span>
        <div className={styles.row}>
          <PopoverPanel inline>
            <EmojiGrid
              current={pickedEmoji}
              onPick={setPickedEmoji}
              onRemove={() => setPickedEmoji(null)}
            />
          </PopoverPanel>
          <PopoverPanel inline>
            <CoverPicker
              cover={pickedCover}
              onPick={setPickedCover}
              onUpload={() => undefined}
              onRemove={() => setPickedCover(null)}
            />
          </PopoverPanel>
        </div>
        <span className={styles.value}>
          Icon: <strong>{pickedEmoji ?? 'none'}</strong> · Cover:{' '}
          <strong>
            {pickedCover?.kind === 'gradient' ? pickedCover.preset : (pickedCover?.kind ?? 'none')}
          </strong>
        </span>
      </div>
    </div>
  )
}

const section: DemoSection = {
  id: 'page-header',
  title: 'Page header',
  group: 'Composites',
  order: 40,
  description:
    'Notion-style page top: an optional cover (eight calm gradients or an image), a 64px emoji icon overlapping its edge, and a title you edit in place (Enter saves, Esc reverts). Controls show on hover and focus, always on touch.',
  render: () => <Demo />,
}

export default section
