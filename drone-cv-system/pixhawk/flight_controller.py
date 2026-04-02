"""
Flight Controller
-----------------
High-level flight commands built on top of MAVLinkInterface.
Provides clean, mission-level API:

    fc.arm()
    fc.takeoff(altitude_m=8.0)
    fc.goto_ned(north=5.0, east=3.0, down=-8.0)
    fc.precision_hover(target_north, target_east, altitude_m=1.5)
    fc.land()
    fc.disarm()

All blocking methods poll telemetry in a loop until the maneuver is complete
or a timeout is exceeded. Non-blocking variants are also provided.

Hardware note (F450 / Pixhawk 2.4.8 / ArduCopter):
  - F450 motor layout: Motor 1 (front-right) CCW, Motor 2 (rear-left) CCW,
    Motor 3 (front-left) CW, Motor 4 (rear-right) CW — standard X-quad layout
  - Flight mode: GUIDED for autonomous mission. RC transmitter (FS-i6X / FS-iA6B
    in PPM mode, CH5) can override to STABILIZE/LOITER at any time — always safe.
  - AUX OUT 1 drives the pollen-dispenser servo (SERVO9_FUNCTION=0 in ArduCopter).
  - ArduPilot sequence: arm → GUIDED mode → takeoff command → position setpoints
"""

from __future__ import annotations

import math
import time
from typing import Optional, Tuple

import yaml
from loguru import logger
from pymavlink import mavutil

from pixhawk.mavlink_interface import MAVLinkInterface, TelemetrySnapshot


