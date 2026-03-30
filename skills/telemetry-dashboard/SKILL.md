# Telemetry Dashboard Skill

## Purpose
Display real-time drone telemetry data — sensor readings, flight metrics, mission stats — in a readable, performant dashboard that updates every frame.

## Core Rules
- Dashboard reads directly from SimulationState — no derived state stored separately
- Updates are throttled for display (every N frames) to avoid flickering
- All values are formatted for human readability (units, precision)
- Dashboard must not cause re-renders of the simulation canvas

## Telemetry Panels

### Flight Metrics
- Position (x, y, z) in meters
- Velocity (vx, vy, vz) and speed magnitude
- Heading (degrees)
- Altitude
- Battery level (%)

### Sensor Readings
- Optical flow (dx, dy pixels/frame)
- IMU: accelerometer (ax, ay, az), gyroscope (roll, pitch, yaw rate)
- GPS fix status + coordinates
- Proximity sensor distances (front, back, left, right, down)

### Mission Stats
- Flowers visited / total flowers
- Pollen collected
- Distance traveled
- Time elapsed
- Current behavior state

## Patterns
- `TelemetryPanel` component — receives a flat telemetry slice as props
- `useTelemetrySnapshot` hook — throttles state reads to display rate (e.g. 10Hz)
- Numeric values formatted with `toFixed(2)` or units helper
- Color coding: green = nominal, yellow = warning, red = critical

## File Structure
```
src/components/TelemetryDashboard/
  TelemetryDashboard.tsx
  FlightMetrics.tsx
  SensorReadings.tsx
  MissionStats.tsx
  hooks/
    useTelemetrySnapshot.ts
  utils/
    formatUnits.ts
```

## Anti-patterns
- No raw simulation state passed directly to display components — always slice and format first
- No animation or transitions on numeric values — they update too fast
- No heavy computation inside dashboard components
