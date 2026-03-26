"""
Mission Main — Entry Point
--------------------------
Orchestrates the full autonomous pollination pipeline on Raspberry Pi.

Execution flow:
  1. Connect to Pixhawk via MAVLink (UART)
  2. Initialize camera and CV pipeline
  3. Load ML model (ONNX)
  4. Start mission state machine
  5. Run main loop at 20Hz:
      a. Grab camera frame
      b. Run YOLO detection
      c. Update optical flow tracker
      d. Estimate flower distances
      e. Tick state machine (controls flight)
      f. Log telemetry

Hardware checklist before running:
  □ Raspberry Pi 4 (4GB recommended) with RPi OS
  □ Pixhawk 4/6 connected via UART (GPIO 14/15) or USB
  □ RPi Camera Module v2 or HQ Camera (downward facing)
  □ PX4FLOW optical flow sensor on Pixhawk I2C
  □ Downward rangefinder (TFMini, SF10, or LightWare)
  □ Pollination servo on GPIO 18
  □ flower_model.onnx in ml/weights/
  □ All connections powered (separate 5V BEC for servo)

Safety: This script will attempt to FLY A DRONE.
  - Run in SITL simulation first (connection_string="udpin:localhost:14551")
  - Test all pre-flight checks pass before field use
  - Have a safety pilot with RC transmitter ready to override
  - Ensure geofence is configured in Pixhawk parameters

Run:
  python -m mission.main
  python -m mission.main --sim        # SITL simulation mode
  python -m mission.main --no-fly     # CV only, no flight commands
"""

from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import yaml
from loguru import logger

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from cv.flower_detector import FlowerDetector
from cv.frame_preprocessor import FramePreprocessor
from cv.optical_flow_tracker import OpticalFlowTracker
from cv.depth_estimator import DepthEstimator
from pixhawk.mavlink_interface import MAVLinkInterface
from pixhawk.flight_controller import FlightController
from pixhawk.sensor_reader import SensorReader
from mission.state_machine import StateMachine, Phase
from mission.pollination_manager import PollinationManager
from utils.logger import setup_logging, TelemetryLogger


# ──────────────────────────────────────────────────────────────────────
# Main Pipeline
# ──────────────────────────────────────────────────────────────────────

