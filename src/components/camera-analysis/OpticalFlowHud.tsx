const PANEL_X = 562
const PANEL_Y = 6
const PANEL_W = 232
const PANEL_H = 154

interface Props {
  vx: number
  vy: number
  quality: number
  strength: number
  precision: number
  stability: number
  sensorDistanceMm: number
  distanceInches: number
}

function row(label: string, value: string, y: number, valueColor = '#94a3b8') {
  return (
    <g key={label}>
      <text x={PANEL_X + 8} y={y} fontSize={8.5} fill="#475569" fontFamily="monospace">{label}</text>
      <text x={PANEL_X + PANEL_W - 8} y={y} textAnchor="end" fontSize={8.5}
        fill={valueColor} fontFamily="monospace" fontWeight="bold">{value}</text>
    </g>
  )
}

function stabilityColor(s: number): string {
  return s > 0.7 ? '#22d3ee' : s > 0.4 ? '#f59e0b' : '#ef4444'
}

function qualityColor(q: number): string {
  return q > 100 ? '#22c55e' : q > 50 ? '#f59e0b' : '#ef4444'
}

export function OpticalFlowHud({
  vx, vy, quality, strength, precision, stability,
  sensorDistanceMm, distanceInches,
}: Props) {
  const sc = stabilityColor(stability)
  const qc = qualityColor(quality)

  const rows = [
    { label: 'DIST',     value: `${distanceInches.toFixed(1)} in`, color: '#94a3b8' },
    { label: 'SENSOR',   value: `${sensorDistanceMm} mm`,          color: '#94a3b8' },
    { label: 'FLOW X',   value: `${vx >= 0 ? '+' : ''}${vx.toFixed(3)} m/s`, color: '#7dd3fc' },
    { label: 'FLOW Y',   value: `${vy >= 0 ? '+' : ''}${vy.toFixed(3)} m/s`, color: '#7dd3fc' },
    { label: 'QUALITY',  value: `${quality} / 255`,                color: qc },
    { label: 'STRENGTH', value: `${strength}`,                     color: '#94a3b8' },
    { label: 'PRECISION',value: `${precision}`,                    color: '#94a3b8' },
    { label: 'STABILITY',value: `${(stability * 100).toFixed(0)}%`,color: sc },
  ]

  const lineH = 17
  const startY = PANEL_Y + 22

  return (
    <g>
      {/* Panel background */}
      <rect x={PANEL_X} y={PANEL_Y} width={PANEL_W} height={PANEL_H}
        fill="#020617" fillOpacity={0.82} stroke="#1e3a5f" strokeWidth={0.8} rx={3} />

      {/* Header */}
      <text x={PANEL_X + PANEL_W / 2} y={PANEL_Y + 13} textAnchor="middle"
        fontSize={8} fill="#334155" fontFamily="monospace" letterSpacing="0.1em">
        OPTICAL FLOW SENSOR
      </text>
      <line x1={PANEL_X + 6} y1={PANEL_Y + 16} x2={PANEL_X + PANEL_W - 6} y2={PANEL_Y + 16}
        stroke="#1e3a5f" strokeWidth={0.6} />

      {/* Data rows */}
      {rows.map((r, i) => row(r.label, r.value, startY + i * lineH, r.color))}

      {/* Stability bar */}
      <rect x={PANEL_X + 8} y={PANEL_Y + PANEL_H - 14} width={PANEL_W - 16} height={5}
        rx={2} fill="#0f172a" stroke="#1e3a5f" strokeWidth={0.4} />
      <rect x={PANEL_X + 8} y={PANEL_Y + PANEL_H - 14}
        width={(PANEL_W - 16) * stability} height={5} rx={2} fill={sc} />
    </g>
  )
}
