"""
Sensor Reader
-------------
Subscribes to and interprets Pixhawk sensor data relevant to autonomous
flower-seeking and precision landing:

  - PX4FLOW / optical flow sensor (OPTICAL_FLOW_RAD / OPTICAL_FLOW)
  - Downward rangefinder / LIDAR (DISTANCE_SENSOR)
  - EKF status (EKF_STATUS_REPORT)
  - IMU / attitude (ATTITUDE)

The optical flow sensor (e.g., PX4FLOW, Holybro H-Flow, mRo Flow) plugs into
the Pixhawk I2C or UART port. PX4 firmware reads it and fuses it into EKF2
for position hold without GPS at low altitude — critical for sub-10cm hover.

Wiring for PX4FLOW sensor:
  PX4FLOW I2C SDA → Pixhawk I2C SDA
  PX4FLOW I2C SCL → Pixhawk I2C SCL
  PX4FLOW UART TX → Pixhawk UART RX (for raw flow data stream)
  PX4FLOW sonar   → downward LIDAR (provides altitude to PX4FLOW)

PX4 parameters to enable optical flow fusion:
  EKF2_AID_MASK = 2 (use optical flow)
  EKF2_OF_DELAY = 20 (ms latency of your sensor)
  EKF2_HGT_MODE = 2 (range finder altitude for low-altitude hold)
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

from loguru import logger

from pixhawk.mavlink_interface import MAVLinkInterface, TelemetrySnapshot


@dataclass
class OpticalFlowReading:
    """Parsed optical flow measurement."""

    # Integrated angular flow (radians) over integration_time_us
    flow_x_rad: float       # Positive = drone moving left relative to ground
    flow_y_rad: float       # Positive = drone moving backward relative to ground

    # Compensated linear velocity estimates (m/s) from Pixhawk EKF
    vx_ms: float
    vy_ms: float

    quality: int            # 0–255, anything <100 is unreliable
    ground_distance_m: float  # -1 if sensor doesn't provide it

    timestamp: float        # Unix timestamp

    @property
    def is_reliable(self) -> bool:
        return self.quality >= 100

    @property
    def drift_speed_ms(self) -> float:
        """Magnitude of lateral velocity — should be ~0 in hover."""
        return (self.vx_ms**2 + self.vy_ms**2) ** 0.5


@dataclass
class RangefinderReading:
    """Parsed rangefinder (LIDAR/sonar) measurement."""

    distance_m: float
    min_distance_m: float
    max_distance_m: float
    timestamp: float

    @property
    def is_valid(self) -> bool:
        return self.min_distance_m <= self.distance_m <= self.max_distance_m

    @property
    def in_hover_band(self) -> bool:
        """Is drone in the 1.2m–1.8m band for pollination hover?"""
        return 1.2 <= self.distance_m <= 1.8


@dataclass
class FlightStatus:
    """Combined flight sensor snapshot for the mission loop."""

    altitude_m: float          # Rangefinder altitude (preferred) or barometric
    is_hovering: bool          # True if horizontal velocity is near zero
    ekf_healthy: bool
    battery_pct: float
    yaw_deg: float
    optical_flow: Optional[OpticalFlowReading]
    rangefinder: Optional[RangefinderReading]


class SensorReader:
    """
    Provides a clean API to read current sensor data from the
    TelemetrySnapshot (which is updated in background by MAVLinkInterface).

    Does not start its own thread — reads the already-updated snapshot.
    """

    def __init__(self, mav: MAVLinkInterface):
        self.mav = mav

    @property
    def _t(self) -> TelemetrySnapshot:
        return self.mav.telemetry

    # ------------------------------------------------------------------
    # Optical Flow
    # ------------------------------------------------------------------

    def get_optical_flow(self) -> Optional[OpticalFlowReading]:
        """
        Return latest optical flow reading, or None if data is stale.

        The PX4FLOW sensor sends at 10–20Hz. If the last reading is older
        than 500ms we consider it stale and return None.
        """
        if time.time() - self._t.last_flow_ts > 0.5:
            return None

        return OpticalFlowReading(
            flow_x_rad=self._t.flow_comp_m_x,
            flow_y_rad=self._t.flow_comp_m_y,
            vx_ms=self._t.flow_comp_m_x,   # Pixhawk already compensates
            vy_ms=self._t.flow_comp_m_y,
            quality=self._t.flow_quality,
            ground_distance_m=self._t.ground_distance_m,
            timestamp=self._t.last_flow_ts,
        )

    def flow_velocity_ms(self) -> tuple[float, float]:
        """
        Return optical-flow-estimated velocity (vx, vy) in m/s.
        Returns (0, 0) if flow unavailable or unreliable.
        """
        flow = self.get_optical_flow()
        if flow is None or not flow.is_reliable:
            return (0.0, 0.0)
        return (flow.vx_ms, flow.vy_ms)

    # ------------------------------------------------------------------
    # Rangefinder
    # ------------------------------------------------------------------

    def get_rangefinder(self) -> Optional[RangefinderReading]:
        """
        Return latest downward rangefinder reading, or None if stale.

        The Pixhawk sends DISTANCE_SENSOR at 25–50Hz.
        At low altitude (<3m) this is the primary altitude source for hover.
        """
        if time.time() - self._t.last_range_ts > 0.5:
            return None
        if not self._t.rangefinder_valid:
            return None

        return RangefinderReading(
            distance_m=self._t.rangefinder_m,
            min_distance_m=0.1,    # Sensor minimum (typically 10–20cm)
            max_distance_m=12.0,   # Sensor maximum
            timestamp=self._t.last_range_ts,
        )

    def altitude_m(self) -> float:
        """
        Best available altitude estimate.
        Priority: rangefinder (when valid) > barometric relative altitude.
        """
        rf = self.get_rangefinder()
        if rf is not None and rf.is_valid:
            return rf.distance_m
        return self._t.alt_rel_m

    # ------------------------------------------------------------------
    # Composite Status
    # ------------------------------------------------------------------

    def get_flight_status(self) -> FlightStatus:
        """Return a complete flight status snapshot for the mission loop."""
        flow = self.get_optical_flow()
        rangefinder = self.get_rangefinder()

        # Compute hovering state from both flow and EKF velocity
        vx = self._t.vx_ms
        vy = self._t.vy_ms
        horiz_speed = (vx**2 + vy**2) ** 0.5
        is_hovering = horiz_speed < 0.15  # < 15cm/s

        return FlightStatus(
            altitude_m=self.altitude_m(),
            is_hovering=is_hovering,
            ekf_healthy=self._t.ekf_healthy,
            battery_pct=self._t.battery_pct,
            yaw_deg=self._t.yaw_deg,
            optical_flow=flow,
            rangefinder=rangefinder,
        )

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def print_status(self):
        """Print a one-line sensor status summary (for debugging)."""
        status = self.get_flight_status()
        flow = status.optical_flow
        rf = status.rangefinder

        flow_str = (
            f"flow=({flow.vx_ms:+.2f},{flow.vy_ms:+.2f})m/s q={flow.quality}"
            if flow else "flow=N/A"
        )
        rf_str = f"rng={rf.distance_m:.2f}m" if rf else "rng=N/A"

        logger.info(
            f"ALT={status.altitude_m:.2f}m | "
            f"{rf_str} | {flow_str} | "
            f"EKF={'OK' if status.ekf_healthy else 'BAD'} | "
            f"BAT={status.battery_pct:.0f}% | "
            f"YAW={status.yaw_deg:.1f}°"
        )
