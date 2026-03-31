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
      ZoomPanel.tsx         — Thin wrapper that delegates to CameraAnalysisPanel
    ReplayControls/
      ReplayControls.tsx    — Play/pause/reset/speed/scrubber bar
    camera-analysis/
      types.ts              — Local types: AnalysisFrame, FlowerRenderState, FrustumState
      CameraAnalysisPanel.tsx — Computes AnalysisFrame from ReplayFrame, owns layout div
      CameraAnalysisScene.tsx — SVG scene compositor (800x500 viewBox), assembles sub-components
      FlowerClusterRenderer.tsx — Seeded-RNG organic SVG flowers (petals, stem, leaves, state rings)
      DetectionReticle.tsx  — Frustum/targeting overlay: corner brackets, crosshair, center dot
      DetectionHeatmap.tsx  — Per-flower radial-gradient confidence heat blobs
      PollinationEffect.tsx — Orbiting sparkle particles + pulse rings during pollinating phase
      MissionPhaseOverlay.tsx — Phase-specific SVG banners for all 13 mission phases
      AnalysisHud.tsx       — Bottom HUD strip: phase chip, confidence bar, sparkline, indicators
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

## Camera Analysis Panel Architecture

The Camera / Flower Analysis panel (bottom-right, flex 35) uses a layered SVG architecture:

### Layout Fix (root cause of black panel)
The panel rendered as a black square because the inner container lacked `position: relative`. The absolutely-positioned SVG (`position: absolute; inset: 0`) had no positioned ancestor to anchor to, so it collapsed to zero size. Fixed by adding `position: relative` and explicit `minHeight: 320px` to the container div in App.tsx.

### AnalysisFrame Pipeline
```
ReplayFrame  →  computeAnalysisFrame()  →  AnalysisFrame  →  CameraAnalysisScene
```
- `computeAnalysisFrame` maps `frame.flowers` to `FlowerRenderState` with fixed camera-space positions
- Target flower zooms to scene center (400, 230) at scale 2.0 during target_lock / descent / hover_align / pollinating / ascent
- `FrustumState.tightness` drives reticle tightness: 0 (transit) → 1.0 (pollinating)

### Fixed Flower Positions (800x500 camera space)
Two rows of up to 5 flowers each, with center area reserved for target zoom. IDs f1-f10 map to deterministic `CAMERA_POSITIONS` entries so the scene looks like a real garden view.

### SVG Gradient ID Namespacing
All gradient/filter IDs are prefixed with `ca-` to avoid collisions with the other three panels' `zpVig`, `zpGlow`, etc.

### Phase Coverage
All 13 `MissionPhase` values are handled in `MissionPhaseOverlay`:
`idle`, `arming`, `takeoff`, `transit`, `resume_transit`, `scanning`, `candidate_detected`, `target_lock`, `descent`, `hover_align`, `pollinating`, `ascent`, `mission_complete`

## Optical Flow Sensor Model

### Architecture Decision: Distance-Driven Simulation
Sensor values are no longer derived from mission time. Every frame computes `distanceInches = drone.z * 39.37`, then looks up the corresponding sensor state from the optical flow dataset. This makes the simulation physically grounded: sensors respond to altitude, not elapsed time.

### Data Sources
- **Real data**: `raw_opticalflow_data.csv` in the project root — 24 rows from 0 to 276 inches (0–7.01m) at 12-inch intervals. Fields: `distance_in`, `sensor_distance` (mm), `strength`, `precision`, `status`, `flow_vel_x`, `flow_vel_y`, `flow_quality`, `flow_state`.
- **Synthetic data**: midpoint interpolated rows (6-inch step resolution) + 3 extrapolated rows beyond 276 in for patrol altitude coverage.
- **Merge strategy**: real rows always override synthetic rows at the same distance. Final dataset sorted by `distance_in`.

### Interpolation Method (`sensorInterpolation.ts`)
- Binary search for bracketing pair around target distance
- Smooth-step easing: `t = t² × (3 − 2t)` for gentle transitions
- Clamped to [0, 315] inches — no out-of-range extrapolation

