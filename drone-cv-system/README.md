# Pollinator Drone — CV / ML / Pixhawk System

Autonomous smart pollinator drone — real Python implementation for Raspberry Pi + Pixhawk.
Separate from the frontend simulation at `../drone-simulation/`.

---

## Architecture Overview

```
Camera (RPi Camera v2)
        │
        ▼
FramePreprocessor          Undistort, resize to 640×640
        │
        ▼
FlowerDetector             YOLOv8n ONNX @ ~10 FPS on RPi4
        │  detections
        ▼
OpticalFlowTracker         LK sparse flow, IoU matching, track IDs
        │  tracks
        ▼
DepthEstimator             Monocular size + rangefinder fusion
        │  3D positions
        ▼
StateMachine (20Hz)        13-phase mission logic
        │
        ├──► FlightController   goto_ned, precision_hover, velocity cmd
        │         │
        │         ▼
        │    MAVLinkInterface   SET_POSITION_TARGET, COMMAND_LONG
        │         │  serial/UDP
        │         ▼
        │      Pixhawk 4/6     ArduPilot/PX4 GUIDED mode
        │
        └──► PollinationManager  GPIO servo trigger (GPIO 18)
                  │
                  ▼
             SensorReader        Reads optical flow, rangefinder, EKF from Pixhawk telemetry
```

---

## Hardware

| Component | Part | Notes |
|-----------|------|-------|
| Companion computer | Raspberry Pi 4 (4GB) | Runs all CV/ML |
| Flight controller | Pixhawk 4 or 6 | ArduPilot or PX4 |
| Camera | RPi Camera Module v2 | Downward facing, calibrated |
| Optical flow | PX4FLOW or Holybro H-Flow | I2C to Pixhawk |
| Rangefinder | TFMini Plus or SF11/C | UART/I2C to Pixhawk |
| Pollination servo | Standard 5g servo | GPIO 18 PWM |
| UART cable | 4-wire JST | GPIO 14/15 to Pixhawk TELEM2 |

### Wiring

```
Raspberry Pi GPIO 14 (TX) ──► Pixhawk TELEM2 RX
Raspberry Pi GPIO 15 (RX) ◄── Pixhawk TELEM2 TX
Raspberry Pi GND          ──► Pixhawk GND
Raspberry Pi GPIO 18      ──► Servo signal wire

Pixhawk I2C SDA ◄──► PX4FLOW I2C SDA
Pixhawk I2C SCL ◄──► PX4FLOW I2C SCL
Pixhawk UART    ◄──► TFMini Plus UART (rangefinder)
```

### Pixhawk Parameters (PX4)

```
# Enable optical flow fusion in EKF2
EKF2_AID_MASK = 2          # Use optical flow (bit 1)
EKF2_OF_DELAY = 20         # Optical flow measurement delay (ms)
EKF2_HGT_MODE = 2          # Use rangefinder for altitude

# UART for RPi companion
SER_TEL2_BAUD = 921600
MAV_2_RATE = 0             # Send all messages
MAV_2_MODE = 2             # Normal mode

# Rangefinder
SENS_TFMINI_CFG = 102      # TELEM2 port for TFMini
```

---

## Setup

### 1. Install dependencies

On Raspberry Pi 4:
```bash
pip install -r requirements.txt

# PyTorch for RPi (CPU only)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

### 2. Enable UART on Raspberry Pi

Edit `/boot/config.txt`:
```
enable_uart=1
dtoverlay=disable-bt          # Disable Bluetooth to free UART
```

Edit `/boot/cmdline.txt` — remove `console=serial0,115200`

### 3. Prepare ML model

Option A — Download pre-trained base and fine-tune:
```python
from ml.model import FlowerDetectionModel

model = FlowerDetectionModel()
# Fine-tune on your flower dataset (train on laptop/desktop, not RPi)
model.train("ml/data/flowers/dataset.yaml", device="0")  # GPU
model.export_onnx()   # Export to ml/weights/flower_model.onnx
# Copy flower_model.onnx to RPi
```

Option B — Use base YOLOv8n without fine-tuning:
```bash
yolo export model=yolov8n.pt format=onnx simplify=True
cp yolov8n.onnx ml/weights/flower_model.onnx
# Update config/model_config.yaml classes to match COCO classes
```

### 4. Calibrate camera
```bash
# Print checkerboard: docs.opencv.org/4.x/da/d13/tutorial_aruco_calibration.html
# Capture 20+ images at different angles, then:
python -c "
import cv2, glob, numpy as np
# ... standard OpenCV camera calibration
# Update intrinsic_matrix in config/camera_config.yaml
"
```

### 5. SITL testing (before flying)

Install ArduPilot SITL or PX4 SITL on a computer, then:
```bash
# Terminal 1: Start SITL
sim_vehicle.py -v ArduCopter --out=udpin:localhost:14551

