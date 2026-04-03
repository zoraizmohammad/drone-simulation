# Smart Pollinator Drone — Mission Simulation & Agentic CV System

A full-stack autonomous pollinator drone platform with an integrated LLM-powered mission planner. The project has two integrated halves that mirror each other exactly: a browser-based interactive mission dashboard (Preact + TypeScript + Vite) and a production-grade autonomous flight + vision system (Python FastAPI, Raspberry Pi 4, Pixhawk 6, Google Coral TPU). The same 13-phase mission logic, sensor model, and TSP path-planning algorithm run in both environments.

An LLM agent (Claude Haiku via Anthropic SDK) provides real-time mission decisions, route replanning, adaptive confidence thresholds via a UCB1 contextual bandit, and streaming mission commentary.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Preact + TS)                     │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  TopDownView │  │  SideView    │  │ TelemetryPanel   │  │
│  │  (SVG garden)│  │ (alt chart)  │  │ (sensor HUD)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────────────────────────────┐ │
│  │  Camera      │  │  AgentCommentaryPanel                │ │
│  │  Analysis    │  │  (AI MISSION ANALYST strip)          │ │
│  └──────────────┘  └──────────────────────────────────────┘ │
│                                                             │
│  AutonomousNavigator ← liveInferenceEngine ← RAF loop       │
│         ↑                      ↑                            │
│    AgentClient            WsClient                          │
│    (HTTP/SSE)             (WebSocket)                       │
└────────────┬────────────────────┬───────────────────────────┘
             │                    │
    HTTP POST/GET/SSE         WebSocket
             │                    │
┌────────────▼───────┐  ┌─────────▼──────────────────────────┐
│  Agent Server :8766 │  │  Inference Server :8765            │
│  (FastAPI)          │  │  (FastAPI WebSocket)               │
│                     │  │                                    │
│  /decide            │  │  /inference — WS endpoint         │
│   Claude Haiku      │  │   DetectionBridge:                 │
│   tool_use loop     │  │     1. Google Coral TPU            │
│                     │  │     2. ONNX CPU fallback           │
│  Tools:             │  │     3. Physics mock                │
│  - compute_tsp      │  │   scene_renderer.py               │
│  - battery_range    │  │   TSP suggestion                   │
│  - conf_threshold   │  └────────────────────────────────────┘
│  - scan_pattern     │
│                     │
│  UCB1 Bandit        │
│  (conf thresholds)  │
│                     │
│  /stream — SSE      │
│  /feedback          │
│  /health /metrics   │
└─────────────────────┘
```

---

## Features

### Dashboard Panels
- **Top-Down Garden View** — SVG 20m×20m garden with organic flower clusters, drone body with rotor spin, motion trail, TSP route overlay, **AI route visualization** (purple dashed)
- **Altitude Side View** — cross-section chart with altitude history sparkline
- **Telemetry Dashboard** — engineering HUD: position, velocity, attitude, battery, signal, optical flow sensor data, detection confidence, mission progress, **AI Agent section**
- **Camera / Flower Analysis** — layered SVG camera view with detection reticle, heatmap, sparkle particles, optical flow vectors, sensor HUD overlay

### Simulation Modes
- **Replay Mode** — deterministic 90-second pre-generated mission, 2700 frames at 30fps, scrub/seek/speed controls
- **Live Mode** — real-time autonomous flight with WebSocket inference server + LLM agent

### Sensor Models
- Distance-driven optical flow simulation from real sensor data (24-row CSV, 0–276 inches)
- UCB1-adaptive detection confidence thresholds
- EKF confidence, rangefinder, sonar, battery degradation

### AI / Agentic System
- **Claude Haiku** via Anthropic SDK (no LangChain dependency)
- Tool-calling loop (max 3 rounds): TSP route, battery range, confidence threshold, scan pattern
- UCB1 contextual bandit with 3 arms × 12 context buckets for adaptive thresholds
- SSE streaming commentary — 1-2 sentence technical narration on phase transitions
- Closed-loop reward: pollination events POST `/feedback` to update bandit
- Graceful degradation: mock decisions when `ANTHROPIC_API_KEY` unset or server down

---

## Quick Start

### 1. Install frontend dependencies
```bash
npm install
```

### 2. Install Python backend dependencies
```bash
pip install -r drone-cv-system/server/requirements_server.txt
pip install -r drone-cv-system/server/requirements_agent.txt
```

### 3. Set Anthropic API key (required for LLM agent; optional for mock mode)
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Start both backend servers
```bash
npm run start-servers
# OR manually:
python3 drone-cv-system/server/inference_server.py &
python3 drone-cv-system/server/agent_server.py &
```

### 5. Start the Vite dev server
```bash
npm run dev
```

Open http://localhost:5173 and select **LIVE MODE** for the full agentic experience, or **REPLAY MODE** for the deterministic simulation.

---

## Backend Architecture

### Inference Server (port 8765)
`drone-cv-system/server/inference_server.py`

WebSocket endpoint `/inference`. Receives drone state + flower positions, renders a synthetic 640×640 camera frame, runs detection, and returns detections + TSP suggestion.

**Detection hierarchy:**
1. Google Coral USB TPU (`flower_detector_edgetpu.tflite`) — primary, ~5ms
2. ONNX CPU fallback (`flower_detector.onnx`) — ~30ms
3. Physics-based mock detector — always available, zero deps

### Agent Server (port 8766)
`drone-cv-system/server/agent_server.py`

| Endpoint | Description |
|---|---|
| `POST /decide` | LLM planning decision with tool_use loop |
| `GET /stream` | SSE streaming mission commentary |
| `WS /agent` | WebSocket mirror of /decide |
| `GET /health` | Server status + API key check |
| `GET /metrics` | Decisions, overrides, avg latency, bandit stats |
| `GET /decisions/recent` | Last 10 decisions with reasoning |
| `POST /feedback` | Reward signal for UCB1 bandit |

**Tool implementations (called locally when Claude uses tool_use):**
- `compute_tsp_route` — greedy nearest-neighbor with confidence weighting
- `estimate_battery_range` — formula: `reachable = (battery - 20) / (8 + dist * 0.5)`
- `recommend_confidence_threshold` — delegates to UCB1 bandit
- `plan_scan_pattern` — adaptive spacing: 3.5m (dense) / 4.5m (default) / 5.5m (sparse)

### Confidence Bandit (`confidence_bandit.py`)
UCB1 multi-armed bandit with context buckets:
- Phase tier: scanning / approach / hover
- Sensor quality tier: high / medium / low (by optical flow stability)
- Battery tier: high (≥50%) / low (<50%)

3 threshold arms per context: 0.40, 0.60, 0.75. Reward: +1 on pollination, -1 on abort.

---

## Frontend Architecture

```
src/
  app/
    App.tsx                  — Root app, mode selector, layout, live/replay sub-apps
  components/
    TopDownView/             — SVG garden map, drone, flowers, TSP + AI route
    SideView/                — SVG altitude cross-section
    TelemetryPanel/          — Sensor HUD with AI Agent section
    ZoomPanel/               — Camera analysis wrapper
    AgentPanel/
      AgentCommentaryPanel   — AI Mission Analyst strip (commentary, decision, stats)
    camera-analysis/
      CameraAnalysisPanel    — Layered SVG camera view
      FlowVectorOverlay      — Optical flow field visualization
      OpticalFlowHud         — Sensor data overlay
    LiveStatus/              — WS + agent status indicators
    ReplayControls/          — Scrub/play/speed controls
    TerminalPanel/           — Color-coded flight computer log
  simulation/
    liveInferenceEngine.ts   — RAF loop + AgentClient integration
    autonomousNavigator.ts   — 13-phase state machine, TSP, bandit feedback
    agentClient.ts           — HTTP/SSE client for agent server
    replayEngine.ts          — Deterministic replay with seek
    wsClient.ts              — WebSocket client for inference server
    opticalFlowModel.ts      — Physics-based optical flow
    sensorInterpolation.ts   — Binary search + smooth-step interpolation
  data/
    missionGenerator.ts      — 2700-frame deterministic mission (replay)
    randomMissionGenerator.ts — Seeded garden + adaptive lawnmower path
  models/
    types.ts                 — All TypeScript interfaces incl. AgentDecision, AgentState
