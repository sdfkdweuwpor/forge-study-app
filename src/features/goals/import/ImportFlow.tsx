import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CircleAlert, Copy, FileJson } from 'lucide-react'
import { useToday } from '@/app/hooks/useToday'
import {
  buildPrompt,
  EXAMPLE_JSON,
  hasWrites,
  knownCourses,
  parsePlan,
  planToOps,
  type ExistingGoal,
} from '@/logic/planImport'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import { Tabs, type TabItem } from '@/ui/Tabs'
import { useToast } from '@/ui/Toast'
import { copyText } from './clipboard'
import { Disclosure } from './Disclosure'
import styles from './ImportFlow.module.css'
import { runImport, type ImportRun } from './importPlan'
import { IssueList } from './IssueList'
import { JsonEditor, type JsonEditorHandle } from './JsonEditor'
import { PlanPreview } from './PlanPreview'
import { useGoalSnapshot, type ImportTarget } from './queries'
import { SchemaReference } from './SchemaReference'

type Step = 'prompt' | 'paste' | 'preview'

export interface ImportFlowProps {
  /** An existing goal to merge into, or a new goal. */
  target: ImportTarget
  /** Focus the first action when the flow appears (a dialog or a just-opened panel). */
  focusOnMount?: boolean
  /** After a successful import. The host closes itself or goes to the goal. */
  onImported(run: ImportRun): void
  /** After Undo on the success toast. */
  onUndone?(run: ImportRun): void
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const hoursText = (h: number): string => `${Math.round(h * 10) / 10} h`

/**
 * "1 Copy prompt → 2 Paste JSON → 3 Preview → Import" (BRIEF §5.4). Nothing is written until the Import
 * button on the last step is pressed, and every import can be undone from the toast. Handles its own
 * loading (the goal being merged into) and missing-goal states.
 */
export function ImportFlow(props: ImportFlowProps) {
  const goalId = props.target.kind === 'goal' ? props.target.goalId : null
  const snapshot = useGoalSnapshot(goalId)

  if (goalId !== null && snapshot === undefined) {
    return (
      <div className={styles.loading} aria-busy="true" aria-label="Loading the goal">
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="block" height={120} />
      </div>
    )
  }
  if (goalId !== null && snapshot === null) {
    return (
      <EmptyState
        size="sm"
        icon={<CircleAlert />}
        title="This goal no longer exists"
        description="It may have been moved to the trash. Restore it from Trash to import into it."
      />
    )
  }
  return <FlowBody {...props} existing={goalId === null ? null : (snapshot ?? null)} />
}

function FlowBody({
  target,
  existing,
  focusOnMount = false,
  onImported,
  onUndone,
}: ImportFlowProps & { existing: ExistingGoal | null }) {
  const toast = useToast()
  const today = useToday()
  const problemsId = useId()

  const [step, setStep] = useState<Step>('prompt')
  const [text, setText] = useState('')
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [showPrompt, setShowPrompt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const editor = useRef<JsonEditorHandle>(null)
  const copyButton = useRef<HTMLButtonElement>(null)
  const importButton = useRef<HTMLButtonElement>(null)
  /** Set by the Next/Back buttons, so focus follows them but never jumps while arrowing through tabs. */
  const focusOnStep = useRef<Step | null>(null)

  const prompt = useMemo(() => buildPrompt({ today }), [today])

  // Validate as the text changes; the deferred value keeps typing and pasting responsive.
  const deferred = useDeferredValue(text)
  const settled = deferred === text
  const result = useMemo(
    () => (deferred.trim() === '' ? null : parsePlan(deferred, { known: knownCourses(existing) })),
    [deferred, existing],
  )
  const ops = useMemo(() => {
    if (!result?.ok) return null
    let n = 0
    return planToOps(result.plan, existing, { today, newId: () => `preview-${++n}`, nextGoalOrder: 0 })
  }, [result, existing, today])
  const ready = settled && result?.ok === true && ops !== null

  const errorLines = useMemo(
    () => (result && !result.ok ? [...new Set(result.errors.map((e) => e.line))] : []),
    [result],
  )

  useEffect(() => {
    if (focusOnMount) copyButton.current?.focus()
  }, [focusOnMount])

  useEffect(() => {
    if (focusOnStep.current !== step) return
    focusOnStep.current = null
    if (step === 'paste') editor.current?.focus()
    else if (step === 'preview') importButton.current?.focus()
    else copyButton.current?.focus()
  }, [step])

  useEffect(() => {
    if (copied === 'idle') return undefined
    const timer = setTimeout(() => setCopied('idle'), 2600)
    return () => clearTimeout(timer)
  }, [copied])

  const go = (next: Step): void => {
    focusOnStep.current = next
    setStep(next)
  }

  const copyPrompt = async (): Promise<void> => {
    const ok = await copyText(prompt)
    setCopied(ok ? 'copied' : 'failed')
    if (!ok) setShowPrompt(true)
  }

  const doImport = async (): Promise<void> => {
    if (!result?.ok || busy) return
    setBusy(true)
    setImportError(null)
    try {
      const run = await runImport(result.plan, target)
      const undo = async (): Promise<void> => {
        await run.undo()
        onUndone?.(run)
      }
      const { totals } = run
      if (run.rebalanceError) {
        toast.error('Imported, but the schedule could not be rebuilt', {
          description: 'Your courses are saved. Use Rebalance now on the goal page.',
          undo,
        })
      } else if (!run.wrote) {
        toast.success('Already up to date', { description: 'This plan matches the goal, so nothing changed.' })
      } else if (run.mode === 'create') {
        toast.success(`Created “${ops?.preview.goal.title ?? 'your goal'}”`, {
          description: `${plural(totals.courses, 'course')} · ${hoursText(totals.hours)}. The schedule is built.`,
          undo,
        })
      } else {
        toast.success('Plan imported', {
          description: `Added ${plural(totals.added, 'course')}, updated ${totals.updated}. Nothing was deleted.`,
          undo,
        })
      }
      onImported(run)
    } catch (e) {
      setImportError(
        e instanceof Error ? e.message : 'The import failed. Nothing was changed, so you can try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const items: TabItem<Step>[] = [
    { value: 'prompt', label: '1 Copy prompt' },
    { value: 'paste', label: '2 Paste JSON' },
    { value: 'preview', label: '3 Preview', disabled: !ready },
  ]

  return (
    <div className={styles.flow}>
      <Tabs label="Import steps" items={items} value={step} onValueChange={setStep}>
        {(current) => (
          <div className={styles.step}>
            {current === 'prompt' ? (
              <>
                <ol className={styles.howto}>
                  <li>
                    <strong>Copy the prompt.</strong> It tells Claude exactly which JSON Forge understands.
                  </li>
                  <li>
                    <strong>Open Claude</strong>, paste it, and replace its last line with your course outline or
                    degree plan. You can attach a photo or PDF of your syllabus instead: Claude reads it, and
                    Forge never sees the file.
                  </li>
                  <li>
                    <strong>Copy Claude’s whole reply</strong> and paste it in step 2.
                  </li>
                </ol>
                <div className={styles.actions}>
                  <Button
                    ref={copyButton}
                    variant="primary"
                    iconLeft={copied === 'copied' ? <Check /> : <Copy />}
                    onClick={() => void copyPrompt()}
                  >
                    {copied === 'copied' ? 'Copied' : 'Copy prompt'}
                  </Button>
                  <Button variant="ghost" iconRight={<ArrowRight />} onClick={() => go('paste')}>
                    I have the JSON
                  </Button>
                </div>
                <p className={styles.note} role="status">
                  {copied === 'copied'
                    ? 'Prompt copied. Paste it into Claude, then come back with the reply.'
                    : copied === 'failed'
                      ? 'Copying was blocked. Select the prompt below and copy it yourself.'
                      : 'Nothing leaves this device: Forge never contacts Claude. You copy and paste between the two.'}
                </p>
                <Disclosure title="Show the prompt" open={showPrompt} onToggle={setShowPrompt}>
                  <pre className={styles.prompt}>{prompt}</pre>
                </Disclosure>
              </>
            ) : null}

            {current === 'paste' ? (
              <>
                <JsonEditor
                  ref={editor}
                  label="Claude’s reply (JSON)"
                  value={text}
                  onChange={(v) => {
                    setText(v)
                    setImportError(null)
                  }}
                  errorLines={errorLines}
                  describedBy={problemsId}
                  placeholder={'{\n  "forgePlan": 1,\n  "goal": { "name": "…" },\n  "courses": [ … ]\n}'}
                  onSubmit={() => {
                    if (ready) go('preview')
                  }}
                />
                <div className={styles.status} aria-live="polite">
                  {result === null ? (
                    <p className={styles.note}>
                      Paste Claude’s whole reply. Text before or after the JSON, and code fences, are ignored.{' '}
                      <Button
                        variant="ghost"
                        size="sm"
                        iconLeft={<FileJson />}
                        onClick={() => setText(EXAMPLE_JSON)}
                      >
                        Try the example
                      </Button>
                    </p>
                  ) : result.ok ? (
                    <>
                      <p className={styles.ok}>
                        <Check size={14} aria-hidden="true" />
                        Valid: {ops ? plural(ops.preview.totals.courses, 'course') : ''}
                        {ops ? ` · ${hoursText(ops.preview.totals.hours)}` : ''}
                        {ops && ops.preview.totals.cus > 0 ? ` · ${ops.preview.totals.cus} CUs` : ''}
                      </p>
                      <IssueList
                        id={problemsId}
                        issues={result.warnings}
                        kind="warning"
                        onJump={(line) => editor.current?.jumpToLine(line)}
                      />
                    </>
                  ) : (
                    <IssueList
                      id={problemsId}
                      issues={result.errors}
                      kind="error"
                      onJump={(line) => editor.current?.jumpToLine(line)}
                    />
                  )}
                </div>
                <div className={styles.actions}>
                  <Button variant="ghost" iconLeft={<ArrowLeft />} onClick={() => go('prompt')}>
                    Back
                  </Button>
                  {text !== '' ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setText('')
                        editor.current?.focus()
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                  <span className={styles.spacer} />
                  <Button
                    variant="primary"
                    iconRight={<ArrowRight />}
                    disabled={!ready}
                    onClick={() => go('preview')}
                  >
                    Preview
                    {ready ? <Kbd keys="mod+enter" size="sm" variant="plain" /> : null}
                  </Button>
                </div>
              </>
            ) : null}

            {current === 'preview' ? (
              ready && ops ? (
                <>
                  <PlanPreview preview={ops.preview} />
                  <p className={styles.explain}>
                    {ops.mode === 'create'
                      ? `Import creates a new goal with ${plural(ops.preview.totals.courses, 'course')} and builds its schedule.`
                      : hasWrites(ops)
                        ? `Import adds ${plural(ops.preview.totals.added, 'course')} and updates ${ops.preview.totals.updated}. Courses and units that are not in this plan stay exactly as they are: nothing is ever deleted.`
                        : 'Everything in this plan is already in the goal, so there is nothing to import.'}{' '}
                    You can undo right after.
                  </p>
                  {importError ? (
                    <p className={styles.error} role="alert">
                      <CircleAlert size={14} aria-hidden="true" />
                      {importError}
                    </p>
                  ) : null}
                  <div className={styles.actions}>
                    <Button variant="ghost" iconLeft={<ArrowLeft />} onClick={() => go('paste')}>
                      Edit JSON
                    </Button>
                    <span className={styles.spacer} />
                    <Button
                      ref={importButton}
                      variant="primary"
                      loading={busy}
                      disabled={ops.mode === 'merge' && !hasWrites(ops)}
                      onClick={() => void doImport()}
                    >
                      Import
                    </Button>
                  </div>
                </>
              ) : (
                <EmptyState
                  size="sm"
                  icon={<FileJson />}
                  title="Nothing to preview yet"
                  description="Paste Claude’s JSON and fix any problems first."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => go('paste')}>
                      Paste JSON
                    </Button>
                  }
                />
              )
            ) : null}
          </div>
        )}
      </Tabs>

      <SchemaReference
        onUseExample={() => {
          setText(EXAMPLE_JSON)
          go('paste')
        }}
      />
    </div>
  )
}
