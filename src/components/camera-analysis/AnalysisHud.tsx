const VW = 800
const VH = 500

function phaseColor(phase: string): string {
  switch (phase) {
    case 'idle': return '#64748b'
    case 'arming': return '#f59e0b'
    case 'takeoff': return '#3b82f6'
    case 'transit': return '#6366f1'
    case 'resume_transit': return '#6366f1'
    case 'scanning': return '#06b6d4'
    case 'candidate_detected': return '#f97316'
    case 'target_lock': return '#22d3ee'
    case 'descent': return '#f97316'
    case 'hover_align': return '#fb923c'
    case 'pollinating': return '#a78bfa'
    case 'ascent': return '#3b82f6'
    case 'mission_complete': return '#22c55e'
    default: return '#64748b'
  }
}

export function AnalysisHud({ phase, confidence, flowersInView, targetLocked, pollinationActive, confidenceHistory }: {
  phase: string
  confidence: number
  flowersInView: number
  targetLocked: boolean
  pollinationActive: boolean
  confidenceHistory: number[]
}) {
  const color = phaseColor(phase)
  const barW = VW - 28
  const hudY = VH - 72
  const confBarY = VH - 54
  const sparkY0 = VH - 40

  // Confidence sparkline path
  let sparkPath = ''
  if (confidenceHistory.length > 1) {
    const sw = barW
    const sh = 24
    const pts = confidenceHistory.map((v, i) => {
      const x = Math.max(10, Math.min(VW - 10, 14 + (i / (confidenceHistory.length - 1)) * sw))
      const y = Math.max(sparkY0 - 2, Math.min(sparkY0 + sh + 2, sparkY0 + sh - v * sh))
      return `${x},${y}`
    })
    sparkPath = `M ${pts.join(' L ')}`
  }

  return (
    <g>
      {/* HUD background strip */}
      <rect x={0} y={hudY - 4} width={VW} height={VH - (hudY - 4)} fill="#030712" opacity={0.82} />
      <line x1={0} y1={hudY - 4} x2={VW} y2={hudY - 4} stroke="#1e3a5f" strokeWidth={0.8} />

      {/* Phase chip */}
      <rect x={14} y={hudY} width={90} height={16} rx={3}
        fill={color + '22'} stroke={color + '66'} strokeWidth={0.7} />
      <text x={59} y={hudY + 10.5} textAnchor="middle" fontSize={8.5}
        fill={color} fontWeight="bold" letterSpacing="0.06em" fontFamily="monospace">
        {phase.replace(/_/g, ' ').toUpperCase()}
      </text>

      {/* FLOWERS count */}
      <text x={120} y={hudY + 11} fontSize={9} fill="#64748b" fontFamily="monospace">
        FLOWERS: {flowersInView}
      </text>

      {/* TARGET indicator */}
      <rect x={200} y={hudY + 2} width={targetLocked ? 80 : 82} height={13} rx={2}
        fill={targetLocked ? '#083344' : '#1e293b'} />
      <text x={240} y={hudY + 11} textAnchor="middle" fontSize={8.5}
        fill={targetLocked ? '#22d3ee' : '#475569'} fontFamily="monospace">
        {targetLocked ? 'TARGET: LOCKED' : 'TARGET: SEARCHING'}
      </text>

      {/* POLLINATION badge */}
      {pollinationActive && (
        <g>
          <rect x={296} y={hudY + 2} width={98} height={13} rx={2} fill="#4c1d95" />
          <text x={345} y={hudY + 11} textAnchor="middle" fontSize={8.5}
            fill="#c4b5fd" fontFamily="monospace" fontWeight="bold">POLLINATION: ACTIVE</text>
        </g>
      )}

      {/* Confidence label + bar */}
      <text x={14} y={confBarY - 2} fontSize={8} fill="#475569" fontFamily="monospace">
        DETECTION CONFIDENCE
      </text>
      <rect x={14} y={confBarY + 2} width={barW} height={6} rx={3} fill="#0f172a" stroke="#1e3a5f" strokeWidth={0.5} />
      <rect x={14} y={confBarY + 2}
        width={Math.max(0, barW * confidence)} height={6} rx={3}
        fill={confidence > 0.85 ? '#22c55e' : confidence > 0.5 ? '#f59e0b' : '#22d3ee'} />
      <text x={VW - 14} y={confBarY + 1} textAnchor="end" fontSize={8}
        fill="#64748b" fontFamily="monospace">
        {(confidence * 100).toFixed(1)}%
      </text>

      {/* Sparkline */}
      {sparkPath && (
        <g>
          <rect x={14} y={sparkY0 - 2} width={barW} height={26} fill="#030712" opacity={0.5} rx={2} />
          <path d={sparkPath} fill="none" stroke={color} strokeWidth={1.4} opacity={0.8} />
          <text x={16} y={sparkY0 - 4} fontSize={7} fill="#334155" fontFamily="monospace">CONF HISTORY</text>
        </g>
      )}
    </g>
  )
}
