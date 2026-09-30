/**
 * The prompt the user copies into Claude together with their course outline (BRIEF §5.4, §9: copy and
 * paste only, no API). The field list is generated from the schema, so the prompt cannot describe a
 * format the validator does not accept.
 */
import type { ISODate } from '@/db/types'
import { EXAMPLE_JSON } from './example'
import { CROSS_FIELD_RULES, fieldDocs, type FieldDoc } from './reference'
import { PLAN_VERSION } from './schema'

export const OUTLINE_PLACEHOLDER = 'PASTE YOUR COURSE OUTLINE / DEGREE PLAN HERE'

const REQUIREMENT_TEXT: Record<FieldDoc['required'], string> = {
  required: 'required',
  optional: 'optional',
  'with-parent': 'required when its parent is given',
}

/** One line per field: `  - courses[].code (text, required): Course code, …`. */
export function fieldLines(): string[] {
  return fieldDocs().map(
    (d) =>
      `${'  '.repeat(d.depth)}- ${d.path} (${d.type}, ${REQUIREMENT_TEXT[d.required]}): ${d.description}`,
  )
}

export interface PromptOptions {
  /** Today's date, so Claude picks sensible future term and target dates. */
  today?: ISODate
}

export function buildPrompt({ today }: PromptOptions = {}): string {
  const rules = [
    'Reply with ONLY the JSON object: no text before or after it, no Markdown code fences, no comments.',
    'Use straight double quotes, no trailing commas, and dates written YYYY-MM-DD.',
    'Leave out any optional field you do not know. Do not write null or empty strings.',
    'If the outline gives no study hours, estimate estimatedHours realistically. For WGU courses budget roughly 10 to 15 hours per competency unit.',
    'List courses in the order I should take them. Give prerequisites as course codes, and only codes that appear in "courses".',
    'Copy course codes and titles exactly as the outline writes them.',
    ...(today ? [`Today is ${today}. Term and target dates must not be in the past.`] : []),
  ]

  return [
    'I use a study-planning app called Forge. Turn the course outline at the end of this message into one JSON object that follows the schema below exactly. Forge will validate it and show me any problems, so precision matters more than completeness.',
    '',
    'RULES',
    ...rules.map((r) => `- ${r}`),
    '',
    `SCHEMA (format version ${PLAN_VERSION}; no other keys are allowed)`,
    ...fieldLines(),
    '',
    'ALSO',
    ...CROSS_FIELD_RULES.map((r) => `- ${r}`),
    '',
    'EXAMPLE OF A VALID REPLY',
    EXAMPLE_JSON.trimEnd(),
    '',
    'MY COURSE OUTLINE / DEGREE PLAN',
    '-----',
    OUTLINE_PLACEHOLDER,
    '-----',
  ].join('\n')
}
