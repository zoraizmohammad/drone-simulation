import type { ReplayFrame, FlowerCluster, LiveFrame, AgentState } from '../../models/types'
import { GARDEN_SIZE, WAYPOINTS } from '../../data/missionGenerator'
import { getPhaseColor } from '../../app/App'

interface Props {
  frame: ReplayFrame
  positionHistory: Array<{ x: number; y: number }>
  liveFrame?: LiveFrame | null
  agentState?: AgentState
}

// Map garden coords to SVG coords
const SVG_SIZE = 500
const MARGIN = 20

function gardenToSvg(gx: number, gy: number): { x: number; y: number } {
  const scale = (SVG_SIZE - MARGIN * 2) / GARDEN_SIZE
  return {
    x: MARGIN + gx * scale,
    y: MARGIN + gy * scale,
  }
}

const SCALE = (SVG_SIZE - MARGIN * 2) / GARDEN_SIZE

// Seeded random for flower offsets (deterministic)
function seededRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function FlowerClusterSVG({ cluster, frameTime }: { cluster: FlowerCluster; frameTime: number }) {
  const center = gardenToSvg(cluster.x, cluster.y)
  // Support both 'f1' and 'r1' style IDs — strip all non-digit chars
  const numId = parseInt(cluster.id.replace(/\D/g, '')) || 1
  const rng = seededRng(numId * 31)

  const flowers: Array<{ ox: number; oy: number; scale: number; rotOffset: number }> = []
  for (let i = 0; i < cluster.flowerCount; i++) {
    flowers.push({
      ox: (rng() - 0.5) * cluster.radius * SCALE * 1.8,
      oy: (rng() - 0.5) * cluster.radius * SCALE * 1.8,
      scale: 0.7 + rng() * 0.5,
      rotOffset: rng() * 360,
    })
  }

  const petalCount = 6
  const petalW = 5
  const petalH = 11
  const pistilR = 3.5

  const isDiscovered = cluster.state === 'discovered'
  const isScanned = cluster.state === 'scanned'
  const isCandidate = cluster.state === 'candidate'
  const isLocked = cluster.state === 'locked'
  const isPollinated = cluster.state === 'pollinated'

  const opacity = isPollinated ? 0.55 : (cluster.state === 'unscanned' ? 0.7 : isDiscovered ? 0.6 : 1)

  const ringRadius = 18 * (0.8 + rng() * 0.4)

  return (
    <g>
      {/* State rings */}
      {isDiscovered && (
        <circle cx={center.x} cy={center.y} r={ringRadius - 2} fill="none"
          stroke="#4ade80" strokeWidth="1" strokeDasharray="2,5" opacity={0.5}>
          <animate attributeName="opacity" values="0.3; 0.7; 0.3" dur="2s" repeatCount="indefinite" />
        </circle>
      )}
      {isScanned && (
        <circle cx={center.x} cy={center.y} r={ringRadius} fill="none"
          stroke="#38bdf8" strokeWidth="1" strokeDasharray="3,3" opacity={0.6} />
      )}
      {isCandidate && (
        <circle cx={center.x} cy={center.y} r={ringRadius + 2} fill="none"
          stroke="#fbbf24" strokeWidth="1.5" opacity={0.8}>
          <animate attributeName="r" values={`${ringRadius}; ${ringRadius + 5}; ${ringRadius}`} dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8; 0.3; 0.8" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      {isLocked && (
        <>
          <circle cx={center.x} cy={center.y} r={ringRadius + 3} fill="none"
            stroke="#22d3ee" strokeWidth="2" opacity={0.9}>
            <animate attributeName="r" values={`${ringRadius + 3}; ${ringRadius + 8}; ${ringRadius + 3}`} dur="0.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9; 0.2; 0.9" dur="0.8s" repeatCount="indefinite" />
          </circle>
          <circle cx={center.x} cy={center.y} r={ringRadius} fill="none"
            stroke="#22d3ee" strokeWidth="1.5" opacity={0.6} />
        </>
      )}
      {isPollinated && (
        <>
          {/* Golden sparkles */}
          {[0, 60, 120, 180, 240, 300].map((angle, i) => {
            const rad = (angle + frameTime * 60) * Math.PI / 180
            const sx = center.x + Math.cos(rad) * (ringRadius + 6)
            const sy = center.y + Math.sin(rad) * (ringRadius + 6)
            return (
              <circle key={i} cx={sx} cy={sy} r={1.5}
                fill="#fbbf24" opacity={0.8 + Math.sin(frameTime * 4 + i) * 0.2} />
            )
          })}
          <circle cx={center.x} cy={center.y} r={ringRadius + 2} fill="none"
            stroke="#fbbf24" strokeWidth="1" opacity={0.5} strokeDasharray="2,4" />
        </>
      )}

      {/* Flowers */}
      {flowers.map((f, fi) => {
        const fx = center.x + f.ox
        const fy = center.y + f.oy
        const s = f.scale * (isPollinated ? 0.85 : 1)

        return (
          <g key={fi} transform={`translate(${fx}, ${fy})`} opacity={opacity}>
            {/* Stem */}
            <line x1={0} y1={0} x2={0} y2={petalH * s + 4} stroke="#4a7c59" strokeWidth={1} opacity={0.7} />
            {/* Leaves */}
            <ellipse cx={-3} cy={petalH * s * 0.5} rx={3} ry={1.5} fill="#4a7c59" opacity={0.6}
              transform={`rotate(-30, -3, ${petalH * s * 0.5})`} />
            <ellipse cx={3} cy={petalH * s * 0.6} rx={3} ry={1.5} fill="#4a7c59" opacity={0.6}
              transform={`rotate(30, 3, ${petalH * s * 0.6})`} />
            {/* Petals */}
            {Array.from({ length: petalCount }, (_, pi) => {
              const angle = f.rotOffset + (360 / petalCount) * pi
              const irregScale = 0.85 + (seededRng(fi * 7 + pi * 13)() * 0.3)
              return (
                <ellipse key={pi}
                  cx={0} cy={-(petalH * s * 0.6)}
                  rx={petalW * s * irregScale * 0.8}
                  ry={petalH * s * irregScale * 0.6}
                  fill={isPollinated ? '#9ca3af' : cluster.color}
                  opacity={isPollinated ? 0.5 : 0.85}
                  transform={`rotate(${angle})`}
                />
              )
            })}
            {/* Pistil */}
            <circle cx={0} cy={0} r={pistilR * s}
              fill={isPollinated ? '#78716c' : cluster.accentColor} opacity={0.95} />
            {isPollinated && (
              <text x={0} y={2} textAnchor="middle" fontSize={5} fill="#fbbf24">✓</text>
            )}
          </g>
        )
      })}
    </g>
  )
}

