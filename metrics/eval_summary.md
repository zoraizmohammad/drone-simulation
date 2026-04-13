# Poster Evaluation Summary — Autonomous Pollination UAV
**Generated:** 2026-04-13  
**Audit method:** Direct source-file extraction from repository. No values were invented.  
**Critical caveat:** Latency figures are design targets from README/config files, not saved benchmark outputs. Mission success metrics are from deterministic simulation, not physical flights. Hardware is implemented in code but no flight logs exist in this repo.

---

# 1. Evidence Inventory

| Metric / Capability | Value or Finding | Evidence Source | Confidence | Notes |
|---|---|---|---|---|
| Garden arena | 20m × 20m | `mission_config.yaml:3` | High | Config |
| Total flower clusters | 10 (8 targeted, 2 bystander) | `missionGenerator.ts` | High | Simulation |
| Mission success (simulation) | 8/8 pollinated | `missionGenerator.ts` + `replayEngine.ts` | High | **Sim only** |
| Mission phases implemented | 13 phases | `state_machine.py`, `missionGenerator.ts` | High | Code |
| Total replay frames | 2700 (90s @ 30fps) | `missionGenerator.ts` | High | Simulation |
| Candidate detection threshold | 0.40 | `state_machine.py:126`, `inference_server.py:127` | High | Code |
| Target lock threshold | 0.75 | `state_machine.py:129`, `mission_config.yaml:9` | High | Code + Config |
| Pollination dwell time | 3.0 s | `mission_config.yaml:10` | High | Config |
| Patrol altitude | 8.0 m | `mission_config.yaml:4` | High | Config |
| Hover altitude (pollination) | 1.5 m | `mission_config.yaml:5` | High | Config |
| Hover band tolerance | ±0.3 m | `mission_config.yaml:6` | High | Config |
| Proximity detection radius | 4.5 m | `autonomousNavigator.ts` | High | Code |
| Hardware loop rate | 20 Hz | `state_machine.py` (sleep 0.05s) | High | Code |
| Simulation fps | 30 fps | `missionGenerator.ts` | High | Code |
| Real optical flow data rows | 24 measurements | `raw_opticalflow_data.csv` | High | **Real data** |
| Sensor altitude coverage | 0–7.01 m | `raw_opticalflow_data.csv` | High | **Real data** |
| Peak sensor quality altitude | ~3.05 m (150 quality) | `raw_opticalflow_data.csv:12` | High | **Real data** |
| YOLOv8 model | YOLOv8n (nano), 3 classes | `model_config.yaml` | High | Config |
| Detection input resolution | 640×640 px | `model_config.yaml`, `camera_config.yaml` | High | Config |
| NMS IoU threshold | 0.45 | `camera_config.yaml` | High | Config |
| Detection confidence threshold | 0.35 | `camera_config.yaml` | High | Config |
| UCB1 bandit arms | [0.40, 0.60, 0.75] | `confidence_bandit.py:17` | High | Code |
| LLM planning tools | 4 tools | `agent_server.py` | High | Code |
| Max agent tool rounds | 3 | `agent_server.py` | High | Code |
| RAG retrieval k | 3 past missions | `mission_store.py` | High | Code |
| Agent debounce | 200 ms | `agentClient.ts` | High | Code |
| Coral TPU latency | ~5 ms (design target) | `README.md` | **Low** | Target, not measured |
| ONNX latency on RPi4 | ~30 ms (design target) | `README.md` | **Low** | Target, not measured |
| Mock detector latency | <1 ms (structural) | `detection_bridge.py` | Medium | Inferred |
| Servo deploy pulse | ~1700 µs, 50 Hz | `pollination_manager.py` | High | Code, not hw-tested |
| Pixhawk UART baud | 921600 | `mission_config.yaml:27` | High | Config |
| MAVLink message types | 7 types | `mavlink_interface.py` | High | Code |
| Max horizontal speed | 3.0 m/s | `mission_config.yaml:18` | High | Config |
| Battery failsafe | 20% | `mission_config.yaml:21` | High | Config |
| Geofence radius | 15.0 m | `mission_config.yaml:22` | High | Config |

