# Pollinator Drone Simulator — Master Skill

## Purpose
This is the composed system brain for the pollinator drone simulation. It ties together all sub-skills into a unified architecture. Reference this skill to understand how all pieces fit together.

## Uses Skills
- `simulation-engine` — deterministic tick loop and SimulationState
- `agent-behavior-modeling` — behavior trees for drone decision-making
- `frontend-system-design` — React/Canvas UI layer
- `telemetry-dashboard` — real-time sensor and mission data display
- `perception-model-simulation` — realistic sensor models (optical flow, IMU, GPS, etc.)
- `state-machine-architecture` — mission FSM for each drone
- `animation-orchestration` — canvas rendering pipeline
- `project-memory-manager` — persistent context across Claude sessions

## System Architecture Overview
```
SimulationEngine (tick loop)
  ├── WorldState (flowers, environment, obstacles)
  ├── DroneAgents[]
  │   ├── StateMachine (mission phase FSM)
  │   ├── SensorSuite (optical flow, IMU, proximity, flower detector, GPS)
  │   └── BehaviorTree (search, approach, pollinate, return, avoid)
  └── PhysicsUpdate (apply velocity deltas to positions)

Renderer (animation frame loop)
  ├── reads SimulationState
  └── draws all layers to canvas

React UI
  ├── SimulationCanvas (hosts Renderer)
  ├── ControlPanel (dispatches simulation commands)
  └── TelemetryDashboard (reads state snapshot)
```

## Data Flow
```
Tick:   SimulationState → SensorSuite → BehaviorTree → AgentUpdate → PhysicsUpdate → new SimulationState
Render: SimulationState → Renderer → Canvas frame
UI:     SimulationState → TelemetrySnapshot → Dashboard display
```

## Key Types
- `SimulationState` — complete world snapshot at frame N
- `DroneState` — position, velocity, heading, battery, FSM state, sensor snapshot
- `FlowerState` — position, pollen available, visited, detection radius
- `SensorSnapshot` — all current sensor readings for one drone
- `AgentUpdate` — velocity delta + heading delta + action flags from behavior tree
- `StateMachineEvent` — events that trigger FSM transitions

## Simulation Parameters (configurable)
- Number of drones
- Number of flowers, flower layout
- Drone speed, turn rate, battery capacity
- Sensor noise levels
- Environment size
- Tick rate (default: 60fps)

## Build Order (recommended)
1. `SimulationState` types + initial state
2. Tick loop skeleton (`simulation-engine`)
3. Physics update (move drones by velocity)
4. Sensor models (`perception-model-simulation`)
5. State machine (`state-machine-architecture`)
6. Behavior tree + behaviors (`agent-behavior-modeling`)
7. Canvas renderer (`animation-orchestration`)
8. React UI shell (`frontend-system-design`)
9. Telemetry dashboard (`telemetry-dashboard`)
10. Controls, tuning, polish

## Pixhawk / Optical Flow Integration Notes
- Optical flow sensor simulates PX4Flow output: `flowX`, `flowY` in rad/s equivalent
- IMU simulates MPU-6000: 3-axis accel + gyro with realistic noise floor
- GPS simulates NEO-M8N: 5–10Hz update, ~1.5m CEP accuracy
- All sensor models are in `perception-model-simulation` skill
