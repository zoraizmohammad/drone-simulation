import { Component, type ComponentChildren } from 'preact'

interface Props {
  panelName: string
  children: ComponentChildren
}

interface State {
  hasError: boolean
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    // Keep noisy panel crashes from taking down the whole control UI.
    console.error(`[PanelErrorBoundary] ${this.props.panelName}`, error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface)',
          color: '#f59e0b',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: 'monospace',
        }}>
          {this.props.panelName} unavailable - retry mode
        </div>
      )
    }

    return this.props.children
  }
}
