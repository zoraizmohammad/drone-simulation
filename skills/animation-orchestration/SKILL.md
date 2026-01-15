# Animation Orchestration Skill

## Purpose
Coordinate smooth, frame-accurate visual rendering of all simulation entities on canvas — drones, flowers, sensors, trails, and UI overlays — driven entirely by simulation state.

## Core Rules
- Canvas renderer is a pure function of SimulationState — same state always produces same frame
- No animation logic inside React components — renderer is standalone
- All visual effects (trails, particles, glow) are computed from state, not maintained separately
- Target 60fps; degrade gracefully at lower frame rates

## Rendering Layers (draw order, back to front)
1. **Background** — environment (field, sky, terrain)
2. **Flowers** — base + visited state + pollen glow
3. **Drone trails** — position history, fades over N frames
4. **Drones** — body, rotors, heading indicator
5. **Sensor visualizations** — detection cone, proximity arcs (debug mode)
6. **Particles** — pollen transfer effects, dust
7. **HUD overlays** — drone labels, battery bars, state badges
8. **Debug layer** — collision boxes, waypoints, FSM state (toggle)

## Entity Renderers

### Drone Renderer
- Body: circle or SVG sprite
- Rotors: animated arcs, speed = throttle level
- Heading: arrow indicator
- State badge: color-coded by FSM state

### Flower Renderer
- Unvisited: full color
- Visited: desaturated
- Pollen available: subtle glow pulse
- Detection range: faint circle (debug mode)

### Trail Renderer
- Last N positions stored per drone
- Alpha fades from 1.0 (current) to 0.0 (oldest)
- Color matches drone identity color

## Patterns
- `Renderer` class: `render(ctx, state, debugFlags)`
- Layer functions: `renderBackground`, `renderFlowers`, `renderDrones`, etc.
- `useAnimationFrame(callback)` hook drives the render loop
- Camera: pan + zoom with transform matrix applied to ctx before drawing

## File Structure
```
src/renderer/
  Renderer.ts
  layers/
    background.ts
    flowers.ts
    drones.ts
    trails.ts
    particles.ts
    hud.ts
    debug.ts
  camera.ts
  hooks/
    useAnimationFrame.ts
```

## Anti-patterns
- No `setState` or React state mutations inside render loop
- No DOM manipulation inside canvas renderer
- No per-entity components (use canvas draw calls, not React elements)
