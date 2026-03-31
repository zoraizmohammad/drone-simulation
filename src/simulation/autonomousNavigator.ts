import type {
  DroneState, SensorState, LiveFlower, LiveFrame,
  LivePhase, InferenceResult, EventLogEntry,
} from '../models/types'
import {
  generateRandomGarden, generateLawnmowerPath, computeTSPRoute,
} from '../data/randomMissionGenerator'
import { getSensorAtDistance } from './sensorInterpolation'
import { computeOpticalFlowState } from './opticalFlowModel'

const PATROL_ALT = 8.0
const HOVER_ALT  = 1.5
const SCAN_SPEED = 2.5   // m/s
const APPROACH_SPEED = 2.0
const CLIMB_SPEED = 1.8
const HOME = { x: 2, y: 2 }
const WAYPOINT_RADIUS = 0.4   // m — counts as "reached"
const HOVER_TOLERANCE = 0.18  // m XY for hover_align
const HOVER_DWELL_S   = 0.5
const POLLINATE_DWELL_S = 3.0
const ARM_DURATION_S  = 2.0
const PLAN_DURATION_S = 2.5
const FPS = 30
const POS_HIST_LEN = 90
const ALT_HIST_LEN = 150
const MAX_EVENTS = 100
// Proximity-based detection radius (meters lateral) — simulates camera FOV at patrol altitude
const PROXIMITY_DETECT_RADIUS = 4.5

export class AutonomousNavigator {
  private flowers: LiveFlower[]
  private lawnmower: Array<{ x: number; y: number }>
  private phase: LivePhase = 'idle'
  private x = HOME.x
  private y = HOME.y
  private z = 0
  private yaw = 0
  private scanWpIdx = 0
  private scanComplete = false
  private planningComplete = false
  private planTimer = 0
  private armTimer = 0
  private hoverTimer = 0
  private pollinateTimer = 0
  private tspRoute: string[] = []
  private tspIdx = 0
  private discoveredIds: string[] = []
  private pollinatedIds: string[] = []
  private posHistory: Array<{ x: number; y: number }> = []
  private altHistory: Array<{ time: number; z: number }> = []
  private events: EventLogEntry[] = []
  private frameEvents: EventLogEntry[] = []
  private time = 0
  private frameIdx = 0
  private lastInference: InferenceResult | null = null
  done = false

  constructor(seed?: number) {
    this.flowers = generateRandomGarden(seed)
    this.lawnmower = generateLawnmowerPath()
  }

  getFlowers() { return this.flowers }

  /** Called by liveInferenceEngine each RAF tick */
  tick(dt: number, inference: InferenceResult | null): LiveFrame {
    this.time += dt
    this.frameIdx++
    this.frameEvents = []

    if (inference) {
      this.lastInference = inference
      this.processInference(inference)
    }

    this.stepPhase(dt)
    this.updateHistory()

    return this.buildFrame()
  }

  // ── Phase stepping ──────────────────────────────────────────────────────

  private stepPhase(dt: number) {
    switch (this.phase) {
      case 'idle':           this.doIdle(); break
      case 'arming':         this.doArming(dt); break
      case 'takeoff':        this.doTakeoff(dt); break
      case 'scanning':       this.doScanning(dt); break
      case 'planning':       this.doPlanning(dt); break
      case 'approach':       this.doApproach(dt); break
      case 'descent':        this.doDescent(dt); break
      case 'hover_align':    this.doHoverAlign(dt); break
      case 'pollinating':    this.doPollinating(dt); break
      case 'ascent':         this.doAscent(dt); break
      case 'resume':         this.doResume(dt); break
      case 'mission_complete': this.doMissionComplete(dt); break
      case 'landing':        this.doLanding(dt); break
    }
  }

  private doIdle() {
    // Immediately begin arming on first tick
    this.transition('arming')
    this.armTimer = 0
  }

  private doArming(dt: number) {
    this.armTimer += dt
    if (this.armTimer >= ARM_DURATION_S) this.transition('takeoff')
  }

  private doTakeoff(dt: number) {
    this.z = Math.min(PATROL_ALT, this.z + CLIMB_SPEED * dt)
    if (this.z >= PATROL_ALT - 0.1) this.transition('scanning')
  }

  private doScanning(dt: number) {
    const wp = this.lawnmower[this.scanWpIdx]
    this.moveToward(wp.x, wp.y, this.z, SCAN_SPEED, dt)
    // Proximity-based detection: camera FOV at patrol altitude
    this.doProximityDetection()
    if (Math.hypot(this.x - wp.x, this.y - wp.y) < WAYPOINT_RADIUS) {
      this.scanWpIdx++
      if (this.scanWpIdx >= this.lawnmower.length) {
        this.scanComplete = true
        this.transition('planning')
      }
    }
  }

