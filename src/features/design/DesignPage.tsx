import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Columns2, ListTree, Moon, Palette, Sun } from 'lucide-react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useTheme } from '@/app/providers/ThemeProvider'
import type { AccentId } from '@/db/types'
import {
  activeSectionId,
  findDuplicateIds,
  groupSections,
  type SectionGroup,
} from '@/logic/sectionOrder'
import {
  Button,
  EmptyState,
  SegmentedControl,
  Toggle,
  useStickyScrollPadding,
  type SegmentOption,
} from '@/ui'
import type { DemoGroup, DemoSection } from './types'
import styles from './DesignPage.module.css'

// ── Sections ────────────────────────────────────────────────────────────────────────────────────

const GROUP_ORDER: readonly DemoGroup[] = ['Primitives', 'Overlays', 'Composites']

/** Every demo file, loaded with this page's chunk so none of it is in the main bundle. */
const modules = import.meta.glob<{ default?: unknown }>('./sections/*.demo.tsx', { eager: true })

function isDemoSection(value: unknown): value is DemoSection {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<Record<keyof DemoSection, unknown>>
  return (
    typeof v.id === 'string' &&
    v.id !== '' &&
    typeof v.title === 'string' &&
    typeof v.order === 'number' &&
    typeof v.render === 'function' &&
    GROUP_ORDER.some((g) => g === v.group)
  )
}

function loadSections(): { groups: SectionGroup<DemoSection>[]; problems: string[] } {
  const found: DemoSection[] = []
  const problems: string[] = []
  for (const [path, mod] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    if (isDemoSection(mod.default)) found.push(mod.default)
    else problems.push(`${path.replace('./sections/', '')} does not default-export a DemoSection.`)
  }
  const duplicates = findDuplicateIds(found)
  for (const id of duplicates) problems.push(`The section id “${id}” is used more than once.`)
  const seen = new Set<string>()
  const unique = found.filter((s) => {
    if (seen.has(s.id)) return false
    seen.add(s.id)
    return true
  })
  return { groups: groupSections(unique, GROUP_ORDER), problems }
}

const { groups: GROUPS, problems: PROBLEMS } = loadSections()
const SECTION_IDS: readonly string[] = GROUPS.flatMap((g) => g.sections.map((s) => s.id))
const SECTION_COUNT = SECTION_IDS.length

// ── Preview settings ────────────────────────────────────────────────────────────────────────────

type Scheme = 'light' | 'dark'
type SchemeView = 'both' | Scheme

const VIEW_OPTIONS: readonly SegmentOption<SchemeView>[] = [
  { value: 'both', label: 'Both', icon: <Columns2 size={14} aria-hidden="true" /> },
  { value: 'light', label: 'Light', icon: <Sun size={14} aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={14} aria-hidden="true" /> },
]

const ACCENTS: readonly { id: AccentId; label: string }[] = [
  { id: 'blue', label: 'Blue' },
  { id: 'teal', label: 'Teal' },
  { id: 'green', label: 'Green' },
  { id: 'orange', label: 'Orange' },
  { id: 'pink', label: 'Pink' },
  { id: 'graphite', label: 'Graphite' },
]

/** A section counts as “current” once its top is within this many px of the viewport top. */
const SPY_OFFSET = 96

