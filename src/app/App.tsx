import { useState, useEffect } from 'preact/hooks'
import { TerminalPanel } from '../components/TerminalPanel/TerminalPanel'
import type { SimMode, LiveFrame, ReplayFrame, FlowerCluster, MissionPhase, AgentState } from '../models/types'
import { TopDownView } from '../components/TopDownView/TopDownView'
import { SideView } from '../components/SideView/SideView'
import { TelemetryPanel } from '../components/TelemetryPanel/TelemetryPanel'
import { ZoomPanel } from '../components/ZoomPanel/ZoomPanel'
import { ReplayControls } from '../components/ReplayControls/ReplayControls'
import { LiveStatus } from '../components/LiveStatus/LiveStatus'
import { AgentCommentaryPanel } from '../components/AgentPanel/AgentCommentaryPanel'
import { PanelErrorBoundary } from '../components/ErrorBoundary/PanelErrorBoundary'
import { ModeSelector } from './ModeSelector'
import { useReplayEngine } from '../simulation/replayEngine'
import { useLiveInferenceEngine } from '../simulation/liveInferenceEngine'
import type { AgentStatus } from '../simulation/agentClient'

// ── Live frame adapter ────────────────────────────────────────────────────
// Converts a LiveFrame into a ReplayFrame so existing panels work unmodified.
function liveToReplay(lf: LiveFrame): ReplayFrame {
  const detections = Array.isArray(lf.inference?.detections) ? lf.inference.detections : []

  const phaseMap: Record<string, MissionPhase> = {
    idle: 'idle', arming: 'arming', takeoff: 'takeoff',
    scanning: 'scanning', planning: 'scanning',
    approach: 'transit', descent: 'descent',
    hover_align: 'hover_align', pollinating: 'pollinating',
    ascent: 'ascent', resume: 'resume_transit',
    mission_complete: 'mission_complete', landing: 'idle',
  }
  return {
    time: lf.time,
    drone: lf.drone,
    sensor: lf.sensor,
    mission: {
      phase: (phaseMap[lf.phase] as MissionPhase) ?? 'idle',
      currentWaypointIndex: 0,
      currentTargetFlowerId: lf.currentTargetId,
      pollinatedFlowerIds: lf.pollinatedIds,
      totalFlowers: lf.flowers.length,
      elapsedSeconds: lf.time,
    },
    camera: {
      visibleFlowerIds: lf.discoveredIds,
      candidateFlowerId: null,
      lockedFlowerId: lf.currentTargetId,
      confidenceHistory: detections.map(d => d.confidence),
      boundingBoxes: detections.map(d => {
        const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = Array.isArray(d.bbox) ? d.bbox : [0, 0, 0, 0]
        return {
        flowerId: d.id,
        x: x1 / 640, y: y1 / 640,
        w: (x2 - x1) / 640,
        h: (y2 - y1) / 640,
        confidence: d.confidence,
      }}),
    },
    flowers: lf.flowers.map(f => ({
      ...f,
      state: (
        f.state === 'undiscovered' ? 'unscanned'  :
        f.state === 'discovered'   ? 'discovered' :
        f.state
      ) as FlowerCluster['state'],
    })),
    events: lf.events,
  }
}

// ── Sub-apps ──────────────────────────────────────────────────────────────

function ReplayApp({ onExit, isDark, onToggleTheme }: { onExit: () => void; isDark: boolean; onToggleTheme: () => void }) {
  const replay = useReplayEngine()
  const phase  = replay.currentFrame?.mission.phase ?? 'idle'

  return (
    <AppShell
      phaseLabel={phase.replace(/_/g, ' ')}
      phaseColor={getPhaseColor(phase)}
      elapsed={Math.floor(replay.currentTime)}
      modeLabel="REPLAY"
      isDark={isDark}
      onToggleTheme={onToggleTheme}
      headerRight={
        <button onClick={onExit} style={exitBtnStyle}>✕ EXIT</button>
      }
    >
      <FourPanels
        frame={replay.currentFrame}
        positionHistory={replay.positionHistory}
        altitudeHistory={replay.altitudeHistory}
        accumulatedEvents={replay.accumulatedEvents}
        liveFrame={null}
      />
      <BottomBar>
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
      </BottomBar>
    </AppShell>
  )
}