  private doPlanning(dt: number) {
    this.planTimer += dt
    if (this.planTimer >= PLAN_DURATION_S) {
      // Fallback: if CV produced no detections (server offline etc.),
      // add all unvisited flowers so the mission still runs
      if (this.discoveredIds.length === 0 && this.flowers.length > 0) {
        for (const f of this.flowers) {
          this.discoveredIds.push(f.id)
          this.updateFlowerState(f.id, 'discovered')
        }
        this.emit('No CV detections — targeting all flowers', 'warn')
      }
      this.tspRoute = computeTSPRoute(this.flowers, this.discoveredIds)
      this.tspIdx = 0
      this.planningComplete = true
      if (this.tspRoute.length === 0) {
        this.transition('mission_complete')
      } else {
        this.transition('approach')
      }
    }
  }

  private doApproach(dt: number) {
    const target = this.currentTarget()
    if (!target) { this.transition('mission_complete'); return }
    this.moveToward(target.x, target.y, PATROL_ALT, APPROACH_SPEED, dt)
    // Keep discovering any nearby flowers as we fly the approach path
    this.doProximityDetection()
    if (Math.hypot(this.x - target.x, this.y - target.y) < WAYPOINT_RADIUS) {
      this.transition('descent')
    }
  }

  private doDescent(dt: number) {
    this.z = Math.max(HOVER_ALT, this.z - CLIMB_SPEED * dt)
    const target = this.currentTarget()
    if (target) this.moveToward(target.x, target.y, this.z, 0.5, dt)
    if (this.z <= HOVER_ALT + 0.15) this.transition('hover_align')
  }

  private doHoverAlign(dt: number) {
    const target = this.currentTarget()
    if (!target) { this.transition('ascent'); return }
    this.moveToward(target.x, target.y, HOVER_ALT, 0.3, dt)
    const err = Math.hypot(this.x - target.x, this.y - target.y)
    if (err < HOVER_TOLERANCE) {
      this.hoverTimer += dt
      if (this.hoverTimer >= HOVER_DWELL_S) {
        this.hoverTimer = 0
        this.transition('pollinating')
      }
    } else {
      this.hoverTimer = 0
    }
  }

  private doPollinating(dt: number) {
    this.pollinateTimer += dt
    if (this.pollinateTimer >= POLLINATE_DWELL_S) {
      this.pollinateTimer = 0
      const target = this.currentTarget()
      if (target) {
        this.pollinatedIds.push(target.id)
        this.updateFlowerState(target.id, 'pollinated')
        this.emit(`POLLINATION COMPLETE — ${target.id}`, 'success')
      }
      this.transition('ascent')
    }
  }

  private doAscent(dt: number) {
    this.z = Math.min(PATROL_ALT, this.z + CLIMB_SPEED * dt)
    if (this.z >= PATROL_ALT - 0.1) this.transition('resume')
  }

  private doResume(_dt: number) {
    this.tspIdx++
    if (this.tspIdx >= this.tspRoute.length) {
      this.transition('mission_complete')
    } else {
      this.transition('approach')
    }
  }

  private doMissionComplete(dt: number) {
    // Return to home, then land
    this.moveToward(HOME.x, HOME.y, PATROL_ALT, APPROACH_SPEED, dt)
    if (Math.hypot(this.x - HOME.x, this.y - HOME.y) < WAYPOINT_RADIUS) {
      this.transition('landing')
    }
  }

  private doLanding(dt: number) {
    this.z = Math.max(0, this.z - CLIMB_SPEED * 0.6 * dt)
    if (this.z <= 0.01) this.done = true
  }

