import type { OpticalFlowSample } from '../data/loadOpticalFlowCSV'

export interface OpticalFlowState {
  vx: number              // scaled optical flow velocity X (m/s equivalent)
  vy: number              // scaled optical flow velocity Y (m/s equivalent)
  stability: number       // 0-1 sensor stability index
  noise: number           // 0-1 noise level
  normalizedStrength: number  // 0-1 signal strength
  effectiveQuality: number    // 0-255 quality weighted by strength and precision
  precisionWeight: number     // 0-1 precision contribution
}

export function computeOpticalFlowState(sample: OpticalFlowSample): OpticalFlowState {
  const distance = sample.distance_in

  // Velocity scaling: optical flow apparent motion scales linearly with altitude
  // distance is in inches; dividing by 1000 keeps the output in a reasonable m/s range
  const vx = sample.flow_vel_x * (distance / 1000)
  const vy = sample.flow_vel_y * (distance / 1000)

  // Stability derived from flow quality.
  // 150 is treated as the "full stability" reference from the CSV peak (max ≈ 150 at 3m).
  const stability = Math.min(1, sample.flow_quality / 150)

  // Noise inversely proportional to stability, scaled to stay small
  const noise = (1 - stability) * 0.15

  // Signal strength normalised from 0-255 sensor range
  const normalizedStrength = sample.strength / 255

  // Precision weight: higher precision number = less precise (larger measurement error)
  const precisionWeight = 1 / Math.max(1, sample.precision)

  // Effective quality: raw quality weighted by normalised strength and precision
  const effectiveQuality = sample.flow_quality * normalizedStrength * precisionWeight

  return {
    vx,
    vy,
    stability,
    noise,
    normalizedStrength,
    effectiveQuality,
    precisionWeight,
  }
}
