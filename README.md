# Smart Pollinator Drone — Mission Simulation & Agentic CV System

A full-stack autonomous pollinator drone platform built in two mirrored halves: a browser-based mission dashboard (Preact + TypeScript + Vite) that runs a real-time simulation of a drone pollinating flowers across a 20m × 20m garden, and a production-grade autonomous flight and computer vision system (Python FastAPI, Raspberry Pi 4, Pixhawk 2.4.8, Google Coral TPU) that can fly the same mission on real hardware.

The two halves share identical mission logic, sensor models, and TSP path-planning algorithms. An LLM agent (Claude Haiku via LangChain `ChatAnthropic`) sits alongside the inference server and provides real-time planning decisions, adaptive confidence thresholds, and streaming mission commentary. LangChain callbacks route every LLM thought and tool invocation to the live terminal panel. Completed missions are embedded into a persistent Chroma vector store so the agent learns from past flights.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [How the Two Modes Work](#how-the-two-modes-work)
3. [Frontend — Source Layout](#frontend--source-layout)
4. [Data Layer](#data-layer)
5. [Simulation Engine](#simulation-engine)
6. [Sensor Models](#sensor-models)
7. [UI Panels](#ui-panels)
8. [Backend — Inference Server](#backend--inference-server)
9. [Backend — Agent Server](#backend--agent-server)
10. [LangChain Integration](#langchain-integration)
11. [RAG Mission Memory](#rag-mission-memory)
12. [UCB1 Confidence Bandit](#ucb1-confidence-bandit)
13. [End-to-End Data Flow](#end-to-end-data-flow)
14. [Quick Start](#quick-start)
15. [Configuration](#configuration)
16. [Physical Drone Hardware Stack](#physical-drone-hardware-stack)
17. [Firmware & MAVLink Integration](#firmware--mavlink-integration)
18. [Computer Vision Pipeline (Real Drone)](#computer-vision-pipeline-real-drone)
19. [ML Model — YOLOv8 Flower Detection](#ml-model--yolov8-flower-detection)
20. [Pollination Manager](#pollination-manager)
21. [Hardware Assembly & Setup](#hardware-assembly--setup)
22. [Tech Stack](#tech-stack)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Browser — Preact + TypeScript                    │
│                                                                          │
│  ┌──────────────────┐  ┌────────────────┐  ┌──────────────────────────┐ │
│  │  TopDownView     │  │  SideView      │  │  TelemetryPanel          │ │
│  │  SVG 20×20m      │  │  altitude      │  │  sensor HUD + AI section │ │
│  │  garden, drone   │  │  cross-section │  │  EKF, OF, battery, CV    │ │
│  │  trail, TSP+AI   │  │  sparkline     │  │  decisions, overrides    │ │
│  │  route overlays  │  └────────────────┘  └──────────────────────────┘ │
│  └──────────────────┘                                                    │
│  ┌──────────────────┐  ┌──────────────────────────────────────────────┐ │
│  │  CameraAnalysis  │  │  AgentCommentaryPanel                        │ │
│  │  layered SVG     │  │  streaming commentary, decision badge,       │ │
│  │  reticle, heatmap│  │  confidence gauge, decision history          │ │
│  │  flow vectors    │  └──────────────────────────────────────────────┘ │
│  └──────────────────┘                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  TerminalPanel   [SYS] [PHASE] [→WS] [←WS] [DET] [TSP] [NAV] [AI] │ │
│  │  real-time color-coded flight log — AI tab shows LangChain events  │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  liveInferenceEngine  (requestAnimationFrame loop, 30 fps)       │   │
│  │   ├─ AutonomousNavigator  ←── applyAgentDecision()               │   │
│  │   │   13-phase FSM, lawnmower scan, TSP, proximity detection     │   │
│  │   ├─ WsClient            WebSocket → :8765  (inference)          │   │
│  │   └─ AgentClient         HTTP/SSE/WS → :8766  (agent)            │   │
│  │       ├─ POST /decide    (debounced 200ms, every 30 frames)      │   │
│  │       ├─ GET  /stream    (SSE commentary on phase transitions)   │   │
│  │       ├─ WS  /terminal   (LangChain callback drain, 100ms tick)  │   │
│  │       └─ POST /mission/save (fire-and-forget on nav.done)        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────┬────────────────────────────┘
               │                              │
     :8766 HTTP/SSE/WS                  :8765 WebSocket
               │                              │
┌──────────────▼────────────┐  ┌──────────────▼─────────────────────────┐
│  Agent Server             │  │  Inference Server                      │
│  agent_server.py          │  │  inference_server.py                   │
│  FastAPI + LangChain      │  │  FastAPI WebSocket                     │
│                           │  │                                        │
│  POST /decide             │  │  WS /inference                        │
│    ChatAnthropic          │  │    ① receive drone + flowers JSON      │
│    .bind_tools()          │  │    ② scene_renderer.py → 640×640 frame │
│    RAG context injected   │  │    ③ DetectionBridge.detect()          │
│    max 3 tool rounds      │  │       Coral TPU → ONNX → mock          │
│    callbacks attached     │  │    ④ _compute_tsp_suggestion()         │
│                           │  │    ⑤ _phase_suggestion()               │
│  LangChain Tools:         │  │    ⑥ return detections + TSP + phase  │
│  - compute_tsp_route      │  └────────────────────────────────────────┘
│  - estimate_battery_range │
│  - recommend_conf_thresh  │  ┌────────────────────────────────────────┐
│  - plan_scan_pattern      │  │  Chroma RAG Store                      │
│                           │  │  drone-cv-system/mission_history/      │
│  WS /terminal             │  │                                        │
│    DroneTerminalCallback  │  │  Embeddings: all-MiniLM-L6-v2          │
│    drain queue 100ms      │  │  local CPU — no API key needed         │
│    → frontend AI tab      │  │                                        │
│                           │  │  Saved after each mission completes    │
│  GET /stream  (SSE)       │  │  Retrieved before each /decide call    │
│  POST /mission/save       │  │  Top-3 similar missions injected into  │
│  POST /feedback (bandit)  │  │  Claude system prompt                  │
│  GET /health /metrics     │  └────────────────────────────────────────┘
│  UCB1 ConfidenceBandit    │
└───────────────────────────┘
```

---

## How the Two Modes Work

The app boots to a mode selector. There are two execution paths that share all the same UI panels and TypeScript types but drive them from completely different engines.

### Replay Mode

Replay mode runs a deterministic pre-generated mission. On first render, `getMissionFrames()` is called once and caches all **2700 frames** (30 fps × 90 seconds) in a `useRef`. A `requestAnimationFrame` loop in `useReplayEngine` accumulates wall-clock delta time, multiplies by the speed setting (1×, 2×, 4×), and advances a frame index. The loop reads `frames.current[frameIndex]` and sets it as the current `ReplayFrame` in React state. All panels receive this frame as a prop — they are pure rendering functions with no simulation logic of their own.

The frame index is the single source of truth. Position history is a sliding window of the last 90 drone XY coordinates read directly from the pre-generated frames. Altitude history samples every 5th frame. Events accumulated from `frame.events` arrays are kept as a rolling window of 100.

Seeking works by jumping `frameIndex` directly and rebuilding the history windows by slicing `frames.current[0..targetIndex]`. This is O(n) but runs fast because it's just array iteration over pre-computed data.

### Live Mode

Live mode runs a real autonomous mission. `useLiveInferenceEngine` creates:

- An `AutonomousNavigator` instance with a randomly seeded garden
- A `WsClient` connected to the inference server at `ws://localhost:8765/inference`
- An `AgentClient` connected to the agent server at `http://localhost:8766`

The same `requestAnimationFrame` loop ticks the navigator with `dt` (delta seconds, capped at 100ms to prevent spiral-of-death on tab focus). Each tick:

1. `nav.tick(dt, latestInference)` — advance the state machine, detect flowers, move the drone, return a `LiveFrame`
2. `ws.send(lf.drone, lf.flowers, lf.phase)` — push state to inference server
3. Every 30 frames: `agent.requestDecision(lf)` — fire debounced POST to `/decide`
4. On phase change: `agent.startCommentaryStream(lf)` — open SSE to `/stream`
5. When `nav.done`: `agent.saveMission(lf)` — embed mission into Chroma

The `LiveFrame` is adapted to a `ReplayFrame` shape via `liveToReplay()` in `App.tsx` so all four existing panels render without modification. The agent state (`AgentState`) is threaded separately via additional props to panels that need it.

---

## Frontend — Source Layout

```
src/
├── app/
│   ├── App.tsx              Root. Mode switch, liveToReplay adapter, AppShell,
│   │                        FourPanels, BottomBar. Phase color maps.
│   └── ModeSelector.tsx     Landing screen with REPLAY / LIVE cards.
│
├── components/
│   ├── TopDownView/
│   │   └── TopDownView.tsx  SVG 20×20m garden. Renders flower clusters (organic
│   │                        SVG petals with seeded RNG), drone body with rotor
│   │                        spin animation, motion trail polyline, TSP route
│   │                        lines, waypoint markers. In live mode: purple dashed
│   │                        AI route overlay when agent.lastDecision has
│   │                        priorityOverride. Home base marker at (2,2).
│   │
│   ├── SideView/
│   │   └── SideView.tsx     SVG altitude cross-section. Polyline from
│   │                        altitudeHistory, drone silhouette at current Z.
│   │                        Phase-colored altitude band markers. Grid lines.
│   │
│   ├── TelemetryPanel/
│   │   └── TelemetryPanel.tsx  Engineering HUD. Organized sections:
│   │                           NAVIGATION (x,y,z,speed,yaw), OPTICAL FLOW
│   │                           (quality,stability,vx/vy,strength,precision),
│   │                           RANGEFINDER, EKF CONFIDENCE, BATTERY, SIGNAL,
│   │                           CV DETECTION (confidence bar, target ID),
│   │                           MISSION STATE (phase, pollinated/total).
│   │                           In live mode: AI AGENT section showing connection
│   │                           status, decisions total, overrides, latency,
│   │                           current confidence threshold, last action.
│   │
│   ├── ZoomPanel/
│   │   └── ZoomPanel.tsx    Thin wrapper. Passes frame + livePng (base64 JPEG
│   │                        from inference server) to CameraAnalysisPanel.
│   │
│   ├── AgentPanel/
│   │   └── AgentCommentaryPanel.tsx  AI Mission Analyst strip. Connection dot
│   │                                 (emerald = connected, amber = connecting,
│   │                                 red = error). Streaming commentary text with
│   │                                 typewriter cursor while SSE is active.
│   │                                 Decision badge (action color-coded). Dynamic
│   │                                 confidence gauge bar. Stats row (N decisions,
│   │                                 N overrides, Xms). Rolling 5-entry history
│   │                                 that fades older entries.
│   │
│   ├── camera-analysis/
│   │   ├── types.ts          AnalysisFrame, FlowerRenderState, FrustumState
│   │   ├── CameraAnalysisPanel.tsx   Entry point. Calls computeAnalysisFrame()
│   │   │                             to transform ReplayFrame → AnalysisFrame.
│   │   ├── CameraAnalysisScene.tsx   SVG compositor (800×500 viewBox). Assembles
│   │   │                             all sub-layers. Applies jitter when OF quality
│   │   │                             < 50, motion blur filter when |velocity| > 1
│   │   │                             m/s, cyan hover glow at stability > 0.7 + alt
│   │   │                             < 3m, red vignette at stability < 0.4.
│   │   ├── FlowerClusterRenderer.tsx Organic SVG flowers per cluster. Seeded RNG
│   │   │                             per flower ID controls petal angle, size,
│   │   │                             stem curve, leaf position. State rings:
│   │   │                             unscanned=dark, discovered=amber, locked=cyan,
│   │   │                             pollinated=green pulse.
│   │   ├── DetectionReticle.tsx      Corner bracket reticle + crosshair + center
│   │   │                             dot. Tightness 0→1 drives bracket inward.
│   │   ├── DetectionHeatmap.tsx      Radial gradient confidence blobs per flower.
│   │   │                             qualityIntensity scales opacity by OF quality.
│   │   │                             of-heatmap-pulse CSS breathing animation.
│   │   ├── FlowVectorOverlay.tsx     Grid flow field lines + primary velocity arrow
│   │   │                             + arrowhead. Cyan (stable), amber (moderate),
│   │   │                             red (degraded). of-vector-stable / unstable
│   │   │                             shimmer animations.
│   │   ├── OpticalFlowHud.tsx        Top-right translucent panel: DIST (in),
│   │   │                             SENSOR (mm), FLOW X/Y, QUALITY, STRENGTH,
│   │   │                             PRECISION, STABILITY bar gauge.
│   │   ├── PollinationEffect.tsx     Orbiting sparkle particles + expanding pulse
│   │   │                             rings during pollinating phase.
│   │   ├── MissionPhaseOverlay.tsx   Phase-specific SVG banners (all 13 phases).
│   │   └── AnalysisHud.tsx           Bottom strip: phase chip, confidence bar
│   │                                 with tick marks, sparkline of last 50 samples,
│   │                                 lock/pollination indicators.
│   │
│   ├── LiveStatus/
│   │   └── LiveStatus.tsx   Header right section in live mode. WS status dot,
│   │                        inference mode badge (CORAL/ONNX/MOCK), inference
│   │                        latency, agent status dot, RESTART / EXIT buttons,
│   │                        TERMINAL toggle.
│   │
│   ├── ReplayControls/
│   │   └── ReplayControls.tsx  Play/pause/reset, 1×/2×/4× speed, scrubber bar
│   │                           with click-to-seek.
│   │
│   └── TerminalPanel/
│       └── TerminalPanel.tsx  Fixed bottom overlay (42vh). Color-coded log with
│                              9 entry types. Filter tabs: ALL / WS / INFER / NAV
│                              / AI. Auto-scroll with FOLLOW toggle. CLEAR button.
│                              AI tab isolates emerald LangChain callback entries.
│
├── simulation/
│   ├── replayEngine.ts        useReplayEngine hook (described above).
│   ├── liveInferenceEngine.ts useLiveInferenceEngine hook. Owns all live state:
│   │                          navigator, wsClient, agentClient, RAF loop,
│   │                          terminal buffer (synced to state every 250ms).
│   ├── autonomousNavigator.ts AutonomousNavigator class (described below).
│   ├── agentClient.ts         AgentClient class (described below).
│   ├── wsClient.ts            WsClient. Connects to :8765, sends JSON every tick,
│   │                          receives InferenceResult, debounces sends to 100ms.
│   ├── opticalFlowModel.ts    computeOpticalFlowState(). Physics model.
│   └── sensorInterpolation.ts getSensorAtDistance(). Binary search + smooth-step.
│
├── data/
│   ├── missionGenerator.ts    getMissionFrames() — generates 2700 ReplayFrames.
│   │                          Exports FLOWER_CLUSTERS, WAYPOINTS constants.
│   ├── randomMissionGenerator.ts  generateRandomGarden(seed), generateLawnmowerPath(spacing),
│   │                              computeTSPRoute() — used by live mode.
│   ├── opticalFlowDataset.ts  getFullOpticalFlowDataset() — merges real + synthetic rows.
│   └── loadOpticalFlowCSV.ts  Raw CSV parser. OpticalFlowSample type.
│
├── models/
│   └── types.ts               All TypeScript interfaces (see Types Reference below).
│
└── styles/
    └── globals.css            Tailwind base + keyframe animations:
                               of-heatmap-pulse, of-vector-stable, of-vector-unstable,
                               of-flicker, of-stabilize, agent-cursor, agent-connected,
                               agent-text-new, rotor spin animations.
```

---

## Data Layer

### Replay Mission Generator (`missionGenerator.ts`)

The replay mission is entirely pre-computed. `getMissionFrames()` runs once (lazily, then cached) and returns an array of 2700 `ReplayFrame` objects covering 90 seconds at 30 fps.

**Garden layout.** 10 flower clusters at fixed positions within a 20m × 20m space. Clusters are identified `f1`–`f10`. The drone home base is at `(2, 2)`. 8 of the 10 clusters are visited during the mission (f8 and f10 are unvisited bystanders, visible but never targeted).

**Timeline segments.** The 90-second mission is divided into named segments:

```
0–2s      idle       — drone stationary, systems initializing
2–4s      arming     — pre-flight sequence
4–8s      takeoff    — climb from 0m to 8m patrol altitude
8–14s     transit    — fly from home to first waypoint
14–22s    scanning   — hover scan of cluster
22–26s    candidate  — confidence building (0.2→0.6)
26–30s    target_lock— high confidence achieved (0.6→0.92)
30–34s    descent    — descend 8m → 1.5m
34–37s    hover_align— XY precision alignment
37–41s    pollinating— pollination mechanism active
41–45s    ascent     — climb back to 8m
45–90s    (repeat for remaining 7 clusters with adjusted timing)
```

**Per-frame computation.** For each frame index `i`:
1. Determine which timeline segment it falls in
2. Compute `t = (i - segmentStart) / segmentDuration` (normalized 0→1)
3. Lerp drone X/Y between segment start and end waypoints
4. Add a sinusoidal wobble (`sin(t * 7.3 * 2π) × 0.03m`) for realism
5. Compute altitude as a piecewise function of phase
6. Look up sensor state via `getSensorAtDistance(drone.z * 39.37)`
7. Compute optical flow state via `computeOpticalFlowState(sample, i)`
8. Compute detection confidence as a phase-specific ramp × sensor coupling
9. Update flower states (unscanned → discovered → candidate → locked → pollinated)
10. Emit events at phase transitions

**Seeded RNG.** The `seededRandom(42)` PRNG (multiplicative linear congruential: `s = s × 16807 mod 2147483647`) ensures every run produces identical frames. This makes regression testing against visual output reliable.

### Random Garden Generator (`randomMissionGenerator.ts`)

Used by live mode to generate a fresh garden for each session.

**`generateRandomGarden(seed)`** places 6–10 flowers using a different LCG (`s = s × 1664525 + 1013904223`). Each flower is rejected if it falls within 3m of the home base at `(2,2)` or within 2.8m of another flower. Positions are rounded to 0.1m. Returns `LiveFlower[]` — all start as `'undiscovered'`.

**`generateLawnmowerPath(spacing = 4.5)`** generates a boustrophedon (alternating S→N / N→S) set of waypoints spaced `spacing` meters apart from `x=3.0` to `x=18.0`. At default 4.5m spacing with a 4.5m proximity detection radius, every point in the flower zone `[2.5m, 17.5m]` is covered. The spacing parameter is overridden by agent decisions when the scan pattern tool recommends tighter or wider passes.

**`computeTSPRoute(flowers, discoveredIds)`** runs a greedy nearest-neighbor heuristic starting from home `(2,2)`. At each step it picks the unvisited discovered flower closest to the current position. O(n²) but n ≤ 10 so this is negligible. Returns an ordered array of flower IDs.

### Optical Flow Dataset (`opticalFlowDataset.ts`)

Real sensor data from `raw_opticalflow_data.csv` is merged with synthetically generated midpoint rows to give 6-inch step resolution from 0 to 315 inches. The merge strategy:

1. Load the 24 real rows (0–276 inches at 12-inch intervals)
2. Generate synthetic midpoint rows between each consecutive real pair
3. Generate 3 extrapolated rows from 276 to 315 inches (patrol altitude coverage)
4. Merge: real rows always override synthetic rows at matching distances
5. Sort the combined dataset by `distance_in`

The resulting dataset has ~50 rows and is cached in a module-level constant.

---

## Simulation Engine

### Replay Engine (`replayEngine.ts`)

`useReplayEngine()` is a Preact hook that wraps a `requestAnimationFrame` loop.

**State.** All mutable loop state lives in refs (not React state) to avoid triggering re-renders on every frame tick:
- `frameIndexRef` — current index into the frames array
- `isPlayingRef` — controls whether the RAF loop continues
- `speedRef` — 1, 2, or 4 (multiplied into accumulated delta time)
- `accumulatedTimeRef` — fractional frame accumulator (handles non-integer fps)
- `lastTimeRef` — previous `requestAnimationFrame` timestamp

React state is only set when visible output changes: `currentFrameData`, `positionHistory`, `altitudeHistory`, `accumulatedEvents`.

**Tick loop.** Each RAF callback:
1. Computes `delta = timestamp - lastTimestamp` in ms
2. Adds `(delta / 1000) × speed` to `accumulatedTime`
3. Advances `frameIndex` by `floor(accumulatedTime × 30)` frames
4. Subtracts the integer portion back out of `accumulatedTime`
5. Updates histories and emits events if the new frame has any

**Seek.** `seekTo(time)` converts time to a frame index and sets it directly. Histories are rebuilt by iterating `frames[0..targetIndex]` and re-applying the same update logic.

### Live Inference Engine (`liveInferenceEngine.ts`)

`useLiveInferenceEngine()` owns all live simulation state. It creates and manages three worker objects (`AutonomousNavigator`, `WsClient`, `AgentClient`) and runs a RAF loop that drives them together.

**Terminal buffer.** To avoid O(n) React re-renders on every terminal push, entries are accumulated in a `useRef` buffer (`termBufRef`) and synced to React state every 250ms via a `setInterval`. The terminal panel therefore has at most 4 state updates per second regardless of how many events fire.

**Phase transition detection.** `lastPhaseRef` stores the previous frame's phase. When `lf.phase !== lastPhaseRef.current`, a new SSE commentary stream is started by calling `agent.startCommentaryStream(lf)`.

**Agent decision loop.** `frameIdxRef` increments each RAF tick. When `frameIdxRef % 30 === 0` (once per second at 30fps), `agent.requestDecision(lf)` fires. The decision is debounced inside `AgentClient` to 200ms so rapid phase transitions don't flood the server.

**Mission completion.** When `nav.done` is true, the RAF loop stops and `agent.saveMission(lf)` fires a background POST to embed the completed mission into Chroma.

### Autonomous Navigator (`autonomousNavigator.ts`)

`AutonomousNavigator` is a class (not a hook) that implements the 13-phase live mission as a state machine. It is instantiated once per live session.

**State.** All drone physics state, flower states, route planning state, and history windows live inside the class instance. The `tick(dt, inference)` method is the single entry point called each RAF frame.

**Phases and transitions:**

```
idle
  └─ immediately → arming (armTimer starts)

arming (2s dwell)
  └─ → takeoff

takeoff
  └─ climb at 1.8 m/s until z ≥ 7.9m → scanning

scanning
  └─ moveToward(lawnmower[scanWpIdx], 2.5 m/s)
     doProximityDetection() each frame
     on waypoint reached: scanWpIdx++
     when all lawnmower WPs done: scanComplete=true → planning

planning (2.5s dwell)
  └─ computeTSPRoute(flowers, discoveredIds)
     fallback: if zero CV detections, add all flowers
     → approach (or mission_complete if route empty)

approach
  └─ moveToward(currentTarget, 2.0 m/s) at PATROL_ALT
     doProximityDetection() continues during approach
     on arrival (< 0.4m): → descent

descent
  └─ lower z at 1.8 m/s to 1.5m
     slow XY drift toward target (0.5 m/s)
     when z ≤ 1.65m: → hover_align

hover_align
  └─ moveToward(target, 0.3 m/s) at 1.5m
     track XY error; when < 0.18m for 0.5s: → pollinating

pollinating (3s dwell)
  └─ pollinateTimer counts
     on complete: push to pollinatedIds, flower.state = 'pollinated'
     send feedback POST to agent → bandit update
     → ascent

ascent
  └─ climb at 1.8 m/s to 8m
     when z ≥ 7.9m: → resume

resume
  └─ tspIdx++
     if more targets remain: → approach
     else: → mission_complete

mission_complete
  └─ fly back toward home (2, 2) at 2.0 m/s
     on arrival: → landing

landing
  └─ descend at 1.1 m/s
     when z ≤ 0.01m: nav.done = true, RAF loop stops
```

**Proximity detection.** Each frame during `scanning` and `approach`, every undiscovered flower is checked: if `hypot(drone.x - flower.x, drone.y - flower.y) < 4.5m`, the flower transitions to `'discovered'` and is added to `discoveredIds`. Confidence at detection = `0.9 - (dist / 4.5) × 0.6` (0.9 at zero offset, 0.3 at edge of radius). Whenever a new discovery is made, `computeTSPRoute` is re-run immediately.

**Inference integration.** If the WebSocket server returns an `InferenceResult`, `processInference(inf)` runs: for each detection, the confidence is updated on the matching flower, flower state is promoted (`scanned → candidate → locked`) based on `currentConfidenceThreshold` (dynamically set by the agent), and any server-suggested TSP IDs not yet in `discoveredIds` are added.

**Agent integration.** `applyAgentDecision(decision)`:
- If `decision.priorityOverride` is non-empty and `!planningComplete`, rebuilds `tspRoute` with the agent-suggested order (filtering to only valid undiscovered/unpollinated IDs)
- If `decision.altitudeOverride` is set, logs it to the terminal
- `currentConfidenceThreshold` is updated from `decision.confidenceThreshold` on every decision
- `scanSpacing` is updated from `decision.scanSpacing` (triggers lawnmower regeneration on next scan pass)

### Agent Client (`agentClient.ts`)

`AgentClient` manages all communication with the agent server. All methods fail silently so the simulation continues normally when the server is offline.

**Health polling.** On `connect()`, a `setInterval` checks `GET /health` every 3 seconds. Status transitions: `disconnected → connecting → connected` (on 200 OK) or `error` (on non-200). When status becomes `'connected'`, `openTerminalWs()` is called automatically if `connectTerminalStream()` has already been called.

**Decision channel.** `requestDecision(frame)` sets a 200ms `setTimeout`. If a new call arrives before it fires, the timer is reset (debounce). On fire, a `POST /decide` is sent with the drone state, flowers, phase, sensor, pollinated/discovered IDs, and battery. Response is an `AgentDecision` JSON.

**Commentary channel.** `startCommentaryStream(frame)` aborts any existing SSE stream and opens a new `GET /stream` with query params extracted from the current frame. The response body is read as a `ReadableStream`. Each `data: {...}` SSE line is parsed. Text delta chunks are accumulated and the `onCommentary` callback fires on each chunk (with `streaming: true`) and on completion (with `streaming: false`). Incomplete lines are buffered across chunks.

**Terminal WebSocket channel.** `connectTerminalStream(onEvent)` stores the callback and calls `openTerminalWs()`. The WS connects to `ws://localhost:8766/terminal`. Each incoming `{events: [{type, text}]}` message routes each event to `onTerminalEvent(type, text)`, which calls `pushTerminal()` in `liveInferenceEngine`. This is how LangChain callback events appear as emerald **AI** entries in the terminal. If the WS closes, it reconnects after 3 seconds while agent status is `'connected'`.

**Mission save channel.** `saveMission(frame)` POSTs `{events, telemetry}` to `/mission/save`. Fire-and-forget with 5s timeout.

**Feedback channel.** `sendFeedback(success, state)` POSTs to `/feedback`. Called by `AutonomousNavigator` after each successful pollination to update the UCB1 bandit.

---

## Sensor Models

### Sensor Interpolation (`sensorInterpolation.ts`)

`getSensorAtDistance(distanceInches)` looks up the optical flow sensor state at the current drone altitude. The altitude in meters is converted to inches (`z × 39.37`) before calling this function.

**Algorithm:**
1. Clamp input to `[0, 315]` inches (no extrapolation)
2. Binary search the dataset to find the bracketing pair `(lower, upper)` such that `lower.distance_in ≤ input ≤ upper.distance_in`
3. Compute normalized parameter `t = (input - lower.distance_in) / (upper.distance_in - lower.distance_in)`
4. Apply smooth-step easing: `st = t² × (3 − 2t)` — this prevents sharp transitions at dataset boundaries
5. Lerp all scalar fields: `sensor_distance`, `strength`, `precision`, `flow_vel_x`, `flow_vel_y`, `flow_quality`
6. Return an `OpticalFlowSample` with the interpolated values

The smooth-step easing means sensor readings don't jump abruptly between dataset rows — they ease in and out of transitions, mimicking the continuous nature of physical sensor response.

### Optical Flow Physics Model (`opticalFlowModel.ts`)

`computeOpticalFlowState(sample, frameIndex)` takes an interpolated sensor sample and applies physics-based processing to produce the full `OpticalFlowState`.

**Base physics:**
```
vx = sample.flow_vel_x × (distance_in / 1000)
vy = sample.flow_vel_y × (distance_in / 1000)
```
Optical flow apparent motion scales linearly with altitude — a flower appears to move faster in the image at higher altitude for the same ground speed. The `/1000` factor normalizes the sensor's raw velocity values.

**Stability and quality derivation:**
```
stability         = min(1, flow_quality / 150)        // 150 is peak quality from real data at ~3m
noise             = (1 − stability) × 0.15
normalizedStrength = strength / 255
precisionWeight   = 1 / max(1, precision)              // lower precision number = better
effectiveQuality  = flow_quality × normalizedStrength × precisionWeight
```

**Degradation above 5m (197 inches):**
```
excess            = (distance_in − 197) / 118         // 0→1 over the 197–315in range
degradedStability = stability × (1 − excess × 0.60)
degradedQuality   = effectiveQuality × (1 − excess × 0.70)
```
At patrol altitude (8m ≈ 315 inches), the sensor is at 40% of nominal stability and 30% of nominal quality, modeling real sensor degradation from range.

**Low-strength noise amplification:**  
When `strength < 60`, noise increases: `finalNoise += (1 − strength/60) × 0.25`. Weak return signal produces noisy measurements.

**Deterministic drift (quality < 50):**  
When the flow quality falls below 50, the sensor is unreliable. Drift is injected using a deterministic pseudo-random function seeded by `frameIndex`:
```
driftX = (pseudoRand(frameIndex × 0.03)       − 0.5) × 0.4
driftY = (pseudoRand(frameIndex × 0.03 + 100) − 0.5) × 0.4
```
`pseudoRand(seed) = frac(sin(seed × 127.1 + 311.7) × 43758.5453)` — a hash-like function that produces stable values without a PRNG object. The drift is reproducible per frame index, so seeking in replay mode gives identical results.

**Hover instability (altitude < 3m / 118 inches):**  
```
hoverX = sin(t × 4.3) × 0.05    where t = frameIndex / 30
hoverY = cos(t × 3.7) × 0.05
```
Low-altitude hover introduces sinusoidal ground-effect oscillation in the velocity readings. The 4.3 and 3.7 frequencies create a slightly irregular wobble rather than a perfect circle.

**CV coupling.** Detection confidence is modulated each frame by optical flow quality:
```
stabilityFactor = 0.6 + 0.4 × stability          // never below 60%
strengthFactor  = 0.6 + 0.4 × (strength / 255)   // never below 60%
confidence     *= stabilityFactor × strengthFactor
```
If `|vx| > 1.5 or |vy| > 1.5 m/s`: blur penalty reduces confidence. If `flow_quality < 50`: heavy reduction `× 0.6`. If `stability > 0.7 and altitude < 3m` (stable hover): 15% boost.

---

## UI Panels

### Top-Down Garden View

Renders the full 20m × 20m garden as a scaled SVG. The coordinate transform maps meters → pixels using a fixed scale factor. Features:

- **Flower clusters** — each cluster renders 4–7 individual flower SVGs using `FlowerClusterRenderer`. Petal count, angle, and position are seeded from the cluster ID so they look different but are always identical across renders.
- **State coloring** — `unscanned` (dark, low opacity), `discovered` (amber ring), `candidate` (orange ring + glow), `locked` (cyan ring + bright), `pollinated` (green ring + full opacity)
- **Drone body** — a hexagonal body with 4 arm stubs. Each arm tip has a small circle representing a rotor with a CSS `spin` animation. The body rotates to match `drone.yaw`.
- **Motion trail** — a polyline through the last 90 position history points. Opacity fades toward the oldest point.
- **TSP route** — dashed lines connecting the current planned visit order in the drone's current accent color.
- **AI route overlay** — when `agent.lastDecision.priorityOverride` is non-empty, a second dashed route is drawn in purple `#a78bfa` with numbered stop labels.
- **Home base** — small marker at `(2, 2)` with "HOME" label.

### Side View (Altitude Profile)

SVG cross-section showing altitude over time. The X axis spans the altitude history (up to 150 samples, sampled every 5 frames ≈ every 0.83 seconds). The Y axis spans 0–10m. A polyline connects the altitude history points. A small drone silhouette marker sits at the rightmost (current) position. Phase-colored horizontal bands show the patrol altitude (8m) and hover altitude (1.5m).

### Telemetry Panel

A grid of labeled metric rows organized into sections. All values read directly from the current `ReplayFrame.sensor` and `ReplayFrame.drone` objects — no computation happens here.

Sections: Navigation (x, y, z, speed, yaw, yawRate), Optical Flow (all extended fields from `ofStrength`, `ofPrecision`, `ofStability`, `ofNoise`, `ofEffectiveQuality`, `distanceInches`, `sensorDistanceMm`), Rangefinder (rangefinderDistance, sonarEstimate), EKF Confidence bar, Battery bar, Signal Strength bar, CV Detection (confidence bar, current target ID, flowers in view, target locked status), Mission State (phase chip, pollinated/total, elapsed).

In live mode, an additional AI AGENT section shows: agent connection dot (color-coded), total decisions made, number of route overrides applied, current dynamic confidence threshold with a small bar, and the last decision action + truncated reasoning text.

### Camera / Flower Analysis Panel

The most visually complex panel. `CameraAnalysisPanel` first runs `computeAnalysisFrame(frame)` to transform the `ReplayFrame` into an `AnalysisFrame` — this is the only panel with a data transformation step.

**`computeAnalysisFrame` pipeline:**
1. Maps each `FlowerCluster` to a `FlowerRenderState` with fixed camera-space positions from the `CAMERA_POSITIONS` lookup (800×500 viewbox coordinate system)
2. Determines if the current target flower should zoom to scene center `(400, 230)` at scale 2.0 during `target_lock`, `descent`, `hover_align`, `pollinating`, `ascent`
3. Computes `FrustumState.tightness` from the phase tightness map (0 = wide, 1.0 = maximally tight, reached during `pollinating`)
4. Passes the resulting `AnalysisFrame` to `CameraAnalysisScene`

**Scene layers (bottom to top):**
1. Dark background with radial vignette
2. `FlowerClusterRenderer` — one group per visible flower, with jitter applied (`jx/jy` random offsets) when `of_quality < 50`, and SVG `feGaussianBlur` motion blur when `|velocity| > 1.0 m/s`
3. `DetectionHeatmap` — per-flower radial gradient blobs, opacity driven by `confidence × qualityIntensity`
4. `PollinationEffect` — only active during `pollinating`: 8 orbiting sparkle particles + 3 concentric pulse rings
5. `FlowVectorOverlay` — a 5×4 grid of small flow lines plus one large velocity arrow at scene center. Color and animation class depend on stability tier.
6. `DetectionReticle` — corner brackets and crosshair, tightness controlled by phase
7. `MissionPhaseOverlay` — phase-specific banner text
8. `AnalysisHud` — bottom strip with phase chip, confidence sparkline, lock indicator
9. `OpticalFlowHud` — top-right mini panel with sensor readings

If a `livePng` base64 JPEG is provided (from the inference server), it is rendered as an `<image>` tag under all SVG layers, showing the actual synthetic camera frame that was fed to the ML detector.

### Terminal Panel

A fixed-bottom overlay showing the rolling flight computer log. Entries are color-coded:

| Type | Color | Content |
|---|---|---|
| `sys` | Slate | Session/connection events |
| `phase` | Purple | State machine transitions |
| `ws-out` | Blue | WebSocket frames sent |
| `ws-in` | Cyan | WebSocket frames received |
| `detect` | Green | CV flower detections |
| `tsp` | Amber | Route planning updates |
| `nav` | Gray | Proximity detection, navigation |
| `error` | Red | Connection/inference errors |
| `agent` | Emerald | LangChain LLM thoughts, tool calls, RAG hits |

The AI filter tab isolates the emerald `agent` entries, showing only what the LLM and its tools are doing. Each entry shows a timestamp (seconds since session start), type label, and truncated text.

---

## Backend — Inference Server

### `inference_server.py` (port 8765)

FastAPI app with a single WebSocket endpoint `/inference`. The server is started automatically by the Vite dev server via `/api/start-inference-server` when live mode is selected.

**WebSocket protocol:**

Client → Server (every ~100ms, sent from `WsClient.send()`):
```json
{
  "drone":   { "x": 12.3, "y": 8.4, "z": 8.0, "yaw": 45.2 },
  "flowers": [{ "id": "r1", "x": 5.5, "y": 9.2, "radius": 0.8, ... }],
  "phase":   "scanning"
}
```

Server → Client:
```json
{
  "detections":      [{ "id": "r1", "confidence": 0.73, "cls": "flower_open", "bbox": [210,190,430,410] }],
  "phaseSuggestion": "approach",
  "targetId":        "r1",
  "inferenceMs":     12.4,
  "inferenceMode":   "mock",
  "framePng":        "<base64 JPEG>",
  "tspSuggestion":   ["r1", "r3", "r2"]
}
```

**Processing pipeline per message:**
1. Parse JSON, extract `drone`, `flowers`, `phase`
2. `render_frame(drone, flowers)` — run in a thread executor to avoid blocking the event loop
3. `bridge.detect(frame_arr, drone, flowers)` — run in executor, returns `(detections, mode, elapsed_ms)`
4. Optionally encode frame as base64 JPEG via `frame_to_base64()`
5. `_phase_suggestion(detections, phase)` — simple confidence threshold logic
6. `_compute_tsp_suggestion(detections, flowers, drone_x, drone_y)` — greedy NN TSP
7. Assemble response dict and `send_json()`

### Scene Renderer (`scene_renderer.py`)

Generates a 640×640 top-down synthetic camera frame using PIL (Pillow). Each flower is projected from garden coordinates into pixel space using the pinhole camera model:

```python
rel_x = flower.x - drone.x
rel_y = flower.y - drone.y

# Rotate by drone yaw
cam_x = rel_x * cos(yaw_rad) + rel_y * sin(yaw_rad)
cam_y = -rel_x * sin(yaw_rad) + rel_y * cos(yaw_rad)

# Project (90° FOV → focal length = IMG_SIZE / 2 = 320)
u = 320 * cam_x / altitude + 320
v = 320 * cam_y / altitude + 320
radius_px = max(3, int(flower.radius / altitude * 320))
```

Flowers outside the image bounds are skipped. For each visible flower, `_draw_flower()` renders:
- A green ellipse shadow offset by 3px
- 6 petals drawn as ellipses rotated around the center, angles seeded by `hashlib.md5(f'{seed}-{n}')` for deterministic per-flower variation
- A darkened center circle (the nectary)
- A curved stem and two leaf ellipses below the bloom
- A Gaussian blur pass via PIL for anti-aliasing

The resulting NumPy float32 `[640, 640, 3]` array is returned for inference and optionally JPEG-encoded to base64.

### Detection Bridge (`detection_bridge.py`)

Three-tier detection hierarchy:

**Tier 1: `CoralBridge` (Google Coral USB TPU)**  
Wraps `cv/coral_detector.py` → `pycoral.utils.edgetpu.make_interpreter()`. Loads an EdgeTPU-compiled `_edgetpu.tflite` INT8 model. The input frame (float32 [0,1]) is converted to uint8 for the TPU. After inference, detected bounding boxes are scaled from the model's input resolution back to 640×640 and matched to projected garden flowers using nearest-centroid matching (box center within `radius × 2.5` pixels of projected flower center). Target latency: ~5ms.

**Tier 2: `OnnxDetector` (ONNX Runtime CPU)**  
Loads `flower_detector.onnx` via `onnxruntime.InferenceSession` with 2 threads. The YOLOv8n output format is `[1, 84, 8400]`: first 4 values are `cx, cy, w, h` in pixels, next 80 are per-class scores. The model was trained with 3 classes: `flower_open`, `flower_closed`, `flower_cluster`. After confidence filtering (`> 0.20`) and NMS, boxes are matched to projected garden flowers the same way as Coral. Target latency: ~30ms.

**Tier 3: `MockDetector` (physics-based)**  
No ML required. For each flower, projects its position into camera space, computes horizontal distance from drone, and scores confidence as:
```python
base = max(0, 1.0 - hdist / (alt * 1.8))
conf = base * (0.6 + 0.4 * stability) * (0.6 + 0.4 * strength / 255)
```
Flowers with confidence < 0.12 are excluded. Results sorted by confidence descending. Always available.

**Fallback behavior.** If Coral inference fails (hardware disconnected, timeout > 2s), the bridge nulls out the Coral instance and falls to ONNX. If ONNX fails, it nulls out ONNX and falls to mock. These transitions are permanent for the session — no retry.

---

## Backend — Agent Server

### `agent_server.py` (port 8766)

FastAPI app with five endpoint types serving the LangChain planning agent.

### `POST /decide` — LangChain Planning Decision

The main planning endpoint. `_llm_decide(state)` runs:

**Step 1 — RAG retrieval:**
A semantic query string is assembled from the current state:
```
"phase=scanning battery=87 stability=0.72 discovered=3 pollinated=1"
```
`MissionStore.retrieve_context(query, k=3)` embeds this query and returns the 3 most similar past missions as formatted text. If the store is empty or unavailable, this returns an empty string and the step is skipped.

**Step 2 — System prompt construction:**
```
"You are an autonomous drone mission planner AI for a pollinator drone.
Your goal is to maximise flower pollination efficiency while managing
battery life and sensor conditions. You have access to planning tools.
Be concise and decisive.

[RAG context appended here if available]"
```

**Step 3 — User message construction:**
The current mission state is serialized into a concise natural-language message describing phase, position, altitude, battery, optical flow stability, discovered/pollinated counts, and remaining targets.

**Step 4 — LangChain `ChatAnthropic.invoke()` with callbacks:**
```python
lc_model = ChatAnthropic(model="claude-haiku-4-5-20251001", api_key=...).bind_tools(lc_tools)
response = lc_model.invoke(messages, config={"callbacks": [_terminal_callback]})
```
`bind_tools()` converts the LangChain `StructuredTool` list into the Anthropic tools format and attaches them to every call. The callback fires `on_chat_model_start` as the call begins and `on_llm_end` when it returns.

**Step 5 — Tool dispatch loop (max 3 rounds):**
```python
while tool_calls exist and round < 3:
    for each tool_call in response.tool_calls:
        result = dispatch(tool_call.name, tool_call.args)
        # Extract planning data from results
        if name == "compute_tsp_route": priority_override = result["route"]
        if name == "recommend_confidence_threshold": conf_threshold = result["threshold"]
        if name == "plan_scan_pattern": scan_spacing = result["spacing"]
    append AIMessage + ToolMessages to conversation
    invoke again
```
Each tool dispatch fires `on_tool_start` and `on_tool_end` callbacks.

**Step 6 — Decision assembly:**
The final `AIMessage` content string is the reasoning. Action type is inferred from which tools were called and from keywords in the reasoning text. Returns:
```json
{
  "action":              "replan",
  "reasoning":           "Battery at 72%, 4 flowers remain. TSP route optimized...",
  "priorityOverride":    ["r2", "r4", "r1", "r3"],
  "altitudeOverride":    null,
  "confidenceThreshold": 0.60,
  "scanSpacing":         null,
  "decisionMs":          340.2,
  "modelUsed":           "langchain/claude-haiku-4-5-20251001"
}
```

**Tool implementations** (called locally in Python, never sent to the LLM for execution):

| Tool | Logic |
|---|---|
| `compute_tsp_route` | Greedy nearest-neighbor from drone position. If `prioritize_confidence=True`, scores each flower by `confidence / distance` and picks the best combined score at each step. Caps route length by estimated battery range. |
| `estimate_battery_range` | `reachable = (battery − 20) / (8 + avg_dist × 0.5)`. The 20% floor is the minimum safe return battery. 8 = approx cost per flower visit in % units. |
| `recommend_confidence_threshold` | Delegates to `ConfidenceBandit.select_threshold()` if available, else applies a heuristic: base 0.40 (scanning), 0.75 (approach), adjusted ±0.05 by stability, ±0.03 by battery, ±0.05 by remaining count. |
| `plan_scan_pattern` | Spacing 3.5m if >3 flowers already found, 5.5m if 0 found, 4.5m otherwise. Computes `passes = garden_size / spacing`. |

**Graceful degradation.** If `ANTHROPIC_API_KEY` is unset or LangChain is not installed, `_mock_decision()` returns immediately with `action='continue'`, empty override, and fixed 0.75 threshold.

### `WS /terminal` — LangChain Callback Stream

Drains `_terminal_callback.drain()` (the global `DroneTerminalCallbackHandler` instance) every 100ms and sends batches:
```json
{ "events": [
  { "type": "agent", "text": "THINK  [claude-haiku-4-5-20251001]  Current mission state (T+34.2s)…" },
  { "type": "tsp",   "text": "TOOL:compute_tsp_route  drone_x=12.3 drone_y=8.4 battery=72…" },
  { "type": "ws-in", "text": "TOOL-RESULT  {\"route\": [\"r2\", \"r4\", \"r1\"], \"estimated_…" },
  { "type": "agent", "text": "RESULT  With battery at 72%, prioritizing the two closest…" }
]}
```
Multiple frontend clients can connect simultaneously. The drain is non-blocking and returns an empty list if no events are queued.

### `GET /stream` — SSE Commentary

An SSE endpoint that streams a 1–2 sentence mission narration for the current phase. Uses the raw `anthropic` SDK's `client.messages.stream()` context manager (not LangChain) since streaming and callbacks together require the raw SDK. Each text chunk is yielded as:
```
data: {"text": "The drone is descending", "done": false}
data: {"text": " to 1.5m hover altitude,", "done": false}
data: {"text": "", "done": true}
```
The system prompt instructs Claude to be "technical but accessible" and to focus on the most interesting aspect of the current moment. The user message includes a rich natural-language description of the phase, battery level interpretation, optical flow status, and mission progress.

### `POST /mission/save` — RAG Store Write

Receives `{events, telemetry}` and calls `MissionStore.save_mission()`. The telemetry includes `pollinatedIds`, `discoveredIds`, `battery_pct`, and `time`. Returns `{ok, total_missions}`.

### `POST /feedback` — Bandit Reward Signal

Receives `{phase, of_stability, battery_pct, success}` from the frontend (sent after each pollination). Calls `bandit.update_reward()` to adjust the UCB1 arm weights for the matching context bucket.

---

## LangChain Integration

### `DroneTerminalCallbackHandler` (`drone_callback.py`)

Subclasses `langchain_core.callbacks.BaseCallbackHandler`. A thread-safe `collections.deque(maxlen=300)` accumulates events. A `threading.Lock` protects both `_push()` and `drain()` since LangChain callbacks can fire from executor threads.

**Hooks implemented:**

```python
on_chat_model_start(serialized, messages, ...)
  # Fires as the LLM call starts — extracts model name and last message preview
  # → type="agent", text="THINK  [claude-haiku-4-5-20251001]  {first 70 chars}…"

on_llm_end(response, ...)
  # Fires when LLM returns — extracts first generation text
  # → type="agent", text="RESULT  {first 150 chars}"

on_tool_start(serialized, input_str, ...)
  # Fires before each tool execution — maps tool name to terminal type
  # compute_tsp_route/estimate_battery_range → type="tsp"
  # recommend_confidence_threshold/plan_scan_pattern → type="detect"
  # → text="TOOL:{name}  {first 80 chars of input}"

on_tool_end(output, ...)
  # Fires after tool returns — shows result
  # → type="ws-in", text="TOOL-RESULT  {first 100 chars}"

on_agent_action(action, ...)     → type="tsp",   text="AGENT-ACT  tool={name}  input={input}"
on_agent_finish(finish, ...)     → type="agent", text="AGENT-FIN  {output}"
on_llm_error(error, ...)         → type="error", text="LLM-ERROR  {message}"
on_tool_error(error, ...)        → type="error", text="TOOL-ERROR  {message}"
```

**Fallback.** If `langchain_core` is not installed, `drone_callback.py` defines no-op stub classes for `BaseCallbackHandler` and `LLMResult`. The rest of the server imports `DroneTerminalCallbackHandler` and it works — it just does nothing. The `CALLBACK_AVAILABLE` flag in `agent_server.py` controls whether it's attached to model calls.

---

## RAG Mission Memory

### `MissionStore` (`mission_store.py`)

**Embeddings.** `HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")` from `langchain-community`. This model produces 384-dimensional vectors, runs entirely on CPU (no GPU required), and downloads ~90MB on first run. `normalize_embeddings=True` ensures cosine similarity is equivalent to dot-product similarity, which Chroma uses internally.

**Vector store.** `Chroma(collection_name="drone_missions", persist_directory=".../mission_history/")` from `langchain-community`. Chroma persists to SQLite under the hood. The collection accumulates mission documents across server restarts — the drone's knowledge of past flights grows over time.

**Document format.** Each saved mission becomes one Chroma document. The page content is a prose summary built from the event log and final telemetry:
```
"Successfully pollinated 6/8 discovered flowers (75% success rate).
Mission duration 124s. moderate battery use (final 61%).
Phase sequence: Arming sequence → Taking off to 8m → Scanning — lawnmower pass
  → Computing optimal route → Approaching target → ...
Key events: Flower detected — r1 (3.2m lateral); Flower detected — r3 (1.8m lateral);
  POLLINATION COMPLETE — r1; POLLINATION COMPLETE — r3; ..."
```
Metadata stored: `pollinated` (int), `discovered` (int), `battery_final` (float), `duration_s` (float). These appear alongside retrieved documents for quick interpretation.

**Retrieval.** `similarity_search(query, k=min(3, collection_count))` returns the top-k documents by cosine similarity. The query is a compact state descriptor: `"phase=approach battery=72 stability=0.71 discovered=5 pollinated=2"`. The returned documents are formatted as:
```
Relevant past mission experiences:
  [1] Successfully pollinated 7/8 ... (pollinated=7, battery_end=58%, duration=118s)
  [2] Successfully pollinated 5/7 ... (pollinated=5, battery_end=42%, duration=145s)
  [3] Successfully pollinated 4/8 ... (pollinated=4, battery_end=39%, duration=162s)
```
This text block is appended to the Claude system prompt before each `/decide` call.

**Graceful degradation.** If `langchain-community`, `chromadb`, or `sentence-transformers` are not installed, `MissionStore.available = False` and all methods are silent no-ops. The `RAG_AVAILABLE` flag in `agent_server.py` skips retrieval entirely when false.

---

## UCB1 Confidence Bandit

### `ConfidenceBandit` (`confidence_bandit.py`)

A contextual multi-armed bandit that learns optimal detection confidence thresholds from mission experience.

**Context bucketing.** The state space is factored into three independent dimensions:
- **Phase tier**: `scanning` (scanning/planning), `approach` (descent/approach/target_lock/candidate_detected), `hover` (hover_align/pollinating)
- **Quality tier**: `high` (of_stability > 0.7), `med` (0.4–0.7), `low` (< 0.4)
- **Battery tier**: `high` (≥ 50%), `low` (< 50%)

This gives 3 × 3 × 2 = 18 possible contexts. Each is identified by a string key like `"approach_med_high"`.

**Arms.** Three threshold options per context: `[0.40, 0.60, 0.75]`. A lower threshold is more permissive (transitions happen earlier but may be premature). A higher threshold is more conservative (may be too slow to commit).

**UCB1 score.** Each arm tracks `[pulls, reward_sum]`. The UCB1 selection formula:
```
ucb_score(arm) = reward_sum / pulls + sqrt(2 × log(total_pulls) / pulls)
```
The exploration bonus `sqrt(2 × log(total) / pulls)` is large for rarely-tried arms, encouraging exploration. As more data is gathered, the exploitation term (`reward_sum / pulls`) dominates and the bandit converges to the best arm.

**Initialization.** New contexts start with `[[1, 0.5], [1, 0.5], [1, 0.5]]` — one phantom pull with neutral reward 0.5. This prevents division by zero and ensures all arms are initially explored roughly equally.

**Reward signal.** `update_reward(phase, of_stability, battery_pct, success=True/False)` converts `success` to `+1.0` / `-1.0` and adds it to the currently-best arm for that context. In practice, `success=True` is sent after each pollination, `success=False` could be sent on timeout (not currently wired but the endpoint exists via `/feedback`).

Over many missions, the bandit learns: for example, in `approach_low_low` (degraded sensor, low battery), a 0.40 threshold might get more reward than 0.75 because committing quickly before battery runs out is better than waiting for high confidence that may never come.

---

## End-to-End Data Flow

This is the complete flow for a single live mode frame tick:

```
requestAnimationFrame(ts)
│
├── dt = (ts - lastTs) / 1000   // capped at 100ms
│
├── nav.tick(dt, latestInference)
│   ├── time += dt, frameIdx++
│   ├── if inference: processInference(inf)
│   │   ├── update flower confidences from detections
│   │   ├── promote flower states (scanned → candidate → locked)
│   │   └── add server-discovered flowers to discoveredIds
│   ├── stepPhase(dt)   // advance FSM based on current phase
│   │   └── doScanning → doProximityDetection
│   │       ├── check each undiscovered flower < 4.5m
│   │       ├── mark discovered, update confidence
│   │       └── rerun computeTSPRoute if new discovery
│   ├── updateHistory()  // append to posHistory, altHistory
│   └── buildFrame()
│       ├── getSensorAtDistance(z * 39.37)
│       ├── computeOpticalFlowState(sample, frameIdx)
│       └── return LiveFrame { drone, sensor, flowers, phase, ... }
│
├── ws.send(lf.drone, lf.flowers, lf.phase)   // → :8765
│   └── inference_server receives, renders frame, detects, returns
│       └── latestInference updated on next RAF tick
│
├── if frameIdx % 30 == 0:
│   agent.requestDecision(lf)   // debounced 200ms → POST :8766/decide
│       └── agent returns AgentDecision
│           ├── nav.applyAgentDecision(decision)
│           │   ├── tspRoute = decision.priorityOverride (if valid)
│           │   └── currentConfidenceThreshold = decision.confidenceThreshold
│           └── agentState updated
│
├── if lf.phase != lastPhase:
│   agent.startCommentaryStream(lf)   // SSE :8766/stream
│       └── streams text chunks → onCommentary → AgentCommentaryPanel
│
├── liveToReplay(lf) → ReplayFrame   // adapter for existing panels
│
└── setFrame(lfWithAgent)   // React state update → re-render all panels

Every 100ms (in agent server):
  _terminal_callback.drain()
  → send to all /terminal WebSocket clients
  → liveInferenceEngine.pushTerminal(type, text)
  → terminal buffer → TerminalPanel (synced every 250ms)

On nav.done (mission complete):
  agent.saveMission(lf)   // POST :8766/mission/save
  → MissionStore.save_mission(events, telemetry)
  → build prose document from event log
  → embed with all-MiniLM-L6-v2
  → add to Chroma collection
  → available for retrieval in next session
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- (Optional) `ANTHROPIC_API_KEY` for LLM features

### 1. Install frontend dependencies
```bash
npm install
```

### 2. Install Python backend dependencies
```bash
# Inference server (minimal)
pip install -r drone-cv-system/server/requirements_server.txt

# Agent server (LangChain + Chroma + sentence-transformers)
pip install -r drone-cv-system/server/requirements_agent.txt
```

> **Note:** `sentence-transformers` downloads `all-MiniLM-L6-v2` (~90MB) on first use. This is a one-time download cached in `~/.cache/huggingface/`.

### 3. Set Anthropic API key (optional — falls back to mock)
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without an API key, the agent server runs in mock mode: decisions return `action='continue'` with fixed 0.75 threshold, SSE commentary returns placeholder text, and all LangChain imports are skipped. The simulation is fully functional either way.

### 4. Start both backend servers
```bash
# Option A — single script
bash drone-cv-system/server/start_servers.sh

# Option B — separate terminals
python3 drone-cv-system/server/inference_server.py   # :8765
python3 drone-cv-system/server/agent_server.py       # :8766
```

### 5. Start the frontend
```bash
npm run dev
```

Open http://localhost:5173. Select **REPLAY MODE** for the pre-generated deterministic simulation or **LIVE MODE** for the real-time autonomous mission with WebSocket inference and LLM agent.

In live mode, click the **TERMINAL** button in the header to open the terminal panel. Use the **AI** filter tab to see only LangChain callback events — LLM thoughts, tool calls, and tool results appear in real time as the agent reasons about the mission.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Claude API key. Unset = mock mode |
| Inference server port | `8765` | WebSocket endpoint |
| Agent server port | `8766` | HTTP/SSE/WS agent endpoints |
| Vite dev server port | `5173` | Frontend |
| RAG persist dir | `drone-cv-system/mission_history/` | Chroma SQLite files |
| Lawnmower default spacing | `4.5m` | Overridable by agent `plan_scan_pattern` tool |
| Agent decision interval | 30 frames (~1s) | `AGENT_DECISION_EVERY_N_FRAMES` in `liveInferenceEngine.ts` |
| Terminal drain interval | 100ms | Callback queue poll in `/terminal` WS handler |
| Terminal state sync | 250ms | `setInterval` in `liveInferenceEngine` |
| Decision debounce | 200ms | In `AgentClient.requestDecision()` |
| Proximity detect radius | 4.5m | `PROXIMITY_DETECT_RADIUS` in `autonomousNavigator.ts` |
| Patrol altitude | 8.0m | `PATROL_ALT` |
| Hover altitude | 1.5m | `HOVER_ALT` |
| Pollination dwell | 3.0s | `POLLINATE_DWELL_S` |
| Max LLM tool rounds | 3 | In `_llm_decide()` |
| RAG retrieval count | 3 | `k=3` in `retrieve_context()` |

---

## Physical Drone Hardware Stack

### Airframe & Propulsion

| Component | Spec |
|---|---|
| Frame | F450 glass-fiber quad, 450 mm wheelbase, plastic landing skid |
| Motors | 4× brushless — 2212 920 KV or 2213 935 KV |
| ESCs | 4× 20 A ESC |
| Propellers | 4× 9450 self-tightening (2× CW, 2× CCW) |
| Battery | 11.1 V 3S LiPo, 4200 mAh |
| Power module | 5 V 2 A BEC — powers Pixhawk; **separate** 5 V BEC for RPi and servo |

**Motor layout (ArduCopter X-quad):**

```
       FRONT
  1 (CCW) · 3 (CW)
     ·         ·
  2 (CCW) · 4 (CW)
       REAR
```

### RC Control (Manual Override Only)

The **FS-i6X transmitter + FS-iA6B receiver** connects to Pixhawk RC IN in PPM mode and is used exclusively for manual override. The entire autonomous mission runs without any RC input. The RC link provides:

- **CH5** → Flight mode switching (GUIDED ↔ STABILIZE/LOITER)
- **CH7** → RTL/failsafe
- **RC failsafe:** If signal is lost, Pixhawk executes RTL automatically
- `is_rc_override_active()` in `FlightController` detects when the pilot has switched out of GUIDED and pauses autonomous position commands

### Flight Controller — Pixhawk 2.4.8 (ArduCopter)

- **IMU fusion:** 3-axis accelerometer + gyroscope, fused by EKF2 extended Kalman filter
- **Barometer:** MS5611 for coarse altitude hold
- **GPS:** M8N u-blox module with integrated compass on foldable mast
- **MAVLink output:** TELEM2 port (SERIAL1 in ArduCopter) at 921 600 baud
- **Motor mixing:** PWM outputs MAIN OUT 1–4 drive the 4× 20 A ESCs. All stabilization loops (rate PID, attitude PID, altitude hold) run on Pixhawk — the companion computer only sends high-level `SET_POSITION_TARGET_LOCAL_NED` setpoints
- **AUX OUT 1:** Drives the pollen-dispenser servo via MAVLink `DO_SET_SERVO` (`SERVO9_FUNCTION = 0`, passthrough)
- **GUIDED mode:** Required for autonomous mission; RC override to any other mode pauses Python position commands immediately

### Companion Computer — Raspberry Pi 4

- Runs full Python CV + mission stack at ~20 Hz mission tick
- Communicates with Pixhawk over hardware UART (`/dev/ttyAMA0`, 921 600 baud) via pymavlink — Bluetooth must be disabled to free the hardware UART: `dtoverlay=disable-bt` in `/boot/config.txt`
- Sends position setpoints + arming commands to Pixhawk via MAVLink
- Triggers pollination servo via `FlightController.trigger_aux_servo()` → MAVLink `DO_SET_SERVO` on AUX OUT 1

### Google Coral USB Accelerator

The Coral USB Edge TPU is the primary inference accelerator:

| Property | Value |
|---|---|
| Interface | USB 3.0 (USB-C to USB-A on RPi) |
| Performance | ~4 TOPS (INT8), ~15–30 FPS on 320×320 MobileNet-SSD |
| Model format | EdgeTPU-compiled `.tflite` (INT8 quantized, uint8 NHWC input) |
| Runtime | `libedgetpu1-std` (apt) + `pycoral` (pip) |
| Compile | `edgetpu_compiler flower_detector.tflite → flower_detector_edgetpu.tflite` |

**Important tensor format difference:** Coral requires `[1, 320, 320, 3]` **uint8 NHWC** input — completely different from ONNX which requires `[1, 3, 640, 640]` float32 NCHW. The `CoralDetector` and `FramePreprocessor.read_frame_for_coral()` handle this conversion.

### Camera

Downward-facing camera (CSI or USB) capturing the garden below the drone:

- Center-cropped and resized to model input size (640×640 for ONNX, 320×320 for Coral)
- BGR → RGB conversion before inference
- Field of view at 1.5 m hover altitude: ~1.7 m × 1.7 m — sufficient to frame one flower cluster

### Pollination Mechanism

A **micro servo** arm actuates a lightweight pollen-dispenser assembly (pollen reservoir + dispensing gate + mounting bracket) mounted below the drone frame. The servo arm physically positions the dispenser over the flower and a gravity/air-puff mechanism releases pollen during the 2.5-second dwell.

**Actuation sequence (via `FlightController.trigger_aux_servo()`):**

1. Pixhawk receives `DO_SET_SERVO` → AUX OUT 1 → 1700 µs PWM → servo arm deploys
2. Hold 2.5 s (pollen transfer dwell)
3. Pixhawk receives `DO_SET_SERVO` → AUX OUT 1 → 1000 µs PWM → servo arm retracts

Hardware PWM from Pixhawk AUX ensures timing accuracy and the command is logged in DataFlash. A GPIO fallback (RPi PWM on pin 18) is available for bench testing without a Pixhawk.

### Wiring Diagram

```
Raspberry Pi UART                       Pixhawk 2.4.8 TELEM2
─────────────────                       ────────────────────
GPIO 14 (TX, /dev/ttyAMA0) ──────────→ TELEM2 RX
GPIO 15 (RX, /dev/ttyAMA0) ←────────── TELEM2 TX
GND                        ─────────── GND
(921600 baud, disable-bt overlay required)

Pixhawk 2.4.8 AUX OUT                  Pollen-Dispenser Servo
──────────────────────                  ──────────────────────
AUX OUT 1 (signal) ──────────────────→ Servo signal wire (orange)
Dedicated 5V BEC (+) ────────────────→ Servo power (red)   ← NOT RPi 5V pin
Common GND ──────────────────────────→ Servo ground (black)
(SERVO9_FUNCTION = 0 in ArduCopter params)

FS-iA6B Receiver (PPM)                 Pixhawk 2.4.8 RC IN
──────────────────────                  ───────────────────
PPM output ──────────────────────────→ RC IN (CH5 = flight mode, CH7 = RTL)

Coral USB Edge TPU                      Raspberry Pi
──────────────────                      ────────────
USB-C connector ─────────────────────→ USB 3.0 port

Downward camera (CSI) ───────────────→ RPi CSI connector (or USB)
```

---

## Firmware & MAVLink Integration

### MAVLink Interface (`mavlink_interface.py`)

The lowest layer of the drone-cv-system. Wraps pymavlink into a clean Python API with a **background reader thread** that continuously pulls MAVLink packets and writes them into a thread-safe `TelemetrySnapshot` object. The main mission thread reads the snapshot without blocking.

**Connection:**

```python
connection = mavutil.mavlink_connection(
    '/dev/ttyAMA0',   # RPi UART
    baud=921600,
    source_system=1
)
```

**`TelemetrySnapshot` fields written by background thread:**

```python
roll, pitch, yaw          # radians (ATTITUDE message)
rollspeed, pitchspeed, yawspeed
lat, lon, alt_msl         # GLOBAL_POSITION_INT
relative_alt              # altitude above home, mm → m
vx, vy, vz                # cm/s → m/s
heading                   # centidegrees → degrees
flow_x, flow_y            # integrated optical flow (OPTICAL_FLOW_RAD)
flow_quality              # 0-255
ground_distance           # meters (from Pixhawk-fused rangefinder)
rangefinder_distance      # raw DISTANCE_SENSOR distance, meters
ekf_flags                 # EKF_STATUS_REPORT bitmask
velocity_variance         # EKF velocity variance
pos_horiz_variance        # EKF horizontal position variance
battery_voltage           # millivolts → volts
battery_remaining         # 0-100 %
armed                     # bool
```

**Heartbeat monitoring:** A watchdog timer detects if no heartbeat arrives within 3 seconds and raises a `ConnectionLostError`.

### Flight Controller Wrapper (`flight_controller.py`)

Builds on `MAVLinkInterface` to provide mission-level commands:

| Method | MAVLink command | Notes |
|---|---|---|
| `pre_flight_checks()` | Reads telemetry snapshot | Verifies EKF healthy, GPS lock, battery >20%, not armed |
| `arm()` | `MAV_CMD_COMPONENT_ARM_DISARM (1)` | Requires GUIDED mode active first |
| `disarm()` | `MAV_CMD_COMPONENT_ARM_DISARM (0)` | Only if landed; force flag for emergency |
| `takeoff(alt_m)` | `MAV_CMD_NAV_TAKEOFF` | Blocks until altitude reached ±0.5 m |
| `goto_ned(n,e,d)` | `SET_POSITION_TARGET_LOCAL_NED` | NED frame, velocity feed-forward |
| `trigger_aux_servo(ch, pwm)` | `MAV_CMD_DO_SET_SERVO` | Drives AUX OUT 1 → pollen dispenser |
| `is_rc_override_active()` | Reads `telem.mode` | True if pilot switched out of GUIDED |
| `precision_hover(x, y, alt)` | `SET_POSITION_TARGET_LOCAL_NED` | Tighter tolerance (±0.1m XY, ±0.05m Z) for hover_align |
| `land()` | `MAV_CMD_NAV_LAND` | Blocks until landed + disarmed |
| `set_mode(mode)` | `SET_MODE` | Switches GUIDED / STABILIZE / LOITER |

### Telemetry Messages Consumed

| MAVLink Message | Rate | Fields Used |
|---|---|---|
| `ATTITUDE` (30) | 50 Hz | roll, pitch, yaw, yawspeed |
| `GLOBAL_POSITION_INT` (33) | 10 Hz | lat, lon, relative_alt, vx, vy, vz, hdg |
| `OPTICAL_FLOW_RAD` (106) | 20 Hz | integrated_x/y, quality, time_delta_distance_us, ground_distance |
| `DISTANCE_SENSOR` (132) | 20 Hz | current_distance, min/max_distance, type |
| `EKF_STATUS_REPORT` (193) | 2 Hz | flags, velocity_variance, pos_horiz_variance, terrain_alt_variance |
| `SYS_STATUS` (1) | 1 Hz | voltage_battery, current_battery, battery_remaining |
| `HEARTBEAT` (0) | 1 Hz | armed state, flight mode |

---

## Computer Vision Pipeline (Real Drone)

### Frame Preprocessor (`frame_preprocessor.py`)

Handles camera input regardless of source (USB UVC, CSI ribbon, file). Steps applied to every frame:

1. Capture raw frame (BGR from OpenCV)
2. Center-crop to square aspect ratio
3. Resize to 640×640 using `INTER_LINEAR`
4. Convert BGR → RGB
5. Normalize pixel values to `[0, 1]` float32
6. Expand dims to `[1, 3, 640, 640]` NCHW tensor layout for ONNX, or `[1, 320, 320, 3]` uint8 NHWC for Coral

### YOLOv8 Flower Detector (`flower_detector.py`)

Wraps the ONNX Runtime session and post-processes raw YOLOv8 output into clean Python detection objects.

**Input:** `[1, 3, 640, 640]` float32 tensor  
**Raw output:** `[1, 84, 8400]` — 8400 anchor proposals, each with 4 bbox coords + 80 class scores  
**Classes used:** `flower_open` (class 0), `flower_closed` (class 1), `flower_cluster` (class 2)

**Post-processing steps:**

1. Transpose output to `[8400, 84]`
2. Extract `cx, cy, w, h` from columns 0–3
3. Extract class scores from columns 4–83; take `argmax` and `max` as class ID + confidence
4. Filter: confidence > 0.25 and class in {0, 1, 2}
5. Convert `cx, cy, w, h` → `x1, y1, x2, y2` pixel coordinates
6. Apply NMS (IoU threshold 0.45) to remove overlapping boxes
7. Build `Detection` objects:

```python
@dataclass
class Detection:
    x1, y1, x2, y2: float       # pixel bbox
    confidence: float            # 0–1
    class_id: int                # 0/1/2
    class_name: str              # flower_open / flower_closed / flower_cluster
    center_x, center_y: float   # bbox center
    width, height: float
    area: float
    bearing: Optional[np.ndarray]       # unit vector camera→flower
    distance_estimate: Optional[float]  # meters (from DepthEstimator)
```

### Optical Flow Tracker (`optical_flow_tracker.py`)

Provides temporal continuity for detections across frames using **Lucas-Kanade sparse optical flow** (OpenCV `calcOpticalFlowPyrLK`).

**Algorithm:**

1. Maintain a list of active `Track` objects (one per flower being tracked)
2. Each `Track` stores: bbox, confidence, age (frames active), last seen frame
3. On each new frame:
   - Extract bounding box corners as keypoints
   - Run LK optical flow to predict new keypoint positions
   - Recompute bboxes from moved keypoints
   - Match YOLOv8 detections to predicted tracks using IoU
   - **EMA smoothing** on matched tracks: `bbox = 0.6 × new_detection + 0.4 × predicted`
   - Increment age on matched tracks, mark unmatched tracks as stale after 10 frames
4. Return merged list of smoothed active tracks

This prevents the jitter from per-frame YOLO detections and maintains stable IDs across frames.

### Depth Estimator (`depth_estimator.py`)

Estimates physical distance to detected flowers (meters) from:

1. **Apparent bbox size:** The physical width of a flower cluster (~0.3m) divided by the bounding box width in pixels, scaled by focal length
2. **Altitude fusion:** When rangefinder altitude is available, the depth estimate is blended with a geometry-based estimate using the drone's current tilt angle
3. **Output:** Absolute distance in meters, written into each `Detection.distance_estimate`

---

## ML Model — YOLOv8 Flower Detection

### Model Architecture

**YOLOv8n (nano)** — chosen for inference speed on the Raspberry Pi 4:

| Property | Value |
|---|---|
| Parameters | 3.2 M |
| Model size | ~6.3 MB (ONNX) |
| Input | 640×640×3 |
| Backbone | CSPDarknet (5 stages, C2f bottleneck blocks) |
| Neck | PAN-FPN (3 detection scales: 80×80, 40×40, 20×20) |
| Head | Decoupled detection head (separate cls/reg branches) |
| RPi inference time | ~180 ms (ONNX Runtime, CPU) |
| Laptop inference time | ~12 ms (GPU) |

**Classes:**

| ID | Name | Description |
|---|---|---|
| 0 | `flower_open` | Fully open flower, visible pistil/stamens |
| 1 | `flower_closed` | Budded or partially open flower |
| 2 | `flower_cluster` | Dense group of flowers treated as a single target |

### Training Pipeline

```
1. Dataset collection
   Sources: COCO (flowers subset), iNaturalist flower images, Roboflow community datasets
   Annotation: LabelImg, YOLO format (.txt per image, normalized bbox + class)
   Split: 80% train / 10% val / 10% test

2. Augmentation (Ultralytics built-in)
   Mosaic (4-image), random flip, HSV jitter (hue ±0.015, sat ±0.7, val ±0.4)
   Scale (±50%), translate (±10%), cutmix (close-range images)

3. Fine-tuning command
   python train.py --model yolov8n.pt --data flowers.yaml \
     --epochs 100 --imgsz 640 --batch 16 --lr0 0.01 \
     --patience 20 --device 0

4. Evaluation targets
   mAP@50:    >0.72
   mAP@50-95: >0.45
   Precision: >0.70
   Recall:    >0.65

5. Export to ONNX
   from ultralytics import YOLO
   model = YOLO('best.pt')
   model.export(format='onnx', imgsz=640, simplify=True, opset=12)
   # Output: best.onnx  (~6.3 MB)

6. Export to EdgeTPU TFLite (for Coral)
   model.export(format='tflite', int8=True, imgsz=320)
   edgetpu_compiler flower_detector.tflite
   # Output: flower_detector_edgetpu.tflite
```

ONNX Runtime on the Raspberry Pi 4 runs the model in **CPU execution provider** mode with `opset=12` for maximum compatibility. The session is loaded once at startup and reused across all frames (first load ~800ms).

### Detection Dataflow

```
Camera frame (640×640 RGB)
         ↓
FramePreprocessor  →  [1, 3, 640, 640] float32 tensor
         ↓
ONNX Runtime sess.run()  →  [1, 84, 8400] raw output
         ↓
Transpose + confidence filter (>0.25) + NMS (IoU 0.45)
         ↓
List[Detection] with pixel bboxes + class + confidence
         ↓
OpticalFlowTracker  →  temporally smoothed + stable IDs
         ↓
DepthEstimator     →  each detection gets distance_estimate
         ↓
StateMachine.process_detections()
```

---

## Pollination Manager

`drone-cv-system/mission/pollination_manager.py` tracks flower target state and controls the physical pollination hardware.

**Garden state tracking:**

```python
@dataclass
class FlowerTarget:
    id: str
    x: float          # meters in garden space
    y: float
    visited: bool = False
    pollinated: bool = False
    detection_count: int = 0
    last_confidence: float = 0.0
```

**Pollination sequence** (triggered by `StateMachine` on entering `pollinating` phase):

```python
def trigger_pollination(self, flower_id: str):
    # 1. Extend servo arm to contact position via MAVLink AUX channel
    flight_controller.trigger_aux_servo(channel=9, pwm=1700)  # deploy

    # 2. Dwell 2.5 seconds for pollen transfer
    time.sleep(2.5)

    # 3. Retract servo
    flight_controller.trigger_aux_servo(channel=9, pwm=1000)  # stow

    # 4. Mark flower pollinated
    self.targets[flower_id].pollinated = True
```

GPIO fallback for bench testing (no Pixhawk required):

```python
GPIO.setup(SERVO_PIN, GPIO.OUT)
pwm = GPIO.PWM(SERVO_PIN, 50)   # 50 Hz
pwm.start(7.5)                  # neutral
pwm.ChangeDutyCycle(10.0)       # deploy (~1700µs @ 50Hz)
time.sleep(2.5)
pwm.ChangeDutyCycle(2.5)        # stow (~1000µs @ 50Hz)
```

---

## Hardware Assembly & Setup

### Assembly Checklist

1. **Frame:** F450 glass-fiber quad, 450 mm wheelbase, landing skid attached
2. **Flight controller:** Pixhawk 2.4.8 on vibration damping plate (top deck)
3. **Power:** 11.1 V 3S 4200 mAh LiPo in middle deck; power module to Pixhawk POWER port
4. **ESCs:** 4× 20 A ESC connected to MAIN OUT 1–4 and to LiPo distribution
5. **Motors:** 4× 2212 920 KV brushless; 9450 self-tightening props (CCW on 1/2, CW on 3/4)
6. **GPS + Compass:** M8N GPS on foldable mast, connected to Pixhawk GPS port
7. **RC receiver:** FS-iA6B in PPM mode → Pixhawk RC IN (CH5 flight mode, CH7 RTL)
8. **Companion computer:** Raspberry Pi mounted on bottom deck; **dedicated 5 V BEC** for power (not from Pixhawk BEC)
9. **Coral USB TPU:** Google Coral USB Accelerator in RPi USB 3.0 port
10. **Camera:** Downward-facing camera (CSI or USB) on RPi, pointed directly down
11. **UART bridge:** RPi GPIO 14/15 → Pixhawk TELEM2 (921 600 baud)
12. **Pollination payload:** Micro servo on bracket; servo signal → Pixhawk AUX OUT 1; servo power → dedicated 5 V BEC (shared ground)

### Software Setup on Raspberry Pi

```bash
# Flash Raspberry Pi OS Lite (64-bit) to SD card

# 1. Enable UART, disable Bluetooth (to free /dev/ttyAMA0 for Pixhawk)
echo "enable_uart=1" >> /boot/config.txt
echo "dtoverlay=disable-bt" >> /boot/config.txt
sudo reboot

# 2. Install system dependencies
sudo apt update && sudo apt install -y python3-pip python3-opencv libopencv-dev

# 3. Install Google Coral USB runtime
echo "deb https://packages.cloud.google.com/apt coral-edgetpu-stable main" | \
    sudo tee /etc/apt/sources.list.d/coral-edgetpu.list
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key add -
sudo apt update && sudo apt install libedgetpu1-std

# 4. Install Python packages
pip3 install pymavlink onnxruntime pillow loguru RPi.GPIO pyyaml
# Coral packages (from Coral index):
pip3 install pycoral tflite-runtime \
    --extra-index-url https://google-coral.github.io/py-packages/

# 5. Upload models
scp flower_detector.onnx pi@drone-pi.local:~/drone-cv-system/models/
scp flower_detector_edgetpu.tflite pi@drone-pi.local:~/drone-cv-system/models/

# 6. Start mission
python3 drone-cv-system/main.py
```

### ArduCopter Parameters Required

| Parameter | Value | Reason |
|---|---|---|
| `SERIAL1_BAUD` | 921 | TELEM2 baud rate (921600) |
| `SERIAL1_PROTOCOL` | 2 | MAVLink 2.0 on TELEM2 |
| `SERVO9_FUNCTION` | 0 | AUX OUT 1 passthrough for pollen servo |
| `WPNAV_RADIUS` | 100 | 1 m waypoint acceptance radius |
| `GUIDED_OPTIONS` | 0 | Accept velocity setpoints from companion |
| `FS_THR_ENABLE` | 1 | RC throttle failsafe → RTL on signal loss |
| `FLTMODE_CH` | 5 | CH5 for flight mode switching |

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend framework | Preact 10 + TypeScript 5 | React-compatible, smaller bundle |
| Build tool | Vite 5 + `@preact/preset-vite` | HMR, proxy middleware |
| Styling | Tailwind CSS v4 + `@tailwindcss/vite` | Utility classes + custom animations |
| Rendering | Pure SVG (no canvas/WebGL) | All panels are SVG with CSS animations |
| State management | Preact hooks only | No Redux/Zustand/MobX |
| Backend framework | FastAPI + uvicorn | Async WebSocket + HTTP + SSE |
| LLM integration | `langchain-anthropic` + `langchain-core` | `ChatAnthropic`, `BaseCallbackHandler`, `StructuredTool` |
| LLM model | Claude claude-haiku-4-5-20251001 | Fast + cheap for real-time decisions |
| RAG embeddings | `sentence-transformers/all-MiniLM-L6-v2` | 384-dim, local CPU, ~90MB |
| RAG vector store | Chroma (`langchain-community`) | SQLite persistence, cosine similarity |
| Computer vision | ONNX Runtime + YOLOv8n | 3.2M params, 6.3MB, COCO mAP50 37.3 |
| TPU inference | Google Coral pycoral + EdgeTPU | INT8 TFLite, ~5ms/frame |
| Bandit | UCB1 (custom Python) | No ML framework dependency |
| Streaming | SSE + WebSocket | Commentary (SSE), terminal + inference (WS) |
| Hardware target | Raspberry Pi 4 + Pixhawk 6 + Coral USB | Production autonomous flight |