class FlightController:
    """
    Mission-level flight commands for autonomous pollination.
    Wraps MAVLinkInterface with safety checks and blocking maneuvers.
    """

    def __init__(
        self,
        mav: MAVLinkInterface,
        config_path: str = "config/mission_config.yaml",
    ):
        self.mav = mav
        with open(config_path) as f:
            cfg = yaml.safe_load(f)
        self.mission_cfg = cfg["mission"]
        self.limits = cfg["limits"]
        self.guided_mode = cfg["pixhawk"]["guided_mode"]

        # Home position (set on first GPS fix)
        self._home_lat: Optional[float] = None
        self._home_lon: Optional[float] = None
        self._home_alt: Optional[float] = None

        # NED origin (set on takeoff)
        self._origin_lat: Optional[float] = None
        self._origin_lon: Optional[float] = None

        logger.info("FlightController initialized")

    # ------------------------------------------------------------------
    # Pre-flight
    # ------------------------------------------------------------------

    @property
    def telem(self) -> TelemetrySnapshot:
        return self.mav.telemetry

    def pre_flight_checks(self) -> bool:
        """
        Verify all systems are go before arming.
        Returns True if safe to proceed.
        """
        checks = {
            "Heartbeat": self.mav._heartbeat_event.is_set(),
            "EKF healthy": self.telem.ekf_healthy,
            "Battery OK": self.telem.battery_pct >= self.limits["min_battery_pct"],
            "GPS fix": (self.telem.lat_deg != 0.0 or self.telem.lon_deg != 0.0),
            "Not armed": not self.telem.armed,
        }
        all_ok = True
        for name, ok in checks.items():
            status = "PASS" if ok else "FAIL"
            logger.info(f"  Pre-flight {name}: {status}")
            if not ok:
                all_ok = False

        return all_ok

    def record_home(self):
        """Record current GPS position as home base."""
        self._home_lat = self.telem.lat_deg
        self._home_lon = self.telem.lon_deg
        self._home_alt = self.telem.alt_msl_m
        logger.info(f"Home recorded: ({self._home_lat:.6f}, {self._home_lon:.6f}, {self._home_alt:.1f}m)")

    # ------------------------------------------------------------------
    # Arm / Disarm
    # ------------------------------------------------------------------

    def arm(self, timeout_s: float = 10.0) -> bool:
        """
        Arm the motors.
        Sends MAV_CMD_COMPONENT_ARM_DISARM (param1=1 to arm).
        """
        logger.info("Arming motors...")
        self.mav.set_mode(self.guided_mode)
        time.sleep(0.5)

        success = self.mav.send_command_long(
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            param1=1,   # 1 = arm
            param2=0,
        )

        if not success:
            # Retry once (Pixhawk sometimes rejects the first arm)
            time.sleep(1.0)
            success = self.mav.send_command_long(
                mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                param1=1,
            )

        # Wait for armed state
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self.telem.armed:
                logger.info("Motors ARMED")
                return True
            time.sleep(0.2)

        logger.error("Arm timeout — motors not armed")
        return False

    def disarm(self, force: bool = False) -> bool:
        """
        Disarm motors. force=True overrides safety checks (emergency use only).
        """
        logger.info("Disarming motors...")
        param2 = 21196.0 if force else 0.0   # Magic number for force disarm
        success = self.mav.send_command_long(
            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
            param1=0,
            param2=param2,
        )
        if success:
            logger.info("Motors DISARMED")
        return success

    # ------------------------------------------------------------------
    # Takeoff
    # ------------------------------------------------------------------

    def takeoff(self, altitude_m: float = 8.0, timeout_s: float = 30.0) -> bool:
        """
        Command takeoff to specified altitude (relative to launch point).
        Blocks until altitude reached or timeout.
        """
        logger.info(f"Takeoff to {altitude_m}m...")

        self._origin_lat = self.telem.lat_deg
        self._origin_lon = self.telem.lon_deg

        success = self.mav.send_command_long(
            mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
            param7=altitude_m,   # Target altitude
        )
        if not success:
            logger.error("Takeoff command rejected")
            return False

        # Wait until we reach target altitude (within 0.5m)
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            current_alt = self.telem.alt_rel_m
            progress = min(current_alt / altitude_m, 1.0)
            logger.debug(f"  Altitude: {current_alt:.1f}m / {altitude_m}m ({progress*100:.0f}%)")
            if current_alt >= altitude_m - 0.5:
                logger.info(f"Takeoff complete — altitude {current_alt:.1f}m")
                return True
            time.sleep(0.5)

        logger.error(f"Takeoff timeout — only reached {self.telem.alt_rel_m:.1f}m")
        return False

    # ------------------------------------------------------------------
    # Navigation
    # ------------------------------------------------------------------

    def goto_ned(
        self,
        north_m: float,
        east_m: float,
        down_m: float,
        yaw_deg: Optional[float] = None,
        tolerance_m: float = 0.5,
        timeout_s: float = 30.0,
    ) -> bool:
        """
        Fly to a position in NED frame relative to NED origin (takeoff point).
        Blocks until within tolerance or timeout.
        """
        yaw_rad = math.radians(yaw_deg) if yaw_deg is not None else self.telem.yaw_rad
        logger.info(f"Goto NED: N={north_m:.1f} E={east_m:.1f} D={down_m:.1f}")

        self.mav.send_position_target_local_ned(
            x=north_m, y=east_m, z=down_m,
            yaw=yaw_rad,
        )

        deadline = time.time() + timeout_s
        while time.time() < deadline:
            pos = self._current_ned()
            if pos is None:
                time.sleep(0.1)
                continue

            dist = math.sqrt(
                (pos[0] - north_m) ** 2 +
                (pos[1] - east_m) ** 2 +
                (pos[2] - down_m) ** 2
            )
            logger.debug(f"  NED dist to target: {dist:.2f}m")
            if dist <= tolerance_m:
                logger.info("Waypoint reached")
                return True
            time.sleep(0.2)

        logger.warning(f"goto_ned timeout — dist={dist:.2f}m")
        return False

    def precision_hover(
        self,
        target_north_m: float,
        target_east_m: float,
        altitude_m: float = 1.5,
        horizontal_tolerance_m: float = 0.10,
        vertical_tolerance_m: float = 0.15,
        timeout_s: float = 20.0,
    ) -> bool:
        """
        Precision hover directly above a flower at low altitude.
        Uses velocity commands rather than position commands for tighter control.
        Optical flow data from Pixhawk improves position hold at low altitude.

        horizontal_tolerance_m: ±10cm horizontal accuracy for pollination.
        """
        logger.info(f"Precision hover: N={target_north_m:.2f} E={target_east_m:.2f} alt={altitude_m:.2f}m")
        target_down = -altitude_m   # NED: negative = up

        deadline = time.time() + timeout_s
        kp_horiz = 0.5     # Proportional gain for horizontal position
        kp_vert = 0.8      # Proportional gain for vertical position
        max_horiz_speed = self.limits["max_descent_rate_ms"]

        while time.time() < deadline:
            pos = self._current_ned()
            if pos is None:
                time.sleep(0.05)
                continue

            north_err = target_north_m - pos[0]
            east_err = target_east_m - pos[1]
            down_err = target_down - pos[2]

            horiz_dist = math.sqrt(north_err**2 + east_err**2)
            vert_dist = abs(down_err)

            # Compute velocity commands
            vn = max(-max_horiz_speed, min(max_horiz_speed, kp_horiz * north_err))
            ve = max(-max_horiz_speed, min(max_horiz_speed, kp_horiz * east_err))
            vd = max(-self.limits["max_descent_rate_ms"],
                     min(self.limits["max_descent_rate_ms"], kp_vert * down_err))

            # Check if optical flow is available for better hold
            if self.telem.flow_is_valid:
                # Optical flow gives ego-velocity — add a correction term
                flow_x = self.telem.flow_comp_m_x
                flow_y = self.telem.flow_comp_m_y
                # Damp the velocity command by current measured velocity
                vn -= flow_x * 0.1
                ve -= flow_y * 0.1

            self.mav.send_velocity_ned(vn, ve, vd)

            logger.debug(
                f"  Hover error: horiz={horiz_dist:.3f}m vert={vert_dist:.3f}m "
                f"flow_q={self.telem.flow_quality} rng={self.telem.rangefinder_m:.2f}m"
            )

            if horiz_dist <= horizontal_tolerance_m and vert_dist <= vertical_tolerance_m:
                # Stop moving
                self.mav.send_velocity_ned(0, 0, 0)
                logger.info(f"In hover band! horiz={horiz_dist:.3f}m alt={self.telem.rangefinder_m:.2f}m")
                return True

            time.sleep(0.05)  # 20Hz control loop

        logger.warning("Precision hover timeout")
        self.mav.send_velocity_ned(0, 0, 0)
        return False

    def ascend_to(self, altitude_m: float, timeout_s: float = 20.0) -> bool:
        """Climb from current position to target altitude."""
        pos = self._current_ned()
        if pos is None:
            return False
        return self.goto_ned(
            north_m=pos[0],
            east_m=pos[1],
            down_m=-altitude_m,
            tolerance_m=0.5,
            timeout_s=timeout_s,
        )

    def descend_to_altitude(self, altitude_m: float, timeout_s: float = 20.0) -> bool:
        """Descend from patrol altitude to hover altitude above flower."""
        pos = self._current_ned()
        if pos is None:
            return False
        return self.goto_ned(
            north_m=pos[0],
            east_m=pos[1],
            down_m=-altitude_m,
            tolerance_m=0.3,
            timeout_s=timeout_s,
        )

    def return_to_home(self) -> bool:
        """Command return-to-home (RTL)."""
        logger.info("Return to home commanded")
        return self.mav.set_mode("RTL")

    def land(self) -> bool:
        """Command landing at current position."""
        logger.info("Land commanded")
        return self.mav.set_mode("LAND")

    # ------------------------------------------------------------------
    # Safety
    # ------------------------------------------------------------------

    def trigger_aux_servo(
        self,
        channel: int = 1,
        deployed_pwm_us: int = 1700,
        hold_s: float = 2.5,
        retract_pwm_us: int = 1000,
    ) -> bool:
        """
        Actuate the pollination servo via Pixhawk AUX OUT 1 using MAVLink
        DO_SET_SERVO — the preferred architecture because:
          - Hardware PWM timing (no Linux scheduler jitter)
          - Logged in Pixhawk DataFlash flight log
          - Failsafe retract if companion computer disconnects

        Sequence:
          1. Deploy → AUX OUT 1 to deployed_pwm_us (default 1700 µs ≈ 135°)
          2. Hold for hold_s seconds (pollen transfer dwell)
          3. Retract → AUX OUT 1 to retract_pwm_us (default 1000 µs = 0°)

        ArduCopter parameter required:
          SERVO9_FUNCTION = 0   (manual passthrough for AUX OUT 1)

        Args:
            channel:        AUX port number (1 = AUX OUT 1).
            deployed_pwm_us: PWM for deployed position (µs).
            hold_s:         Dwell time in deployed position (seconds).
            retract_pwm_us: PWM for retracted/safe position (µs).
        """
        logger.info(f"Pollination servo DEPLOY — AUX {channel} → {deployed_pwm_us}µs, hold {hold_s}s")
        ok = self.mav.set_aux_servo(channel, deployed_pwm_us)
        if not ok:
            logger.warning("DO_SET_SERVO NACK — servo may not have deployed")

        time.sleep(hold_s)

        logger.info(f"Pollination servo RETRACT — AUX {channel} → {retract_pwm_us}µs")
        self.mav.set_aux_servo(channel, retract_pwm_us)
        return ok

    def is_rc_override_active(self) -> bool:
        """
        Detect if the RC transmitter (FS-i6X) has overridden autonomous control.
        In ArduCopter, switching the flight mode channel (CH5) to STABILIZE,
        LOITER, or any non-GUIDED mode means the pilot has taken manual control.

        The mission should pause and NOT send position setpoints while an RC
        override is active — the Pixhawk is the authority in this state.

        Returns True if the current flight mode is not the autonomous GUIDED mode.
        """
        current_mode = self.telem.mode
        # ArduCopter GUIDED mode custom_mode value is 4
        # If mode is not GUIDED, the RC pilot has overridden
        is_guided = (current_mode == '4' or current_mode.upper() == 'GUIDED')
        if not is_guided:
            logger.warning(f"RC override active — mode={current_mode}, mission paused")
        return not is_guided

    def is_safe_to_continue(self) -> bool:
        """Check all safety conditions during flight."""
        if self.telem.battery_pct < self.limits["min_battery_pct"]:
            logger.warning(f"Low battery: {self.telem.battery_pct:.0f}% — RTH")
            return False
        if not self.telem.ekf_healthy:
            logger.warning("EKF unhealthy — RTH")
            return False
        if self.is_rc_override_active():
            # RC pilot has taken control; do not command autonomous movement
            return False
        if self._home_lat is not None:
            dist = self._distance_from_home_m()
            if dist > self.limits["geofence_radius_m"]:
                logger.warning(f"Geofence breach: {dist:.1f}m from home — RTH")
                return False
        return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _current_ned(self) -> Optional[Tuple[float, float, float]]:
        """
        Estimate current NED position relative to takeoff point.
        Uses GPS lat/lon + relative altitude.
        Returns (north_m, east_m, down_m) or None if no GPS.
        """
        if self._origin_lat is None:
            return None
        lat = self.telem.lat_deg
        lon = self.telem.lon_deg
        if lat == 0.0 and lon == 0.0:
            return None

        # Simple flat-earth approximation for small areas (<500m)
        METERS_PER_DEG_LAT = 111_320.0
        north = (lat - self._origin_lat) * METERS_PER_DEG_LAT
        east = (lon - self._origin_lon) * METERS_PER_DEG_LAT * math.cos(math.radians(lat))
        down = -self.telem.alt_rel_m   # NED: altitude is negative down

        return (north, east, down)

    def _distance_from_home_m(self) -> float:
        if self._home_lat is None:
            return 0.0
        METERS_PER_DEG_LAT = 111_320.0
        dlat = (self.telem.lat_deg - self._home_lat) * METERS_PER_DEG_LAT
        dlon = (self.telem.lon_deg - self._home_lon) * METERS_PER_DEG_LAT * math.cos(
            math.radians(self.telem.lat_deg)
        )
        return math.sqrt(dlat**2 + dlon**2)
