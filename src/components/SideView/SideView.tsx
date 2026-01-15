import type { ReplayFrame } from '../../models/types'
import { getPhaseColor } from '../../app/App'

interface Props {
  frame: ReplayFrame
  altitudeHistory: Array<{ time: number; z: number }>
}

const SVG_W = 600
const SVG_H = 200
const MARGIN_L = 45
const MARGIN_R = 15
const MARGIN_T = 15
const MARGIN_B = 30

const MAX_ALT = 10
const CHART_W = SVG_W - MARGIN_L - MARGIN_R
const CHART_H = SVG_H - MARGIN_T - MARGIN_B

function altToY(alt: number): number {
  return MARGIN_T + CHART_H - (alt / MAX_ALT) * CHART_H
}

const ALT_MARKERS = [0, 2, 5, 8, 10]
const HOVER_MIN = 1.3
const HOVER_MAX = 1.8
const PATROL_ALT = 8

// Plant silhouettes at various x positions
const PLANTS = [
  { x: 0.05, h: 0.065 },
  { x: 0.12, h: 0.05 },
  { x: 0.22, h: 0.07 },
  { x: 0.33, h: 0.055 },
  { x: 0.45, h: 0.06 },
  { x: 0.55, h: 0.075 },
  { x: 0.65, h: 0.05 },
  { x: 0.75, h: 0.065 },
  { x: 0.83, h: 0.06 },
  { x: 0.92, h: 0.055 },
]

function PlantSilhouette({ xFrac, heightFrac, color }: { xFrac: number; heightFrac: number; color: string }) {
  const x = MARGIN_L + xFrac * CHART_W
  const groundY = altToY(0)
  const plantHeight = heightFrac * CHART_H
  const stemY = groundY - plantHeight
  return (
    <g opacity={0.6}>
      {/* Stem */}
      <line x1={x} y1={groundY} x2={x} y2={stemY} stroke="#2d5a2d" strokeWidth={1.5} />
      {/* Flower head */}
      <circle cx={x} cy={stemY} r={4} fill={color} opacity={0.7} />
      {/* Petals suggestion */}
      <circle cx={x - 3} cy={stemY - 1} r={2} fill={color} opacity={0.5} />
      <circle cx={x + 3} cy={stemY - 1} r={2} fill={color} opacity={0.5} />
      <circle cx={x} cy={stemY - 4} r={2} fill={color} opacity={0.5} />
    </g>
  )
}

const PLANT_COLORS = ['#c084fc', '#fbbf24', '#f9a8d4', '#86efac', '#fde047', '#7dd3fc', '#fca5a5', '#fdba74', '#a5b4fc', '#6ee7b7']

