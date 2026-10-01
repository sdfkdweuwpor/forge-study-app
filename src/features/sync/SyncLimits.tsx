import styles from './SyncSection.module.css'

/** The limits of §4.7.6, shorter: what a person should know before and after turning sync on. */
const LIMITS: readonly { title: string; text: string }[] = [
  {
    title: 'One item, one winner.',
    text: 'When the same item changes on two devices before they sync, the change made later (by the devices’ clocks) wins for the whole item. Edit a task’s title on the laptop and its date on the phone, both offline, and one of the two edits is lost. Notes, checklists and tags belong to their task, goal or course. Settings are one item.',
  },
  {
    title: 'Delete versus edit.',
    text: 'An item deleted on one device and edited later on another comes back. Edited first and deleted later, it stays deleted (it is still in that device’s Trash for 30 days).',
  },
  {
    title: 'XP is a log, not a counter.',
    text: 'XP from both devices adds up. The same award paid on two devices offline counts once. A task finished on one device while its completion is undone on the other can leave its XP and its checkbox disagreeing until you tick it again.',
  },
  {
    title: 'Spending isn’t checked across devices.',
    text: 'Buying rewards on two devices offline can take the balance below zero.',
  },
  {
    title: 'Rebuilt on each device, never synced.',
    text: 'Streak days, the city in My World (it grows from your synced history, so it is the same), levels, balances and readiness. Plan tasks that two devices both re-planned offline can show twice for a moment; the next sync removes the duplicate. Theme, accent and reduced motion stay on each device.',
  },
  {
    title: 'Clocks matter.',
    text: 'Keep “set time automatically” on. Forge says so when a device is more than 2 minutes off.',
  },
  {
    title: 'PDFs stay on the device they were added on.',
    text: 'Their rows sync and say where the file is.',
  },
  {
    title: 'A running timer shows on the other device when it ends.',
    text: '',
  },
  {
    title: 'Import and snapshot restore replace the data on every synced device.',
    text: 'Reset erases only this device and turns sync off.',
  },
]

/** What the free Supabase plan means for this. */
const FREE_PLAN: readonly string[] = [
  'Free projects pause after a week without use. If yours does, restore it from the Supabase dashboard and sync picks up where it left off; nothing is lost.',
  'Supabase’s built-in email sender allows only a few sign-in emails an hour. If one doesn’t arrive, wait a little before sending again. Once you’re in, you don’t need another unless you sign out.',
  'A year of studying is a few megabytes, far below the free plan’s database limit.',
  'Your data lives in your own project. Forge has no server of its own.',
  'Once you’re signed in, you can turn off “Allow new users to sign up” in your project (Authentication, Providers, Email), so strangers can’t create accounts.',
]

/** Two collapsed disclosures: "What sync can't do" and the notes on the free plan. */
export function SyncLimits() {
  return (
    <div className={styles.disclosures}>
      <details className={styles.disclosure}>
        <summary className={styles.summary}>What sync can’t do</summary>
        <ul className={styles.limits}>
          {LIMITS.map((l) => (
            <li key={l.title}>
              <strong>{l.title}</strong>
              {l.text === '' ? null : (
                <>
                  {' '}
                  <span>{l.text}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </details>
      <details className={styles.disclosure}>
        <summary className={styles.summary}>About the free plan</summary>
        <ul className={styles.limits}>
          {FREE_PLAN.map((text) => (
            <li key={text}>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