function DroneTopDown({ x, y, yaw, phase, frameTime }: {
  x: number; y: number; yaw: number; phase: string; frameTime: number
}) {
  const ARM_LENGTH = 14
  const ROTOR_R = 6
  const BODY_R = 5
  const phaseColor = getPhaseColor(phase)

  return (
    <g transform={`translate(${x}, ${y}) rotate(${yaw})`}>
      {/* Camera footprint */}
      <polygon
        points={`${-12},${12} ${12},${12} ${18},${35} ${-18},${35}`}
        fill={phaseColor}
        opacity={0.08}
        stroke={phaseColor}
        strokeWidth={0.5}
        strokeOpacity={0.25}
      />

      {/* Arms */}
      {[45, 135, 225, 315].map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const ex = Math.cos(rad) * ARM_LENGTH
        const ey = Math.sin(rad) * ARM_LENGTH
        return (
          <line key={i} x1={0} y1={0} x2={ex} y2={ey}
            stroke="#94a3b8" strokeWidth={2.5} strokeLinecap="round" />
        )
      })}

      {/* Rotors */}
      {[45, 135, 225, 315].map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const rx = Math.cos(rad) * ARM_LENGTH
        const ry = Math.sin(rad) * ARM_LENGTH
        const spinAngle = (frameTime * 720 * (i % 2 === 0 ? 1 : -1)) % 360
        return (
          <g key={i} transform={`translate(${rx}, ${ry})`}>
            <circle cx={0} cy={0} r={ROTOR_R} style={{ fill: 'var(--drone-body)' }} stroke="#38bdf8" strokeWidth={1} opacity={0.8} />
            <g transform={`rotate(${spinAngle})`}>
              <ellipse cx={0} cy={0} rx={ROTOR_R * 0.85} ry={1.2} fill="#38bdf8" opacity={0.5} />
            </g>
          </g>
        )
      })}

      {/* Body hex */}
      <polygon
        points={
          Array.from({ length: 6 }, (_, i) => {
            const a = (i * 60 - 30) * Math.PI / 180
            return `${Math.cos(a) * BODY_R},${Math.sin(a) * BODY_R}`
          }).join(' ')
        }
        style={{ fill: 'var(--drone-body)' }}
        stroke={phaseColor}
        strokeWidth={1.5}
      />

      {/* Center dot */}
      <circle cx={0} cy={0} r={2} fill={phaseColor} />

      {/* Forward indicator */}
      <line x1={0} y1={0} x2={0} y2={-BODY_R - 3} stroke={phaseColor} strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
    </g>
  )
}