```

---

## Optical Flow Sensor System

Sensor values are derived from `drone.z` (altitude) rather than mission time, making the simulation physically grounded.

- **Real data**: `raw_opticalflow_data.csv` — 24 rows, 0–276 inches (0–7m)
- **Interpolation**: binary search + smooth-step easing `t = t²(3−2t)`
- **Degradation**: above 5m (197in) quality/stability reduced up to −70%
- **CV coupling**: detection confidence modulated by `stabilityFactor × strengthFactor`

---

## Mission Phases

| Phase | Description |
|---|---|
| `idle` | Drone on ground |
| `arming` | Pre-flight checks, motor arm |
| `takeoff` | Climb to 8m patrol altitude |
| `scanning` | Lawnmower pass, proximity detection |
| `planning` | TSP route computation (2.5s) |
| `approach` | Flying to target flower at 8m |
| `descent` | Descending 8m → 1.5m |
| `hover_align` | Precision XY alignment at ≈1.5m |
| `pollinating` | Pollination mechanism active (3s dwell) |
| `ascent` | Climbing back to 8m |
| `resume` | Moving to next TSP target |
| `mission_complete` | Return to home |
| `landing` | Final descent to ground |

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Anthropic API key for Claude Haiku |
| Port 8765 | fixed | WebSocket inference server |
| Port 8766 | fixed | HTTP/SSE/WS agent server |
| Port 5173 | Vite default | Frontend dev server |

---

## Hardware Notes

The production system targets:
- **Flight controller**: Pixhawk 4/6 (ArduPilot/PX4)
- **Companion computer**: Raspberry Pi 4 (4GB) running inference_server.py
- **Vision accelerator**: Google Coral USB TPU — EdgeTPU-compiled INT8 TFLite model at ~5ms/frame
- **Sensors**: TFMini-S rangefinder, PX4Flow optical flow, GPS
- **Frame**: DJI F450 with 10" propellers, 4S LiPo

To compile for Coral:
```bash
edgetpu_compiler drone-cv-system/models/flower_detector.tflite
pip install pycoral tflite-runtime
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Preact 10, TypeScript 5, Vite 5, Tailwind CSS v4 |
| Rendering | Pure SVG (no canvas/WebGL), CSS animations |
| State | Preact hooks — no external state library |
| Backend inference | FastAPI, uvicorn, WebSocket |
| Backend agent | FastAPI, Anthropic SDK (claude-haiku-4-5-20251001) |
| Computer vision | ONNX Runtime, Google Coral pycoral, YOLOv8 |
| Bandit | UCB1 (custom Python, no ML framework) |
| Streaming | Server-Sent Events (SSE) |
| Hardware | Raspberry Pi 4, Pixhawk 6, Google Coral USB TPU |
