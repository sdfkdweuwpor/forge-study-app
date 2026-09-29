import { useState } from 'react'
import { Slot } from '@/app/registry'
import { useTheme } from '@/app/providers/ThemeProvider'
import { exportAllData } from '@/app/exportData'
import { useSettings } from '@/db/hooks/useSettings'
import type { Settings } from '@/db/types'
import styles from './SettingsPage.module.css'

type Theme = Settings['appearance']['theme']

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** Phase 1: theme select and a raw data export. Phase 10 replaces this with the full settings page. */
export default function SettingsPage() {
  const settings = useSettings()
  const theme = useTheme()
  const [message, setMessage] = useState('')
  const [themeMessage, setThemeMessage] = useState('')

  async function changeTheme(value: Theme) {
    const saved = await theme.setTheme(value)
    setThemeMessage(
      saved ? '' : 'Could not save this to the database, so the theme applies on this device only.',
    )
  }

  async function exportData() {
    setMessage('Exporting…')
    try {
      const r = await exportAllData()
      setMessage(`Saved ${r.filename} (${r.rows} records).`)
    } catch (e) {
      setMessage(`Export failed${e instanceof Error ? `: ${e.message}` : '.'}`)
    }
  }

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Settings</h1>

      <section className={styles.section} aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className={styles.heading}>
          Appearance
        </h2>
        {settings === undefined ? (
          <div className={styles.skeleton} role="status" aria-label="Loading settings" />
        ) : (
          <div className={styles.field}>
            <div className={styles.fieldText}>
              <label htmlFor="theme-select" className={styles.label}>
                Theme
              </label>
              <p className={styles.help}>System follows your device’s light or dark setting.</p>
            </div>
            <select
              id="theme-select"
              className={styles.select}
              value={theme.theme}
              onChange={(e) => void changeTheme(e.target.value as Theme)}
            >
              {THEMES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className={styles.status} role="status">
          {themeMessage}
        </p>
      </section>

      <section className={styles.section} aria-labelledby="data-heading">
        <h2 id="data-heading" className={styles.heading}>
          Data
        </h2>
        <div className={styles.field}>
          <div className={styles.fieldText}>
            <span className={styles.label}>Export my data</span>
            <p className={styles.help}>
              Download everything stored on this device as one JSON file.
            </p>
          </div>
          <button type="button" className={styles.button} onClick={() => void exportData()}>
            Export
          </button>
        </div>
        <p className={styles.status} role="status">
          {message}
        </p>
      </section>

      <Slot id="settings.sections" />
    </div>
  )
}
