import styles from './PageSkeleton.module.css'

/** Loading state while a lazy route chunk downloads. */
export function PageSkeleton() {
  return (
    <div className={styles.root} role="status" aria-label="Loading page">
      <div className={styles.title} />
      <div className={styles.line} />
      <div className={styles.line} data-short />
    </div>
  )
}