  // ── Proximity-based flower detection ────────────────────────────────────
  // Simulates camera FOV at patrol altitude — works even without WS server.
  // Confidence = 0.9 at zero lateral offset, falls to 0.3 at edge of radius.
  private doProximityDetection() {
    for (const f of this.flowers) {
      if (f.state === 'undiscovered') {
        const dist = Math.hypot(this.x - f.x, this.y - f.y)
        if (dist < PROXIMITY_DETECT_RADIUS) {
          const conf = Math.max(0.3, 0.9 - (dist / PROXIMITY_DETECT_RADIUS) * 0.6)
          f.confidence = conf
          if (!this.discoveredIds.includes(f.id)) {
            this.discoveredIds.push(f.id)
            this.updateFlowerState(f.id, 'discovered')
            this.emit(`Flower detected — ${f.id} (${dist.toFixed(1)}m lateral)`, 'info')
          }
        }
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private moveToward(tx: number, ty: number, tz: number, speed: number, dt: number) {
    const dx = tx - this.x
    const dy = ty - this.y
    const dz = tz - this.z
    const dist = Math.max(0.001, Math.hypot(dx, dy))
    const step = Math.min(dist, speed * dt)
    this.x += (dx / dist) * step
    this.y += (dy / dist) * step
    this.z += Math.sign(dz) * Math.min(Math.abs(dz), CLIMB_SPEED * dt)
    if (dx !== 0 || dy !== 0) {
      this.yaw = Math.atan2(dx, dy) * (180 / Math.PI)
    }
  }

  private currentTarget(): LiveFlower | null {
    if (this.tspIdx >= this.tspRoute.length) return null
    return this.flowers.find(f => f.id === this.tspRoute[this.tspIdx]) ?? null
  }

  private processInference(inf: InferenceResult) {
    const targetPhases: LivePhase[] = ['approach', 'descent', 'hover_align']
    for (const det of inf.detections) {
      if (!this.discoveredIds.includes(det.id)) {
        this.discoveredIds.push(det.id)
        this.updateFlowerState(det.id, 'discovered')
        this.emit(`Flower discovered — ${det.id} (conf ${(det.confidence * 100).toFixed(0)}%)`, 'info')
      }
      const f = this.flowers.find(fl => fl.id === det.id)
      if (f && f.state !== 'pollinated') {
        f.confidence = det.confidence
        if (targetPhases.includes(this.phase) && det.id === this.tspRoute[this.tspIdx]) {
          if (det.confidence >= 0.75) this.updateFlowerState(det.id, 'locked')
          else if (det.confidence >= 0.40) this.updateFlowerState(det.id, 'candidate')
          else this.updateFlowerState(det.id, 'scanned')
        }
      }
    }
  }

  private updateFlowerState(id: string, state: LiveFlower['state']) {
    const f = this.flowers.find(fl => fl.id === id)
    if (f) f.state = state
  }

  private transition(next: LivePhase) {
    if (this.phase !== next) {
      this.phase = next
      this.emit(phaseLabel(next), 'event')
    }
  }

  private emit(message: string, level: EventLogEntry['level']) {
    const entry: EventLogEntry = { timestamp: this.time, message, level }
    this.frameEvents.push(entry)
    this.events = [...this.events, entry].slice(-MAX_EVENTS)
  }

  private updateHistory() {
    this.posHistory.push({ x: this.x, y: this.y })
    if (this.posHistory.length > POS_HIST_LEN) {
      this.posHistory = this.posHistory.slice(-POS_HIST_LEN)
    }
    if (this.frameIdx % 5 === 0) {
      this.altHistory.push({ time: this.time, z: this.z })
      if (this.altHistory.length > ALT_HIST_LEN) {
        this.altHistory = this.altHistory.slice(-ALT_HIST_LEN)
      }
    }
  }

  private buildFrame(): LiveFrame {
    const distIn = this.z * 39.37
    const sample = getSensorAtDistance(distIn)
    const ofState = computeOpticalFlowState(sample, this.frameIdx)

    const drone: DroneState = {
      x: this.x, y: this.y, z: this.z,
      vx: ofState.vx, vy: ofState.vy,
      vz: 0,  // approximated
      yaw: this.yaw, yawRate: 0,
    }

    const sensor: SensorState = {
      opticalFlowQuality:      sample.flow_quality,
      flowVelocityX:           ofState.vx,
      flowVelocityY:           ofState.vy,
      rangefinderDistance:     this.z,
      sonarEstimate:           this.z,
      ekfConfidence:           this.phase === 'idle' ? 0 : 0.92 + Math.sin(this.time) * 0.03,
      flowerDetectionConfidence: this.lastInference?.detections[0]?.confidence ?? 0,
      flowersInView:           this.lastInference?.detections.length ?? 0,
      targetLocked:            this.phase === 'hover_align' || this.phase === 'pollinating',
      pollinationTriggered:    this.phase === 'pollinating',
      batteryPercent:          Math.max(70, 100 - this.time * 0.3),
      signalStrength:          Math.max(60, 100 - Math.hypot(this.x - HOME.x, this.y - HOME.y) * 1.5),
      ofStrength:              sample.strength,
      ofPrecision:             sample.precision,
      ofStability:             ofState.stability,
      ofNoise:                 ofState.noise,
      ofEffectiveQuality:      ofState.effectiveQuality,
      sensorDistanceMm:        sample.sensor_distance,
      distanceInches:          distIn,
    }

    return {
      drone, sensor,
      flowers: this.flowers,
      phase: this.phase,
      inference: this.lastInference,
      discoveredIds: [...this.discoveredIds],
      pollinatedIds: [...this.pollinatedIds],
      tspRoute: [...this.tspRoute],
      currentTargetId: this.currentTarget()?.id ?? null,
      scanPassIndex: Math.min(3, Math.floor(this.scanWpIdx / 2)),
      scanComplete: this.scanComplete,
      planningComplete: this.planningComplete,
      positionHistory: [...this.posHistory],
      altitudeHistory: [...this.altHistory],
      events: this.frameEvents,
      time: this.time,
    }
  }
}

function phaseLabel(p: LivePhase): string {
  const map: Record<LivePhase, string> = {
    idle: 'System idle', arming: 'Arming sequence', takeoff: 'Taking off to 8m',
    scanning: 'Scanning — lawnmower pass', planning: 'Computing optimal route',
    approach: 'Approaching target', descent: 'Descending to hover altitude',
    hover_align: 'Hover alignment', pollinating: 'Pollination triggered',
    ascent: 'Ascending to patrol altitude', resume: 'Resuming to next target',
    mission_complete: 'MISSION COMPLETE', landing: 'Landing',
  }
  return map[p] ?? p
}