function AccentPicker({
  value,
  onChange,
  scheme,
}: {
  value: AccentId
  onChange: (accent: AccentId) => void
  scheme: Scheme
}) {
  const labelId = useId()
  return (
    <div className={styles.control}>
      <span id={labelId} className={styles.controlLabel}>
        Accent
      </span>
      <div className={styles.accents} role="radiogroup" aria-labelledby={labelId}>
        {ACCENTS.map((a) => (
          <label key={a.id} className={styles.swatch} title={a.label}>
            <input
              type="radio"
              name="design-accent"
              className={`${styles.swatchInput} sr-only`}
              value={a.id}
              checked={value === a.id}
              onChange={() => onChange(a.id)}
            />
            <span className={styles.swatchRing}>
              {/* Themed on its own, so the dot shows the real accent token without a hex value here. */}
              <span
                className={styles.swatchDot}
                data-theme={scheme}
                data-accent={a.id}
                aria-hidden="true"
              />
            </span>
            <span className="sr-only">{a.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Table of contents ───────────────────────────────────────────────────────────────────────────

/** Tracks which section is being read as the page scrolls. */
function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0])
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const tops = ids.flatMap((id) => {
        const el = document.getElementById(id)
        return el ? [{ id, top: el.getBoundingClientRect().top }] : []
      })
      setActive(activeSectionId(tops, SPY_OFFSET))
    }
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [ids])
  return active
}

/**
 * Component links by group. A sticky rail from 1440px up; below that a sticky “Jump to” bar that
 * opens the same list as a panel (one line tall, so it never eats the small screens it is for).
 */
function TableOfContents({
  groups,
  activeId,
}: {
  groups: readonly SectionGroup<DemoSection>[]
  activeId: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  useStickyScrollPadding(navRef)
  const listId = useId()
  const activeTitle = groups.flatMap((g) => g.sections).find((s) => s.id === activeId)?.title

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !navRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <nav ref={navRef} className={styles.toc} aria-label="Components" data-open={open || undefined}>
      <button
        type="button"
        className={styles.tocToggle}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <ListTree size={16} aria-hidden="true" />
        <span className={styles.tocToggleLabel}>Jump to</span>
        <span className={styles.tocCurrent}>{activeTitle}</span>
        <ChevronDown className={styles.tocChevron} size={16} aria-hidden="true" />
      </button>
      <ul id={listId} className={styles.tocList}>
        {groups.map((g) => (
          <li key={g.group} className={styles.tocGroup}>
            <span className={styles.tocGroupName}>{g.group}</span>
            <ul className={styles.tocLinks}>
              {g.sections.map((s) => (
                <li key={s.id}>
                  <a
                    className={styles.tocLink}
                    href={`#${s.id}`}
                    aria-current={s.id === activeId ? 'location' : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ── Sections ────────────────────────────────────────────────────────────────────────────────────

/** Calls `render()` inside a component, so a demo may use hooks directly as well as return components. */
function DemoHost({ section }: { section: DemoSection }) {
  return <>{section.render()}</>
}

function DemoFailure({
  title,
  error,
  onRetry,
}: {
  title: string
  error: Error
  onRetry: () => void
}) {
  return (
    <div className={styles.failure} role="alert">
      <p className={styles.failureTitle}>The {title} demo could not render.</p>
      <p className={styles.failureDetail}>{error.message}</p>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

interface ColumnProps {
  scheme: Scheme
  accent: AccentId
  reducedMotion: boolean
  children: ReactNode
}

/** One themed surface. Tokens resolve per element, so both schemes render side by side. */
function SchemeColumn({ scheme, accent, reducedMotion, children }: ColumnProps) {
  return (
    <div
      className={styles.column}
      data-column={scheme}
      data-theme={scheme}
      data-accent={accent}
      data-reduced-motion={reducedMotion ? 'on' : 'off'}
      role="group"
      aria-label={`${scheme === 'light' ? 'Light' : 'Dark'} theme`}
    >
      <span className={styles.columnLabel}>
        {scheme === 'light' ? (
          <Sun size={14} aria-hidden="true" />
        ) : (
          <Moon size={14} aria-hidden="true" />
        )}
        {scheme === 'light' ? 'Light' : 'Dark'}
      </span>
      {children}
    </div>
  )
}

interface SectionViewProps {
  section: DemoSection
  schemes: readonly Scheme[]
  view: SchemeView
  accent: AccentId
  reducedMotion: boolean
}

function SectionView({ section, schemes, view, accent, reducedMotion }: SectionViewProps) {
  const titleId = `${section.id}-title`
  return (
    <section id={section.id} className={styles.section} aria-labelledby={titleId}>
      <header className={styles.sectionHeader}>
        <h3 id={titleId} className={styles.sectionTitle}>
          {section.title}
        </h3>
        {section.description ? <p className={styles.sectionDesc}>{section.description}</p> : null}
      </header>
      <div className={styles.pair} data-view={view}>
        {schemes.map((scheme) => (
          <SchemeColumn key={scheme} scheme={scheme} accent={accent} reducedMotion={reducedMotion}>
            <ErrorBoundary
              fallback={(error, reset) => (
                <DemoFailure title={section.title} error={error} onRetry={reset} />
              )}
            >
              <DemoHost section={section} />
            </ErrorBoundary>
          </SchemeColumn>
        ))}
      </div>
    </section>
  )
}

/** Scrolls to the section named in the URL hash: the browser cannot, because the page loads lazily. */
function useScrollToHash(): void {
  useEffect(() => {
    let id = window.location.hash.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch {
      return
    }
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])
}

// ── Page ────────────────────────────────────────────────────────────────────────────────────────

/** Every component in every state, in light and dark side by side (BRIEF §3.6). */
export default function DesignPage() {
  const app = useTheme()
  const [view, setView] = useState<SchemeView>('both')
  const [accent, setAccent] = useState<AccentId>(app.accent)
  const [previewReduced, setPreviewReduced] = useState(false)
  const activeId = useActiveSection(SECTION_IDS)
  const toolbarRef = useRef<HTMLDivElement>(null)
  // The toolbar sticks to the top from 1440px up: Tab must not scroll a control in underneath it.
  useStickyScrollPadding(toolbarRef)
  useScrollToHash()

  // The device or Settings asking for reduced motion cannot be undone from a sub-tree of the page.
  const reducedMotion = app.reducedMotion || previewReduced
  const schemes: readonly Scheme[] = view === 'both' ? ['light', 'dark'] : [view]

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.title}>Design system</h1>
        <p className={styles.lede}>
          Every component in every state, in light and dark. Hover, active and focus are forced so
          they can be compared at rest. {SECTION_COUNT} components.
        </p>
      </header>

      <div ref={toolbarRef} className={styles.toolbar} role="group" aria-label="Preview settings">
        <div className={styles.control}>
          <span className={styles.controlLabel} aria-hidden="true">
            Theme
          </span>
          <SegmentedControl
            label="Theme"
            options={VIEW_OPTIONS}
            value={view}
            onValueChange={setView}
          />
        </div>
        <div className={styles.control}>
          <Toggle
            label="Reduce motion"
            checked={reducedMotion}
            disabled={app.reducedMotion}
            onCheckedChange={setPreviewReduced}
            aria-describedby={app.reducedMotion ? 'design-motion-note' : undefined}
          />
          {app.reducedMotion ? (
            <span id="design-motion-note" className={styles.controlNote}>
              Already on in Settings or on this device
            </span>
          ) : null}
        </div>
        <AccentPicker value={accent} onChange={setAccent} scheme={app.resolvedTheme} />
      </div>

      {PROBLEMS.length > 0 ? (
        <div className={styles.problems} role="alert">
          <p className={styles.problemsTitle}>Some demos were skipped.</p>
          <ul>
            {PROBLEMS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {GROUPS.length === 0 ? (
        <EmptyState
          icon={<Palette />}
          title="No components documented yet"
          description="Add a <Component>.demo.tsx file to src/features/design/sections and it appears here."
        />
      ) : (
        <div className={styles.layout}>
          <TableOfContents groups={GROUPS} activeId={activeId} />
          <div className={styles.groups}>
            {GROUPS.map((g) => (
              <section
                key={g.group}
                className={styles.group}
                aria-labelledby={`group-${g.group}`}
                data-group={g.group}
              >
                <h2 id={`group-${g.group}`} className={styles.groupTitle}>
                  {g.group}
                </h2>
                <div className={styles.sectionList}>
                  {g.sections.map((s) => (
                    <SectionView
                      key={s.id}
                      section={s}
                      schemes={schemes}
                      view={view}
                      accent={accent}
                      reducedMotion={reducedMotion}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
