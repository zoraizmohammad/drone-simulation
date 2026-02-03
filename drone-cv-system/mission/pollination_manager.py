"""
Pollination Manager
-------------------
Tracks which flowers have been visited, manages the pollination servo/brush
mechanism, and maintains the target queue.

Physical pollination mechanism options:
  Option A: Servo-actuated brush — a small rotating brush mounted below the
            drone extends on a servo when triggered. The brush physically
            contacts the flower stamen. Simple, reliable, ~20g.

  Option B: Air puff — a small air pump creates a puff of air through a nozzle,
            displacing pollen. No contact needed, works from ~5cm.

  Option C: Electrostatic — charged bristles attract pollen electrostatically.

This module uses Raspberry Pi GPIO to trigger whichever mechanism is wired up.
Default: GPIO PWM servo signal on pin 18.

Wiring (Option A — servo):
  RPi GPIO 18 (PWM0) → Servo signal wire (orange)
  RPi 5V             → Servo power (red)
  RPi GND            → Servo ground (brown/black)
  Servo horn angle 0°  = retracted (safe position)
  Servo horn angle 90° = deployed (brush contacts flower)
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import List, Optional

from loguru import logger

from mission.search_pattern import Waypoint, GARDEN_FLOWER_CLUSTERS, SearchPatternGenerator

try:
    import RPi.GPIO as GPIO
    GPIO_AVAILABLE = True
except (ImportError, RuntimeError):
    GPIO_AVAILABLE = False
    logger.warning("RPi.GPIO not available — servo commands will be simulated")


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
    Controls the pollination actuator via Raspberry Pi GPIO PWM.

    PWM servo control:
      50Hz signal (standard servo frequency)
      1.0ms pulse = 0° (retracted)
      1.5ms pulse = 90° (halfway)
      2.0ms pulse = 180° (fully deployed)

    Duty cycle = pulse_width_ms / period_ms * 100
      At 50Hz: period = 20ms
      1.0ms → duty = 5.0%
      1.5ms → duty = 7.5%
      2.0ms → duty = 10.0%
    """

    GPIO_PIN = 18
    PWM_FREQ_HZ = 50

    RETRACTED_DUTY = 5.0     # 1.0ms pulse — brush retracted
    DEPLOYED_DUTY = 8.5      # 1.7ms pulse — brush extended to flower
    SPIN_DUTY = 7.5          # 1.5ms — spin position (for rotating brush)

    def __init__(self):
        self._pwm = None
        self._deployed = False
        if GPIO_AVAILABLE:
            GPIO.setmode(GPIO.BCM)
            GPIO.setup(self.GPIO_PIN, GPIO.OUT)
            self._pwm = GPIO.PWM(self.GPIO_PIN, self.PWM_FREQ_HZ)
            self._pwm.start(self.RETRACTED_DUTY)
            logger.info(f"Pollination servo initialized on GPIO {self.GPIO_PIN}")
        else:
            logger.info("Pollination servo: SIMULATION MODE")

    def deploy(self, hold_seconds: float = 2.0):
        """
        Extend the brush to contact the flower.
        Holds in contact for hold_seconds, then retracts.
        """
        logger.info(f"Servo DEPLOY — hold {hold_seconds}s")
        self._set_duty(self.DEPLOYED_DUTY)
        self._deployed = True
        time.sleep(hold_seconds)
        self.retract()

    def retract(self):
        """Retract the brush to safe position."""
        logger.info("Servo RETRACT")
        self._set_duty(self.RETRACTED_DUTY)
        self._deployed = False

    def pulse(self, pulses: int = 3, pulse_duration_s: float = 0.3):
        """
        Pulse the brush in/out multiple times for better pollen transfer.
        """
        for i in range(pulses):
            logger.debug(f"Servo pulse {i+1}/{pulses}")
            self._set_duty(self.DEPLOYED_DUTY)
            time.sleep(pulse_duration_s)
            self._set_duty(self.RETRACTED_DUTY)
            time.sleep(pulse_duration_s * 0.5)

    def cleanup(self):
        if self._pwm:
            self._pwm.stop()
        if GPIO_AVAILABLE:
            GPIO.cleanup(self.GPIO_PIN)

    def _set_duty(self, duty: float):
        if self._pwm:
            self._pwm.ChangeDutyCycle(duty)
        else:
            logger.debug(f"[SIM] Servo duty cycle: {duty:.1f}%")

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

    def __init__(self, config_path: str = "config/mission_config.yaml"):
        import yaml
        with open(config_path) as f:
            self.config = yaml.safe_load(f)

        self._servo = PollinationServo()
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