function LiveApp({ onExit, isDark, onToggleTheme }: { onExit: () => void; isDark: boolean; onToggleTheme: () => void }) {
  const live = useLiveInferenceEngine()
  const lf   = live.currentFrame
  const adapted = lf ? liveToReplay(lf) : null
  const phase   = lf?.phase ?? 'idle'
  const [terminalOpen, setTerminalOpen] = useState(false)

  const showAgent = live.agentStatus !== 'disconnected' || live.agentState.commentary.length > 0

  return (
    <AppShell
      phaseLabel={phase.replace(/_/g, ' ')}
      phaseColor={getLivePhaseColor(phase)}
      elapsed={Math.floor(lf?.time ?? 0)}
      modeLabel="LIVE"
      isDark={isDark}
      onToggleTheme={onToggleTheme}
      headerRight={
        <LiveStatus
          wsStatus={live.wsStatus}
          inferenceMode={live.inferenceMode}
          inferenceMs={live.inferenceMs}
          agentStatus={live.agentStatus}
          onRestart={live.restart}
          onExit={onExit}
          onToggleTerminal={() => setTerminalOpen(o => !o)}
          terminalOpen={terminalOpen}
        />
      }
    >
      <FourPanels
        frame={adapted}
        positionHistory={lf?.positionHistory ?? []}
        altitudeHistory={lf?.altitudeHistory ?? []}
        accumulatedEvents={lf?.events ?? []}
        liveFrame={lf}
        agentState={live.agentState}
      />

      {showAgent && (
        <AgentCommentaryPanel
          agentState={live.agentState}
          agentStatus={live.agentStatus}
        />
      )}

      <BottomBar>
        <LiveBottomBar lf={lf} />
      </BottomBar>

      {terminalOpen && (
        <TerminalPanel
          entries={live.terminalEntries}
          onClose={() => setTerminalOpen(false)}
        />
      )}
    </AppShell>
  )
}

// ── Theme hook ────────────────────────────────────────────────────────────

function useTheme() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem('theme') !== 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  // Apply on first render
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  }, [])

  return { isDark, toggleTheme: () => setIsDark(d => !d) }
}

// ── Root App ──────────────────────────────────────────────────────────────

export function App() {
  const [mode, setMode] = useState<'select' | SimMode>('select')
  const { isDark, toggleTheme } = useTheme()

  if (mode === 'select') return <ModeSelector onSelect={setMode} isDark={isDark} onToggleTheme={toggleTheme} />
  if (mode === 'replay') return <ReplayApp onExit={() => setMode('select')} isDark={isDark} onToggleTheme={toggleTheme} />
  return <LiveApp onExit={() => setMode('select')} isDark={isDark} onToggleTheme={toggleTheme} />
}

// ── Shared layout components ──────────────────────────────────────────────

function AppShell({ phaseLabel, phaseColor, elapsed, modeLabel, headerRight, isDark, onToggleTheme, children }: {
  phaseLabel: string; phaseColor: string; elapsed: number
  modeLabel: string; headerRight: preact.ComponentChild
  isDark: boolean; onToggleTheme: () => void
  children: preact.ComponentChildren
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>
      <header style={{
        padding: '8px 16px', borderBottom: '1px solid var(--border)',
        background: 'var(--header-bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Smart Pollinator — {modeLabel} MODE
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
            Autonomous Pollinator Drone Platform
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{
            padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            background: phaseColor + '33', color: phaseColor, border: `1px solid ${phaseColor}66`,
          }}>
            {phaseLabel.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>T+{elapsed}s</div>
          <ThemeToggleButton isDark={isDark} onToggle={onToggleTheme} />
          {headerRight}
        </div>
      </header>
      {children}
    </div>
  )
}

function ThemeToggleButton({ isDark, onToggle }: { isDark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        padding: '3px 9px', borderRadius: 4,
        background: 'var(--exit-btn-bg)', border: '1px solid var(--exit-btn-border)',
        color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer',
        fontFamily: 'monospace', letterSpacing: '0.06em',
        display: 'flex', alignItems: 'center', gap: 5,
        transition: 'color 0.2s, background 0.2s',
      }}
    >
      {isDark ? '☀' : '☾'}
    </button>
  )
}

