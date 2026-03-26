"""
Mission State Machine
---------------------
Implements the 13-phase autonomous pollination mission.
Each state has:
  - An entry action (run once on entering the state)
  - A tick action (run each loop iteration while in state)
  - Transition conditions to next states
  - Timeout fallback

States mirror the frontend simulation exactly:
  idle → arming → takeoff → transit → scanning → candidate_detected →
  target_lock → descent → hover_align → pollinating → ascent →
  resume_transit → mission_complete

The StateMachine does NOT own the flight controller or CV — those are
injected so they can be mocked for testing.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Callable, Dict, List, Optional, TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from mission.pollination_manager import PollinationManager, FlowerTarget
    from pixhawk.flight_controller import FlightController
    from pixhawk.sensor_reader import SensorReader
    from cv.flower_detector import Detection
    from cv.optical_flow_tracker import Track


class Phase(str, Enum):
    IDLE              = "idle"
    ARMING            = "arming"
    TAKEOFF           = "takeoff"
    TRANSIT           = "transit"
    SCANNING          = "scanning"
    CANDIDATE_DETECTED = "candidate_detected"
    TARGET_LOCK       = "target_lock"
    DESCENT           = "descent"
    HOVER_ALIGN       = "hover_align"
    POLLINATING       = "pollinating"
    ASCENT            = "ascent"
    RESUME_TRANSIT    = "resume_transit"
    MISSION_COMPLETE  = "mission_complete"
    ABORT             = "abort"


@dataclass
class MissionContext:
    """
    Shared state passed to all state handlers.
    Mutated by states to communicate across transitions.
    """

    # Current target
    current_target: Optional["FlowerTarget"] = None
    current_detections: List["Track"] = field(default_factory=list)

    # Detection confidence accumulator (rises as drone confirms target)
    detection_confidence: float = 0.0
    confidence_history: List[float] = field(default_factory=list)

    # Waypoints remaining to visit
    waypoints_remaining: List[dict] = field(default_factory=list)

    # Completed targets
    completed_targets: List["FlowerTarget"] = field(default_factory=list)

    # Timing
    phase_entry_time: float = field(default_factory=time.time)
    hover_start_time: Optional[float] = None

    # Position of locked target in NED frame
    target_ned: Optional[tuple] = None   # (north_m, east_m)

    # Events log
    events: List[str] = field(default_factory=list)

    def log_event(self, msg: str):
        ts = time.strftime("%H:%M:%S")
        entry = f"[{ts}] {msg}"
        self.events.append(entry)
        if len(self.events) > 100:
            self.events.pop(0)
        logger.info(f"EVENT: {msg}")

    def phase_elapsed(self) -> float:
        return time.time() - self.phase_entry_time


@dataclass
class StateTransition:
    """Result returned by a state's tick function."""
    next_phase: Optional[Phase] = None
    reason: str = ""

    @classmethod
    def stay(cls) -> "StateTransition":
        return cls(next_phase=None)

    @classmethod
    def goto(cls, phase: Phase, reason: str = "") -> "StateTransition":
        return cls(next_phase=phase, reason=reason)


