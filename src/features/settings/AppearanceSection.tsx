import { useState } from 'react'
import { useTheme } from '@/app/providers/ThemeProvider'
import { useSettings } from '@/db/hooks/useSettings'
import type { AccentId, ReducedMotionPref, Settings } from '@/db/types'
import { Button } from '@/ui/Button'
import { ProgressBar } from '@/ui/ProgressBar'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Toggle } from '@/ui/Toggle'
import styles from './Appearance.module.css'
import { Row } from './Row'
import { SaveStatusLine } from './SaveStatusLine'
import { APPEARANCE } from './sections'
import { SectionLoading, SettingsSection } from './SettingsSection'
import { useSaveSettings } from './useSaveSettings'
import shared from './settings.module.css'

type Theme = Settings['appearance']['theme']

const THEMES: readonly { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export const ACCENTS: readonly { id: AccentId; label: string }[] = [
  { id: 'blue', label: 'Blue' },
  { id: 'teal', label: 'Teal' },
  { id: 'green', label: 'Green' },
  { id: 'orange', label: 'Orange' },
  { id: 'pink', label: 'Pink' },
  { id: 'graphite', label: 'Graphite' },
]

const MOTION: readonly { value: ReducedMotionPref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

/** Theme, accent colour (with a preview) and reduced motion. Every change applies at once. */
export function AppearanceSection() {
  const settings = useSettings()
  const theme = useTheme()
  const { save, status } = useSaveSettings()
  const [themeMessage, setThemeMessage] = useState('')
  /** The swatch under the pointer or focus, shown in the preview before it is chosen. */
  const [peek, setPeek] = useState<AccentId | null>(null)

  if (settings === undefined) return <SectionLoading title={APPEARANCE.title} rows={3} />
  const { accent, reducedMotion } = settings.appearance

  async function changeTheme(value: Theme) {
    const saved = await theme.setTheme(value)
    setThemeMessage(
      saved ? '' : 'Could not save this to the database, so the theme applies on this device only.',
    )
  }

  return (
    <SettingsSection title={APPEARANCE.title}>
      <Row
        label={<label htmlFor="theme-select">Theme</label>}
        help="System follows your device’s light or dark setting."
      >
        {() => (
          <select
            id="theme-select"
            className={shared.select}
            value={theme.theme}
            onChange={(e) => void changeTheme(e.target.value as Theme)}
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        )}
      </Row>

      <Row label="Accent colour" help="Buttons, focus rings, progress and highlights.">
        {(labelId) => (
          <div className={styles.swatches} role="radiogroup" aria-labelledby={labelId}>
            {ACCENTS.map((a) => (
              <label key={a.id} className={styles.swatch} title={a.label}>
                <input
                  type="radio"
                  name="accent"
                  className="sr-only"
                  value={a.id}
                  checked={accent === a.id}
                  onChange={() => void save({ appearance: { accent: a.id } })}
                  onFocus={() => setPeek(a.id)}
                  onBlur={() => setPeek(null)}
                />
                <span
                  className={styles.ring}
                  onPointerEnter={() => setPeek(a.id)}
                  onPointerLeave={() => setPeek(null)}
                >
                  {/* Themed on its own, so the dot is the real accent token without a hex value here. */}
                  <span
                    className={styles.dot}
                    data-theme={theme.resolvedTheme}
                    data-accent={a.id}
                    aria-hidden="true"
                  />
                </span>
                <span className="sr-only">{a.label}</span>
              </label>
            ))}
          </div>
        )}
      </Row>

      <div
        className={styles.preview}
        data-theme={theme.resolvedTheme}
        data-accent={peek ?? accent}
        aria-hidden="true"
        inert
      >
        <Button variant="primary" size="sm">
          Start focus
        </Button>
        <Toggle size="md" checked aria-label="Sample switch" />
        <div className={styles.previewBar}>
          <ProgressBar value={62} label="Sample progress" />
        </div>
        <span className={styles.previewText}>C182 · 3 of 5 units</span>
      </div>

      <Row
        label="Reduced motion"
        help="System follows your device. On turns off movement and fades here."
      >
        {() => (
          <SegmentedControl<ReducedMotionPref>
            label="Reduced motion"
            size="sm"
            options={MOTION}
            value={reducedMotion}
            onValueChange={(v) => void save({ appearance: { reducedMotion: v } })}
          />
        )}
      </Row>

      <SaveStatusLine status={themeMessage ? { tone: 'error', text: themeMessage } : status} />
    </SettingsSection>
  )
}
