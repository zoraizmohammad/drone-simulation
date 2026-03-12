# Smart Pollinator Drone — Mission Simulation & Autonomous CV System

A full-stack autonomous pollinator drone platform. The project has two integrated halves that mirror each other exactly: a browser-based interactive mission dashboard (Preact + TypeScript) and a production-grade autonomous flight + vision system (Python, Raspberry Pi 4, Pixhawk 4/6, YOLOv8). The same 13-phase mission logic, the same sensor model, and the same TSP path-planning algorithm run in both environments — the simulator is a pixel-perfect digital twin of the real drone.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Getting Started](#getting-started)
3. [System Architecture — Full Picture](#system-architecture--full-picture)
4. [Physical Drone Hardware Stack](#physical-drone-hardware-stack)
   - [Flight Controller — Pixhawk 4/6](#flight-controller--pixhawk-46)
   - [Companion Computer — Raspberry Pi 4](#companion-computer--raspberry-pi-4)
   - [Camera](#camera)
   - [Pollination Mechanism](#pollination-mechanism)
   - [Wiring Diagram](#wiring-diagram)
5. [Firmware & MAVLink Integration](#firmware--mavlink-integration)
   - [MAVLink Interface](#mavlink-interface-mavlink_interfacepy)
   - [Flight Controller Wrapper](#flight-controller-wrapper-flight_controllerpy)
   - [Telemetry Messages Consumed](#telemetry-messages-consumed)
6. [Computer Vision Pipeline (Real Drone)](#computer-vision-pipeline-real-drone)
   - [Frame Preprocessor](#frame-preprocessor-frame_preprocessorpy)
   - [YOLOv8 Flower Detector](#yolov8-flower-detector-flower_detectorpy)
   - [Optical Flow Tracker](#optical-flow-tracker-optical_flow_trackerpy)
   - [Depth Estimator](#depth-estimator-depth_estimatorpy)
7. [ML Model — YOLOv8 Flower Detection](#ml-model--yolov8-flower-detection)
   - [Model Architecture](#model-architecture)
   - [Training Pipeline](#training-pipeline)
   - [ONNX Export for Raspberry Pi](#onnx-export-for-raspberry-pi)
   - [Detection Dataflow](#detection-dataflow)
8. [Mission State Machine (Real + Simulated)](#mission-state-machine-real--simulated)
   - [The 13 Phases](#the-13-phases)
   - [Phase Transitions & Guards](#phase-transitions--guards)
9. [Path Planning Agent — TSP Solver](#path-planning-agent--tsp-solver)
10. [Pollination Manager](#pollination-manager-pollination_managerpy)
11. [Python Inference Server](#python-inference-server)
    - [WebSocket Protocol](#websocket-protocol)
    - [Scene Renderer](#scene-renderer-scene_rendererpy)
    - [Detection Bridge](#detection-bridge-detection_bridgepy)
    - [Planning Agent (Server-Side TSP)](#planning-agent-server-side-tsp)
12. [Web Simulator — How It Works](#web-simulator--how-it-works)
    - [Mode 1: Deterministic Replay](#mode-1-deterministic-replay)
    - [Mode 2: Live Inference](#mode-2-live-inference)
13. [Autonomous Navigator (TypeScript)](#autonomous-navigator-typescript)
    - [Phase State Machine](#phase-state-machine)
    - [Proximity Detection](#proximity-detection)
    - [TSP Route Computation](#tsp-route-computation)
    - [Terminal Logging](#terminal-logging)
14. [Live Inference Engine](#live-inference-engine-liveinferenceenginets)
15. [WebSocket Client](#websocket-client-wsclientts)
16. [Sensor Simulation System](#sensor-simulation-system)
    - [Optical Flow Dataset](#optical-flow-dataset)
    - [Sensor Interpolation Engine](#sensor-interpolation-engine)
    - [Physics-Based Optical Flow Model](#physics-based-optical-flow-model)
    - [CV–Sensor Coupling](#cvsensor-coupling)
17. [Replay Engine](#replay-engine-replayenginets)
18. [Mission Frame Generation](#mission-frame-generation)
    - [Deterministic Replay Frames](#deterministic-replay-frames-missiongeneratorts)
    - [Random Mission Generator](#random-mission-generator-randommissiongeneratorts)
19. [UI Panels — Deep Dive](#ui-panels--deep-dive)
    - [Top-Down Mission View](#top-down-mission-view)
    - [Altitude / Side View](#altitude--side-view)
    - [Telemetry Dashboard](#telemetry-dashboard)
    - [Camera / Flower Analysis Panel](#camera--flower-analysis-panel)
    - [Terminal Panel](#terminal-panel)
    - [Live Status Bar](#live-status-bar)
    - [Replay Controls](#replay-controls)
20. [Data Models — Type Reference](#data-models--type-reference)
21. [Configuration](#configuration)
22. [Hardware Setup (Real Drone)](#hardware-setup-real-drone)
23. [Tech Stack](#tech-stack)
24. [Folder Structure](#folder-structure)

---

## Project Overview

| Layer | Purpose | Stack |
|---|---|---|
| **Web Simulator** | Interactive mission replay & live inference dashboard | Preact 10 · TypeScript 5 · Vite 5 · TailwindCSS 4 · SVG |
| **Python Inference Server** | Photorealistic frame synthesis · YOLOv8 ONNX inference · TSP planning | FastAPI · uvicorn · PIL · ONNX Runtime |
| **drone-cv-system** | Autonomous flight · real sensor fusion · hardware control | Python · OpenCV · Ultralytics YOLOv8 · pymavlink |
| **Pixhawk 4/6** | Flight control · IMU · EKF · barometer · GPS fusion | ArduPilot / PX4 firmware |
| **Raspberry Pi 4** | Companion computer · camera · inference · MAVLink bridge | Ubuntu 22.04 · Python 3.9+ |

The key design principle: **the web simulator is not a toy**. It uses the identical mission phase definitions, the identical TSP algorithm, and the identical sensor degradation model as the real hardware system. Mode 1 replays a deterministically pre-generated 90-second mission. Mode 2 runs the full autonomous loop in real time against the Python inference server, with the same flower-discovery → TSP → pollination sequence the real drone would execute.

---

## Getting Started

### Web Simulator (Mode 1 + Mode 2)

```bash
npm install
npm run dev
# → http://localhost:5173
```

### Python Inference Server (required for Mode 2)

```bash
pip install -r drone-cv-system/server/requirements_server.txt

# Optionally generate a real YOLOv8n ONNX model (~6 MB, requires internet)
python3 drone-cv-system/server/generate_model.py
```

The server starts **automatically** when you click "Live Inference" in the browser. Vite's dev server intercepts `POST /api/start-inference-server` and spawns `inference_server.py` via Node.js `child_process`. If the ONNX model is not present, the server falls back to a physics-based mock detector transparently.

### Real Drone System

```bash
# On Raspberry Pi 4
cd drone-cv-system
pip install -r requirements.txt
python3 main.py
```

---

## System Architecture — Full Picture

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                        BROWSER  (Web Simulator)                           ║
║                                                                           ║
║   MODE 1 — Replay                    MODE 2 — Live Inference              ║
║   ─────────────────                  ─────────────────────────            ║
║   missionGenerator.ts                randomMissionGenerator.ts            ║
║   (2700 ReplayFrames,                (random garden, 6–10 flowers,        ║
║    seeded PRNG, 30 fps)               lawnmower scan, seeded PRNG)        ║
║         ↓                                      ↓                         ║
║   useReplayEngine                    useLiveInferenceEngine               ║
║   (RAF loop, seek,                   (RAF loop, AutonomousNavigator,      ║
║    speed multiplier)                  WsClient, terminal buffer)          ║
║         ↓                                      ↓                         ║
║   ┌─────────────────── liveToReplay() adapter ─────────────────┐         ║
║   │           4 SVG Panels (shared between both modes)          │         ║
║   │   TopDownView · SideView · TelemetryPanel · CameraAnalysis  │         ║
║   └──────────────────────────────────────────────────────────── ┘         ║
║                               TerminalPanel (Mode 2 only)                 ║
╚═══════════════════════════════════════════════════════════════════════════╝
                      ↕  WebSocket  ws://localhost:8765/inference
╔═══════════════════════════════════════════════════════════════════════════╗
║               Python Inference Server  (localhost / same machine)         ║
║                                                                           ║
║   FastAPI + uvicorn WebSocket endpoint                                    ║
║         ↓                                                                 ║
║   scene_renderer.py  →  PIL 640×640 photorealistic frame                 ║
║         ↓                                                                 ║
║   DetectionBridge                                                         ║
║     ├─ OnnxDetector  →  YOLOv8n ONNX  →  bbox parse  →  geo-match       ║
║     └─ MockDetector  →  physics confidence (altitude + distance)          ║
║         ↓                                                                 ║
║   Planning Agent (_compute_tsp_suggestion)  →  TSP route                 ║
║         ↓                                                                 ║
║   JSON response  {detections, phaseSuggestion, tspSuggestion, framePng}  ║
╚═══════════════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════════════╗
║                 Real Drone CV System  (Raspberry Pi 4)                    ║
║                                                                           ║
║   RPi Camera v2 (CSI)                                                     ║
║         ↓                                                                 ║
║   FramePreprocessor  →  640×640 RGB normalized tensor                    ║
║         ↓                                                                 ║
║   FlowerDetector (YOLOv8n ONNX, ONNX Runtime)                            ║
║         ↓                                                                 ║
║   OpticalFlowTracker (Lucas-Kanade, EMA smoothing)                       ║
║         ↓                                                                 ║
║   DepthEstimator  (bbox size + altitude fusion)                           ║
║         ↓                                                                 ║
║   StateMachine (13 phases, 20 Hz tick loop)                              ║
║         ↓                                                                 ║
║   FlightController  ──→  MAVLinkInterface  ──→  Pixhawk 4/6              ║
║         ↓                        ↑                                        ║
║   PollinationManager          Telemetry stream (ATTITUDE, GPS,            ║
║   (GPIO PWM servo)             OPTICAL_FLOW_RAD, EKF_STATUS, …)         ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

---

## Physical Drone Hardware Stack

### Flight Controller — Pixhawk 4/6

The Pixhawk runs ArduPilot or PX4 firmware and handles:

- **IMU fusion:** 3-axis accelerometer + gyroscope at 1 kHz, fused by the EKF2 extended Kalman filter
- **Barometric altitude:** MS5611 barometer for coarse altitude hold
- **GPS:** u-blox M8N module for global positioning, fused into EKF alongside IMU
- **MAVLink output:** Streams telemetry over TELEM2 serial port at 921 600 baud — ATTITUDE, GLOBAL_POSITION_INT, OPTICAL_FLOW_RAD, DISTANCE_SENSOR, EKF_STATUS_REPORT, SYS_STATUS at 10–50 Hz
- **Motor ESCs:** 4× ESC controlled by Pixhawk PWM/DSHOT — the Pixhawk handles all low-level stabilization loops (rate PID, attitude PID, altitude hold). The Raspberry Pi only sends high-level position/velocity setpoints via MAVLink.
- **GUIDED mode:** The flight controller is placed in GUIDED or OFFBOARD mode during autonomous missions so it accepts `SET_POSITION_TARGET_LOCAL_NED` commands from the companion computer.

### Companion Computer — Raspberry Pi 4

The RPi 4 (4 GB RAM) is the mission brain:

- Runs the entire Python CV + mission stack at ~20 Hz
- Communicates with Pixhawk over a **dedicated UART bridge** (RPi GPIO 14/15 → TELEM2 pins) at 921 600 baud using the pymavlink library
- Runs YOLOv8n inference at ~15 fps using ONNX Runtime (CPU; ~180 ms/frame)
- Sends position setpoints and arming commands back to Pixhawk in real time
- Controls the pollination servo via GPIO PWM

### Camera

**Raspberry Pi Camera Module v2** (Sony IMX219, 8 MP) connected over CSI ribbon cable.

- Resolution captured: 640×640 px (center-cropped from 1920×1080)
- Frame rate: ~30 fps capture, inference triggered every ~66 ms
- Field of view: ~62° diagonal → at 1.5m hover altitude, the camera footprint covers ~1.7m × 1.7m on the ground, which is sufficient to frame a single flower cluster

### Pollination Mechanism

A miniature brushless vibration motor + pollen brush assembly is mounted below the drone frame on a 9g servo arm. The `PollinationManager` triggers GPIO PWM output to:

1. Rotate the servo arm 45° downward to contact position
2. Activate the vibration motor for 2 seconds (pollen transfer dwell time)
3. Retract the servo arm to stowed position

The GPIO control uses the RPi's hardware PWM pins so pulse timing is precise even under CPU load.

### Wiring Diagram

```
Raspberry Pi 4 GPIO                     Pixhawk 4 TELEM2
─────────────────                       ────────────────
GPIO 14 (UART TX)  ──────────────────→  RX
GPIO 15 (UART RX)  ←──────────────────  TX
GND                ─────────────────── GND

Raspberry Pi 4 GPIO                     Servo / Motor
─────────────────                       ─────────────
GPIO 12 (PWM0)     ──────────────────→  Servo signal
GPIO 13 (PWM1)     ──────────────────→  Vibration motor PWM
5V                 ──────────────────→  Servo VCC
GND                ─────────────────── GND

RPi Camera CSI ribbon ──────────────→  Camera connector (J3)
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
| `preflight_check()` | Reads telemetry snapshot | Verifies EKF healthy, GPS lock, battery >20%, geofence valid |
| `arm()` | `MAV_CMD_COMPONENT_ARM_DISARM (1)` | Requires GUIDED mode active |
| `disarm()` | `MAV_CMD_COMPONENT_ARM_DISARM (0)` | Only if landed |
| `takeoff(alt_m)` | `MAV_CMD_NAV_TAKEOFF` | Blocks until altitude reached ±0.3m |
| `goto(x, y, alt)` | `SET_POSITION_TARGET_LOCAL_NED` | NED frame, velocity feed-forward |
| `precision_hover(x, y, alt)` | `SET_POSITION_TARGET_LOCAL_NED` | Tighter tolerance (±0.1m XY, ±0.05m Z) for hover_align |
| `land()` | `MAV_CMD_NAV_LAND` | Blocks until landed + disarmed |
| `set_mode(mode)` | `SET_MODE` | Switches GUIDED / STABILIZE / LOITER |

### Telemetry Messages Consumed

| MAVLink Message ID | Rate | Fields Used |
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
6. Expand dims to `[1, 3, 640, 640]` NCHW tensor layout

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
    bearing: Optional[np.ndarray]    # unit vector camera→flower
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
   Scale (±50%), translate (±10%), rotation (±0°), cutmix (close-range images)

3. Fine-tuning command
   python train.py --model yolov8n.pt --data flowers.yaml \
     --epochs 100 --imgsz 640 --batch 16 --lr0 0.01 \
     --patience 20 --device 0

4. Evaluation
   mAP@50:   target >0.72
   mAP@50-95: target >0.45
   Precision: target >0.70
   Recall:   target >0.65

5. Export to ONNX
   from ultralytics import YOLO
   model = YOLO('best.pt')
   model.export(format='onnx', imgsz=640, simplify=True, opset=12)
   # Output: best.onnx  (~6.3 MB)
```

### ONNX Export for Raspberry Pi

ONNX Runtime on the Raspberry Pi 4 runs the model in **CPU execution provider** mode. The export uses `opset=12` for maximum compatibility. The model is loaded once at startup and the session is reused across frames to avoid repeated initialization overhead (~800 ms first load).

```python
import onnxruntime as ort
sess = ort.InferenceSession('flower_detector.onnx',
    providers=['CPUExecutionProvider'])
```

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

## Mission State Machine (Real + Simulated)

The 13-phase state machine is implemented twice — identically — in both the Python `StateMachine` class (`drone-cv-system/mission/state_machine.py`) and the TypeScript `AutonomousNavigator` class (`src/simulation/autonomousNavigator.ts`). This ensures the simulation precisely mirrors real behavior.

### The 13 Phases

| Phase | Real Drone Behavior | Simulation Behavior |
|---|---|---|
| `idle` | System powered on, sensors initializing | Drone on ground, all sensor values at rest |
| `arming` | Pre-flight checks: EKF health, GPS lock, battery >20%, geofence valid. `arm()` command sent. | 2-second dwell, sensor values ramp to armed state |
| `takeoff` | `MAV_CMD_NAV_TAKEOFF` to 8m patrol altitude. Blocks until `relative_alt > 7.7m`. | Altitude ramps 0→8m over 3 seconds, z velocity peaks at ~2.7 m/s |
| `transit` | `SET_POSITION_TARGET_LOCAL_NED` to first waypoint at 8m. | Drone interpolates XY toward waypoint, yaw tracks heading |
| `scanning` | Drone holds position. Camera running, YOLOv8 analyzing each frame. Confidence accumulation begins. | Lawnmower sweep passes. Proximity detection + server detections accumulate |
| `candidate_detected` | At least one detection confidence >0.40. Mission records target flower ID. | Confidence ramps 0.40→0.75 over 0.8 seconds |
| `target_lock` | Confidence ≥ 0.75. Target locked, descent authorized. | Reticle tightens to 1.0, camera zooms to target, confidence held at 0.85+ |
| `descent` | Precision hover setpoints descend from 8m → 1.5m. Rangefinder actively monitored. | Altitude falls over 1.5 seconds, optical flow quality peaks as altitude drops |
| `hover_align` | XY alignment loop active at 1.5m. `precision_hover()` with ±0.1m tolerance. | 0.5-second dwell with sensor jitter, hover instability model active |
| `pollinating` | Servo arm deploys, vibration motor runs 2s, retract. | Particle effects, 1.5-second dwell, flower state → pollinated |
| `ascent` | `SET_POSITION_TARGET_LOCAL_NED` climbs back to 8m. | Altitude ramps 1.5→8m over 1.2 seconds |
| `resume_transit` | Navigate to next flower target. | Same as transit but between internal waypoints |
| `mission_complete` | All targets visited. Return to home (2,2). `MAV_CMD_NAV_LAND`. Disarm. | Drone flies to home position, then altitude ramps to 0 |

### Phase Transitions & Guards

Transitions are guarded by sensor state, not wall-clock time (real drone) or frame index (simulation):

```
arming        → takeoff       : armed == True AND EKF healthy
takeoff       → transit       : relative_alt > patrol_alt − 0.3m
scanning      → candidate     : any detection confidence > 0.40
candidate     → target_lock   : best confidence > 0.75
target_lock   → descent       : lock confirmed for >0.5s
descent       → hover_align   : rangefinder distance < 1.8m
hover_align   → pollinating   : XY position error < 0.1m
pollinating   → ascent        : pollination dwell timer elapsed
ascent        → resume_transit: relative_alt > patrol_alt − 0.3m
resume_transit→ scanning      : within 1m of next waypoint
mission_complete→ landed      : relative_alt < 0.15m
```

---

## Path Planning Agent — TSP Solver

After the scanning phase discovers all flowers in the garden, the mission transitions to a **2.5-second planning phase** in which the TSP (Travelling Salesman Problem) route is computed.

**Algorithm: Greedy nearest-neighbor heuristic**

```
1. Start from current drone position
2. candidates = all discovered flower IDs not yet pollinated
3. While candidates not empty:
   a. Find flower in candidates closest (Euclidean) to current position
   b. Append it to route
   c. Set current position = that flower's position
   d. Remove from candidates
4. Return ordered route list
```

This is implemented in three places:

| Location | File | Used For |
|---|---|---|
| TypeScript | `autonomousNavigator.ts` `computeTspRoute()` | Live mode client-side TSP |
| TypeScript | `randomMissionGenerator.ts` `computeTspRoute()` | Initial route for live mode garden |
| Python | `inference_server.py` `_compute_tsp_suggestion()` | Server-side TSP suggestion sent back to client |

The server-side TSP suggestion is merged into the client route on each WebSocket response — if the server detects flowers the client hasn't yet discovered, those are inserted into the route at the nearest position.

**Why nearest-neighbor over exact solvers?** With 6–10 flowers, nearest-neighbor gives routes within ~15–20% of optimal and runs in O(n²). An exact solver (branch-and-bound or dynamic programming for n ≤ 15) would also be feasible, but nearest-neighbor is sufficient for this garden scale and avoids any latency spike.

---

## Pollination Manager (`pollination_manager.py`)

Tracks flower target state and controls the physical pollination hardware.

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

**Pollination sequence (triggered by `StateMachine` on entering `pollinating` phase):**

```python
def trigger_pollination(self, flower_id: str):
    # 1. Extend servo arm to contact position
    GPIO.output(SERVO_PIN, GPIO.HIGH)
    self._set_pwm(SERVO_PIN, CONTACT_DUTY_CYCLE)  # ~7.5% = 90° rotation

    # 2. Activate vibration motor
    self._set_pwm(MOTOR_PIN, MOTOR_DUTY_CYCLE)    # full speed

    # 3. Dwell 2 seconds for pollen transfer
    time.sleep(2.0)

    # 4. Retract motor + servo
    self._set_pwm(MOTOR_PIN, 0)
    self._set_pwm(SERVO_PIN, STOW_DUTY_CYCLE)     # ~2.5% = 0° rotation

    # 5. Mark flower pollinated
    self.targets[flower_id].pollinated = True
```

---

## Python Inference Server

The inference server (`drone-cv-system/server/inference_server.py`) bridges the browser simulator and the Python CV system. It runs as a FastAPI application with a **WebSocket endpoint** at `ws://localhost:8765/inference`.

### WebSocket Protocol

**Client → Server (every ~100ms):**

```json
{
  "drone": {
    "x": 12.3,
    "y": 8.7,
    "z": 8.0,
    "yaw": 45.0
  },
  "flowers": [
    { "id": "r1", "x": 10.2, "y": 6.4, "radius": 0.8,
      "primaryColor": "#ff6b9d", "accentColor": "#ff9ebe",
      "state": "discovered", "confidence": 0.62 }
  ],
  "phase": "scanning"
}
```

**Server → Client (immediate response):**

```json
{
  "detections": [
    {
      "id": "r1",
      "confidence": 0.74,
      "cls": "flower_open",
      "bbox": [280, 190, 360, 275]
    }
  ],
  "phaseSuggestion": "candidate_detected",
  "targetId": "r1",
  "inferenceMs": 23.4,
  "inferenceMode": "onnx",
  "framePng": "<base64 JPEG string>",
  "tspSuggestion": ["r1", "r3", "r2", "r5"]
}
```

`framePng` is a base64-encoded JPEG of the 640×640 synthetic PIL frame that was fed into the detector. The browser renders this as the camera panel background in live mode, making the "camera feed" show exactly what the detector saw.

### Scene Renderer (`scene_renderer.py`)

Generates a synthetic but photorealistic 640×640 bird's-eye camera frame using PIL, representing what the drone's downward-facing camera would see at its current altitude and orientation.

**Projection pipeline:**

```
Garden coordinates (x, y meters)
         ↓
Translate relative to drone position: (dx, dy) = (flower.x − drone.x, flower.y − drone.y)
         ↓
Rotate by drone yaw angle (camera body frame)
         ↓
Scale by altitude: pixels/meter = FOCAL_LENGTH / drone.z
         ↓
Translate to image center: pixel = (320 + dx_m × scale, 320 + dy_m × scale)
```

**Flower rendering per cluster (cached per unique `id + state`):**

1. Draw 6-petal arrangement — each petal is a filled ellipse, rotated 60° apart, with `primaryColor`
2. Draw center pistil circle with `accentColor`
3. Draw stem (rectangle, dark green) + 2 procedural leaves (ellipses with rotation)
4. Apply per-petal shading based on angular orientation for depth
5. Composite onto background

**Post-processing effects:**
- Gaussian blur proportional to drone altitude (simulates camera focus falloff at high altitude: `sigma = drone.z × 0.35`)
- Subtle color grading (warm tint)
- Radial vignette
- Output as 640×640 RGB array, optionally encoded to JPEG at quality=72

### Detection Bridge (`detection_bridge.py`)

Unified detection interface with two backends that the rest of the server code never needs to distinguish between:

**ONNX path:**

```
640×640 PIL frame
       ↓
FramePreprocessor (normalize + tensor)
       ↓
onnxruntime.InferenceSession.run()  →  [1, 84, 8400]
       ↓
Confidence filter (>0.20) + class filter + NMS
       ↓
Spatial geo-matching: for each YOLO box, project flowers to pixel space
  and find the garden flower whose projected center is closest to the bbox center
       ↓
List[{id, confidence, cls, bbox}]
```

Runs with a **2-second timeout**; if inference takes longer (e.g., model loading cold start), falls back to mock results for that frame.

**Mock path (always available as fallback):**

Computes physics-based confidence for each flower without any camera frame:

```python
horiz_dist = sqrt((flower.x − drone.x)² + (flower.y − drone.y)²)
altitude_m = drone.z

# Altitude-dependent effective range
effective_range = max(1.0, altitude_m × 0.8)

# Horizontal falloff
dist_confidence = max(0, 1.0 − horiz_dist / effective_range)

# Sensor quality at this altitude
sensor = interpolate_sensor(altitude_m × 39.37)  # m → inches
strength_factor = sensor.strength / 255.0
quality_factor = sensor.flow_quality / 150.0     # 150 = peak quality

confidence = dist_confidence × strength_factor × quality_factor
```

### Planning Agent (Server-Side TSP)

After detections are assembled, the server runs a second nearest-neighbor TSP pass over all detected flowers and returns `tspSuggestion` — an ordered list of flower IDs. The client merges this with its own route, inserting any newly discovered IDs at the nearest point in the existing route.

---

## Web Simulator — How It Works

### Mode 1: Deterministic Replay

The entire 90-second mission is **pre-generated once** into 2700 `ReplayFrame` objects (30 fps × 90 seconds) when the app first loads. There is no physics simulation, no randomness, and no server connection during playback. Every panel reads from a single `currentFrame` prop.

The `useReplayEngine` hook drives a `requestAnimationFrame` loop that:

1. Computes wall-clock delta since last frame
2. Multiplies by speed factor (1×/2×/4×)
3. Accumulates into a time counter
4. Converts to frame index: `frameIndex = floor(time × 30)`
5. Updates `currentFrame`, `positionHistory` (90-frame window), `altitudeHistory` (150-sample window), `accumulatedEvents` (100-entry window)

**`seekTo(time)`** rebuilds all history windows by iterating backwards through the pre-generated frames — no state needs to be stored per-frame because the frames are already fully materialized.

### Mode 2: Live Inference

Mode 2 runs the full autonomy loop as a real-time simulation against the Python inference server. The `useLiveInferenceEngine` hook:

1. Generates a random garden via `randomMissionGenerator.ts`
2. Spawns the Python server via `POST /api/start-inference-server`
3. Opens a `WsClient` WebSocket connection to `ws://localhost:8765/inference`
4. Starts a `requestAnimationFrame` loop that ticks `AutonomousNavigator.tick(dt)`
5. Every 100ms, sends drone state + flower list to the server
6. Receives detections + phase suggestion + TSP suggestion + frame PNG
7. Feeds inference results back into `AutonomousNavigator.processInference(result)`
8. Exposes `LiveFrame` state to all UI panels via `liveToReplay()` adapter

**Terminal buffering:** The engine accumulates `TerminalEntry` objects in a `useRef` buffer (to avoid re-renders on every log) and syncs to state every 250ms via `setInterval`.

---

## Autonomous Navigator (TypeScript)

`src/simulation/autonomousNavigator.ts` is the TypeScript implementation of the full mission state machine for live mode. It runs at ~30 fps driven by the RAF loop.

### Phase State Machine

Each phase has a dedicated handler method called on every `tick(dt)`:

```typescript
tick(dt: number): void {
    switch (this.phase) {
        case 'idle':              this.doIdle(); break;
        case 'arming':            this.doArming(dt); break;
        case 'takeoff':           this.doTakeoff(dt); break;
        case 'scanning':          this.doScanning(dt); break;
        case 'planning':          this.doPlanning(dt); break;
        case 'approach':          this.doApproach(dt); break;
        case 'descent':           this.doDescent(dt); break;
        case 'hover_align':       this.doHoverAlign(dt); break;
        case 'pollinating':       this.doPollinating(dt); break;
        case 'ascent':            this.doAscent(dt); break;
        case 'resume':            this.doResume(dt); break;
        case 'mission_complete':  this.doMissionComplete(dt); break;
        case 'landing':           this.doLanding(dt); break;
    }
}
```

**Position interpolation:** All movement phases linearly interpolate from a start position to a target position using a 0→1 progress variable accumulated from `dt / phaseDuration`. This gives smooth deterministic motion without physics integration.

### Proximity Detection

Called on every frame during `scanning` and `approach` phases, even without a server connection:

```typescript
doProximityDetection(): void {
    for (const flower of this.flowers) {
        if (flower.state === 'undiscovered') continue;
        const dist = Math.hypot(
            flower.x - this.drone.x,
            flower.y - this.drone.y
        );
        if (dist < 4.5) {
            const conf = 0.9 - 0.6 × (dist / 4.5);
            flower.confidence = Math.max(flower.confidence, conf);
            if (flower.state === 'undiscovered') {
                flower.state = 'discovered';
                this.discoveredIds.push(flower.id);
                // Recompute TSP route with newly discovered flower
                this.tspRoute = this.computeTspRoute(this.discoveredIds);
                this.tlog('nav', `proximity: discovered ${flower.id} at ${dist.toFixed(1)}m`);
            }
        }
    }
}
```

This means the drone will always make progress even if the Python server is offline — the proximity model is a reliable fallback.

### TSP Route Computation

```typescript
computeTspRoute(ids: string[]): string[] {
    let pos = { x: this.drone.x, y: this.drone.y };
    const remaining = [...ids];
    const route: string[] = [];
    while (remaining.length > 0) {
        let best = -1, bestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const f = this.getFlower(remaining[i]);
            const d = Math.hypot(f.x - pos.x, f.y - pos.y);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        route.push(remaining[best]);
        pos = this.getFlower(remaining[best]);
        remaining.splice(best, 1);
    }
    return route;
}
```

The route is **recomputed every time a new flower is discovered** via proximity detection, so the purple TSP overlay on the map updates live as the drone scans the garden.

### Terminal Logging

Every significant event in the navigator is logged to the terminal panel with a type tag:

```typescript
tlog(type: TerminalEntryType, text: string): void {
    if (!this.termCallback) return;
    this.termCallback({
        type,
        text,
        timestamp: this.elapsed,  // T+Xs format
    });
}
```

Log types: `sys` (connect/session events) · `phase` (state transitions) · `ws-out` (TX frames) · `ws-in` (RX frames) · `detect` (per-flower CV detections) · `tsp` (route updates) · `nav` (proximity events) · `error` (failures)

---

## Live Inference Engine (`liveInferenceEngine.ts`)

`src/simulation/liveInferenceEngine.ts` is the Preact hook that owns all live mode state and wires together the navigator, WebSocket client, and terminal buffer.

**State managed:**

```typescript
interface LiveInferenceState {
    frame: LiveFrame | null;
    wsStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    inferenceMode: 'onnx' | 'mock' | null;
    lastInferenceMs: number;
    terminalEntries: TerminalEntry[];
    start: () => void;
    stop: () => void;
    restart: () => void;
}
```

**Lifecycle:**

```
mount → start() called automatically
  → generate random garden
  → spawn Python server (POST /api/start-inference-server)
  → connect WsClient (ws://localhost:8765/inference)
  → emit SESSION START sys entry
  → start RAF loop
    each frame:
      nav.tick(dt)
      → setFrame(nav.buildFrame())
    every 100ms:
      ws.send({ drone, flowers, phase })
    on ws.onMessage:
      nav.processInference(result)
      update inferenceMode + lastInferenceMs
  → setInterval 250ms: flush termBufRef → setTerminalEntries
```

**SESSION START:** On each `start()`, a `sys` terminal entry is emitted with a timestamp, garden summary (flower count + positions), and the WebSocket URL. This gives the terminal a clear session delimiter when the mission is restarted.

---

## WebSocket Client (`wsClient.ts`)

`src/simulation/wsClient.ts` manages the WebSocket connection to the Python server with auto-reconnect.

**Features:**

- **Auto-reconnect:** On close or error, schedules a reconnect after 2 seconds (up to 10 attempts)
- **Send queue:** If `send()` is called while connection is not yet open, the message is queued and flushed once the connection opens
- **Phase tracking:** Tracks last sent phase so the server always has current context
- **Logging:** Every TX frame is logged as `ws-out`, every RX frame as `ws-in` (with detection count + confidence %)
- **onLog callback:** Constructor accepts an `onLog: TerminalLogFn` to pipe entries into the terminal buffer

**TX frame logged as:**

```
[ws-out] scanning  pos=(12.3, 8.7, 8.0)  flowers=6
```

**RX frame logged as:**

```
[ws-in]  2 detections  best=74%  mode=onnx  12ms
```

---

## Sensor Simulation System

### Optical Flow Dataset

`src/data/opticalFlowDataset.ts` builds a merged, sorted sensor lookup table from:

1. **Real data** (`raw_opticalflow_data.csv`): 24 rows, measured at 0–276 inches (0–7.01m) altitude, at 12-inch intervals. Fields: `distance_in`, `sensor_distance` (mm), `strength` (0-255), `precision` (bits), `status`, `flow_vel_x`, `flow_vel_y`, `flow_quality`, `flow_state`.

2. **Synthetic midpoints**: Linearly interpolated rows at 6-inch step resolution (fills gaps between real samples).

3. **Extrapolated extension**: 3 rows beyond 276 inches (up to 315 inches / ~8m) to cover patrol altitude.

**Merge strategy:** Real rows always override synthetic rows at the same distance. Final dataset is sorted by `distance_in` ascending.

### Sensor Interpolation Engine

`src/simulation/sensorInterpolation.ts` performs **smooth-step interpolated lookup** into the dataset:

```typescript
function interpolateSensor(targetInches: number): SensorRow {
    const idx = binarySearch(dataset, targetInches);
    const lo = dataset[idx], hi = dataset[idx + 1];
    const t_raw = (targetInches − lo.distance_in) / (hi.distance_in − lo.distance_in);
    // Smooth-step easing: gentler transitions between samples
    const t = t_raw * t_raw * (3 − 2 * t_raw);
    return lerpRow(lo, hi, t);  // linear interpolation of all numeric fields
}
```

Called each simulation frame with `drone.z × 39.37` (meters → inches). Clamped to [0, 315] — no extrapolation beyond dataset range.

### Physics-Based Optical Flow Model

`src/simulation/opticalFlowModel.ts` applies physical corrections on top of interpolated sensor values:

| Effect | Formula | Condition |
|---|---|---|
| Velocity scaling | `vx = flow_vel_x × (distance_in / 1000)` | Always — flow apparent motion scales with altitude |
| Stability | `stability = flow_quality / 150` | Always — 150 is peak quality from real data at ~3m |
| Noise | `noise = (1 − stability) × 0.15` | Always |
| Effective quality | `effectiveQ = quality × (strength/255) × (1/precision)` | Weighted by signal integrity |
| High-altitude degradation | stability −60%, quality −70% | `distance_in > 197` (~5m) |
| Low-strength noise amplification | noise ×2.5 | `strength < 60` |
| Quality-driven drift | pseudoRand seeded by frame index → `driftX/Y` | `flow_quality < 50` |
| Hover instability | `sin(time × 3.2) × 0.04` oscillation on vx/vy | `altitude < 3m` |

**Output `OpticalFlowState`:**

```typescript
{
    vx, vy,                  // apparent velocities (m/s)
    stability,               // 0–1 sensor health
    noise,                   // 0–1 noise level
    normalizedStrength,      // 0–1
    effectiveQuality,        // 0–255 weighted
    degraded,                // altitude > 5m
    driftX, driftY,          // deterministic low-quality drift
    hoverInstabilityX/Y      // near-ground oscillation
}
```

### CV–Sensor Coupling

Detection confidence is modulated by sensor quality **every frame**, ensuring that a drone with degraded optical flow also has worse detection:

```typescript
const stabilityFactor = 0.6 + 0.4 × sensor.stability;    // min 60%
const strengthFactor  = 0.6 + 0.4 × sensor.normalizedStrength;  // min 60%

let confidence = rawDetectionConfidence × stabilityFactor × strengthFactor;

if (Math.abs(sensor.vx) > 1.5 || Math.abs(sensor.vy) > 1.5)
    confidence × = 0.75;  // motion blur penalty

if (sensor.effectiveQuality < 50)
    confidence × = 0.60;  // heavy quality penalty

if (sensor.stability > 0.7 && drone.z < 3.0)
    confidence × = 1.15;  // stable hover boost (capped at 1.0)
```

---

## Replay Engine (`replayEngine.ts`)

`src/simulation/replayEngine.ts` — the `useReplayEngine` Preact hook owns all replay state.

```typescript
interface ReplayState {
    currentFrame: ReplayFrame;
    isPlaying: boolean;
    speed: 1 | 2 | 4;
    currentTime: number;          // seconds
    totalTime: number;            // 90
    positionHistory: Position[];  // 90-frame rolling window
    altitudeHistory: AltitudeSample[];  // 150-sample rolling window
    accumulatedEvents: EventLogEntry[]; // last 100 events
    play: () => void;
    pause: () => void;
    reset: () => void;
    setSpeed: (s: 1|2|4) => void;
    seekTo: (t: number) => void;
}
```

**RAF loop detail:**

```typescript
// Each animation frame:
const now = performance.now();
const wallDt = (now − lastTimestamp) / 1000;  // seconds
lastTimestamp = now;
accumulatedTime += wallDt × speed;
const targetFrame = Math.min(
    Math.floor(accumulatedTime × 30),  // 30 fps
    frames.length − 1
);
// advance from currentFrameIndex to targetFrame, collecting history
```

This design means the simulator correctly handles **frame skipping** at 2× and 4× speeds — history windows are still correctly populated even when frames are advanced multiple steps per RAF tick.

---

## Mission Frame Generation

### Deterministic Replay Frames (`missionGenerator.ts`)

Generates the full 2700-frame `ReplayFrame[]` array once at startup. All randomness uses a **seeded PRNG** (mulberry32) so the output is identical on every run.

**Garden layout (hardcoded for Mode 1):**

```
10 flower clusters at fixed positions:
  f1=(5,5)  f2=(10,5)  f3=(15,5)  f4=(18,8)  f5=(15,12)
  f6=(10,12) f7=(5,12) f8=(3,8)   f9=(8,16)  f10=(14,16)

9 waypoints visiting 8 targets:
  home(2,2) → f1 → f2 → f3 → f4 → f5 → f6 → f7 → f8 → home

Drone home base: (2, 2)
```

**Per-frame computation:**

```
For each frame index i (0–2699):
  time = i / 30

  1. Determine mission phase from time thresholds
  2. Interpolate drone XYZ position along waypoint route
  3. Compute yaw toward next waypoint
  4. Add ±0.03m sinusoidal position noise (seeded by frame index)
  5. Compute sensor values:
     a. battery = 1.0 − 0.28 × (time/90)
     b. signal = 1.0 − 0.4 × (dist_from_home / 25)
     c. sensorInterpolation(drone.z × 39.37) → optical flow state
     d. opticalFlowModel(sensor, drone) → vx, vy, stability
     e. ekf_confidence = 0.94 + 0.02 × sin(time × 2.1)
  6. Compute detection confidence for current target flower
  7. Update flower states based on phase
  8. Generate events that fire at this timestamp
  9. Assemble and return ReplayFrame
```

### Random Mission Generator (`randomMissionGenerator.ts`)

Used by Mode 2 to generate a fresh garden on each session start.

```typescript
interface GeneratedMission {
    flowers: LiveFlower[];          // 6–10 clusters
    lawnmowerWaypoints: Point[];    // 4 passes at x=3,8,13,18
    homePosition: Point;            // (2, 2)
    initialTspRoute: string[];      // empty (no flowers discovered yet)
}
```

**Flower placement constraints:**

- Placed within 2.5m of garden edges (2.5 ≤ x,y ≤ 17.5)
- Minimum 2.8m separation between any two clusters
- Minimum 3.0m clearance from home base at (2,2)
- Attempts up to 200 times per flower; gives up and places fewer flowers if needed

**Color palette:** 10 pre-defined `(primaryColor, accentColor)` pairs covering a range of hues. Color assigned by `seededRng(flowerIndex)` so the same session always produces the same colors.

**Lawnmower passes:** 4 vertical passes at x = 3.0, 8.0, 13.0, 18.0. Alternating direction (S→N, N→S) to minimize turnaround distance. Y range: 2.0 → 18.0. This pattern covers the entire 2.5–17.5m flower placement zone with the 4.5m proximity detection radius.

---

## UI Panels — Deep Dive

### Top-Down Mission View

SVG 500×500 px, mapping the 20×20m garden space with `scale = 500/20 = 25 px/m`.

**Flower clusters** — each cluster rendered with 4–7 individual flowers at seeded-RNG offsets within `cluster.radius`:
- 6-petal design: each petal is an SVG ellipse, rotated at 0°/60°/120°/180°/240°/300°
- Seeded leaf + stem placement for organic variation
- SVG `feDropShadow` filter on each flower

**Flower state rings:**

| State | Visual |
|---|---|
| `unscanned` | 70% opacity, no ring (Mode 1) |
| `undiscovered` | Hidden in live mode (ghost only) |
| `discovered` | Green dashed circle, CSS `pulse` keyframe animation |
| `scanned` | Blue dashed circle |
| `candidate` | Amber solid ring with glow |
| `locked` | Cyan solid ring + `feGaussianBlur` glow effect |
| `pollinated` | 55% opacity, gold sparkle particles |

**Drone icon:** Hexagonal body, 4 rotors with `rotor-spin` CSS animation, trapezoidal camera footprint cone pointing in yaw direction (scales with altitude).

**TSP route overlay (Mode 2):** Dashed purple polyline drawn through `tspRoute` flower positions, visible from the first discovery (not gated on `planningComplete`).

**Position trail:** Last 90 `positionHistory` samples rendered as a fading polyline (opacity decreases with age).

### Altitude / Side View

SVG 600×200 px cross-section.

- **Y-axis:** 0–10m altitude, labeled grid lines at 0, 2, 5, 8, 10m
- **Hover band:** 1.3–1.8m amber shaded zone
- **Patrol altitude:** Dashed line at 8m
- **Altitude trace:** Cyan polyline from `altitudeHistory` — **60-second rolling window** to prevent SVG overflow (x-axis = relative time, not absolute)
- **Plant silhouettes:** 10 flower shapes at ground level at their x-positions
- **Drone side profile:** Rendered at current altitude, with rotor arms + landing gear
- **Rangefinder beam:** Dashed red line from drone belly to ground

### Telemetry Dashboard

| Section | Values |
|---|---|
| **Mission Status** | Phase badge (color-coded), waypoint index, elapsed time (mm:ss), target flower ID |
| **Position & Motion** | X, Y, Z (m); Vx, Vy, Vz (m/s); 2D speed; yaw (°); yaw rate (°/s) |
| **System Status** | Battery % + fill bar; signal strength bar |
| **Sensor Readings** | Optical flow quality (0-255); flow velocity XY; rangefinder distance; sonar estimate; EKF confidence |
| **Camera / Detection** | Detection confidence %; flowers in view count; target locked indicator; pollination active |
| **Mission Progress** | Waypoints visited; pollinated count; per-flower chip grid (color = state) |
| **Event Log** | Auto-scrolling, last 20 entries, color-coded: info (cyan) / warn (amber) / success (green) / event (purple) |

In live mode, the flower chip grid renders `r1, r2, …` IDs and colors them green when pollinated. Confidence displays `—` at 0% to avoid invisible dark text on dark background.

### Camera / Flower Analysis Panel

Simulates what the drone camera feed looks like, processed through the YOLOv8 system.

**AnalysisFrame pipeline:**

```
ReplayFrame / LiveFrame
       ↓
computeAnalysisFrame()
       ↓
AnalysisFrame {
    flowers: FlowerRenderState[]   // camera-space positions + zoom
    frustum: FrustumState          // tightness 0→1 based on phase
    opticalFlow: OpticalFlowState  // from sensor model
    phase: MissionPhase
    confidence: number
    targetId: string | null
    framePng: string | null        // base64 JPEG from server (Mode 2 only)
}
       ↓
CameraAnalysisScene (SVG 800×500)
```

**Fixed camera positions:** Flowers are assigned fixed pseudo-perspective positions in the 800×500 camera frame (two rows of up to 5), so the scene looks like a real garden view regardless of garden layout. During `target_lock` / `descent` / `hover_align` / `pollinating`, the target flower translates to scene center (400, 230) at 2× scale — simulating camera zoom.

**SVG layer stack (bottom to top):**

| Layer | Component | Description |
|---|---|---|
| 1 | Background | Dark scene, grid overlay, vignette, scanlines |
| 2 | Live frame | Server PIL JPEG as `<image>` (Mode 2 only) |
| 3 | Motion blur | `feGaussianBlur` on flower group when sensor velocity > 1.0 m/s |
| 4 | Sensor jitter | Deterministic `jx/jy` offset on flower group when quality < 50 |
| 5 | `FlowerClusterRenderer` | Organic SVG flowers in camera-space positions |
| 6 | `DetectionHeatmap` | Radial gradient confidence blobs; opacity scales with `qualityIntensity` |
| 7 | Stable glow | Cyan center ring when stability > 0.7 and altitude < 3m |
| 8 | Instability tint | Red-orange radial vignette when stability < 0.4 |
| 9 | `DetectionReticle` | Corner brackets + crosshair; tightness 0.15 (transit) → 1.0 (pollinating) |
| 10 | `PollinationEffect` | Orbiting golden sparkle particles + pulse rings |
| 11 | `MissionPhaseOverlay` | Phase banner for all 13 phases |
| 12 | `FlowVectorOverlay` | Flow field grid + primary velocity arrow (cyan/amber/red by stability) |
| 13 | `OpticalFlowHud` | Top-right HUD: DIST, SENSOR, FLOW X/Y, QUALITY, STRENGTH, PRECISION, STABILITY % |
| 14 | `AnalysisHud` | Bottom HUD strip: phase chip, confidence bar + sparkline, status flags |

### Terminal Panel

Fixed overlay at the bottom of the screen in live mode. Dark terminal aesthetic (`#030810` background), monospace font, auto-scroll with unpin-on-scroll + re-pin button.

**Entry types and colors:**

| Type | Color | Content |
|---|---|---|
| `sys` | Slate | Connection events, session start, server status |
| `phase` | Purple | State machine transitions with T+Xs elapsed |
| `ws-out` | Blue | Every TX frame: phase + position + flower count |
| `ws-in` | Cyan | RX summary: detection count + best confidence % |
| `detect` | Green | Per-detection: flower ID, class, confidence, bbox |
| `tsp` | Amber | Route updates: ordered flower ID list |
| `nav` | Gray | Proximity events: discovered ID + distance |
| `error` | Red | WebSocket errors, server failures |

**Filter buttons:** ALL · WS (ws-out + ws-in) · INFER (detect + tsp) · NAV (nav + phase)  
**CLEAR:** Clears the display without clearing the underlying buffer (useful for decluttering without losing history)

### Live Status Bar

Renders in live mode at the top of the screen:

- WebSocket status dot: gray (disconnected) / amber (connecting) / green (connected) / red (error)
- Inference mode chip: `ONNX` (blue) or `MOCK` (amber) + `XXms` inference time
- `>_ TERMINAL` toggle button (highlights blue when open)
- `RESTART` button
- `EXIT` button (returns to mode selector)

### Replay Controls

Bottom bar in Mode 1:

- Play / Pause button
- Reset button
- Speed selector: 1× / 2× / 4×
- Time display: `mm:ss / mm:ss`
- Range input scrubber with gradient fill showing progress
- Mission progress bar

---

## Data Models — Type Reference

### `ReplayFrame`

```typescript
interface ReplayFrame {
    time: number;                    // seconds since mission start
    drone: DroneState;
    sensor: SensorState;
    mission: MissionState;
    camera: CameraAnalysisState;
    flowers: FlowerCluster[];
    events: EventLogEntry[];
}
```

### `DroneState`

```typescript
interface DroneState {
    x: number; y: number; z: number;   // position (meters)
    vx: number; vy: number; vz: number; // velocity (m/s)
    speed: number;                      // 2D magnitude
    yaw: number;                        // degrees CW from north
    yawRate: number;                    // °/s
}
```

### `SensorState`

```typescript
interface SensorState {
    battery: number;                // 0–1
    signal: number;                 // 0–1
    opticalFlowQuality: number;     // 0–255
    opticalFlowVelocityX: number;
    opticalFlowVelocityY: number;
    rangefinder: number;            // meters
    ekfConfidence: number;          // 0.92–0.96
    detectionConfidence: number;    // 0–1
    // Extended optical flow state
    ofStrength: number;             // raw sensor strength (0–255)
    ofPrecision: number;            // bits
    ofStability: number;            // 0–1 computed stability
    ofNoise: number;                // 0–1
    ofDegraded: boolean;            // altitude > 5m flag
}
```

### `FlowerCluster`

```typescript
interface FlowerCluster {
    id: string;                     // 'f1'–'f10' (replay), 'r1'–'rN' (live)
    x: number; y: number;           // garden position (meters)
    radius: number;                 // cluster radius
    primaryColor: string;
    accentColor: string;
    state: FlowerState;             // see below
    confidence: number;             // current detection confidence
}

type FlowerState =
    | 'unscanned'      // Mode 1: not yet reached
    | 'undiscovered'   // Mode 2: not yet detected
    | 'discovered'     // Mode 2: proximity/CV detected
    | 'scanned'        // camera analyzed, no lock yet
    | 'candidate'      // confidence > 0.40
    | 'locked'         // confidence > 0.75
    | 'pollinated';    // mission complete for this flower
```

### `InferenceResult`

```typescript
interface InferenceResult {
    detections: {
        id: string;
        confidence: number;
        cls: string;
        bbox: [number, number, number, number];
    }[];
    phaseSuggestion: LivePhase;
    targetId: string | null;
    inferenceMs: number;
    inferenceMode: 'onnx' | 'mock';
    framePng: string | null;         // base64 JPEG from scene renderer
    tspSuggestion: string[];         // server-computed TSP order
}
```

### `TerminalEntry`

```typescript
interface TerminalEntry {
    type: TerminalEntryType;         // sys|phase|ws-out|ws-in|detect|tsp|nav|error
    text: string;
    timestamp: number;               // seconds since session start
}
```

---

## Configuration

| File | Purpose |
|---|---|
| `vite.config.ts` | Vite config with `@preact/preset-vite` and Tailwind; also includes the `inferenceServerPlugin` that handles `POST /api/start-inference-server` by spawning the Python process |
| `tsconfig.json` | ES2020 target, `"jsxImportSource": "preact"`, strict mode |
| `tailwind.config.ts` | Tailwind v4 with dark mode |
| `drone-cv-system/server/requirements_server.txt` | `fastapi uvicorn websockets pillow numpy onnxruntime` |
| `drone-cv-system/requirements.txt` | Full drone stack: `pymavlink ultralytics opencv-python RPi.GPIO loguru` |
| `raw_opticalflow_data.csv` | Real sensor measurements (24 rows, 0–276 inches altitude) |

---

## Hardware Setup (Real Drone)

### Assembly Checklist

1. **Frame:** 450mm quad frame, ~600g AUW with payload
2. **Flight controller:** Pixhawk 4/6 mounted with vibration dampeners
3. **ESCs:** 4× 30A BLHeli32 ESCs, calibrated
4. **Motors:** 2306 2450KV brushless, propellers 5045 HQ
5. **GPS + Compass:** u-blox M8N GPS mast-mounted above FC for clean compass readings
6. **Companion computer:** RPi 4 (4GB) mounted with USB-C power from BEC
7. **Camera:** RPi Camera v2 mounted on belly, angled slightly forward (~10° tilt)
8. **Pollination payload:** 9g servo + vibration motor assembly on 3D-printed arm bracket
9. **UART bridge:** Jumper wires from RPi GPIO 14/15 to Pixhawk TELEM2

### Software Setup on Raspberry Pi

```bash
# Flash Ubuntu 22.04 Server to SD card
# Enable UART in /boot/config.txt:
echo "enable_uart=1" >> /boot/config.txt
echo "dtoverlay=disable-bt" >> /boot/config.txt  # disable Bluetooth to free UART

# Install dependencies
sudo apt update && sudo apt install -y python3-pip python3-opencv libopencv-dev
pip3 install pymavlink ultralytics onnxruntime pillow loguru RPi.GPIO

# Upload ONNX model
scp flower_detector.onnx pi@drone-pi.local:~/drone-cv-system/

# Start mission
python3 drone-cv-system/main.py
```

### PX4/ArduPilot Parameters Required

| Parameter | Value | Reason |
|---|---|---|
| `MAV_COMP_ID` | 1 | Companion computer MAVLink ID |
| `SERIAL2_BAUD` | 921600 | TELEM2 baud rate |
| `SERIAL2_PROTOCOL` | 2 | MAVLink 2.0 |
| `EKF2_AID_MASK` | 3 | GPS + vision position |
| `PLND_ENABLED` | 1 | Precision landing |
| `WPNAV_RADIUS` | 100 | 1m waypoint acceptance radius |
| `GUIDED_OPTIONS` | 0 | Accept velocity setpoints |

---

## Tech Stack

| Layer | Technology | Version | Role |
|---|---|---|---|
| **Frontend framework** | Preact | 10.19 | UI components, hooks |
| **Language** | TypeScript | 5.3 | Type safety across frontend |
| **Build tool** | Vite | 5.1 | Dev server, HMR, production build |
| **CSS** | TailwindCSS | 4.0 | Utility styling |
| **Rendering** | SVG | — | All 4 simulation panels |
| **Backend web** | FastAPI + uvicorn | 0.110 | WebSocket inference server |
| **Backend language** | Python | 3.9+ | CV, hardware, server |
| **ML framework** | Ultralytics YOLOv8 | 8.x | Model training |
| **Inference runtime** | ONNX Runtime | 1.17 | RPi + laptop inference |
| **Image processing** | Pillow + NumPy | 10.x / 1.26 | Scene synthesis + preprocessing |
| **Computer vision** | OpenCV | 4.9 | Lucas-Kanade flow, camera capture |
| **Hardware comms** | pymavlink | 2.4 | MAVLink protocol to Pixhawk |
| **GPIO** | RPi.GPIO | 0.7 | Servo + motor PWM |
| **Logging** | loguru | 0.7 | Python structured logging |

---

## Folder Structure

```
drone-simulation/
├── src/
│   ├── app/
│   │   └── App.tsx                    ← Mode selector, ReplayApp, LiveApp, liveToReplay adapter
│   ├── components/
│   │   ├── TopDownView/
│   │   │   └── TopDownView.tsx        ← SVG garden map, drone, flowers, TSP route, trail
│   │   ├── SideView/
│   │   │   └── SideView.tsx           ← SVG altitude cross-section, rolling 60s trace
│   │   ├── TelemetryPanel/
│   │   │   └── TelemetryPanel.tsx     ← Engineering HUD, 7 sections, event log
│   │   ├── ZoomPanel/
│   │   │   └── ZoomPanel.tsx          ← Thin wrapper → CameraAnalysisPanel
│   │   ├── ReplayControls/
│   │   │   └── ReplayControls.tsx     ← Play/pause/speed/scrubber (Mode 1)
│   │   ├── LiveStatus/
│   │   │   └── LiveStatus.tsx         ← WS dot, inference chip, terminal toggle (Mode 2)
│   │   ├── TerminalPanel/
│   │   │   └── TerminalPanel.tsx      ← Live debug terminal, 8 entry types, filter buttons
│   │   └── camera-analysis/
│   │       ├── types.ts               ← AnalysisFrame, FlowerRenderState, FrustumState
│   │       ├── CameraAnalysisPanel.tsx ← Computes AnalysisFrame from frame props
│   │       ├── CameraAnalysisScene.tsx ← SVG compositor, jitter, blur, stable glow
│   │       ├── FlowerClusterRenderer.tsx ← Seeded organic SVG flowers
│   │       ├── DetectionReticle.tsx   ← Frustum brackets + crosshair
│   │       ├── DetectionHeatmap.tsx   ← Radial-gradient confidence blobs
│   │       ├── PollinationEffect.tsx  ← Orbiting sparkle particles
│   │       ├── MissionPhaseOverlay.tsx ← Phase banners (all 13 phases)
│   │       ├── AnalysisHud.tsx        ← Bottom HUD strip
│   │       ├── FlowVectorOverlay.tsx  ← Optical flow vectors
│   │       └── OpticalFlowHud.tsx     ← Sensor metrics panel
│   ├── simulation/
│   │   ├── replayEngine.ts            ← useReplayEngine hook, RAF loop, seek
│   │   ├── liveInferenceEngine.ts     ← useLiveInferenceEngine hook, terminal buffer
│   │   ├── autonomousNavigator.ts     ← 13-phase state machine, TSP, proximity detection
│   │   ├── wsClient.ts                ← WebSocket client, auto-reconnect, send queue
│   │   ├── sensorInterpolation.ts     ← Smooth-step altitude lookup
│   │   └── opticalFlowModel.ts        ← Physics-based sensor degradation model
│   ├── data/
│   │   ├── missionGenerator.ts        ← 2700 deterministic ReplayFrames
│   │   ├── randomMissionGenerator.ts  ← Random garden + lawnmower path
│   │   └── opticalFlowDataset.ts      ← CSV parse + synthetic midpoints + merge
│   ├── models/
│   │   ├── types.ts                   ← All TypeScript interfaces + enums
│   │   └── index.ts                   ← Re-exports
│   └── styles/
│       └── globals.css                ← Tailwind + keyframe animations (of-*, rotor-spin, pulse)
├── drone-cv-system/
│   ├── server/
│   │   ├── inference_server.py        ← FastAPI WebSocket server, planning agent
│   │   ├── scene_renderer.py          ← PIL photorealistic 640×640 frame synthesis
│   │   ├── detection_bridge.py        ← ONNX / Mock dual-mode detection
│   │   └── generate_model.py          ← Downloads + exports YOLOv8n ONNX
│   ├── cv/
│   │   ├── flower_detector.py         ← YOLOv8n ONNX inference + NMS post-processing
│   │   ├── frame_preprocessor.py      ← Camera input normalization
│   │   ├── optical_flow_tracker.py    ← Lucas-Kanade sparse tracking + EMA smoothing
│   │   └── depth_estimator.py         ← Distance estimation from bbox + altitude
│   ├── pixhawk/
│   │   ├── mavlink_interface.py       ← pymavlink wrapper, background reader thread
│   │   └── flight_controller.py       ← Mission-level flight commands
│   └── mission/
│       ├── state_machine.py           ← Python 13-phase state machine (20 Hz)
│       └── pollination_manager.py     ← GPIO servo + motor, flower target tracking
├── raw_opticalflow_data.csv           ← Real sensor measurements (24 rows)
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```
