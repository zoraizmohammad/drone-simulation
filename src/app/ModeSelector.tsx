import type { SimMode } from '../models/types'

interface Props {
  onSelect: (mode: SimMode) => void
  isDark: boolean
  onToggleTheme: () => void
}

export function ModeSelector({ onSelect, isDark, onToggleTheme }: Props) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'monospace',
      zIndex: 100,
    }}>
      {/* Theme toggle */}
      <button
        onClick={onToggleTheme}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        style={{
          position: 'absolute', top: 16, right: 16,
          padding: '4px 10px', borderRadius: 4,
          background: 'var(--exit-btn-bg)', border: '1px solid var(--exit-btn-border)',
          color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer',
          fontFamily: 'monospace',
        }}
      >
        {isDark ? '☀' : '☾'}
      </button>

      {/* Title */}
      <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--text-faint)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
        Autonomous Pollinator Drone Platform
      </div>
      <div style={{ marginBottom: 48, fontSize: 22, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.08em' }}>
        SELECT SIMULATION MODE
      </div>

      <div style={{ display: 'flex', gap: 28 }}>
        {/* Mode 1 */}
        <ModeCard
          title="Deterministic Replay"
          badge="MODE 1"
          badgeColor="#6366f1"
          description={[
            '90-second pre-generated mission',
            '8 fixed flower clusters',
            'Real optical flow CSV data',
            'Distance-driven sensor model',
            'Full camera analysis panel',
          ]}
          cta="Launch Replay"
          onClick={() => onSelect('replay')}
          accent="#6366f1"
        />

        {/* Mode 2 */}
        <ModeCard
          title="Live Inference"
          badge="MODE 2"
          badgeColor="#22d3ee"
          description={[
            'Randomly placed flower clusters',
            '4-pass lawnmower scan',
            'TSP route planning',
            'Python YOLOv8 inference server',
            'Real-time PIL synthetic frames',
          ]}
          cta="Launch Live Mode"
          onClick={() => onSelect('live')}
          accent="#22d3ee"
          tag="STARTS PYTHON SERVER"
        />
      </div>

      <div style={{ marginTop: 40, fontSize: 9, color: 'var(--border)', letterSpacing: '0.1em' }}>
        Mode 2 requires Python 3.9+ · drone-cv-system/server/requirements_server.txt
      </div>
    </div>
  )
}

function ModeCard({
  title, badge, badgeColor, description, cta, onClick, accent, tag,
}: {
  title: string; badge: string; badgeColor: string; description: string[]
  cta: string; onClick: () => void; accent: string; tag?: string
}) {
  return (
    <div
      style={{
        width: 300, padding: '28px 28px 24px',
        background: 'var(--surface)',
        border: `1px solid ${accent}44`,
        borderRadius: 8,
        display: 'flex', flexDirection: 'column', gap: 16,
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = accent + 'aa')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = accent + '44')}
    >
      {/* Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
          padding: '2px 8px', borderRadius: 3,
          background: badgeColor + '22', color: badgeColor,
          border: `1px solid ${badgeColor}55`,
        }}>{badge}</span>
        {tag && (
          <span style={{ fontSize: 8, color: '#f59e0b', letterSpacing: '0.08em' }}>{tag}</span>
        )}
      </div>

      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</div>

      <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {description.map(d => (
          <li key={d} style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <span style={{ color: accent, marginTop: 1 }}>›</span> {d}
          </li>
        ))}
      </ul>

      <button
        onClick={onClick}
        style={{
          marginTop: 8,
          padding: '10px 0', width: '100%',
          background: accent + '18',
          border: `1px solid ${accent}66`,
          borderRadius: 5,
          color: accent,
          fontSize: 12, fontWeight: 700, letterSpacing: '0.1em',
          cursor: 'pointer', fontFamily: 'monospace',
          textTransform: 'uppercase',
        }}
      >
        {cta}
      </button>
    </div>
  )
}
