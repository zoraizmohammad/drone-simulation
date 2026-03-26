"""
Pollination Manager
-------------------
Tracks which flowers have been visited, manages the pollen-dispenser servo
mechanism, and maintains the target queue.

Physical pollination mechanism:
  Micro servo arm actuates a lightweight pollen-dispenser assembly mounted
  below the drone frame. On trigger, the servo rotates the arm to the flower
  and holds for the dwell time, then retracts to the stowed position.

Preferred control path — Pixhawk AUX OUT 1 via MAVLink (Option A):
  Signal: Pixhawk AUX OUT 1 → Servo signal wire (orange/white)
  Power:  Dedicated 5V BEC  → Servo power (red)  [NOT the RPi 5V pin]
  Ground: Common GND        → Servo ground (brown/black)
  Command: FlightController.trigger_aux_servo() → MAVLink DO_SET_SERVO
  Advantage: Hardware PWM timing, DataFlash logged, failsafe-retract if
             companion computer drops out.
  ArduCopter param required: SERVO9_FUNCTION = 0  (AUX OUT 1 passthrough)

Fallback path — RPi GPIO direct PWM (Option B):
  Signal: RPi GPIO 18 (PWM0) → Servo signal wire
  Power:  Dedicated 5V BEC   → Servo power  (still NOT the RPi 5V pin)
  Ground: Common GND         → Servo ground
  Used automatically when no MAVLink interface is supplied.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, List, Optional

from loguru import logger

from mission.search_pattern import Waypoint, GARDEN_FLOWER_CLUSTERS, SearchPatternGenerator

if TYPE_CHECKING:
    from pixhawk.flight_controller import FlightController

try:
    import RPi.GPIO as GPIO
    GPIO_AVAILABLE = True
except (ImportError, RuntimeError):
    GPIO_AVAILABLE = False
    logger.warning("RPi.GPIO not available — GPIO servo path will be simulated")


@dataclass
class FlowerTarget:
    """A flower cluster target with visit status."""
    waypoint: Waypoint
    cluster_id: str
    visited: bool = False
    pollinated: bool = False
    visit_attempts: int = 0
    pollination_confidence: float = 0.0
    timestamp_visited: Optional[float] = None

    @property
    def name(self) -> str:
        return self.waypoint.name


class PollinationServo:
    """
    Controls the pollen-dispenser servo.

    Primary path — Pixhawk AUX OUT 1 via MAVLink DO_SET_SERVO:
      Pass a FlightController instance to __init__ to enable this path.
      The servo is driven by the Pixhawk hardware PWM timer; commands are
      logged in DataFlash and are failsafe-aware.

    Fallback path — RPi GPIO direct PWM:
      Used when no FlightController is supplied (bench testing / no Pixhawk).
      50 Hz PWM on GPIO 18; timing depends on Linux scheduler (±1–2 ms jitter).

    Standard servo PWM:
      1000 µs = 0°   (fully retracted / stowed)
      1500 µs = 90°  (mid-point)
      1700 µs = ~135° (deployed — dispenser arm contacts flower zone)
      2000 µs = 180° (full travel, not normally used)
    """

    # --- MAVLink AUX path constants ---
    AUX_CHANNEL = 1           # AUX OUT 1 on Pixhawk 2.4.8
    RETRACTED_US = 1000       # 0° — stowed
    DEPLOYED_US  = 1700       # ~135° — dispenser arm deployed

    # --- GPIO fallback path constants ---
    GPIO_PIN     = 18         # BCM GPIO 18 (hardware PWM0)
    PWM_FREQ_HZ  = 50
    RETRACTED_DUTY = 5.0      # 1.0 ms / 20 ms = 5%
    DEPLOYED_DUTY  = 8.5      # 1.7 ms / 20 ms = 8.5%

    def __init__(self, flight_controller: Optional['FlightController'] = None):
        self._fc = flight_controller
        self._pwm = None
        self._deployed = False

        if self._fc is not None:
            logger.info("Pollination servo: MAVLink AUX OUT 1 path active (Pixhawk 2.4.8)")
            # Ensure servo starts in retracted position
            self._fc.mav.set_aux_servo(self.AUX_CHANNEL, self.RETRACTED_US)
        elif GPIO_AVAILABLE:
            GPIO.setmode(GPIO.BCM)
            GPIO.setup(self.GPIO_PIN, GPIO.OUT)
            self._pwm = GPIO.PWM(self.GPIO_PIN, self.PWM_FREQ_HZ)
            self._pwm.start(self.RETRACTED_DUTY)
            logger.info(f"Pollination servo: GPIO fallback on pin {self.GPIO_PIN}")
        else:
            logger.info("Pollination servo: SIMULATION MODE (no hardware)")

    def deploy(self, hold_seconds: float = 2.5):
        """Extend dispenser arm to the flower zone, dwell, then retract."""
        logger.info(f"Servo DEPLOY — hold {hold_seconds}s")
        self._actuate(deployed=True)
        self._deployed = True
        time.sleep(hold_seconds)
        self.retract()

    def retract(self):
        """Return dispenser arm to stowed position."""
        logger.info("Servo RETRACT")
        self._actuate(deployed=False)
        self._deployed = False

    def pulse(self, pulses: int = 3, pulse_duration_s: float = 0.4):
        """Pulse the dispenser arm for better pollen distribution."""
        for i in range(pulses):
            logger.debug(f"Servo pulse {i+1}/{pulses}")
            self._actuate(deployed=True)
            time.sleep(pulse_duration_s)
            self._actuate(deployed=False)
            time.sleep(pulse_duration_s * 0.5)

    def cleanup(self):
        if self._pwm:
            self._pwm.stop()
        if GPIO_AVAILABLE and self._fc is None:
            GPIO.cleanup(self.GPIO_PIN)

    def _actuate(self, deployed: bool):
        if self._fc is not None:
            # Primary: Pixhawk AUX OUT via MAVLink
            pwm = self.DEPLOYED_US if deployed else self.RETRACTED_US
            self._fc.mav.set_aux_servo(self.AUX_CHANNEL, pwm)
        elif self._pwm is not None:
            # Fallback: GPIO PWM
            duty = self.DEPLOYED_DUTY if deployed else self.RETRACTED_DUTY
            self._pwm.ChangeDutyCycle(duty)
        else:
            state = "DEPLOYED" if deployed else "RETRACTED"
            logger.debug(f"[SIM] Servo → {state}")

    def __del__(self):
        try:
            self.cleanup()
        except Exception:
            pass


class PollinationManager:
    """
    Manages the full pollination target queue and servo actuation.

    Usage:
        mgr = PollinationManager()
        queue = mgr.get_waypoint_queue()
        # ... fly to each waypoint ...
        mgr.trigger_pollination_servo()
        mgr.mark_pollinated(target)
    """

    def __init__(
        self,
        config_path: str = "config/mission_config.yaml",
        flight_controller: Optional['FlightController'] = None,
    ):
        import yaml
        with open(config_path) as f:
            self.config = yaml.safe_load(f)

        # Pass flight_controller so servo uses MAVLink AUX OUT 1 (preferred)
        # when running on the real drone; falls back to GPIO when fc=None
        self._servo = PollinationServo(flight_controller=flight_controller)
        self._targets: List[FlowerTarget] = []
        self._pattern_gen = SearchPatternGenerator(config_path)
        self._build_target_list()

        logger.info(f"PollinationManager: {len(self._targets)} targets")

    def _build_target_list(self):
        """Build ordered target list from known garden clusters."""
        home = self.config["mission"]["home_position"]
        waypoints = self._pattern_gen.from_cluster_positions(
            clusters=GARDEN_FLOWER_CLUSTERS[:self.config["mission"]["max_targets"]],
            home_north=0.0,
            home_east=0.0,
        )
        self._targets = [
            FlowerTarget(
                waypoint=wp,
                cluster_id=wp.cluster_id or wp.name,
            )
            for wp in waypoints
        ]

    def get_waypoint_queue(self) -> List[dict]:
        """Return list of waypoint dicts for the state machine."""
        return [
            {
                "name": t.name,
                "north_m": t.waypoint.north_m,
                "east_m": t.waypoint.east_m,
                "cluster_id": t.cluster_id,
            }
            for t in self._targets
            if not t.visited
        ]

    def get_next_target(self) -> Optional[FlowerTarget]:
        """Return next unvisited target."""
        for t in self._targets:
            if not t.visited:
                return t
        return None

    def trigger_pollination_servo(self):
        """
        Actuate the pollination mechanism.
        Uses pulse pattern: 3 pulses for better pollen transfer.
        """
        logger.info("POLLINATION: triggering servo")
        self._servo.pulse(pulses=3, pulse_duration_s=0.4)

    def mark_visited(self, target: FlowerTarget):
        target.visited = True
        target.visit_attempts += 1
        target.timestamp_visited = time.time()
        logger.info(f"Marked visited: {target.name}")

    def mark_pollinated(self, target: FlowerTarget, confidence: float):
        target.pollinated = True
        target.pollination_confidence = confidence
        self.mark_visited(target)
        logger.info(f"Marked pollinated: {target.name} (conf={confidence:.2f})")

    def mission_summary(self) -> dict:
        total = len(self._targets)
        pollinated = sum(1 for t in self._targets if t.pollinated)
        visited = sum(1 for t in self._targets if t.visited)
        return {
            "total_targets": total,
            "visited": visited,
            "pollinated": pollinated,
            "success_rate": pollinated / total if total > 0 else 0.0,
            "targets": [
                {
                    "name": t.name,
                    "visited": t.visited,
                    "pollinated": t.pollinated,
                    "confidence": t.pollination_confidence,
                }
                for t in self._targets
            ],
        }

    def cleanup(self):
        self._servo.cleanup()