---

# 2. Quantitative Metrics

## Mission Execution
| Metric | Value | Unit | Source |
|---|---|---|---|
| Arena size | 20 × 20 | m | `mission_config.yaml` |
| Patrol altitude | 8.0 | m | `mission_config.yaml` |
| Pollination hover altitude | 1.5 | m | `mission_config.yaml` |
| Hover band tolerance | ±0.3 | m | `mission_config.yaml` |
| Mission duration (simulation) | 90 | seconds | `missionGenerator.ts` |
| Max speed | 3.0 | m/s | `mission_config.yaml` |
| Max descent rate | 0.8 | m/s | `mission_config.yaml` |
| Battery failsafe threshold | 20 | % | `mission_config.yaml` |
| Geofence radius | 15.0 | m | `mission_config.yaml` |
| Pollination dwell | 3.0 | s | `mission_config.yaml` |

## Detection / Pollination
| Metric | Value | Unit | Source |
|---|---|---|---|
| Flower clusters in garden | 10 | clusters | `missionGenerator.ts` |
| Clusters targeted | 8 | clusters | `mission_config.yaml`, `missionGenerator.ts` |
| Simulation success | 8/8 | pollinated | `missionGenerator.ts` (deterministic) |
| Candidate confidence threshold | 0.40 | — | `state_machine.py:126` |
| Target lock threshold | 0.75 | — | `state_machine.py:129` |
| Detection confidence threshold | 0.35 | — | `camera_config.yaml` |
| NMS IoU threshold | 0.45 | — | `camera_config.yaml` |
| Proximity detection radius | 4.5 | m | `autonomousNavigator.ts` |

## Planning
| Metric | Value | Unit | Source |
|---|---|---|---|
| TSP algorithm | Greedy nearest-neighbor | — | `autonomousNavigator.ts`, `agent_server.py` |
| Scan overlap | 30 | % | `mission_config.yaml` |
| UCB1 bandit arms | [0.40, 0.60, 0.75] | thresholds | `confidence_bandit.py:17` |
| RAG retrieval k | 3 | past missions | `mission_store.py` |
| LLM tools | 4 | tools | `agent_server.py` |
| Max tool-calling rounds | 3 | rounds | `agent_server.py` |

## Latency / Performance
| Metric | Value | Unit | Support | Source |
|---|---|---|---|---|
| Coral TPU latency | ~5 | ms | **Low (design target)** | `README.md` |
| ONNX latency (RPi4) | ~30 | ms | **Low (design target)** | `README.md` |
| Mock detector latency | <1 | ms | Medium (structural) | `detection_bridge.py` |
| Hardware mission loop | 20 | Hz | High | `state_machine.py` |
| Simulation frame rate | 30 | fps | High | `missionGenerator.ts` |
| Agent debounce | 200 | ms | High | `agentClient.ts` |
| Agent call frequency | 1 | Hz | High | `agentClient.ts` |
| Terminal buffer drain | 100 | ms | High | `agent_server.py:27` |

## Hardware Validation
| Metric | Value | Unit | Source |
|---|---|---|---|
| Pixhawk UART baud | 921600 | baud | `mission_config.yaml` |
| MAVLink message types | 7 | types | `mavlink_interface.py` |
| Heartbeat timeout | 3 | s | `mavlink_interface.py` |
| Servo PWM frequency | 50 | Hz | `pollination_manager.py` |
| Servo deploy pulse | ~1700 | µs | `pollination_manager.py` |
| Coral TPU throughput | ~4 | TOPS INT8 | Manufacturer spec |
| Real optical flow data | 24 rows | measurements | `raw_opticalflow_data.csv` |
| Sensor altitude coverage | 0–7.01 | m | `raw_opticalflow_data.csv` |

---

# 3. Supported Qualitative Claims

