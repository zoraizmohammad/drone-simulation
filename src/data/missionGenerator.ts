import type {
  ReplayFrame, FlowerCluster, DroneState, SensorState,
  MissionState, CameraAnalysisState, EventLogEntry, MissionPhase, Waypoint
} from '../models/types'
import { getSensorAtDistance } from '../simulation/sensorInterpolation'
import { computeOpticalFlowState } from '../simulation/opticalFlowModel'

// Deterministic pseudo-random
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

const rng = seededRandom(42)

// Garden: 20m x 20m
export const GARDEN_SIZE = 20

// Flower clusters - 10 total
export const FLOWER_CLUSTERS: FlowerCluster[] = [
  { id: 'f1', x: 4.5, y: 3.5, radius: 0.9, flowerCount: 5, color: '#c084fc', accentColor: '#fbbf24', state: 'unscanned', confidence: 0 },
  { id: 'f2', x: 8.0, y: 5.0, radius: 1.0, flowerCount: 6, color: '#fbbf24', accentColor: '#f97316', state: 'unscanned', confidence: 0 },
  { id: 'f3', x: 12.5, y: 4.0, radius: 0.8, flowerCount: 4, color: '#f9a8d4', accentColor: '#ec4899', state: 'unscanned', confidence: 0 },
  { id: 'f4', x: 16.5, y: 6.5, radius: 1.1, flowerCount: 7, color: '#86efac', accentColor: '#22c55e', state: 'unscanned', confidence: 0 },
  { id: 'f5', x: 15.0, y: 11.0, radius: 0.9, flowerCount: 5, color: '#fde047', accentColor: '#f59e0b', state: 'unscanned', confidence: 0 },
  { id: 'f6', x: 10.5, y: 9.5, radius: 1.0, flowerCount: 6, color: '#7dd3fc', accentColor: '#0ea5e9', state: 'unscanned', confidence: 0 },
  { id: 'f7', x: 6.0, y: 11.5, radius: 0.85, flowerCount: 4, color: '#fca5a5', accentColor: '#ef4444', state: 'unscanned', confidence: 0 },
  { id: 'f8', x: 3.5, y: 15.5, radius: 1.0, flowerCount: 5, color: '#fdba74', accentColor: '#ea580c', state: 'unscanned', confidence: 0 },
  { id: 'f9', x: 9.0, y: 15.5, radius: 0.9, flowerCount: 6, color: '#a5b4fc', accentColor: '#818cf8', state: 'unscanned', confidence: 0 },
  { id: 'f10', x: 14.0, y: 16.0, radius: 0.8, flowerCount: 4, color: '#6ee7b7', accentColor: '#10b981', state: 'unscanned', confidence: 0 },
]

// Waypoints - visits 8 flower clusters
export const WAYPOINTS: Waypoint[] = [
  { id: 'wp0', x: 2, y: 2, label: 'Home' },
  { id: 'wp1', x: 4.5, y: 3.5, label: 'Cluster 1' },
  { id: 'wp2', x: 8.0, y: 5.0, label: 'Cluster 2' },
  { id: 'wp3', x: 12.5, y: 4.0, label: 'Cluster 3' },
  { id: 'wp4', x: 16.5, y: 6.5, label: 'Cluster 4' },
  { id: 'wp5', x: 15.0, y: 11.0, label: 'Cluster 5' },
  { id: 'wp6', x: 10.5, y: 9.5, label: 'Cluster 6' },
  { id: 'wp7', x: 6.0, y: 11.5, label: 'Cluster 7' },
  { id: 'wp8', x: 9.0, y: 15.5, label: 'Cluster 9' },
]

const TARGET_FLOWER_IDS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f9']

// Visit sequence - pairs of [waypointIndex, flowerId]
const VISIT_SEQUENCE: Array<[number, string]> = [
  [1, 'f1'],
  [2, 'f2'],
  [3, 'f3'],
  [4, 'f4'],
  [5, 'f5'],
  [6, 'f6'],
  [7, 'f7'],
  [8, 'f9'],
]

const FPS = 30
const TOTAL_SECONDS = 90
const TOTAL_FRAMES = FPS * TOTAL_SECONDS

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t))
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2)
}

function angleTowards(fx: number, fy: number, tx: number, ty: number): number {
  return Math.atan2(ty - fy, tx - fx) * (180 / Math.PI)
}

// Mission timeline (in seconds):
// 0-2: idle
// 2-4: arming
// 4-7: takeoff (climb to 8m)
// 7-90: transit + visit sequence (each visit ~10 seconds)
// Each visit: 2s transit approach, 1s scanning, 1s candidate, 1s target_lock, 2s descent, 1s hover_align, 1.5s pollinating, 1.5s ascent

