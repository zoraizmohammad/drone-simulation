import type { ReplayFrame, FlowerCluster } from '../../models/types'
import { FLOWER_CLUSTERS } from '../../data/missionGenerator'
import { getPhaseColor } from '../../app/App'

interface Props {
  frame: ReplayFrame
}

const PANEL_W = 300
const PANEL_H = 200

// Seeded rng
function seededRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function MiniFlower({ cx, cy, scale, color, accentColor, rngSeed, isPollinated }: {
  cx: number; cy: number; scale: number;
  color: string; accentColor: string;
  rngSeed: number;
  isPollinated?: boolean;
}) {
  const rng = seededRng(rngSeed)
  const petalCount = 6
  const petalW = 8 * scale
  const petalH = 14 * scale
  const pistilR = 5 * scale

  return (
    <g>
      {/* Stem */}
      <line x1={cx} y1={cy} x2={cx} y2={cy + 20 * scale} stroke="#2d5a2d" strokeWidth={1.5} opacity={0.6} />
      {/* Leaves */}
      <ellipse cx={cx - 4 * scale} cy={cy + 12 * scale} rx={5 * scale} ry={2 * scale}
        fill="#2d5a2d" opacity={0.5} transform={`rotate(-25, ${cx - 4 * scale}, ${cy + 12 * scale})`} />
      <ellipse cx={cx + 4 * scale} cy={cy + 15 * scale} rx={5 * scale} ry={2 * scale}
        fill="#2d5a2d" opacity={0.5} transform={`rotate(25, ${cx + 4 * scale}, ${cy + 15 * scale})`} />
      {/* Petals */}
      {Array.from({ length: petalCount }, (_, i) => {
        const angle = (360 / petalCount) * i + rng() * 15
        const iScale = 0.8 + rng() * 0.4
        return (
          <ellipse key={i}
            cx={cx} cy={cy - petalH * 0.55}
            rx={petalW * iScale * 0.8}
            ry={petalH * iScale * 0.6}
            fill={isPollinated ? '#6b7280' : color}
            opacity={isPollinated ? 0.5 : 0.9}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
          />
        )
      })}
      {/* Pistil */}
      <circle cx={cx} cy={cy} r={pistilR}
        fill={isPollinated ? '#78716c' : accentColor} opacity={0.95} />
      {isPollinated && (
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize={7 * scale} fill="#fbbf24">✓</text>
      )}
    </g>
  )
}

