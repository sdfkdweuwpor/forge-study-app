import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SETUP_SQL } from './setupSql'

/**
 * The README's "Sync (optional)" section (PLAN §4.7.9, 12B6) is documentation people follow step by step
 * in a dashboard they cannot ask, so the parts that must be exact are checked here: the SQL is the SQL
 * that was verified (`setupSql.ts`, which `setupSql.test.ts` ties to PLAN §4.7.3), the two email
 * templates carry the code, the redirect URLs are the ones the app sends people back to, and the limits
 * are the ones PLAN §4.7.6 states. Nothing here edits the README.
 */

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8')

const README = read('README.md')
const PLAN = read('PLAN.md')

/** The text of one `## ` section (its heading line included), up to the next `## ` heading. */
function sectionOf(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`README.md has no "${heading}" section`)
  const from = start + 1
  const next = text.indexOf('\n## ', from + heading.length)
  return next === -1 ? text.slice(from) : text.slice(from, next)
}

const SYNC = sectionOf(README, '## Sync (optional)')

/** Every fenced block of one language, in order. */
function blocksOf(text: string, language: string): string[] {
  return [...text.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)```', 'g'))].map(
    (m) => m[1] ?? '',
  )
}

/** The fenced blocks' body with the list indentation they sit under removed. */
const dedent = (block: string): string =>
  block
    .split('\n')
    .map((line) => line.replace(/^ {3}/, ''))
    .join('\n')

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens. */
const anchorOf = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-')

describe('README "Sync (optional)"', () => {
  it('has the setup steps, the limits and how to erase the cloud copy, each once', () => {
    for (const heading of [
      '### Set up sync',
      "### What sync can't do",
      '### Turning sync off, and erasing the cloud copy',
    ]) {
      expect(SYNC.split(`\n${heading}\n`), heading).toHaveLength(2)
    }
    expect(README.split('\n## Sync (optional)\n')).toHaveLength(2)
  })

  it('has the heading Settings links to ("How to set up Supabase")', () => {
    const form = read('src/features/sync/SetupForm.tsx')
    const link = /SETUP_GUIDE_URL = '[^']*#([\w-]+)'/.exec(form)?.[1]
    expect(link, 'SetupForm.tsx has no SETUP_GUIDE_URL with an anchor').toBeDefined()
    expect(anchorOf('Sync (optional)')).toBe(link)
  })

  it('carries exactly the setup SQL, once, in the setup steps', () => {
    const steps = SYNC.slice(SYNC.indexOf('\n### Set up sync\n'))
    const block = blocksOf(steps, 'sql')[0]
    expect(block, 'no sql block under "Set up sync"').toBeDefined()
    expect(block).toBe(SETUP_SQL)
    expect(README.split('create table if not exists public.forge_rows')).toHaveLength(2)
  })

  it('puts the 6-digit code in both email templates, next to the link', () => {
    const templates = blocksOf(SYNC, 'html').map(dedent)
    expect(templates, 'two templates: Magic Link and Confirm signup').toHaveLength(2)
    for (const template of templates) {
      expect(template).toContain('{{ .ConfirmationURL }}')
      expect(template).toContain('Or type this code in Forge: <strong>{{ .Token }}</strong>')
    }
    const magic = SYNC.indexOf('\n   **Magic Link**\n')
    const confirm = SYNC.indexOf('\n   **Confirm signup**\n')
    expect(magic).toBeGreaterThan(-1)
    expect(confirm).toBeGreaterThan(magic)
    // Each label is followed by its own template.
    expect(SYNC.indexOf('```html', magic)).toBeLessThan(confirm)
    expect(SYNC.indexOf('```html', confirm)).toBeGreaterThan(confirm)
  })

  it('lists the redirect URLs (production and localhost) and the Site URL', () => {
    for (const url of [
      'https://forge-study-app.netlify.app/settings/sync',
      'https://sdfkdweuwpor.github.io/forge-study-app/settings/sync',
      'http://localhost:5173/settings/sync',
      'http://localhost:4173/settings/sync',
    ]) {
      expect(SYNC, url).toContain(`\`${url}\``)
    }
    expect(SYNC).toContain('**Site URL**')
    expect(SYNC).toContain('`https://forge-study-app.netlify.app`')
  })

  it('says to turn off new sign-ups once the account exists', () => {
    expect(SYNC).toContain('**Allow new users to sign up**')
    expect(SYNC).toMatch(/Once you are signed in[^.]*turn it off/)
  })

  it('states every limit of PLAN §4.7.6, word for word', () => {
    const from = PLAN.indexOf('#### 4.7.6')
    const to = PLAN.indexOf('#### 4.7.7')
    expect(from).toBeGreaterThan(-1)
    const limits = PLAN.slice(from, to)
      .split('\n')
      .filter((line) => line.startsWith('- **'))
    expect(limits.length).toBeGreaterThanOrEqual(9)
    for (const limit of limits) expect(SYNC, limit.slice(0, 50)).toContain(limit)
  })

  it('says how to erase the cloud copy by hand', () => {
    expect(SYNC).toContain('delete from public.forge_rows where user_id = auth.uid();')
    expect(SYNC).toMatch(/delete from public\.forge_rows where user_id = '[0-9a-f-]{36}';/)
    expect(SYNC).toContain('drop table if exists public.forge_rows;')
    // The SQL deletes by the table's own name, which the setup SQL creates.
    expect(SETUP_SQL).toContain('create table if not exists public.forge_rows')
  })

  it('holds no key or token of any kind', () => {
    // A key would be caught by GitHub's push protection; the README only ever names their shapes.
    expect(SYNC).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9]/)
    expect(SYNC).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
  })
})
