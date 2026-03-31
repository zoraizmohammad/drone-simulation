import type { AnalysisFrame } from './types'
import { FlowerClusterRenderer } from './FlowerClusterRenderer'
import { DetectionHeatmap } from './DetectionHeatmap'
import { DetectionReticle } from './DetectionReticle'
import { PollinationEffect } from './PollinationEffect'
import { MissionPhaseOverlay } from './MissionPhaseOverlay'
import { AnalysisHud } from './AnalysisHud'
import { FlowVectorOverlay } from './FlowVectorOverlay'
import { OpticalFlowHud } from './OpticalFlowHud'

const VW = 800
const VH = 500

export function CameraAnalysisScene({ af }: { af: AnalysisFrame }) {
  const { phase, targetId, confidence, flowersInView, targetLocked,
          pollinationActive, pollinatedIds, altitude, time,
          confidenceHistory, flowers, frustum,
          ofVx, ofVy, ofQuality, ofStrength, ofPrecision, ofStability, ofNoise,
          sensorDistanceMm, distanceInches } = af

  // Jitter offset when sensor quality is low (deterministic from time)
  const jitter = ofQuality < 50 ? (1 - ofQuality / 50) * 2.5 : 0
  const jx = jitter * Math.sin(time * 23.7)
  const jy = jitter * Math.cos(time * 19.1)

  // Center of the reticle (in SVG space)
  const reticleCx = Math.max(10, Math.min(790, frustum.centerX * VW))
  const reticleCy = Math.max(10, Math.min(490, frustum.centerY * VH))

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${VW} ${VH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
    >
      <defs>
        {/* Vignette */}
        <radialGradient id="ca-vig" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="transparent" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.65" />
        </radialGradient>
        {/* Scanline overlay */}
        <pattern id="ca-scanlines" x="0" y="0" width="2" height="3" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="2" height="1" fill="#000" opacity="0.06" />
        </pattern>
        {/* Glow filter */}
        <filter id="ca-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={VW} height={VH} fill="#020617" />

      {/* Grid lines (very subtle) */}
      {Array.from({ length: 8 }, (_, i) => (
        <line key={`gx${i}`}
          x1={(i + 1) * (VW / 9)} y1={0} x2={(i + 1) * (VW / 9)} y2={VH}
          stroke="#0f172a" strokeWidth={0.5} />
      ))}
      {Array.from({ length: 5 }, (_, i) => (
        <line key={`gy${i}`}
          x1={0} y1={(i + 1) * (VH / 6)} x2={VW} y2={(i + 1) * (VH / 6)}
          stroke="#0f172a" strokeWidth={0.5} />
      ))}

      {/* Flowers (jitter applied when sensor quality is low) */}
      <g transform={`translate(${jx}, ${jy})`}>
        {flowers.map(f => (
          <FlowerClusterRenderer key={f.id} flower={f} />
        ))}
      </g>

      {/* Heatmap */}
      <DetectionHeatmap flowers={flowers} phase={phase} qualityIntensity={ofQuality / 255} />

      {/* Reticle */}
      <DetectionReticle cx={reticleCx} cy={reticleCy}
        tightness={frustum.tightness} phase={phase} confidence={confidence} />

      {/* Pollination effect */}
      <PollinationEffect cx={reticleCx} cy={reticleCy} time={time} active={pollinationActive} />

      {/* Scanline overlay */}
      <rect x={0} y={0} width={VW} height={VH} fill="url(#ca-scanlines)" pointerEvents="none" />

      {/* Vignette */}
      <rect x={0} y={0} width={VW} height={VH} fill="url(#ca-vig)" pointerEvents="none" />

      {/* Phase overlay (banners, pre-flight boxes, etc.) */}
      <MissionPhaseOverlay
        phase={phase}
        targetId={targetId}
        confidence={confidence}
        altitude={altitude}
        pollinatedCount={pollinatedIds.length}
        totalFlowers={flowers.length}
      />

      {/* Optical flow vector overlay */}
      <FlowVectorOverlay
        vx={ofVx} vy={ofVy}
        quality={ofQuality}
        stability={ofStability}
        time={time}
      />

      {/* Optical flow sensor data HUD (top-right) */}
      <OpticalFlowHud
        vx={ofVx} vy={ofVy}
        quality={ofQuality}
        strength={ofStrength}
        precision={ofPrecision}
        stability={ofStability}
        sensorDistanceMm={sensorDistanceMm}
        distanceInches={distanceInches}
      />

      {/* HUD strip */}
      <AnalysisHud
        phase={phase}
        confidence={confidence}
        flowersInView={flowersInView}
        targetLocked={targetLocked}
        pollinationActive={pollinationActive}
        confidenceHistory={confidenceHistory}
      />
    </svg>
  )
}
