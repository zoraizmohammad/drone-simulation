"""
MAVLink Interface
-----------------
Low-level connection to the Pixhawk flight controller via MAVLink protocol.
Handles:
  - Serial/UDP connection (UART on RPi GPIO or USB)
  - Heartbeat monitoring
  - Message subscription (optical flow, rangefinder, EKF status, attitude, etc.)
  - Sending MAVLink commands (SET_MODE, CMD_COMPONENT_ARM_DISARM, etc.)

This layer is intentionally thin — all it does is send/receive MAVLink messages.
The FlightController layer builds higher-level commands on top of this.

Physical wiring (Raspberry Pi 4 ↔ Pixhawk 4/6):
  RPi GPIO 14 (TX) → Pixhawk TELEM2 RX
  RPi GPIO 15 (RX) → Pixhawk TELEM2 TX
  RPi GND         → Pixhawk GND
  Baud rate: 921600 (set in PX4 param SER_TEL2_BAUD=921600)
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Callable, Dict, List, Optional

import yaml
from loguru import logger
from pymavlink import mavutil
from pymavlink.dialects.v20 import ardupilotmega as mavlink2


class TelemetrySnapshot:
    """
    Thread-safe container for the most recently received MAVLink messages.
    Any thread can read .attitude, .optical_flow, etc. safely.
    """

    def __init__(self):
        self._lock = threading.Lock()

        # ATTITUDE (MAVLink msg: ATTITUDE)
        self.roll_rad: float = 0.0
        self.pitch_rad: float = 0.0
        self.yaw_rad: float = 0.0
        self.roll_rate: float = 0.0
        self.pitch_rate: float = 0.0
        self.yaw_rate: float = 0.0

        # GLOBAL_POSITION_INT
        self.lat_deg: float = 0.0
        self.lon_deg: float = 0.0
        self.alt_msl_m: float = 0.0
        self.alt_rel_m: float = 0.0
        self.vx_ms: float = 0.0
        self.vy_ms: float = 0.0
        self.vz_ms: float = 0.0
        self.hdg_deg: float = 0.0

        # OPTICAL_FLOW_RAD (PX4FLOW / integrated flow)
        # flowx/flowy: integrated flow in radians over integration_time_us
        self.flow_comp_m_x: float = 0.0       # Compensated flow X m/s
        self.flow_comp_m_y: float = 0.0       # Compensated flow Y m/s
        self.flow_quality: int = 0             # 0–255 quality metric
        self.ground_distance_m: float = -1.0  # From PX4FLOW sensor

        # DISTANCE_SENSOR (rangefinder / LIDAR)
        self.rangefinder_m: float = -1.0
        self.rangefinder_valid: bool = False

        # EKF_STATUS_REPORT
        self.ekf_flags: int = 0
        self.ekf_velocity_var: float = 0.0
        self.ekf_pos_horiz_var: float = 0.0
        self.ekf_pos_vert_var: float = 0.0
        self.ekf_healthy: bool = False

        # SYS_STATUS
        self.battery_voltage_v: float = 0.0
        self.battery_pct: float = 100.0
        self.armed: bool = False
        self.mode: str = "UNKNOWN"

        # Timestamps
        self.last_attitude_ts: float = 0.0
        self.last_flow_ts: float = 0.0
        self.last_range_ts: float = 0.0
        self.last_gps_ts: float = 0.0

    def update(self, msg) -> None:
        """Parse a MAVLink message and update the relevant fields."""
        msg_type = msg.get_type()
        with self._lock:
            if msg_type == "ATTITUDE":
                self.roll_rad = msg.roll
                self.pitch_rad = msg.pitch
                self.yaw_rad = msg.yaw
                self.roll_rate = msg.rollspeed
                self.pitch_rate = msg.pitchspeed
                self.yaw_rate = msg.yawspeed
                self.last_attitude_ts = time.time()

            elif msg_type == "GLOBAL_POSITION_INT":
                self.lat_deg = msg.lat / 1e7
                self.lon_deg = msg.lon / 1e7
                self.alt_msl_m = msg.alt / 1000.0
                self.alt_rel_m = msg.relative_alt / 1000.0
                self.vx_ms = msg.vx / 100.0
                self.vy_ms = msg.vy / 100.0
                self.vz_ms = msg.vz / 100.0
                self.hdg_deg = msg.hdg / 100.0
                self.last_gps_ts = time.time()

            elif msg_type == "OPTICAL_FLOW_RAD":
                # PX4 sends OPTICAL_FLOW_RAD for PX4FLOW sensor
                self.flow_comp_m_x = msg.integrated_xgyro   # rad/s compensated
                self.flow_comp_m_y = msg.integrated_ygyro
                self.flow_quality = msg.quality
                self.ground_distance_m = msg.distance if msg.distance > 0 else -1.0
                self.last_flow_ts = time.time()

            elif msg_type == "OPTICAL_FLOW":
                # ArduPilot sends OPTICAL_FLOW
                self.flow_comp_m_x = msg.flow_comp_m_x
                self.flow_comp_m_y = msg.flow_comp_m_y
                self.flow_quality = msg.quality
                self.last_flow_ts = time.time()

            elif msg_type == "DISTANCE_SENSOR":
                # Downward-facing rangefinder
                if msg.orientation == 25:  # MAV_SENSOR_ROTATION_PITCH_270 = down
                    dist_m = msg.current_distance / 100.0
                    self.rangefinder_valid = (0.1 < dist_m < 12.0)
                    if self.rangefinder_valid:
                        self.rangefinder_m = dist_m
                    self.last_range_ts = time.time()

            elif msg_type == "EKF_STATUS_REPORT":
                self.ekf_flags = msg.flags
                self.ekf_velocity_var = msg.velocity_variance
                self.ekf_pos_horiz_var = msg.pos_horiz_variance
                self.ekf_pos_vert_var = msg.pos_vert_variance
                # EKF healthy if position estimate is good (flags bit 3 set)
                self.ekf_healthy = bool(msg.flags & 0x08)

            elif msg_type == "SYS_STATUS":
                self.battery_voltage_v = msg.voltage_battery / 1000.0
                if msg.battery_remaining >= 0:
                    self.battery_pct = float(msg.battery_remaining)

            elif msg_type == "HEARTBEAT":
                self.armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                # Decode flight mode from custom_mode
                self.mode = str(msg.custom_mode)

    @property
    def yaw_deg(self) -> float:
        import math
        return math.degrees(self.yaw_rad)

    @property
    def flow_is_valid(self) -> bool:
        return (self.flow_quality > 100 and
                time.time() - self.last_flow_ts < 0.5)

    @property
    def range_is_valid(self) -> bool:
        return (self.rangefinder_valid and
                time.time() - self.last_range_ts < 0.5)


class MAVLinkInterface:
    """
    Manages the MAVLink connection to Pixhawk.
    Runs a background thread that continuously receives messages and updates
    the TelemetrySnapshot.

    Example:
        mav = MAVLinkInterface("config/mission_config.yaml")
        mav.connect()
        mav.wait_heartbeat()
        print(mav.telemetry.alt_rel_m)
        mav.close()
    """

    def __init__(self, config_path: str = "config/mission_config.yaml"):
        with open(config_path) as f:
            cfg = yaml.safe_load(f)["pixhawk"]

        self.connection_string = cfg["connection_string"]
        self.baud_rate = cfg["baud_rate"]
        self.heartbeat_timeout = cfg["heartbeat_timeout_s"]

        self.telemetry = TelemetrySnapshot()
        self._conn: Optional[mavutil.mavfile] = None
        self._recv_thread: Optional[threading.Thread] = None
        self._running = False
        self._message_callbacks: Dict[str, List[Callable]] = defaultdict(list)
        self._heartbeat_event = threading.Event()

        logger.info(f"MAVLinkInterface: {self.connection_string} @ {self.baud_rate}")

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """Open MAVLink connection and start receiver thread."""
        try:
            self._conn = mavutil.mavlink_connection(
                self.connection_string,
                baud=self.baud_rate,
                source_system=255,    # GCS system ID
                source_component=0,
            )
            logger.info("MAVLink connection opened")
        except Exception as e:
            logger.error(f"MAVLink connect failed: {e}")
            return False

        self._running = True
        self._recv_thread = threading.Thread(
            target=self._receive_loop, daemon=True, name="mavlink-recv"
        )
        self._recv_thread.start()
        return True

    def wait_heartbeat(self, timeout: float = 10.0) -> bool:
        """Block until first heartbeat received."""
        logger.info("Waiting for Pixhawk heartbeat...")
        got_it = self._heartbeat_event.wait(timeout=timeout)
        if got_it:
            logger.info("Heartbeat received — Pixhawk connected")
        else:
            logger.error(f"No heartbeat after {timeout}s")
        return got_it

    def close(self):
        self._running = False
        if self._conn:
            self._conn.close()
        logger.info("MAVLink connection closed")

    # ------------------------------------------------------------------
    # Message Sending
    # ------------------------------------------------------------------

    def send_command_long(
        self,
        command: int,
        param1: float = 0, param2: float = 0, param3: float = 0,
        param4: float = 0, param5: float = 0, param6: float = 0,
        param7: float = 0,
        confirmation: int = 0,
    ) -> bool:
        """Send a MAVLink COMMAND_LONG and wait for ACK."""
        if self._conn is None:
            return False

        self._conn.mav.command_long_send(
            self._conn.target_system,
            self._conn.target_component,
            command,
            confirmation,
            param1, param2, param3, param4, param5, param6, param7,
        )

        # Wait for COMMAND_ACK
        ack = self._conn.recv_match(type="COMMAND_ACK", blocking=True, timeout=3.0)
        if ack and ack.command == command:
            success = ack.result == mavutil.mavlink.MAV_RESULT_ACCEPTED
            if not success:
                logger.warning(f"CMD {command} NACK: result={ack.result}")
            return success
        return False

    def set_mode(self, mode_string: str) -> bool:
        """
        Set flight mode by name.
        ArduPilot: "GUIDED", "LOITER", "RTL", "LAND"
        PX4: "OFFBOARD", "HOLD", "RETURN"
        """
        if self._conn is None:
            return False
        mode_id = self._conn.mode_mapping().get(mode_string)
        if mode_id is None:
            logger.error(f"Unknown mode: {mode_string}")
            return False

        self._conn.mav.set_mode_send(
            self._conn.target_system,
            mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            mode_id,
        )
        logger.info(f"Set mode: {mode_string} (id={mode_id})")
        return True

    def send_position_target_local_ned(
        self,
        x: float = 0, y: float = 0, z: float = 0,       # Position NED (m)
        vx: float = 0, vy: float = 0, vz: float = 0,    # Velocity NED (m/s)
        yaw: float = 0,                                   # Yaw rad
        type_mask: int = 0b0000_111111_000111,            # Use pos + yaw
    ):
        """
        Send SET_POSITION_TARGET_LOCAL_NED for GUIDED/OFFBOARD position control.
        type_mask bits:
            bit 0 = ignore x, bit 1 = ignore y, bit 2 = ignore z (position)
            bit 3 = ignore vx, bit 4 = ignore vy, bit 5 = ignore vz (velocity)
            bit 11 = ignore yaw, bit 12 = ignore yaw_rate
        Default mask: use position XYZ + yaw, ignore velocity.
        """
        if self._conn is None:
            return

        self._conn.mav.set_position_target_local_ned_send(
            int(time.time() * 1000) & 0xFFFFFFFF,     # time_boot_ms
            self._conn.target_system,
            self._conn.target_component,
            mavutil.mavlink.MAV_FRAME_LOCAL_NED,
            type_mask,
            x, y, z,
            vx, vy, vz,
            0, 0, 0,   # acceleration (ignored)
            yaw,
            0,         # yaw_rate (ignored)
        )

    def send_velocity_ned(self, vx: float, vy: float, vz: float):
        """Send velocity setpoint in NED frame (m/s). Positive Z = downward."""
        # type_mask: ignore position, use velocity only
        velocity_mask = 0b0000_111111_111000
        self.send_position_target_local_ned(
            vx=vx, vy=vy, vz=vz,
            type_mask=velocity_mask,
        )

    # ------------------------------------------------------------------
    # Callback Registration
    # ------------------------------------------------------------------

    def on_message(self, msg_type: str, callback: Callable):
        """Register a callback for a specific MAVLink message type."""
        self._message_callbacks[msg_type].append(callback)

    # ------------------------------------------------------------------
    # Receiver Thread
    # ------------------------------------------------------------------

    def _receive_loop(self):
        """
        Background thread: continuously reads MAVLink messages and updates
        the TelemetrySnapshot. Runs at whatever rate Pixhawk sends (~50-200Hz).
        """
        logger.debug("MAVLink receive loop started")
        while self._running:
            try:
                msg = self._conn.recv_match(blocking=True, timeout=0.1)
                if msg is None:
                    continue

                msg_type = msg.get_type()
                if msg_type == "BAD_DATA":
                    continue

                # Update telemetry snapshot
                self.telemetry.update(msg)

                # Signal first heartbeat
                if msg_type == "HEARTBEAT":
                    self._heartbeat_event.set()

                # Invoke registered callbacks
                for cb in self._message_callbacks.get(msg_type, []):
                    try:
                        cb(msg)
                    except Exception as e:
                        logger.error(f"Callback error for {msg_type}: {e}")

            except Exception as e:
                if self._running:
                    logger.warning(f"MAVLink recv error: {e}")
                    time.sleep(0.01)

        logger.debug("MAVLink receive loop stopped")
