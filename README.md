# Smart Pollinator Mission Replay

An autonomous pollinator drone mission visualization system — a polished, dark-mode engineering dashboard built with Preact + TypeScript + Vite.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## What It Shows

A full 90-second drone mission replay across a 20m × 20m garden, visiting 8 flower clusters and pollinating each one. The simulation runs at 30fps with 2700+ pre-generated frames.

### Panels

**Top-Down Mission View** (top-left)
- SVG garden with organic flower clusters (petals, pistils, stems, leaves)
- Quadrotor drone with spinning rotors, camera footprint cone
- Waypoint route with active/completed states
- Motion trail (last 90 frames)
- State-based flower coloring: unscanned → scanned → candidate → locked → pollinated

**Altitude / Side View** (bottom-left)
- Cross-section altitude chart (0–10m)
- Drone side profile with rangefinder beam
- Patrol altitude (8m), hover band (≈5ft / 1.3–1.8m) highlighted
- Altitude trace history
- Phase annotations (descent ↓, ascent ↑)

**Telemetry Dashboard** (top-right)
- Real-time position, velocity, yaw, yaw rate
- Battery and signal strength gauges
- Optical flow quality, rangefinder, sonar, EKF confidence
- Flower detection confidence gauge
- Mission progress: waypoint index, flowers pollinated
- Auto-scrolling color-coded event log

**Camera / Flower Analysis** (bottom-right)
- Simulates drone camera view
- Bounding boxes with confidence labels during candidate detection
- Crosshair reticle + corner brackets when target locked
- Pulsing animation + sparkle particles during pollination
- Confidence history sparkline

### Replay Controls
- Play / Pause
- Reset
- Speed: 1x / 2x / 4x
- Timeline scrubber with current/total time

## Tech Stack

- **Frontend**: Preact + TypeScript + Vite
- **Styling**: Tailwind CSS v4 + dark engineering aesthetic
- **Rendering**: Pure SVG for all visual panels
- **Simulation**: Deterministic pre-generated frame replay (no random state during playback)
