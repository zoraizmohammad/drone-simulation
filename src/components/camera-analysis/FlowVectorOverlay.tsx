const VW = 800
const VH = 500

// Origin of flow arrows — scene center
const CX = VW / 2
const CY = VH / 2

const SCALE = 60  // pixels per unit velocity

function arrowHead(x1: number, y1: number, x2: number, y2: number, size = 6): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1) return ''
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny =  ux
  const bx = x2 - ux * size
  const by = y2 - uy * size
  return `M ${x2} ${y2} L ${bx + nx * size * 0.4} ${by + ny * size * 0.4} L ${bx - nx * size * 0.4} ${by - ny * size * 0.4} Z`
}

interface Props {
  vx: number
  vy: number
  quality: number
  stability: number
  time: number
}

export function FlowVectorOverlay({ vx, vy, quality, stability, time }: Props) {
  const mag = Math.sqrt(vx * vx + vy * vy)

  // Only draw vectors when there is meaningful motion signal
  if (mag < 0.01 && quality < 30) return null

  // Arrow colour: cyan = stable, amber = degraded, red = very low quality
  const color = quality > 100 ? '#22d3ee'
              : quality > 50  ? '#f59e0b'
              : '#ef4444'

  const alpha = Math.min(0.85, 0.3 + stability * 0.55)

  // Primary velocity arrow
  const ex = CX + vx * SCALE
  const ey = CY + vy * SCALE

  // Secondary cross-axis indicator (1/3 magnitude, perpendicular)
  const crossX = CX + (-vy) * SCALE * 0.33
  const crossY = CY + ( vx) * SCALE * 0.33

  // Subtle animated offset based on time (deterministic shimmer)
  const shimmer = Math.sin(time * 6) * 0.5

  return (
    <g opacity={alpha} style={{ mixBlendMode: 'screen' }}>
      {/* Flow field grid — faint background lines */}
      {[-2, -1, 0, 1, 2].map(row =>
        [-3, -2, -1, 0, 1, 2, 3].map(col => {
          const gx = CX + col * 100
          const gy = CY + row * 80
          const gex = gx + vx * 18 + shimmer
          const gey = gy + vy * 18
          const len = Math.sqrt((gex - gx) ** 2 + (gey - gy) ** 2)
          if (len < 1) return null
          return (
            <line key={`gv-${row}-${col}`}
              x1={gx} y1={gy} x2={gex} y2={gey}
              stroke={color} strokeWidth={0.6} opacity={0.18} />
          )
        })
      )}

      {/* Cross-axis indicator */}
      {mag > 0.05 && (
        <line x1={CX} y1={CY} x2={crossX} y2={crossY}
          stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
      )}

      {/* Primary flow arrow — shaft */}
      <line x1={CX} y1={CY} x2={ex} y2={ey}
        stroke={color} strokeWidth={2.2} strokeLinecap="round" />

      {/* Arrowhead */}
      <path d={arrowHead(CX, CY, ex, ey, 8)}
        fill={color} />

      {/* Origin dot */}
      <circle cx={CX} cy={CY} r={4} fill={color} opacity={0.7} />

      {/* Velocity magnitude label */}
      <text x={CX + 8} y={CY - 10} fontSize={9} fill={color} fontFamily="monospace"
        opacity={0.8}>
        {`Δ${mag.toFixed(2)} m/s`}
      </text>
    </g>
  )
}
