import { TopDownView } from '../components/TopDownView/TopDownView'
import { SideView } from '../components/SideView/SideView'
import { TelemetryPanel } from '../components/TelemetryPanel/TelemetryPanel'
import { ZoomPanel } from '../components/ZoomPanel/ZoomPanel'
import { ReplayControls } from '../components/ReplayControls/ReplayControls'
import { useReplayEngine } from '../simulation/replayEngine'

export function App() {
  const replay = useReplayEngine()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: '#030712', overflow: 'hidden' }}>
      {/* Header */}
      <header style={{
        padding: '8px 16px',
        borderBottom: '1px solid #1e3a5f',
        background: 'linear-gradient(180deg, #0a1628 0%, #030712 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#38bdf8', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Smart Pollinator Mission Replay
          </div>
          <div style={{ fontSize: '10px', color: '#64748b', letterSpacing: '0.08em' }}>
            Autonomous Pollinator Drone — Mission Visualization System
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{
            padding: '3px 10px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            background: getPhaseColor(replay.currentFrame?.mission.phase || 'idle') + '33',
            color: getPhaseColor(replay.currentFrame?.mission.phase || 'idle'),
            border: `1px solid ${getPhaseColor(replay.currentFrame?.mission.phase || 'idle')}66`,
          }}>
            {replay.currentFrame?.mission.phase.replace(/_/g, ' ') || 'IDLE'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            T+{Math.floor(replay.currentTime)}s
          </div>
        </div>
      </header>

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* Left column - 60% */}
        <div style={{ width: '60%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #1e3a5f' }}>
          {/* Top-Down View - 62% of left column */}
          <div style={{ flex: '0 0 62%', overflow: 'hidden', borderBottom: '1px solid #1e3a5f' }}>
            <div style={{ padding: '4px 10px', fontSize: '10px', color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid #0f2744' }}>
              Top-Down Mission View
            </div>
            <div style={{ height: 'calc(100% - 25px)', overflow: 'hidden' }}>
              {replay.currentFrame ? <TopDownView frame={replay.currentFrame} positionHistory={replay.positionHistory} /> : <Placeholder label="Top-Down View" />}
            </div>
          </div>
          {/* Side View - 38% of left column */}
          <div style={{ flex: '0 0 38%', overflow: 'hidden' }}>
            <div style={{ padding: '4px 10px', fontSize: '10px', color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid #0f2744' }}>
              Altitude / Side View
            </div>
            <div style={{ height: 'calc(100% - 25px)', overflow: 'hidden' }}>
              {replay.currentFrame ? <SideView frame={replay.currentFrame} altitudeHistory={replay.altitudeHistory} /> : <Placeholder label="Side View" />}
            </div>
          </div>
        </div>

        {/* Right column - 40% */}
        <div style={{ width: '40%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Telemetry Panel - 65% of right column */}
          <div style={{ flex: '0 0 65%', overflow: 'hidden', borderBottom: '1px solid #1e3a5f' }}>
            <div style={{ padding: '4px 10px', fontSize: '10px', color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid #0f2744' }}>
              Telemetry Dashboard
            </div>
            <div style={{ height: 'calc(100% - 25px)', overflow: 'hidden' }}>
              {replay.currentFrame ? <TelemetryPanel frame={replay.currentFrame} /> : <Placeholder label="Telemetry" />}
            </div>
          </div>
          {/* Zoom Panel - 35% of right column */}
          <div style={{ flex: '0 0 35%', overflow: 'hidden' }}>
            <div style={{ padding: '4px 10px', fontSize: '10px', color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid #0f2744' }}>
              Camera / Flower Analysis
            </div>
            <div style={{ height: 'calc(100% - 25px)', overflow: 'hidden' }}>
              {replay.currentFrame ? <ZoomPanel frame={replay.currentFrame} /> : <Placeholder label="Zoom Panel" />}
            </div>
          </div>
        </div>
      </div>

      {/* Replay Controls - bottom bar */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid #1e3a5f',
        background: '#0a1628',
        padding: '6px 16px',
      }}>
        <ReplayControls
          isPlaying={replay.isPlaying}
          speed={replay.speed}
          currentTime={replay.currentTime}
          totalTime={replay.totalTime}
          onPlay={replay.play}
          onPause={replay.pause}
          onReset={replay.reset}
          onSetSpeed={replay.setSpeed}
          onSeek={replay.seekTo}
        />
      </div>
    </div>
  )
}

function Placeholder({ label }: { label: string }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#1e3a5f', fontSize: '12px', letterSpacing: '0.1em', textTransform: 'uppercase',
    }}>
      {label}
    </div>
  )
}

export function getPhaseColor(phase: string): string {
  switch (phase) {
    case 'idle': return '#64748b'
    case 'arming': return '#f59e0b'
    case 'takeoff': return '#3b82f6'
    case 'transit': return '#6366f1'
    case 'resume_transit': return '#6366f1'
    case 'scanning': return '#06b6d4'
    case 'candidate_detected': return '#f97316'
    case 'target_lock': return '#22d3ee'
    case 'descent': return '#f97316'
    case 'hover_align': return '#fb923c'
    case 'pollinating': return '#a78bfa'
    case 'ascent': return '#3b82f6'
    case 'mission_complete': return '#22c55e'
    default: return '#64748b'
  }
}
