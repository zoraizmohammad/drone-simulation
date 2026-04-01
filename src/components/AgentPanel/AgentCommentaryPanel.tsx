import type { AgentState, AgentCommentaryEntry } from '../../models/types'
import type { AgentStatus } from '../../simulation/agentClient'

interface Props {
  agentState: AgentState
  agentStatus: AgentStatus
}

function statusDotColor(s: AgentStatus): string {
  switch (s) {
    case 'connected':    return '#22c55e'
    case 'connecting':   return '#f59e0b'
    case 'error':        return '#ef4444'
    case 'disconnected': return '#475569'
  }
}

function actionBadgeColor(action: string): string {
  switch (action) {
    case 'replan':           return '#a78bfa'
    case 'abort_target':     return '#ef4444'
    case 'adjust_altitude':  return '#f97316'
    case 'adjust_scan':      return '#06b6d4'
    case 'continue':
    default:                 return '#22c55e'
  }
}

function ConfidenceGauge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = value >= 0.75 ? '#22c55e' : value >= 0.55 ? '#f59e0b' : '#f97316'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 9, color: '#64748b', minWidth: 110 }}>CONFIDENCE THRESHOLD</span>
      <div style={{
        flex: 1, height: 4, background: '#0f2744', borderRadius: 2, overflow: 'hidden',
        border: '1px solid #1e3a5f',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: color,
          borderRadius: 2,
          boxShadow: `0 0 4px ${color}66`,
          transition: 'width 0.3s',
        }} />
      </div>
      <span style={{ fontSize: 9, color, fontFamily: 'monospace', minWidth: 28, textAlign: 'right' }}>
        {pct}%
      </span>
    </div>
  )
}

function CommentaryEntry({ entry, isCurrent }: { entry: AgentCommentaryEntry; isCurrent: boolean }) {
  const age = Date.now() - entry.ts
  const opacity = isCurrent ? 1 : Math.max(0.3, 1 - age / 30000)

  return (
    <div
      className={isCurrent ? 'agent-text-new' : undefined}
      style={{
        padding: '4px 0',
        borderBottom: '1px solid #0a1628',
        opacity,
        transition: 'opacity 1s',
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ fontSize: 8, color: '#334155', flexShrink: 0, fontFamily: 'monospace' }}>
          {new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
        <span style={{
          fontSize: 8, padding: '1px 5px', borderRadius: 2,
          background: '#1e3a5f', color: '#38bdf8',
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {entry.phase}
        </span>
      </div>
      <div style={{ fontSize: 10, color: isCurrent ? '#e2e8f0' : '#94a3b8', lineHeight: 1.5 }}>
        {entry.text || <span style={{ color: '#334155' }}>…</span>}
        {entry.streaming && isCurrent && (
          <span className="agent-cursor" style={{ color: '#38bdf8' }}>▋</span>
        )}
      </div>
    </div>
  )
}

export function AgentCommentaryPanel({ agentState, agentStatus }: Props) {
  const dotColor = statusDotColor(agentStatus)
  const connected = agentStatus === 'connected'
  const { lastDecision, commentary, decisionsTotal, overridesApplied, agentMs } = agentState

  const recentCommentary = [...commentary].reverse().slice(0, 5)

  return (
    <div style={{
      background: '#030712',
      borderTop: '1px solid #1e3a5f',
      padding: '6px 12px',
      fontFamily: 'monospace',
      display: 'flex',
      gap: 16,
      minHeight: 0,
      overflow: 'hidden',
    }}>
      {/* Left column: header + latest commentary */}
      <div style={{ flex: 3, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div
            className={connected ? 'agent-connected' : undefined}
            style={{
              width: 7, height: 7, borderRadius: '50%',
              background: dotColor,
              boxShadow: connected ? `0 0 6px ${dotColor}` : 'none',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 9, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            AI Mission Analyst
          </span>
          <span style={{
            fontSize: 8, padding: '1px 6px', borderRadius: 2,
            background: '#0f2744', color: '#64748b',
            border: '1px solid #1e3a5f', letterSpacing: '0.06em',
          }}>
            claude-haiku-4-5
          </span>
          <span style={{ fontSize: 8, color: dotColor, marginLeft: 'auto', letterSpacing: '0.06em' }}>
            {connected ? 'CONNECTED' : agentStatus.toUpperCase()}
          </span>
        </div>

        {/* Latest commentary */}
        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#1e3a5f transparent' }}>
          {recentCommentary.length === 0 ? (
            <div style={{ fontSize: 9, color: '#1e3a5f', padding: '4px 0' }}>
              {connected ? 'Waiting for mission commentary…' : 'Agent offline — commentary unavailable'}
            </div>
          ) : (
            recentCommentary.map((entry, i) => (
              <CommentaryEntry key={entry.id} entry={entry} isCurrent={i === 0} />
            ))
          )}
        </div>
      </div>

      {/* Right column: decision info + stats */}
      <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 5, flexShrink: 0, minWidth: 200 }}>
        {/* Last decision */}
        {lastDecision ? (
          <div style={{ padding: '5px 8px', background: '#0a1628', borderRadius: 4, border: '1px solid #1e3a5f' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 8, color: '#64748b', letterSpacing: '0.08em' }}>LAST DECISION</span>
              <span style={{
                padding: '1px 6px', borderRadius: 2, fontSize: 8, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                background: actionBadgeColor(lastDecision.action) + '22',
                color: actionBadgeColor(lastDecision.action),
                border: `1px solid ${actionBadgeColor(lastDecision.action)}44`,
              }}>
                {lastDecision.action.replace('_', ' ')}
              </span>
              <span style={{ fontSize: 8, color: '#334155', marginLeft: 'auto' }}>
                {lastDecision.decisionMs.toFixed(0)}ms
              </span>
            </div>
            <div style={{ fontSize: 9, color: '#94a3b8', lineHeight: 1.4 }}>
              {lastDecision.reasoning.slice(0, 100)}{lastDecision.reasoning.length > 100 ? '…' : ''}
            </div>
          </div>
        ) : (
          <div style={{ padding: '5px 8px', background: '#0a1628', borderRadius: 4, border: '1px solid #1e3a5f' }}>
            <span style={{ fontSize: 9, color: '#334155' }}>No decision yet</span>
          </div>
        )}

        {/* Confidence threshold gauge */}
        {lastDecision && (
          <ConfidenceGauge value={lastDecision.confidenceThreshold} />
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, fontSize: 9 }}>
          <div>
            <div style={{ color: '#64748b' }}>DECISIONS</div>
            <div style={{ color: '#38bdf8', fontWeight: 700 }}>{decisionsTotal}</div>
          </div>
          <div>
            <div style={{ color: '#64748b' }}>OVERRIDES</div>
            <div style={{ color: '#a78bfa', fontWeight: 700 }}>{overridesApplied}</div>
          </div>
          <div>
            <div style={{ color: '#64748b' }}>AVG LATENCY</div>
            <div style={{ color: '#94a3b8', fontWeight: 700 }}>{agentMs.toFixed(0)}ms</div>
          </div>
        </div>
      </div>
    </div>
  )
}
