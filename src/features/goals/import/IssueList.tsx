import { CircleAlert, TriangleAlert } from 'lucide-react'
import type { PlanIssue } from '@/logic/planImport'
import styles from './IssueList.module.css'

/** Rows shown before "and N more": a broken paste can have hundreds of problems, and the first few matter. */
const MAX_SHOWN = 8

export interface IssueListProps {
  id: string
  issues: readonly PlanIssue[]
  kind: 'error' | 'warning'
  /** Called with the 1-based line when a row is chosen (the editor selects that line). */
  onJump?(line: number, column: number): void
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The problems with a paste, one row per issue with the line it is on. Each row is one big button that
 * selects that line in the editor, so a fix is a click and an edit away.
 */
export function IssueList({ id, issues, kind, onJump }: IssueListProps) {
  if (issues.length === 0) return null
  const shown = issues.slice(0, MAX_SHOWN)
  const Icon = kind === 'error' ? CircleAlert : TriangleAlert
  const heading = kind === 'error' ? plural(issues.length, 'problem') : plural(issues.length, 'note')

  return (
    <div id={id} className={styles.list} data-kind={kind}>
      <p className={styles.heading}>
        <Icon size={14} aria-hidden="true" />
        {kind === 'error' ? `${heading} to fix before you can import` : heading}
      </p>
      <ul className={styles.items}>
        {shown.map((issue, i) => (
          <li key={`${issue.line}:${issue.column}:${i}`}>
            <button
              type="button"
              className={styles.row}
              onClick={() => onJump?.(issue.line, issue.column)}
              aria-label={`Line ${issue.line}: ${issue.message}. Go to line.`}
            >
              <span className={styles.where}>Line {issue.line}</span>
              <span className={styles.message}>{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
      {issues.length > shown.length ? (
        <p className={styles.more}>and {plural(issues.length - shown.length, 'more problem')}. Fix these first.</p>
      ) : null}
    </div>
  )
}