export function SideView({ frame, altitudeHistory }: Props) {
  const drone = frame.drone
  const mission = frame.mission
  const phase = mission.phase
  const phaseColor = getPhaseColor(phase)

  // Horizontal position in chart: based on drone x position in garden (0-20m → 0-1 fraction)
  const hFrac = Math.max(0, Math.min(1, drone.x / 20))
  const droneChartX = MARGIN_L + hFrac * CHART_W
  const droneChartY = altToY(drone.z)

  // Altitude trace path
  let tracePath = ''
  if (altitudeHistory.length > 1) {
    const points = altitudeHistory.map(pt => {
      const xf = MARGIN_L + (pt.time / 90) * CHART_W
      const y = altToY(pt.z)
      return `${xf},${y}`
    })
    tracePath = `M ${points.join(' L ')}`
  }

  const isDescending = phase === 'descent'
  const isAscending = phase === 'ascent'
  const isHovering = phase === 'hover_align' || phase === 'pollinating'

  return (
    <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} width="100%" height="100%" style={{ display: 'block' }}>
      <defs>
        <filter id="glowSide" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="groundGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2d4a1e" />
          <stop offset="100%" stopColor="#1a2e10" />
        </linearGradient>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1628" />
          <stop offset="100%" stopColor="#0f1f35" />
        </linearGradient>
      </defs>

      {/* Sky background */}
      <rect x={MARGIN_L} y={MARGIN_T} width={CHART_W} height={CHART_H} fill="url(#skyGrad)" />

      {/* Hover band highlight */}
      <rect
        x={MARGIN_L} y={altToY(HOVER_MAX)}
        width={CHART_W} height={altToY(HOVER_MIN) - altToY(HOVER_MAX)}
        fill="#f97316"
        opacity={isHovering ? 0.15 : 0.06}
      />
      {isHovering && (
        <rect
          x={MARGIN_L} y={altToY(HOVER_MAX)}
          width={CHART_W} height={altToY(HOVER_MIN) - altToY(HOVER_MAX)}
          fill="#f97316" opacity={0.1}
        >
          <animate attributeName="opacity" values="0.1; 0.2; 0.1" dur="1s" repeatCount="indefinite" />
        </rect>
      )}

      {/* Altitude marker lines */}
      {ALT_MARKERS.map(alt => {
        const y = altToY(alt)
        const isPatrol = alt === PATROL_ALT
        const isHoverAlt = alt === 2
        return (
          <g key={alt}>
            <line x1={MARGIN_L} y1={y} x2={SVG_W - MARGIN_R} y2={y}
              stroke={isPatrol ? '#1e3a5f' : '#162033'}
              strokeWidth={isPatrol ? 1 : 0.5}
              strokeDasharray={alt > 0 ? '3,6' : 'none'}
              opacity={0.7}
            />
            <text x={MARGIN_L - 4} y={y + 3} fontSize={8}
              fill={isPatrol ? '#38bdf8' : '#334155'} textAnchor="end">
              {alt}m
            </text>
          </g>
        )
      })}

      {/* Hover band label */}
      <text x={MARGIN_L + CHART_W - 3} y={altToY((HOVER_MIN + HOVER_MAX) / 2) + 3}
        fontSize={7} fill="#f97316" textAnchor="end" opacity={0.8}>
        ≈5ft Hover
      </text>

      {/* Altitude trace */}
      {tracePath && (
        <path d={tracePath} fill="none"
          stroke="#38bdf8" strokeWidth={1.5}
          opacity={0.4} strokeLinejoin="round"
        />
      )}

      {/* Ground layer */}
      <rect x={MARGIN_L} y={altToY(0)} width={CHART_W} height={MARGIN_B - 5}
        fill="url(#groundGrad)" />
      <line x1={MARGIN_L} y1={altToY(0)} x2={SVG_W - MARGIN_R} y2={altToY(0)}
        stroke="#4a7c59" strokeWidth={1.5} />

      {/* Plant silhouettes */}
      {PLANTS.map((p, i) => (
        <PlantSilhouette key={i} xFrac={p.x} heightFrac={p.h} color={PLANT_COLORS[i % PLANT_COLORS.length]} />
      ))}

      {/* Rangefinder beam */}
      {drone.z > 0.2 && (
        <line
          x1={droneChartX} y1={droneChartY}
          x2={droneChartX} y2={altToY(0)}
          stroke="#ef4444" strokeWidth={0.8}
          strokeDasharray="3,3"
          opacity={0.5}
        />
      )}

      {/* Phase annotation arrows */}
      {isDescending && (
        <g filter="url(#glowSide)">
          <text x={droneChartX + 10} y={droneChartY - 5} fontSize={14} fill="#f97316">↓</text>
          <text x={droneChartX + 10} y={droneChartY + 10} fontSize={7} fill="#f97316">DESC</text>
        </g>
      )}
      {isAscending && (
        <g filter="url(#glowSide)">
          <text x={droneChartX + 10} y={droneChartY - 5} fontSize={14} fill="#3b82f6">↑</text>
          <text x={droneChartX + 10} y={droneChartY + 10} fontSize={7} fill="#3b82f6">ASCENT</text>
        </g>
      )}

      {/* Drone side profile */}
      <g transform={`translate(${droneChartX}, ${droneChartY})`} filter="url(#glowSide)">
        {/* Side body */}
        <rect x={-8} y={-3} width={16} height={6} rx={2}
          fill="#0f2744" stroke={phaseColor} strokeWidth={1.2} />
        {/* Left rotor arm */}
        <line x1={-8} y1={-2} x2={-16} y2={-5} stroke="#94a3b8" strokeWidth={1.5} />
        <ellipse cx={-16} cy={-5} rx={6} ry={2} fill="#0f2744" stroke="#38bdf8" strokeWidth={1}
          opacity={0.8} />
        {/* Right rotor arm */}
        <line x1={8} y1={-2} x2={16} y2={-5} stroke="#94a3b8" strokeWidth={1.5} />
        <ellipse cx={16} cy={-5} rx={6} ry={2} fill="#0f2744" stroke="#38bdf8" strokeWidth={1}
          opacity={0.8} />
        {/* Landing gear */}
        <line x1={-5} y1={3} x2={-5} y2={7} stroke="#475569" strokeWidth={1} />
        <line x1={5} y1={3} x2={5} y2={7} stroke="#475569" strokeWidth={1} />
        <line x1={-7} y1={7} x2={7} y2={7} stroke="#475569" strokeWidth={1} />
        {/* Center dot */}
        <circle cx={0} cy={0} r={1.5} fill={phaseColor} />
      </g>

      {/* Patrol altitude marker */}
      {(() => {
        const py = altToY(PATROL_ALT)
        return (
          <g opacity={0.6}>
            <line x1={MARGIN_L} y1={py} x2={MARGIN_L + 40} y2={py}
              stroke="#1e3a5f" strokeWidth={1} strokeDasharray="2,4" />
            <text x={MARGIN_L + 42} y={py + 3} fontSize={7} fill="#1e3a5f">Patrol</text>
          </g>
        )
      })()}

      {/* Y-axis label */}
      <text
        x={8} y={MARGIN_T + CHART_H / 2}
        fontSize={8} fill="#475569"
        textAnchor="middle"
        transform={`rotate(-90, 8, ${MARGIN_T + CHART_H / 2})`}
      >
        ALTITUDE (m)
      </text>

      {/* Current altitude text */}
      <text x={MARGIN_L + 4} y={MARGIN_T + 10} fontSize={9} fill={phaseColor} fontWeight="bold">
        z={drone.z.toFixed(2)}m
      </text>

      {/* X axis label */}
      <text x={MARGIN_L + CHART_W / 2} y={SVG_H - 2} fontSize={8} fill="#334155" textAnchor="middle">
        HORIZONTAL TRAVERSE
      </text>

      {/* Border */}
      <rect x={MARGIN_L} y={MARGIN_T} width={CHART_W} height={CHART_H}
        fill="none" stroke="#1e3a5f" strokeWidth={0.8} />
    </svg>
  )
}