const VISIT_DURATION = 10 // seconds per flower visit
const FIRST_VISIT_START = 7

interface TimelineSegment {
  startTime: number
  endTime: number
  phase: MissionPhase
  waypointIndex: number
  flowerId: string | null
  fromX: number
  fromY: number
  toX: number
  toY: number
}

function buildTimeline(): TimelineSegment[] {
  const segments: TimelineSegment[] = []

  // idle 0-2
  segments.push({ startTime: 0, endTime: 2, phase: 'idle', waypointIndex: 0, flowerId: null, fromX: 2, fromY: 2, toX: 2, toY: 2 })

  // arming 2-4
  segments.push({ startTime: 2, endTime: 4, phase: 'arming', waypointIndex: 0, flowerId: null, fromX: 2, fromY: 2, toX: 2, toY: 2 })

  // takeoff 4-7
  segments.push({ startTime: 4, endTime: 7, phase: 'takeoff', waypointIndex: 0, flowerId: null, fromX: 2, fromY: 2, toX: 2, toY: 2 })

  let currentTime = FIRST_VISIT_START
  let currentPos = { x: 2, y: 2 }

  for (let i = 0; i < VISIT_SEQUENCE.length; i++) {
    const [wpIdx, flowerId] = VISIT_SEQUENCE[i]
    const flower = FLOWER_CLUSTERS.find(f => f.id === flowerId)!
    const prevPos = { ...currentPos }

    // Transit to flower (2s)
    segments.push({
      startTime: currentTime,
      endTime: currentTime + 2,
      phase: i === 0 ? 'transit' : 'resume_transit',
      waypointIndex: wpIdx,
      flowerId: null,
      fromX: prevPos.x,
      fromY: prevPos.y,
      toX: flower.x,
      toY: flower.y,
    })
    currentTime += 2

    // Scanning (1s)
    segments.push({
      startTime: currentTime,
      endTime: currentTime + 1,
      phase: 'scanning',
      waypointIndex: wpIdx,
      flowerId,
      fromX: flower.x,
      fromY: flower.y,
      toX: flower.x,
      toY: flower.y,
    })
    currentTime += 1

    // Candidate detected (0.8s)
    segments.push({
      startTime: currentTime,
      endTime: currentTime + 0.8,
      phase: 'candidate_detected',
      waypointIndex: wpIdx,
      flowerId,
      fromX: flower.x,
      fromY: flower.y,
      toX: flower.x,
      toY: flower.y,
    })
    currentTime += 0.8

    // Target lock (0.7s)
    segments.push({
      startTime: currentTime,
      endTime: currentTime + 0.7,
      phase: 'target_lock',
      waypointIndex: wpIdx,
      flowerId,
      fromX: flower.x,
      fromY: flower.y,
      toX: flower.x,
      toY: flower.y,
    })
    currentTime += 0.7

    // Descent (1.5s)
    segments.push({
      startTime: currentTime,
      endTime: currentTime + 1.5,
      phase: 'descent',
      waypointIndex: wpIdx,
      flowerId,
      fromX: flower.x,
      fromY: flower.y,
      toX: flower.x,
      toY: flower.y,
    })
    currentTime += 1.5

    // Hover align (0.5s)
    segments.push({
      startTime: currentTime,
      endTime: currentTime + 0.5,
      phase: 'hover_align',
      waypointIndex: wpIdx,
      flowerId,
      fromX: flower.x,
      fromY: flower.y,
      toX: flower.x,
      toY: flower.y,
    })
    currentTime += 0.5

    // Pollinating (1.5s)
    segments.push({
      startTime: currentTime,
      endTime: currentTime + 1.5,
      phase: 'pollinating',
      waypointIndex: wpIdx,
      flowerId,
      fromX: flower.x,
      fromY: flower.y,
      toX: flower.x,
      toY: flower.y,
    })
    currentTime += 1.5

    // Ascent (1.2s)
    segments.push({
      startTime: currentTime,
      endTime: currentTime + 1.2,
      phase: 'ascent',
      waypointIndex: wpIdx,
      flowerId,
      fromX: flower.x,
      fromY: flower.y,
      toX: flower.x,
      toY: flower.y,
    })
    currentTime += 1.2

    currentPos = { x: flower.x, y: flower.y }
  }

  // Mission complete
  segments.push({
    startTime: currentTime,
    endTime: TOTAL_SECONDS,
    phase: 'mission_complete',
    waypointIndex: WAYPOINTS.length - 1,
    flowerId: null,
    fromX: currentPos.x,
    fromY: currentPos.y,
    toX: 2,
    toY: 2,
  })

  return segments
}

