import type { ReplaySpeed } from '../../simulation/replayEngine'

interface Props {
  isPlaying: boolean
  speed: ReplaySpeed
  currentTime: number
  totalTime: number
  onPlay: () => void
  onPause: () => void
  onReset: () => void
  onSetSpeed: (s: ReplaySpeed) => void
  onSeek: (t: number) => void
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function ReplayControls({ isPlaying, speed, currentTime, totalTime, onPlay, onPause, onReset, onSetSpeed, onSeek }: Props) {
  const progress = totalTime > 0 ? currentTime / totalTime : 0

  const btnStyle = (active?: boolean) => ({
    padding: '4px 12px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 700 as const,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    fontFamily: 'monospace',
    border: `1px solid ${active ? '#38bdf8' : '#1e3a5f'}`,
    background: active ? '#38bdf822' : '#0a1628',
    color: active ? '#38bdf8' : '#64748b',
    transition: 'all 0.15s',
  })

  const speedBtnStyle = (s: ReplaySpeed) => ({
    ...btnStyle(speed === s),
    padding: '4px 8px',
    fontSize: '10px',
  })

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      fontFamily: 'monospace',
    }}>
      {/* Play / Pause */}
      <button
        style={{
          ...btnStyle(),
          padding: '4px 16px',
          background: isPlaying ? '#f9731622' : '#22d3ee22',
          color: isPlaying ? '#f97316' : '#22d3ee',
          border: `1px solid ${isPlaying ? '#f97316' : '#22d3ee'}55`,
          fontSize: '14px',
        }}
        onClick={isPlaying ? onPause : onPlay}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Reset */}
      <button style={btnStyle()} onClick={onReset}>
        ↺ Reset
      </button>

      {/* Speed */}
      <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
        <span style={{ fontSize: '9px', color: '#334155', marginRight: '2px' }}>SPEED</span>
        {([1, 2, 4] as ReplaySpeed[]).map(s => (
          <button key={s} style={speedBtnStyle(s)} onClick={() => onSetSpeed(s)}>
            {s}x
          </button>
        ))}
      </div>

      {/* Time display */}
      <div style={{
        display: 'flex',
        gap: '4px',
        alignItems: 'center',
        fontSize: '11px',
        color: '#38bdf8',
        fontFamily: 'monospace',
        minWidth: '80px',
      }}>
        <span style={{ color: '#94a3b8' }}>{formatTime(currentTime)}</span>
        <span style={{ color: '#334155' }}>/</span>
        <span style={{ color: '#475569' }}>{formatTime(totalTime)}</span>
      </div>

      {/* Scrubber */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
        <input
          type="range"
          min={0}
          max={totalTime}
          step={0.1}
          value={currentTime}
          onInput={(e) => onSeek(parseFloat((e.target as HTMLInputElement).value))}
          style={{
            flex: 1,
            height: '4px',
            accentColor: '#38bdf8',
            cursor: 'pointer',
            background: `linear-gradient(to right, #38bdf8 ${progress * 100}%, #1e3a5f ${progress * 100}%)`,
            borderRadius: '2px',
            outline: 'none',
            border: 'none',
          }}
        />
      </div>

      {/* Mission progress indicator */}
      <div style={{ fontSize: '9px', color: '#334155', whiteSpace: 'nowrap' }}>
        T+{currentTime.toFixed(1)}s
      </div>
    </div>
  )
}