export function ZoomPanel({ frame }: Props) {
  const { mission, camera, sensor } = frame
  const phase = mission.phase
  const phaseColor = getPhaseColor(phase)

  const isScanning = phase === 'scanning'
  const isCandidate = phase === 'candidate_detected'
  const isLocked = phase === 'target_lock' || phase === 'descent' || phase === 'hover_align'
  const isPollinating = phase === 'pollinating'
  const isPollinated = frame.flowers.some(
    f => f.id === mission.currentTargetFlowerId && f.state === 'pollinated'
  )

  // Find target flower
  const targetFlower = mission.currentTargetFlowerId
    ? FLOWER_CLUSTERS.find(f => f.id === mission.currentTargetFlowerId)
    : null

  const flowerState = targetFlower
    ? frame.flowers.find(f => f.id === targetFlower.id)
    : null

  // Confidence history sparkline
  const confHistory = camera.confidenceHistory
  let sparklinePath = ''
  if (confHistory.length > 1) {
    const sparkW = PANEL_W - 20
    const sparkH = 20
    const sparkY0 = PANEL_H - 28
    const points = confHistory.map((v, i) => {
      const x = 10 + (i / (confHistory.length - 1)) * sparkW
      const y = sparkY0 + sparkH - v * sparkH
      return `${x},${y}`
    })
    sparklinePath = `M ${points.join(' L ')}`
  }

  const pulseAnim = isPollinating ? (
    <animate attributeName="r" values="35; 50; 35" dur="0.6s" repeatCount="indefinite" />
  ) : null

  return (
    <svg viewBox={`0 0 ${PANEL_W} ${PANEL_H}`} width="100%" height="100%" style={{ display: 'block', background: '#050d18' }}>
      <defs>
        <filter id="zoomGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="vignette" cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="transparent" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.6" />
        </radialGradient>
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={PANEL_W} height={PANEL_H} fill="#050d18" />

      {/* Scanning state - show grid of flowers */}
      {(isScanning || (!targetFlower)) && (
        <g opacity={0.5}>
          <text x={PANEL_W / 2} y={PANEL_H / 2 - 10} textAnchor="middle" fontSize={10}
            fill="#38bdf8" letterSpacing="0.08em">
            {isScanning ? 'SCANNING AREA...' : 'AWAITING TARGET'}
          </text>
          <text x={PANEL_W / 2} y={PANEL_H / 2 + 5} textAnchor="middle" fontSize={8}
            fill="#334155">
            {isScanning ? `Confidence: ${(sensor.flowerDetectionConfidence * 100).toFixed(0)}%` : ''}
          </text>
          {/* Scan line */}
          {isScanning && (
            <line x1={0} y1={PANEL_H / 2 - 30} x2={PANEL_W} y2={PANEL_H / 2 - 30}
              stroke="#22d3ee" strokeWidth={0.5} opacity={0.3}
              strokeDasharray="4,8">
              <animateTransform attributeName="transform" type="translate"
                values={`0,0; 0,60`} dur="1s" repeatCount="indefinite" />
            </line>
          )}
          {/* Mini flowers in scanning view */}
          {FLOWER_CLUSTERS.slice(0, 6).map((f, i) => {
            const gx = 30 + (i % 3) * 85 + 20
            const gy = 50 + Math.floor(i / 3) * 70 + 10
            return (
              <MiniFlower key={f.id} cx={gx} cy={gy} scale={0.5}
                color={f.color} accentColor={f.accentColor}
                rngSeed={parseInt(f.id.replace('f', '')) * 17}
              />
            )
          })}
        </g>
      )}

      {/* Target flower view */}
      {targetFlower && (isCandidate || isLocked || isPollinating || isPollinated) && (
        <g>
          {/* Main flower - centered and large */}
          <MiniFlower
            cx={PANEL_W / 2}
            cy={PANEL_H / 2 - 10}
            scale={1.4}
            color={targetFlower.color}
            accentColor={targetFlower.accentColor}
            rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23}
            isPollinated={isPollinated}
          />

          {/* Candidate bounding box */}
          {isCandidate && camera.boundingBoxes.length > 0 && (
            <g>
              {camera.boundingBoxes.map((bb, i) => {
                const bx = bb.x * PANEL_W
                const by = bb.y * PANEL_H
                const bw = bb.w * PANEL_W
                const bh = bb.h * PANEL_H
                return (
                  <g key={i}>
                    <rect x={bx} y={by} width={bw} height={bh}
                      fill="none" stroke="#f97316" strokeWidth={1.5}
                      strokeDasharray="4,2" opacity={0.8} />
                    <rect x={bx} y={by - 12} width={60} height={12} fill="#f97316" opacity={0.85} />
                    <text x={bx + 3} y={by - 2} fontSize={8} fill="white" fontFamily="monospace" fontWeight="bold">
                      {(bb.confidence * 100).toFixed(0)}% CANDIDATE
                    </text>
                  </g>
                )
              })}
            </g>
          )}

          {/* Locked bounding box + crosshair */}
          {(isLocked || isPollinating) && (
            <g filter="url(#zoomGlow)">
              {/* Outer lock ring */}
              <circle cx={PANEL_W / 2} cy={PANEL_H / 2 - 10} r={40}
                fill="none" stroke={isPollinating ? '#a78bfa' : '#22d3ee'}
                strokeWidth={1.5} opacity={0.7}>
                {isPollinating && (
                  <animate attributeName="r" values="40; 50; 40" dur="0.6s" repeatCount="indefinite" />
                )}
              </circle>

              {/* Corner brackets */}
              {[
                [-40, -50], [20, -50], [-40, 30], [20, 30]
              ].map(([bx, by], ci) => {
                const lx = PANEL_W / 2 + bx
                const ly = PANEL_H / 2 - 10 + by
                const dx = ci % 2 === 0 ? 1 : -1
                const dy = ci < 2 ? 1 : -1
                return (
                  <g key={ci}>
                    <line x1={lx} y1={ly} x2={lx + dx * 10} y2={ly}
                      stroke="#22d3ee" strokeWidth={2} />
                    <line x1={lx} y1={ly} x2={lx} y2={ly + dy * 10}
                      stroke="#22d3ee" strokeWidth={2} />
                  </g>
                )
              })}

              {/* Crosshair */}
              <line x1={PANEL_W / 2 - 50} y1={PANEL_H / 2 - 10}
                x2={PANEL_W / 2 + 50} y2={PANEL_H / 2 - 10}
                stroke={isPollinating ? '#a78bfa' : '#22d3ee'} strokeWidth={0.8} opacity={0.5}
                strokeDasharray="3,5"
              />
              <line x1={PANEL_W / 2} y1={PANEL_H / 2 - 60}
                x2={PANEL_W / 2} y2={PANEL_H / 2 + 40}
                stroke={isPollinating ? '#a78bfa' : '#22d3ee'} strokeWidth={0.8} opacity={0.5}
                strokeDasharray="3,5"
              />

              {/* Target label */}
              {!isPollinating && (
                <g>
                  <rect x={PANEL_W / 2 - 45} y={PANEL_H / 2 - 68} width={90} height={13} rx={2}
                    fill="#22d3ee" opacity={0.9} />
                  <text x={PANEL_W / 2} y={PANEL_H / 2 - 58} textAnchor="middle"
                    fontSize={8} fill="#030712" fontWeight="bold" fontFamily="monospace">
                    TARGET LOCKED — {targetFlower.id}
                  </text>
                </g>
              )}

              {/* Pollinating overlay */}
              {isPollinating && (
                <g>
                  <rect x={PANEL_W / 2 - 65} y={10} width={130} height={16} rx={3}
                    fill="#a78bfa" opacity={0.9}>
                    <animate attributeName="opacity" values="0.9; 0.4; 0.9" dur="0.5s" repeatCount="indefinite" />
                  </rect>
                  <text x={PANEL_W / 2} y={21} textAnchor="middle"
                    fontSize={9} fill="white" fontWeight="bold" fontFamily="monospace">
                    POLLINATION TRIGGERED
                  </text>
                  {/* Sparkle particles */}
                  {[0, 45, 90, 135, 180, 225, 270, 315].map((ang, i) => {
                    const rad = (ang + frame.time * 120) * Math.PI / 180
                    const r = 55 + Math.sin(frame.time * 4 + i) * 5
                    const sx = PANEL_W / 2 + Math.cos(rad) * r
                    const sy = PANEL_H / 2 - 10 + Math.sin(rad) * r
                    return (
                      <circle key={i} cx={sx} cy={sy} r={2.5}
                        fill="#fbbf24" opacity={0.7 + Math.sin(frame.time * 3 + i * 0.8) * 0.3} />
                    )
                  })}
                </g>
              )}
            </g>
          )}

          {/* Confidence bar */}
          <g>
            <rect x={10} y={PANEL_H - 46} width={PANEL_W - 20} height={6}
              rx={3} fill="#0f2744" />
            <rect x={10} y={PANEL_H - 46}
              width={(PANEL_W - 20) * sensor.flowerDetectionConfidence} height={6}
              rx={3}
              fill={sensor.flowerDetectionConfidence > 0.9 ? '#22c55e'
                : sensor.flowerDetectionConfidence > 0.5 ? '#f59e0b' : '#22d3ee'}
              style={{ transition: 'width 0.1s linear' }}
            />
            <text x={10} y={PANEL_H - 50} fontSize={7} fill="#64748b" fontFamily="monospace">
              CONF: {(sensor.flowerDetectionConfidence * 100).toFixed(1)}%
            </text>
          </g>
        </g>
      )}

      {/* Pollinated state */}
      {isPollinated && mission.currentTargetFlowerId && (
        <g>
          <rect x={PANEL_W / 2 - 50} y={10} width={100} height={16} rx={3} fill="#22c55e" opacity={0.9} />
          <text x={PANEL_W / 2} y={21} textAnchor="middle" fontSize={9}
            fill="white" fontWeight="bold" fontFamily="monospace">
            POLLINATED ✓
          </text>
        </g>
      )}

      {/* Confidence sparkline */}
      {sparklinePath && (
        <g>
          <rect x={10} y={PANEL_H - 30} width={PANEL_W - 20} height={20}
            fill="#030712" opacity={0.5} rx={2} />
          <path d={sparklinePath} fill="none"
            stroke={phaseColor} strokeWidth={1} opacity={0.7} />
          <text x={12} y={PANEL_H - 32} fontSize={7} fill="#334155" fontFamily="monospace">
            CONF HISTORY
          </text>
        </g>
      )}

      {/* Vignette */}
      <rect x={0} y={0} width={PANEL_W} height={PANEL_H} fill="url(#vignette)" />

      {/* Phase indicator - top right */}
      <rect x={PANEL_W - 80} y={4} width={76} height={13} rx={2}
        fill={phaseColor + '22'} />
      <text x={PANEL_W - 42} y={13} textAnchor="middle" fontSize={7}
        fill={phaseColor} fontWeight="bold" letterSpacing="0.06em" fontFamily="monospace">
        {phase.replace(/_/g, ' ').toUpperCase()}
      </text>
    </svg>
  )
}