### Physics Assumptions (`opticalFlowModel.ts`)
| Formula | Rationale |
|---|---|
| `vx = flow_vel_x × (distance_in / 1000)` | Optical flow apparent motion scales with altitude |
| `stability = flow_quality / 150` | 150 is peak quality from real sensor data at ~3m |
| `noise = (1 − stability) × 0.15` | Noise inversely proportional to quality |
| `effectiveQuality = quality × strength/255 × 1/precision` | Weighted by signal integrity |

### Sensor Degradation Thresholds
- **distance > 197 in (5m)**: progressive stability/quality reduction (up to −60%/−70% at 315 in)
- **strength < 60**: amplified noise
- **flow_quality < 50**: deterministic drift injected (`pseudoRand` seeded by frame index)
- **distance < 118 in (3m)**: sinusoidal hover instability oscillation added to vx/vy

### CV Coupling
Detection confidence is modulated by sensor quality each frame:
- `stabilityFactor = 0.6 + 0.4 × stability` (never below 60%)
- `strengthFactor = 0.6 + 0.4 × (strength/255)` (never below 60%)
- `confidence *= stabilityFactor × strengthFactor`
- Blur penalty if |velocity| > 1.5 m/s
- Heavy reduction (×0.6) if flow_quality < 50
- 15% boost if stable hover (stability > 0.7 and altitude < 3m)

### Visualization System (Camera Analysis Panel)
New components added to `src/components/camera-analysis/`:
- **`FlowVectorOverlay.tsx`**: Flow field grid lines + primary velocity arrow + arrowhead. Colour: cyan (stable) / amber (moderate) / red (degraded). CSS class `of-vector-stable` or `of-vector-unstable` applies shimmer/flicker animation.
- **`OpticalFlowHud.tsx`**: Top-right translucent panel. Shows: DIST (in), SENSOR (mm), FLOW X/Y (m/s), QUALITY/255, STRENGTH, PRECISION, STABILITY %. Includes a stability bar gauge.
- **`DetectionHeatmap.tsx`** (updated): `qualityIntensity` prop scales blob opacity by sensor quality. CSS class `of-heatmap-pulse` for slow breathing animation.
- **`CameraAnalysisScene.tsx`** (updated):
  - Jitter: `jx/jy` offsets applied to flower group when quality < 50
  - Motion blur: SVG `feGaussianBlur` filter on flowers when |velocity| > 1.0 m/s
  - Stable hover: cyan glow ring at scene center when stability > 0.7 and altitude < 3m
  - Unstable tint: red-orange radial vignette when stability < 0.4, animated with `of-vector-unstable`

### New CSS Animations (`globals.css`)
| Class | Effect |
|---|---|
| `of-heatmap-pulse` | Slow opacity pulse on detection heat blobs (1.8s) |
| `of-vector-stable` | Gentle shimmer on flow arrows when stable (2.4s) |
| `of-vector-unstable` | Fast shimmer on flow arrows when degraded (0.6s) |
| `of-flicker` | Irregular opacity flicker on scene when very unstable |
| `of-stabilize` | One-shot flash on stabilization |

## Git Milestone Log
1. `Initialize Preact TypeScript simulation scaffold` — all phases scaffolded in first commit
2. `Add .gitignore to exclude node_modules and dist`
3. Phase commits: models, engine, all 5 components, polish, validation
4. `Fix camera analysis panel rendering and layout stability` — container layout fix + debug ZoomPanel
5. `Rebuild camera analysis panel — modular architecture, full phase coverage` — full production system
6. `Document upgraded camera analysis system in CLAUDE.md` — architecture notes
7. `Add CSV ingestion for raw optical flow data`
8. `Merge real sensor data with extrapolated distance model`
9. `Add distance-based sensor interpolation engine`
10. `Add physics-based optical flow + ToF sensor model`
11. `Convert simulation to distance-driven sensor model`
12. `Couple optical flow sensor state with CV detection model`
13. `Add optical flow visualization (vectors, heatmap, sensor HUD)`
14. `Add sensor degradation and failure modeling`
15. `Add advanced optical flow visual effects and stability cues`
16. `Document full optical flow simulation system and finalize integration`

## Stack
- Preact 10 + TypeScript 5
- Vite 5 + @preact/preset-vite
- Tailwind CSS v4 + @tailwindcss/vite
- SVG for all visual panels
- No external state management library
- No physics library