function findSegment(timeline: TimelineSegment[], time: number): TimelineSegment {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (time >= timeline[i].startTime) return timeline[i]
  }
  return timeline[0]
}

export function generateMission(): ReplayFrame[] {
  const frames: ReplayFrame[] = []
  const timeline = buildTimeline()
  const pollinatedFlowerIds: string[] = []
  const flowerStates: Record<string, FlowerCluster['state']> = {}
  const flowerConfidence: Record<string, number> = {}
  const eventLog: EventLogEntry[] = []

  for (const f of FLOWER_CLUSTERS) {
    flowerStates[f.id] = 'unscanned'
    flowerConfidence[f.id] = 0
  }

  const confidenceHistories: Record<string, number[]> = {}
  let globalConfidenceHistory: number[] = []

  for (let frameIdx = 0; frameIdx < TOTAL_FRAMES; frameIdx++) {
    const time = frameIdx / FPS
    const seg = findSegment(timeline, time)
    const segProgress = seg.endTime > seg.startTime
      ? Math.max(0, Math.min(1, (time - seg.startTime) / (seg.endTime - seg.startTime)))
      : 1

    // Drone position
    let droneX = lerp(seg.fromX, seg.toX, segProgress)
    let droneY = lerp(seg.fromY, seg.toY, segProgress)

    // Add slight wobble
    const wobble = 0.03
    droneX += Math.sin(time * 7.3) * wobble
    droneY += Math.cos(time * 5.9) * wobble

    // Drone altitude
    let droneZ = 0
    if (seg.phase === 'idle' || seg.phase === 'arming') {
      droneZ = 0
    } else if (seg.phase === 'takeoff') {
      droneZ = lerp(0, 8, segProgress)
    } else if (seg.phase === 'transit' || seg.phase === 'resume_transit' || seg.phase === 'scanning' || seg.phase === 'candidate_detected' || seg.phase === 'target_lock') {
      droneZ = 8 + Math.sin(time * 0.5) * 0.2
    } else if (seg.phase === 'descent') {
      droneZ = lerp(8, 1.5, segProgress)
    } else if (seg.phase === 'hover_align' || seg.phase === 'pollinating') {
      droneZ = 1.5 + Math.sin(time * 3) * 0.05
    } else if (seg.phase === 'ascent') {
      droneZ = lerp(1.5, 8, segProgress)
    } else if (seg.phase === 'mission_complete') {
      droneZ = lerp(8, 0, segProgress)
    }

    // Yaw
    let yaw = 0
    if (seg.toX !== seg.fromX || seg.toY !== seg.fromY) {
      yaw = angleTowards(seg.fromX, seg.fromY, seg.toX, seg.toY)
    }

    // Distance-driven sensor model
    const distanceInches = droneZ * 39.37
    const ofSample = getSensorAtDistance(distanceInches)
    const ofState = computeOpticalFlowState(ofSample, frameIdx)

    // Velocity from optical flow sensor (replaces time-based derivative)
    const vz = frames[frameIdx - 1] ? (droneZ - frames[frameIdx - 1].drone.z) * FPS : 0
    const yawRate = frames[frameIdx - 1] ? (yaw - frames[frameIdx - 1].drone.yaw) * FPS : 0

    const drone: DroneState = {
      x: droneX, y: droneY, z: droneZ,
      vx: ofState.vx,
      vy: ofState.vy,
      vz,
      yaw,
      yawRate,
    }

    // Battery: 100% -> 72% over 90s
    const batteryPercent = 100 - (28 * (time / TOTAL_SECONDS))

    // Signal strength: varies with distance from home
    const distFromHome = distance(droneX, droneY, 2, 2)
    const signalStrength = Math.max(60, 100 - distFromHome * 1.5)

    // Optical flow quality from sensor model
    const opticalFlowQuality = ofSample.flow_quality

    // Rangefinder
    const rangefinderDistance = droneZ + Math.sin(time * 12) * 0.02

    // EKF confidence
    const ekfConfidence = seg.phase === 'idle' || seg.phase === 'arming' ? 0 : 0.92 + Math.sin(time * 1.3) * 0.04

    // Flower detection confidence
    let flowerDetectionConf = 0
    let flowersInView = 0
    let targetLocked = false
    let pollinationTriggered = false

    const currentFlowerId = seg.flowerId
    if (currentFlowerId) {
      const flower = FLOWER_CLUSTERS.find(f => f.id === currentFlowerId)!
      const distToFlower = distance(droneX, droneY, flower.x, flower.y)

      if (['scanning', 'candidate_detected', 'target_lock', 'descent', 'hover_align', 'pollinating'].includes(seg.phase)) {
        const baseDist = Math.max(0, 1 - distToFlower / 3)
        flowersInView = Math.round(baseDist * flower.flowerCount)

        if (seg.phase === 'scanning') {
          flowerDetectionConf = lerp(0.2, 0.55, segProgress) + Math.sin(time * 8) * 0.03
          flowerStates[flower.id] = 'scanned'
        } else if (seg.phase === 'candidate_detected') {
          flowerDetectionConf = lerp(0.55, 0.75, segProgress)
          flowerStates[flower.id] = 'candidate'
        } else if (seg.phase === 'target_lock') {
          flowerDetectionConf = lerp(0.75, 0.95, segProgress)
          flowerStates[flower.id] = 'locked'
          targetLocked = true
        } else if (seg.phase === 'descent') {
          flowerDetectionConf = lerp(0.95, 0.98, segProgress)
          flowerStates[flower.id] = 'locked'
          targetLocked = true
        } else if (seg.phase === 'hover_align') {
          flowerDetectionConf = 0.98 + Math.sin(time * 5) * 0.01
          flowerStates[flower.id] = 'locked'
          targetLocked = true
        } else if (seg.phase === 'pollinating') {
          flowerDetectionConf = 1.0
          flowerStates[flower.id] = segProgress > 0.9 ? 'pollinated' : 'locked'
          targetLocked = true
          pollinationTriggered = true
        }

        // ── Optical flow coupling ───────────────────────────────────────────
        // Apply sensor quality to detection confidence as a soft modulation.
        // Range is bounded [0.6, 1.0] so phase transitions are never blocked.
        const stabilityFactor  = 0.6 + 0.4 * ofState.stability
        const strengthFactor   = 0.6 + 0.4 * (ofSample.strength / 255)
        flowerDetectionConf   *= stabilityFactor * strengthFactor

        // Blur penalty: fast optical flow implies camera motion blur
        const velMag = Math.sqrt(ofState.vx ** 2 + ofState.vy ** 2)
        if (velMag > 1.5) {
          flowerDetectionConf *= Math.max(0.75, 1 - (velMag - 1.5) * 0.1)
        }

        // Heavy degradation when quality is below reliable threshold
        if (ofSample.flow_quality < 50) {
          flowerDetectionConf *= 0.6
        }

        // Boost confidence during stable low-altitude hover
        if (ofState.stability > 0.7 && droneZ < 3) {
          flowerDetectionConf = Math.min(1.0, flowerDetectionConf * 1.15)
        }

        flowerDetectionConf = Math.max(0, Math.min(1, flowerDetectionConf))
      }
    }

    // After pollination, mark as pollinated
    for (const seg2 of timeline) {
      if (seg2.flowerId && time > seg2.endTime && seg2.phase === 'pollinating') {
        if (flowerStates[seg2.flowerId] !== 'pollinated') {
          flowerStates[seg2.flowerId] = 'pollinated'
        }
        if (!pollinatedFlowerIds.includes(seg2.flowerId)) {
          pollinatedFlowerIds.push(seg2.flowerId)
        }
      }
    }

    // Track pollinated flowers for current frame
    const currentPollinated: string[] = []
    for (const fid of TARGET_FLOWER_IDS) {
      const visitSeg = timeline.find(s => s.flowerId === fid && s.phase === 'pollinating')
      if (visitSeg && time > visitSeg.endTime) {
        currentPollinated.push(fid)
        if (flowerStates[fid] !== 'pollinated') flowerStates[fid] = 'pollinated'
      }
    }

    // Events
    const frameEvents: EventLogEntry[] = []

    // Generate events at phase transitions
    if (frameIdx > 0) {
      const prevSeg = findSegment(timeline, (frameIdx - 1) / FPS)
      if (prevSeg.phase !== seg.phase) {
        let msg = ''
        let level: EventLogEntry['level'] = 'event'
        switch (seg.phase) {
          case 'arming': msg = 'Arming sequence initiated'; break
          case 'takeoff': msg = 'Takeoff — climbing to 8m patrol altitude'; level = 'info'; break
          case 'transit': msg = `Transiting to WP${seg.waypointIndex}: ${WAYPOINTS[seg.waypointIndex]?.label}`; break
          case 'resume_transit': msg = `Resuming transit to WP${seg.waypointIndex}: ${WAYPOINTS[seg.waypointIndex]?.label}`; break
          case 'scanning': msg = `Scanning cluster at WP${seg.waypointIndex}`; level = 'info'; break
          case 'candidate_detected': msg = `Candidate flower detected — ID: ${seg.flowerId}`; level = 'warn'; break
          case 'target_lock': msg = `TARGET LOCKED — ${seg.flowerId}`; level = 'event'; break
          case 'descent': msg = `Initiating descent to hover altitude`; level = 'info'; break
          case 'hover_align': msg = `Hover alignment at 1.5m`; level = 'info'; break
          case 'pollinating': msg = `POLLINATION TRIGGERED — ${seg.flowerId}`; level = 'success'; break
          case 'ascent': msg = `Ascent — climbing back to patrol altitude`; level = 'info'; break
          case 'mission_complete': msg = `MISSION COMPLETE — ${currentPollinated.length} flowers pollinated`; level = 'success'; break
        }
        if (msg) {
          frameEvents.push({ timestamp: time, message: msg, level })
          eventLog.push({ timestamp: time, message: msg, level })
        }
      }
    } else {
      frameEvents.push({ timestamp: 0, message: 'Mission replay initialized', level: 'info' })
      eventLog.push({ timestamp: 0, message: 'Mission replay initialized', level: 'info' })
    }

    // Build camera analysis
    const visibleFlowerIds: string[] = []
    const boundingBoxes: CameraAnalysisState['boundingBoxes'] = []

    if (seg.flowerId) {
      const flower = FLOWER_CLUSTERS.find(f => f.id === seg.flowerId)
      if (flower) {
        visibleFlowerIds.push(flower.id)
        // Simulate bounding box
        const bbSize = lerp(0.3, 0.6, segProgress)
        boundingBoxes.push({
          flowerId: flower.id,
          x: 0.5 - bbSize / 2 + Math.sin(time * 2) * 0.02,
          y: 0.5 - bbSize / 2 + Math.cos(time * 2) * 0.02,
          w: bbSize,
          h: bbSize,
          confidence: flowerDetectionConf,
        })
      }
    }

    // Update global confidence history
    globalConfidenceHistory.push(flowerDetectionConf)
    if (globalConfidenceHistory.length > 50) globalConfidenceHistory = globalConfidenceHistory.slice(-50)

    const sensor: SensorState = {
      opticalFlowQuality,
      flowVelocityX: ofState.vx,
      flowVelocityY: ofState.vy,
      rangefinderDistance,
      sonarEstimate: rangefinderDistance + Math.sin(time * 8) * 0.03,
      ekfConfidence,
      flowerDetectionConfidence: flowerDetectionConf,
      flowersInView,
      targetLocked,
      pollinationTriggered,
      batteryPercent,
      signalStrength,
      ofStrength:          ofSample.strength,
      ofPrecision:         ofSample.precision,
      ofStability:         ofState.stability,
      ofNoise:             ofState.noise,
      ofEffectiveQuality:  ofState.effectiveQuality,
      sensorDistanceMm:    ofSample.sensor_distance,
      distanceInches,
    }

    const mission: MissionState = {
      phase: seg.phase,
      currentWaypointIndex: seg.waypointIndex,
      currentTargetFlowerId: seg.flowerId,
      pollinatedFlowerIds: [...currentPollinated],
      totalFlowers: TARGET_FLOWER_IDS.length,
      elapsedSeconds: time,
    }

    const camera: CameraAnalysisState = {
      visibleFlowerIds,
      candidateFlowerId: seg.phase === 'candidate_detected' ? seg.flowerId : null,
      lockedFlowerId: ['target_lock', 'descent', 'hover_align', 'pollinating'].includes(seg.phase) ? seg.flowerId : null,
      confidenceHistory: [...globalConfidenceHistory],
      boundingBoxes,
    }

    // Current flower states snapshot
    const flowerSnapshot: FlowerCluster[] = FLOWER_CLUSTERS.map(f => ({
      ...f,
      state: flowerStates[f.id] || 'unscanned',
      confidence: f.id === seg.flowerId ? flowerDetectionConf : (flowerStates[f.id] === 'pollinated' ? 1 : 0),
    }))

    frames.push({
      time,
      drone,
      sensor,
      mission,
      camera,
      flowers: flowerSnapshot,
      events: frameEvents,
    })
  }

  return frames
}

// Pre-generate frames (expensive but done once)
let _cachedFrames: ReplayFrame[] | null = null

export function getMissionFrames(): ReplayFrame[] {
  if (!_cachedFrames) {
    _cachedFrames = generateMission()
  }
  return _cachedFrames
}
