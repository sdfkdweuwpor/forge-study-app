import { Component, type ReactNode } from 'react'
import { Button } from '@/ui'
import styles from './sound.module.css'

interface Props {
  /** What could not load, e.g. "sound settings". */
  what: string
  children: ReactNode
}

/**
 * The error state for the sound screens. Reading settings can fail (storage blocked, database
 * upgrade in another tab); the slot would then drop the section without a word, so this keeps a
 * message and a way to try again in its place.
 */
export class LoadBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className={styles.failed} role="alert">
        <p>Couldn’t load {this.props.what}.</p>
        <Button size="sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </Button>
      </div>
    )
  }
}
