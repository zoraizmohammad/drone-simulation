import type { ReplayFrame } from '../../models/types'
import { FLOWER_CLUSTERS } from '../../data/missionGenerator'
import { getPhaseColor } from '../../app/App'

interface Props {
  frame: ReplayFrame
}

const W = 500
const H = 500

const clamp = (v: number, lo = 20, hi = 480) => Math.max(lo, Math.min(hi, v))

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

  const scx = clamp(cx)
  const scy = clamp(cy, 30, 470)

  return (
    <g opacity={opacity}>
      <line x1={scx} y1={scy + pistilR * 0.6} x2={scx} y2={scy + stemH}
        stroke="#3a7d44" strokeWidth={Math.max(1, 1.5 * scale)} />
      <ellipse cx={scx - 6 * scale} cy={scy + stemH * 0.55}
        rx={6 * scale} ry={2.2 * scale} fill="#3a7d44" opacity={0.7}
        transform={`rotate(-30,${scx - 6 * scale},${scy + stemH * 0.55})`} />
      <ellipse cx={scx + 6 * scale} cy={scy + stemH * 0.72}
        rx={6 * scale} ry={2.2 * scale} fill="#3a7d44" opacity={0.7}
        transform={`rotate(30,${scx + 6 * scale},${scy + stemH * 0.72})`} />
      {Array.from({ length: petalCount }, (_, i) => {
        const angle = (360 / petalCount) * i + rng() * 18 - 9
        const sv = 0.8 + rng() * 0.4
        return (
          <ellipse key={i}
            cx={scx} cy={scy - petalH * 0.52}
            rx={petalW * sv * 0.85} ry={petalH * sv * 0.65}
            fill={isPollinated ? '#6b7280' : color}
            opacity={isPollinated ? 0.45 : 0.9}
            transform={`rotate(${angle},${scx},${scy})`}
          />
        )
      })}
      <circle cx={scx} cy={scy} r={pistilR}
        fill={isPollinated ? '#92400e' : accentColor} opacity={0.95} />
      {isPollinated && (
        <text x={scx} y={scy + pistilR * 0.4} textAnchor="middle"
          fontSize={pistilR * 1.4} fill="#fbbf24" fontWeight="bold">✓</text>
      )}
    </g>
  )
}

// Grid positions tuned to 500×500 viewBox, two rows avoiding center
const GRID_POS = [
  { x: 65,  y: 130 }, { x: 175, y: 112 }, { x: 310, y: 135 }, { x: 435, y: 118 },
  { x: 85,  y: 305 }, { x: 205, y: 320 }, { x: 345, y: 300 }, { x: 450, y: 315 },
]

