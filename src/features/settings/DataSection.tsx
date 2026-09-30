import { ArrowRight, Download, FileUp, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { recordError } from '@/app/reportError'
import { useNow } from '@/app/hooks/useNow'
import { Link, setQuery, useQuery, href } from '@/app/router'
import { useSettings } from '@/db/hooks/useSettings'
import {
  BACKUP_CONTEXT,
  createSafetyCopy,
  importBackup,
  markBackedUp,
  resetAllData,
} from '@/db/repos/backup'
import { backupAgeLabel, parseBackup, type BackupFile } from '@/logic/backup'
import { Button } from '@/ui/Button'
import { Toggle } from '@/ui/Toggle'
import { appVersion } from './appVersion'
import { clearDevicePrefs, saveExport } from './backupActions'
import styles from './data.module.css'
import { ImportDialog } from './ImportDialog'
import { rememberImport } from './importResult'
import { ResetDialog } from './ResetDialog'
import { Row } from './Row'
import { SaveStatusLine } from './SaveStatusLine'
import settingsStyles from './settings.module.css'
import { DATA } from './sections'
import { SectionLoading, SettingsSection } from './SettingsSection'
import { useBackupExport } from './useBackupExport'
import { useSaveSettings } from './useSaveSettings'

type ImportState =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string }
  | { kind: 'refused'; name: string; errors: string[] }
  | { kind: 'preview'; name: string; file: BackupFile; warnings: string[] }
  | { kind: 'importing'; name: string; file: BackupFile; warnings: string[] }
  | { kind: 'failed'; name: string; file: BackupFile; warnings: string[]; message: string }

const dateOnly = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })

/** Lets the browser start the safety-copy download before the page reloads. */
const DOWNLOAD_GRACE_MS = 400
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const messageOf = (e: unknown): string =>
  e instanceof Error && e.message ? e.message : 'Something went wrong.'

/**
 * Data: export everything as JSON, import a backup (checked, previewed, with a safety copy first),
 * the weekly backup reminder, and Reset behind a typed confirmation. Import and Reset both end by
 * reloading the app, so every screen and timer starts from the data that is now on the device.
 */
