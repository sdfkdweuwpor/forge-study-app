import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETUP_SQL } from './setupSql'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8')

/** The first ```sql block after `heading`. */
function sqlBlockAfter(text: string, heading: string): string | null {
  const from = text.indexOf(heading)
  if (from === -1) return null
  const match = /```sql\n([\s\S]*?)```/.exec(text.slice(from))
  return match?.[1] ?? null
}

describe('the setup SQL', () => {
  it('is exactly the SQL of PLAN §4.7.3', () => {
    const plan = sqlBlockAfter(read('PLAN.md'), '#### 4.7.3 Server schema')
    expect(plan, 'PLAN.md §4.7.3 has no sql block').not.toBeNull()
    expect(SETUP_SQL).toBe(plan)
  })

  it('is exactly the README text once the README has a "Set up sync" section', () => {
    const readme = read('README.md')
    if (!readme.includes('create table if not exists public.forge_rows')) return
    const block = sqlBlockAfter(readme, 'Set up sync')
    expect(block, 'README.md "Set up sync" has no sql block').not.toBeNull()
    expect(SETUP_SQL).toBe(block)
  })

  it('keeps the parts that protect the data', () => {
    // A cheap guard against a hand edit that drops a safeguard; the exact text is checked above.
    expect(SETUP_SQL).toContain('enable row level security')
    expect(SETUP_SQL).toContain('revoke all on table public.forge_rows from anon')
    expect(SETUP_SQL).toContain('create or replace function public.forge_now()')
    expect(SETUP_SQL).toContain('pg_advisory_xact_lock')
  })

  it('holds no key or token of any kind', () => {
    expect(SETUP_SQL).not.toMatch(/sb_(secret|publishable)_|eyJ[A-Za-z0-9_-]{10,}/)
  })
})
