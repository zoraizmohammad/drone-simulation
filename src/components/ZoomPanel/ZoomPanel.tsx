import type { ReplayFrame } from '../../models/types'
import { FLOWER_CLUSTERS } from '../../data/missionGenerator'
import { getPhaseColor } from '../../app/App'

interface Props {
  frame: ReplayFrame
}

const W = 320
const H = 210

function seededRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function MiniFlower({
  cx, cy, scale, color, accentColor, rngSeed, isPollinated = false, opacity = 1,
}: {
  cx: number; cy: number; scale: number
  color: string; accentColor: string
  rngSeed: number; isPollinated?: boolean; opacity?: number
}) {
  const rng = seededRng(rngSeed)
  const petalCount = 6
  const petalW = 9 * scale
  const petalH = 16 * scale
  const pistilR = 5.5 * scale
  const stemH = 22 * scale

  return (
    <g opacity={opacity}>
      {/* Stem */}
      <line x1={cx} y1={cy + pistilR * 0.6} x2={cx} y2={cy + stemH}
        stroke="#3a7d44" strokeWidth={1.5 * scale} />
      {/* Leaves */}
      <ellipse cx={cx - 6 * scale} cy={cy + stemH * 0.55}
        rx={6 * scale} ry={2.2 * scale} fill="#3a7d44" opacity={0.7}
        transform={`rotate(-30, ${cx - 6 * scale}, ${cy + stemH * 0.55})`} />
      <ellipse cx={cx + 6 * scale} cy={cy + stemH * 0.72}
        rx={6 * scale} ry={2.2 * scale} fill="#3a7d44" opacity={0.7}
        transform={`rotate(30, ${cx + 6 * scale}, ${cy + stemH * 0.72})`} />
      {/* Petals */}
      {Array.from({ length: petalCount }, (_, i) => {
        const angle = (360 / petalCount) * i + rng() * 18 - 9
        const sizeVar = 0.8 + rng() * 0.4
        return (
          <ellipse key={i}
            cx={cx} cy={cy - petalH * 0.52}
            rx={petalW * sizeVar * 0.85}
            ry={petalH * sizeVar * 0.65}
            fill={isPollinated ? '#6b7280' : color}
            opacity={isPollinated ? 0.45 : 0.88}
            transform={`rotate(${angle}, ${cx}, ${cy})`}
          />
        )
      })}
      {/* Pistil */}
      <circle cx={cx} cy={cy} r={pistilR}
        fill={isPollinated ? '#92400e' : accentColor} opacity={0.95} />
      {isPollinated && (
        <text x={cx} y={cy + pistilR * 0.4} textAnchor="middle"
          fontSize={pistilR * 1.3} fill="#fbbf24" fontWeight="bold">✓</text>
      )}
    </g>
  )
}

// Grid of small flowers for background/scanning view
function FlowerGrid({ opacity = 1, highlightId = null }: { opacity?: number; highlightId?: string | null }) {
  const positions = [
    { x: 52, y: 72 }, { x: 130, y: 60 }, { x: 208, y: 75 }, { x: 275, y: 65 },
    { x: 80, y: 148 }, { x: 155, y: 158 }, { x: 235, y: 145 }, { x: 300, y: 155 },
  ]
  return (
    <g opacity={opacity}>
      {FLOWER_CLUSTERS.slice(0, 8).map((f, i) => {
        const pos = positions[i] || { x: 50 + i * 40, y: 100 }
        const isHighlight = highlightId === f.id
        return (
          <g key={f.id}>
            {isHighlight && (
              <circle cx={pos.x} cy={pos.y} r={28} fill={f.color} opacity={0.12} />
            )}
            <MiniFlower
              cx={pos.x} cy={pos.y} scale={0.65}
              color={f.color} accentColor={f.accentColor}
              rngSeed={parseInt(f.id.replace('f', '')) * 17}
              opacity={isHighlight ? 1 : 0.6}
            />
          </g>
        )
      })}
    </g>
  )
}

