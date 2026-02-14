import type { OpticalFlowSample } from '../data/loadOpticalFlowCSV'

export interface OpticalFlowState {
  vx: number              // scaled optical flow velocity X (m/s equivalent)
  vy: number              // scaled optical flow velocity Y (m/s equivalent)
  stability: number       // 0-1 sensor stability index
  noise: number           // 0-1 noise level
  normalizedStrength: number  // 0-1 signal strength
  effectiveQuality: number    // 0-255 quality weighted by strength and precision
  precisionWeight: number     // 0-1 precision contribution
  degraded: boolean       // true when sensor is in degraded / unreliable state
  driftX: number          // deterministic drift added when quality is below threshold
  driftY: number
  hoverInstabilityX: number  // small oscillation injected during low-altitude hover
  hoverInstabilityY: number
}

// Lightweight deterministic "random" for reproducible degradation without seeded PRNG import
function pseudoRand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export function computeOpticalFlowState(
  sample: OpticalFlowSample,
  frameIndex: number = 0,
): OpticalFlowState {
  const distance = sample.distance_in

  // ── Base physics ──────────────────────────────────────────────────────────
  const vx = sample.flow_vel_x * (distance / 1000)
  const vy = sample.flow_vel_y * (distance / 1000)

  const stability = Math.min(1, sample.flow_quality / 150)
  const noise     = (1 - stability) * 0.15
  const normalizedStrength = sample.strength / 255
  const precisionWeight    = 1 / Math.max(1, sample.precision)
  const effectiveQuality   = sample.flow_quality * normalizedStrength * precisionWeight

  // ── Edge-case degradation ─────────────────────────────────────────────────

  // 1. Distance > 5m (197 in): progressive quality and stability reduction
  let degradedStability = stability
  let degradedEffectiveQuality = effectiveQuality
  let degraded = false
  if (distance > 197) {
    const excess = (distance - 197) / 118  // 0-1 over the 197-315 in range
    degradedStability         = stability         * (1 - excess * 0.6)
    degradedEffectiveQuality  = effectiveQuality  * (1 - excess * 0.7)
    degraded = true
  }

  // 2. Low strength: amplified noise
  let finalNoise = noise
  if (sample.strength < 60) {
    finalNoise = noise + (1 - sample.strength / 60) * 0.25
  }

  // 3. Drift when quality is below reliable threshold (< 50)
  let driftX = 0
  let driftY = 0
  if (sample.flow_quality < 50) {
    const driftSeed = frameIndex * 0.03
    driftX = (pseudoRand(driftSeed)       - 0.5) * 0.4
    driftY = (pseudoRand(driftSeed + 100) - 0.5) * 0.4
  }

  // 4. Hover instability: small sinusoidal oscillation at low altitude (< 3m / ~118 in)
  let hoverInstabilityX = 0
  let hoverInstabilityY = 0
  if (distance < 118 && sample.flow_quality > 30) {
    const t = frameIndex * (1 / 30)
    hoverInstabilityX = Math.sin(t * 4.3) * 0.05
    hoverInstabilityY = Math.cos(t * 3.7) * 0.05
  }

  return {
    vx: vx + driftX + hoverInstabilityX,
    vy: vy + driftY + hoverInstabilityY,
    stability:         degradedStability,
    noise:             finalNoise,
    normalizedStrength,
    effectiveQuality:  degradedEffectiveQuality,
    precisionWeight,
    degraded,
    driftX,
    driftY,
    hoverInstabilityX,
    hoverInstabilityY,
  }
}
