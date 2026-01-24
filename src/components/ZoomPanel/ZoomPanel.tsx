import type { ReplayFrame } from '../../models/types'

interface Props { frame: ReplayFrame }

export function ZoomPanel({ frame }: Props) {
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, minHeight: '200px', background: '#020617' }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 800 500"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      >
        <rect x="0" y="0" width="800" height="500" fill="#0f172a" />
        <circle cx="400" cy="250" r="60" fill="red" />
        <text x="400" y="250" textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="20" fontFamily="monospace">ZOOM PANEL OK</text>
      </svg>
    </div>
  )
}
