# State Machine Architecture Skill

## Purpose
Model drone mission phases and agent lifecycle as explicit finite state machines — making transitions, guards, and side effects clear and auditable.

## Core Rules
- Every drone has a mission FSM with explicit states and transitions
- Transitions are guarded — conditions must be met before transition fires
- Side effects (start motor, open gripper) are attached to transition handlers, not states
- State machines are serializable — current state is stored in SimulationState

## Drone Mission States
```
IDLE → TAKEOFF → SEARCHING → APPROACHING → POLLINATING → RETURNING → LANDING → IDLE
                    ↑                                         ↓
               CHARGING ←←←←←←←←←←←←←← LOW_BATTERY
                                    ↑
                             OBSTACLE_AVOID (interrupt)
```

## State Definitions

| State | Entry Condition | Exit Condition |
|---|---|---|
| IDLE | Initial / landed | Mission start command |
| TAKEOFF | Mission start | Altitude threshold reached |
| SEARCHING | In flight, no target | Flower detected in sensor range |
| APPROACHING | Flower detected | Within pollination range OR flower lost |
| POLLINATING | At flower | Pollen transfer complete |
| RETURNING | Mission done OR battery < threshold | Home position reached |
| LANDING | Home reached | Altitude = 0 |
| LOW_BATTERY | Battery < 20% | Charging complete |
| CHARGING | Docked at station | Battery = 100% |
| OBSTACLE_AVOID | Proximity < danger threshold | Obstacle cleared |

## Patterns
- `DroneStateMachine` class: `currentState`, `transition(event)`, `tick()`
- `StateMachineEvent` union type: `FLOWER_DETECTED`, `BATTERY_LOW`, `OBSTACLE_NEAR`, etc.
- Guards as pure functions: `canTransition(from, event, context) => boolean`
- Transition table as a plain object (easy to inspect and test)

## File Structure
```
src/simulation/
  stateMachine/
    DroneStateMachine.ts
    states.ts
    transitions.ts
    guards.ts
    events.ts
```

## Anti-patterns
- No implicit state (flags like `isSearching`, `hasTarget`) — use explicit FSM states
- No state transitions inside behavior tree nodes — emit events, let FSM decide
- No state machine logic inside UI components
