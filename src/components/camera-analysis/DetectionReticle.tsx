export function DetectionReticle({ cx, cy, tightness, phase, confidence }: {
  cx: number; cy: number; tightness: number; phase: string; confidence: number
}) {
  const isPollinating = phase === 'pollinating'
  const isComplete = phase === 'mission_complete'
  const color = isPollinating ? '#a78bfa' : '#22d3ee'
  const outerR = 150 - tightness * 80   // 150 → 70
  const bracketLen = 20 + (1 - tightness) * 20
  const opacity = 0.3 + tightness * 0.5

  if (isComplete) return null

  // Suppress unused warning
  void confidence

  const brackets = [
    [-outerR, -outerR * 1.1], [outerR * 0.4, -outerR * 1.1],
    [-outerR, outerR * 0.7],  [outerR * 0.4, outerR * 0.7],
  ]

  return (
    <g>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={outerR} fill="none" stroke={color}
        strokeWidth={tightness > 0.5 ? 2 : 1} opacity={opacity}
        strokeDasharray={tightness > 0.8 ? undefined : '4,8'}>
        {isPollinating && (
          <animate attributeName="r" values={`${outerR};${outerR+15};${outerR}`}
            dur="0.6s" repeatCount="indefinite" />
        )}
      </circle>
      {/* Corner brackets */}
      {brackets.map(([ox, oy], i) => {
        const dx = i % 2 === 0 ? 1 : -1
        const dy = i < 2 ? 1 : -1
        const bx = cx + ox, by = cy + oy
        return (
          <g key={i} stroke={color} strokeWidth={2.5} opacity={opacity + 0.1}>
            <line x1={bx} y1={by} x2={bx + dx * bracketLen} y2={by} />
            <line x1={bx} y1={by} x2={bx} y2={by + dy * bracketLen} />
          </g>
        )
      })}
      {/* Crosshair */}
      <line x1={cx - outerR * 1.1} y1={cy} x2={cx + outerR * 1.1} y2={cy}
        stroke={color} strokeWidth={1} strokeDasharray="4,8" opacity={opacity * 0.7} />
      <line x1={cx} y1={cy - outerR * 1.4} x2={cx} y2={cy + outerR}
        stroke={color} strokeWidth={1} strokeDasharray="4,8" opacity={opacity * 0.7} />
      {/* Center dot */}
      {tightness > 0.3 && (
        <circle cx={cx} cy={cy} r={4 + tightness * 3} fill={color} opacity={opacity + 0.2} />
      )}
    </g>
  )
}
