import { getFullOpticalFlowDataset } from '../data/opticalFlowDataset'
import type { OpticalFlowSample } from '../data/loadOpticalFlowCSV'

// Maximum distance covered by the dataset (inches)
const MAX_DISTANCE_IN = 315

export function getSensorAtDistance(distanceInches: number): OpticalFlowSample {
  const dataset = getFullOpticalFlowDataset()

  // Clamp to dataset bounds — no extrapolation beyond known data
  const clamped = Math.max(0, Math.min(MAX_DISTANCE_IN, distanceInches))

  // Find the bracketing pair of samples
  let lower = dataset[0]
  let upper = dataset[dataset.length - 1]

  for (let i = 0; i < dataset.length - 1; i++) {
    if (dataset[i].distance_in <= clamped && dataset[i + 1].distance_in >= clamped) {
      lower = dataset[i]
      upper = dataset[i + 1]
      break
    }
  }

  // Exact match — no interpolation needed
  if (lower.distance_in === upper.distance_in) return lower

  // Normalised interpolation parameter
  const t = (clamped - lower.distance_in) / (upper.distance_in - lower.distance_in)

  // Smooth-step easing for gentle transitions between samples
  const st = t * t * (3 - 2 * t)

  function lerp(a: number, b: number): number {
    return a + (b - a) * st
  }

  return {
    distance_in:     clamped,
    sensor_distance: Math.round(lerp(lower.sensor_distance, upper.sensor_distance)),
    strength:        Math.round(lerp(lower.strength,        upper.strength)),
    precision:       Math.round(lerp(lower.precision,       upper.precision)),
    status:          upper.status,
    flow_vel_x:      lerp(lower.flow_vel_x, upper.flow_vel_x),
    flow_vel_y:      lerp(lower.flow_vel_y, upper.flow_vel_y),
    flow_quality:    Math.round(lerp(lower.flow_quality, upper.flow_quality)),
    flow_state:      upper.flow_state,
  }
}
