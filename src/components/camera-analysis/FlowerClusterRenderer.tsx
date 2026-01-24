import type { FlowerRenderState } from './types'

function seededRng(seed: number) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

export function FlowerClusterRenderer({ flower, zoom = 1 }: { flower: FlowerRenderState; zoom?: number }) {
  const { cx, cy, scale, color, accentColor, rngSeed, state } = flower
  const rng = seededRng(rngSeed)
  const petalCount = 6 + (rngSeed % 2)  // 6 or 7
  const baseScale = scale * zoom
  const petalW = 10 * baseScale
  const petalH = 18 * baseScale
  const pistilR = 6 * baseScale
  const stemH = 24 * baseScale
  const isPollinated = state === 'pollinated'
  const isCandidate = state === 'candidate'
  const isLocked = state === 'locked'

  const opacity = state === 'unscanned' ? 0.65 : 0.95

  return (
    <g opacity={opacity}>
      {/* Stem */}
      <line x1={cx} y1={cy + pistilR * 0.7} x2={cx} y2={cy + stemH}
        stroke={isPollinated ? '#4a5568' : '#3a7d44'} strokeWidth={Math.max(1, 1.8 * baseScale)} />
      {/* Leaves */}
      <ellipse cx={cx - 7 * baseScale} cy={cy + stemH * 0.5}
        rx={7 * baseScale} ry={2.5 * baseScale} fill={isPollinated ? '#4a5568' : '#3a7d44'}
        opacity={0.75} transform={`rotate(-35,${cx - 7 * baseScale},${cy + stemH * 0.5})`} />
      <ellipse cx={cx + 7 * baseScale} cy={cy + stemH * 0.75}
        rx={7 * baseScale} ry={2.5 * baseScale} fill={isPollinated ? '#4a5568' : '#3a7d44'}
        opacity={0.75} transform={`rotate(35,${cx + 7 * baseScale},${cy + stemH * 0.75})`} />
      {/* Petals */}
      {Array.from({ length: petalCount }, (_, i) => {
        const angle = (360 / petalCount) * i + rng() * 20 - 10
        const sv = 0.8 + rng() * 0.4
        return (
          <ellipse key={i}
            cx={cx} cy={cy - petalH * 0.5}
            rx={petalW * sv * 0.85} ry={petalH * sv * 0.65}
            fill={isPollinated ? '#6b7280' : color}
            opacity={isPollinated ? 0.4 : 0.9}
            transform={`rotate(${angle},${cx},${cy})`}
          />
        )
      })}
      {/* Center disc */}
      <circle cx={cx} cy={cy} r={pistilR}
        fill={isPollinated ? '#d97706' : accentColor} opacity={0.97} />
      {isPollinated && (
        <>
          <circle cx={cx} cy={cy} r={pistilR * 1.5} fill="none"
            stroke="#fbbf24" strokeWidth={1.5} opacity={0.7} />
          <text x={cx} y={cy + pistilR * 0.45} textAnchor="middle"
            fontSize={pistilR * 1.5} fill="#fbbf24" fontWeight="bold">✓</text>
        </>
      )}
      {/* State rings */}
      {isCandidate && (
        <circle cx={cx} cy={cy} r={petalH * 0.85} fill="none"
          stroke="#f59e0b" strokeWidth={1.8} opacity={0.6} strokeDasharray="5,4">
          <animate attributeName="r" values={`${petalH*0.8};${petalH};${petalH*0.8}`}
            dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      {isLocked && !isPollinated && (
        <circle cx={cx} cy={cy} r={petalH * 0.85} fill="none"
          stroke="#22d3ee" strokeWidth={2} opacity={0.75}>
          <animate attributeName="opacity" values="0.75;0.35;0.75" dur="0.8s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  )
}