function FlowerGrid({ opacity = 1, highlightId = null }: { opacity?: number; highlightId?: string | null }) {
  return (
    <g opacity={opacity}>
      {FLOWER_CLUSTERS.slice(0, 8).map((f, i) => {
        const pos = GRID_POS[i] ?? { x: 60 + i * 55, y: 200 }
        const isHL = highlightId === f.id
        return (
          <g key={f.id}>
            {isHL && <circle cx={pos.x} cy={pos.y} r={44} fill={f.color} opacity={0.18} />}
            <MiniFlower
              cx={pos.x} cy={pos.y} scale={isHL ? 1.1 : 0.9}
              color={f.color} accentColor={f.accentColor}
              rngSeed={parseInt(f.id.replace('f', '')) * 17}
              opacity={isHL ? 1 : 0.65}
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

  // Confidence sparkline (bottom strip)
  const confHistory = camera.confidenceHistory
  let sparklinePath = ''
  if (confHistory.length > 1) {
    const sw = W - 28, sh = 22, sy0 = H - 28
    const pts = confHistory.map((v, i) => {
      const x = clamp(14 + (i / (confHistory.length - 1)) * sw, 14, W - 14)
      const y = clamp(sy0 + sh - v * sh, sy0 - 2, sy0 + sh + 2)
      return `${x},${y}`
    })
    sparklinePath = `M ${pts.join(' L ')}`
  }

  const isPreFlight = ['idle', 'arming'].includes(phase)
  const isTakeoff   = phase === 'takeoff'
  const isTransit   = ['transit', 'resume_transit'].includes(phase)
  const isScanning  = phase === 'scanning'
  const isCandidate = phase === 'candidate_detected'
  const isLocked    = ['target_lock', 'descent'].includes(phase)
  const isHover     = phase === 'hover_align'
  const isPollinating = phase === 'pollinating'
  const isAscent    = phase === 'ascent'
  const isComplete  = phase === 'mission_complete'

  // Center of the main content area (above the bottom HUD strip)
  const cx = W / 2        // 250
  const cy = H / 2 - 25  // 225

  return (
    // Absolutely positioned so it always fills whatever container it's placed in
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block' }}
      >
        <defs>
          <filter id="zpGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="zpSoft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="zpVig" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="transparent" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.6" />
          </radialGradient>
          <linearGradient id="scanG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#22d3ee" stopOpacity="0" />
            <stop offset="50%"  stopColor="#22d3ee" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* ── Solid background ── */}
        <rect x={0} y={0} width={W} height={H} fill="#020617" />

        {/* ── PRE-FLIGHT ── */}
        {isPreFlight && (
          <g>
            <FlowerGrid opacity={0.15} />
            <rect x={0} y={0} width={W} height={H} fill="#020617" opacity={0.65} />
            <rect x={cx - 90} y={cy - 30} width={180} height={58} rx={5}
              fill="#0f1f35" stroke="#1e3a5f" strokeWidth={1.5} />
            <text x={cx} y={cy - 5} textAnchor="middle" fontSize={14}
              fill="#475569" fontFamily="monospace" letterSpacing="0.1em">CAMERA OFFLINE</text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11}
              fill="#334155" fontFamily="monospace">
              {phase === 'arming' ? 'Pre-flight checks...' : 'Awaiting arm sequence'}
            </text>
            <circle cx={cx + 75} cy={cy - 14} r={5} fill="#ef4444">
              <animate attributeName="opacity" values="1;0.1;1" dur="1s" repeatCount="indefinite" />
            </circle>
          </g>
        )}

        {/* ── TAKEOFF ── */}
        {isTakeoff && (
          <g>
            <FlowerGrid opacity={0.25} />
            {[0.35, 0.55, 0.75].map((r, i) => (
              <ellipse key={i} cx={cx} cy={cy + 20} rx={r * 160} ry={r * 80}
                fill="none" stroke="#22d3ee" strokeWidth={1}
                opacity={0.12 + i * 0.07} strokeDasharray="5,8" />
            ))}
            <rect x={cx - 90} y={cy - 26} width={180} height={50} rx={5}
              fill="#020617" fillOpacity={0.85} stroke="#164e63" strokeWidth={1} />
            <text x={cx} y={cy - 3} textAnchor="middle" fontSize={13}
              fill="#38bdf8" fontFamily="monospace" letterSpacing="0.08em">CAMERA INIT</text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize={10}
              fill="#64748b" fontFamily="monospace">Climbing to patrol altitude...</text>
          </g>
        )}

        {/* ── TRANSIT ── */}
        {isTransit && (
          <g>
            <FlowerGrid opacity={0.6} />
            <rect x={0} y={0} width={W} height={50} fill="url(#scanG)" opacity={0.7}>
              <animateTransform attributeName="transform" type="translate"
                values="0,-50; 0,500" dur="1.8s" repeatCount="indefinite" />
            </rect>
            {/* Corner brackets */}
            {[[12,12],[W-12,12],[12,H-55],[W-12,H-55]].map(([bx,by], i) => {
              const dx = i%2===0 ? 1 : -1; const dy = i<2 ? 1 : -1
              return (
                <g key={i} stroke="#22d3ee" strokeWidth={2} opacity={0.45}>
                  <line x1={bx} y1={by} x2={bx+dx*16} y2={by} />
                  <line x1={bx} y1={by} x2={bx} y2={by+dy*16} />
                </g>
              )
            })}
            <rect x={cx - 70} y={6} width={140} height={17} rx={3} fill="#0c1f35" opacity={0.9} />
            <text x={cx} y={18} textAnchor="middle" fontSize={10}
              fill="#38bdf8" fontFamily="monospace" letterSpacing="0.07em">SCANNING — NO TARGET</text>
            <text x={cx} y={H - 55} textAnchor="middle" fontSize={10}
              fill="#475569" fontFamily="monospace">
              CONF: {(sensor.flowerDetectionConfidence * 100).toFixed(1)}%  ·  FLOWERS: {sensor.flowersInView}
            </text>
          </g>
        )}

        {/* ── SCANNING ── */}
        {isScanning && (
          <g>
            <FlowerGrid opacity={0.8} highlightId={targetId} />
            <rect x={0} y={0} width={W} height={45} fill="url(#scanG)" opacity={0.85}>
              <animateTransform attributeName="transform" type="translate"
                values="0,-45; 0,500" dur="1.1s" repeatCount="indefinite" />
            </rect>
            {sensor.flowersInView > 0 && FLOWER_CLUSTERS.slice(0, Math.min(sensor.flowersInView + 1, 7)).map((f, i) => {
              const pos = GRID_POS[i]
              if (!pos) return null
              return (
                <circle key={f.id} cx={pos.x} cy={pos.y} r={28} fill="none"
                  stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4,5" opacity={0.6}>
                  <animate attributeName="r" values="22;34;22" dur={`${1 + i * 0.25}s`} repeatCount="indefinite" />
                </circle>
              )
            })}
            <rect x={cx - 65} y={6} width={130} height={17} rx={3} fill="#0c1f35" opacity={0.9} />
            <text x={cx} y={18} textAnchor="middle" fontSize={10}
              fill="#38bdf8" fontFamily="monospace" letterSpacing="0.07em">ACTIVE SCAN</text>
            <text x={cx} y={H - 55} textAnchor="middle" fontSize={10}
              fill="#64748b" fontFamily="monospace">
              CONF: {(sensor.flowerDetectionConfidence * 100).toFixed(1)}%  ·  FLOWERS: {sensor.flowersInView}
            </text>
          </g>
        )}

        {/* ── CANDIDATE DETECTED ── */}
        {isCandidate && targetFlower && (
          <g>
            <FlowerGrid opacity={0.3} highlightId={targetId} />
            <MiniFlower cx={cx} cy={cy} scale={2.0}
              color={targetFlower.color} accentColor={targetFlower.accentColor}
              rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23} />
            {camera.boundingBoxes.map((bb, i) => {
              const bx = clamp(bb.x * W, 10, W - 90)
              const by = clamp(bb.y * (H - 60), 30, H - 120)
              const bw = Math.min(bb.w * W, W - bx - 10)
              const bh = Math.min(bb.h * (H - 60), H - by - 10)
              return (
                <g key={i}>
                  <rect x={bx} y={by} width={bw} height={bh}
                    fill="none" stroke="#f97316" strokeWidth={2}
                    strokeDasharray="6,4" opacity={0.9} />
                  <rect x={bx} y={by - 18} width={100} height={16} rx={3}
                    fill="#f97316" opacity={0.92} />
                  <text x={bx + 5} y={by - 4} fontSize={11}
                    fill="white" fontFamily="monospace" fontWeight="bold">
                    {(bb.confidence * 100).toFixed(0)}% CANDIDATE
                  </text>
                </g>
              )
            })}
            <rect x={cx - 70} y={6} width={140} height={17} rx={3} fill="#431407" opacity={0.92} />
            <text x={cx} y={18} textAnchor="middle" fontSize={10}
              fill="#f97316" fontFamily="monospace" fontWeight="bold" letterSpacing="0.07em">
              CANDIDATE DETECTED
            </text>
          </g>
        )}

        {/* ── TARGET LOCKED / DESCENT ── */}
        {isLocked && targetFlower && (
          <g>
            <FlowerGrid opacity={0.2} />
            <MiniFlower cx={cx} cy={cy} scale={2.1}
              color={targetFlower.color} accentColor={targetFlower.accentColor}
              rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23} />
            <g filter="url(#zpGlow)">
              <circle cx={cx} cy={cy} r={70} fill="none" stroke="#22d3ee" strokeWidth={2.2} opacity={0.8} />
              <circle cx={cx} cy={cy} r={46} fill="none" stroke="#22d3ee" strokeWidth={1}
                strokeDasharray="4,8" opacity={0.45} />
              {[[-72,-82],[30,-82],[-72,36],[30,36]].map(([ox,oy], i) => {
                const dx = i%2===0 ? 1 : -1; const dy = i<2 ? 1 : -1
                return (
                  <g key={i}>
                    <line x1={cx+ox} y1={cy+oy} x2={cx+ox+dx*15} y2={cy+oy}
                      stroke="#22d3ee" strokeWidth={2.8} />
                    <line x1={cx+ox} y1={cy+oy} x2={cx+ox} y2={cy+oy+dy*15}
                      stroke="#22d3ee" strokeWidth={2.8} />
                  </g>
                )
              })}
              <line x1={cx-82} y1={cy} x2={cx+82} y2={cy}
                stroke="#22d3ee" strokeWidth={1} strokeDasharray="4,8" opacity={0.45} />
              <line x1={cx} y1={cy-92} x2={cx} y2={cy+65}
                stroke="#22d3ee" strokeWidth={1} strokeDasharray="4,8" opacity={0.45} />
              <circle cx={cx} cy={cy} r={4.5} fill="#22d3ee" opacity={0.95} />
            </g>
            <rect x={cx - 78} y={6} width={156} height={17} rx={3}
              fill="#083344" opacity={0.95} stroke="#22d3ee" strokeWidth={0.7} />
            <text x={cx} y={18} textAnchor="middle" fontSize={10}
              fill="#22d3ee" fontFamily="monospace" fontWeight="bold" letterSpacing="0.07em">
              TARGET LOCKED — {targetFlower.id.toUpperCase()}
            </text>
            {phase === 'descent' && (
              <text x={cx} y={H - 55} textAnchor="middle" fontSize={10}
                fill="#38bdf8" fontFamily="monospace">
                Descending...  ALT: {frame.drone.z.toFixed(1)} m
              </text>
            )}
          </g>
        )}

        {/* ── HOVER ALIGN ── */}
        {isHover && targetFlower && (
          <g>
            <FlowerGrid opacity={0.18} />
            <MiniFlower cx={cx} cy={cy} scale={2.2}
              color={targetFlower.color} accentColor={targetFlower.accentColor}
              rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23} />
            <g filter="url(#zpSoft)">
              <circle cx={cx} cy={cy} r={74} fill="none" stroke="#22d3ee" strokeWidth={2.5} opacity={0.85}>
                <animate attributeName="r" values="70;80;70" dur="1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.85;0.35;0.85" dur="1s" repeatCount="indefinite" />
              </circle>
              {[[-76,-86],[32,-86],[-76,38],[32,38]].map(([ox,oy], i) => {
                const dx = i%2===0 ? 1 : -1; const dy = i<2 ? 1 : -1
                return (
                  <g key={i}>
                    <line x1={cx+ox} y1={cy+oy} x2={cx+ox+dx*16} y2={cy+oy}
                      stroke="#22d3ee" strokeWidth={3} />
                    <line x1={cx+ox} y1={cy+oy} x2={cx+ox} y2={cy+oy+dy*16}
                      stroke="#22d3ee" strokeWidth={3} />
                  </g>
                )
              })}
              <line x1={cx-86} y1={cy} x2={cx+86} y2={cy}
                stroke="#22d3ee" strokeWidth={1} strokeDasharray="4,8" opacity={0.5} />
              <line x1={cx} y1={cy-96} x2={cx} y2={cy+68}
                stroke="#22d3ee" strokeWidth={1} strokeDasharray="4,8" opacity={0.5} />
              <circle cx={cx} cy={cy} r={5} fill="#22d3ee" opacity={0.95} />
            </g>
            <rect x={cx - 85} y={6} width={170} height={17} rx={3}
              fill="#083344" opacity={0.95} stroke="#22d3ee" strokeWidth={0.7} />
            <text x={cx} y={18} textAnchor="middle" fontSize={10}
              fill="#22d3ee" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
              HOVER ALIGN — STABILIZING
            </text>
            <text x={cx} y={H - 55} textAnchor="middle" fontSize={10}
              fill="#38bdf8" fontFamily="monospace">
              CONF: {(sensor.flowerDetectionConfidence * 100).toFixed(1)}%  ·  ALT: {frame.drone.z.toFixed(2)} m
            </text>
          </g>
        )}

        {/* ── POLLINATING ── */}
        {isPollinating && targetFlower && (
          <g>
            <FlowerGrid opacity={0.12} />
            <MiniFlower cx={cx} cy={cy} scale={2.2}
              color={targetFlower.color} accentColor={targetFlower.accentColor}
              rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23} />
            <g filter="url(#zpGlow)">
              <circle cx={cx} cy={cy} r={74} fill="none" stroke="#a78bfa" strokeWidth={3} opacity={0.9}>
                <animate attributeName="r" values="70;86;70" dur="0.55s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0.3;0.9" dur="0.55s" repeatCount="indefinite" />
              </circle>
              <circle cx={cx} cy={cy} r={48} fill="none" stroke="#c4b5fd" strokeWidth={1.5} opacity={0.5}>
                <animate attributeName="r" values="44;58;44" dur="0.55s" begin="0.28s" repeatCount="indefinite" />
              </circle>
              <line x1={cx-84} y1={cy} x2={cx+84} y2={cy}
                stroke="#a78bfa" strokeWidth={1.2} strokeDasharray="4,6" opacity={0.6} />
              <line x1={cx} y1={cy-94} x2={cx} y2={cy+66}
                stroke="#a78bfa" strokeWidth={1.2} strokeDasharray="4,6" opacity={0.6} />
              <circle cx={cx} cy={cy} r={5.5} fill="#a78bfa" opacity={0.95} />
            </g>
            {[0,45,90,135,180,225,270,315].map((ang, i) => {
              const rad = (ang + frame.time * 130) * Math.PI / 180
              const r = 90 + Math.sin(frame.time * 5 + i) * 7
              const sx = cx + Math.cos(rad) * r
              const sy = cy + Math.sin(rad) * r * 0.7
              return (
                <circle key={i} cx={sx} cy={sy} r={3.5}
                  fill={i % 2 === 0 ? '#fbbf24' : '#c4b5fd'}
                  opacity={0.6 + Math.sin(frame.time * 4 + i * 0.9) * 0.3} />
              )
            })}
            <rect x={cx - 105} y={6} width={210} height={20} rx={4} fill="#4c1d95" opacity={0.95}>
              <animate attributeName="opacity" values="0.95;0.45;0.95" dur="0.5s" repeatCount="indefinite" />
            </rect>
            <text x={cx} y={20} textAnchor="middle" fontSize={12}
              fill="#c4b5fd" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
              ⚡ POLLINATION TRIGGERED
            </text>
          </g>
        )}

        {/* ── ASCENT ── */}
        {isAscent && (
          <g>
            {targetFlower && isPollinatedState ? (
              <g>
                <FlowerGrid opacity={0.3} />
                <MiniFlower cx={cx} cy={cy} scale={2.0}
                  color={targetFlower.color} accentColor={targetFlower.accentColor}
                  rngSeed={parseInt(targetFlower.id.replace('f', '')) * 23}
                  isPollinated={true} />
                <circle cx={cx} cy={cy} r={72} fill="none"
                  stroke="#22c55e" strokeWidth={2} opacity={0.6} strokeDasharray="8,5" />
                <rect x={cx - 80} y={6} width={160} height={17} rx={3}
                  fill="#052e16" opacity={0.95} stroke="#22c55e" strokeWidth={0.7} />
                <text x={cx} y={18} textAnchor="middle" fontSize={10}
                  fill="#22c55e" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
                  POLLINATED ✓  ASCENDING
                </text>
              </g>
            ) : (
              <g>
                <FlowerGrid opacity={0.45} />
                <text x={cx} y={cy} textAnchor="middle" fontSize={12}
                  fill="#38bdf8" fontFamily="monospace">ASCENDING...</text>
              </g>
            )}
          </g>
        )}

        {/* ── MISSION COMPLETE ── */}
        {isComplete && (
          <g>
            <FlowerGrid opacity={0.65} />
            <rect x={0} y={0} width={W} height={H} fill="#052e16" opacity={0.4} />
            <circle cx={cx} cy={cy} r={120} fill="#22c55e" opacity={0.05} />
            <rect x={cx - 110} y={cy - 40} width={220} height={78} rx={8}
              fill="#052e16" stroke="#22c55e" strokeWidth={1.5} opacity={0.97} />
            <text x={cx} y={cy - 12} textAnchor="middle" fontSize={17}
              fill="#22c55e" fontFamily="monospace" fontWeight="bold">MISSION COMPLETE</text>
            <text x={cx} y={cy + 12} textAnchor="middle" fontSize={11}
              fill="#86efac" fontFamily="monospace">
              {mission.pollinatedFlowerIds.length}/{mission.totalFlowers} flowers pollinated
            </text>
            <text x={cx} y={cy + 30} textAnchor="middle" fontSize={10}
              fill="#4ade80" fontFamily="monospace">
              Battery: {frame.sensor.batteryPercent.toFixed(0)}%  ·  Time: {mission.elapsedSeconds.toFixed(0)}s
            </text>
          </g>
        )}

        {/* ── Confidence bar ── */}
        {!isPreFlight && !isTakeoff && !isComplete && (
          <g>
            <text x={14} y={H - 62} fontSize={9} fill="#475569" fontFamily="monospace">
              DETECTION CONFIDENCE
            </text>
            <rect x={14} y={H - 56} width={W - 28} height={7} rx={3.5} fill="#0f172a" stroke="#1e3a5f" strokeWidth={0.5} />
            <rect x={14} y={H - 56}
              width={Math.max(0, (W - 28) * sensor.flowerDetectionConfidence)} height={7} rx={3.5}
              fill={sensor.flowerDetectionConfidence > 0.85 ? '#22c55e'
                : sensor.flowerDetectionConfidence > 0.5 ? '#f59e0b' : '#22d3ee'} />
            <text x={W - 14} y={H - 57} textAnchor="end" fontSize={9}
              fill="#64748b" fontFamily="monospace">
              {(sensor.flowerDetectionConfidence * 100).toFixed(1)}%
            </text>
          </g>
        )}

        {/* ── Sparkline ── */}
        {sparklinePath && (
          <g>
            <rect x={14} y={H - 45} width={W - 28} height={26} fill="#030712" opacity={0.7} rx={3} />
            <path d={sparklinePath} fill="none" stroke={phaseColor} strokeWidth={1.5} opacity={0.8} />
            <text x={16} y={H - 47} fontSize={8} fill="#334155" fontFamily="monospace">CONF HISTORY ▸</text>
          </g>
        )}

        {/* Vignette */}
        <rect x={0} y={0} width={W} height={H} fill="url(#zpVig)" pointerEvents="none" />

        {/* Phase chip */}
        <rect x={W - 110} y={6} width={104} height={17} rx={3}
          fill={phaseColor + '1a'} stroke={phaseColor + '66'} strokeWidth={0.7} />
        <text x={W - 58} y={18} textAnchor="middle" fontSize={8.5}
          fill={phaseColor} fontWeight="bold" letterSpacing="0.06em" fontFamily="monospace">
          {phase.replace(/_/g, ' ').toUpperCase()}
        </text>
      </svg>
    </div>
  )
}
