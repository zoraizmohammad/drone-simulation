import type { ReplayFrame, EventLogEntry, AgentState } from '../../models/types'
import { getPhaseColor } from '../../app/App'
import { useRef, useEffect } from 'preact/hooks'

interface Props {
  frame: ReplayFrame
  accumulatedEvents: EventLogEntry[]
  agentState?: AgentState
}

function Row({ label, value, color, unit }: { label: string; value: string; color?: string; unit?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{
        color: color || 'var(--text-dim)',
        fontSize: '11px',
        fontWeight: 600,
        fontFamily: 'monospace',
        transition: 'color 0.3s',
      }}>
        {value}{unit ? <span style={{ color: 'var(--text-faint)', fontSize: '9px', marginLeft: '2px' }}>{unit}</span> : null}
      </span>
    </div>
  )
}

function BarGauge({ value, max = 1, color, height = 4 }: { value: number; max?: number; color: string; height?: number }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100
  return (
    <div style={{
      width: '100%', height: `${height}px`, background: 'var(--gauge-track)',
      borderRadius: '2px', overflow: 'hidden',
      border: '1px solid var(--gauge-border)',
    }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: color,
        borderRadius: '2px',
        transition: 'width 0.1s linear',
        boxShadow: `0 0 4px ${color}66`,
      }} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-2)' }}>
      <div style={{
        fontSize: '8px', color: 'var(--section-header)', letterSpacing: '0.12em',
        textTransform: 'uppercase', marginBottom: '4px', fontWeight: 700,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: '3px',
      fontSize: '9px',
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      background: color + '22',
      color: color,
      border: `1px solid ${color}55`,
    }}>
      {label}
    </span>
  )
}

function StatusDot({ active, color }: { active: boolean; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width: '8px', height: '8px',
      borderRadius: '50%',
      background: active ? color : 'var(--border)',
      boxShadow: active ? `0 0 6px ${color}` : 'none',
      transition: 'background 0.2s, box-shadow 0.2s',
    }} />
  )
}

