export function PollinationEffect({ cx, cy, time, active }: {
  cx: number; cy: number; time: number; active: boolean
}) {
  if (!active) return null
  return (
    <g>
      {/* Pulse rings */}
      <circle cx={cx} cy={cy} r={80} fill="none" stroke="#a78bfa" strokeWidth={3} opacity={0.85}>
        <animate attributeName="r" values="75;100;75" dur="0.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.85;0.2;0.85" dur="0.6s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r={50} fill="none" stroke="#c4b5fd" strokeWidth={1.5} opacity={0.5}>
        <animate attributeName="r" values="46;62;46" dur="0.6s" begin="0.3s" repeatCount="indefinite" />
      </circle>
      {/* Orbiting particles */}
      {[0,45,90,135,180,225,270,315].map((ang, i) => {
        const rad = (ang + time * 140) * Math.PI / 180
        const r = 95 + Math.sin(time * 5 + i) * 8
        const sx = cx + Math.cos(rad) * r
        const sy = cy + Math.sin(rad) * r * 0.7
        return (
          <circle key={i} cx={sx} cy={sy} r={3.5}
            fill={i % 2 === 0 ? '#fbbf24' : '#c4b5fd'}
            opacity={0.55 + Math.sin(time * 4 + i) * 0.35} />
        )
      })}
    </g>
  )
}
