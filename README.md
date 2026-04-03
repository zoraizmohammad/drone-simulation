# Smart Pollinator Drone — Mission Simulation & Agentic CV System

A full-stack autonomous pollinator drone platform with an integrated LLM-powered mission planner. The project has two integrated halves that mirror each other exactly: a browser-based interactive mission dashboard (Preact + TypeScript + Vite) and a production-grade autonomous flight + vision system (Python FastAPI, Raspberry Pi 4, Pixhawk 6, Google Coral TPU). The same 13-phase mission logic, sensor model, and TSP path-planning algorithm run in both environments.

An LLM agent (Claude Haiku via Anthropic SDK) provides real-time mission decisions, route replanning, adaptive confidence thresholds via a UCB1 contextual bandit, and streaming mission commentary.

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                      Browser (Preact + TS)                        │
│                                                                  │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────────┐  │
│  │ TopDownView │ │  SideView    │ │    TelemetryPanel         │  │
│  │ (SVG garden)│ │ (alt chart)  │ │ (sensor HUD + AI section) │  │
│  └─────────────┘ └──────────────┘ └──────────────────────────┘  │
│  ┌─────────────┐ ┌──────────────────────────────────────────┐   │
│  │   Camera    │ │      AgentCommentaryPanel                │   │
│  │  Analysis   │ │  (streaming commentary, decisions, RAG)  │   │
│  └─────────────┘ └──────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TerminalPanel  [SYS][PHASE][WS][INFER][NAV][AI]        │    │
│  │  AI tab shows emerald LangChain callback events         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  AutonomousNavigator ← liveInferenceEngine ← RAF 30fps loop      │
│    applyAgentDecision()        ↑            ↑                    │
│    currentConfidenceThreshold  │            │                    │
│    scanSpacing                 │            │                    │
│                         AgentClient    WsClient                  │
│                     ┌── HTTP POST ──┐  (WebSocket)               │
│                     │── SSE GET ────│                            │
│                     │── WS /terminal│ ← LangChain callbacks      │
│                     └── WS /agent ──┘                            │
└────────────┬─────────────────────────┬───────────────────────────┘
             │                         │
   :8766 HTTP/SSE/WS              :8765 WebSocket
             │                         │
┌────────────▼──────────────┐  ┌───────▼────────────────────────┐
│  Agent Server :8766        │  │  Inference Server :8765        │
│  FastAPI + LangChain       │  │  FastAPI WebSocket             │
│                            │  │                                │
│  /decide — ChatAnthropic   │  │  /inference                   │
│   bind_tools() + callbacks │  │   DetectionBridge:             │
│   RAG context injected     │  │     1. Coral TPU               │
│   max 3 tool rounds        │  │     2. ONNX CPU                │
│                            │  │     3. Physics mock            │
│  LangChain Tools:          │  │   scene_renderer.py           │
│  - compute_tsp_route       │  └────────────────────────────────┘
│  - estimate_battery_range  │
│  - recommend_conf_thresh   │  ┌────────────────────────────────┐
│  - plan_scan_pattern       │  │  Chroma RAG Store              │
│                            │  │  (drone-cv-system/             │
│  DroneTerminalCallback     │  │   mission_history/)            │
│   BaseCallbackHandler      │  │                                │
│   → /terminal WS queue     │  │  all-MiniLM-L6-v2 embeddings  │
│                            │  │  (local CPU, no API key)       │
│  UCB1 ConfidenceBandit     │  │                                │
│  /stream SSE commentary    │  │  save: POST /mission/save      │
│  /feedback bandit reward   │  │  query: before each /decide    │
│  /mission/save → Chroma    │  └────────────────────────────────┘
│  /health /metrics          │
└────────────────────────────┘
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
- **Claude Haiku** via **LangChain `ChatAnthropic`** — `bind_tools()` + structured tool-calling loop (max 3 rounds)
- **LangChain `BaseCallbackHandler`** — `DroneTerminalCallbackHandler` intercepts every LLM thought, tool invocation, and tool result. Events stream in real time to the drone terminal panel over a dedicated `/terminal` WebSocket — visible as emerald **AI** entries
- **Chroma RAG** — completed missions embedded with `sentence-transformers/all-MiniLM-L6-v2` (local CPU, no API key) into a persistent Chroma collection. Top-3 similar past missions injected into the Claude system prompt before each `/decide` call, giving the agent narrative memory across sessions
- **UCB1 contextual bandit** (`confidence_bandit.py`) — 3 threshold arms × 12 context buckets (phase × sensor quality × battery tier) for adaptive detection confidence
- **SSE streaming commentary** — 1-2 sentence technical narration on every phase transition
- **Closed-loop feedback** — pollination events POST `/feedback` to update bandit; completed missions POST `/mission/save` to extend the RAG store
- **Graceful degradation** — mock decisions when `ANTHROPIC_API_KEY` unset; all agent features silently disabled when server unreachable

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
| `POST /decide` | LangChain ChatAnthropic + tool loop, RAG context injected |
| `GET /stream` | SSE streaming mission commentary |
| `WS /agent` | WebSocket mirror of /decide |
| `WS /terminal` | Real-time LangChain callback events → drone terminal |
| `GET /health` | Server status, LangChain/RAG/bandit availability |
| `GET /metrics` | Decisions, overrides, avg latency, bandit stats, RAG count |
| `GET /decisions/recent` | Last 10 decisions with reasoning |
| `POST /feedback` | Reward signal for UCB1 bandit |
| `POST /mission/save` | Embed completed mission into Chroma RAG store |

