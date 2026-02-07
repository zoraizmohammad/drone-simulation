import { RAW_OPTICAL_FLOW_DATA, type OpticalFlowSample } from './loadOpticalFlowCSV'

// Generate synthetic midpoint samples (6-inch steps) between real CSV rows,
// plus a few extrapolated points slightly beyond the real data range.
function generateSyntheticSamples(): OpticalFlowSample[] {
  const real = RAW_OPTICAL_FLOW_DATA
  const synthetic: OpticalFlowSample[] = []

  // Midpoints between each consecutive real sample pair
  for (let i = 0; i < real.length - 1; i++) {
    const a = real[i]
    const b = real[i + 1]
    const t = 0.5
    synthetic.push({
      distance_in:     a.distance_in + (b.distance_in - a.distance_in) * t,
      sensor_distance: Math.round(a.sensor_distance + (b.sensor_distance - a.sensor_distance) * t),
      strength:        Math.round(a.strength        + (b.strength        - a.strength)        * t),
      precision:       Math.round(a.precision       + (b.precision       - a.precision)       * t),
      status:          1,
      flow_vel_x:      a.flow_vel_x + (b.flow_vel_x - a.flow_vel_x) * t,
      flow_vel_y:      a.flow_vel_y + (b.flow_vel_y - a.flow_vel_y) * t,
      flow_quality:    Math.round(a.flow_quality + (b.flow_quality - a.flow_quality) * t),
      flow_state:      1,
    })
  }

  // Add a few extrapolated points beyond the real data range (up to ~8m / 315 in)
  const last = real[real.length - 1]
  const extraDistances = [288, 300, 315]
  for (const d of extraDistances) {
    const decay = (d - last.distance_in) / 100
    synthetic.push({
      distance_in:     d,
      sensor_distance: Math.round(last.sensor_distance + (d - last.distance_in) * 2),
      strength:        Math.max(5, Math.round(last.strength - decay * 10)),
      precision:       Math.min(12, last.precision + 1),
      status:          1,
      flow_vel_x:      0,
      flow_vel_y:      0,
      flow_quality:    Math.max(10, Math.round(last.flow_quality - decay * 15)),
      flow_state:      1,
    })
  }

  return synthetic
}

let _cachedDataset: OpticalFlowSample[] | null = null

export function getFullOpticalFlowDataset(): OpticalFlowSample[] {
  if (_cachedDataset) return _cachedDataset

  const synthetic = generateSyntheticSamples()

  // Build map keyed by distance_in; real data overwrites synthetic for any collision
  const map = new Map<number, OpticalFlowSample>()
  for (const s of synthetic) map.set(s.distance_in, s)
  for (const r of RAW_OPTICAL_FLOW_DATA) map.set(r.distance_in, r) // real takes priority

  _cachedDataset = Array.from(map.values()).sort((a, b) => a.distance_in - b.distance_in)
  return _cachedDataset
}
