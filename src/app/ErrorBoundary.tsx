import { Component, type ErrorInfo, type ReactNode } from 'react'
import { recordError, toError } from './reportError'

interface Props {
  /** Renders the failure UI. `reset` clears the error and re-renders the children. */
  fallback: (error: Error, reset: () => void) => ReactNode
  /** When this value changes the boundary resets itself (e.g. the pathname). */
  resetKey?: string
  children: ReactNode
}

type State = { hasError: false } | { hasError: true; error: Error }

/**
 * Generic error boundary; the root, per-route and per-slot boundaries differ only in their fallback.
 * `hasError` is the source of truth, because anything can be thrown (`throw null`, a string) and a
 * missing error object must still show the fallback instead of re-rendering the failing children.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(thrown: unknown): State {
    return { hasError: true, error: toError(thrown) }
  }

  override componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    recordError(thrown, info.componentStack ?? undefined)
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) this.reset()
  }

  reset = (): void => {
    this.setState({ hasError: false })
  }

  override render(): ReactNode {
    return this.state.hasError
      ? this.props.fallback(this.state.error, this.reset)
      : this.props.children
  }
}