// ── Mode 2 ghost flower (undiscovered) ────────────────────────────────────
function GhostFlower({ x, y }: { x: number; y: number }) {
  const p = gardenToSvg(x, y)
  return (
    <g>
      <circle cx={p.x} cy={p.y} r={10} fill="none"
        stroke="#334155" strokeWidth={1} strokeDasharray="3,3" opacity={0.4} />
      <circle cx={p.x} cy={p.y} r={3} fill="#1e293b" opacity={0.5} />
    </g>
  )
}

export function TopDownView({ frame, positionHistory, liveFrame, agentState }: Props) {
  const drone = frame.drone
  const mission = frame.mission
  const droneSvg = gardenToSvg(drone.x, drone.y)
  const isLiveMode = liveFrame !== null && liveFrame !== undefined
  const lf = isLiveMode ? liveFrame : null

  return (
    <svg
      viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
      width="100%"
      height="100%"
      style={{ display: 'block' }}
    >
      <defs>
        {/* Garden texture pattern */}
        <pattern id="gardenGrid" x="0" y="0" width={SCALE} height={SCALE} patternUnits="userSpaceOnUse">
          <rect width={SCALE} height={SCALE} fill="none" stroke="#1a3a1a" strokeWidth="0.5" opacity="0.4" />
        </pattern>
        <pattern id="soilTexture" x="0" y="0" width={SCALE * 2} height={SCALE * 2} patternUnits="userSpaceOnUse">
          <rect width={SCALE * 2} height={SCALE * 2} fill="#1a2e1a" />
          <rect x={0} y={0} width={SCALE} height={SCALE * 2} fill="#1d321d" opacity="0.5" />
        </pattern>

        {/* Glow filter */}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="strongGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Drone drop shadow */}
        <filter id="droneShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#22d3ee" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* Garden background */}
      <rect x={MARGIN} y={MARGIN} width={SVG_SIZE - MARGIN * 2} height={SVG_SIZE - MARGIN * 2}
        fill="url(#soilTexture)" />
      <rect x={MARGIN} y={MARGIN} width={SVG_SIZE - MARGIN * 2} height={SVG_SIZE - MARGIN * 2}
        fill="url(#gardenGrid)" />

      {/* Garden border */}
      <rect x={MARGIN} y={MARGIN} width={SVG_SIZE - MARGIN * 2} height={SVG_SIZE - MARGIN * 2}
        fill="none" stroke="#2d4a2d" strokeWidth={1.5} />

      {/* Row markers (horizontal planting rows) */}
      {Array.from({ length: 5 }, (_, i) => {
        const gy = 4 + i * 3
        const sv = gardenToSvg(0, gy)
        return (
          <line key={i}
            x1={MARGIN} y1={sv.y}
            x2={SVG_SIZE - MARGIN} y2={sv.y}
            stroke="#2a4a2a" strokeWidth={0.8} strokeDasharray="4,8" opacity={0.5}
          />
        )
      })}

      {/* Corner labels */}
      {[
        { gx: 0, gy: 0, label: '0,0' },
        { gx: 20, gy: 0, label: '20,0' },
        { gx: 0, gy: 20, label: '0,20' },
      ].map(({ gx, gy, label }) => {
        const p = gardenToSvg(gx, gy)
        return (
          <text key={label} x={p.x + 3} y={p.y + 8} fontSize={7} fill="#2d4a2d" opacity={0.7}>{label}</text>
        )
      })}

      {/* Mode 1: Waypoint route */}
      {!isLiveMode && WAYPOINTS.length > 1 && (
        <polyline
          points={WAYPOINTS.map(wp => {
            const p = gardenToSvg(wp.x, wp.y)
            return `${p.x},${p.y}`
          }).join(' ')}
          fill="none"
          stroke="#1e3a5f"
          strokeWidth={1}
          strokeDasharray="4,6"
          opacity={0.6}
        />
      )}

      {/* Mode 1: Waypoints */}
      {!isLiveMode && WAYPOINTS.map((wp, i) => {
        const p = gardenToSvg(wp.x, wp.y)
        const isActive = i === mission.currentWaypointIndex
        const isCompleted = i < mission.currentWaypointIndex
        const color = isActive ? '#22d3ee' : (isCompleted ? '#1e3a5f' : '#334155')
        return (
          <g key={wp.id}>
            <circle cx={p.x} cy={p.y} r={isActive ? 5 : 3}
              style={isActive ? { fill: 'var(--waypoint-fill)' } : undefined} fill={isActive ? undefined : 'none'}
              stroke={color} strokeWidth={isActive ? 1.5 : 1}
              opacity={isCompleted ? 0.3 : 0.8}
            />
            {isActive && (
              <circle cx={p.x} cy={p.y} r={8}
                fill="none" stroke="#22d3ee" strokeWidth={0.8} opacity={0.4}
              />
            )}
            {i > 0 && (
              <text x={p.x + 4} y={p.y - 3} fontSize={6}
                fill={color} opacity={isCompleted ? 0.3 : 0.7}>
                WP{i}
              </text>
            )}
          </g>
        )
      })}

      {/* Mode 2: Ghost outlines for undiscovered flowers */}
      {lf && lf.flowers
        .filter(f => f.state === 'undiscovered')
        .map(f => <GhostFlower key={f.id} x={f.x} y={f.y} />)
      }

      {/* Mode 2: Lawnmower scan sweep line */}
      {lf && (lf.phase === 'scanning') && (() => {
        const sweepSvg = gardenToSvg(lf.drone.x, 0)
        const sweepTop = gardenToSvg(lf.drone.x, 0)
        const sweepBot = gardenToSvg(lf.drone.x, GARDEN_SIZE)
        return (
          <g>
            <line
              x1={sweepSvg.x} y1={sweepTop.y}
              x2={sweepSvg.x} y2={sweepBot.y}
              stroke="#06b6d4" strokeWidth={1}
              strokeDasharray="3,4" opacity={0.5}
            />
            {/* Scan pass label */}
            <rect x={sweepSvg.x + 3} y={MARGIN + 4} width={52} height={13} rx={2}
              style={{ fill: 'var(--scan-label-bg)' }} opacity={0.75} />
            <text x={sweepSvg.x + 7} y={MARGIN + 13} fontSize={8}
              fill="#06b6d4" fontWeight="bold" letterSpacing="0.06em">
              PASS {lf.scanPassIndex + 1}/4
            </text>
          </g>
        )
      })()}

      {/* Mode 2: TSP route overlay — shown live as flowers are discovered */}
      {lf && lf.tspRoute.length > 1 && (() => {
        const routeFlowers = lf.tspRoute
          .map(id => lf.flowers.find(f => f.id === id))
          .filter(Boolean) as typeof lf.flowers
        if (routeFlowers.length < 2) return null
        const pts = routeFlowers.map(f => {
          const p = gardenToSvg(f.x, f.y)
          return `${p.x},${p.y}`
        }).join(' ')
        return (
          <g>
            <polyline
              points={pts}
              fill="none"
              stroke="#818cf8"
              strokeWidth={1.5}
              strokeDasharray="5,4"
              opacity={0.6}
            />
            {/* Route order numbers */}
            {routeFlowers.map((f, idx) => {
              const p = gardenToSvg(f.x, f.y)
              return (
                <g key={f.id}>
                  <circle cx={p.x} cy={p.y - 16} r={6} fill="#1e1b4b" stroke="#818cf8" strokeWidth={1} opacity={0.85} />
                  <text x={p.x} y={p.y - 13} fontSize={7} fill="#a5b4fc"
                    textAnchor="middle" fontWeight="bold">{idx + 1}</text>
                </g>
              )
            })}
          </g>
        )
      })()}

      {/* Flower clusters — in live mode skip 'unscanned' (ghosts handle those) */}
      {(isLiveMode
        ? frame.flowers.filter(c => c.state !== 'unscanned')
        : frame.flowers
      ).map(cluster => (
        <FlowerClusterSVG key={cluster.id} cluster={cluster} frameTime={frame.time} />
      ))}

      {/* Motion trail */}
      {positionHistory.length > 1 && (
        <polyline
          points={positionHistory.map(p => {
            const s = gardenToSvg(p.x, p.y)
            return `${s.x},${s.y}`
          }).join(' ')}
          fill="none"
          stroke="#22d3ee"
          strokeWidth={1}
          strokeDasharray="none"
          opacity={0.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Agent-suggested route overlay (purple dashed, labeled "AI ROUTE") */}
      {lf && (agentState?.lastDecision?.priorityOverride?.length ?? 0) > 1 && (() => {
        const agentRoute = agentState?.lastDecision?.priorityOverride ?? []
        const routeFlowers = agentRoute
          .map(id => lf.flowers.find(f => f.id === id))
          .filter(Boolean) as typeof lf.flowers
        if (routeFlowers.length < 2) return null
        const pts = routeFlowers.map(f => {
          const p = gardenToSvg(f.x, f.y)
          return `${p.x},${p.y}`
        }).join(' ')
        const firstPt = gardenToSvg(routeFlowers[0].x, routeFlowers[0].y)
        return (
          <g opacity={0.75}>
            <polyline
              points={pts}
              fill="none"
              stroke="#a78bfa"
              strokeWidth={2}
              strokeDasharray="6,4"
            />
            {routeFlowers.map((f, idx) => {
              const p = gardenToSvg(f.x, f.y)
              return (
                <g key={f.id}>
                  <circle cx={p.x} cy={p.y - 22} r={7} fill="#1e1b4b" stroke="#a78bfa" strokeWidth={1.5} />
                  <text x={p.x} y={p.y - 19} fontSize={7} fill="#c4b5fd"
                    textAnchor="middle" fontWeight="bold">{idx + 1}</text>
                </g>
              )
            })}
            {/* Label */}
            <rect x={firstPt.x + 5} y={firstPt.y - 35} width={52} height={12} rx={2}
              fill="#1e1b4b" opacity={0.85} />
            <text x={firstPt.x + 31} y={firstPt.y - 26} fontSize={8} fill="#a78bfa"
              textAnchor="middle" fontWeight="bold" letterSpacing="0.06em">AI ROUTE</text>
          </g>
        )
      })()}

      {/* Drone */}
      <g filter="url(#droneShadow)">
        <DroneTopDown
          x={droneSvg.x}
          y={droneSvg.y}
          yaw={drone.yaw}
          phase={mission.phase}
          frameTime={frame.time}
        />
      </g>

      {/* Home base marker */}
      {(() => {
        const home = gardenToSvg(2, 2)
        return (
          <g>
            <rect x={home.x - 5} y={home.y - 5} width={10} height={10}
              style={{ fill: 'var(--home-fill)' }} stroke="#f59e0b" strokeWidth={1} />
            <text x={home.x} y={home.y + 3} fontSize={7} fill="#f59e0b" textAnchor="middle">H</text>
          </g>
        )
      })()}

      {/* Phase label overlay */}
      {!isLiveMode && (
        <>
          <rect x={MARGIN + 2} y={MARGIN + 2} width={160} height={18} rx={3}
            style={{ fill: 'var(--phase-overlay-bg)' }} opacity={0.7} />
          <text x={MARGIN + 8} y={MARGIN + 14} fontSize={9}
            fill={getPhaseColor(mission.phase)} fontWeight="bold" letterSpacing="0.08em">
            {mission.phase.replace(/_/g, ' ').toUpperCase()}
          </text>
        </>
      )}

      {/* Scale indicator */}
      <line x1={SVG_SIZE - MARGIN - 48} y1={SVG_SIZE - 10} x2={SVG_SIZE - MARGIN} y2={SVG_SIZE - 10}
        stroke="var(--section-header)" strokeWidth={1.5} />
      <text x={SVG_SIZE - MARGIN - 24} y={SVG_SIZE - 3} fontSize={7} style={{ fill: 'var(--text-muted)' }} textAnchor="middle">
        {(48 / SCALE).toFixed(1)}m
      </text>
    </svg>
  )
}
