/**
 * The schema documentation, generated from `planSchema` (Zod → JSON Schema → rows), so the in-app
 * "Schema reference", the prompt and the wording of validation errors always match the validator.
 * Descriptions and phrasing come from `.meta()` in `schema.ts`.
 */
import { z } from 'zod'
import { planSchema } from './schema'

export type Requirement = 'required' | 'optional' | 'with-parent'

export interface FieldDoc {
  /** `courses[].estimatedHours`: array items are `[]`. */
  path: string
  /** Short type for the reference table: `number > 0`, `"OA" | "PA"`. */
  type: string
  /** Completes "<path> must be …" in an error message. */
  expects: string
  /** Completes "<path> …" when the field is missing. */
  missing: string
  /** `with-parent`: required, but only inside an optional object or list that is itself given. */
  required: Requirement
  description: string
  /** Nesting depth, for indenting rows. */
  depth: number
}

interface SchemaNode {
  type?: string
  properties?: Record<string, SchemaNode>
  required?: string[]
  items?: SchemaNode
  enum?: unknown[]
  const?: unknown
  format?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  minItems?: number
  maxItems?: number
  minLength?: number
  maxLength?: number
  description?: string
  expects?: string
  missing?: string
}

const quote = (v: unknown): string => JSON.stringify(v)
const list = (values: readonly string[]): string =>
  values.length <= 2 ? values.join(' or ') : `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`

function describeType(node: SchemaNode): { type: string; expects: string } {
  if (node.enum) {
    const values = node.enum.map(quote)
    return { type: values.join(' | '), expects: `one of ${list(values)}` }
  }
  if (node.const !== undefined) return { type: String(node.const), expects: String(node.const) }
  if (node.format === 'date') {
    return { type: 'date YYYY-MM-DD', expects: 'a date written YYYY-MM-DD, such as 2026-10-01' }
  }
  const { minimum: min, maximum: max } = node
  switch (node.type) {
    case 'integer':
      return {
        type: min !== undefined && max !== undefined ? `whole number ${min}–${max}` : 'whole number',
        expects:
          min !== undefined && max !== undefined
            ? `a whole number from ${min} to ${max}`
            : 'a whole number',
      }
    case 'number':
      if (node.exclusiveMinimum === 0) {
        return {
          type: max !== undefined ? `number > 0, up to ${max}` : 'number > 0',
          expects: max !== undefined ? `a positive number, up to ${max}` : 'a positive number',
        }
      }
      if (min !== undefined && max !== undefined) {
        return { type: `number ${min}–${max}`, expects: `a number from ${min} to ${max}` }
      }
      return { type: 'number', expects: 'a number' }
    case 'string':
      return {
        type: 'text',
        expects:
          node.maxLength !== undefined ? `text of 1 to ${node.maxLength} characters` : 'text',
      }
    case 'array': {
      const item = node.items ? describeType(node.items).type : 'items'
      return {
        type: node.items?.type === 'object' ? 'list of objects' : `list of ${item}`,
        expects:
          node.minItems !== undefined && node.maxItems !== undefined
            ? `a list with ${node.minItems} to ${node.maxItems} items`
            : 'a list',
      }
    }
    case 'object':
      return { type: 'object', expects: 'an object' }
    default:
      return { type: node.type ?? 'value', expects: 'a valid value' }
  }
}

function walk(
  node: SchemaNode,
  prefix: string,
  depth: number,
  parentOptional: boolean,
  out: FieldDoc[],
): void {
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key
    const isRequired = node.required?.includes(key) ?? false
    const described = describeType(child)
    out.push({
      path,
      type: described.type,
      expects: child.expects ?? described.expects,
      missing: child.missing ?? 'is required',
      required: !isRequired ? 'optional' : parentOptional ? 'with-parent' : 'required',
      description: child.description ?? '',
      depth,
    })
    const optionalBelow = parentOptional || !isRequired
    if (child.type === 'object') walk(child, path, depth + 1, optionalBelow, out)
    else if (child.type === 'array' && child.items?.type === 'object') {
      walk(child.items, `${path}[]`, depth + 1, optionalBelow, out)
    }
  }
}

let cached: readonly FieldDoc[] | undefined

/** Every field of the format in document order, generated from `planSchema`. */
export function fieldDocs(): readonly FieldDoc[] {
  if (cached) return cached
  const json = z.toJSONSchema(planSchema, { io: 'output', unrepresentable: 'any' })
  const rows: FieldDoc[] = []
  walk(json as SchemaNode, '', 0, false, rows)
  cached = rows
  return rows
}

let byPath: ReadonlyMap<string, FieldDoc> | undefined

/** Looks up a field by its generalised path (`courses[].units[].title`). */
export function fieldDoc(path: string): FieldDoc | undefined {
  byPath ??= new Map(fieldDocs().map((d) => [d.path, d]))
  return byPath.get(path)
}

/** `["courses", 2, "units", 0, "title"]` → `courses[].units[].title`. */
export function generalPath(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (acc, key) =>
      typeof key === 'number' ? `${acc}[]` : acc === '' ? key : `${acc}.${key}`,
    '',
  )
}

/** Rules the schema cannot express per field, shown under the table and in the prompt. */
export const CROSS_FIELD_RULES: readonly string[] = [
  'Course codes are unique. Codes are uppercased for you.',
  'Every prerequisite is a code that appears in "courses" (when merging into a goal, a course already in it also counts).',
  'Prerequisites cannot form a cycle.',
  'A unit has estimatedHours or estimatedMinutes, not both.',
  'term.end and every days-off range run forward in time.',
  'Numbers may be written as strings ("40"). Empty strings and null count as left out.',
]
