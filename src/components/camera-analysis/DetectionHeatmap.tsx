import type { FlowerRenderState } from './types'

interface Props {
  flowers: FlowerRenderState[]
  phase: string
  qualityIntensity?: number  // 0-1 from optical flow quality; scales heatmap opacity
}

export function DetectionHeatmap({ flowers, phase, qualityIntensity = 1 }: Props) {
  const scanning = ['scanning','candidate_detected','target_lock','descent','hover_align','pollinating'].includes(phase)
  if (!scanning) return null

  // Quality modulates overall heatmap visibility — low quality = fainter heat blobs
  const qScale = 0.4 + qualityIntensity * 0.6

  return (
    <g>
      <defs>
        {flowers.filter(f => f.confidence > 0.05).map(f => (
          <radialGradient key={`hg-${f.id}`} id={`ca-hg-${f.id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%"
              stopColor={f.state === 'pollinated' ? '#22c55e' : f.confidence > 0.7 ? '#22d3ee' : '#f59e0b'}
              stopOpacity={Math.min(0.55, f.confidence * 0.7 * qScale)} />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {flowers.filter(f => f.confidence > 0.05).map(f => {
        const r = 60 + f.confidence * 40
        return (
          <ellipse key={f.id} cx={f.cx} cy={f.cy} rx={r} ry={r * 0.75}
            fill={`url(#ca-hg-${f.id})`}
            className="of-heatmap-pulse" />
        )
      })}
    </g>
  )
}
