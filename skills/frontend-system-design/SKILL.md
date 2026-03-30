# Frontend System Design Skill

## Purpose
Design a clean, performant React + TypeScript frontend that renders the simulation without owning any simulation logic.

## Core Rules
- UI is a pure view layer — it reads state, never computes it
- Components are dumb by default; only container components connect to state
- Canvas rendering is isolated in its own module, never inside JSX render methods
- All simulation state comes from the simulation engine, never from component state

## Component Architecture
```
App
├── SimulationCanvas       # Canvas renderer — reads SimulationState
├── ControlPanel           # Play/pause/speed/reset controls
├── TelemetryDashboard     # Drone stats, sensor readings
├── MissionStatus          # Objective tracker, completion %
└── DebugOverlay           # Optional: frame count, FPS, collision boxes
```

## Patterns
- Presentational components receive props only — no hooks inside
- Container components use `useSimulationEngine` to inject state as props
- `useAnimationFrame` hook drives the render loop
- Canvas renderer receives snapshot of state per frame — no subscriptions inside canvas code
- Zustand or `useReducer` for UI-only state (panel open/closed, selected drone, etc.)

## Styling
- CSS modules or Tailwind — no inline styles for layout
- Dark theme by default (simulation context)
- Responsive layout with sidebar + main canvas

## File Structure
```
src/
  components/
    SimulationCanvas/
    ControlPanel/
    TelemetryDashboard/
    MissionStatus/
    DebugOverlay/
  hooks/
    useAnimationFrame.ts
    useSimulationEngine.ts
  store/
    uiStore.ts
  App.tsx
```

## Anti-patterns
- No `useState` for simulation data in components
- No direct canvas manipulation inside React render
- No event handlers that modify simulation state directly — dispatch actions
