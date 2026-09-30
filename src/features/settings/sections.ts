/**
 * The sections of the Settings page and their deep links (`/settings/<slug>`).
 *
 * Three sections are built in (they come first), the rest arrive through the `settings.sections` slot
 * in the order the slot gives, and Data closes the page. A contributed section is known by its slot
 * contribution id; the table below names the ones that exist, and anything else gets a slug and a title
 * made from its id, so a new feature never has to touch this file to appear (it only looks nicer here).
 */

export interface SectionMeta {
  /** The last URL segment, and the anchor (`#settings-<slug>`). */
  slug: string
  title: string
}

export const APPEARANCE: SectionMeta = { slug: 'appearance', title: 'Appearance' }
export const FOCUS: SectionMeta = { slug: 'focus', title: 'Focus' }
export const CALENDAR: SectionMeta = { slug: 'calendar', title: 'Calendar' }
export const BLOCKER: SectionMeta = { slug: 'blocker', title: 'Site blocker' }
export const DATA: SectionMeta = { slug: 'data', title: 'Data' }

/** Built in, before the contributed sections. */
export const LEADING_SECTIONS: readonly SectionMeta[] = [APPEARANCE, FOCUS, CALENDAR]

/** Contributed sections by slot contribution id. `everyday-hours` must match the tasks feature's deep link. */
const CONTRIBUTED: Readonly<Record<string, SectionMeta>> = {
  'tasks.everydayHours': { slug: 'everyday-hours', title: 'Everyday task hours' },
  'focus.sound': { slug: 'sound', title: 'Sound and notifications' },
  'settings.blocker': BLOCKER,
  'export.section': { slug: 'export', title: 'Export & calendar' },
  // Phase 11 (Safety) contributes its snapshot list under this id.
  'safety.snapshots': { slug: 'snapshots', title: 'Snapshots' },
}

const words = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()

export function contributedMeta(contributionId: string): SectionMeta {
  const known = CONTRIBUTED[contributionId]
  if (known) return known
  const slug = words(contributionId).toLowerCase().replace(/ /g, '-') || 'section'
  const last = words(contributionId.split('.').at(-1) ?? contributionId)
  return { slug, title: last.charAt(0).toUpperCase() + last.slice(1) }
}

/** The DOM id of a section, for anchors and scrolling. */
export const sectionDomId = (slug: string): string => `settings-${slug}`
