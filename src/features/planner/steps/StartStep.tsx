import { FileText, Image as ImageIcon, PenLine, Upload } from 'lucide-react'
import { useRef, useState, type Dispatch } from 'react'
import type { ISODate } from '@/db/types'
import { newId } from '@/lib/ids'
import { formatHours, plural } from '@/logic/goalDisplay'
import { suggestTemplate, TEMPLATES, templateById } from '@/logic/goalTemplates'
import type { PlanDraft } from '@/logic/planImport'
import {
  applyPlanDraft,
  applyTemplate,
  draftEffort,
  emptyPlannerDraft,
  isPristine,
  readSourceText,
  readTypedGoal,
  type DraftErrors,
  type PlannerAction,
  type PlannerDraft,
  type PlannerStep,
} from '@/logic/plannerDraft'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Spinner } from '@/ui/Spinner'
import { Tabs } from '@/ui/Tabs'
import { Textarea } from '@/ui/Textarea'
import { useToast } from '@/ui/Toast'
import { ClaudePath } from '../components/ClaudePath'
import { extractPdfText, PDF_FAILURE_TEXT } from '../pdfText'
import shared from '../shared.module.css'
import styles from './StartStep.module.css'

export type InputTab = 'paste' | 'pdf' | 'photo' | 'goal'

export interface StartStepProps {
  draft: PlannerDraft
  dispatch: Dispatch<PlannerAction>
  errors: DraftErrors
  today: ISODate
  tab: InputTab
  onTab: (tab: InputTab) => void
  /** Go to a later step (the Claude path lands on Effort). */
  onGo: (step: PlannerStep) => void
}

const SAMPLE = `C182 Introduction to IT – 4 CUs
C779 Web Development Foundations (3 CUs)
D278 Scripting and Programming Foundations (3 CUs)
Target: March 31`

/** Words for what a draft holds: "3 courses, 18 units, 4 assessments". */
export function contentSummary(draft: PlannerDraft): string {
  const units = draft.courses.reduce((n, c) => n + c.units.length, 0)
  const assessments = draft.courses.reduce((n, c) => n + c.assessments.length, 0)
  return [
    plural(draft.courses.length, 'course'),
    units > 0 ? plural(units, 'unit') : null,
    assessments > 0 ? plural(assessments, 'assessment') : null,
  ]
    .filter((s) => s !== null)
    .join(', ')
}

