const VW = 800
const VH = 500
const cx = VW / 2  // 400
const cy = VH / 2  // 250

export function MissionPhaseOverlay({ phase, targetId, confidence, altitude, pollinatedCount, totalFlowers }: {
  phase: string
  targetId: string | null
  confidence: number
  altitude: number
  pollinatedCount: number
  totalFlowers: number
}) {
  const isIdle = phase === 'idle'
  const isArming = phase === 'arming'
  const isTakeoff = phase === 'takeoff'
  const isTransit = phase === 'transit' || phase === 'resume_transit'
  const isScanning = phase === 'scanning'
  const isCandidate = phase === 'candidate_detected'
  const isLocked = phase === 'target_lock'
  const isDescent = phase === 'descent'
  const isHover = phase === 'hover_align'
  const isPollinating = phase === 'pollinating'
  const isAscent = phase === 'ascent'
  const isComplete = phase === 'mission_complete'

  // Suppress unused warning
  void confidence

  return (
    <g>
      {/* IDLE / ARMING */}
      {(isIdle || isArming) && (
        <g>
          <rect x={cx - 95} y={cy - 32} width={190} height={62} rx={5}
            fill="#0f1f35" stroke="#1e3a5f" strokeWidth={1.5} />
          <text x={cx} y={cy - 5} textAnchor="middle" fontSize={14}
            fill="#475569" fontFamily="monospace" letterSpacing="0.1em">CAMERA OFFLINE</text>
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11}
            fill="#334155" fontFamily="monospace">
            {isArming ? 'Pre-flight checks...' : 'Awaiting arm sequence'}
          </text>
          <circle cx={cx + 80} cy={cy - 16} r={5} fill="#ef4444">
            <animate attributeName="opacity" values="1;0.1;1" dur="1s" repeatCount="indefinite" />
          </circle>
        </g>
      )}

      {/* TAKEOFF */}
      {isTakeoff && (
        <g>
          {[0.35, 0.55, 0.75].map((r, i) => (
            <ellipse key={i} cx={cx} cy={cy + 20} rx={r * 180} ry={r * 90}
              fill="none" stroke="#22d3ee" strokeWidth={1}
              opacity={0.12 + i * 0.07} strokeDasharray="5,8" />
          ))}
          <rect x={cx - 95} y={cy - 28} width={190} height={54} rx={5}
            fill="#020617" fillOpacity={0.88} stroke="#164e63" strokeWidth={1} />
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize={13}
            fill="#38bdf8" fontFamily="monospace" letterSpacing="0.08em">CAMERA INITIALIZING</text>
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize={10}
            fill="#64748b" fontFamily="monospace">Climbing to patrol altitude...</text>
        </g>
      )}

      {/* TRANSIT / RESUME_TRANSIT */}
      {isTransit && (
        <g>
          {/* Corner brackets */}
          {[[14,14],[VW-14,14],[14,VH-68],[VW-14,VH-68]].map(([bx,by], i) => {
            const dx = i%2===0 ? 1 : -1; const dy = i<2 ? 1 : -1
            return (
              <g key={i} stroke="#22d3ee" strokeWidth={2} opacity={0.45}>
                <line x1={bx} y1={by} x2={bx+dx*18} y2={by} />
                <line x1={bx} y1={by} x2={bx} y2={by+dy*18} />
              </g>
            )
          })}
          <rect x={cx - 75} y={7} width={150} height={19} rx={3} fill="#0c1f35" opacity={0.9} />
          <text x={cx} y={20} textAnchor="middle" fontSize={10}
            fill="#38bdf8" fontFamily="monospace" letterSpacing="0.07em">SCANNING — NO TARGET</text>
        </g>
      )}

      {/* SCANNING */}
      {isScanning && (
        <g>
          <rect x={cx - 65} y={7} width={130} height={19} rx={3} fill="#0c1f35" opacity={0.9} />
          <text x={cx} y={20} textAnchor="middle" fontSize={10}
            fill="#38bdf8" fontFamily="monospace" letterSpacing="0.07em">ACTIVE SCAN</text>
        </g>
      )}

      {/* CANDIDATE DETECTED */}
      {isCandidate && targetId && (
        <g>
          <rect x={cx - 90} y={7} width={180} height={22} rx={4} fill="#431407" opacity={0.95} />
          <text x={cx} y={22} textAnchor="middle" fontSize={11}
            fill="#f97316" fontFamily="monospace" fontWeight="bold" letterSpacing="0.07em">
            CANDIDATE DETECTED
          </text>
        </g>
      )}

      {/* TARGET LOCKED */}
      {isLocked && targetId && (
        <g>
          <rect x={cx - 90} y={7} width={180} height={22} rx={4}
            fill="#083344" opacity={0.95} stroke="#22d3ee" strokeWidth={0.7} />
          <text x={cx} y={22} textAnchor="middle" fontSize={10}
            fill="#22d3ee" fontFamily="monospace" fontWeight="bold" letterSpacing="0.07em">
            TARGET LOCKED — {targetId.toUpperCase()}
          </text>
        </g>
      )}

      {/* DESCENT */}
      {isDescent && (
        <g>
          <rect x={cx - 100} y={7} width={200} height={22} rx={4}
            fill="#083344" opacity={0.95} stroke="#38bdf8" strokeWidth={0.7} />
          <text x={cx} y={22} textAnchor="middle" fontSize={10}
            fill="#38bdf8" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
            DESCENDING · ALT {altitude.toFixed(1)}m
          </text>
        </g>
      )}

      {/* HOVER ALIGN */}
      {isHover && (
        <g>
          <rect x={cx - 100} y={7} width={200} height={22} rx={4}
            fill="#083344" opacity={0.95} stroke="#22d3ee" strokeWidth={0.7} />
          <text x={cx} y={22} textAnchor="middle" fontSize={10}
            fill="#22d3ee" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
            HOVER ALIGN — STABILIZING
          </text>
        </g>
      )}

      {/* POLLINATING */}
      {isPollinating && (
        <g>
          <rect x={cx - 115} y={7} width={230} height={24} rx={4} fill="#4c1d95" opacity={0.95}>
            <animate attributeName="opacity" values="0.95;0.45;0.95" dur="0.5s" repeatCount="indefinite" />
          </rect>
          <text x={cx} y={23} textAnchor="middle" fontSize={12}
            fill="#c4b5fd" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
            ⚡ POLLINATION TRIGGERED
          </text>
        </g>
      )}

      {/* ASCENT */}
      {isAscent && (
        <g>
          <rect x={cx - 95} y={7} width={190} height={22} rx={4}
            fill="#052e16" opacity={0.95} stroke="#22c55e" strokeWidth={0.7} />
          <text x={cx} y={22} textAnchor="middle" fontSize={10}
            fill="#22c55e" fontFamily="monospace" fontWeight="bold" letterSpacing="0.06em">
            POLLINATED ✓  ASCENDING
          </text>
        </g>
      )}

      {/* MISSION COMPLETE */}
      {isComplete && (
        <g>
          <rect x={0} y={0} width={VW} height={VH} fill="#052e16" opacity={0.4} />
          <circle cx={cx} cy={cy} r={130} fill="#22c55e" opacity={0.05} />
          <rect x={cx - 120} y={cy - 45} width={240} height={88} rx={8}
            fill="#052e16" stroke="#22c55e" strokeWidth={1.5} opacity={0.97} />
          <text x={cx} y={cy - 14} textAnchor="middle" fontSize={18}
            fill="#22c55e" fontFamily="monospace" fontWeight="bold">MISSION COMPLETE</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize={12}
            fill="#86efac" fontFamily="monospace">
            {pollinatedCount}/{totalFlowers} flowers pollinated
          </text>
          <text x={cx} y={cy + 32} textAnchor="middle" fontSize={10}
            fill="#4ade80" fontFamily="monospace">
            ALT: {altitude.toFixed(1)}m
          </text>
        </g>
      )}
    </g>
  )
}
