# Smart Pollinator Drone — Mission Simulation & Autonomous CV System

A full-stack autonomous pollinator drone platform combining an interactive mission replay dashboard (Preact + TypeScript) with a production-grade computer vision and flight control backend (Python, Raspberry Pi + Pixhawk). The web app replays a deterministic 90-second mission where a drone visits 8 flower clusters in a 20m × 20m garden, detecting, locking, and pollinating each one using simulated Pixhawk sensor fusion.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Getting Started — Web Simulator](#getting-started--web-simulator)
3. [Architecture Overview](#architecture-overview)
4. [Frontend Simulation — How It Works](#frontend-simulation--how-it-works)
   - [Frame Generation](#frame-generation-missiongeneratorts)
   - [Replay Engine](#replay-engine-replayenginets)
   - [UI Panels](#ui-panels)
5. [Mode 2 — Live Inference with Python Server](#mode-2--live-inference-with-python-server)
   - [Setup](#setup)
   - [Mission Flow](#mode-2-mission-flow)
   - [WebSocket Protocol](#websocket-protocol)
   - [Detection Bridge](#detection-bridge)
   - [Photorealistic Frame Rendering](#photorealistic-frame-rendering)
   - [Top-Down Map Overlays](#top-down-map--mode-2-overlays)
6. [ML Model — YOLOv8 Flower Detection](#ml-model--yolov8-flower-detection)
   - [Model Architecture](#model-architecture)
   - [Training Pipeline](#training-pipeline)
   - [Inference & ONNX Export](#inference--onnx-export)
   - [Detection Dataflow](#detection-dataflow)
6. [Computer Vision Pipeline](#computer-vision-pipeline)
   - [Frame Preprocessor](#frame-preprocessor)
   - [Flower Detector](#flower-detector)
   - [Optical Flow Tracker](#optical-flow-tracker)
   - [Depth Estimator](#depth-estimator)
7. [Pixhawk / MAVLink Integration](#pixhawk--mavlink-integration)
8. [Mission State Machine](#mission-state-machine)
9. [Pollination Manager](#pollination-manager)
10. [Configuration](#configuration)
11. [Hardware Setup (Real Drone)](#hardware-setup-real-drone)
12. [Telemetry Model](#telemetry-model)
13. [Tech Stack](#tech-stack)
14. [Folder Structure](#folder-structure)

---

## Project Overview

This project has two distinct but related parts:

| Layer | Purpose | Stack |
|---|---|---|
| **Web Simulator** | Interactive mission replay dashboard | Preact + TypeScript + Vite |
| **drone-cv-system** | Real autonomous flight & vision system | Python + YOLOv8 + MAVLink |

The web simulator is a faithful visualization of the exact mission logic implemented in the Python backend — the same 13 mission phases, the same detection confidence thresholds, the same telemetry model — so that the dashboard mirrors what the real drone would produce.

---

## Getting Started — Web Simulator

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). A mode selector appears on launch:

- **Mode 1 — Replay**: Plays the pre-generated 90-second deterministic mission replay. Use the timeline controls at the bottom to play/pause, scrub, or change speed.
- **Mode 2 — Live Inference**: Randomly places flowers, spins up the Python inference server automatically, scans the garden in 4 lawnmower passes, plans a TSP route, then pollinates every discovered flower. The camera panel shows the actual photorealistic PIL-rendered frames from the server.

**Build for production:**
```bash
npm run build
```

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Web Simulation (Browser)                          │
│                                                                            │
│  MODE 1 — Replay                    MODE 2 — Live Inference               │
│  ─────────────────                  ────────────────────────              │
│  missionGenerator.ts                randomMissionGenerator.ts             │
│  (2700 ReplayFrames)                (random garden, lawnmower scan)       │
│       ↓                                      ↓                            │
│  useReplayEngine                    useLiveInferenceEngine                │
│  (RAF loop, seek)                   (RAF loop, WsClient)                  │
│       ↓                                      ↓                            │
│  4 SVG Panels ←───────── liveToReplay() adapter ──────────               │
│  Top-Down / Side / Telemetry / Camera                                     │
└──────────────────────────────────────────────────────────────────────────┘
              ↕ WebSocket ws://localhost:8765/inference
┌──────────────────────────────────────────────────────────────────────────┐
│                    Python Inference Server (localhost)                     │
│                                                                            │
│  FastAPI + uvicorn                                                         │
│       ↓                                                                    │
│  scene_renderer.py (PIL photorealistic frames, 640×640)                   │
│       ↓                                                                    │
│  DetectionBridge → OnnxDetector (YOLOv8n ONNX) or MockDetector           │
│                      (physics-based projection model)                     │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                   Real Drone CV System (Raspberry Pi 4)                   │
│                                                                            │
│  RPi Camera v2                                                             │
│      ↓                                                                     │
│  FramePreprocessor  →  FlowerDetector (YOLOv8n ONNX)                     │
│                               ↓                                            │
│                      OpticalFlowTracker  →  DepthEstimator                │
│                               ↓                                            │
│                        StateMachine (13 phases, 20 Hz)                    │
│                               ↓                                            │
│                       FlightController  →  MAVLinkInterface               │
│                               ↓                                            │
│                           Pixhawk 4/6                                     │
│                               ↓                                            │
│                    PollinationManager (GPIO servo)                         │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Frontend Simulation — How It Works

### Frame Generation (`missionGenerator.ts`)

All simulation data is **pre-generated once at startup** — there is no physics simulation or randomness during playback. The generator creates **2700 `ReplayFrame` objects** (30 fps × 90 seconds) using a seeded PRNG for determinism.

**Garden layout:**
- 20m × 20m garden with 10 flower clusters
- Drone home base at (2, 2)
- 9 waypoints visiting 8 target clusters in sequence

**Mission timeline baked into generated frames:**

| Time | Phase | What happens |
|---|---|---|
| 0–2s | `idle` | Drone on ground, all sensors off |
| 2–4s | `arming` | Pre-flight check sequence, motors arm |
| 4–7s | `takeoff` | Altitude ramp 0m → 8m |
| 7–90s | 8× visit cycles | See cycle breakdown below |

**Per-flower visit cycle (~10s each):**

| Sub-phase | Duration | Behavior |
|---|---|---|
| `transit` / `resume_transit` | 2s | Fly to waypoint at 8m patrol altitude |
| `scanning` | 1s | Hover, camera sweeps for flowers |
| `candidate_detected` | 0.8s | Detection confidence ramps 0.40 → 0.75 |
| `target_lock` | 0.7s | Confidence ≥ 0.75, lock acquired |
| `descent` | 1.5s | Altitude falls 8m → 1.5m |
| `hover_align` | 0.5s | Precision XY alignment at hover band |
| `pollinating` | 1.5s | Mechanism triggered, dwell |
| `ascent` | 1.2s | Climb back to 8m patrol altitude |

**Realistic sensor simulation baked into each frame:**
- Battery: 100% → ~72% over 90 seconds (linear drain)
- Signal strength: distance-based decay from home (2, 2)
- Optical flow quality (0-255): degrades at high altitude, peaks at low hover
- EKF confidence: oscillates 0.92-0.96
- Position wobble: ±0.03m sinusoidal noise
- Bounding boxes: animated during detection phases
- Detection confidence: smooth ramp 0 → 1 keyed to mission phase

**Flower state machine per cluster:**
```
Mode 1 (Replay):   unscanned → scanned → candidate → locked → pollinated
Mode 2 (Live):  undiscovered → discovered → scanned → candidate → locked → pollinated
```

Each `ReplayFrame` contains the full drone state, all sensor values, all 10 flower cluster states, camera analysis state, and any events that fired at that timestamp.

---

### Replay Engine (`replayEngine.ts`)

The `useReplayEngine` Preact hook owns all playback state. It uses `requestAnimationFrame` to advance frame index at wall-clock time, applying the current speed multiplier.

**Key state managed by the hook:**

```typescript
currentFrame: ReplayFrame        // The frame all panels read from
isPlaying: boolean
speed: 1 | 2 | 4
currentTime: number              // Seconds into mission
totalTime: number                // Always 90
positionHistory: Position[]      // Last 90 frames → motion trail
altitudeHistory: AltitudeSample[] // Last 150 samples (every 5 frames) → side-view trace
accumulatedEvents: EventLogEntry[] // Last 100 events → telemetry log
```

**`seekTo(time)`** rebuilds history slices deterministically by iterating back through generated frames — no state needs to be stored per-frame.

All four UI panels receive `frame: ReplayFrame` as props. No panel has its own simulation state.

---

### UI Panels

#### Top-Down Mission View

SVG viewport mapping the 20×20m garden to a 500×500px coordinate space.

- **Flower clusters:** 10 clusters, each rendered with 4-7 organic SVG flowers (6-petal design, stems, leaves, pistil center). Seeded-RNG offsets make placement look natural.
- **Flower state rings:** dashed outline (scanned), amber pulsing ring (candidate), cyan glow (locked), gold sparkle particles (pollinated)
- **Drone:** Hexagonal body, 4 CSS-animated spinning rotors, trapezoidal camera footprint cone pointing in yaw direction, forward indicator arrow
- **Trail:** Last 90 position samples rendered as a fading polyline
- **Waypoint route:** Numbered waypoint markers connected by route line, active waypoint enlarged, completed waypoints dimmed
- **Home base:** Orange square marker at (2, 2)
- **SVG filters:** `feGaussianBlur` glow on drone body, `feDropShadow` on flowers, scanline overlay for aesthetic

#### Altitude / Side View

SVG cross-section (600×200px) showing altitude over time.

- Y-axis: 0–10m altitude with labeled grid lines
- **Hover band:** 1.3–1.8m shaded amber — highlights whenever the drone enters `hover_align` or `pollinating` phase
- **Altitude trace:** Cyan polyline from `altitudeHistory`
- **Drone side profile:** Rendered at current altitude position with rotor arms and landing gear
- **Rangefinder beam:** Dashed red line from drone belly to ground
- **Phase annotations:** ↓ arrow at descent start, ↑ at ascent start
- **Plant silhouettes:** 10 flower shapes at ground level showing cluster horizontal positions
- **Patrol altitude marker:** Dashed line at 8m

#### Telemetry Dashboard

Scrollable engineering HUD organized into sections:

| Section | Values shown |
|---|---|
| Mission Status | Phase (color-coded badge), waypoint index, elapsed time, target flower ID |
| Position & Motion | X, Y, Z (m), Vx, Vy, Vz (m/s), 2D speed, yaw (°), yaw rate (°/s) |
| System Status | Battery % with fill bar, signal strength |
| Sensor Readings | Optical flow quality, flow velocity XY, rangefinder, sonar estimate, EKF confidence |
| Camera / Detection | Detection confidence %, flowers in view, target locked indicator, pollination active indicator |
| Mission Progress | Waypoints visited, pollinated count, per-flower chip grid with state colors |
| Event Log | Auto-scrolling log, color-coded: info (cyan), warn (amber), success (green), event (purple) |

#### Camera / Flower Analysis Panel

Simulates the actual drone camera feed as it would appear from the YOLOv8 system.

**AnalysisFrame pipeline:**
```
ReplayFrame → computeAnalysisFrame() → AnalysisFrame → CameraAnalysisScene (SVG 800×500)
```

**What's rendered (layered SVG):**

| Layer | Component | What it shows |
|---|---|---|
| Background | CameraAnalysisScene | Dark scene, subtle grid overlay, vignette, scanlines |
| Flowers | FlowerClusterRenderer | Organic flowers in fixed camera-space positions, zoom to target on lock |
| Detection heat | DetectionHeatmap | Radial-gradient confidence blobs over flowers (warm colors = high confidence) |
| Targeting | DetectionReticle | Corner brackets + crosshair + center dot; tightness 0 (transit) → 1 (pollinating) |
| Pollination FX | PollinationEffect | Orbiting golden sparkle particles + expanding pulse rings |
| Phase banner | MissionPhaseOverlay | "TARGET LOCKED", "POLLINATING", "MISSION COMPLETE", etc. — all 13 phases covered |
| HUD strip | AnalysisHud | Bottom bar: phase chip, confidence bar + sparkline from history, status flags |

**Target zoom behavior:** When phase is `target_lock`, `descent`, `hover_align`, `pollinating`, or `ascent`, the target flower translates to scene center (400, 230) at 2× scale, mimicking camera zoom.

**Confidence visualization:** `DetectionHeatmap` renders a warm-color radial gradient centered on each flower. The opacity and spread scale with the flower's current confidence value from the `ReplayFrame`.

---

## Mode 2 — Live Inference with Python Server

Mode 2 demonstrates the full autonomy loop in real time: garden scan → TSP planning → pollination execution, with a Python inference server providing computer vision.

### Setup

```bash
# Install server dependencies
pip install -r drone-cv-system/server/requirements_server.txt

# Optional: generate a real YOLOv8n ONNX model (downloads ~6 MB)
python3 drone-cv-system/server/generate_model.py
```

The server starts **automatically** when you select Mode 2 in the browser. Vite's dev server proxies a `POST /api/start-inference-server` request to spawn `inference_server.py` via Node.js `child_process`.

### Mode 2 Mission Flow

```
1. GARDEN GENERATION
   randomMissionGenerator.ts places 6–10 flower clusters (min 2.5m spacing)
   Flower IDs: r1, r2, … rN   Initial state: 'undiscovered' (ghost outlines on map)

2. SCAN PHASE — 4 lawnmower passes at x = 3.0, 8.0, 13.0, 18.0 m
   Drone flies S→N or N→S on each pass at 8m patrol altitude
   ► PROXIMITY DETECTION (always active, no server required):
     Each frame, any flower within 4.5m lateral distance is discovered immediately.
     Confidence = 0.9 – 0.6×(dist/4.5m).  State: undiscovered → discovered.
   ► CV DETECTION (when Python server online):
     WebSocket sends: { drone, flowers, phase } every 100ms
     Server returns: { detections, phaseSuggestion, targetId, framePng,
                       inferenceMs, tspSuggestion }
     Detection results supplement proximity detection with ML confidence values.
   ► DYNAMIC TSP (updated on every new discovery, during scanning):
     As each flower is found, computeTSPRoute() recomputes the nearest-neighbour
     route over all discovered flowers.  The purple numbered overlay on the map
     appears immediately from the first detection — not after planning completes.

3. PLANNING PHASE — 2.5s dwell
   Authoritative recompute of TSP route.
   Fallback: if no flowers discovered (server offline + proximity miss),
   all flowers in the garden are added as targets to prevent mission abort.

4. EXECUTION — visit each flower in route order
   approach → descent → hover_align → pollinating (3s) → ascent → resume

5. MISSION COMPLETE → RETURN TO HOME → LANDING
   Drone flies back to home base (2, 2) at patrol altitude, then descends.
   RAF loop stops on touchdown.
```

### WebSocket Protocol

**Browser → Server (JSON, every 100ms):**
```json
{
  "drone":   { "x": 8.5, "y": 12.3, "z": 8.0, "yaw": 0 },
  "flowers": [ { "id": "live_f0", "x": 7.2, "y": 5.1, "radius": 0.4, ... } ],
  "phase":   "scanning"
}
```

**Server → Browser (JSON, per frame):**
```json
{
  "detections":      [ { "id": "r2", "confidence": 0.82, "bbox": [210,185,430,405] } ],
  "phaseSuggestion": "approach",
  "targetId":        "r2",
  "inferenceMs":     12.4,
  "inferenceMode":   "mock",
  "framePng":        "<base64 JPEG string>",
  "tspSuggestion":   ["r2", "r5", "r1", "r4"]
}
```

`tspSuggestion` is a **server-computed nearest-neighbour TSP route** over all currently-detected flowers (see Planning Agent section below). The JS navigator merges this with its own proximity-detected route, adding any newly discovered IDs.

The `framePng` is rendered as the camera panel background — a 640×640 photorealistic PIL image showing the drone's downward view with projected flower clusters, grass texture, depth-of-field blur, and vignette.

### Detection Bridge

The server tries two detection paths in order:

| Path | Condition | Description |
|------|-----------|-------------|
| **ONNX** | `flower_detector.onnx` present & onnxruntime installed | YOLOv8n inference on rendered PIL frame |
| **Mock** | Fallback on any error | Physics projection: each flower's camera-space position and horizontal proximity → confidence |

The mock detector mirrors the sensor table in `detection_bridge.py` (`_SENSOR_TABLE`), which reproduces the `raw_opticalflow_data.csv` strength/quality lookup. This means mock detections are physically plausible — confidence falls off with altitude and horizontal distance exactly as the real sensor model predicts.

### Photorealistic Frame Rendering

`scene_renderer.py` renders 640×640 frames using PIL:

- **Background**: Green grass base (72, 108, 52) with per-pixel Gaussian noise and 12 random soil patches for texture variation
- **Perspective projection**: `u = FX * (rel_x * cos(yaw) + rel_y * sin(yaw)) / alt + 320` — correct perspective with drone yaw rotation
- **Flowers**: 6-petal ellipse layout, grass patch, ground shadow, stem, leaves, pistil center and dot. Seeded per `hash(flower_id)` for determinism
- **Post-processing**: GaussianBlur DoF when altitude > 2m (up to radius 3.0), radial vignette via distance-from-center multiply factor

### Planning Agent (Python Server)

The inference server runs a lightweight **planning agent** on every frame. After running detections, `_compute_tsp_suggestion()` computes a nearest-neighbour TSP route over all flowers visible in the current frame:

```python
def _compute_tsp_suggestion(detections, flowers, drone_x, drone_y) -> list[str]:
    # Join detected IDs → garden-space positions from the flowers payload
    # Nearest-neighbour greedy: always go to the closest unvisited flower
    # Returns: ["r2", "r5", "r1"] — ordered visit list
```

**Integration in JS navigator (`processInference`):**
1. Server-suggested IDs that are not yet in `discoveredIds` are added immediately
2. If the suggested route is longer than the current route, it seeds a `computeTSPRoute()` recompute
3. After the planning phase, the authoritative final route is locked

This means that if the Python server is online, the TSP route is optimized using ML-detected positions from the very first scan pass — the planning agent acts as an advisory layer on top of the proximity detector.

### Top-Down Map — Mode 2 Overlays

During Mode 2, the top-down garden view shows additional information:

| Overlay | Appearance | Shown when |
|---------|-----------|-----------|
| Ghost outlines | Gray dashed circles | Undiscovered flowers (before detection) |
| Discovered ring | Green dashed pulsing circle | Flower detected, not yet confirmed scanned |
| Scan sweep line | Cyan dashed vertical | `scanning` phase |
| TSP route | Purple numbered polyline | From first discovery onwards (live update) |
| Route numbers | Purple numbered badges | Route order per flower |

**Flower state lifecycle (Mode 2):**

```
undiscovered  →  discovered  →  scanned  →  candidate  →  locked  →  pollinated
(ghost only)     (green ring     (cyan        (amber        (cyan       (gold
                  appears,       dashed       pulsing)      glow)       sparkle)
                  flower fades   ring)
                  in at 60%)
```

---

## ML Model — YOLOv8 Flower Detection

The real drone uses a **fine-tuned YOLOv8 Nano** model to detect flowers in real time. The web simulation mirrors the detection behavior and confidence outputs of this model.

### Model Architecture

**Base model:** YOLOv8n (Nano variant)
- Parameters: ~3.2M
- Weight file size: ~6.3MB (.pt), ~3MB (.onnx)
- Designed for edge inference — the smallest YOLOv8 variant

**Why YOLOv8n on a Raspberry Pi 4:**
- YOLOv8n is the Nano variant with 3.2M parameters — fast enough for ~10 FPS on RPi4 CPU
- ONNX Runtime export provides an additional 2-3× speedup over raw PyTorch
- Achieves 8-12 FPS on RPi4 (4GB) at 640×640 input — sufficient for 20 Hz mission loop
- No GPU required on the drone hardware

**Detection classes (3):**

| Class | Description |
|---|---|
| `flower_open` | Fully open flower — primary pollination target |
| `flower_closed` | Closed/budding flower — lower priority |
| `flower_cluster` | Dense group of flowers — triggers zoom/approach |

### Training Pipeline

Source: `drone-cv-system/ml/model.py` and `drone-cv-system/ml/dataset.py`

**Dataset preparation:**

The `FlowerDataset` class in `dataset.py` handles all data preparation:

1. **Download:** Pulls labeled flower images from Roboflow public datasets (Oxford 102 Flowers, iNaturalist observations, custom drone-angle captures)
2. **Structure:** Converts into YOLO directory format:
   ```
   dataset/
     images/train/  images/val/  images/test/
     labels/train/  labels/val/  labels/test/
   ```
3. **Augmentation pipeline:** Uses `albumentations` to compose:
   - Horizontal/vertical flips
   - Random rotation (±15°)
   - Brightness & contrast variation (±20%)
   - Hue-saturation shift
   - Motion blur (simulates drone motion)
   - **Aerial background compositing** — overlays flower images onto aerial garden backgrounds to match actual drone camera perspective
4. **Split:** 80% train / 10% val / 10% test

**Training config** (`config/model_config.yaml`):
```yaml
model: yolov8n.pt
classes: [flower_open, flower_closed, flower_cluster]
epochs: 100
imgsz: 640
batch: 16
lr0: 0.01
optimizer: SGD
augment: true
```

**Training command:**
```python
trainer = FlowerDetectionModel()
trainer.load("yolov8n.pt")       # Start from pretrained COCO weights
trainer.train("dataset.yaml")   # Fine-tune for ~4h on CPU, ~15min on GPU
```

**Metrics evaluated after training:**
- mAP50 (mean Average Precision at IoU=0.50)
- mAP50-95 (mAP across IoU thresholds)
- Per-class precision and recall

**Expected results on flower dataset:**
- mAP50: ~0.82 for `flower_open`
- mAP50-95: ~0.61
- Precision: ~0.85, Recall: ~0.79

### Inference & ONNX Export

For deployment on the Raspberry Pi 4, the trained `.pt` model is exported to ONNX:

```python
model = FlowerDetectionModel()
model.load("runs/train/weights/best.pt")
model.export_onnx()  # Saves best.onnx
```

**Why ONNX:**
- ONNX Runtime has highly optimized CPU kernels (AVX2, NEON on ARM)
- Eliminates PyTorch overhead (no autograd, no Python GIL bottleneck in inference path)
- 2-3× faster than PyTorch inference on RPi4 ARM Cortex-A72
- Same numerical output as PyTorch — identical bounding boxes and confidence scores

**Inference path** (`flower_detector.py`):
```
RGB frame (640×640)
  → normalize to [0,1] float32
  → ONNX Runtime session.run()
  → NMS (IoU threshold 0.45, confidence threshold 0.25)
  → List[Detection]
```

**Runtime benchmark** (`model.benchmark_rpi()`):
- Measures warmup + 100 inference iterations
- Reports mean FPS, std deviation, P95 latency
- Target: ≥8 FPS at 640×640

### Detection Dataflow

Each call to `flower_detector.detect(frame_rgb)` returns a list of `Detection` objects:

```python
@dataclass
class Detection:
    bbox: BoundingBox         # x1, y1, x2, y2, center_x, center_y, width, height
    confidence: float         # 0.0 – 1.0
    class_name: str           # 'flower_open' | 'flower_closed' | 'flower_cluster'
    bearing: np.ndarray       # Unit 3D vector from camera to flower center
    distance: float           # Meters (filled by DepthEstimator)
```

The **bearing vector** is computed from the detection center and the camera intrinsic matrix:
```
bearing = K_inv @ [cx, cy, 1]ᵀ  (normalized)
```
This gives a unit direction in camera space that the FlightController uses to steer toward the target.

The `best_target()` method selects the highest-confidence `flower_open` detection as the mission target, falling back to `flower_cluster` if no open flowers are found.

---

## Computer Vision Pipeline

### Frame Preprocessor

`drone-cv-system/cv/frame_preprocessor.py`

Captures frames from the Raspberry Pi Camera v2 via OpenCV `VideoCapture`:
1. **Undistortion:** Applies camera calibration matrix (K) and distortion coefficients (D) using `cv2.undistort` to correct barrel/pincushion lens distortion
2. **Resize:** Scales to model inference size (default 640×640)
3. **Color convert:** BGR → RGB for model input

Camera calibration parameters (focal length, principal point, distortion) are stored in `config/camera_config.yaml` and determined via a chessboard calibration procedure.

### Flower Detector

`drone-cv-system/cv/flower_detector.py`

Runs YOLOv8n ONNX inference (see ML Model section above). Supports both `.pt` (PyTorch) and `.onnx` backends — ONNX is always preferred on hardware.

**Debug mode:** `draw_detections(frame)` renders bounding boxes, class labels, and confidence scores directly onto the frame for HDMI/SSH visual debugging during field testing.

### Optical Flow Tracker

`drone-cv-system/cv/optical_flow_tracker.py`

After each detection, the tracker maintains **persistent track IDs** across frames so the mission knows it is approaching the same flower:

1. **Keypoint extraction:** For each detection bounding box, `cv2.goodFeaturesToTrack` extracts corner points within the bbox region
2. **Lucas-Kanade flow:** `cv2.calcOpticalFlowPyrLK` propagates keypoints forward to the next frame, giving per-point displacement vectors
3. **Detection-to-track matching:** Computes IoU between new detections and predicted track positions, uses a greedy Hungarian-style assignment (IoU threshold ≥ 0.3)
4. **Track lifecycle:**
   - New detection with no matching track → create new `Track` with fresh ID
   - Matched detection → update track, reset miss counter
   - Unmatched track → increment miss counter; survive up to 10 missed frames using pure optical flow prediction
   - Miss counter exceeds threshold → track is dropped
5. **EMA smoothing:** Bounding box position is smoothed with α=0.6 to suppress jitter:
   ```
   bbox_smoothed = α * bbox_new + (1-α) * bbox_prev
   ```

**Output:** `List[Track]` — each track has a stable ID, current detection (with confidence), and position history.

The simulator replicates this with bounding box animation and confidence ramps in `missionGenerator.ts`.

### Depth Estimator

`drone-cv-system/cv/depth_estimator.py`

Estimates real-world distance to each detected flower by fusing two sources:

**Monocular size-based estimation:**
```
D_mono = (flower_real_width_m × focal_length_px) / bbox_width_px
```
- Assumes average flower width ~5cm
- Uses focal length from calibration
- Accurate when the flower fills a reasonable portion of the frame

**Rangefinder fusion:**
- The Pixhawk rangefinder gives accurate altitude above ground
- When the drone is descending and the flower takes up >20% of the frame width, monocular dominates
- When the flower is small/distant, rangefinder altitude is used as the primary depth estimate
- A running scale correction factor is maintained to reduce monocular drift over time

The estimated distance fills `Detection.distance` and is used by the `FlightController` to determine when the drone has reached the target hover altitude above the flower.

---

## Pixhawk / MAVLink Integration

### MAVLink Interface (`mavlink_interface.py`)

Connects to Pixhawk over UART (RPi GPIO 14/15 → Pixhawk TELEM2 port) or UDP (for SITL simulation):

```python
mav = MAVLinkInterface(connection_string="/dev/serial0", baud=921600)
mav.connect()
```

A background thread continuously reads incoming MAVLink messages and stores them in a thread-safe `TelemetrySnapshot`:

| MAVLink Message | Fields extracted |
|---|---|
| `ATTITUDE` | roll, pitch, yaw, roll/pitch/yaw rates |
| `GLOBAL_POSITION_INT` | lat, lon, alt, relative_alt, velocity (vx, vy, vz), heading |
| `OPTICAL_FLOW_RAD` | integrated_x, integrated_y, quality (0-255) |
| `DISTANCE_SENSOR` | current_distance (cm), signal_quality |
| `EKF_STATUS_REPORT` | pos_horiz_variance, pos_vert_variance, velocity_variance, flags |
| `SYS_STATUS` | battery_remaining %, armed state, flight mode |

### Flight Controller (`flight_controller.py`)

High-level commands built on top of MAVLink primitives:

```python
fc = FlightController(mav_interface)

fc.arm()                                     # Run pre-flight checks, arm motors
fc.takeoff(target_alt_m=8.0)                 # Climb to 8m, block until reached
fc.goto_ned(north=5.0, east=3.0, down=-8.0,  # Fly to NED position at 2 m/s
            speed_ms=2.0)
fc.precision_hover(                          # Hold XY position within 0.15m
    target_ned=np.array([5.0, 3.0, -1.5]),
    tolerance_m=0.15,
    timeout_s=10.0
)
fc.land()                                    # Controlled descent to ground
```

`goto_ned` sends `SET_POSITION_TARGET_LOCAL_NED` MAVLink messages. `precision_hover` loops on optical flow and EKF position feedback to maintain sub-20cm XY position accuracy at the hover band (~1.5m altitude), which is the critical alignment step before pollination.

### Sensor Reader (`sensor_reader.py`)

Parses and validates the telemetry stream for mission-critical values:
- Optical flow quality must be ≥ 50/255 to trust flow-based position hold
- Rangefinder readings are validated (nonzero, within sensor range 0.2–8m)
- EKF health flags checked before any autonomous maneuver

---

## Mission State Machine

`drone-cv-system/mission/state_machine.py`

The `StateMachine` runs at **20 Hz** in the main mission loop (`mission/main.py`). Each tick:
1. Reads latest `TelemetrySnapshot` from Pixhawk
2. Reads latest detections from `FlowerDetector`
3. Calls the current phase's `tick()` handler
4. Applies transition logic → possibly moves to next phase

**All 13 phases and their transition triggers:**

```
idle
 └─ arm command received ──────────────────→ arming

arming
 └─ motors armed + pre-flight OK ──────────→ takeoff

takeoff
 └─ altitude ≥ target_alt - 0.3m ──────────→ transit

transit
 └─ within 0.5m of waypoint XY ────────────→ scanning

scanning
 └─ detection confidence ≥ 0.40 ───────────→ candidate_detected
 └─ timeout (60s) ─────────────────────────→ resume_transit (skip)

candidate_detected
 └─ confidence ≥ 0.75 ─────────────────────→ target_lock
 └─ confidence drops below 0.20 ───────────→ scanning

target_lock
 └─ descent command sent ───────────────────→ descent

descent
 └─ altitude ≤ hover_alt + 0.2m ───────────→ hover_align

hover_align
 └─ XY error ≤ 0.15m for 0.5s ─────────────→ pollinating

pollinating
 └─ dwell complete (3.0s) ──────────────────→ ascent

ascent
 └─ altitude ≥ patrol_alt - 0.3m ───────────→ resume_transit

resume_transit
 └─ more waypoints remaining ───────────────→ transit (next waypoint)
 └─ all waypoints done ─────────────────────→ mission_complete

mission_complete
 └─ land command, disarm ────────────────────→ idle
```

**Key thresholds from `mission_config.yaml`:**
- Patrol altitude: 8.0m
- Hover altitude: 1.5m
- Detection confidence candidate threshold: 0.40
- Detection confidence lock threshold: 0.75
- Pollination dwell time: 3.0s
- Precision hover tolerance: 0.15m

### Search Pattern Generator (`search_pattern.py`)

If the drone reaches a waypoint and no flowers are immediately detected, the search pattern generator produces a secondary scan path:
- **Lawnmower:** Parallel strip sweeps with configurable overlap — used for initial area survey
- **Spiral:** Center-outward expanding spiral — used around a known cluster for fine search
- **TSP:** Traveling Salesman optimization for multi-waypoint ordering to minimize total flight distance

---

## Pollination Manager

`drone-cv-system/mission/pollination_manager.py`

Controls the physical pollination mechanism — a small servo attached to a pollen brush:

**GPIO PWM control (Raspberry Pi GPIO 18):**
```
Retracted: 1000µs pulse width (50Hz PWM)
Extended:  2000µs pulse width
```

**Trigger sequence during `pollinating` phase:**
1. Extend servo → pollen brush contacts flower stigma
2. Dwell for 3.0s
3. Retract servo
4. Mark flower as pollinated in `MissionContext.pollinated_ids`
5. Advance to next waypoint

Maintains a target queue so completed flowers are not revisited if the mission loops.

---

## Configuration

All runtime parameters are in `drone-cv-system/config/`:

**`model_config.yaml`** — ML model settings
```yaml
model_path: models/best.onnx
classes: [flower_open, flower_closed, flower_cluster]
confidence_threshold: 0.25
iou_threshold: 0.45
inference_size: 640
```

**`mission_config.yaml`** — Flight parameters
```yaml
pixhawk_port: /dev/serial0
pixhawk_baud: 921600
patrol_altitude_m: 8.0
hover_altitude_m: 1.5
candidate_confidence: 0.40
lock_confidence: 0.75
pollination_dwell_s: 3.0
max_speed_ms: 2.0
geofence_radius_m: 15.0
```

**`camera_config.yaml`** — Camera intrinsics
```yaml
# Camera matrix K and distortion coefficients D
# Set via chessboard calibration (cv2.calibrateCamera)
fx: 649.3
fy: 649.3
cx: 320.0
cy: 240.0
distortion: [0.12, -0.23, 0.0, 0.0, 0.05]
inference_size: 640
```

---

## Hardware Setup (Real Drone)

**Required hardware:**
- Raspberry Pi 4 (4GB recommended)
- Pixhawk 4 or Pixhawk 6 flight controller
- Raspberry Pi Camera Module v2
- PX4Flow or similar optical flow sensor (I2C)
- LiDAR/ultrasonic rangefinder (UART)
- 5g servo for pollination brush
- Quadrotor frame with ESCs/motors

**Wiring:**
```
RPi GPIO 14 (TXD) → Pixhawk TELEM2 RX
RPi GPIO 15 (RXD) → Pixhawk TELEM2 TX
Optical flow       → Pixhawk I2C bus
Rangefinder        → Pixhawk SERIAL4/5
Servo signal       → RPi GPIO 18
```

**Software setup:**
```bash
cd drone-cv-system
pip install -r requirements.txt

# Enable UART on Raspberry Pi
sudo raspi-config  # Interface Options → Serial → disable login shell, enable hardware

# Prepare ML model
python ml/model.py train --dataset dataset.yaml
python ml/model.py export  # → models/best.onnx

# Camera calibration
python cv/frame_preprocessor.py calibrate --board 9x6

# Test with ArduPilot SITL (no hardware needed)
python mission/main.py --connection udp:127.0.0.1:14550

# Run on real hardware
python mission/main.py --connection /dev/serial0 --baud 921600
```

**Python dependencies** (`requirements.txt`):
```
ultralytics>=8.0.0        # YOLOv8 training and inference
opencv-python>=4.8.0      # Computer vision
numpy>=1.24.0
torch>=2.0.0              # CPU build on RPi
pymavlink>=2.4.40         # MAVLink protocol
onnxruntime>=1.16.0       # Fast ONNX inference on ARM
roboflow>=1.1.0           # Dataset download
albumentations>=1.3.0     # Image augmentation
loguru>=0.7.0             # Structured logging
pandas>=2.0.0             # Telemetry CSV export
pyserial>=3.5             # UART serial
RPi.GPIO>=0.7.1           # GPIO servo PWM
```

---

## Telemetry Model

The web simulator replicates the exact telemetry fields that the real Pixhawk produces:

| Field | Source | Simulated Range |
|---|---|---|
| Position x, y | EKF local NED | 0–20m garden |
| Altitude z | Barometer + EKF | 0–10m |
| Velocity vx, vy, vz | EKF velocity | ±3 m/s |
| Yaw | Magnetometer + EKF | 0–360° |
| Yaw rate | IMU gyro | ±30 °/s |
| Battery % | LiPo voltage curve | 100% → 72% |
| Signal strength | Distance-based model | 100% → ~80% |
| Optical flow quality | PX4Flow quality byte | 0–255 |
| Flow velocity XY | PX4Flow integrated flow | ±0.5 m/s |
| Rangefinder distance | LiDAR/sonar | 0–10m |
| EKF confidence | EKF variance → 0-1 | 0.92–0.96 |
| Detection confidence | YOLOv8 output | 0.0–1.0 |

---

## Tech Stack

### Web Simulator
| Layer | Technology |
|---|---|
| Framework | Preact 10 + TypeScript 5 |
| Build | Vite 5 |
| Styling | Tailwind CSS v4 |
| Rendering | Pure SVG (no canvas, no WebGL) |
| State | `useReplayEngine` hook (Preact hooks) |
| Simulation | Deterministic pre-generated frames, `requestAnimationFrame` playback |

### drone-cv-system (Python Backend)
| Layer | Technology |
|---|---|
| ML Framework | YOLOv8 (Ultralytics) |
| Inference Runtime | ONNX Runtime (ARM optimized) |
| Computer Vision | OpenCV 4.8 |
| Numerical | NumPy |
| Flight Protocol | pymavlink (MAVLink v2) |
| Augmentation | albumentations |
| Dataset | Roboflow API |
| Logging | Loguru + pandas CSV |
| GPIO | RPi.GPIO |

---

## Folder Structure

```
drone-simulation/
├── src/
│   ├── app/
│   │   └── App.tsx                   Main layout: 4 panels + header + replay controls
│   ├── components/
│   │   ├── TopDownView/
│   │   │   └── TopDownView.tsx        SVG garden: drone, flowers, waypoints, trail
│   │   ├── SideView/
│   │   │   └── SideView.tsx           SVG altitude profile with hover band
│   │   ├── TelemetryPanel/
│   │   │   └── TelemetryPanel.tsx     Engineering HUD with all sensor values + event log
│   │   ├── ZoomPanel/
│   │   │   └── ZoomPanel.tsx          Thin wrapper delegating to CameraAnalysisPanel
│   │   ├── ReplayControls/
│   │   │   └── ReplayControls.tsx     Play/pause/reset/speed/scrubber
│   │   └── camera-analysis/
│   │       ├── types.ts               AnalysisFrame, FlowerRenderState, FrustumState
│   │       ├── CameraAnalysisPanel.tsx  Computes AnalysisFrame, owns layout
│   │       ├── CameraAnalysisScene.tsx  SVG compositor (800×500 viewBox)
│   │       ├── FlowerClusterRenderer.tsx  Organic SVG flowers with state rings
│   │       ├── DetectionReticle.tsx     Frustum targeting overlay
│   │       ├── DetectionHeatmap.tsx     Confidence radial-gradient blobs
│   │       ├── PollinationEffect.tsx    Sparkle particles + pulse rings
│   │       ├── MissionPhaseOverlay.tsx  Phase banners (all 13 phases)
│   │       └── AnalysisHud.tsx          Bottom HUD strip
│   ├── simulation/
│   │   └── replayEngine.ts            useReplayEngine hook: RAF loop, seek, history
│   ├── data/
│   │   └── missionGenerator.ts        Generates 2700 ReplayFrame objects
│   ├── models/
│   │   ├── types.ts                   All TypeScript interfaces
│   │   └── index.ts                   Re-exports
│   └── styles/
│       └── globals.css                Tailwind + dark base + keyframe animations
├── drone-cv-system/                   Python autonomous flight & vision system
│   ├── config/
│   │   ├── model_config.yaml          YOLOv8 inference settings
│   │   ├── mission_config.yaml        Flight parameters and thresholds
│   │   └── camera_config.yaml         Camera intrinsics and calibration
│   ├── ml/
│   │   ├── model.py                   YOLOv8 training, export, evaluation, benchmark
│   │   └── dataset.py                 Dataset prep, augmentation, Roboflow download
│   ├── cv/
│   │   ├── frame_preprocessor.py      Capture, undistort, resize pipeline
│   │   ├── flower_detector.py         YOLOv8/ONNX inference → Detection objects
│   │   ├── optical_flow_tracker.py    Lucas-Kanade + Hungarian IoU tracking
│   │   └── depth_estimator.py         Monocular + rangefinder fusion → depth
│   ├── pixhawk/
│   │   ├── mavlink_interface.py       MAVLink serial/UDP, TelemetrySnapshot
│   │   ├── flight_controller.py       arm, takeoff, goto_ned, hover, land
│   │   └── sensor_reader.py           Optical flow, rangefinder, EKF parsing
│   ├── mission/
│   │   ├── state_machine.py           13-phase StateMachine at 20 Hz
│   │   ├── search_pattern.py          Lawnmower, spiral, TSP waypoint patterns
│   │   ├── pollination_manager.py     GPIO servo PWM + target queue
│   │   └── main.py                    Mission loop orchestrator entry point
│   ├── utils/
│   │   └── logger.py                  Loguru setup, CSV telemetry writer
│   └── requirements.txt
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── CLAUDE.md
```