function FourPanels({ frame, positionHistory, altitudeHistory, accumulatedEvents, liveFrame, agentState }: {
  frame: ReplayFrame | null
  positionHistory: Array<{ x: number; y: number }>
  altitudeHistory: Array<{ time: number; z: number }>
  accumulatedEvents: import('../models/types').EventLogEntry[]
  liveFrame: LiveFrame | null
  agentState?: AgentState
}) {
  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
      <div style={{ width: '60%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
        <PanelBox label="Top-Down Mission View" flex={62} borderBottom>
          {frame
            ? (
              <PanelErrorBoundary panelName="Top-down mission view">
                <TopDownView frame={frame} positionHistory={positionHistory} liveFrame={liveFrame} agentState={agentState} />
              </PanelErrorBoundary>
            )
            : <Placeholder label="Top-Down View" />}
        </PanelBox>
        <PanelBox label="Altitude / Side View" flex={38}>
          {frame
            ? <SideView frame={frame} altitudeHistory={altitudeHistory} />
            : <Placeholder label="Side View" />}
        </PanelBox>
      </div>
      <div style={{ width: '40%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <PanelBox label="Telemetry Dashboard" flex={65} borderBottom>
          {frame
            ? (
              <PanelErrorBoundary panelName="Telemetry dashboard">
                <TelemetryPanel frame={frame} accumulatedEvents={accumulatedEvents} agentState={agentState} />
              </PanelErrorBoundary>
            )
            : <Placeholder label="Telemetry" />}
        </PanelBox>
        <PanelBox label="Camera / Flower Analysis" flex={35} relative minHeight={320}>
          {frame
            ? (
              <PanelErrorBoundary panelName="Camera analysis">
                <ZoomPanel frame={frame} livePng={liveFrame?.inference?.framePng ?? null} />
              </PanelErrorBoundary>
            )
            : <Placeholder label="Camera Analysis" />}
        </PanelBox>
      </div>
    </div>
  )
}

function PanelBox({ label, flex, borderBottom, relative, minHeight, children }: {
  label: string; flex: number; borderBottom?: boolean
  relative?: boolean; minHeight?: number; children: preact.ComponentChildren
}) {
  return (
    <div style={{ flex, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', ...(borderBottom ? { borderBottom: '1px solid var(--border)' } : {}) }}>
      <div style={{ flexShrink: 0, padding: '4px 10px', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-2)' }}>
        {label}
      </div>
      <div style={{ flex: 1, minHeight: minHeight ?? 0, overflow: 'hidden', ...(relative ? { position: 'relative' } : {}) }}>
        {children}
      </div>
    </div>
  )
}

function BottomBar({ children }: { children: preact.ComponentChildren }) {
  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bottombar-bg)', padding: '6px 16px' }}>
      {children}
    </div>
  )
}

function LiveBottomBar({ lf }: { lf: LiveFrame | null }) {
  if (!lf) return null
  const discovered = lf.discoveredIds.length
  const pollinated = lf.pollinatedIds.length
  const total      = lf.flowers.length
  const passLabel  = lf.scanComplete ? 'SCAN DONE' : `PASS ${lf.scanPassIndex + 1}/4`
  const routeLabel = lf.planningComplete ? `ROUTE: ${lf.tspRoute.join(' → ')}` : 'ROUTE: PENDING'

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', fontSize: 10, fontFamily: 'monospace', color: '#64748b' }}>
      <span style={{ color: '#22d3ee' }}>{passLabel}</span>
      <span>DISCOVERED {discovered}/{total}</span>
      <span style={{ color: '#22c55e' }}>POLLINATED {pollinated}/{discovered}</span>
      <span style={{ color: '#94a3b8', fontSize: 9 }}>{routeLabel}</span>
    </div>
  )
}

function Placeholder({ label }: { label: string }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e3a5f', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
      {label}
    </div>
  )
}

const exitBtnStyle: preact.JSX.CSSProperties = {
  padding: '3px 9px', borderRadius: 4,
  background: 'var(--exit-btn-bg)', border: '1px solid var(--exit-btn-border)',
  color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer',
  fontFamily: 'monospace', letterSpacing: '0.06em',
}

// ── Phase colors ─────────────────────────────────────────────────────────

export function getPhaseColor(phase: string): string {
  switch (phase) {
    case 'idle': return '#64748b'
    case 'arming': return '#f59e0b'
    case 'takeoff': return '#3b82f6'
    case 'transit': case 'resume_transit': return '#6366f1'
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

function getLivePhaseColor(phase: string): string {
  switch (phase) {
    case 'idle': return '#64748b'
    case 'arming': return '#f59e0b'
    case 'takeoff': return '#3b82f6'
    case 'scanning': return '#06b6d4'
    case 'planning': return '#818cf8'
    case 'approach': return '#6366f1'
    case 'descent': return '#f97316'
    case 'hover_align': return '#fb923c'
    case 'pollinating': return '#a78bfa'
    case 'ascent': return '#3b82f6'
    case 'resume': return '#6366f1'
    case 'mission_complete': return '#22c55e'
    case 'landing': return '#3b82f6'
    default: return '#64748b'
  }
}