1. A full 13-phase autonomous mission FSM is implemented in both the browser simulation and the Raspberry Pi hardware pipeline, sharing identical phase names, transition conditions, and confidence thresholds.
2. The simulation replays a deterministic 90-second, 2700-frame mission visiting 8 flower clusters across a 20m × 20m garden.
3. A three-tier detection hierarchy (Coral TPU → ONNX → physics-based mock) provides hardware-independent inference with automatic fallback.
4. A Claude Haiku LLM agent equipped with four mission-planning tools (TSP routing, battery estimation, scan-pattern generation, adaptive confidence thresholds) issues replanning decisions at 1 Hz.
5. A UCB1 multi-armed bandit adaptively selects confidence thresholds from {0.40, 0.60, 0.75} based on accumulated detection reward history.
6. Mission memory is persisted in a Chroma vector store and retrieved via RAG (top-3 similarity) to inform future planning decisions.
7. Optical flow sensor simulation is grounded in 24 real hardware measurements spanning 0–7.01 m altitude, with a smooth-step interpolation engine.
8. Pixhawk telemetry integration handles seven MAVLink message types over a 921,600-baud UART link with a 3-second heartbeat watchdog.
9. Servo-based pollination actuation is implemented using 50 Hz GPIO PWM (deploy: ~1700 µs, stow: ~1000 µs) with a 3-second dwell time.
10. Battery and geofence failsafes are implemented: RTH triggered at 20% battery or 15 m geofence violation.

---

# 4. Unsupported or Weakly Supported Claims

**Do NOT use these on the poster without further evidence:**

| Claim | Problem |
|---|---|
| "5ms Coral TPU latency" as a measured result | Design target only — `benchmark_rpi()` in `ml/model.py` exists but no saved output in repo |
| "30ms ONNX inference latency" as a measured result | Same — README design target, no benchmark log |
| "8/8 pollination success rate" as a real-world result | Deterministic simulation only — no physical flight log |
| Any mAP or accuracy numbers for flower detection | No training run artifacts, no evaluation results in repo |
| "15–30 FPS" Coral throughput | Manufacturer spec / README — not measured on this hardware |
| Real-world GPS/EKF fusion performance | SITL path documented, no outdoor telemetry logs |
| Physical servo pollination success rate | No hardware test log |
| Sim-to-real transfer accuracy | Code mirroring demonstrated, not validated empirically |

---

# 5. Best Poster-Ready Evaluation Content

## Bullet Points

- **Full 13-phase autonomous mission** implemented end-to-end: arming → takeoff → scanning → detection → descent → hover alignment → pollination → ascent → transit → mission complete.
- **8 flower clusters** successfully visited in a deterministic 90-second simulation across a 20m × 20m garden arena; candidate detection at conf ≥ 0.40, target lock at conf ≥ 0.75.
- **Three-tier inference pipeline** (Coral TPU → YOLOv8n ONNX → physics-based mock) provides hardware-independent detection with automatic degradation fallback.
- **LLM mission agent** (Claude Haiku via LangChain) replans routes and adjusts confidence thresholds at 1 Hz using a UCB1 bandit; past missions persist via RAG in a Chroma vector store.
- **Optical flow simulation grounded in 24 real sensor measurements** (0–7.01 m altitude); confidence-quality coupling models real sensor degradation with altitude.
- **Full hardware stack implemented**: Pixhawk MAVLink telemetry (7 message types, 921600 baud), Raspberry Pi 4 companion, downward camera, 50 Hz servo pollination actuation, 3-second heartbeat watchdog.

## Demo Evidence Paragraph

> The system was demonstrated as a synchronized, multi-panel mission-control dashboard replaying a 90-second, 2700-frame autonomous flight over a 20m × 20m garden. The simulation — driven by a deterministic frame-based engine at 30 fps — executes a full 13-phase mission state machine, visiting 8 of 10 flower clusters with a 3-second pollination dwell at each target. Optical flow telemetry is grounded in 24 real hardware measurements and coupled to the detection confidence model. A live LLM planning agent (Claude Haiku) replans TSP routes and dynamically adjusts detection thresholds via a UCB1 bandit at 1 Hz, with mission memory persisted in a Chroma RAG store. The full Raspberry Pi + Pixhawk hardware pipeline (MAVLink, servo actuation, YOLOv8n/Coral TPU inference) is implemented in Python and shares state-machine logic with the browser simulation.