export function ZoomPanel({ frame }: Props) {
  const { mission, camera, sensor } = frame
  const phase = mission.phase
  const phaseColor = getPhaseColor(phase)
  const targetId = mission.currentTargetFlowerId
  const targetFlower = targetId ? FLOWER_CLUSTERS.find(f => f.id === targetId) ?? null : null
  const targetFrameFlower = targetId ? frame.flowers.find(f => f.id === targetId) ?? null : null
  const isPollinatedState = targetFrameFlower?.state === 'pollinated'

  // Confidence history sparkline path
  const confHistory = camera.confidenceHistory
  let sparklinePath = ''
  if (confHistory.length > 1) {
    const sw = W - 24
    const sh = 18
    const sy0 = H - 26
    const pts = confHistory.map((v, i) => {
      const x = 12 + (i / (confHistory.length - 1)) * sw
      const y = sy0 + sh - v * sh
      return `${x},${y}`
    })
    sparklinePath = `M ${pts.join(' L ')}`
  }

  // ── Determine view mode ──────────────────────────────────────────────
  const isPreFlight = ['idle', 'arming'].includes(phase)
  const isTakeoff = phase === 'takeoff'
  const isTransit = ['transit', 'resume_transit'].includes(phase)
  const isScanning = phase === 'scanning'
  const isCandidate = phase === 'candidate_detected'
  const isLocked = ['target_lock', 'descent'].includes(phase)
  const isHover = phase === 'hover_align'
  const isPollinating = phase === 'pollinating'
  const isAscent = phase === 'ascent'
  const isComplete = phase === 'mission_complete'

  const cx = W / 2
  const cy = H / 2 - 18

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%"
      style={{ display: 'block', background: '#050d18' }}>
      <defs>
        <filter id="zpGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="zpSoftGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="zpVignette" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="transparent" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.65" />
        </radialGradient>
        {/* Scan line gradient */}
        <linearGradient id="scanGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
          <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Base background */}
      <rect x={0} y={0} width={W} height={H} fill="#050d18" />

      {/* ── PRE-FLIGHT: idle / arming ── */}
      {isPreFlight && (
        <g>
          <FlowerGrid opacity={0.18} />
          <rect x={0} y={0} width={W} height={H} fill="#050d18" opacity={0.6} />
          {/* Camera off overlay */}
          <rect x={cx - 70} y={cy - 22} width={140} height={44} rx={4}
            fill="#0f1f35" stroke="#1e3a5f" strokeWidth={1} />
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={11}
            fill="#475569" fontFamily="monospace" letterSpacing="0.1em">
            CAMERA OFFLINE
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize={8}
            fill="#334155" fontFamily="monospace">
            {phase === 'arming' ? 'Pre-flight checks...' : 'Awaiting arm sequence'}
          </text>
          {/* Blinking indicator */}
          <circle cx={cx + 55} cy={cy - 10} r={3.5} fill="#ef4444">
            <animate attributeName="opacity" values="1;0.1;1" dur="1s" repeatCount="indefinite" />
          </circle>
        </g>
      )}

      {/* ── TAKEOFF ── */}
      {isTakeoff && (
        <g>
          <FlowerGrid opacity={0.25} />
          {/* Zoom-out effect lines */}
          {[0.4, 0.6, 0.8].map((r, i) => (
            <ellipse key={i} cx={cx} cy={cy + 10} rx={r * 100} ry={r * 50}
              fill="none" stroke="#22d3ee" strokeWidth={0.5}
              opacity={0.15 + i * 0.08} strokeDasharray="4,6" />
          ))}
          <rect x={cx - 70} y={cy - 18} width={140} height={36} rx={4}
            fill="#050d18" fillOpacity={0.8} stroke="#164e63" strokeWidth={1} />
          <text x={cx} y={cy - 2} textAnchor="middle" fontSize={10}
            fill="#38bdf8" fontFamily="monospace" letterSpacing="0.08em">
            CAMERA INITIALIZING
          </text>
          <text x={cx} y={cy + 13} textAnchor="middle" fontSize={8}
            fill="#64748b" fontFamily="monospace">
            Climbing to patrol altitude...
          </text>
        </g>
      )}

      {/* ── TRANSIT / RESUME TRANSIT ── */}
      {isTransit && (
        <g>
          <FlowerGrid opacity={0.55} />
          {/* Moving scan line */}
          <rect x={0} y={0} width={W} height={40} fill="url(#scanGrad)" opacity={0.6}>
            <animateTransform attributeName="transform" type="translate"
              values="0,0; 0,180" dur="1.8s" repeatCount="indefinite" />
          </rect>
          {/* Corner scan brackets */}
          {[[8,8],[W-8,8],[8,H-32],[W-8,H-32]].map(([bx,by], i) => {
            const dx = i%2===0 ? 1 : -1; const dy = i<2 ? 1 : -1
            return (
              <g key={i} stroke="#22d3ee" strokeWidth={1.5} opacity={0.4}>
                <line x1={bx} y1={by} x2={bx+dx*12} y2={by} />
                <line x1={bx} y1={by} x2={bx} y2={by+dy*12} />
              </g>
            )
          })}
          <rect x={cx - 55} y={4} width={110} height={13} rx={2}
            fill="#0c1f35" opacity={0.85} />
          <text x={cx} y={13.5} textAnchor="middle" fontSize={8}
            fill="#38bdf8" fontFamily="monospace" letterSpacing="0.07em">
            SCANNING — NO TARGET
          </text>
          <text x={cx} y={H - 38} textAnchor="middle" fontSize={7.5}
            fill="#475569" fontFamily="monospace">
            CONF: {(sensor.flowerDetectionConfidence * 100).toFixed(1)}%  ·  FLOWERS: {sensor.flowersInView}
          </text>
        </g>
      )}

      {/* ── SCANNING ── */}
      {isScanning && (
        <g>
          <FlowerGrid opacity={0.75} highlightId={targetId} />
          {/* Scan sweep */}
          <rect x={0} y={0} width={W} height={30} fill="url(#scanGrad)" opacity={0.8}>
            <animateTransform attributeName="transform" type="translate"
              values="0,-30; 0,210" dur="1.2s" repeatCount="indefinite" />
          </rect>
          {/* Detection rings growing on visible flowers */}
          {sensor.flowersInView > 0 && FLOWER_CLUSTERS.slice(0, sensor.flowersInView + 1).map((f, i) => {
            const positions = [
              { x: 52, y: 72 }, { x: 130, y: 60 }, { x: 208, y: 75 }, { x: 275, y: 65 },
              { x: 80, y: 148 }, { x: 155, y: 158 }, { x: 235, y: 145 },
            ]
            const pos = positions[i]
            if (!pos) return null
            return (
              <circle key={f.id} cx={pos.x} cy={pos.y} r={22} fill="none"
                stroke="#f59e0b" strokeWidth={1} strokeDasharray="3,4" opacity={0.5}>
                <animate attributeName="r" values="18;26;18" dur={`${1 + i * 0.3}s`} repeatCount="indefinite" />
              </circle>
            )
          })}
          <rect x={cx - 55} y={4} width={110} height={13} rx={2}
            fill="#0c1f35" opacity={0.85} />
          <text x={cx} y={13.5} textAnchor="middle" fontSize={8}
            fill="#38bdf8" fontFamily="monospace" letterSpacing="0.07em">
            ACTIVE SCAN
          </text>
          <text x={cx} y={H - 38} textAnchor="middle" fontSize={7.5}
            fill="#64748b" fontFamily="monospace">
            CONF: {(sensor.flowerDetectionConfidence * 100).toFixed(1)}%  ·  FLOWERS: {sensor.flowersInView}
          </text>
        </g>
      )}

      {/* ── CANDIDATE DETECTED ── */}
      {isCandidate && targetFlower && (
        <g>
          {/* Background: other flowers dimmed */}
          <FlowerGrid opacity={0.3} highlightId={targetId} />
          {/* Main target flower — centered, large */}
          <MiniFlower cx={cx} cy={cy} scale={1.5}
            color={targetFlower.color} accentColor={targetFlower.accentColor}
            rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23} />
          {/* Bounding box */}
          {camera.boundingBoxes.map((bb, i) => {
            const bx = bb.x * W; const by = bb.y * (H - 40)
            const bw = bb.w * W; const bh = bb.h * (H - 40)
            return (
              <g key={i}>
                <rect x={bx} y={by} width={bw} height={bh}
                  fill="none" stroke="#f97316" strokeWidth={1.5}
                  strokeDasharray="5,3" opacity={0.85} />
                {/* Confidence label */}
                <rect x={bx} y={by - 14} width={78} height={13} rx={2}
                  fill="#f97316" opacity={0.9} />
                <text x={bx + 4} y={by - 3} fontSize={8.5}
                  fill="white" fontFamily="monospace" fontWeight="bold">
                  {(bb.confidence * 100).toFixed(0)}% CANDIDATE
                </text>
              </g>
            )
          })}
          <rect x={cx - 55} y={4} width={110} height={13} rx={2}
            fill="#431407" opacity={0.9} />
          <text x={cx} y={13.5} textAnchor="middle" fontSize={8}
            fill="#f97316" fontFamily="monospace" fontWeight="bold" letterSpacing="0.07em">
            CANDIDATE DETECTED
          </text>
        </g>
      )}

      {/* ── TARGET LOCKED / DESCENT ── */}
      {isLocked && targetFlower && (
        <g>
          <FlowerGrid opacity={0.2} />
          {/* Target flower large */}
          <MiniFlower cx={cx} cy={cy} scale={1.6}
            color={targetFlower.color} accentColor={targetFlower.accentColor}
            rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23} />
          {/* Reticle */}
          <g filter="url(#zpGlow)">
            <circle cx={cx} cy={cy} r={42} fill="none"
              stroke="#22d3ee" strokeWidth={1.8} opacity={0.75} />
            <circle cx={cx} cy={cy} r={28} fill="none"
              stroke="#22d3ee" strokeWidth={0.8} opacity={0.4}
              strokeDasharray="3,6" />
            {/* Corner brackets */}
            {[[-44,-52],[22,-52],[-44,28],[22,28]].map(([ox,oy], i) => {
              const dx = i%2===0 ? 1 : -1; const dy = i<2 ? 1 : -1
              return (
                <g key={i}>
                  <line x1={cx+ox} y1={cy+oy} x2={cx+ox+dx*11} y2={cy+oy}
                    stroke="#22d3ee" strokeWidth={2.2} />
                  <line x1={cx+ox} y1={cy+oy} x2={cx+ox} y2={cy+oy+dy*11}
                    stroke="#22d3ee" strokeWidth={2.2} />
                </g>
              )
            })}
            {/* Crosshair */}
            <line x1={cx - 52} y1={cy} x2={cx + 52} y2={cy}
              stroke="#22d3ee" strokeWidth={0.8} strokeDasharray="3,6" opacity={0.45} />
            <line x1={cx} y1={cy - 62} x2={cx} y2={cy + 44}
              stroke="#22d3ee" strokeWidth={0.8} strokeDasharray="3,6" opacity={0.45} />
            {/* Center dot */}
            <circle cx={cx} cy={cy} r={3} fill="#22d3ee" opacity={0.9} />
          </g>
          {/* Lock label */}
          <rect x={cx - 52} y={4} width={104} height={13} rx={2}
            fill="#083344" opacity={0.95} stroke="#22d3ee" strokeWidth={0.5} />
          <text x={cx} y={13.5} textAnchor="middle" fontSize={8}
            fill="#22d3ee" fontFamily="monospace" fontWeight="bold" letterSpacing="0.07em">
            TARGET LOCKED — {targetFlower.id.toUpperCase()}
          </text>
          {phase === 'descent' && (
            <text x={cx} y={H - 38} textAnchor="middle" fontSize={7.5}
              fill="#38bdf8" fontFamily="monospace">
              Descending... ALT: {frame.drone.z.toFixed(1)}m
            </text>
          )}
        </g>
      )}

      {/* ── HOVER ALIGN ── */}
      {isHover && targetFlower && (
        <g>
          <FlowerGrid opacity={0.2} />
          <MiniFlower cx={cx} cy={cy} scale={1.7}
            color={targetFlower.color} accentColor={targetFlower.accentColor}
            rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23} />
          <g filter="url(#zpSoftGlow)">
            {/* Pulsing outer ring */}
            <circle cx={cx} cy={cy} r={46} fill="none"
              stroke="#22d3ee" strokeWidth={2} opacity={0.8}>
              <animate attributeName="r" values="44;50;44" dur="1s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0.4;0.8" dur="1s" repeatCount="indefinite" />
            </circle>
            {/* Corner brackets */}
            {[[-46,-56],[24,-56],[-46,30],[24,30]].map(([ox,oy], i) => {
              const dx = i%2===0 ? 1 : -1; const dy = i<2 ? 1 : -1
              return (
                <g key={i}>
                  <line x1={cx+ox} y1={cy+oy} x2={cx+ox+dx*12} y2={cy+oy}
                    stroke="#22d3ee" strokeWidth={2.5} />
                  <line x1={cx+ox} y1={cy+oy} x2={cx+ox} y2={cy+oy+dy*12}
                    stroke="#22d3ee" strokeWidth={2.5} />
                </g>
              )
            })}
            <line x1={cx-54} y1={cy} x2={cx+54} y2={cy}
              stroke="#22d3ee" strokeWidth={0.8} strokeDasharray="3,6" opacity={0.5} />
            <line x1={cx} y1={cy-64} x2={cx} y2={cy+46}
              stroke="#22d3ee" strokeWidth={0.8} strokeDasharray="3,6" opacity={0.5} />
            <circle cx={cx} cy={cy} r={3.5} fill="#22d3ee" opacity={0.95} />
          </g>
          <rect x={cx - 55} y={4} width={110} height={13} rx={2}
            fill="#083344" opacity={0.95} stroke="#22d3ee" strokeWidth={0.5} />
          <text x={cx} y={13.5} textAnchor="middle" fontSize={8}
            fill="#22d3ee" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
            HOVER ALIGN — STABILIZING
          </text>
          <text x={cx} y={H - 38} textAnchor="middle" fontSize={7.5}
            fill="#38bdf8" fontFamily="monospace">
            CONF: {(sensor.flowerDetectionConfidence * 100).toFixed(1)}%  ·  ALT: {frame.drone.z.toFixed(2)}m
          </text>
        </g>
      )}

      {/* ── POLLINATING ── */}
      {isPollinating && targetFlower && (
        <g>
          <FlowerGrid opacity={0.15} />
          <MiniFlower cx={cx} cy={cy} scale={1.7}
            color={targetFlower.color} accentColor={targetFlower.accentColor}
            rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23} />
          <g filter="url(#zpGlow)">
            {/* Pulsing rings */}
            <circle cx={cx} cy={cy} r={46} fill="none"
              stroke="#a78bfa" strokeWidth={2.5} opacity={0.85}>
              <animate attributeName="r" values="44;54;44" dur="0.55s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.85;0.3;0.85" dur="0.55s" repeatCount="indefinite" />
            </circle>
            <circle cx={cx} cy={cy} r={30} fill="none"
              stroke="#c4b5fd" strokeWidth={1.2} opacity={0.5}>
              <animate attributeName="r" values="28;36;28" dur="0.55s" begin="0.28s" repeatCount="indefinite" />
            </circle>
            {/* Crosshair */}
            <line x1={cx-52} y1={cy} x2={cx+52} y2={cy}
              stroke="#a78bfa" strokeWidth={1} strokeDasharray="3,5" opacity={0.6} />
            <line x1={cx} y1={cy-62} x2={cx} y2={cy+44}
              stroke="#a78bfa" strokeWidth={1} strokeDasharray="3,5" opacity={0.6} />
            <circle cx={cx} cy={cy} r={4} fill="#a78bfa" opacity={0.95} />
          </g>
          {/* Orbiting sparkle particles */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((ang, i) => {
            const rad = (ang + frame.time * 130) * Math.PI / 180
            const r = 58 + Math.sin(frame.time * 5 + i) * 5
            const sx = cx + Math.cos(rad) * r
            const sy = cy + Math.sin(rad) * r * 0.65
            return (
              <circle key={i} cx={sx} cy={sy} r={2.8}
                fill={i % 2 === 0 ? '#fbbf24' : '#c4b5fd'}
                opacity={0.6 + Math.sin(frame.time * 4 + i * 0.9) * 0.3} />
            )
          })}
          {/* Pollination banner */}
          <rect x={cx - 72} y={4} width={144} height={15} rx={3}
            fill="#4c1d95" opacity={0.95}>
            <animate attributeName="opacity" values="0.95;0.5;0.95" dur="0.5s" repeatCount="indefinite" />
          </rect>
          <text x={cx} y={14.5} textAnchor="middle" fontSize={9}
            fill="#c4b5fd" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
            ⚡ POLLINATION TRIGGERED
          </text>
        </g>
      )}

      {/* ── ASCENT (post-pollination) ── */}
      {isAscent && (
        <g>
          {targetFlower && isPollinatedState ? (
            <g>
              <FlowerGrid opacity={0.3} />
              <MiniFlower cx={cx} cy={cy} scale={1.5}
                color={targetFlower.color} accentColor={targetFlower.accentColor}
                rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23}
                isPollinated={true} />
              {/* Gold checkmark ring */}
              <circle cx={cx} cy={cy} r={44} fill="none"
                stroke="#22c55e" strokeWidth={1.8} opacity={0.6} strokeDasharray="6,4" />
              <rect x={cx - 50} y={4} width={100} height={13} rx={2}
                fill="#052e16" opacity={0.95} stroke="#22c55e" strokeWidth={0.5} />
              <text x={cx} y={13.5} textAnchor="middle" fontSize={8}
                fill="#22c55e" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
                POLLINATED ✓  ASCENDING
              </text>
            </g>
          ) : (
            <g>
              <FlowerGrid opacity={0.4} />
              <text x={cx} y={cy} textAnchor="middle" fontSize={9}
                fill="#38bdf8" fontFamily="monospace">ASCENDING...</text>
            </g>
          )}
        </g>
      )}

      {/* ── MISSION COMPLETE ── */}
      {isComplete && (
        <g>
          <FlowerGrid opacity={0.6} />
          {/* Glow overlay */}
          <rect x={0} y={0} width={W} height={H}
            fill="#052e16" opacity={0.45} />
          {/* All-pollinated glow */}
          <circle cx={cx} cy={cy} r={80} fill="#22c55e" opacity={0.06} />
          <rect x={cx - 75} y={cy - 28} width={150} height={54} rx={6}
            fill="#052e16" stroke="#22c55e" strokeWidth={1} opacity={0.95} />
          <text x={cx} y={cy - 10} textAnchor="middle" fontSize={13}
            fill="#22c55e" fontFamily="monospace" fontWeight="bold">MISSION COMPLETE</text>
          <text x={cx} y={cy + 8} textAnchor="middle" fontSize={8.5}
            fill="#86efac" fontFamily="monospace">
            {mission.pollinatedFlowerIds.length}/{mission.totalFlowers} flowers pollinated
          </text>
          <text x={cx} y={cy + 22} textAnchor="middle" fontSize={7.5}
            fill="#4ade80" fontFamily="monospace">
            Battery: {frame.sensor.batteryPercent.toFixed(0)}%  ·  Time: {mission.elapsedSeconds.toFixed(0)}s
          </text>
        </g>
      )}

      {/* ── Confidence bar (always visible when there's a target) ── */}
      {targetId && !isPreFlight && !isTakeoff && !isComplete && (
        <g>
          <text x={12} y={H - 46} fontSize={7} fill="#475569" fontFamily="monospace">
            DETECTION CONFIDENCE
          </text>
          <rect x={12} y={H - 42} width={W - 24} height={5} rx={2.5} fill="#0f2744" />
          <rect x={12} y={H - 42}
            width={Math.max(0, (W - 24) * sensor.flowerDetectionConfidence)} height={5}
            rx={2.5}
            fill={sensor.flowerDetectionConfidence > 0.85 ? '#22c55e'
              : sensor.flowerDetectionConfidence > 0.5 ? '#f59e0b' : '#22d3ee'} />
          <text x={W - 14} y={H - 43} textAnchor="end" fontSize={7}
            fill="#64748b" fontFamily="monospace">
            {(sensor.flowerDetectionConfidence * 100).toFixed(1)}%
          </text>
        </g>
      )}

      {/* ── Confidence sparkline ── */}
      {sparklinePath && (
        <g>
          <rect x={12} y={H - 32} width={W - 24} height={20} fill="#030712" opacity={0.6} rx={2} />
          <path d={sparklinePath} fill="none" stroke={phaseColor} strokeWidth={1.2} opacity={0.75} />
          <text x={14} y={H - 34} fontSize={6.5} fill="#334155" fontFamily="monospace">
            CONF HISTORY ▸
          </text>
        </g>
      )}

      {/* Vignette */}
      <rect x={0} y={0} width={W} height={H} fill="url(#zpVignette)" />

      {/* Phase chip — top right */}
      <rect x={W - 88} y={4} width={84} height={13} rx={2}
        fill={phaseColor + '18'} stroke={phaseColor + '55'} strokeWidth={0.5} />
      <text x={W - 46} y={13.5} textAnchor="middle" fontSize={7}
        fill={phaseColor} fontWeight="bold" letterSpacing="0.06em" fontFamily="monospace">
        {phase.replace(/_/g, ' ').toUpperCase()}
      </text>
    </svg>
  )
}