export function DataSection() {
  const settings = useSettings()
  const { save, status } = useSaveSettings()
  const exporter = useBackupExport()
  const query = useQuery()
  const fileInput = useRef<HTMLInputElement>(null)
  const chooseButton = useRef<HTMLButtonElement>(null)
  const [imp, setImp] = useState<ImportState>({ kind: 'idle' })
  const now = useNow('minute')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  // The reset dialog lives in the URL (`?do=reset`, from the palette or the button), so a link can open it
  // (and reload keeps it open). `?do=import` lands on the button that opens the file picker, then drops the flag.
  const action = query.do
  const resetOpen = action === 'reset'
  const loaded = settings !== undefined
  useEffect(() => {
    if (!loaded || action !== 'import') return
    setQuery({ do: undefined })
    chooseButton.current?.focus()
  }, [action, loaded])

  if (settings === undefined) return <SectionLoading title={DATA.title} rows={4} />
  const { lastExportAt, remindWeekly } = settings.backup
  const lastBackup =
    lastExportAt === null
      ? 'Never'
      : `${dateOnly.format(lastExportAt)} (${backupAgeLabel(lastExportAt, now).toLowerCase()})`

  async function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0]
    // Choosing the same file twice must fire again.
    e.target.value = ''
    if (!chosen) return
    setImp({ kind: 'reading', name: chosen.name })
    let text: string
    try {
      text = await chosen.text()
    } catch (err) {
      recordError(err, 'readBackupFile')
      setImp({
        kind: 'refused',
        name: chosen.name,
        errors: ['Couldn’t read that file. Try choosing it again.'],
      })
      return
    }
    const parsed = parseBackup(text, BACKUP_CONTEXT)
    setImp(
      parsed.ok
        ? { kind: 'preview', name: chosen.name, file: parsed.file, warnings: parsed.warnings }
        : { kind: 'refused', name: chosen.name, errors: parsed.errors },
    )
  }

  async function runImport(state: Extract<ImportState, { file: BackupFile }>) {
    const { name, file, warnings } = state
    setImp({ kind: 'importing', name, file, warnings })
    try {
      const at = Date.now()
      // The safety copy comes first: if it cannot be made, nothing has been touched.
      const copy = await createSafetyCopy('pre-import', at, appVersion())
      try {
        saveExport(copy.download)
      } catch (err) {
        // The snapshot inside the app exists; a blocked download does not stop the import.
        recordError(err, 'saveSafetyCopy')
      }
      const result = await importBackup(file, at)
      await markBackedUp(at).catch((err: unknown) => recordError(err, 'markBackedUp'))
      rememberImport({ items: result.items, skippedFiles: result.skippedFiles })
      await sleep(DOWNLOAD_GRACE_MS)
      window.location.reload()
    } catch (err) {
      recordError(err, 'importBackup')
      setImp({ kind: 'failed', name, file, warnings, message: messageOf(err) })
    }
  }

  async function runReset() {
    setResetBusy(true)
    setResetError(null)
    try {
      // Best effort: a person who has typed the words wants out even when the database is too broken to copy.
      await createSafetyCopy('pre-reset', Date.now(), appVersion()).catch((err: unknown) =>
        recordError(err, 'preResetSnapshot'),
      )
      await resetAllData()
      clearDevicePrefs()
      window.location.assign(href('welcome'))
    } catch (err) {
      recordError(err, 'resetAllData')
      setResetBusy(false)
      setResetError(`Couldn’t reset: ${messageOf(err)}`)
    }
  }

  const withFile =
    imp.kind === 'preview' || imp.kind === 'importing' || imp.kind === 'failed' ? imp : null
  const busyImporting = imp.kind === 'reading' || imp.kind === 'importing'

  return (
    <SettingsSection title={DATA.title}>
      <Row
        label="Export all data"
        help={
          <>
            Every task, goal, session and setting in one JSON file, with attached PDFs up to 50 MB.
            Last backup: {lastBackup}.
          </>
        }
      >
        {() => (
          <Button
            iconLeft={<Download />}
            loading={exporter.busy}
            onClick={() => void exporter.run()}
          >
            Export JSON
          </Button>
        )}
      </Row>

      <Row
        label="Import data"
        help="Replace everything on this device with a Forge backup. You’ll see what’s inside before anything changes."
      >
        {() => (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="Backup file"
              onChange={(e) => void onFileChosen(e)}
            />
            <Button
              ref={chooseButton}
              iconLeft={<FileUp />}
              loading={imp.kind === 'reading'}
              disabled={busyImporting}
              onClick={() => fileInput.current?.click()}
            >
              Choose file…
            </Button>
          </>
        )}
      </Row>
      {imp.kind === 'refused' ? (
        <div className={styles.refusal} role="alert">
          <p className={styles.refusalTitle}>Can’t import “{imp.name}”</p>
          {imp.errors.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <p className={styles.refusalHint}>Nothing was changed.</p>
        </div>
      ) : null}

      <Row
        label="Weekly backup reminder"
        help="A gentle note at most once a week, only when you have data and haven’t exported in over 7 days."
      >
        {(id) => (
          <Toggle
            aria-labelledby={id}
            checked={remindWeekly}
            onCheckedChange={(on) => void save({ backup: { remindWeekly: on } })}
          />
        )}
      </Row>

      <Row
        label="Trash"
        help="Deleted tasks, goals and courses stay in the Trash for 30 days, where you can restore them."
      >
        {() => (
          <Link to="trash" className={settingsStyles.link}>
            Open Trash
            <ArrowRight aria-hidden="true" />
          </Link>
        )}
      </Row>

      <Row
        label="Reset Forge"
        help="Erase everything on this device and start again from the welcome tour."
      >
        {() => (
          <Button
            variant="danger"
            iconLeft={<RotateCcw />}
            onClick={() => {
              setResetError(null)
              setQuery({ do: 'reset' })
            }}
          >
            Reset…
          </Button>
        )}
      </Row>
      <SaveStatusLine status={status} />

      {withFile ? (
        <ImportDialog
          open
          fileName={withFile.name}
          file={withFile.file}
          warnings={withFile.warnings}
          busy={withFile.kind === 'importing'}
          error={withFile.kind === 'failed' ? withFile.message : null}
          onCancel={() => setImp({ kind: 'idle' })}
          onConfirm={() => void runImport(withFile)}
        />
      ) : null}
      <ResetDialog
        open={resetOpen}
        busy={resetBusy}
        error={resetError}
        onCancel={() => setQuery({ do: undefined })}
        onConfirm={() => void runReset()}
      />
    </SettingsSection>
  )
}
