# Simulation Engine Skill

## Purpose
Build deterministic, time-stepped simulations for interactive drone systems. The engine is the single source of truth for all simulation state.

## Core Rules
- Simulation runs in discrete frames (fixed timestep, e.g. 16ms or configurable)
- No randomness during replay — seed all RNG at simulation start
- Centralized simulation state object — one place, one version of truth
- UI reads from simulation state only; never writes directly
- Pure functions for all state transitions

## Entities
- Drone (position, velocity, heading, battery, sensor readings)
- Flowers (position, pollen state, visited flag)
- Sensors (optical flow, IMU, GPS, proximity)
- Mission state (current objective, waypoints, completion status)
- Environment (wind, lighting, obstacles)

## Patterns
- `useSimulationEngine` hook — encapsulates tick loop and state dispatch
- `frameIndex` drives everything — all time-dependent values derive from it
- `SimulationState` type — typed, flat structure for easy serialization
- `tickSimulation(state, dt) => SimulationState` — pure update function
- `replaySimulation(frames[])` — replay from recorded frame history

## File Structure
```
src/simulation/
  engine.ts         # core tick loop
  state.ts          # SimulationState type + initial state
  tick.ts           # pure tick function
  replay.ts         # replay controller
  hooks/
    useSimulationEngine.ts
```

## Anti-patterns
- No logic inside React components
- No async operations inside the tick function
- No direct mutation of simulation state
- No setTimeout/setInterval for simulation timing — use requestAnimationFrame