## Demonstrated Capabilities Fallback Subsection

**Demonstrated via simulation and code:**
- Autonomous multi-target route planning using greedy nearest-neighbor TSP with dynamic replanning on new flower discovery
- Phase-conditioned confidence thresholds with UCB1 adaptive selection
- Distance-driven optical flow sensor model with real measurement grounding
- LLM-in-the-loop mission replanning with RAG-augmented context
- Three-tier inference fallback: Coral TPU → ONNX → mock detector

**Implemented in hardware code (not yet flight-logged):**
- MAVLink telemetry parsing (7 message types) with heartbeat watchdog
- Pixhawk flight commands: arm, takeoff, goto_ned, precision_hover, land
- Servo-based pollination actuation via GPIO PWM
- Mission failsafes: battery RTH at 20%, geofence at 15m

---

# 6. Suggested Figures / Tables

All of the following can be built from existing repository data:

| Figure | Description | Data Source |
|---|---|---|
| **Mission phase timeline** | Gantt/timeline of 13 phases with start times, durations, and thresholds | `missionGenerator.ts` phase timestamps |
| **Detection confidence ramp** | Line chart: confidence vs. frame index through scan → candidate → lock → pollinating for one cluster | `missionGenerator.ts` frame data |
| **Inference hierarchy diagram** | 3-tier fallback: Coral (~5ms†) → ONNX (~30ms†) → Mock (<1ms) with latency bars | `detection_bridge.py` + README targets |
| **Optical flow quality vs. altitude** | Line chart: strength, quality, stability vs. altitude (m) using real CSV rows | `raw_opticalflow_data.csv` (24 rows) |
| **Sensor degradation curve** | Strength 255→18 and quality 10→50 over 0–7m, with degradation thresholds marked | `raw_opticalflow_data.csv` |
| **TSP route map** | Top-down 20m × 20m garden showing drone path connecting 8 waypoints from home base | `missionGenerator.ts` waypoints |
| **Hardware validation checklist** | Table: component / implemented / bench-tested / flight-tested status | Code audit |
| **UCB1 arm selection** | Bar or table showing three confidence arms and selection criteria | `confidence_bandit.py` |

*† Mark as design target, not measured result.*

---

# 7. Missing Metrics to Compute Next

High-value additions that require minimal extra instrumentation:

| Missing Metric | How to get it | Effort |
|---|---|---|
| **Actual Coral TPU latency** | Run `python -m ml.model benchmark_rpi --n 100` on RPi4, save output | Low — function already exists in `ml/model.py:190` |
| **Actual ONNX latency on RPi4** | Same `benchmark_rpi()` function, ONNX path | Low — already instrumented |
| **Agent decision latency distribution** | Run agent server, call `/decide` 20 times, check `/metrics` endpoint | Low — `_decision_times` deque already captured |
| **mAP / detection accuracy** | Run YOLOv8 `val` on a labeled test set (Oxford Flowers or custom Roboflow dataset) | Medium — requires labeled dataset |
| **Flower detection recall by class** | Same evaluation run, per-class breakdown (open/closed/cluster) | Medium — same val run |
| **Physical servo characterization** | Oscilloscope or logic analyzer on GPIO 18, measure actual pulse widths and response time | Low hardware effort |
| **SITL flight log** | Run `python -m mission.main` with ArduPilot SITL, save MAVLink DataFlash log | Medium — SITL path already documented |
| **End-to-end replanning latency** | Time from new flower discovery event to updated waypoint issued, logged across 10 trials | Low — add one perf_counter in `autonomousNavigator.ts` |