class PollinatorDronePipeline:
    """
    Top-level pipeline that connects all subsystems and runs the main loop.
    """

    LOOP_HZ = 20
    LOOP_PERIOD_S = 1.0 / LOOP_HZ

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self._running = False

        with open("config/mission_config.yaml") as f:
            self.config = yaml.safe_load(f)

        # Override connection string for SITL
        if args.sim:
            self.config["pixhawk"]["connection_string"] = "udpin:localhost:14551"
            self.config["pixhawk"]["baud_rate"] = 115200
            logger.info("SITL mode: connecting to udpin:localhost:14551")

        # Subsystems (initialized in start())
        self.preprocessor: Optional[FramePreprocessor] = None
        self.detector: Optional[FlowerDetector] = None
        self.tracker: Optional[OpticalFlowTracker] = None
        self.depth_est: Optional[DepthEstimator] = None
        self.mav: Optional[MAVLinkInterface] = None
        self.fc: Optional[FlightController] = None
        self.sensors: Optional[SensorReader] = None
        self.pollination_mgr: Optional[PollinationManager] = None
        self.state_machine: Optional[StateMachine] = None
        self.telem_logger: Optional[TelemetryLogger] = None

        # Register signal handlers for clean shutdown
        signal.signal(signal.SIGINT, self._handle_signal)
        signal.signal(signal.SIGTERM, self._handle_signal)

    # ------------------------------------------------------------------
    # Startup
    # ------------------------------------------------------------------

    def start(self) -> bool:
        """Initialize all subsystems. Returns False if anything fails."""
        logger.info("=" * 60)
        logger.info("  Pollinator Drone — Starting Up")
        logger.info("=" * 60)

        # 1. Camera
        if not self.args.no_camera:
            logger.info("Initializing camera...")
            self.preprocessor = FramePreprocessor("config/camera_config.yaml")
            if not self.preprocessor.open():
                logger.error("Camera initialization failed")
                return False

        # 2. CV Pipeline
        logger.info("Loading ML model...")
        self.detector = FlowerDetector("config/model_config.yaml", "config/camera_config.yaml")
        self.tracker = OpticalFlowTracker(iou_match_threshold=0.35)
        self.depth_est = DepthEstimator()

        # 3. Pixhawk
        if not self.args.no_fly:
            logger.info("Connecting to Pixhawk...")
            self.mav = MAVLinkInterface("config/mission_config.yaml")
            if not self.mav.connect():
                logger.error("MAVLink connection failed")
                return False
            if not self.mav.wait_heartbeat(timeout=10.0):
                logger.error("No Pixhawk heartbeat")
                return False

            self.fc = FlightController(self.mav, "config/mission_config.yaml")
            self.sensors = SensorReader(self.mav)
        else:
            logger.info("No-fly mode: skipping Pixhawk connection")

        # 4. Mission
        self.pollination_mgr = PollinationManager("config/mission_config.yaml")

        if not self.args.no_fly:
            self.state_machine = StateMachine(
                self.fc, self.sensors, self.pollination_mgr, self.config
            )

        # 5. Telemetry logging
        self.telem_logger = TelemetryLogger("logs/telemetry.csv")

        logger.info("All subsystems initialized — READY")
        return True

    # ------------------------------------------------------------------
    # Main Loop
    # ------------------------------------------------------------------

    def run(self):
        """Main 20Hz control loop."""
        if not self.start():
            logger.error("Startup failed — aborting")
            return

        self._running = True

        # Start mission
        if self.state_machine:
            self.state_machine.start()

        logger.info("Main loop running at 20Hz")
        loop_count = 0
        last_status_print = time.time()

        while self._running:
            t_loop_start = time.perf_counter()

            # ── 1. Capture frame ──────────────────────────────────────
            frame_bgr: Optional[np.ndarray] = None
            frame_rgb: Optional[np.ndarray] = None
            frame_gray: Optional[np.ndarray] = None

            if self.preprocessor is not None:
                ok, frame_bgr, frame_rgb = self.preprocessor.read_frame()
                if ok and frame_bgr is not None:
                    frame_gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

            # ── 2. Flower detection ───────────────────────────────────
            detections = []
            if self.detector is not None and frame_rgb is not None:
                detections = self.detector.detect(frame_rgb)

                # Estimate distance to each detection
                if self.sensors:
                    rf_alt = self.sensors.altitude_m()
                    yaw = self.mav.telemetry.yaw_deg if self.mav else 0.0
                    for det in detections:
                        self.depth_est.estimate(det, rf_alt, yaw)

            # ── 3. Optical flow tracking ──────────────────────────────
            tracks = []
            if self.tracker is not None and frame_gray is not None:
                tracks = self.tracker.update(frame_gray, detections)

            # ── 4. State machine tick ─────────────────────────────────
            current_phase = Phase.IDLE
            if self.state_machine is not None:
                current_phase = self.state_machine.tick(tracks)

            # ── 5. Telemetry logging ──────────────────────────────────
            if self.telem_logger and self.mav:
                self.telem_logger.log(self.mav.telemetry, current_phase, len(detections))

            # ── 6. Debug display (optional, disable on headless RPi) ──
            if self.args.display and frame_bgr is not None and self.detector:
                debug_frame = self.detector.draw_detections(frame_bgr, detections)
                self._draw_hud(debug_frame, current_phase, tracks)
                cv2.imshow("Pollinator Drone CV", debug_frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break

            # ── 7. Status print (1Hz) ─────────────────────────────────
            if time.time() - last_status_print >= 1.0:
                self._print_status(current_phase, detections, tracks)
                last_status_print = time.time()

            # ── 8. Check mission complete ─────────────────────────────
            if current_phase == Phase.MISSION_COMPLETE:
                logger.info("Mission complete — shutting down")
                break

            # ── 9. Loop rate control ──────────────────────────────────
            loop_elapsed = time.perf_counter() - t_loop_start
            sleep_time = self.LOOP_PERIOD_S - loop_elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)
            elif loop_elapsed > self.LOOP_PERIOD_S * 1.5:
                logger.warning(f"Loop overrun: {loop_elapsed*1000:.1f}ms (budget={self.LOOP_PERIOD_S*1000:.0f}ms)")

            loop_count += 1

        self.shutdown()

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    def shutdown(self):
        logger.info("Shutting down...")

        if self.mav and not self.args.no_fly:
            # Ensure drone is in a safe state before disconnecting
            if self.mav.telemetry.armed:
                logger.warning("Still armed on shutdown — commanding land")
                if self.fc:
                    self.fc.land()
            self.mav.close()

        if self.preprocessor:
            self.preprocessor.release()

        if self.pollination_mgr:
            summary = self.pollination_mgr.mission_summary()
            logger.info(f"Mission summary: {summary}")
            self.pollination_mgr.cleanup()

        if self.telem_logger:
            self.telem_logger.close()

        cv2.destroyAllWindows()
        logger.info("Shutdown complete")

    def _handle_signal(self, signum, frame):
        logger.warning(f"Signal {signum} received — initiating shutdown")
        self._running = False

    # ------------------------------------------------------------------
    # Debug Helpers
    # ------------------------------------------------------------------

    def _draw_hud(self, frame: np.ndarray, phase: Phase, tracks):
        """Draw mission HUD overlay on debug frame."""
        h, w = frame.shape[:2]

        # Phase
        cv2.putText(frame, f"Phase: {phase.value}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 200), 2)

        # Altitude
        if self.sensors:
            alt = self.sensors.altitude_m()
            cv2.putText(frame, f"Alt: {alt:.2f}m", (10, 60),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 255), 1)

        # Track count
        cv2.putText(frame, f"Tracks: {len(tracks)}", (10, 85),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 255, 200), 1)

        # Confidence
        if self.state_machine:
            conf = self.state_machine.ctx.detection_confidence
            bar_w = int(conf * 200)
            cv2.rectangle(frame, (10, h - 30), (210, h - 10), (50, 50, 50), -1)
            cv2.rectangle(frame, (10, h - 30), (10 + bar_w, h - 10), (0, 255, 100), -1)
            cv2.putText(frame, f"Conf: {conf:.2f}", (215, h - 12),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 100), 1)

    def _print_status(self, phase: Phase, detections, tracks):
        det_str = f"{len(detections)} det / {len(tracks)} tracks"
        if self.sensors:
            self.sensors.print_status()
        else:
            logger.info(f"[{phase.value}] {det_str}")


# ──────────────────────────────────────────────────────────────────────
# CLI Entry Point
# ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Pollinator Drone Autonomous Mission")
    p.add_argument("--sim", action="store_true",
                   help="SITL simulation mode (UDP connection)")
    p.add_argument("--no-fly", action="store_true",
                   help="CV-only mode — no flight commands sent")
    p.add_argument("--no-camera", action="store_true",
                   help="Skip camera (use dummy frames)")
    p.add_argument("--display", action="store_true",
                   help="Show debug CV window (requires display)")
    p.add_argument("--log-level", default="INFO",
                   choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    setup_logging(args.log_level)

    pipeline = PollinatorDronePipeline(args)
    pipeline.run()
