import { Check, Copy, ExternalLink } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import type { ISODate } from '@/db/types'
import { copyText } from '@/lib/clipboard'
import {
  buildPrompt,
  OUTLINE_PLACEHOLDER,
  parsePlan,
  toPlanDraft,
  type PlanDraft,
} from '@/logic/planImport'
import { Button } from '@/ui/Button'
import { Textarea } from '@/ui/Textarea'
import { useToast } from '@/ui/Toast'
import shared from '../shared.module.css'
import styles from './ClaudePath.module.css'

export interface ClaudePathProps {
  today: ISODate
  /** "photo": attach the picture in Claude. "goal": Claude gets the typed goal to break down. */
  mode: 'photo' | 'goal'
  /** The typed goal, put into the prompt in place of the outline placeholder. */
  goalText?: string
  /** Claude's plan, once it validates and the person chose to review it. */
  onPlan: (plan: PlanDraft) => void
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Photos and big goals go through Claude, by copy and paste (BRIEF §9: no API calls): copy the prompt,
 * send it to Claude (with the photo attached), paste the JSON reply back. The reply is checked here, and
 * even a valid plan only goes on to the review screen: nothing Claude says is scheduled without a look.
 */
export function ClaudePath({ today, mode, goalText, onPlan }: ClaudePathProps) {
  const toast = useToast()
  const [json, setJson] = useState('')
  const [copied, setCopied] = useState(false)
  const deferred = useDeferredValue(json)

  const prompt = useMemo(() => {
    const base = buildPrompt({ today })
    return mode === 'goal' && goalText?.trim()
      ? base.replace(OUTLINE_PLACEHOLDER, goalText.trim())
      : base
  }, [today, mode, goalText])

  const result = useMemo(() => (deferred.trim() === '' ? null : parsePlan(deferred)), [deferred])

  async function copy() {
    const ok = await copyText(prompt)
    if (ok) {
      setCopied(true)
      toast.success('Prompt copied', { description: 'Paste it into a new Claude chat.' })
    } else
      toast.error('Couldn’t copy', { description: 'Select the prompt text and copy it by hand.' })
  }

  return (
    <div className={styles.root}>
      <ol className={styles.steps}>
        <li>
          <div className={styles.stepHead}>
            <span className={styles.n}>1</span>
            <h4 className={styles.stepTitle}>Copy the prompt</h4>
          </div>
          <div className={shared.actions}>
            <Button size="sm" iconLeft={copied ? <Check /> : <Copy />} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy prompt'}
            </Button>
            <a
              className={styles.open}
              href="https://claude.ai/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Claude <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span className={styles.n}>2</span>
            <h4 className={styles.stepTitle}>
              {mode === 'photo' ? 'Attach your photo and send' : 'Send it to Claude'}
            </h4>
          </div>
          <p className={shared.hint}>
            {mode === 'photo'
              ? 'Paste the prompt into a Claude chat, attach the photo of your syllabus or degree plan there, and send. The photo goes to Claude only. Forge never sees it.'
              : 'Paste the prompt into a Claude chat and send. It has your goal in it already.'}
          </p>
        </li>
        <li>
          <div className={styles.stepHead}>
            <span className={styles.n}>3</span>
            <h4 className={styles.stepTitle}>Paste Claude’s reply here</h4>
          </div>
          <Textarea
            aria-label="Claude’s JSON reply"
            placeholder='{ "version": 1, "goal": { … }, "courses": [ … ] }'
            value={json}
            rows={6}
            spellCheck={false}
            className={styles.json}
            onChange={(e) => setJson(e.target.value)}
          />
          {result === null ? null : result.ok ? (
            <div className={styles.ok} role="status">
              <p className={shared.hint}>
                Looks good: {plural(result.plan.courses.length, 'course')},{' '}
                {plural(
                  result.plan.courses.reduce((n, c) => n + (c.units?.length ?? 0), 0),
                  'unit',
                )}
                . You’ll check and edit it next, and nothing is scheduled until you say so.
              </p>
              <Button variant="primary" size="sm" onClick={() => onPlan(toPlanDraft(result.plan))}>
                Review this plan
              </Button>
            </div>
          ) : (
            <div className={styles.problems} role="alert">
              <p className={shared.hint}>
                Something in the reply doesn’t fit yet. Ask Claude to fix it, or edit the text:
              </p>
              <ul>
                {result.errors.slice(0, 4).map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
              {result.errors.length > 4 ? (
                <p className={shared.hint}>and {result.errors.length - 4} more.</p>
              ) : null}
            </div>
          )}
        </li>
      </ol>
    </div>
  )
}
