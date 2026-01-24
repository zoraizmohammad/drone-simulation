import type { ReplayFrame } from '../../models/types'
import { FLOWER_CLUSTERS } from '../../data/missionGenerator'
import type { AnalysisFrame, FlowerRenderState, FrustumState } from './types'
import { CameraAnalysisScene } from './CameraAnalysisScene'

// Fixed camera-space positions for the 800x500 scene
const CAMERA_POSITIONS: Record<string, { cx: number; cy: number; scale: number }> = {
  f1:  { cx: 110, cy: 155, scale: 1.0 },
  f2:  { cx: 250, cy: 130, scale: 0.85 },
  f3:  { cx: 380, cy: 160, scale: 1.1 },
  f4:  { cx: 530, cy: 140, scale: 0.9 },
  f5:  { cx: 680, cy: 155, scale: 1.05 },
  f6:  { cx: 140, cy: 300, scale: 0.95 },
  f7:  { cx: 290, cy: 320, scale: 1.0 },
  f8:  { cx: 430, cy: 295, scale: 1.15 },
  f9:  { cx: 590, cy: 315, scale: 0.85 },
  f10: { cx: 720, cy: 300, scale: 1.0 },
}

const tightnessMap: Record<string, number> = {
  idle: 0, arming: 0, takeoff: 0.1, transit: 0.15, resume_transit: 0.15,
  scanning: 0.3, candidate_detected: 0.55, target_lock: 0.75,
  descent: 0.85, hover_align: 0.95, pollinating: 1.0,
  ascent: 0.7, mission_complete: 0.3,
}

function clamp(v: number, lo = 10, hi = 790) {
  return Math.max(lo, Math.min(hi, v))
}

function computeAnalysisFrame(frame: ReplayFrame): AnalysisFrame {
  const { mission, sensor, camera, flowers, time, drone } = frame
  const phase = mission.phase
  const targetId = mission.currentTargetFlowerId
  const tightness = tightnessMap[phase] ?? 0.15

  // Build flower render states
  const flowerRenderStates: FlowerRenderState[] = flowers.map(f => {
    const cluster = FLOWER_CLUSTERS.find(c => c.id === f.id)
    const pos = CAMERA_POSITIONS[f.id]
    const isTarget = f.id === targetId
    const rngSeed = parseInt(f.id.replace('f', '')) * 17

    // When this flower is the active target in certain phases, zoom it to center
    const shouldZoomToCenter = isTarget && ['target_lock','descent','hover_align','pollinating','ascent'].includes(phase)

    let cx: number, cy: number, scale: number
    if (shouldZoomToCenter) {
      cx = 400
      cy = 230
      scale = 2.0
    } else if (pos) {
      cx = clamp(pos.cx)
      cy = Math.max(10, Math.min(490, pos.cy))
      scale = pos.scale
    } else {
      // Fallback: spread across scene
      const idx = parseInt(f.id.replace('f', '')) - 1
      cx = clamp(80 + (idx % 5) * 150)
      cy = Math.max(10, Math.min(490, 150 + Math.floor(idx / 5) * 160))
      scale = 1.0
    }

    return {
      id: f.id,
      cx,
      cy,
      scale,
      color: cluster?.color ?? '#c084fc',
      accentColor: cluster?.accentColor ?? '#fbbf24',
      rngSeed,
      state: f.state,
      confidence: f.confidence,
      isTarget,
    }
  })

  // Frustum center: track target if there is one, otherwise scene center
  let frustumCenterX = 0.5
  let frustumCenterY = 0.5
  if (targetId) {
    const targetRender = flowerRenderStates.find(f => f.id === targetId)
    if (targetRender) {
      frustumCenterX = targetRender.cx / 800
      frustumCenterY = targetRender.cy / 500
    }
  }

  const frustum: FrustumState = {
    centerX: frustumCenterX,
    centerY: frustumCenterY,
    tightness,
  }

  return {
    phase,
    targetId,
    confidence: sensor.flowerDetectionConfidence,
    flowersInView: sensor.flowersInView,
    targetLocked: sensor.targetLocked,
    pollinationActive: phase === 'pollinating',
    pollinatedIds: mission.pollinatedFlowerIds,
    altitude: drone.z,
    time,
    confidenceHistory: camera.confidenceHistory,
    flowers: flowerRenderStates,
    frustum,
  }
}

interface Props { frame: ReplayFrame }

export function CameraAnalysisPanel({ frame }: Props) {
  const af = computeAnalysisFrame(frame)

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', background: '#020617' }}>
      <CameraAnalysisScene af={af} />
    </div>
  )
}
