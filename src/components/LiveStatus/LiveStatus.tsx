import type { WsStatus } from '../../simulation/wsClient'

interface Props {
  wsStatus: WsStatus
  inferenceMode: 'onnx' | 'mock' | null
  inferenceMs: number
  onRestart: () => void
  onExit: () => void
  onToggleTerminal: () => void
  terminalOpen: boolean
}

function statusColor(s: WsStatus): string {
  switch (s) {
    case 'connected':    return '#22c55e'
    case 'connecting':   return '#f59e0b'
    case 'error':        return '#ef4444'
    case 'disconnected': return '#475569'
  }
}

function statusLabel(s: WsStatus): string {
  switch (s) {
    case 'connected':    return 'CONNECTED'
    case 'connecting':   return 'CONNECTING…'
    case 'error':        return 'ERROR'
    case 'disconnected': return 'OFFLINE'
  }
}

export function LiveStatus({ wsStatus, inferenceMode, inferenceMs, onRestart, onExit, onToggleTerminal, terminalOpen }: Props) {
  const sc = statusColor(wsStatus)
  const connected = wsStatus === 'connected'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: 'monospace', fontSize: 10,
    }}>
      {/* WS status dot + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', borderRadius: 4,
        background: sc + '18', border: `1px solid ${sc}44`,
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: sc,
          boxShadow: connected ? `0 0 6px ${sc}` : 'none',
        }} />
        <span style={{ color: sc, fontWeight: 700, letterSpacing: '0.08em' }}>
          {statusLabel(wsStatus)}
        </span>
      </div>

      {/* Inference mode chip */}
      {inferenceMode && (
        <div style={{
          padding: '3px 9px', borderRadius: 4, fontSize: 9, fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          background: inferenceMode === 'onnx' ? '#7c3aed22' : '#0e7490',
          color: inferenceMode === 'onnx' ? '#a78bfa' : '#67e8f9',
          border: `1px solid ${inferenceMode === 'onnx' ? '#a78bfa44' : '#22d3ee44'}`,
        }}>
          {inferenceMode === 'onnx' ? 'ONNX' : 'MOCK'} · {inferenceMs.toFixed(0)}ms
        </div>
      )}

      {/* Terminal toggle */}
      <button onClick={onToggleTerminal} style={{
        padding: '3px 9px', borderRadius: 4,
        background: terminalOpen ? '#0e2038' : 'transparent',
        border: `1px solid ${terminalOpen ? '#38bdf8' : '#334155'}`,
        color: terminalOpen ? '#38bdf8' : '#475569',
        fontSize: 10, cursor: 'pointer',
        fontFamily: 'monospace', letterSpacing: '0.06em',
        transition: 'all 0.15s',
      }}>
        &gt;_ TERMINAL
      </button>

      {/* Restart */}
      <button onClick={onRestart} style={{
        padding: '3px 9px', borderRadius: 4,
        background: '#1e3a5f', border: '1px solid #334155',
        color: '#94a3b8', fontSize: 10, cursor: 'pointer',
        fontFamily: 'monospace', letterSpacing: '0.06em',
      }}>
        ↺ RESTART
      </button>

      {/* Exit to mode selector */}
      <button onClick={onExit} style={{
        padding: '3px 9px', borderRadius: 4,
        background: '#1e1a2e', border: '1px solid #334155',
        color: '#64748b', fontSize: 10, cursor: 'pointer',
        fontFamily: 'monospace', letterSpacing: '0.06em',
      }}>
        ✕ EXIT
      </button>
    </div>
  )
}
