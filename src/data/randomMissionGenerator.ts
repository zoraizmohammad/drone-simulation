import type { LiveFlower } from '../models/types'

const PALETTE: Array<{ color: string; accent: string }> = [
  { color: '#c084fc', accent: '#fbbf24' },
  { color: '#fbbf24', accent: '#f97316' },
  { color: '#f9a8d4', accent: '#ec4899' },
  { color: '#86efac', accent: '#22c55e' },
  { color: '#fde047', accent: '#f59e0b' },
  { color: '#7dd3fc', accent: '#0ea5e9' },
  { color: '#fca5a5', accent: '#ef4444' },
  { color: '#fdba74', accent: '#ea580c' },
  { color: '#a5b4fc', accent: '#818cf8' },
  { color: '#6ee7b7', accent: '#10b981' },
]

function seededRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff
    return s / 0x7fffffff
  }
}

export function generateRandomGarden(seed = Date.now()): LiveFlower[] {
  const rng = seededRng(seed)
  const count = 6 + Math.floor(rng() * 5) // 6-10 flowers
  const flowers: LiveFlower[] = []
  const MIN_SEP = 2.8
  const BORDER = 2.5

  let attempts = 0
  while (flowers.length < count && attempts < 500) {
    attempts++
    const x = BORDER + rng() * (20 - BORDER * 2)
    const y = BORDER + rng() * (20 - BORDER * 2)

    // Keep clear of home base
    if (Math.hypot(x - 2, y - 2) < 3) continue

    // Minimum separation
    if (flowers.some(f => Math.hypot(f.x - x, f.y - y) < MIN_SEP)) continue

    const idx = flowers.length % PALETTE.length
    const pal = PALETTE[Math.floor(rng() * PALETTE.length) % PALETTE.length]
    flowers.push({
      id: `r${idx + 1}`,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      radius: 0.7 + rng() * 0.5,
      flowerCount: 4 + Math.floor(rng() * 4),
      color: pal.color,
      accentColor: pal.accent,
      state: 'undiscovered',
      confidence: 0,
    })
  }

  return flowers
}

// Lawnmower passes covering the 20×20 garden.
// spacing: meters between vertical passes (default 4.5m).
// With 4.5m proximity detection radius → full coverage of the 2.5–17.5 flower zone.
// Alternating S→N and N→S to avoid long repositioning flights.
export function generateLawnmowerPath(spacing = 4.5): Array<{ x: number; y: number }> {
  const startX = 3.0
  const endX   = 18.0
  const path: Array<{ x: number; y: number }> = []
  let x = startX
  let southward = false

  while (x <= endX + 0.01) {
    const xr = Math.round(x * 10) / 10
    path.push({ x: xr, y: southward ? 18.0 : 2.0 })
    path.push({ x: xr, y: southward ? 2.0 : 18.0 })
    x += spacing
    southward = !southward
  }

  return path
}

export function computeTSPRoute(
  flowers: LiveFlower[],
  discoveredIds: string[],
): string[] {
  const targets = flowers.filter(f => discoveredIds.includes(f.id))
  if (targets.length === 0) return []

  const unvisited = [...targets]
  const route: string[] = []
  let cx = 2, cy = 2 // start from home

  while (unvisited.length > 0) {
    let best = unvisited[0]
    let bestDist = Infinity
    for (const f of unvisited) {
      const d = Math.hypot(f.x - cx, f.y - cy)
      if (d < bestDist) { bestDist = d; best = f }
    }
    route.push(best.id)
    cx = best.x; cy = best.y
    unvisited.splice(unvisited.indexOf(best), 1)
  }

  return route
}