export function TelemetryPanel({ frame, accumulatedEvents, agentState }: Props) {
  const { drone, sensor, mission, camera } = frame
  const phaseColor = getPhaseColor(mission.phase)
  const speed = Math.sqrt(drone.vx ** 2 + drone.vy ** 2)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  })

  const eventLevelColor = (level: string) => {
    switch (level) {
      case 'info': return 'var(--text-muted)'
      case 'warn': return '#f59e0b'
      case 'success': return '#22c55e'
      case 'event': return '#22d3ee'
      default: return 'var(--text-muted)'
    }
  }

  const allEvents = accumulatedEvents.length > 0 ? accumulatedEvents : frame.events

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      background: 'var(--bg)',
      fontFamily: 'monospace',
      scrollbarWidth: 'thin',
      scrollbarColor: 'var(--border) transparent',
    }}>
      {/* Mission Header */}
      <Section title="Mission Status">
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
          <Chip label={mission.phase.replace(/_/g, ' ')} color={phaseColor} />
          <Chip label={`WP ${mission.currentWaypointIndex}`} color="#6366f1" />
        </div>
        <Row label="Elapsed" value={`${mission.elapsedSeconds.toFixed(1)}`} unit="s" color="var(--text-dim)" />
        <Row label="Target Flower" value={mission.currentTargetFlowerId || '—'} color="#22d3ee" />
      </Section>

      {/* Position & Motion */}
      <Section title="Position & Motion">
        <Row label="X" value={drone.x.toFixed(3)} unit="m" />
        <Row label="Y" value={drone.y.toFixed(3)} unit="m" />
        <Row label="Z (alt)" value={drone.z.toFixed(3)} unit="m" color="#38bdf8" />
        <Row label="Vx" value={drone.vx.toFixed(2)} unit="m/s" color={Math.abs(drone.vx) > 1 ? '#f97316' : undefined} />
        <Row label="Vy" value={drone.vy.toFixed(2)} unit="m/s" color={Math.abs(drone.vy) > 1 ? '#f97316' : undefined} />
        <Row label="Vz" value={drone.vz.toFixed(2)} unit="m/s" color={Math.abs(drone.vz) > 0.5 ? '#fbbf24' : undefined} />
        <Row label="Speed" value={speed.toFixed(2)} unit="m/s" color={speed > 2 ? '#f97316' : undefined} />
        <Row label="Yaw" value={drone.yaw.toFixed(1)} unit="°" />
        <Row label="Yaw Rate" value={drone.yawRate.toFixed(1)} unit="°/s" />
      </Section>

      {/* System Status */}
      <Section title="System Status">
        <div style={{ marginBottom: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Battery</span>
            <span style={{ fontSize: '11px', color: sensor.batteryPercent > 50 ? '#22c55e' : sensor.batteryPercent > 20 ? '#f59e0b' : '#ef4444', fontFamily: 'monospace', fontWeight: 600 }}>
              {sensor.batteryPercent.toFixed(1)}%
            </span>
          </div>
          <BarGauge value={sensor.batteryPercent} max={100}
            color={sensor.batteryPercent > 50 ? '#22c55e' : sensor.batteryPercent > 20 ? '#f59e0b' : '#ef4444'}
            height={5}
          />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Signal</span>
            <span style={{ fontSize: '11px', color: '#6366f1', fontFamily: 'monospace', fontWeight: 600 }}>
              {sensor.signalStrength.toFixed(0)}%
            </span>
          </div>
          <BarGauge value={sensor.signalStrength} max={100} color="#6366f1" height={5} />
        </div>
      </Section>

      {/* Sensor Readings */}
      <Section title="Sensor Readings">
        <div style={{ marginBottom: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Optical Flow Quality</span>
            <span style={{ fontSize: '10px', color: '#a78bfa', fontFamily: 'monospace' }}>{Math.round(sensor.opticalFlowQuality)}</span>
          </div>
          <BarGauge value={sensor.opticalFlowQuality} max={255} color="#a78bfa" height={4} />
        </div>
        <Row label="Flow Vx" value={sensor.flowVelocityX.toFixed(3)} unit="m/s" />
        <Row label="Flow Vy" value={sensor.flowVelocityY.toFixed(3)} unit="m/s" />
        <Row label="Rangefinder" value={sensor.rangefinderDistance.toFixed(3)} unit="m" color="#f97316" />
        <Row label="Sonar Est." value={sensor.sonarEstimate.toFixed(3)} unit="m" />
        <div style={{ marginTop: '3px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>EKF Confidence</span>
            <span style={{ fontSize: '10px', color: '#22c55e', fontFamily: 'monospace' }}>
              {(sensor.ekfConfidence * 100).toFixed(1)}%
            </span>
          </div>
          <BarGauge value={sensor.ekfConfidence} max={1} color="#22c55e" height={4} />
        </div>
      </Section>

      {/* Camera / Detection */}
      <Section title="Camera / Detection">
        <div style={{ marginBottom: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Detection Confidence</span>
            <span style={{
              fontSize: '12px', fontFamily: 'monospace', fontWeight: 700,
              color: sensor.flowerDetectionConfidence > 0.75 ? '#22c55e'
                : sensor.flowerDetectionConfidence > 0.4 ? '#f59e0b'
                : sensor.flowerDetectionConfidence > 0 ? '#22d3ee' : 'var(--section-header)',
            }}>
              {sensor.flowerDetectionConfidence > 0
                ? `${(sensor.flowerDetectionConfidence * 100).toFixed(1)}%`
                : '—'}
            </span>
          </div>
          <BarGauge value={sensor.flowerDetectionConfidence} max={1}
            color={sensor.flowerDetectionConfidence > 0.75 ? '#22c55e'
              : sensor.flowerDetectionConfidence > 0.4 ? '#f59e0b' : '#22d3ee'}
            height={6}
          />
        </div>
        <Row label="Flowers in View" value={String(sensor.flowersInView)} color="#a78bfa" />
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '3px 0' }}>
          <StatusDot active={sensor.targetLocked} color="#22d3ee" />
          <span style={{ fontSize: '10px', color: sensor.targetLocked ? '#22d3ee' : 'var(--section-header)', fontWeight: sensor.targetLocked ? 700 : 400 }}>
            TARGET {sensor.targetLocked ? 'LOCKED' : 'NOT LOCKED'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '3px 0' }}>
          <StatusDot active={sensor.pollinationTriggered} color="#a78bfa" />
          <span style={{ fontSize: '10px', color: sensor.pollinationTriggered ? '#a78bfa' : 'var(--section-header)', fontWeight: sensor.pollinationTriggered ? 700 : 400 }}>
            {sensor.pollinationTriggered ? 'POLLINATION ACTIVE' : 'NO POLLINATION'}
          </span>
        </div>
      </Section>

      {/* Mission Progress */}
      <Section title="Mission Progress">
        <Row label="Waypoint" value={`${mission.currentWaypointIndex} / ${8}`} color="#6366f1" />
        <Row label="Pollinated"
          value={`${mission.pollinatedFlowerIds.length} / ${mission.totalFlowers}`}
          color="#22c55e"
        />
        <div style={{ marginTop: '4px' }}>
          <BarGauge
            value={mission.pollinatedFlowerIds.length}
            max={mission.totalFlowers}
            color="#22c55e"
            height={6}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '5px' }}>
          {frame.flowers.map(flower => {
            const fid = flower.id
            const pollinated = mission.pollinatedFlowerIds.includes(fid)
            const isTarget = mission.currentTargetFlowerId === fid
            const isDiscovered = flower.state !== 'unscanned'
            const bg    = pollinated ? '#22c55e22' : isTarget ? '#22d3ee22' : isDiscovered ? 'var(--surface-2)' : 'var(--surface)'
            const col   = pollinated ? '#22c55e'   : isTarget ? '#22d3ee'   : isDiscovered ? 'var(--text-muted)' : 'var(--border)'
            const bord  = pollinated ? '#22c55e44' : isTarget ? '#22d3ee44' : isDiscovered ? 'var(--border)' : 'var(--border-2)'
            return (
              <span key={fid} style={{
                padding: '1px 4px',
                borderRadius: '2px',
                fontSize: '8px',
                fontFamily: 'monospace',
                background: bg,
                color: col,
                border: `1px solid ${bord}`,
                transition: 'background 0.4s, color 0.4s',
              }}>
                {fid}
              </span>
            )
          })}
        </div>
      </Section>

      {/* AI Agent section — live mode only */}
      {agentState && (
        <Section title="AI Agent">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: '4px' }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: agentState.isConnected ? '#22c55e' : 'var(--text-muted)',
              boxShadow: agentState.isConnected ? '0 0 6px #22c55e' : 'none',
            }} />
            <span style={{ fontSize: 9, color: agentState.isConnected ? '#22c55e' : 'var(--text-muted)', fontWeight: 700 }}>
              {agentState.isConnected ? 'CLAUDE HAIKU CONNECTED' : 'AGENT OFFLINE'}
            </span>
          </div>
          {agentState.lastDecision && (
            <>
              <Row label="Decisions" value={String(agentState.decisionsTotal)} color="#38bdf8" />
              <Row label="Overrides" value={String(agentState.overridesApplied)} color="#a78bfa" />
              <Row label="Latency" value={`${agentState.agentMs.toFixed(0)}`} unit="ms" />
              <Row label="Confidence" value={`${(agentState.lastDecision.confidenceThreshold * 100).toFixed(0)}`} unit="%" color="#f59e0b" />
              <div style={{ marginTop: 3 }}>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>LAST ACTION</div>
                <div style={{
                  display: 'inline-block', padding: '1px 6px', borderRadius: 2, fontSize: 8,
                  fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                  background: 'var(--surface-2)', color: '#38bdf8', border: '1px solid var(--border)',
                }}>
                  {agentState.lastDecision.action.replace('_', ' ')}
                </div>
              </div>
              {agentState.lastDecision.reasoning && (
                <div style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.4 }}>
                  {agentState.lastDecision.reasoning.slice(0, 80)}{agentState.lastDecision.reasoning.length > 80 ? '…' : ''}
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {/* Event Log */}
      <Section title="Event Log">
        <div
          ref={logRef}
          style={{
            maxHeight: '120px',
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--border) transparent',
          }}
        >
          {allEvents.length === 0 ? (
            <div style={{ fontSize: '9px', color: 'var(--section-header)' }}>No events</div>
          ) : (
            allEvents.map((ev, i) => (
              <div key={i} style={{
                display: 'flex', gap: '6px', padding: '2px 0',
                borderBottom: '1px solid var(--surface)',
                alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: '8px', color: 'var(--section-header)', flexShrink: 0, fontFamily: 'monospace' }}>
                  T+{ev.timestamp.toFixed(1)}s
                </span>
                <span style={{ fontSize: '9px', color: eventLevelColor(ev.level), flex: 1, lineHeight: '1.3' }}>
                  {ev.message}
                </span>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  )
}