**LangChain integration:**
The `/decide` endpoint uses `langchain_anthropic.ChatAnthropic` with `.bind_tools()`, so tool calls are expressed as LangChain `ToolCall` objects on the `AIMessage`. A `DroneTerminalCallbackHandler` (subclass of `langchain_core.callbacks.BaseCallbackHandler`) is passed in `config={"callbacks": [...]}` on every `invoke()` call. It fires on `on_chat_model_start`, `on_llm_end`, `on_tool_start`, `on_tool_end`, and `on_agent_finish` — queuing events that the `/terminal` WebSocket drains every 100ms.

**RAG pipeline:**
Before each `/decide` call, a semantic query is built from the current phase, battery, and sensor state. `MissionStore.retrieve_context()` embeds the query with `all-MiniLM-L6-v2` and performs cosine similarity search against the Chroma collection. The top-3 matching past missions are appended to the Claude system prompt as "Relevant past mission experiences", giving the agent cross-session memory without any API calls for retrieval.

**Tool implementations:**
- `compute_tsp_route` — greedy nearest-neighbor with optional confidence/distance weighting
- `estimate_battery_range` — formula: `reachable = (battery − 20) / (8 + dist × 0.5)`
- `recommend_confidence_threshold` — delegates to UCB1 bandit or heuristic fallback
- `plan_scan_pattern` — spacing 3.5m (density >3) / 4.5m (default) / 5.5m (none found)

### LangChain Callback Handler (`drone_callback.py`)
`DroneTerminalCallbackHandler(BaseCallbackHandler)` — thread-safe event accumulator.

Hooks implemented:
| Hook | Terminal type | Content |
|---|---|---|
| `on_chat_model_start` | `agent` (emerald) | LLM call preview |
| `on_llm_end` | `agent` | Final reasoning/decision text |
| `on_tool_start` | `tsp` / `detect` | Tool name + truncated input |
| `on_tool_end` | `ws-in` | Tool result (truncated) |
| `on_agent_finish` | `agent` | AgentExecutor final output |
| `on_llm_error` / `on_tool_error` | `error` | Error message |

### RAG Mission Store (`mission_store.py`)
`MissionStore` wraps `langchain_community.vectorstores.Chroma` + `HuggingFaceEmbeddings`.

- **Model**: `sentence-transformers/all-MiniLM-L6-v2` — 384-dim, ~90MB, runs on CPU
- **Persistence**: `drone-cv-system/mission_history/` — survives server restarts
- **Document format**: prose summary — outcome, duration, battery, phase sequence, key events
- **Metadata**: pollinated count, discovered count, battery_final, duration_s
- **Retrieval**: `similarity_search(query, k=3)` — cosine similarity over 384-dim embeddings
- **Graceful degradation**: `available=False` when deps missing; all methods are no-ops

### Confidence Bandit (`confidence_bandit.py`)
UCB1 multi-armed bandit with context buckets:
- Phase tier: scanning / approach / hover
- Sensor quality tier: high / medium / low (by optical flow stability)
- Battery tier: high (≥50%) / low (<50%)

3 threshold arms per context: 0.40, 0.60, 0.75. Reward: +1 on pollination, −1 on abort.

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
| Backend agent | FastAPI, **LangChain** (`langchain-anthropic`, `langchain-core`), Claude claude-haiku-4-5-20251001 |
| LangChain callbacks | `BaseCallbackHandler` → `/terminal` WS → frontend terminal panel |
| RAG | **Chroma** vector store, `sentence-transformers/all-MiniLM-L6-v2`, `langchain-community` |
| Computer vision | ONNX Runtime, Google Coral pycoral, YOLOv8 |
| Bandit | UCB1 (custom Python, no ML framework) |
| Streaming | Server-Sent Events (SSE) + WebSocket |
| Hardware | Raspberry Pi 4, Pixhawk 6, Google Coral USB TPU |