# Terminal 2: Run drone system in simulation mode
python -m mission.main --sim --display
```

### 6. First real flight

```bash
# Pre-flight: verify all checks pass
python -m mission.main --no-fly  # CV-only, no motors

# Full autonomous mission
python -m mission.main

# With debug display (requires monitor or VNC)
python -m mission.main --display
```

---

## CV Pipeline Detail

### Detection (`cv/flower_detector.py`)
- Model: YOLOv8n, fine-tuned for 3 classes: `flower_open`, `flower_closed`, `flower_cluster`
- Input: 640×640 RGB, normalized [0,1]
- Output: bounding boxes + confidence + class + camera bearing vector
- ONNX backend: ~10 FPS on RPi4 (vs ~4 FPS PyTorch)

### Tracking (`cv/optical_flow_tracker.py`)
- Lucas-Kanade sparse optical flow on corner keypoints of each bounding box
- Greedy IoU matching (Hungarian-style) between detections and existing tracks
- EMA smoothing on bounding box position (α=0.6)
- Tracks survive up to 10 missed frames (predictions using pure optical flow)

### Depth Estimation (`cv/depth_estimator.py`)
- Primary: monocular size — `D = (W_real × f) / W_pixel`
  - Known: flowers ~5cm wide; focal length from camera calibration
- Fusion: weighted average with rangefinder altitude
  - When flower fills >20% of frame width, monocular dominates
  - When flower is small/distant, rangefinder altitude is used directly
- Running scale correction factor updated each frame when rangefinder is valid

---

## State Machine Phases

| Phase | Description | Transitions |
|-------|-------------|-------------|
| `idle` | Waiting | → `arming` on start |
| `arming` | Pre-flight + motor arm | → `takeoff` |
| `takeoff` | Climb to 8m patrol altitude | → `transit` |
| `transit` | Fly to next waypoint | → `scanning` on arrival |
| `scanning` | Hover + scan (spiral pattern) | → `candidate_detected` @ conf ≥ 0.40 |
| `candidate_detected` | Building confidence | → `target_lock` @ conf ≥ 0.75 |
| `target_lock` | High confidence lock | → `descent` immediately |
| `descent` | Descend 8m → 1.5m | → `hover_align` |
| `hover_align` | Precision alignment | → `pollinating` when stable ≥1s |
| `pollinating` | Servo triggered, dwell 3s | → `ascent` |
| `ascent` | Climb back to 8m | → `resume_transit` or `mission_complete` |
| `resume_transit` | Fly to next waypoint | → `scanning` |
| `mission_complete` | RTH | — |

---

## File Structure

```
drone-cv-system/
├── requirements.txt
├── README.md
├── config/
│   ├── mission_config.yaml    — Altitudes, speeds, geofence, Pixhawk serial
│   ├── camera_config.yaml     — Calibration matrix, inference resolution
│   └── model_config.yaml      — YOLOv8 weights, class names, training params
├── cv/
│   ├── frame_preprocessor.py  — Camera capture + undistortion
│   ├── flower_detector.py     — YOLOv8/ONNX inference, Detection dataclass
│   ├── optical_flow_tracker.py— LK tracking, IoU matching, Track dataclass
│   └── depth_estimator.py     — Monocular + rangefinder depth fusion
├── ml/
│   ├── model.py               — FlowerDetectionModel: train, eval, ONNX export
│   └── dataset.py             — Dataset creation, Roboflow download, augmentation
├── pixhawk/
│   ├── mavlink_interface.py   — MAVLink connection, TelemetrySnapshot, receiver thread
│   ├── flight_controller.py   — arm, takeoff, goto_ned, precision_hover, land
│   └── sensor_reader.py       — Optical flow, rangefinder, EKF status read
├── mission/
│   ├── state_machine.py       — 13-phase StateMachine, Phase enum, MissionContext
│   ├── search_pattern.py      — Lawnmower, spiral, TSP waypoint ordering
│   ├── pollination_manager.py — Target queue, PollinationServo GPIO PWM
│   └── main.py                — Entry point, 20Hz pipeline loop
└── utils/
    └── logger.py              — loguru setup, TelemetryLogger CSV
```