class StateMachine:
    """
    Autonomous pollination mission state machine.

    Usage:
        sm = StateMachine(flight_ctrl, sensor_reader, pollination_mgr, config)
        sm.start()
        while sm.phase != Phase.MISSION_COMPLETE:
            tracks = cv_pipeline.get_tracks()
            sm.tick(tracks)
            time.sleep(0.05)  # 20Hz loop
    """

    # Confidence threshold to move from scanning → candidate_detected
    CANDIDATE_CONF_THRESHOLD = 0.40

    # Confidence threshold for target_lock
    LOCK_CONF_THRESHOLD = 0.75

    # How long to dwell in pollinating state
    POLLINATION_DWELL_S = 3.0

    # Per-state timeouts (seconds). Abort if exceeded.
    PHASE_TIMEOUTS: Dict[Phase, float] = {
        Phase.ARMING:             20.0,
        Phase.TAKEOFF:            30.0,
        Phase.TRANSIT:            60.0,
        Phase.SCANNING:           20.0,
        Phase.CANDIDATE_DETECTED: 10.0,
        Phase.TARGET_LOCK:         5.0,
        Phase.DESCENT:            20.0,
        Phase.HOVER_ALIGN:        15.0,
        Phase.POLLINATING:         8.0,
        Phase.ASCENT:             20.0,
        Phase.RESUME_TRANSIT:     60.0,
    }

    def __init__(
        self,
        fc: "FlightController",
        sensors: "SensorReader",
        pollination_mgr: "PollinationManager",
        config: dict,
    ):
        self.fc = fc
        self.sensors = sensors
        self.pollination_mgr = pollination_mgr
        self.config = config

        self.phase = Phase.IDLE
        self.ctx = MissionContext()

        # State handlers: phase → (entry, tick)
        self._handlers: Dict[Phase, dict] = {
            Phase.IDLE:               {"entry": self._enter_idle,               "tick": self._tick_idle},
            Phase.ARMING:             {"entry": self._enter_arming,             "tick": self._tick_arming},
            Phase.TAKEOFF:            {"entry": self._enter_takeoff,            "tick": self._tick_takeoff},
            Phase.TRANSIT:            {"entry": self._enter_transit,            "tick": self._tick_transit},
            Phase.SCANNING:           {"entry": self._enter_scanning,           "tick": self._tick_scanning},
            Phase.CANDIDATE_DETECTED: {"entry": self._enter_candidate,         "tick": self._tick_candidate},
            Phase.TARGET_LOCK:        {"entry": self._enter_target_lock,        "tick": self._tick_target_lock},
            Phase.DESCENT:            {"entry": self._enter_descent,            "tick": self._tick_descent},
            Phase.HOVER_ALIGN:        {"entry": self._enter_hover_align,        "tick": self._tick_hover_align},
            Phase.POLLINATING:        {"entry": self._enter_pollinating,        "tick": self._tick_pollinating},
            Phase.ASCENT:             {"entry": self._enter_ascent,             "tick": self._tick_ascent},
            Phase.RESUME_TRANSIT:     {"entry": self._enter_resume_transit,     "tick": self._tick_resume_transit},
            Phase.MISSION_COMPLETE:   {"entry": self._enter_complete,           "tick": self._tick_complete},
            Phase.ABORT:              {"entry": self._enter_abort,              "tick": self._tick_abort},
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self):
        """Initialize waypoint queue and transition to ARMING."""
        self.ctx.waypoints_remaining = self.pollination_mgr.get_waypoint_queue()
        self.ctx.log_event("Mission started")
        self._transition(Phase.ARMING)

    def tick(self, current_tracks: List["Track"]) -> Phase:
        """
        Called every loop iteration (~20Hz).
        Updates detection state and runs the current phase handler.
        Returns the current phase after this tick.
        """
        self.ctx.current_detections = current_tracks

        # Update detection confidence from best visible track
        self._update_detection_confidence(current_tracks)

        # Safety check on every tick
        if not self.fc.is_safe_to_continue() and self.phase not in (
            Phase.IDLE, Phase.MISSION_COMPLETE, Phase.ABORT
        ):
            self.ctx.log_event("Safety check failed — ABORT")
            self._transition(Phase.ABORT)
            return self.phase

        # Check phase timeout
        timeout = self.PHASE_TIMEOUTS.get(self.phase)
        if timeout and self.ctx.phase_elapsed() > timeout:
            self.ctx.log_event(f"Phase {self.phase} timed out after {timeout}s")
            self._handle_timeout()
            return self.phase

        # Run current state tick
        handler = self._handlers.get(self.phase)
        if handler:
            transition: StateTransition = handler["tick"]()
            if transition.next_phase is not None:
                self._transition(transition.next_phase, transition.reason)

        return self.phase

    # ------------------------------------------------------------------
    # Phase Handlers
    # ------------------------------------------------------------------

    # --- IDLE ---
    def _enter_idle(self):
        self.ctx.log_event("System idle")

    def _tick_idle(self) -> StateTransition:
        return StateTransition.stay()

    # --- ARMING ---
    def _enter_arming(self):
        self.ctx.log_event("Pre-flight checks and motor arming")
        if not self.fc.pre_flight_checks():
            self.ctx.log_event("Pre-flight checks FAILED")

    def _tick_arming(self) -> StateTransition:
        if not self.fc.telem.armed:
            success = self.fc.arm()
            if not success:
                return StateTransition.goto(Phase.ABORT, "Arm failed")
        if self.fc.telem.armed:
            return StateTransition.goto(Phase.TAKEOFF, "Motors armed")
        return StateTransition.stay()

    # --- TAKEOFF ---
    def _enter_takeoff(self):
        self.ctx.log_event(f"Taking off to {self.config['mission']['patrol_altitude_m']}m")
        self.fc.record_home()

    def _tick_takeoff(self) -> StateTransition:
        patrol_alt = self.config["mission"]["patrol_altitude_m"]
        current_alt = self.sensors.altitude_m()
        if current_alt >= patrol_alt - 0.5:
            return StateTransition.goto(Phase.TRANSIT, f"Reached {current_alt:.1f}m")
        return StateTransition.stay()

    # --- TRANSIT ---
    def _enter_transit(self):
        if not self.ctx.waypoints_remaining:
            self.ctx.log_event("No waypoints — mission complete")
            return
        wp = self.ctx.waypoints_remaining[0]
        self.ctx.log_event(f"Transiting to waypoint: {wp['name']}")
        # Non-blocking: send the goto command, tick will poll arrival
        self.fc.goto_ned(
            north_m=wp["north_m"],
            east_m=wp["east_m"],
            down_m=-self.config["mission"]["patrol_altitude_m"],
            timeout_s=0.1,  # Non-blocking (just sends command)
        )

    def _tick_transit(self) -> StateTransition:
        if not self.ctx.waypoints_remaining:
            return StateTransition.goto(Phase.MISSION_COMPLETE, "All waypoints visited")

        wp = self.ctx.waypoints_remaining[0]
        # Check if we've arrived (within 1m of waypoint)
        pos = self.fc._current_ned()
        if pos is not None:
            import math
            dist = math.sqrt((pos[0] - wp["north_m"])**2 + (pos[1] - wp["east_m"])**2)
            if dist < 1.0:
                return StateTransition.goto(Phase.SCANNING, f"Arrived at {wp['name']}")

        return StateTransition.stay()

    # --- SCANNING ---
    def _enter_scanning(self):
        self.ctx.detection_confidence = 0.0
        self.ctx.confidence_history.clear()
        self.ctx.log_event("Scanning for flowers...")

    def _tick_scanning(self) -> StateTransition:
        if self.ctx.detection_confidence >= self.CANDIDATE_CONF_THRESHOLD:
            return StateTransition.goto(
                Phase.CANDIDATE_DETECTED,
                f"Candidate detected @ conf={self.ctx.detection_confidence:.2f}"
            )
        return StateTransition.stay()

    # --- CANDIDATE_DETECTED ---
    def _enter_candidate(self):
        self.ctx.log_event(f"Candidate flower — building confidence ({self.ctx.detection_confidence:.2f})")

    def _tick_candidate(self) -> StateTransition:
        if self.ctx.detection_confidence >= self.LOCK_CONF_THRESHOLD:
            return StateTransition.goto(Phase.TARGET_LOCK, "Lock threshold reached")
        if self.ctx.detection_confidence < self.CANDIDATE_CONF_THRESHOLD * 0.8:
            return StateTransition.goto(Phase.SCANNING, "Confidence dropped — rescanning")
        return StateTransition.stay()

    # --- TARGET_LOCK ---
    def _enter_target_lock(self):
        self.ctx.log_event(f"TARGET LOCKED @ {self.ctx.detection_confidence:.2f} confidence")
        # Record target NED position
        best = self._best_track()
        if best and best.estimated_distance_m:
            pos = self.fc._current_ned()
            if pos:
                # Flower is directly below camera (drone hovers over it)
                self.ctx.target_ned = (pos[0], pos[1])
                self.ctx.log_event(f"Target NED: N={pos[0]:.2f} E={pos[1]:.2f}")

    def _tick_target_lock(self) -> StateTransition:
        return StateTransition.goto(Phase.DESCENT, "Proceeding to descent")

    # --- DESCENT ---
    def _enter_descent(self):
        hover_alt = self.config["mission"]["hover_altitude_m"]
        self.ctx.log_event(f"Descending to {hover_alt}m hover altitude")

    def _tick_descent(self) -> StateTransition:
        hover_alt = self.config["mission"]["hover_altitude_m"]
        hover_band = self.config["mission"]["hover_band_m"]
        current_alt = self.sensors.altitude_m()
        if abs(current_alt - hover_alt) <= hover_band:
            return StateTransition.goto(Phase.HOVER_ALIGN, f"At hover altitude {current_alt:.2f}m")
        return StateTransition.stay()

    # --- HOVER_ALIGN ---
    def _enter_hover_align(self):
        self.ctx.hover_start_time = None
        self.ctx.log_event("Precision alignment over flower")

    def _tick_hover_align(self) -> StateTransition:
        # Check optical flow stability
        status = self.sensors.get_flight_status()
        flow = status.optical_flow
        in_band = (
            status.rangefinder is not None and
            status.rangefinder.in_hover_band
        )
        stable = (
            flow is not None and
            flow.is_reliable and
            flow.drift_speed_ms < 0.08   # < 8cm/s drift
        )

        if in_band and stable:
            if self.ctx.hover_start_time is None:
                self.ctx.hover_start_time = time.time()
            # Must hold stable for 1s before pollinating
            if time.time() - self.ctx.hover_start_time >= 1.0:
                return StateTransition.goto(Phase.POLLINATING, "Stable hover confirmed")
        else:
            self.ctx.hover_start_time = None  # Reset stability timer

        return StateTransition.stay()

    # --- POLLINATING ---
    def _enter_pollinating(self):
        self.ctx.log_event("POLLINATION TRIGGERED")
        self.pollination_mgr.trigger_pollination_servo()

    def _tick_pollinating(self) -> StateTransition:
        elapsed = self.ctx.phase_elapsed()
        if elapsed >= self.POLLINATION_DWELL_S:
            if self.ctx.waypoints_remaining:
                target = self.ctx.waypoints_remaining.pop(0)
                self.ctx.completed_targets.append(target)
                self.ctx.log_event(f"Flower {target.get('name', '?')} pollinated ✓")
            return StateTransition.goto(Phase.ASCENT, "Pollination complete")
        return StateTransition.stay()

    # --- ASCENT ---
    def _enter_ascent(self):
        patrol_alt = self.config["mission"]["patrol_altitude_m"]
        self.ctx.log_event(f"Ascending to {patrol_alt}m patrol altitude")

    def _tick_ascent(self) -> StateTransition:
        patrol_alt = self.config["mission"]["patrol_altitude_m"]
        current_alt = self.sensors.altitude_m()
        if current_alt >= patrol_alt - 0.5:
            if self.ctx.waypoints_remaining:
                return StateTransition.goto(Phase.RESUME_TRANSIT, "Patrol altitude reached")
            else:
                return StateTransition.goto(Phase.MISSION_COMPLETE, "All flowers pollinated")
        return StateTransition.stay()

    # --- RESUME_TRANSIT ---
    def _enter_resume_transit(self):
        if self.ctx.waypoints_remaining:
            wp = self.ctx.waypoints_remaining[0]
            self.ctx.log_event(f"Resuming transit to {wp['name']}")
            self.fc.goto_ned(
                north_m=wp["north_m"],
                east_m=wp["east_m"],
                down_m=-self.config["mission"]["patrol_altitude_m"],
                timeout_s=0.1,
            )

    def _tick_resume_transit(self) -> StateTransition:
        return self._tick_transit()   # Same logic as transit

    # --- MISSION_COMPLETE ---
    def _enter_complete(self):
        n = len(self.ctx.completed_targets)
        self.ctx.log_event(f"Mission complete — {n} flowers pollinated")
        self.fc.return_to_home()

    def _tick_complete(self) -> StateTransition:
        return StateTransition.stay()

    # --- ABORT ---
    def _enter_abort(self):
        self.ctx.log_event("MISSION ABORT — returning to home")
        self.fc.return_to_home()

    def _tick_abort(self) -> StateTransition:
        return StateTransition.stay()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _transition(self, new_phase: Phase, reason: str = ""):
        if reason:
            self.ctx.log_event(f"{self.phase} → {new_phase}: {reason}")
        else:
            self.ctx.log_event(f"{self.phase} → {new_phase}")
        self.phase = new_phase
        self.ctx.phase_entry_time = time.time()
        handler = self._handlers.get(new_phase)
        if handler:
            handler["entry"]()

    def _handle_timeout(self):
        """Default timeout behavior per phase."""
        timeout_transitions = {
            Phase.SCANNING:           Phase.RESUME_TRANSIT,  # No flower found, move on
            Phase.CANDIDATE_DETECTED: Phase.SCANNING,         # Lost the candidate
            Phase.HOVER_ALIGN:        Phase.ASCENT,            # Couldn't align, skip
            Phase.DESCENT:            Phase.ASCENT,            # Can't descend safely
        }
        next_phase = timeout_transitions.get(self.phase, Phase.ABORT)
        self._transition(next_phase, "timeout")

    def _update_detection_confidence(self, tracks: List["Track"]):
        """
        Update the accumulated detection confidence based on visible tracks.
        Uses exponential moving average — rises fast on good detections,
        decays slowly when no target is visible.
        """
        best = self._best_track()

        if best is not None:
            # Rise toward detection confidence
            new_conf = best.confidence
            self.ctx.detection_confidence = (
                0.3 * new_conf + 0.7 * self.ctx.detection_confidence
            )
        else:
            # Decay when no detection
            self.ctx.detection_confidence *= 0.92

        self.ctx.confidence_history.append(self.ctx.detection_confidence)
        if len(self.ctx.confidence_history) > 60:
            self.ctx.confidence_history.pop(0)

    def _best_track(self) -> Optional["Track"]:
        """Return the highest-confidence open flower track."""
        open_flowers = [t for t in self.ctx.current_detections
                        if t.class_name == "flower_open"]
        if open_flowers:
            return max(open_flowers, key=lambda t: t.confidence)
        return None