export function StartStep({ draft, dispatch, errors, today, tab, onTab, onGo }: StartStepProps) {
  const toast = useToast()
  const [pdf, setPdf] = useState<{ state: 'idle' | 'reading' | 'error'; message?: string; pages?: number }>({
    state: 'idle',
  })
  const fileInput = useRef<HTMLInputElement | null>(null)

  /** Replaces the draft, with a way back when it replaced something. */
  function replace(next: PlannerDraft, message: string, description?: string, to?: PlannerStep) {
    const previous = draft
    dispatch({ type: 'replaceDraft', draft: next, ...(to !== undefined ? { step: to } : {}) })
    if (!isPristine(previous, today) && previous.courses.length > 0) {
      toast.show({
        title: message,
        ...(description ? { description } : {}),
        undo: () => dispatch({ type: 'replaceDraft', draft: previous }),
      })
    }
  }

  function pickTemplate(id: (typeof TEMPLATES)[number]['id']) {
    const t = templateById(id)
    const next = applyTemplate(draft, t, { newKey: newId, today, keepTitle: draft.source === 'typed' })
    replace(next, `Loaded the ${t.name} template`, 'Every part of it is editable on the review screen.')
  }

  function blank() {
    replace(
      { ...emptyPlannerDraft(today), availability: draft.availability },
      'Started from a blank goal',
    )
  }

  function readText(text: string, source: 'paste' | 'pdf') {
    if (text.trim() === '') return
    replace(readSourceText(draft, text, { source, newKey: newId, today }), 'Read the text again')
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setPdf({ state: 'reading' })
    const r = await extractPdfText(file)
    if (!r.ok) {
      setPdf({ state: 'error', message: PDF_FAILURE_TEXT[r.reason] })
      return
    }
    setPdf({ state: 'idle', pages: r.pages })
    dispatch({
      type: 'replaceDraft',
      draft: readSourceText(draft, r.text, { source: 'pdf', newKey: newId, today }),
    })
  }

  function useClaudePlan(plan: PlanDraft) {
    replace(
      applyPlanDraft(draft, plan, { source: 'claude', newKey: newId, today }),
      'Loaded the plan from Claude',
      'Check the effort, then review every line before anything is scheduled.',
      3,
    )
    onGo(3)
  }

  function setTyped() {
    replace(readTypedGoal(draft, { newKey: newId, today }), 'Set your goal')
  }

  const hasContent = draft.courses.length > 0
  const suggested = suggestTemplate(`${draft.title} ${draft.description}`)
  const fromText = draft.source === 'paste' || draft.source === 'pdf'
  const dirty = fromText && draft.sourceText !== draft.readText

  return (
    <div className={shared.stack}>
      <section aria-labelledby="start-templates" className={shared.section}>
        <h2 id="start-templates" className={shared.sectionTitle}>
          Start from a template
        </h2>
        <ul className={styles.templates}>
          {TEMPLATES.map((t) => {
            const units = t.courses.reduce((n, c) => n + c.units.length, 0)
            const selected = draft.templateId === t.id
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={styles.template}
                  aria-pressed={selected}
                  onClick={() => pickTemplate(t.id)}
                >
                  <span className={styles.templateIcon} aria-hidden="true">
                    {t.icon}
                  </span>
                  <span className={styles.templateName}>{t.name}</span>
                  <span className={styles.templateBlurb}>{t.blurb}</span>
                  <span className={styles.templateMeta}>
                    {plural(t.courses.length, t.id === 'certification' ? 'part' : 'course')} ·{' '}
                    {plural(units, 'unit')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className={shared.hint}>
          Or{' '}
          <button type="button" className={shared.link} onClick={blank}>
            start blank
          </button>{' '}
          and bring your own outline below.
        </p>
      </section>

      <section aria-labelledby="start-source" className={shared.section}>
        <h2 id="start-source" className={shared.sectionTitle}>
          What are you working toward?
        </h2>
        <Tabs
          label="How to describe it"
          value={tab}
          onValueChange={onTab}
          items={[
            { value: 'paste', label: 'Paste text', icon: <FileText /> },
            { value: 'pdf', label: 'Upload a PDF', icon: <Upload /> },
            { value: 'photo', label: 'Upload a photo', icon: <ImageIcon /> },
            { value: 'goal', label: 'Type a goal', icon: <PenLine /> },
          ]}
        >
          {(value) => (
            <div className={styles.panel}>
              {value === 'paste' ? (
                <>
                  <Textarea
                    label="Syllabus or course list"
                    placeholder={SAMPLE}
                    value={draft.sourceText}
                    minRows={6}
                    onChange={(e) => dispatch({ type: 'patch', patch: { sourceText: e.target.value } })}
                  />
                  <div className={shared.actions}>
                    <Button
                      variant={draft.sourceText.trim() !== '' && (dirty || !hasContent) ? 'primary' : 'secondary'}
                      disabled={draft.sourceText.trim() === ''}
                      onClick={() => readText(draft.sourceText, 'paste')}
                    >
                      Read it
                    </Button>
                    <span className={shared.hint}>
                      Course codes, CUs, hours, weeks, exams and dates are picked out. Nothing leaves this device.
                    </span>
                  </div>
                </>
              ) : null}

              {value === 'pdf' ? (
                <>
                  <p className={shared.hint}>
                    Forge reads the text in your PDF on this device. Nothing is uploaded.
                  </p>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    aria-label="Choose a PDF file"
                    onChange={(e) => {
                      void onFile(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                  <div className={shared.actions}>
                    <Button
                      iconLeft={pdf.state === 'reading' ? <Spinner /> : <Upload />}
                      disabled={pdf.state === 'reading'}
                      onClick={() => fileInput.current?.click()}
                    >
                      {pdf.state === 'reading' ? 'Reading the PDF' : 'Choose a PDF'}
                    </Button>
                  </div>
                  {pdf.state === 'error' ? (
                    <p className={shared.error} role="alert">
                      {pdf.message}
                    </p>
                  ) : null}
                  {pdf.pages !== undefined && draft.source === 'pdf' ? (
                    <>
                      <p className={shared.hint} role="status">
                        Read {plural(pdf.pages, 'page')} on this device. Fix anything odd in the text, then read it again.
                      </p>
                      <Textarea
                        label="Text from the PDF"
                        value={draft.sourceText}
                        minRows={6}
                        onChange={(e) => dispatch({ type: 'patch', patch: { sourceText: e.target.value } })}
                      />
                      <div className={shared.actions}>
                        <Button
                          variant={dirty ? 'primary' : 'secondary'}
                          onClick={() => readText(draft.sourceText, 'pdf')}
                        >
                          Read it again
                        </Button>
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}

              {value === 'photo' ? (
                <>
                  <p className={shared.hint}>
                    Photos can’t be read offline, and Forge never uploads your pictures. Claude can read
                    one for you: copy the prompt, attach the photo in Claude, and paste its reply back.
                    You review everything before it becomes a plan.
                  </p>
                  <ClaudePath today={today} mode="photo" onPlan={useClaudePlan} />
                </>
              ) : null}

              {value === 'goal' ? (
                <>
                  <Input
                    label="Your goal"
                    placeholder="Learn conversational Spanish by June 2027"
                    value={draft.title}
                    maxLength={120}
                    onChange={(e) => dispatch({ type: 'patch', patch: { title: e.target.value } })}
                  />
                  <Textarea
                    label="Anything Forge should know? (optional)"
                    placeholder="Where you are now, what done looks like, what you have to work with."
                    value={draft.description}
                    minRows={3}
                    onChange={(e) => dispatch({ type: 'patch', patch: { description: e.target.value } })}
                  />
                  <div className={shared.actions}>
                    <Button
                      variant={draft.source === 'typed' ? 'secondary' : 'primary'}
                      disabled={draft.title.trim() === ''}
                      onClick={setTyped}
                    >
                      Use this goal
                    </Button>
                  </div>
                  {draft.needsBreakdown && draft.source === 'typed' ? (
                    <div className={styles.breakdown}>
                      <h3 className={styles.breakdownTitle}>That’s a big one. Break it into steps?</h3>
                      <p className={shared.hint}>
                        Forge can plan it as it is, but units and dates make a better schedule.
                      </p>
                      <div className={shared.actions}>
                        {suggested ? (
                          <Button onClick={() => pickTemplate(suggested.id)}>
                            Use the {suggested.name} skeleton
                          </Button>
                        ) : (
                          <Button onClick={() => pickTemplate('personal-project')}>
                            Use the Personal project skeleton
                          </Button>
                        )}
                      </div>
                      <details className={styles.claudeDetails}>
                        <summary>Or ask Claude to break it down</summary>
                        <ClaudePath
                          today={today}
                          mode="goal"
                          goalText={`${draft.title}${draft.description ? `\n${draft.description}` : ''}`}
                          onPlan={useClaudePlan}
                        />
                      </details>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
        </Tabs>
      </section>

      {hasContent ? (
        <section className={styles.found} aria-live="polite" aria-label="What Forge found">
          <h2 className={shared.sectionTitle}>Found: {contentSummary(draft)}</h2>
          <p className={shared.hint}>
            {formatHours(draftEffort(draft).totalMinutes) !== '0'
              ? `${formatHours(draftEffort(draft).totalMinutes)} h of study so far. `
              : 'No hours yet: you’ll add them on the Effort step. '}
            {draft.unparsed.length > 0
              ? `${plural(draft.unparsed.length, 'line')} couldn’t be read; you can add them on the review screen.`
              : 'You can change all of it on the review screen.'}
          </p>
        </section>
      ) : null}
      {errors.courses ? (
        <p className={shared.error} role="alert">
          {errors.courses}
        </p>
      ) : null}
    </div>
  )
}
