# Perception Model Simulation Skill

## Purpose
Simulate realistic drone perception including optical flow, IMU noise, proximity sensing, and visual flower detection — giving agents believable sensor limitations rather than perfect world knowledge.

## Core Rules
- Agents perceive the world through sensors only — no direct world state access
- All sensors have configurable noise, range limits, and update rates
- Sensor readings are computed from world state each tick and stored in agent's sensor snapshot
- Optical flow is the primary navigation input (simulating PX4Flow or similar)

## Sensor Models

### Optical Flow
- Computes apparent motion from velocity + altitude
- Noise: Gaussian noise scaled by altitude and lighting
- Output: `flowX, flowY` (pixels/frame equivalent)
- Failure modes: low light, high altitude, featureless terrain

### IMU (Inertial Measurement Unit)
- Derives acceleration from velocity delta per frame
- Gyro: integrates angular velocity with drift bias
- Noise: configurable Gaussian on each axis
- Output: `ax, ay, az, rollRate, pitchRate, yawRate`

### Proximity Sensors
- Raycast in 6 directions (front, back, left, right, up, down)
- Max range: configurable (default 2m)
- Output: distance to nearest obstacle per direction, `Infinity` if none

### Flower Detector (Visual)
- Simulates camera-based color detection
- Detection cone: configurable FOV and range
- Output: list of detected flowers with relative bearing and estimated distance
- False negative rate: configurable (simulates occlusion, lighting)

### GPS
- World position with configurable accuracy radius
- Update rate: 5–10Hz (not every frame)
- Failure mode: GPS denied zones

## Patterns
- `SensorSuite` class: holds all sensor models, ticks each sensor
- `SensorSnapshot` type: typed struct of all current readings
- `computeSensors(worldState, droneState) => SensorSnapshot`
- Noise functions in `src/simulation/noise.ts`

## File Structure
```
src/simulation/
  sensors/
    opticalFlow.ts
    imu.ts
    proximity.ts
    flowerDetector.ts
    gps.ts
    SensorSuite.ts
  noise.ts
  types/SensorSnapshot.ts
```

## Anti-patterns
- No sensor that returns perfect world coordinates to agents
- No sensor that bypasses noise model
- No sensor logic inside agent behavior files
