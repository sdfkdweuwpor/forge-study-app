/**
 * Ordering and scroll-spy helpers for the /design page. Generic on purpose: this layer cannot import
 * the feature's own `DemoSection` type, so it asks only for the four fields it sorts and groups by.
 */

export interface OrderableSection {
  id: string
  title: string
  group: string
  order: number
}

export interface SectionGroup<T> {
  group: string
  sections: T[]
}

function groupRank(group: string, groups: readonly string[]): number {
  const index = groups.indexOf(group)
  return index === -1 ? groups.length : index
}

/**
 * Sorts by group (in the order of `groups`; unknown groups last, alphabetically), then by `order`,
 * then by title and id so the result never depends on the order the files were discovered in.
 */
export function orderSections<T extends OrderableSection>(
  sections: readonly T[],
  groups: readonly string[],
): T[] {
  return [...sections].sort(
    (a, b) =>
      groupRank(a.group, groups) - groupRank(b.group, groups) ||
      a.group.localeCompare(b.group) ||
      a.order - b.order ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  )
}

/** Ordered sections split into their groups. A group with no sections is left out. */
export function groupSections<T extends OrderableSection>(
  sections: readonly T[],
  groups: readonly string[],
): SectionGroup<T>[] {
  const result: SectionGroup<T>[] = []
  for (const section of orderSections(sections, groups)) {
    const last = result.at(-1)
    if (last && last.group === section.group) last.sections.push(section)
    else result.push({ group: section.group, sections: [section] })
  }
  return result
}

/** Ids used by more than one section (each listed once), because anchors and React keys must be unique. */
export function findDuplicateIds(sections: readonly { id: string }[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const { id } of sections) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}

/**
 * The section being read: the last one whose top edge has reached `offset` px from the top of the
 * viewport, or the first one before any has. `tops` must be in page order.
 */
export function activeSectionId(
  tops: readonly { id: string; top: number }[],
  offset: number,
): string | undefined {
  let active = tops[0]?.id
  for (const { id, top } of tops) {
    if (top <= offset) active = id
    else break
  }
  return active
}
