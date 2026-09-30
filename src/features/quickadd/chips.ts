import type { Priority, TagColor } from '@/db/types'
import type { QuickAddResult, QuickAddToken, QuickAddTokenKind } from '@/logic/quickAdd'
import { normalizeTag, tagColor } from '@/logic/tagColor'
import type { QuickAddCourse } from './queries'

export type ChipKind = Exclude<QuickAddTokenKind, 'literal'> | 'course'

export interface Chip {
  /** Stable while the token stays where it is (start offset), so a chip does not remount per keystroke. */
  key: string
  kind: ChipKind
  label: string
  color: TagColor
  /** Plain-language name for screen readers and tooltips: "Date", "Deadline", "Course". */
  name: string
}

const PRIORITY_COLORS: Record<Priority, TagColor> = {
  0: 'gray',
  1: 'gray',
  2: 'yellow',
  3: 'orange',
  4: 'red',
}

const KIND_NAMES: Record<ChipKind, string> = {
  date: 'Date',
  time: 'Time',
  deadline: 'Deadline',
  tag: 'Tag',
  priority: 'Priority',
  estimate: 'Estimate',
  recurrence: 'Repeats',
  course: 'Course',
}

/** The colour of a token's chip and of its highlight in the input. */
export function tokenColor(
  token: QuickAddToken,
  result: QuickAddResult,
  tagColors: Readonly<Record<string, TagColor>> | undefined,
): TagColor {
  switch (token.kind) {
    case 'date':
    case 'time':
      return 'blue'
    case 'deadline':
      return 'brown'
    case 'tag':
      return tagColor(token.text, tagColors)
    case 'priority':
      return PRIORITY_COLORS[result.priority ?? 0]
    case 'estimate':
      return 'purple'
    case 'recurrence':
      return 'green'
    case 'literal':
      return 'gray'
  }
}

/** The course a parsed `#code` links to, if any. */
export function courseFor(
  result: QuickAddResult,
  courses: readonly QuickAddCourse[],
): QuickAddCourse | undefined {
  if (result.courseCode === undefined) return undefined
  const wanted = normalizeTag(result.courseCode)
  return courses.find((c) => normalizeTag(c.code) === wanted)
}

/**
 * One chip per recognised piece, in the order typed, then a chip for the linked course. Quoted
 * literals are part of the title, so they get no chip.
 */
export function buildChips(
  result: QuickAddResult,
  course: QuickAddCourse | undefined,
  tagColors: Readonly<Record<string, TagColor>> | undefined,
): Chip[] {
  const chips: Chip[] = []
  for (const token of result.tokens) {
    if (token.kind === 'literal') continue
    chips.push({
      key: `${token.kind}:${token.start}`,
      kind: token.kind,
      label: token.label,
      color: tokenColor(token, result, tagColors),
      name: KIND_NAMES[token.kind],
    })
  }
  if (course) {
    chips.push({
      key: `course:${course.id}`,
      kind: 'course',
      label: course.title,
      color: tagColor(course.code, tagColors),
      name: KIND_NAMES.course,
    })
  }
  return chips
}

/** "Due date Tomorrow, Due time 2:00 PM, …" for a live region. Empty when there is nothing parsed. */
export function describeChips(chips: readonly Chip[]): string {
  return chips.map((c) => `${c.name} ${c.label}`).join(', ')
}
