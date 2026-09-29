import { Component, type ErrorInfo, type ReactNode } from 'react'
import { recordError } from './reportError'

interface Props {
  /** Renders the failure UI. `reset` clears the error and re-renders the children. */
  fallback: (error: Error, reset: () => void) => ReactNode
  /** When this value changes the boundary resets itself (e.g. the pathname). */
  resetKey?: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Generic error boundary; the root, per-route and per-slot boundaries differ only in their fallback. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    recordError(error, info.componentStack ?? undefined)
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset()
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    return this.state.error
      ? this.props.fallback(this.state.error, this.reset)
      : this.props.children
  }
}
