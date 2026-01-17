# Claude Code Project Memory — Pollinator Drone Simulator

## Project Overview
A polished Preact + TypeScript + Vite frontend simulation web app for an autonomous smart pollinator drone. The app replays a pre-generated 90-second mission where a drone visits 8 flower clusters in a 20m × 20m garden, detecting, locking, and pollinating each flower using simulated Pixhawk sensor fusion.

## Vision
Mission-control-aesthetic dark mode engineering dashboard showing synchronized real-time telemetry, top-down garden view, altitude side view, and camera zoom panel — all driven by a centralized frame-based replay engine.

## Architecture Decisions

### Simulation Model
- **Deterministic, pre-generated frames**: 2700 frames at 30fps × 90s = ~2700 ReplayFrame objects
- **No randomness during replay**: all data generated once in `missionGenerator.ts` using a seeded PRNG
- **Frame index drives everything**: the replay engine advances a frame index, all panels read from `currentFrame`
- **No physics library**: custom linear interpolation of positions along waypoint routes

### State Management
- `useReplayEngine` hook (Preact hooks) owns all simulation state
- All panels receive `frame: ReplayFrame` as props — no panel-local simulation state
- Position history and altitude history tracked as sliding windows in the engine

### Rendering
- All visual panels are pure SVG (no canvas, no WebGL)
- SVG filters for glow effects (`feGaussianBlur`, `feDropShadow`)
- CSS animations for rotor spin and pulse effects
- Deterministic seeded offsets for organic flower placement

### Replay Engine
- `requestAnimationFrame` loop accumulates delta time and advances frame index
- Speed multiplier (1x/2x/4x) applied to delta time accumulation
- `seekTo(time)` rebuilds history slices deterministically
- Accumulated event log maintained as a sliding window of last 100 events

## Folder Structure
```
src/
  app/
    App.tsx                 — Main layout: 4 panels + header + replay controls
  components/
    TopDownView/
      TopDownView.tsx       — SVG garden overview, drone, flowers, waypoints, trail
    SideView/
      SideView.tsx          — SVG altitude cross-section with drone side profile
    TelemetryPanel/
      TelemetryPanel.tsx    — Engineering HUD with all sensor/mission values
    ZoomPanel/
      ZoomPanel.tsx         — Camera/analysis view: bounding boxes, reticle, sparkles
    ReplayControls/
      ReplayControls.tsx    — Play/pause/reset/speed/scrubber bar
  simulation/
    replayEngine.ts         — useReplayEngine hook: RAF loop, frame index, history
  data/
    missionGenerator.ts     — Generates 2700 ReplayFrame objects deterministically
  models/
    types.ts                — All TypeScript interfaces
    index.ts                — Re-exports
  styles/
    globals.css             — Tailwind + dark base + keyframe animations
```

## Mission Phase Definitions
| Phase | Description |
|-------|-------------|
| `idle` | Drone on ground, systems off |
| `arming` | Pre-flight checks, motor arm sequence |
| `takeoff` | Climbing from 0m to 8m patrol altitude |
| `transit` | First flight to initial waypoint |
| `scanning` | Hovering over cluster, camera scanning for flowers |
| `candidate_detected` | Potential target identified, confidence building |
| `target_lock` | High confidence lock achieved (>75%) |
| `descent` | Descending from 8m to 1.5m hover altitude |
| `hover_align` | Precision alignment at ≈5ft hover band |
| `pollinating` | Pollination mechanism triggered |
| `ascent` | Climbing back to 8m patrol altitude |
| `resume_transit` | Transiting to next waypoint |
| `mission_complete` | All targets visited, returning home |

## Telemetry Model
- **Position**: x, y (meters in 20×20 garden), z (altitude)
- **Velocity**: vx, vy, vz (m/s), speed (2D magnitude)
- **Attitude**: yaw (degrees clockwise from north), yawRate (°/s)
- **Battery**: 100% → ~72% over 90 seconds
- **Signal**: distance-based degradation from home base
- **Optical Flow**: quality 0-255, velocity x/y
- **Rangefinder**: current altitude above ground
- **EKF Confidence**: 0.92-0.96 range during flight
- **Detection Confidence**: 0→1 as drone approaches and scans flower

## Garden Layout
- 20m × 20m garden
- 10 flower clusters at various positions (8 visited in mission)
- Drone home base at (2, 2)
- 9 waypoints visiting 8 target clusters
- Each cluster: 4-7 individual flowers with organic SVG rendering

## Git Milestone Log
1. `Initialize Preact TypeScript simulation scaffold` — all phases scaffolded in first commit
2. `Add .gitignore to exclude node_modules and dist`
3. Phase commits: models, engine, all 5 components, polish, validation

## Stack
- Preact 10 + TypeScript 5
- Vite 5 + @preact/preset-vite
- Tailwind CSS v4 + @tailwindcss/vite
- SVG for all visual panels
- No external state management library
- No physics library
